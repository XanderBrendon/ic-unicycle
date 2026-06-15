import Types "types";

// Inline upgrade migration (mainnet). This upgrade adds `harvestThresholdTcycles`
// to AdminSettings. The field is absent from the persisted state, so the type of
// the stable `settings` variable changed incompatibly and EOP requires an
// explicit migration. We re-emit `settings` with the new field defaulted to
// 0.1 T — the same value a fresh install uses — so the harvest threshold is
// active immediately (an admin can retune it via updateAdminSettings). Every
// other stable variable is carried through unchanged (not named here).
module {
  // AdminSettings as persisted before this upgrade. Declared inline so the
  // migration never depends on the current (new) AdminSettings shape.
  type OldAdminSettings = {
    cycleCheckIntervalSeconds : Nat;
    maxReadingsPerCanister : Nat;
    maxTopUpsPerCanister : Nat;
    batchSize : Nat;
    baseServiceFeeBps : Nat;
    lpDrainThresholdTcycles : Nat;
    serviceFundingThresholdTcycles : Nat;
    maxOwners : Nat;
    maxCanistersPerOwner : Nat;
    swapSlippageBps : Nat;
  };

  public func run(old : { var settings : OldAdminSettings }) : { var settings : Types.AdminSettings } {
    { var settings = { old.settings with harvestThresholdTcycles = 100_000_000_000 } };
  };
};
