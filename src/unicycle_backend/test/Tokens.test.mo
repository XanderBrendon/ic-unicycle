import { test } "mo:test";
import Principal "mo:core/Principal";
import Tokens "../lib/Tokens";

test("ledger canister ids are the canonical system ledgers", func() {
  assert Principal.toText(Tokens.ledgerCanisterId(#ICP)) == "ryjl3-tyaaa-aaaaa-aaaba-cai";
  assert Principal.toText(Tokens.ledgerCanisterId(#TCYCLES)) == "um5iw-rqaaa-aaaaq-qaaba-cai";
});

test("token labels", func() {
  assert Tokens.toText(#ICP) == "ICP";
  assert Tokens.toText(#TCYCLES) == "TCYCLES";
});
