// Manual "Record now" rate limiting (todo-24).
//
// Two sliding-window caps per account (a user principal, or an SNS root):
//   * at most PER_CANISTER_MAX manual checks for a single canister within
//     PER_CANISTER_WINDOW_NS, and
//   * at most PER_ACCOUNT_MAX manual checks across all canisters within
//     PER_ACCOUNT_WINDOW_NS.
//
// Pure over an account's prior accepted checks so it is unit-testable; main.mo
// owns the per-account state (transient — see `manualChecks`). All times are ns.
import Principal "mo:core/Principal";
import List "mo:core/List";

module {
  public type Check = { canisterId : Principal; at : Nat };

  public let PER_CANISTER_WINDOW_NS : Nat = 300_000_000_000; // 5 min
  public let PER_CANISTER_MAX : Nat = 2;
  public let PER_ACCOUNT_WINDOW_NS : Nat = 3_600_000_000_000; // 60 min
  public let PER_ACCOUNT_MAX : Nat = 20;

  // #ok carries the pruned prior list with the new check appended — the value
  // the account's state should be replaced with. #denied means a cap was hit.
  public type Outcome = { #ok : [Check]; #denied };

  // Decide whether a manual check for `canisterId` at `now` is allowed given
  // this account's `prior` accepted checks. Entries older than the larger
  // (account) window are dropped from the returned list so it stays bounded.
  public func register(prior : [Check], canisterId : Principal, now : Nat) : Outcome {
    let accountFloor = if (now > PER_ACCOUNT_WINDOW_NS) { (now - PER_ACCOUNT_WINDOW_NS) : Nat } else { 0 };
    let canisterFloor = if (now > PER_CANISTER_WINDOW_NS) { (now - PER_CANISTER_WINDOW_NS) : Nat } else { 0 };
    let kept = List.empty<Check>();
    var accountCount = 0;
    var canisterCount = 0;
    for (c in prior.vals()) {
      if (c.at >= accountFloor) {
        kept.add(c);
        accountCount += 1;
        if (c.canisterId == canisterId and c.at >= canisterFloor) { canisterCount += 1 };
      };
    };
    if (canisterCount >= PER_CANISTER_MAX) { return #denied };
    if (accountCount >= PER_ACCOUNT_MAX) { return #denied };
    kept.add({ canisterId; at = now });
    #ok(kept.toArray());
  };
}
