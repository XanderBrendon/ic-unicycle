import { test } "mo:test";
import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Nat8 "mo:core/Nat8";
import Subaccount "../lib/Subaccount";

// Mirror of the TS twin's algorithm (depositAccount.ts): subaccount[0]=length;
// set(principalBytes,1); rest 0. This is the byte-parity invariant.
func check(p : Principal) {
  let pbytes = Blob.toArray(Principal.toBlob(p));
  let sub = Blob.toArray(Subaccount.ofPrincipal(p));
  assert sub.size() == 32;
  assert sub[0] == Nat8.fromNat(pbytes.size());
  var i = 0;
  while (i < pbytes.size()) { assert sub[i + 1] == pbytes[i]; i += 1 };
  var j = pbytes.size() + 1;
  while (j < 32) { assert sub[j] == 0; j += 1 };
};

test("anonymous principal encodes as [1, 0x04, 0…]", func() {
  let sub = Blob.toArray(Subaccount.ofPrincipal(Principal.fromText("2vxsx-fae")));
  assert sub[0] == 1;
  assert sub[1] == 0x04;
  assert sub[2] == 0;
});

test("encoding matches the TS twin for varied principals", func() {
  check(Principal.fromText("2vxsx-fae"));
  check(Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"));
  check(Principal.fromText("um5iw-rqaaa-aaaaq-qaaba-cai"));
});

test("DEFAULT is 32 zero bytes", func() {
  let d = Blob.toArray(Subaccount.DEFAULT);
  assert d.size() == 32;
  for (b in d.vals()) { assert b == 0 };
});
