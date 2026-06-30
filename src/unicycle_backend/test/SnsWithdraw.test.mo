import { test } "mo:test";
import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
import Nat8 "mo:core/Nat8";
import SnsWithdraw "../lib/SnsWithdraw";

let gov = Principal.fromText("fi3zi-fyaaa-aaaaq-aachq-cai");
let other = Principal.fromText("aaaaa-aa");
let zeros32 : Blob = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) { 0 : Nat8 }));

func isNull(s : ?Blob) : Bool { switch (s) { case null { true }; case (?_) { false } } };

test("ICP ignores configured destination -> treasury (governance default)", func() {
  let d = SnsWithdraw.resolveDestination(#ICP, ?{ owner = other; subaccount = null }, gov);
  assert Principal.equal(d.owner, gov);
  assert isNull(d.subaccount);
});

test("non-ICP unset -> governance default", func() {
  let d = SnsWithdraw.resolveDestination(#TCYCLES, null, gov);
  assert Principal.equal(d.owner, gov);
  assert isNull(d.subaccount);
});

test("non-ICP set -> configured verbatim", func() {
  let d = SnsWithdraw.resolveDestination(#TCYCLES, ?{ owner = other; subaccount = null }, gov);
  assert Principal.equal(d.owner, other);
});

test("isMintingAccount: owner + null subaccount matches", func() {
  assert SnsWithdraw.isMintingAccount({ owner = gov; subaccount = null }, ?{ owner = gov; subaccount = null });
});

test("isMintingAccount: zero subaccount normalizes to null and matches", func() {
  assert SnsWithdraw.isMintingAccount({ owner = gov; subaccount = ?zeros32 }, ?{ owner = gov; subaccount = null });
});

test("isMintingAccount: different owner does not match", func() {
  assert not SnsWithdraw.isMintingAccount({ owner = other; subaccount = null }, ?{ owner = gov; subaccount = null });
});

test("isMintingAccount: minting null (cycles ledger) never matches", func() {
  assert not SnsWithdraw.isMintingAccount({ owner = gov; subaccount = null }, null);
});
