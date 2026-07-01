import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Types "../types";

module {
  // (id, target_method_name) of every generic function to remove on deregister:
  // those whose function_type is GenericNervousSystemFunction, whose
  // target_canister_id is the Unicycle backend, and whose target_method_name is
  // one of ours (`knownMethods`). Native functions (function_type == null),
  // generics targeting another canister, and generics naming an unknown (or
  // absent) method are left untouched.
  public func functionsToRemove(
    functions : [Types.SnsNervousSystemFunction],
    backend : Principal,
    knownMethods : [Text],
  ) : [(Nat64, Text)] {
    Array.filterMap<Types.SnsNervousSystemFunction, (Nat64, Text)>(
      functions,
      func(fn) {
        switch (fn.function_type) {
          case (?#GenericNervousSystemFunction(g)) {
            switch (g.target_canister_id, g.target_method_name) {
              case (?target, ?method) {
                if (Principal.equal(target, backend) and contains(knownMethods, method)) {
                  ?(fn.id, method);
                } else { null };
              };
              case _ { null };
            };
          };
          case null { null };
        };
      },
    );
  };

  func contains(haystack : [Text], needle : Text) : Bool {
    for (h in haystack.vals()) { if (h == needle) { return true } };
    false;
  };

  // Full-drain amount net of the ledger fee; null when the balance cannot cover
  // a transfer (nothing spendable / dust). `icrc1_transfer` debits `amount +
  // fee` from the source, so draining sends `balance - fee`.
  public func drainAmount(balance : Nat, fee : Nat) : ?Nat {
    if (balance > fee) { ?(balance - fee : Nat) } else { null };
  };
}
