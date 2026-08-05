import Principal "mo:core/Principal";
import List "mo:core/List";
import Types "../types";

// Pure pre-flight for the batch tracking API (`batchTrackCanisters`).
// INVARIANTS:
//   * findDuplicate is the only place the "one entry per canister" rule is
//     written down. Duplicates are REJECTED rather than resolved in some
//     arbitrary order: two entries for one canister make the intended end state
//     ambiguous, and a last-wins rule would silently discard an intent.
//   * precheck decides every verdict reachable WITHOUT an outbound call — the
//     zero-amount rejections and the growth caps — so the batch never pays for a
//     probe whose entry is already doomed.
//   * precheck admits NEW canisters in input order until the per-owner cap is
//     reached, so the same request always yields the same verdicts.
//   * precheck's caps are a PRE-PROBE gate, exactly like the single-canister
//     path's: `tracked` can move while the probes are in flight, so main.mo
//     re-checks authoritatively after the awaits.
module {
  // Bound on entries per call. Sized against the per-method ingress arg cap in
  // main.mo's `inspect`: 100 entries at a worst-case ~120 bytes each is ~12 KiB,
  // comfortably inside the 32 KiB allowed for the batch methods. It also bounds
  // findDuplicate's quadratic scan — check the size FIRST.
  public let MAX_ENTRIES : Nat = 100;

  // The owner's growth headroom at the moment the batch starts.
  public type Caps = {
    ownerIsNew : Bool; // no `tracked` sub-map for this owner yet
    ownerCount : Nat; // tracked.size()
    maxOwners : Nat;
    trackedCount : Nat; // canisters this owner currently tracks
    maxCanistersPerOwner : Nat;
  };

  // The first canister id appearing more than once, if any. Quadratic, which is
  // fine only because MAX_ENTRIES bounds the input at 100 (~5k comparisons).
  public func findDuplicate(entries : [Types.BatchTrackEntry]) : ?Principal {
    var i = 0;
    while (i < entries.size()) {
      var j = i + 1;
      while (j < entries.size()) {
        if (entries[i].canisterId == entries[j].canisterId) {
          return ?entries[i].canisterId;
        };
        j += 1;
      };
      i += 1;
    };
    null;
  };

  // Per-entry verdict decidable without any outbound call. `null` means the
  // entry survives to the probe/apply phase; `?err` means it is already decided.
  // `isTracked` reports whether the owner currently tracks that id.
  public func precheck(
    entries : [Types.BatchTrackEntry],
    isTracked : Principal -> Bool,
    caps : Caps,
  ) : [?Types.UpsertCanisterError] {
    let out = List.empty<?Types.UpsertCanisterError>();
    var admitted = caps.trackedCount;
    for (e in entries.vals()) {
      switch (e.intent) {
        // Untracking shrinks the registry: no validation, no cap, no probe.
        case (#untrack) { out.add(null) };
        case (#track t) {
          if (t.config.minCycleBalance == 0) {
            out.add(?#zeroMinCycleBalance);
          } else if (t.config.cycleTopUpAmount == 0) {
            out.add(?#zeroCycleTopUpAmount);
          } else if (caps.ownerIsNew and caps.ownerCount >= caps.maxOwners) {
            out.add(?#ownerLimitReached { maxOwners = caps.maxOwners });
          } else if (isTracked(e.canisterId)) {
            // An in-place update of an already-tracked pair never grows the
            // registry, so the per-owner cap does not apply to it.
            out.add(null);
          } else if (admitted >= caps.maxCanistersPerOwner) {
            out.add(?#canisterLimitReached { maxCanistersPerOwner = caps.maxCanistersPerOwner });
          } else {
            admitted += 1;
            out.add(null);
          };
        };
      };
    };
    out.toArray();
  };

  // Canister ids still needing a controllership probe: `track` entries that
  // survived `precheck`. Untracked and already-rejected entries are excluded so
  // the batch never pays for a probe it cannot use.
  public func probeIds(
    entries : [Types.BatchTrackEntry],
    verdicts : [?Types.UpsertCanisterError],
  ) : [Principal] {
    let out = List.empty<Principal>();
    var i = 0;
    while (i < entries.size()) {
      switch (verdicts[i], entries[i].intent) {
        case (null, #track _) { out.add(entries[i].canisterId) };
        case _ {};
      };
      i += 1;
    };
    out.toArray();
  };
};
