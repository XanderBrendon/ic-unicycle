import Types "../types";
import List "mo:core/List";

// Pure helpers over an SNS root's `list_sns_canisters` response
// (user-tracked SNS verification — see upsertCanisterFor's fallback).
module {
  // Every canister id in the response: singletons (root, governance, ledger,
  // swap, index), then dapps and archives. Extension canisters are
  // deliberately excluded (they are not even typed on the response): the
  // reading path (`get_sns_canisters_summary`) has no extensions slot, so an
  // extension canister could be verified but never read/topped up — keeping
  // the verification surface equal to the reading surface.
  public func ids(res : Types.SnsListCanistersResponse) : [Principal] {
    let acc = List.empty<Principal>();
    for (opt in [res.root, res.governance, res.ledger, res.swap, res.index].vals()) {
      switch (opt) { case (?p) { acc.add(p) }; case null {} };
    };
    for (p in res.dapps.vals()) { acc.add(p) };
    for (p in res.archives.vals()) { acc.add(p) };
    acc.toArray();
  };

  public func contains(res : Types.SnsListCanistersResponse, id : Principal) : Bool {
    for (p in ids(res).vals()) { if (p == id) return true };
    false;
  };
}
