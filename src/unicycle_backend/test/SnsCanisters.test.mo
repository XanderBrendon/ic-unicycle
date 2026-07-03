import { test } "mo:test";
import Principal "mo:core/Principal";
import SnsCanisters "../lib/SnsCanisters";

let root = Principal.fromText("ibahq-taaaa-aaaaq-aadna-cai");
let gov = Principal.fromText("igbbe-6yaaa-aaaaq-aadnq-cai");
let ledger = Principal.fromText("itgqj-7qaaa-aaaaq-aadoa-cai");
let dapp = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
// An extension canister is intentionally NOT part of the verification surface:
// the reading path (`get_sns_canisters_summary`) can never report its cycles,
// so `list_sns_canisters` extensions are excluded and a stand-in id must not be
// contained by the response.
let ext = Principal.fromText("mxzaz-hqaaa-aaaar-qaada-cai");
let stranger = Principal.fromText("2jvtu-yqaaa-aaaaq-aaama-cai");

let full = {
  root = ?root;
  governance = ?gov;
  ledger = ?ledger;
  swap = null : ?Principal;
  index = null : ?Principal;
  dapps = [dapp];
  archives = [] : [Principal];
};

test("ids collects singletons and groups; skips nulls", func() {
  assert SnsCanisters.ids(full) == [root, gov, ledger, dapp];
});

test("contains finds members across all slots", func() {
  assert SnsCanisters.contains(full, root);
  assert SnsCanisters.contains(full, dapp);
  assert not SnsCanisters.contains(full, stranger);
});

test("extension canisters are not part of the surface", func() {
  // `ext` stands in for an SNS extension canister — excluded on purpose so the
  // verification surface equals the reading surface.
  assert not SnsCanisters.contains(full, ext);
});

test("all-empty response contains nothing", func() {
  let empty = {
    root = null : ?Principal; governance = null : ?Principal;
    ledger = null : ?Principal; swap = null : ?Principal; index = null : ?Principal;
    dapps = [] : [Principal]; archives = [] : [Principal];
  };
  assert SnsCanisters.ids(empty) == [];
  assert not SnsCanisters.contains(empty, root);
});
