import { test } "mo:test";
import Loyalty "../lib/Loyalty";

let P = Loyalty.ACC_PRECISION;

test("empty account is zeroed", func() {
  let a = Loyalty.empty();
  assert a.shares == 0 and a.rewardDebt == 0 and a.accrued == 0;
});

test("pendingReward = shares*acc/PREC - rewardDebt", func() {
  let a = { shares = 1_000; rewardDebt = 0; accrued = 0 };
  assert Loyalty.pendingReward(a, P) == 1_000;
  assert Loyalty.pendingReward(a, 2 * P) == 2_000;
});

test("settle banks pending into accrued and re-checkpoints; idempotent at fixed acc", func() {
  let a0 = { shares = 1_000; rewardDebt = 0; accrued = 5 };
  let a1 = Loyalty.settle(a0, P);
  assert a1.accrued == 5 + 1_000;
  assert a1.rewardDebt == 1_000;
  assert a1.shares == 1_000;
  let a2 = Loyalty.settle(a1, P);
  assert a2.accrued == a1.accrued and a2.rewardDebt == a1.rewardDebt;
});

test("rebateFor = min(accrued, grossFee)", func() {
  assert Loyalty.rebateFor({ shares = 0; rewardDebt = 0; accrued = 30 }, 100) == 30;
  assert Loyalty.rebateFor({ shares = 0; rewardDebt = 0; accrued = 300 }, 100) == 100;
});

test("reserve then onChargeSuccess: shares += net, accrued reduced once, debt recheckpointed", func() {
  let a0 = { shares = 1_000; rewardDebt = 1_000; accrued = 40 };
  let rebate = Loyalty.rebateFor(a0, 100);
  let net = 100 - rebate;
  let reserved = Loyalty.reserveRebate(a0, rebate);
  assert reserved.accrued == 0;
  let done = Loyalty.onChargeSuccess(reserved, P, net);
  assert done.shares == 1_060;                 // 1_000 + net(60)
  assert done.accrued == 0;                    // rebate(40) reserved once, not re-added
  assert done.rewardDebt == 1_060;             // newShares * acc(P) / P == newShares
});

test("reserve then unreserve restores accrued on failure", func() {
  let a0 = { shares = 1_000; rewardDebt = 1_000; accrued = 40 };
  let reserved = Loyalty.reserveRebate(a0, 40);
  let restored = Loyalty.unreserveRebate(reserved, 40);
  assert restored.accrued == 40;
});

test("advance accumulator by surplus*PREC/totalShares", func() {
  assert Loyalty.advance(0, 500, 1_000) == 500 * P / 1_000;
  assert Loyalty.advance(P, 500, 1_000) == P + 500 * P / 1_000;
});
