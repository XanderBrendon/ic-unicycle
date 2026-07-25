import Map "mo:core/Map";
import Types "types";

// One-shot upgrade migration for the `#deferred` case on TopUp.result.
//
// TopUp lives inside `topUpHistory`'s nested mo:core Maps, whose nodes store
// values in mutable arrays — an invariant position, so even a purely additive
// variant case is not upgrade-compatible (M0170) and must be migrated
// explicitly. Nothing about the stored rows changes: `[OldTopUp]` is already a
// subtype of `[Types.TopUp]` (immutable arrays are covariant and the old
// variant has a subset of the new cases), so the rows pass straight through
// and only the Map spine is rebuilt to retype the invariant slots.
//
// REMOVE THIS MIGRATION (and the `(with migration = ...)` attachment in
// main.mo) in the first commit after the upgrade lands: while attached, a
// subsequent new-on-new upgrade fails the domain compatibility check for the
// same invariance reason and aborts.
module {
  type OldTopUp = {
    attemptedAt : Nat;
    amount : Nat;
    result : { #ok : Nat; #err : Text };
    swap : ?Types.SwapAttempt;
    serviceFee : Nat;
    feeError : ?Text;
    rebateApplied : Nat;
  };

  type OldActor = {
    topUpHistory : Map.Map<Principal, Map.Map<Principal, [OldTopUp]>>;
  };

  type NewActor = {
    topUpHistory : Map.Map<Principal, Map.Map<Principal, [Types.TopUp]>>;
  };

  public func run(old : OldActor) : NewActor {
    let topUpHistory = Map.map<Principal, Map.Map<Principal, [OldTopUp]>, Map.Map<Principal, [Types.TopUp]>>(
      old.topUpHistory,
      func(_, userMap) {
        Map.map<Principal, [OldTopUp], [Types.TopUp]>(
          userMap,
          func(_, ups) { ups },
        );
      },
    );
    { topUpHistory };
  };
};
