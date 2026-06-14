import { test } "mo:test";
import Tracking "../lib/Tracking";

func cfg(min : Nat, top : Nat, susp : ?Nat) : { minCycleBalance : Nat; cycleTopUpAmount : Nat; suspendedUntil : ?Nat; nickname : ?Text } {
  { minCycleBalance = min; cycleTopUpAmount = top; suspendedUntil = susp; nickname = null };
};

func named(min : Nat, top : Nat, susp : ?Nat, name : ?Text) : { minCycleBalance : Nat; cycleTopUpAmount : Nat; suspendedUntil : ?Nat; nickname : ?Text } {
  { minCycleBalance = min; cycleTopUpAmount = top; suspendedUntil = susp; nickname = name };
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
