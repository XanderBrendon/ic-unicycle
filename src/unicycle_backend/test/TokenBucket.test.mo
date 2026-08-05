import { test } "mo:test";
import TokenBucket "../lib/TokenBucket";

let CAP : Nat = 5;
let IVL : Nat = 1_000; // ns per token

// Consume `n` tokens at a fixed `now`, threading the bucket; return (bucket, grants).
func drain(b : TokenBucket.Bucket, n : Nat, now : Nat) : (TokenBucket.Bucket, Nat) {
  var cur = b;
  var grants = 0;
  var i = 0;
  while (i < n) {
    let (next, ok) = TokenBucket.tryConsume(cur, CAP, IVL, now);
    cur := next;
    if (ok) { grants += 1 };
    i += 1;
  };
  (cur, grants);
};

test("a fresh bucket starts full", func() {
  let (_b, granted) = drain(TokenBucket.init(CAP), CAP, 0);
  assert granted == CAP;
});

test("the (capacity+1)-th call at the same instant is denied", func() {
  let (b, granted) = drain(TokenBucket.init(CAP), CAP, 0);
  assert granted == CAP;
  let (_b2, ok) = TokenBucket.tryConsume(b, CAP, IVL, 0);
  assert not ok;
});

test("one token regenerates per refill interval", func() {
  let (b, _g) = drain(TokenBucket.init(CAP), CAP, 0); // empty at now=0
  let (_b2, ok) = TokenBucket.tryConsume(b, CAP, IVL, IVL); // one interval later
  assert ok;
});

test("refill is capped at capacity after a long idle", func() {
  let (b, _g) = drain(TokenBucket.init(CAP), CAP, 0); // empty
  let (_b2, granted) = drain(b, CAP + 2, 1_000_000); // huge gap, then over-ask
  assert granted == CAP; // never more than capacity
});

test("sub-interval time is carried forward, not discarded", func() {
  let (b0, _g) = drain(TokenBucket.init(CAP), CAP, 0); // empty at t=0
  let (b1, ok1) = TokenBucket.tryConsume(b0, CAP, IVL, 1_500); // 1.5 ivl -> exactly 1 token
  assert ok1;
  // lastRefill advanced to 1000 (not 1500), so 1000ns more reaches the next
  // token. Were the remainder discarded, this call would be denied.
  let (_b2, ok2) = TokenBucket.tryConsume(b1, CAP, IVL, 2_000);
  assert ok2;
});

test("tryConsumeN: spends n tokens when all n are available", func() {
  let (b, granted) = TokenBucket.tryConsumeN(TokenBucket.init(CAP), CAP, IVL, 0, 4);
  assert granted;
  assert b.tokens == CAP - 4;
});

test("tryConsumeN: all-or-nothing — a short bucket spends nothing", func() {
  // Drain to 3, then ask for 4.
  let (b0, _g) = drain(TokenBucket.init(CAP), 2, 0);
  assert b0.tokens == 3;
  let (b1, granted) = TokenBucket.tryConsumeN(b0, CAP, IVL, 0, 4);
  assert not granted;
  assert b1.tokens == 3; // untouched: a denied batch must not drain the bucket
});

test("tryConsumeN: refills before deciding", func() {
  let (b0, _g) = drain(TokenBucket.init(CAP), CAP, 0); // empty at t=0
  // 4 intervals later exactly 4 tokens exist, so a batch of 4 is affordable.
  let (b1, granted) = TokenBucket.tryConsumeN(b0, CAP, IVL, 4 * IVL, 4);
  assert granted;
  assert b1.tokens == 0;
});

test("tryConsume still spends exactly one", func() {
  let (b, granted) = TokenBucket.tryConsume(TokenBucket.init(CAP), CAP, IVL, 0);
  assert granted;
  assert b.tokens == CAP - 1;
});
