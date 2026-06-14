// Local stub for the NNS SNS-Wasm registry (US21). Exists purely so the
// backend's governance→root resolution can be exercised against a fresh local
// replica; mainnet deploys point the backend at the real SNS-Wasm canister
// (`qaa6y-5yaaa-aaaaa-aaafa-cai`) and never load this canister.
//
// `list_deployed_snses` returns a seedable in-memory list of instances, each
// carrying the `governance_canister_id` / `root_canister_id` pair the backend
// reads. The real registry also returns ledger/swap/index ids, which the
// backend drops via Candid record subtyping — the stub omits them. Seed a
// governance→root mapping with the `addSns` helper (mirrors the icpswap stub's
// `bootstrapTcycles` test-fixture role); mainnet never invokes it.

import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Iter "mo:core/Iter";

persistent actor class SnsWasmStub() = self {

  public type DeployedSns = {
    root_canister_id : ?Principal;
    governance_canister_id : ?Principal;
  };

  // governance → root, seeded via addSns.
  let snses : Map.Map<Principal, Principal> = Map.empty();

  public query func list_deployed_snses(_ : {}) : async {
    instances : [DeployedSns];
  } {
    let instances = snses.entries().map(
      func((gov, root)) : DeployedSns {
        { governance_canister_id = ?gov; root_canister_id = ?root };
      }
    ).toArray();
    { instances };
  };

  // Diagnostic — seed a governance→root mapping so the backend can resolve an
  // SNS locally. Mirrors the icpswap stub's bootstrap helpers; mainnet never
  // invokes it (the real registry is populated by NNS SNS launches).
  public func addSns(governance : Principal, root : Principal) : async () {
    snses.add(governance, root);
  };
};
