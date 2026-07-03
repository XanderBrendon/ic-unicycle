import Map "mo:core/Map";
import Types "types";

// One-shot upgrade migration for the snsRoot field (user-tracked SNS).
//
// CanisterConfig lives inside `tracked`'s nested mo:core Maps, whose nodes
// store values in mutable arrays — an invariant position, so adding even an
// optional field is not upgrade-compatible (M0170) and must be migrated
// explicitly. Every stored config gets `snsRoot = null` (nothing was
// SNS-stamped before this upgrade).
//
// REMOVE THIS MIGRATION (and the `(with migration = ...)` attachment in
// main.mo) in the first commit after the upgrade lands: while attached, a
// subsequent new-on-new upgrade fails the domain compatibility check for the
// same invariance reason and aborts.
module {
  type OldCanisterConfig = {
    minCycleBalance : Nat;
    cycleTopUpAmount : Nat;
    suspendedUntil : ?Nat;
    nickname : ?Text;
  };

  type OldActor = {
    tracked : Map.Map<Principal, Map.Map<Principal, OldCanisterConfig>>;
  };

  type NewActor = {
    tracked : Map.Map<Principal, Map.Map<Principal, Types.CanisterConfig>>;
  };

  public func run(old : OldActor) : NewActor {
    let tracked = Map.map<Principal, Map.Map<Principal, OldCanisterConfig>, Map.Map<Principal, Types.CanisterConfig>>(
      old.tracked,
      func(_, userMap) {
        Map.map<Principal, OldCanisterConfig, Types.CanisterConfig>(
          userMap,
          func(_, cfg) { { cfg with snsRoot = null : ?Principal } },
        );
      },
    );
    { tracked };
  };
};
