// Cycle-usage report builder (US25). An overview of cycle activity since the
// last report, not a per-canister table — the SNS's public Unicycle page holds
// the detail, and every report links to it.
//
// Split like DrainDetection: `aggregate` is the arithmetic, `build` is the
// text, so the numbers are testable without string matching.
//
// Invariants:
//   * Window start comes from `cadenceWindowStart` / `depositWindowStart`; the
//     deposit window never reaches back more than 30 days.
//   * Per-canister burn = `max(0, anchorBal - latestBal)` + top-ups delivered
//     in `[anchor.recordedAt, latest.recordedAt)`. The clamp mirrors
//     DrainDetection's saturating subtraction for an externally-funded rise.
//   * That add-back range is NOT the report window. A top-up before the anchor
//     reading is already inside `anchorBal`, and one after the latest reading
//     is not yet inside `latestBal` — adding either would invent burn. The
//     top-up COUNTERS do use the whole window, since "top-ups since the last
//     report" is the reported quantity.
//   * Only `#ok` top-ups count: `#deferred` cycles had not been delivered.
//     Only `#ok` swap legs count: `#stuckInPool` spent ICP without delivering.
//   * A canister is `truncated` when it holds no reading at-or-before the
//     window start — older readings may have been dropped by the per-canister
//     cap, so its figures span less than the header claims. Its `avgDaily`
//     divides by that shorter span.
//   * Empty `canisters` array → the "no tracked canisters" line, still linked.
import Types "../types";
import History "History";
import Durations "Durations";
import NumFmt "NumFmt";
import Principal "mo:core/Principal";
import Nat "mo:core/Nat";
import List "mo:core/List";
import Array "mo:core/Array";

module {
  // The public SNS page every report points at. Matches the custom domain in
  // `src/unicycle_frontend/public/.well-known/ic-domains` and the hash route
  // `parseHash` resolves to the SNS overview.
  let SITE = "https://ic-unicycle.com";
  let FIRST_REPORT_DAYS = 7;
  let DEPOSIT_MAX_DAYS = 30;
  let TOP_N = 5;

  public type CanisterInput = {
    canisterId : Principal;
    nickname : ?Text;
    readings : [Types.CycleReading];
    topUps : [Types.TopUp];
  };

  public type CanisterTotals = {
    canisterId : Principal;
    nickname : ?Text;
    burned : Nat;
    avgDaily : Nat;
    truncated : Bool;
    coveredDays : Nat;
  };

  public type Totals = {
    canisterCount : Nat;      // tracked canisters, including those with no readings
    windowDays : Nat;
    burned : Nat;
    avgDailyBurn : Nat;
    topUpCount : Nat;
    topUpCycles : Nat;
    swapIcpIn : Nat;
    swapTcOut : Nat;
    mintIcpIn : Nat;
    mintTcOut : Nat;
    perCanister : [CanisterTotals];   // burn-ranked, descending
    truncatedCount : Nat;
    minCoveredDays : Nat;             // shortest span among truncated canisters
  };

  // Every Unicycle proposal for this SNS links here, not just the reports.
  public func snsPageUrl(root : Principal) : Text {
    SITE # "/#/sns/" # root.toText();
  };

  // ---------------------------------------------------------------------------
  // Window resolution
  // ---------------------------------------------------------------------------

  func ago(now : Nat, days : Nat) : Nat {
    if (now > days * Durations.DAY_NS) { (now - days * Durations.DAY_NS) : Nat } else { 0 };
  };

  // Since the last report motion; 7 days when there has not been one. No cap —
  // a 30-day cadence is meant to report on 30 days.
  public func cadenceWindowStart(lastReport : ?Nat, now : Nat) : Nat {
    switch (lastReport) { case (?t) t; case null { ago(now, FIRST_REPORT_DAYS) } };
  };

  // Since the last funding request, but never more than 30 days back. The
  // `max` collapses both rules: no anchor and an anchor older than the cap
  // both resolve to 30 days.
  public func depositWindowStart(lastDeposit : ?Nat, now : Nat) : Nat {
    let cap = ago(now, DEPOSIT_MAX_DAYS);
    switch (lastDeposit) { case (?t) { if (t > cap) t else cap }; case null cap };
  };

  // ---------------------------------------------------------------------------
  // Aggregation
  // ---------------------------------------------------------------------------

  func days(span : Nat) : Nat {
    if (span >= Durations.DAY_NS) { span / Durations.DAY_NS } else { 1 };
  };

  // Any reading at-or-before the window start proves nothing older was dropped.
  // `#err` entries count: coverage is about how far the list reaches, not about
  // which entries carry a balance.
  func reachesBack(readings : [Types.CycleReading], windowStart : Nat) : Bool {
    for (r in readings.vals()) { if (r.recordedAt <= windowStart) return true };
    false;
  };

  public func aggregate(canisters : [CanisterInput], windowStart : Nat, now : Nat) : Totals {
    let windowDays = days(if (now > windowStart) { (now - windowStart) : Nat } else { 0 });

    var burned = 0;
    var topUpCount = 0;
    var topUpCycles = 0;
    var swapIcpIn = 0;
    var swapTcOut = 0;
    var mintIcpIn = 0;
    var mintTcOut = 0;
    var truncatedCount = 0;
    var minCoveredDays = 0;
    let rows = List.empty<CanisterTotals>();

    for (c in canisters.vals()) {
      // Counters span the whole window and do not depend on reading coverage —
      // a canister with no usable readings can still have been topped up.
      for (u in c.topUps.vals()) {
        if (u.attemptedAt >= windowStart) {
          switch (u.result) {
            case (#ok _) {
              topUpCount += 1;
              topUpCycles += u.amount;
              switch (u.swap) {
                case (?s) {
                  switch (s.outcome) {
                    case (#ok) {
                      switch (s.source) {
                        case (#swap) { swapIcpIn += s.amountIn; swapTcOut += s.amountOut };
                        case (#mint) { mintIcpIn += s.amountIn; mintTcOut += s.amountOut };
                      };
                    };
                    case (_) {};
                  };
                };
                case null {};
              };
            };
            case (_) {};
          };
        };
      };

      // Burn needs both ends: the newest reading and one to measure it against.
      switch (History.latestOk(c.readings), History.oldestOkSince(c.readings, windowStart)) {
        case (?latest, ?anchor) {
          let balNow = History.okBal(latest);
          let balStart = History.okBal(anchor);
          var delivered = 0;
          for (u in c.topUps.vals()) {
            if (u.attemptedAt >= anchor.recordedAt and u.attemptedAt < latest.recordedAt) {
              switch (u.result) { case (#ok _) { delivered += u.amount }; case (_) {} };
            };
          };
          // Funded start minus end. The clamp wraps the WHOLE expression, not
          // just `balStart - balNow`: a top-up bigger than the burn raises the
          // balance, and clamping the decline first would saturate it to zero
          // and then report the entire top-up as consumed.
          let funded = balStart + delivered;
          let rowBurn = if (funded >= balNow) { (funded - balNow) : Nat } else { 0 };
          let truncated = not reachesBack(c.readings, windowStart);
          let coveredDays = if (truncated) { days((now - anchor.recordedAt) : Nat) } else { windowDays };
          if (truncated) {
            truncatedCount += 1;
            if (minCoveredDays == 0 or coveredDays < minCoveredDays) { minCoveredDays := coveredDays };
          };
          burned += rowBurn;
          rows.add({
            canisterId = c.canisterId;
            nickname = c.nickname;
            burned = rowBurn;
            avgDaily = rowBurn / coveredDays;
            truncated;
            coveredDays;
          });
        };
        case (_, _) {};
      };
    };

    {
      canisterCount = canisters.size();
      windowDays;
      burned;
      avgDailyBurn = burned / windowDays;
      topUpCount;
      topUpCycles;
      swapIcpIn;
      swapTcOut;
      mintIcpIn;
      mintTcOut;
      perCanister = Array.sort<CanisterTotals>(rows.toArray(), func(a, b) = Nat.compare(b.burned, a.burned));
      truncatedCount;
      minCoveredDays;
    };
  };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  func plural(n : Nat, one : Text, many : Text) : Text {
    if (n == 1) one else many;
  };

  func name(row : CanisterTotals) : Text {
    switch (row.nickname) {
      case (?n) { n # " (" # row.canisterId.toText() # ")" };
      case null { row.canisterId.toText() };
    };
  };

  // Measured amounts carry the exact base-unit figure; derived rates
  // (`T/day`) are rounded only — a quotient is not a ledger fact.
  func rate(cycles : Nat) : Text {
    NumFmt.decimal2(cycles, 12) # "T";
  };

  public func build(t : Totals, root : Principal) : Text {
    let link = "\n\nFull details: " # snsPageUrl(root);
    if (t.canisterCount == 0) return "Cycle usage report: no tracked canisters." # link;

    var out = "Cycle usage report — last " # t.windowDays.toText() # " "
      # plural(t.windowDays, "day", "days") # " across " # t.canisterCount.toText()
      # " tracked " # plural(t.canisterCount, "canister", "canisters") # ".";

    out #= "\n\nCycles burned: " # NumFmt.tcyclesE12s(t.burned);
    out #= "\nAverage daily burn: " # rate(t.avgDailyBurn);
    out #= "\nTop-ups performed: " # t.topUpCount.toText();
    if (t.topUpCount > 0) { out #= ", delivering " # NumFmt.tcyclesE12s(t.topUpCycles) };
    if (t.swapTcOut > 0) {
      out #= "\nICP swapped (ICPSwap): " # NumFmt.icpE8s(t.swapIcpIn) # " -> " # NumFmt.tcyclesE12s(t.swapTcOut);
    };
    if (t.mintTcOut > 0) {
      out #= "\nICP minted (CMC): " # NumFmt.icpE8s(t.mintIcpIn) # " -> " # NumFmt.tcyclesE12s(t.mintTcOut);
    };

    let total = t.perCanister.size();
    if (total > 0) {
      let shown = if (total > TOP_N) TOP_N else total;
      let heading = if (total > TOP_N) { "Top " # TOP_N.toText() # " of " # total.toText() } else { "Top " # shown.toText() };
      out #= "\n\n" # heading # " " # plural(shown, "canister", "canisters") # " by cycles burned:";
      var i = 0;
      while (i < shown) {
        let row = t.perCanister[i];
        out #= "\n- " # name(row) # ": " # NumFmt.tcyclesE12s(row.burned) # ", " # rate(row.avgDaily) # "/day";
        i += 1;
      };
    };

    if (t.truncatedCount > 0) {
      out #= "\n\nNote: " # t.truncatedCount.toText() # " "
        # plural(t.truncatedCount, "canister has", "canisters have")
        # " readings reaching back only " # t.minCoveredDays.toText() # " "
        # plural(t.minCoveredDays, "day", "days") # "; "
        # plural(t.truncatedCount, "its", "their") # " figures cover that shorter span.";
    };

    out # link;
  };
}
