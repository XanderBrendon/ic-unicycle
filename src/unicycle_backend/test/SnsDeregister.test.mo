import { test } "mo:test";
import Principal "mo:core/Principal";
import SnsDeregister "../lib/SnsDeregister";
import Types "../types";

let backend = Principal.fromText("2ccdl-vaaaa-aaaan-q6h5a-cai");
let other = Principal.fromText("aaaaa-aa");
let known = ["snsWithdraw", "snsSetup", "snsDeregister"];

func generic(id : Nat64, target : ?Principal, method : ?Text) : Types.SnsNervousSystemFunction {
  {
    id;
    name = "fn";
    description = null;
    function_type = ?#GenericNervousSystemFunction({
      target_canister_id = target;
      target_method_name = method;
      validator_canister_id = target;
      validator_method_name = null;
      topic = ?#ApplicationBusinessLogic;
    });
  };
};

func native(id : Nat64) : Types.SnsNervousSystemFunction {
  { id; name = "native"; description = null; function_type = null };
};

test("functionsToRemove: keeps backend-targeted known methods, with method names", func() {
  let fns = [
    generic(1000, ?backend, ?"snsWithdraw"),
    generic(2000, ?backend, ?"snsSetup"),
    generic(1012, ?backend, ?"snsDeregister"),
  ];
  let got = SnsDeregister.functionsToRemove(fns, backend, known);
  assert got == ([(1_000, "snsWithdraw"), (2_000, "snsSetup"), (1_012, "snsDeregister")] : [(Nat64, Text)]);
});

test("functionsToRemove: excludes native, foreign-target, unknown-method, no-method", func() {
  let fns = [
    native(999),
    generic(1000, ?backend, ?"snsWithdraw"),   // kept
    generic(1500, ?other, ?"snsWithdraw"),     // foreign target -> excluded
    generic(1600, ?backend, ?"somethingElse"), // unknown method -> excluded
    generic(1700, ?backend, null),             // no method -> excluded
  ];
  let got = SnsDeregister.functionsToRemove(fns, backend, known);
  assert got == ([(1_000, "snsWithdraw")] : [(Nat64, Text)]);
});

test("functionsToRemove: empty input -> empty", func() {
  let got = SnsDeregister.functionsToRemove([], backend, known);
  assert got == ([] : [(Nat64, Text)]);
});

test("drainAmount: balance above fee -> balance - fee", func() {
  assert SnsDeregister.drainAmount(1_000_000, 10_000) == ?(990_000 : Nat);
});

test("drainAmount: balance equal to fee -> null", func() {
  assert SnsDeregister.drainAmount(10_000, 10_000) == null;
});

test("drainAmount: balance below fee -> null", func() {
  assert SnsDeregister.drainAmount(5_000, 10_000) == null;
});

test("drainAmount: zero balance -> null", func() {
  assert SnsDeregister.drainAmount(0, 10_000) == null;
});
