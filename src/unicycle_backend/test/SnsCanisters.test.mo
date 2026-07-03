import { test } "mo:test";
import Principal "mo:core/Principal";
import SnsCanisters "../lib/SnsCanisters";

let root = Principal.fromText("ibahq-taaaa-aaaaq-aadna-cai");
let gov = Principal.fromText("igbbe-6yaaa-aaaaq-aadnq-cai");
let ledger = Principal.fromText("itgqj-7qaaa-aaaaq-aadoa-cai");
let dapp = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
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
  extensions = ?{ extension_canister_ids = [ext] };
};

test("ids collects singletons, groups, and extensions; skips nulls", func() {
  assert SnsCanisters.ids(full) == [root, gov, ledger, dapp, ext];
});

test("contains finds members across all slots", func() {
  assert SnsCanisters.contains(full, root);
  assert SnsCanisters.contains(full, dapp);
  assert SnsCanisters.contains(full, ext);
  assert not SnsCanisters.contains(full, stranger);
});

test("all-empty response contains nothing", func() {
  let empty = {
    root = null : ?Principal; governance = null : ?Principal;
    ledger = null : ?Principal; swap = null : ?Principal; index = null : ?Principal;
    dapps = [] : [Principal]; archives = [] : [Principal];
    extensions = null : ?{ extension_canister_ids : [Principal] };
  };
  assert SnsCanisters.ids(empty) == [];
  assert not SnsCanisters.contains(empty, root);
});
