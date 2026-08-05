import { test } "mo:test";
import Principal "mo:core/Principal";
import BatchTrack "../lib/BatchTrack";
import Types "../types";

let a = Principal.fromText("ibahq-taaaa-aaaaq-aadna-cai");
let b = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let c = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");

let goodConfig : Types.CanisterConfig = {
  minCycleBalance = 1_000;
  cycleTopUpAmount = 500;
  suspendedUntil = null;
  nickname = null;
  snsRoot = null;
};

func trackEntry(id : Principal, cfg : Types.CanisterConfig) : Types.BatchTrackEntry = {
  canisterId = id;
  intent = #track { config = cfg; suspended = false };
};

func untrackEntry(id : Principal) : Types.BatchTrackEntry = {
  canisterId = id;
  intent = #untrack;
};

// Room for everything: no cap bites unless a test overrides a field.
let roomy : BatchTrack.Caps = {
  ownerIsNew = false;
  ownerCount = 5;
  maxOwners = 10_000;
  trackedCount = 0;
  maxCanistersPerOwner = 200;
};

let nothingTracked = func(_ : Principal) : Bool { false };

test("findDuplicate: distinct ids are clean", func() {
  assert BatchTrack.findDuplicate([trackEntry(a, goodConfig), untrackEntry(b)]) == null;
  assert BatchTrack.findDuplicate([]) == null;
});

test("findDuplicate: a repeated id is reported, whatever the intents", func() {
  // The same canister with two different intents is exactly the ambiguous case.
  assert BatchTrack.findDuplicate([trackEntry(a, goodConfig), untrackEntry(b), untrackEntry(a)]) == ?a;
});

test("precheck: zero amounts are rejected without a probe", func() {
  let zeroMin = { goodConfig with minCycleBalance = 0 };
  let zeroTop = { goodConfig with cycleTopUpAmount = 0 };
  let v = BatchTrack.precheck(
    [trackEntry(a, zeroMin), trackEntry(b, zeroTop), trackEntry(c, goodConfig)],
    nothingTracked,
    roomy,
  );
  assert v[0] == ?#zeroMinCycleBalance;
  assert v[1] == ?#zeroCycleTopUpAmount;
  assert v[2] == null;
});

test("precheck: untrack entries always survive — they never grow the registry", func() {
  let full : BatchTrack.Caps = { roomy with trackedCount = 200; maxCanistersPerOwner = 200 };
  let v = BatchTrack.precheck([untrackEntry(a), untrackEntry(b)], nothingTracked, full);
  assert v[0] == null;
  assert v[1] == null;
});

test("precheck: a new owner past maxOwners fails every track entry", func() {
  let capped : BatchTrack.Caps = { roomy with ownerIsNew = true; ownerCount = 10_000 };
  let v = BatchTrack.precheck([trackEntry(a, goodConfig), untrackEntry(b)], nothingTracked, capped);
  assert v[0] == ?#ownerLimitReached { maxOwners = 10_000 };
  // Untracking is still allowed — it shrinks the registry.
  assert v[1] == null;
});

test("precheck: new canisters are admitted in input order until the cap", func() {
  // One slot left, three new canisters: the first wins, the rest are rejected.
  let oneLeft : BatchTrack.Caps = { roomy with trackedCount = 199 };
  let v = BatchTrack.precheck(
    [trackEntry(a, goodConfig), trackEntry(b, goodConfig), trackEntry(c, goodConfig)],
    nothingTracked,
    oneLeft,
  );
  assert v[0] == null;
  assert v[1] == ?#canisterLimitReached { maxCanistersPerOwner = 200 };
  assert v[2] == ?#canisterLimitReached { maxCanistersPerOwner = 200 };
});

test("precheck: re-upserting an already-tracked canister ignores the cap", func() {
  // At the cap, but `a` is already tracked — an in-place update, not growth.
  let atCap : BatchTrack.Caps = { roomy with trackedCount = 200 };
  let onlyA = func(p : Principal) : Bool { p == a };
  let v = BatchTrack.precheck([trackEntry(a, goodConfig), trackEntry(b, goodConfig)], onlyA, atCap);
  assert v[0] == null;
  assert v[1] == ?#canisterLimitReached { maxCanistersPerOwner = 200 };
});

test("probeIds: only surviving track entries are probed", func() {
  let entries = [trackEntry(a, goodConfig), untrackEntry(b), trackEntry(c, goodConfig)];
  let verdicts : [?Types.UpsertCanisterError] = [null, null, ?#zeroMinCycleBalance];
  // `b` untracks (no verification needed); `c` is already rejected.
  assert BatchTrack.probeIds(entries, verdicts) == [a];
});
