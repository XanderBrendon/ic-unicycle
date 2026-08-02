import { test } "mo:test";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Report "../lib/Report";
import Types "../types";

let DAY = 24 * 60 * 60 * 1_000_000_000;
let T = 1_000_000_000_000;
let now = 100 * DAY;

func ok(t : Nat, b : Nat) : Types.CycleReading { { recordedAt = t; result = #ok b } };
func err(t : Nat) : Types.CycleReading { { recordedAt = t; result = #err "x" } };

// A plain successful top-up: no swap leg, no fee.
func topUp(t : Nat, amount : Nat) : Types.TopUp {
  { attemptedAt = t; amount; result = #ok 1; swap = null; serviceFee = 0; feeError = null; rebateApplied = 0 };
};

func withSwap(t : Nat, amount : Nat, swap : Types.SwapAttempt) : Types.TopUp {
  { attemptedAt = t; amount; result = #ok 1; swap = ?swap; serviceFee = 0; feeError = null; rebateApplied = 0 };
};

func swapLeg(source : { #swap; #mint }, amountIn : Nat, amountOut : Nat) : Types.SwapAttempt {
  { source; amountIn; amountOut; outcome = #ok };
};

let A = Principal.fromText("aaaaa-aa");
let B = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let C = Principal.fromText("qhbym-qaaaa-aaaaa-aaafq-cai");
let ROOT = Principal.fromText("qoctq-giaaa-aaaaa-aaaea-cai");

func input(canisterId : Principal, nickname : ?Text, readings : [Types.CycleReading], topUps : [Types.TopUp]) : Report.CanisterInput {
  { canisterId; nickname; readings; topUps };
};

// ---------------------------------------------------------------------------
// Window resolution
// ---------------------------------------------------------------------------

test("cadence window runs from the last report, or 7 days when there is none", func() {
  assert Report.cadenceWindowStart(?(now - 3 * DAY), now) == now - 3 * DAY;
  assert Report.cadenceWindowStart(null, now) == now - 7 * DAY;
  // No cap: a 30-day cadence yields a 30-day window.
  assert Report.cadenceWindowStart(?(now - 30 * DAY), now) == now - 30 * DAY;
});

test("deposit window runs from the last request, capped at 30 days", func() {
  assert Report.depositWindowStart(?(now - 5 * DAY), now) == now - 5 * DAY;
  assert Report.depositWindowStart(null, now) == now - 30 * DAY;
  assert Report.depositWindowStart(?(now - 90 * DAY), now) == now - 30 * DAY;   // older than the cap
});

test("window resolvers clamp to 0 rather than underflowing early in the epoch", func() {
  assert Report.cadenceWindowStart(null, 2 * DAY) == 0;
  assert Report.depositWindowStart(null, 2 * DAY) == 0;
});

// ---------------------------------------------------------------------------
// Burn arithmetic
// ---------------------------------------------------------------------------

test("burn is the balance decline plus top-ups delivered since the anchor", func() {
  // anchor 10T at -7d, latest 6T now, topped up 3T in between -> burned 7T.
  let rs = [ok(now, 6 * T), ok(now - 7 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [topUp(now - 3 * DAY, 3 * T)])], now - 7 * DAY, now);
  assert t.burned == 7 * T;
  assert t.topUpCount == 1;
  assert t.topUpCycles == 3 * T;
});

test("a top-up before the anchor reading is counted but not added back to burn", func() {
  // The 3T landed BEFORE the anchor reading, so it is already inside the 10T
  // anchor balance. Burn is the plain decline; the counters still see it.
  let rs = [ok(now, 6 * T), ok(now - 6 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [topUp(now - 7 * DAY + 1, 3 * T)])], now - 7 * DAY, now);
  assert t.burned == 4 * T;
  assert t.topUpCount == 1;
  assert t.topUpCycles == 3 * T;
});

test("a top-up larger than the burn is not itself counted as burn", func() {
  // The reported bug: a healthy canister burning 0.5T over 3 days is topped up
  // 5T, so its balance RISES. Clamping the decline before adding the top-up
  // back reported the whole 5T as burned.
  let rs = [ok(now, 14_500_000_000_000), ok(now - 3 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [topUp(now - 2 * DAY, 5 * T)])], now - 3 * DAY, now);
  assert t.burned == 500_000_000_000;
  assert t.perCanister[0].avgDaily == 166_666_666_666;
});

test("a top-up exactly covering the burn leaves zero net burn", func() {
  let rs = [ok(now, 15 * T), ok(now - 3 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [topUp(now - 2 * DAY, 5 * T)])], now - 3 * DAY, now);
  assert t.burned == 0;
});

test("a risen balance clamps to zero burn rather than going negative", func() {
  let rs = [ok(now, 12 * T), ok(now - 7 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [])], now - 7 * DAY, now);
  assert t.burned == 0;
});

test("top-ups outside the window are ignored", func() {
  let rs = [ok(now, 6 * T), ok(now - 7 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [topUp(now - 20 * DAY, 3 * T)])], now - 7 * DAY, now);
  assert t.burned == 4 * T;
  assert t.topUpCount == 0;
  assert t.topUpCycles == 0;
});

test("failed and deferred top-ups are neither delivered nor added back", func() {
  let rs = [ok(now, 6 * T), ok(now - 7 * DAY, 10 * T)];
  let failed : Types.TopUp = {
    attemptedAt = now - 2 * DAY; amount = 3 * T; result = #err "boom";
    swap = null; serviceFee = 0; feeError = null; rebateApplied = 0;
  };
  let deferred : Types.TopUp = {
    attemptedAt = now - 1 * DAY; amount = 5 * T; result = #deferred "in flight";
    swap = null; serviceFee = 0; feeError = null; rebateApplied = 0;
  };
  let t = Report.aggregate([input(A, null, rs, [deferred, failed])], now - 7 * DAY, now);
  assert t.burned == 4 * T;
  assert t.topUpCount == 0;
  assert t.topUpCycles == 0;
});

test("average daily burn divides the fleet total by the window days", func() {
  let rs = [ok(now, 3 * T), ok(now - 7 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [])], now - 7 * DAY, now);
  assert t.windowDays == 7;
  assert t.avgDailyBurn == T;
});

test("a sub-day window still divides by one day", func() {
  let rs = [ok(now, 3 * T), ok(now - DAY / 2, 5 * T)];
  let t = Report.aggregate([input(A, null, rs, [])], now - DAY / 2, now);
  assert t.windowDays == 1;
  assert t.avgDailyBurn == 2 * T;
});

test("canisters with no usable reading contribute nothing but keep their top-ups", func() {
  let t = Report.aggregate([input(A, null, [err(now)], [topUp(now - DAY, 3 * T)])], now - 7 * DAY, now);
  assert t.burned == 0;
  assert t.perCanister.size() == 0;
  assert t.topUpCount == 1;
  assert t.topUpCycles == 3 * T;
});

// ---------------------------------------------------------------------------
// Conversion routes
// ---------------------------------------------------------------------------

test("swap and mint legs are totalled separately", func() {
  let rs = [ok(now, 6 * T), ok(now - 7 * DAY, 10 * T)];
  let ups = [
    withSwap(now - 1 * DAY, 2 * T, swapLeg(#swap, 950_000_000, 31 * T)),
    withSwap(now - 2 * DAY, 2 * T, swapLeg(#mint, 300_000_000, 9 * T)),
    withSwap(now - 3 * DAY, 2 * T, swapLeg(#swap, 50_000_000, 1 * T)),
  ];
  let t = Report.aggregate([input(A, null, rs, ups)], now - 7 * DAY, now);
  assert t.swapIcpIn == 1_000_000_000;
  assert t.swapTcOut == 32 * T;
  assert t.mintIcpIn == 300_000_000;
  assert t.mintTcOut == 9 * T;
});

test("a swap leg that did not deliver is excluded from the conversion totals", func() {
  let rs = [ok(now, 6 * T), ok(now - 7 * DAY, 10 * T)];
  let stuck : Types.SwapAttempt = {
    source = #swap; amountIn = 500_000_000; amountOut = 16 * T;
    outcome = #stuckInPool({ token = "ICP"; amount = 500_000_000 });
  };
  let t = Report.aggregate([input(A, null, rs, [withSwap(now - DAY, 2 * T, stuck)])], now - 7 * DAY, now);
  assert t.swapIcpIn == 0;
  assert t.swapTcOut == 0;
  // The top-up itself still succeeded and delivered cycles.
  assert t.topUpCount == 1;
});

// ---------------------------------------------------------------------------
// Per-canister ranking
// ---------------------------------------------------------------------------

test("per-canister rows are ranked by burn, descending", func() {
  let small = [ok(now, 9 * T), ok(now - 7 * DAY, 10 * T)];      // 1T
  let big = [ok(now, 2 * T), ok(now - 7 * DAY, 30 * T)];        // 28T
  let mid = [ok(now, 5 * T), ok(now - 7 * DAY, 12 * T)];        // 7T
  let t = Report.aggregate(
    [input(A, null, small, []), input(B, ?"ledger", big, []), input(C, null, mid, [])],
    now - 7 * DAY,
    now,
  );
  assert t.perCanister.size() == 3;
  assert t.perCanister[0].canisterId == B;
  assert t.perCanister[0].burned == 28 * T;
  assert t.perCanister[0].avgDaily == 4 * T;
  assert t.perCanister[1].canisterId == C;
  assert t.perCanister[2].canisterId == A;
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

test("a canister with a reading older than the window start is not truncated", func() {
  let rs = [ok(now, 6 * T), ok(now - 6 * DAY, 10 * T), ok(now - 9 * DAY, 12 * T)];
  let t = Report.aggregate([input(A, null, rs, [])], now - 7 * DAY, now);
  assert t.truncatedCount == 0;
  assert not t.perCanister[0].truncated;
});

test("a canister whose readings all start inside the window is truncated", func() {
  let rs = [ok(now, 6 * T), ok(now - 3 * DAY, 10 * T)];
  let t = Report.aggregate([input(A, null, rs, [])], now - 7 * DAY, now);
  assert t.truncatedCount == 1;
  assert t.perCanister[0].truncated;
  assert t.perCanister[0].coveredDays == 3;
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test("empty fleet renders the one-liner and the link", func() {
  let r = Report.build(Report.aggregate([], now - 7 * DAY, now), ROOT);
  assert Text.contains(r, #text "no tracked canisters");
  assert Text.contains(r, #text "https://ic-unicycle.com/#/sns/qoctq-giaaa-aaaaa-aaaea-cai");
});

test("report renders totals, ranking and link", func() {
  let big = [ok(now, 2 * T), ok(now - 7 * DAY, 30 * T)];
  let small = [ok(now, 9 * T), ok(now - 7 * DAY, 10 * T)];
  let ups = [withSwap(now - DAY, 3 * T, swapLeg(#swap, 950_000_000, 31 * T))];
  let r = Report.build(
    Report.aggregate([input(B, ?"ledger", big, ups), input(A, null, small, [])], now - 7 * DAY, now),
    ROOT,
  );
  assert Text.contains(r, #text "last 7 days across 2 tracked canisters");
  assert Text.contains(r, #text "Cycles burned: 32T (32_000_000_000_000 e12s)");
  assert Text.contains(r, #text "Average daily burn: 4.57T");
  assert Text.contains(r, #text "Top-ups performed: 1, delivering 3T (3_000_000_000_000 e12s)");
  assert Text.contains(r, #text "ICP swapped (ICPSwap): 9.5 ICP (950_000_000 e8s) -> 31T (31_000_000_000_000 e12s)");
  assert Text.contains(r, #text "Top 2 canisters by cycles burned:");
  assert Text.contains(r, #text "- ledger (ryjl3-tyaaa-aaaaa-aaaba-cai): 31T (31_000_000_000_000 e12s), 4.43T/day");
  assert Text.contains(r, #text "https://ic-unicycle.com/#/sns/qoctq-giaaa-aaaaa-aaaea-cai");
});

test("conversion lines are omitted when a route saw no activity", func() {
  let rs = [ok(now, 6 * T), ok(now - 7 * DAY, 10 * T)];
  let r = Report.build(Report.aggregate([input(A, null, rs, [])], now - 7 * DAY, now), ROOT);
  assert not Text.contains(r, #text "ICP swapped");
  assert not Text.contains(r, #text "ICP minted");
  assert Text.contains(r, #text "Top-ups performed: 0");
});

test("more than five canisters renders a top-5 heading and five rows", func() {
  let mk = func(id : Principal, burn : Nat) : Report.CanisterInput {
    input(id, null, [ok(now, 100 * T), ok(now - 7 * DAY, 100 * T + burn)], []);
  };
  // Six distinct canisters; the two smallest must not appear.
  let ids = [
    Principal.fromText("aaaaa-aa"),
    Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"),
    Principal.fromText("qhbym-qaaaa-aaaaa-aaafq-cai"),
    Principal.fromText("qoctq-giaaa-aaaaa-aaaea-cai"),
    Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai"),
    Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai"),
  ];
  let inputs = [
    mk(ids[0], 6 * T), mk(ids[1], 5 * T), mk(ids[2], 4 * T),
    mk(ids[3], 3 * T), mk(ids[4], 2 * T), mk(ids[5], 1 * T),
  ];
  let t = Report.aggregate(inputs, now - 7 * DAY, now);
  let r = Report.build(t, ROOT);
  assert t.perCanister.size() == 6;
  assert Text.contains(r, #text "Top 5 of 6 canisters by cycles burned:");
  assert Text.contains(r, #text (ids[4].toText()));          // 5th largest, shown
  assert not Text.contains(r, #text (ids[5].toText()));      // 6th largest, dropped
});

test("truncated canisters produce a coverage note", func() {
  let full = [ok(now, 6 * T), ok(now - 8 * DAY, 10 * T)];
  let short = [ok(now, 6 * T), ok(now - 2 * DAY, 8 * T)];
  let r = Report.build(
    Report.aggregate([input(A, null, full, []), input(B, null, short, [])], now - 7 * DAY, now),
    ROOT,
  );
  assert Text.contains(r, #text "Note: 1 canister has readings reaching back only 2 days");
});
