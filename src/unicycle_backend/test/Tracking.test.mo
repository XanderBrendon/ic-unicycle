import { test } "mo:test";
import Principal "mo:core/Principal";
import Tracking "../lib/Tracking";

type Cfg = {
  minCycleBalance : Nat;
  cycleTopUpAmount : Nat;
  suspendedUntil : ?Nat;
  nickname : ?Text;
  snsRoot : ?Principal;
};

func cfg(min : Nat, top : Nat, susp : ?Nat) : Cfg {
  { minCycleBalance = min; cycleTopUpAmount = top; suspendedUntil = susp; nickname = null; snsRoot = null };
};

func named(min : Nat, top : Nat, susp : ?Nat, name : ?Text) : Cfg {
  { minCycleBalance = min; cycleTopUpAmount = top; suspendedUntil = susp; nickname = name; snsRoot = null };
};

func stamped(root : ?Principal) : Cfg {
  { minCycleBalance = 1; cycleTopUpAmount = 2; suspendedUntil = null; nickname = null; snsRoot = root };
};

test("below threshold, not suspended -> topUp(amount)", func() {
  switch (Tracking.classifyForTopUp(cfg(100, 50, null), 99, 1_000)) {
    case (#topUp amt) { assert amt == 50 };
    case _ { assert false };
  };
});

test("at/above threshold, not suspended -> skip", func() {
  switch (Tracking.classifyForTopUp(cfg(100, 50, null), 100, 1_000)) { case (#skip) {}; case _ { assert false } };
});

test("suspended, deadline not passed -> skip", func() {
  switch (Tracking.classifyForTopUp(cfg(100, 50, ?2_000), 1, 1_000)) { case (#skip) {}; case _ { assert false } };
});

test("suspended, deadline passed (now > deadline) -> remove", func() {
  switch (Tracking.classifyForTopUp(cfg(100, 50, ?2_000), 1, 2_001)) { case (#remove) {}; case _ { assert false } };
  switch (Tracking.classifyForTopUp(cfg(100, 50, ?2_000), 1, 2_000)) { case (#skip) {}; case _ { assert false } };
});

test("mergeConfig preserves prior suspendedUntil and discards incoming", func() {
  let merged = Tracking.mergeConfig(?cfg(1, 2, ?9_000), cfg(100, 200, ?5));
  assert merged.minCycleBalance == 100;
  assert merged.cycleTopUpAmount == 200;
  assert merged.suspendedUntil == ?9_000;
});

test("mergeConfig with no prior -> null suspension", func() {
  let merged = Tracking.mergeConfig(null, cfg(100, 200, ?5));
  assert merged.suspendedUntil == null;
});

test("mergeConfig takes the incoming nickname (rename), unlike suspension", func() {
  let merged = Tracking.mergeConfig(?named(1, 2, ?9_000, ?"old"), named(100, 200, ?5, ?"new"));
  assert merged.nickname == ?"new";
  assert merged.suspendedUntil == ?9_000;
});

test("mergeConfig can clear the nickname by sending null", func() {
  let merged = Tracking.mergeConfig(?named(1, 2, null, ?"old"), named(100, 200, null, null));
  assert merged.nickname == null;
});

let rootA = Principal.fromText("ibahq-taaaa-aaaaq-aadna-cai");
let rootB = Principal.fromText("2jvtu-yqaaa-aaaaq-aaama-cai");
let canX = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let canY = Principal.fromText("mxzaz-hqaaa-aaaar-qaada-cai");

test("mergeConfig preserves prior snsRoot and discards incoming", func() {
  let merged = Tracking.mergeConfig(?stamped(?rootA), stamped(?rootB));
  assert merged.snsRoot == ?rootA;
});

test("mergeConfig with no prior -> null snsRoot", func() {
  let merged = Tracking.mergeConfig(null, stamped(?rootB));
  assert merged.snsRoot == null;
});

test("stampedWith picks only entries stamped with the given root", func() {
  let entries : [(Principal, Cfg)] = [
    (canX, stamped(?rootA)),
    (canY, stamped(?rootB)),
    (rootA, stamped(null)),
  ];
  let hits = Tracking.stampedWith(entries, rootA);
  assert hits == [canX];
});

test("stampedWith on empty / no-match -> empty", func() {
  assert Tracking.stampedWith([], rootA) == [];
  assert Tracking.stampedWith([(canX, stamped(null))], rootA) == [];
});
