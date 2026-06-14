import Types "../types";
import Nat "mo:core/Nat";

// Loyalty-rebate accumulated-reward-per-share math (US18). Pure transitions over
// a LoyaltyAccount = { shares; rewardDebt; accrued }.
//
// INVARIANTS:
//  - The reward accumulator `acc` is monotonically non-decreasing (only `advance`
//    raises it), so `shares * acc / ACC_PRECISION >= rewardDebt` always holds. Every
//    `entitled - rewardDebt` and `shares*acc/PREC - rewardDebt` subtraction below is
//    therefore trap-free.
//  - `rebate = min(accrued, grossFee) <= accrued`, so `reserveRebate` never underflows.
//  - A user's `shares` only ever grows, by exactly the NET fee charged (`onChargeSuccess`).
//  - `rewardDebt` is re-checkpointed to `shares * acc / ACC_PRECISION` whenever shares or
//    the checkpoint move (`settle`, `onChargeSuccess`), so banked reward is never double-counted.
module {
  public let ACC_PRECISION : Nat = 1_000_000_000_000_000_000; // 1e18 — accumulator scale

  public func empty() : Types.LoyaltyAccount { { shares = 0; rewardDebt = 0; accrued = 0 } };

  // Reward accrued since the last checkpoint (>= 0 by the monotonic-acc invariant).
  public func pendingReward(a : Types.LoyaltyAccount, acc : Nat) : Nat {
    (a.shares * acc / ACC_PRECISION) - a.rewardDebt : Nat;
  };

  // Bank pendingReward into `accrued`, re-checkpoint `rewardDebt = entitled`; shares unchanged.
  // Idempotent at a fixed `acc` (a second call banks 0).
  public func settle(a : Types.LoyaltyAccount, acc : Nat) : Types.LoyaltyAccount {
    let entitled = a.shares * acc / ACC_PRECISION;
    let pending = entitled - a.rewardDebt : Nat;
    { a with accrued = a.accrued + pending; rewardDebt = entitled };
  };

  // The rebate a gross fee can claim from this account's settled credit.
  public func rebateFor(a : Types.LoyaltyAccount, grossFee : Nat) : Nat {
    Nat.min(a.accrued, grossFee);
  };

  // Spend the rebate from `accrued` BEFORE the caller's await — the double-spend /
  // underflow guard (a concurrent charge for the same owner then sees the reduced credit).
  public func reserveRebate(a : Types.LoyaltyAccount, rebate : Nat) : Types.LoyaltyAccount {
    { a with accrued = a.accrued - rebate : Nat };
  };

  // On a successful charge: grow `shares` by the net fee and re-checkpoint `rewardDebt`.
  // `accrued` is carried as-is (the rebate was already reserved).
  public func onChargeSuccess(a : Types.LoyaltyAccount, acc : Nat, net : Nat) : Types.LoyaltyAccount {
    let newShares = a.shares + net;
    { shares = newShares; accrued = a.accrued; rewardDebt = newShares * acc / ACC_PRECISION };
  };

  // Restore the reserved rebate when the charge failed.
  public func unreserveRebate(a : Types.LoyaltyAccount, rebate : Nat) : Types.LoyaltyAccount {
    { a with accrued = a.accrued + rebate };
  };

  // Advance the global accumulator by a harvested surplus spread over the total shares.
  public func advance(acc : Nat, surplus : Nat, totalShares : Nat) : Nat {
    acc + surplus * ACC_PRECISION / totalShares;
  };
}
