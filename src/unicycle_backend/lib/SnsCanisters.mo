import Types "../types";
import List "mo:core/List";

// Pure helpers over an SNS root's `list_sns_canisters` response
// (user-tracked SNS verification — see upsertCanisterFor's fallback).
module {
  // Every canister id in the response: singletons (root, governance, ledger,
  // swap, index), then dapps, archives, and extension canisters.
  public func ids(res : Types.SnsListCanistersResponse) : [Principal] {
    let acc = List.empty<Principal>();
    for (opt in [res.root, res.governance, res.ledger, res.swap, res.index].vals()) {
      switch (opt) { case (?p) { acc.add(p) }; case null {} };
    };
    for (p in res.dapps.vals()) { acc.add(p) };
    for (p in res.archives.vals()) { acc.add(p) };
    switch (res.extensions) {
      case (?e) { for (p in e.extension_canister_ids.vals()) { acc.add(p) } };
      case null {};
    };
    acc.toArray();
  };

  public func contains(res : Types.SnsListCanistersResponse, id : Principal) : Bool {
    for (p in ids(res).vals()) { if (p == id) return true };
    false;
  };
}
