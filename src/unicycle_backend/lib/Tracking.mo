import Types "../types";
import List "mo:core/List";

// Tracked-canister top-up decisions (US06/US20).
// INVARIANTS:
//   * classifyForTopUp is the single three-way suspension/threshold branch:
//     suspended -> #remove iff now > deadline (strict) else #skip; not suspended
//     -> #topUp(cycleTopUpAmount) iff cycles < minCycleBalance (strict) else #skip.
//   * mergeConfig preserves the prior suspendedUntil and discards the incoming one
//     (setCanisterSuspended is the only path that mutates suspension), and takes
//     the incoming nickname (upsertCanister is the only path that sets the label).
//   * mergeConfig preserves the prior snsRoot too (discarding the incoming one);
//     upsertCanisterFor's verification outcome then overrides it, making that
//     verification the only effective writer of the stamp.
module {
  public type TopUpDecision = { #remove; #topUp : Nat; #skip };

  // The single three-way suspension/threshold branch used by both the
  // single-canister check and the batch sweep. `now` is ns-since-epoch.
  public func classifyForTopUp(cfg : Types.CanisterConfig, cycles : Nat, now : Nat) : TopUpDecision {
    switch (cfg.suspendedUntil) {
      case (?deadline) { if (now > deadline) { #remove } else { #skip } };
      case null {
        if (cycles < cfg.minCycleBalance) { #topUp(cfg.cycleTopUpAmount) } else { #skip };
      };
    };
  };

  // upsert preserves any existing suspension and discards the incoming field —
  // `setCanisterSuspended` is the only path that mutates `suspendedUntil`. The
  // `nickname` is the opposite: it takes the incoming value, so editing a
  // canister can rename it (and clear it by sending null). `snsRoot` behaves
  // like suspension: preserved from prior, discarded from incoming — the
  // verification step in upsertCanisterFor is the only writer.
  public func mergeConfig(prior : ?Types.CanisterConfig, incoming : Types.CanisterConfig) : Types.CanisterConfig {
    let preserved : ?Nat = switch (prior) { case null { null }; case (?p) { p.suspendedUntil } };
    let priorRoot : ?Principal = switch (prior) { case null { null }; case (?p) { p.snsRoot } };
    {
      minCycleBalance = incoming.minCycleBalance;
      cycleTopUpAmount = incoming.cycleTopUpAmount;
      suspendedUntil = preserved;
      nickname = incoming.nickname;
      snsRoot = priorRoot;
    };
  };

  // The user-tracked-SNS cascade selection: ids of entries stamped with `root`.
  public func stampedWith(entries : [(Principal, Types.CanisterConfig)], root : Principal) : [Principal] {
    let acc = List.empty<Principal>();
    for ((id, cfg) in entries.vals()) {
      if (cfg.snsRoot == ?root) { acc.add(id) };
    };
    acc.toArray();
  };
}
