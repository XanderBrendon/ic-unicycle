import { test } "mo:test";
import History "../lib/History";

func ok(t : Nat, b : Nat) : { recordedAt : Nat; result : { #ok : Nat; #err : Text } } { { recordedAt = t; result = #ok b } };
func er(t : Nat) : { recordedAt : Nat; result : { #ok : Nat; #err : Text } } { { recordedAt = t; result = #err "x" } };

test("prependCapped puts entry first and caps to max", func() {
  let r = History.prependCapped<Nat>([2, 3], 1, 3);
  assert r == [1, 2, 3];
  let capped = History.prependCapped<Nat>([2, 3, 4], 1, 3);
  assert capped == [1, 2, 3];
  let under = History.prependCapped<Nat>([], 1, 3);
  assert under == [1];
});

test("okBal", func() {
  assert History.okBal(ok(0, 99)) == 99;
  assert History.okBal(er(0)) == 0;
});

test("latestOk = first #ok (newest-first)", func() {
  switch (History.latestOk([er(10), ok(9, 50), ok(8, 40)])) { case (?r) { assert History.okBal(r) == 50 }; case null { assert false } };
  assert History.latestOk([er(1)]) == null;
});

test("oldestOkSince = last in-window #ok", func() {
  let rs = [ok(100, 5), ok(90, 6), ok(50, 7), ok(10, 8)];
  switch (History.oldestOkSince(rs, 80)) { case (?r) { assert r.recordedAt == 90 }; case null { assert false } };
  switch (History.oldestOkSince(rs, 0)) { case (?r) { assert r.recordedAt == 10 }; case null { assert false } };
});

test("recentOk returns up to n newest #ok", func() {
  let rs = [ok(5, 1), er(4), ok(3, 2), ok(2, 3), ok(1, 4)];
  let got = History.recentOk(rs, 3);
  assert got.size() == 3;
  assert got[0].recordedAt == 5 and got[1].recordedAt == 3 and got[2].recordedAt == 2;
});

test("postTopUpBalance = latest #ok balance + delivered amount", func() {
  assert History.postTopUpBalance([ok(9, 50), ok(8, 40)], 30) == ?80;
  // skips a leading #err to anchor on the newest #ok
  assert History.postTopUpBalance([er(10), ok(9, 50)], 30) == ?80;
  // no #ok reading to anchor the absolute balance → null
  assert History.postTopUpBalance([er(1)], 30) == null;
  assert History.postTopUpBalance([], 30) == null;
});
