import { test } "mo:test";
import Tunables "../lib/Tunables";

let specs : [Tunables.Spec] = [
  { key = "alpha"; defaultValue = 100; min = 10; max = 1_000 },
  { key = "beta"; defaultValue = 5; min = 0; max = 50 },
];

test("find returns the matching spec", func() {
  switch (Tunables.find(specs, "beta")) {
    case (?s) { assert s.defaultValue == 5 };
    case null { assert false };
  };
});

test("find returns null for an unknown key", func() {
  switch (Tunables.find(specs, "gamma")) { case null {}; case (?_) { assert false } };
});

test("validate accepts a value inside the bounds", func() {
  switch (Tunables.validate(specs, "alpha", 500)) { case (#ok _) {}; case (#err _) { assert false } };
});

test("validate accepts the bounds themselves", func() {
  switch (Tunables.validate(specs, "alpha", 10)) { case (#ok _) {}; case (#err _) { assert false } };
  switch (Tunables.validate(specs, "alpha", 1_000)) { case (#ok _) {}; case (#err _) { assert false } };
});

test("validate rejects an unknown key", func() {
  switch (Tunables.validate(specs, "gamma", 1)) { case (#err _) {}; case (#ok _) { assert false } };
});

test("validate rejects below min", func() {
  switch (Tunables.validate(specs, "alpha", 9)) { case (#err _) {}; case (#ok _) { assert false } };
});

test("validate rejects above max", func() {
  switch (Tunables.validate(specs, "alpha", 1_001)) { case (#err _) {}; case (#ok _) { assert false } };
});

// A zero min is meaningful — the ledger-fee tunables allow a zero-fee ledger.
test("validate accepts zero when min is zero", func() {
  switch (Tunables.validate(specs, "beta", 0)) { case (#ok _) {}; case (#err _) { assert false } };
});

test("info reports the default when there is no override", func() {
  let i = Tunables.info(specs[0], null);
  assert i.value == 100;
  assert i.defaultValue == 100;
  assert i.overridden == false;
});

test("info reports the override when one is set", func() {
  let i = Tunables.info(specs[0], ?250);
  assert i.value == 250;
  assert i.defaultValue == 100;
  assert i.overridden == true;
});
