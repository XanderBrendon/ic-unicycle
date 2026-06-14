// Local stub for the NNS Cycles Minting Canister (US30). Exists purely so the
// direct-mint saga can be exercised end-to-end against a fresh local replica;
// mainnet deploys point the backend at the real CMC
// (`rkp4c-7iaaa-aaaaa-aaaca-cai`) and never load this canister.
//
// Surface is the narrow subset the backend's mint path uses:
//   * get_icp_xdr_conversion_rate — the flat ICP→cycles rate (cycles per e8s,
//     i.e. `xdr_permyriad_per_icp`). Default `120_000` = 12 T/ICP, above the
//     icpswap stub's 10 T/ICP, so the rate gate routes to mint by default.
//     `setRate` flips it: below `100_000` (10 T/ICP) the gate prefers swap.
//   * notify_top_up — reads the ICP the backend transferred into this canister's
//     top-up subaccount (`principalToSubaccount(canister_id)`), mints
//     `balance · rate` raw cycles into `canister_id` via the management
//     canister's `deposit_cycles`, and clears the subaccount so a re-notify
//     can't double-mint. The stub does NOT validate the supplied `block_index`
//     or the transfer memo — a fixture only needs to mint proportionally to the
//     ICP it received.
//
// Mints draw from this canister's own raw cycle balance, so local setup
// pre-funds it (`devscripts/seed-cmc-stub.sh`, an `icp canister top-up`), the
// same way `vendor/icpswap/icpswap_pool_stub.mo` is seeded. Excluded from the
// `production` environment in icp.yaml.

import Principal "mo:core/Principal";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Error "mo:core/Error";
import ICRC1 "../../src/unicycle_backend/icrc1";

persistent actor class CmcStub() = self {

  // Canonical ICP ledger id — the same constant the backend resolves for #ICP.
  let ICP_LEDGER : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  let ICP_LEDGER_FEE : Nat = 10_000;

  // cycles per ICP e8s == xdr_permyriad_per_icp (see the backend's
  // cmcCyclesPerE8s identity). Default 120_000 = 12 T/ICP.
  var rate : Nat64 = 120_000;

  // Subaccount derivation: identical scheme to the backend's
  // `principalToSubaccount`, so this stub reads the exact top-up subaccount the
  // backend transferred ICP into.
  func principalToSubaccount(p : Principal) : Blob {
    let principalBytes = p.toBlob().toArray();
    let length = principalBytes.size();
    let subaccount = Array.tabulate<Nat8>(
      32,
      func(i) {
        if (i == 0) { Nat8.fromNat(length) } else if (i <= length) {
          principalBytes[i - 1];
        } else { 0 };
      },
    );
    Blob.fromArray(subaccount);
  };

  // The flat ICP→cycles conversion rate. Only the `data` record is read by the
  // backend; the real CMC's certificate / hash_tree fields are dropped on
  // decode by Candid record subtyping, so the stub omits them.
  public query func get_icp_xdr_conversion_rate() : async {
    data : { xdr_permyriad_per_icp : Nat64; timestamp_seconds : Nat64 };
  } {
    { data = { xdr_permyriad_per_icp = rate; timestamp_seconds = 0 } };
  };

  // Diagnostic — flip the gate without a code edit. Mirrors the icpswap stub's
  // fixed-rate test-fixture role; mainnet never invokes it.
  public func setRate(r : Nat64) : async () { rate := r };

  public shared func notify_top_up(args : { block_index : Nat64; canister_id : Principal }) : async {
    #Ok : Nat;
    #Err : {
      #Refunded : { block_index : ?Nat64; reason : Text };
      #Processing;
      #TransactionTooOld : Nat64;
      #InvalidTransaction : Text;
      #Other : { error_code : Nat64; error_message : Text };
    };
  } {
    let icpLedger : ICRC1.Self = actor (ICP_LEDGER);
    let sub = principalToSubaccount(args.canister_id);
    let balance = try {
      await icpLedger.icrc1_balance_of({
        owner = Principal.fromActor(self);
        subaccount = ?sub;
      });
    } catch (e) {
      return #Err(#Other { error_code = 1; error_message = "icp ledger unreachable: " # Error.message(e) });
    };
    if (balance == 0) {
      return #Err(#InvalidTransaction("no ICP at top-up subaccount for " # Principal.toText(args.canister_id)));
    };
    let minted : Nat = balance * Nat64.toNat(rate);
    // Mint by depositing raw cycles into the target from this stub's balance.
    let mgmt : actor {
      deposit_cycles : shared ({ canister_id : Principal }) -> async ();
    } = actor ("aaaaa-aa");
    try {
      await (with cycles = minted) mgmt.deposit_cycles({ canister_id = args.canister_id });
    } catch (e) {
      return #Err(#Other { error_code = 2; error_message = "deposit_cycles failed: " # Error.message(e) });
    };
    // Clear the top-up subaccount (move it to this stub's default account) so a
    // re-notify can't double-mint. Best-effort — a failure here only leaves a
    // local fixture artifact.
    if (balance > ICP_LEDGER_FEE) {
      ignore try {
        await icpLedger.icrc1_transfer({
          from_subaccount = ?sub;
          to = { owner = Principal.fromActor(self); subaccount = null };
          amount = balance - ICP_LEDGER_FEE : Nat;
          fee = ?ICP_LEDGER_FEE;
          memo = null;
          created_at_time = null;
        });
      } catch (_) { #Err(#TemporarilyUnavailable) };
    };
    #Ok(minted);
  };
};
