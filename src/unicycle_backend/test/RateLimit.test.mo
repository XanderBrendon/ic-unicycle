import { test } "mo:test";
import Principal "mo:core/Principal";
import List "mo:core/List";
import RateLimit "../lib/RateLimit";

let MIN : Nat = 60_000_000_000;
let A = Principal.fromText("aaaaa-aa");
let B = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let C = Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai");

// Replay a sequence of (canisterId, atNs) checks through `register`, threading
// the accepted list forward (as main.mo does). Reports the final list + denials.
func replay(events : [(Principal, Nat)]) : { kept : [RateLimit.Check]; denied : Nat } {
  var acc : [RateLimit.Check] = [];
  var denied = 0;
  for ((c, at) in events.vals()) {
    switch (RateLimit.register(acc, c, at)) {
      case (#ok next) { acc := next };
      case (#denied) { denied += 1 };
    };
  };
  { kept = acc; denied };
};

// 20 checks that never trip the 5-min per-canister cap (two canisters, each hit
// 6 min apart) landing in [0, 57min] — i.e. the per-hour account budget, used up.
func twentyInTheHour() : List.List<(Principal, Nat)> {
  let evts = List.empty<(Principal, Nat)>();
  var i = 0;
  while (i < 10) {
    evts.add((A, i * 6 * MIN));
    evts.add((B, i * 6 * MIN + 3 * MIN));
    i += 1;
  };
  evts;
};

test("first check is always allowed", func() {
  switch (RateLimit.register([], A, 0)) {
    case (#ok next) { assert next.size() == 1 };
    case (#denied) { assert false };
  };
});

test("third check on the same canister within 5 min is denied", func() {
  let r = replay([(A, 0), (A, MIN), (A, 2 * MIN)]);
  assert r.denied == 1;
  assert r.kept.size() == 2;
});

test("same canister is allowed again once the 5-min window passes", func() {
  assert replay([(A, 0), (A, MIN), (A, 4 * MIN)]).denied == 1;
  let r = replay([(A, 0), (A, MIN), (A, 6 * MIN)]);
  assert r.denied == 0;
  assert r.kept.size() == 3;
});

test("the per-canister cap is independent per canister", func() {
  let r = replay([(A, 0), (A, MIN), (B, 0), (B, MIN)]);
  assert r.denied == 0;
  assert r.kept.size() == 4;
});

test("21st check across the account within an hour is denied", func() {
  let evts = twentyInTheHour();
  evts.add((C, 58 * MIN)); // fresh canister, so only the account cap can block it
  let r = replay(evts.toArray());
  assert r.denied == 1;
  assert r.kept.size() == 20;
});

test("account window slides — checks older than an hour are pruned and stop counting", func() {
  let evts = twentyInTheHour();
  evts.add((C, 61 * MIN)); // floor = 1min, so the t0 entry drops out -> 19 in window
  let r = replay(evts.toArray());
  assert r.denied == 0;
});
