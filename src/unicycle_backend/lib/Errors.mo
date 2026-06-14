import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import CyclesLedger "../cycles_ledger";
import Types "../types";

// Human-readable formatting for cycles-ledger withdraw errors and ICPSwap pool
// errors. INVARIANT: pure and total over every error variant; the message
// strings are a UI/audit surface and are kept byte-identical to main.mo's output.

module {
  public func withdraw(err : CyclesLedger.WithdrawError) : Text {
    switch (err) {
      case (#InsufficientFunds { balance }) {
        "insufficient deposited tcycles (balance: " # balance.toText() # ")";
      };
      case (#BadFee { expected_fee }) {
        "bad fee (expected: " # expected_fee.toText() # ")";
      };
      case (#InvalidReceiver { receiver }) {
        "invalid receiver: " # receiver.toText();
      };
      case (#TooOld) { "withdraw too old" };
      case (#CreatedInFuture { ledger_time }) {
        "created in future (ledger time: " # ledger_time.toText() # ")";
      };
      case (#Duplicate { duplicate_of }) {
        "duplicate of block " # duplicate_of.toText();
      };
      case (#TemporarilyUnavailable) { "cycles ledger temporarily unavailable" };
      case (#FailedToWithdraw failure) {
        "withdraw failed: " # failure.rejection_reason;
      };
      case (#GenericError { message; error_code }) {
        "generic error (" # error_code.toText() # "): " # message;
      };
    };
  };

  public func pool(err : Types.IcpSwapPoolError, context : Text) : Text {
    switch (err) {
      case (#CommonError) { context # ": pool common error" };
      case (#InternalError msg) { context # ": " # msg };
      case (#UnsupportedToken t) { context # ": unsupported token " # t };
      case (#InsufficientFunds) { context # ": insufficient pool funds" };
    };
  };
}
