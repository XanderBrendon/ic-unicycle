import { test } "mo:test";
import Settings "../lib/Settings";

func base() : { cycleCheckIntervalSeconds : Nat; maxReadingsPerCanister : Nat; maxTopUpsPerCanister : Nat; batchSize : Nat; baseServiceFeeBps : Nat; lpDrainThresholdTcycles : Nat; serviceFundingThresholdTcycles : Nat; maxOwners : Nat; maxCanistersPerOwner : Nat; swapSlippageBps : Nat } {
  { cycleCheckIntervalSeconds = 86_400; maxReadingsPerCanister = 90; maxTopUpsPerCanister = 90; batchSize = 10; baseServiceFeeBps = 1_000; lpDrainThresholdTcycles = 1_000_000_000_000; serviceFundingThresholdTcycles = 10_000_000_000_000; maxOwners = 1_000; maxCanistersPerOwner = 100; swapSlippageBps = 300 };
};

test("valid settings pass", func() {
  switch (Settings.validate(base())) { case (#ok) {}; case (#err _) { assert false } };
});

test("interval below floor rejected", func() {
  switch (Settings.validate({ base() with cycleCheckIntervalSeconds = 30 })) {
    case (#err(#intervalTooSmall { minSeconds })) { assert minSeconds == 60 };
    case _ { assert false };
  };
});

test("zero interval reported as zeroValue first", func() {
  switch (Settings.validate({ base() with cycleCheckIntervalSeconds = 0 })) {
    case (#err(#zeroValue { field })) { assert field == "cycleCheckIntervalSeconds" };
    case _ { assert false };
  };
});

test("fee bps over cap rejected", func() {
  switch (Settings.validate({ base() with baseServiceFeeBps = 2_001 })) {
    case (#err(#feeBpsTooHigh { maxBps })) { assert maxBps == 2_000 };
    case _ { assert false };
  };
});

test("lp threshold under floor rejected", func() {
  switch (Settings.validate({ base() with lpDrainThresholdTcycles = 1 })) {
    case (#err(#lpThresholdTooLow { minTcycles })) { assert minTcycles == 100_000_000 };
    case _ { assert false };
  };
});

test("swap slippage over cap rejected", func() {
  switch (Settings.validate({ base() with swapSlippageBps = 2_001 })) {
    case (#err(#swapSlippageTooHigh { maxBps })) { assert maxBps == 2_000 };
    case _ { assert false };
  };
});

test("zero maxReadingsPerCanister rejected", func() {
  switch (Settings.validate({ base() with maxReadingsPerCanister = 0 })) {
    case (#err(#zeroValue { field })) { assert field == "maxReadingsPerCanister" };
    case _ { assert false };
  };
});

test("zero maxTopUpsPerCanister rejected", func() {
  switch (Settings.validate({ base() with maxTopUpsPerCanister = 0 })) {
    case (#err(#zeroValue { field })) { assert field == "maxTopUpsPerCanister" };
    case _ { assert false };
  };
});

test("zero batchSize rejected", func() {
  switch (Settings.validate({ base() with batchSize = 0 })) {
    case (#err(#zeroValue { field })) { assert field == "batchSize" };
    case _ { assert false };
  };
});

test("zero maxOwners rejected", func() {
  switch (Settings.validate({ base() with maxOwners = 0 })) {
    case (#err(#zeroValue { field })) { assert field == "maxOwners" };
    case _ { assert false };
  };
});

test("zero maxCanistersPerOwner rejected", func() {
  switch (Settings.validate({ base() with maxCanistersPerOwner = 0 })) {
    case (#err(#zeroValue { field })) { assert field == "maxCanistersPerOwner" };
    case _ { assert false };
  };
});

test("suspendDeadline adds 60 days", func() {
  assert Settings.suspendDeadline(0) == 60 * 24 * 60 * 60 * 1_000_000_000;
  assert Settings.suspendDeadline(5) == 5 + 60 * 24 * 60 * 60 * 1_000_000_000;
});
