import { test } "mo:test";
import SwapMath "../lib/SwapMath";

test("proportionalShare floors; group==0 -> 0", func() {
  assert SwapMath.proportionalShare(100, 30, 100) == 30;
  assert SwapMath.proportionalShare(100, 1, 3) == 33;
  assert SwapMath.proportionalShare(100, 1, 0) == 0;
});

test("overPurchaseTarget = groupDemand*110/100 + n*fee", func() {
  assert SwapMath.overPurchaseTarget(1_000, 3, 10) == 1_100 + 30;
});

test("quoteInvert = seed*target/quoted", func() {
  assert SwapMath.quoteInvert(10, 1_000, 100) == 100;
});

test("expectedTcyclesOut = amountIcpE8s * xpe", func() {
  assert SwapMath.expectedTcyclesOut(100_000_000, 4_000) == 400_000_000_000;
});

test("expectedIcpOut = tcyclesIn / xpe; xpe==0 -> 0", func() {
  assert SwapMath.expectedIcpOut(400_000_000_000, 4_000) == 100_000_000;
  assert SwapMath.expectedIcpOut(123, 0) == 0;
});

test("slippageFloor keeps (1 - bps/10_000); >=10_000 -> 0", func() {
  assert SwapMath.slippageFloor(1_000_000, 300) == 970_000; // 3% off
  assert SwapMath.slippageFloor(1_000_000, 0) == 1_000_000; // no haircut
  assert SwapMath.slippageFloor(1_000_000, 10_000) == 0; // trap-free at the edge
  assert SwapMath.slippageFloor(1_000_000, 20_000) == 0; // and beyond
});

test("mintIcpNeeded ceil-divides; xpe==0 -> 0", func() {
  assert SwapMath.mintIcpNeeded(100, 10) == 10;
  assert SwapMath.mintIcpNeeded(101, 10) == 11;
  assert SwapMath.mintIcpNeeded(100, 0) == 0;
});

test("chooseRoute: both ok -> mint iff xpe*in > target (strict)", func() {
  switch (SwapMath.chooseRoute(#ok 10, #ok 11, 100)) { case (#mint x) { assert x == 11 }; case _ { assert false } };
  switch (SwapMath.chooseRoute(#ok 10, #ok 10, 100)) { case (#swap) {}; case _ { assert false } };
});

test("chooseRoute: pool err + rate ok -> mint iff xpe>0 else none", func() {
  switch (SwapMath.chooseRoute(#err "down", #ok 5, 100)) { case (#mint x) { assert x == 5 }; case _ { assert false } };
  switch (SwapMath.chooseRoute(#err "down", #ok 0, 100)) { case (#none _) {}; case _ { assert false } };
});

test("chooseRoute: rate err + pool ok -> swap; both err -> none", func() {
  switch (SwapMath.chooseRoute(#ok 10, #err "cmc", 100)) { case (#swap) {}; case _ { assert false } };
  switch (SwapMath.chooseRoute(#err "p", #err "c", 100)) { case (#none _) {}; case _ { assert false } };
});

test("splitWithRemainder sums to total; last absorbs remainder", func() {
  let s = SwapMath.splitWithRemainder([1, 1, 1], 100);
  assert s.size() == 3;
  assert s[0] + s[1] + s[2] == 100;
  assert s[2] == 100 - s[0] - s[1];
  assert SwapMath.splitWithRemainder([], 100) == [];
  let z = SwapMath.splitWithRemainder([0, 0], 50);
  assert z[0] == 0 and z[1] == 50;
});

test("serviceFee = amount*bps/10000; bps==0 -> 0", func() {
  assert SwapMath.serviceFee(1_000_000, 1_000) == 100_000;
  assert SwapMath.serviceFee(1_000_000, 0) == 0;
});

test("directTopUpNeeded = amount + fee + 2*ledgerFee; deficit saturates", func() {
  assert SwapMath.directTopUpNeeded(100, 5, 10) == 100 + 5 + 20;
  assert SwapMath.deficit(125, 100) == 25;
  assert SwapMath.deficit(50, 100) == 0;
});
