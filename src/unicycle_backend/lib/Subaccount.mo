import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
import Nat8 "mo:core/Nat8";

module {
  // INVARIANT: 1-byte length prefix + principal bytes, zero-padded to 32 bytes.
  // SYNC-BINDING: byte-identical to the TS twin
  // src/unicycle_frontend/src/wallet/depositAccount.ts. Forever-stable on-chain
  // identifier — any change must land in BOTH files in the SAME commit.
  public func ofPrincipal(p : Principal) : Blob {
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

  // 32 zero bytes — the ICRC-1 default subaccount (== subaccount = null).
  // Written as a literal because a module-level `Array.tabulate` is not a
  // static expression (M0014).
  public let DEFAULT : Blob = "\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00\00";
}
