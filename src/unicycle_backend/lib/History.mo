// Reading-store and scan helpers extracted from main.mo.
//
// Invariants:
//   * Readings are stored newest-first; `prependCapped` maintains that ordering.
//   * Lists are capped at N entries; older entries beyond the cap are dropped.
//   * `#ok`-only scans (`latestOk`, `oldestOkSince`, `recentOk`) skip `#err` entries.
//   * `okBal(#err _) = 0` — safe default for arithmetic on failed readings.
import Types "../types";
import List "mo:core/List";
import Array "mo:core/Array";

module {
  // prepend `entry`, keep newest-first, truncate to the first `max`
  public func prependCapped<T>(prior : [T], entry : T, max : Nat) : [T] {
    let combined = [entry].concat(prior);
    if (combined.size() > max) { combined.sliceToArray(0, max) } else { combined };
  };

  public func okBal(r : Types.CycleReading) : Nat {
    switch (r.result) { case (#ok b) b; case (#err _) 0 };
  };

  // newest-first list → first #ok is the latest
  public func latestOk(readings : [Types.CycleReading]) : ?Types.CycleReading {
    for (r in readings.vals()) { switch (r.result) { case (#ok _) return ?r; case (#err _) {} } };
    null;
  };

  // oldest #ok recorded at-or-after `since` (newest-first list → last match wins)
  public func oldestOkSince(readings : [Types.CycleReading], since : Nat) : ?Types.CycleReading {
    var best : ?Types.CycleReading = null;
    for (r in readings.vals()) {
      if (r.recordedAt >= since) { switch (r.result) { case (#ok _) { best := ?r }; case (#err _) {} } };
    };
    best;
  };

  // Post-top-up balance: the latest #ok balance plus the cycles just delivered.
  // null when there is no #ok reading to anchor the absolute balance (a
  // successful top-up always follows a fresh reading, so this is a defensive
  // guard, not an expected path).
  public func postTopUpBalance(readings : [Types.CycleReading], amount : Nat) : ?Nat {
    switch (latestOk(readings)) {
      case (?r) { ?(okBal(r) + amount) };
      case null { null };
    };
  };

  // up to `n` most recent #ok readings (newest-first)
  public func recentOk(readings : [Types.CycleReading], n : Nat) : [Types.CycleReading] {
    let out = List.empty<Types.CycleReading>();
    label scan for (r in readings.vals()) {
      switch (r.result) { case (#ok _) { out.add(r); if (out.size() >= n) break scan }; case (#err _) {} };
    };
    out.toArray();
  };
}
