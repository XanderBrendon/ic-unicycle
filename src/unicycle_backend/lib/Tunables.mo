import Nat "mo:core/Nat";
import Result "mo:core/Result";
import Types "../types";

// Runtime-overridable operational constants (MIG-3, 2026-07-31).
//
// Every module-level constant in main.mo was a plain `let` in a `persistent
// actor`, which moc persists as a stable variable: on upgrade the stored value
// is restored and the source initializer is SKIPPED, so editing a constant had
// no effect on the deployed canister. The constants are now `transient` (so a
// redeploy takes effect) and the operational ones read through an override map.
//
// The overrides are keyed by `key : Text` rather than being fields on a record,
// deliberately: `var settings : AdminSettings` is an INVARIANT position, so a
// new field on it traps (M0170) and costs a migration every time. A Text key is
// DATA, so adding a tunable later needs no migration at all.
//
// INVARIANTS:
//   * validate returns the first failing check in source order (unknown key,
//     then below min, then above max), else #ok with the matched spec.
//   * bounds are inclusive; a spec with min == 0 admits 0 (the ledger-fee
//     tunables rely on this — a zero-fee ledger is legal).
module {
  // Declared in main.mo beside the code each one governs; `defaultValue` is the
  // compiled value used when no override is set.
  public type Spec = { key : Text; defaultValue : Nat; min : Nat; max : Nat };

  // Public surface type — defined in types.mo with the rest of the candid
  // surface so it renders as `TunableInfo`, not a bare `Info`.
  public type Info = Types.TunableInfo;

  public func find(specs : [Spec], key : Text) : ?Spec {
    for (s in specs.vals()) { if (s.key == key) { return ?s } };
    null;
  };

  public func validate(specs : [Spec], key : Text, value : Nat) : Result.Result<Spec, Text> {
    switch (find(specs, key)) {
      case null { #err("unknown tunable: " # key) };
      case (?s) {
        if (value < s.min) { return #err(key # " must be at least " # Nat.toText(s.min)) };
        if (value > s.max) { return #err(key # " must be at most " # Nat.toText(s.max)) };
        #ok(s);
      };
    };
  };

  // `override_` is the stored override for `s.key`, or null when unset.
  public func info(s : Spec, override_ : ?Nat) : Info {
    let value = switch (override_) { case (?v) v; case null s.defaultValue };
    {
      key = s.key;
      value;
      defaultValue = s.defaultValue;
      min = s.min;
      max = s.max;
      overridden = override_ != null;
    };
  };
}
