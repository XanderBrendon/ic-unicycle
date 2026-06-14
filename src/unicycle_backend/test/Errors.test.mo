import { test } "mo:test";
import Text "mo:core/Text";
import Errors "../lib/Errors";

test("withdraw error messages render", func() {
  assert Errors.withdraw(#TooOld) == "withdraw too old";
  assert Errors.withdraw(#TemporarilyUnavailable) == "cycles ledger temporarily unavailable";
  assert Text.contains(Errors.withdraw(#InsufficientFunds { balance = 42 }), #text "42");
  assert Text.contains(Errors.withdraw(#GenericError { message = "boom"; error_code = 7 }), #text "boom");
});

test("pool error messages prepend context", func() {
  assert Errors.pool(#CommonError, "swap") == "swap: pool common error";
  assert Errors.pool(#InsufficientFunds, "mint") == "mint: insufficient pool funds";
  assert Errors.pool(#InternalError "x", "quote") == "quote: x";
  assert Errors.pool(#UnsupportedToken "ICP", "deposit") == "deposit: unsupported token ICP";
});
