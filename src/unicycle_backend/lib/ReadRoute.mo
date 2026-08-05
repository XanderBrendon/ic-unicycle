import Types "../types";

// Read-source routing and the SNS registration gate.
// INVARIANTS:
//   * primaryFor is the single home of the routing rule: a remembered source
//     always wins, and with nothing remembered an entry with a candidate root
//     reads via that root while everything else reads via the blackhole. That
//     fallback reproduces the pre-`readSource` routing exactly, so an empty map
//     is not just safe but indistinguishable from the old code.
//   * gate is total over its inputs and is the ONLY place the
//     governance-vs-admin registration rule is written down. `#user` never
//     reaches it — the plain-user path keeps its own blackhole-probe /
//     trackedSnsMatch ladder in upsertCanisterFor.
module {

  // Where an upsert came from. Two rules key off it: the global rate limit
  // (skipped for `#snsProposal` — a passed proposal must execute, never be
  // throttled) and whether a canister outside the DAO's control may be newly
  // registered.
  public type UpsertOrigin = { #user; #snsProposal; #snsAdmin };

  public type Gate = { #allow : Types.ReadSource; #requiresProposal; #unverifiable };

  public func primaryFor(
    remembered : ?Types.ReadSource,
    candidateRoot : ?Principal,
  ) : Types.ReadSource {
    switch (remembered) {
      case (?src) { src };
      case null {
        switch (candidateRoot) { case (?_) { #snsRoot }; case null { #blackhole } };
      };
    };
  };

  public func gate(
    origin : UpsertOrigin,
    alreadyTracked : Bool,
    inSummary : Bool,
    blackholeOk : Bool,
  ) : Gate {
    // In the DAO's canister summary: the canister is DAO-controlled, which is
    // the case this gate exists to distinguish. Nothing else matters.
    if (inSummary) return #allow(#snsRoot);
    if (not blackholeOk) return #unverifiable;
    // Readable via the blackhole but outside the DAO's control set. An entry
    // this root already tracks stays editable by admins so a canister that was
    // transferred away keeps working with no proposal; a NEW registration of
    // such a canister is governance-only, because an admin who could do it
    // could point DAO-funded top-ups at a canister the DAO cannot govern.
    // Remove-then-re-add is therefore closed: the re-add lands here untracked.
    if (alreadyTracked) return #allow(#blackhole);
    switch (origin) {
      case (#snsProposal) { #allow(#blackhole) };
      case (_) { #requiresProposal };
    };
  };
};
