// One-time migration for the `snsFunctionSpecs` stable→transient change.
//
// `snsFunctionSpecs` is a compile-time constant, but as a plain `let` in a
// `persistent actor` it was implicitly persisted as a stable variable. That
// meant edits to the Unicycle function registry never took effect on upgrade:
// the old array was restored from stable memory and the new initializer was
// skipped, so `runSnsSetup` kept registering the stale set for new onboardings.
//
// We now declare `snsFunctionSpecs` `transient` so it re-evaluates from source
// on every upgrade. Motoko forbids implicitly discarding a previously-stable
// variable (error M0169), so this explicit migration consumes the old
// `snsFunctionSpecs` (dropping the stale persisted copy) and produces no new
// stable fields; every other stable variable is carried through untouched.
//
// ONE-SHOT: remove this module and its `(with migration = ...)` attachment in
// main.mo once a deploy has applied it. Because it drops `snsFunctionSpecs`,
// re-attaching it to a later upgrade fails (M0169: prior version no longer has
// the variable).
module {
  type SnsFunctionSpec = {
    name : Text;
    description : Text;
    target : Text;
    validator : Text;
  };

  public func run(_old : { snsFunctionSpecs : [SnsFunctionSpec] }) : {} {
    {};
  };
};
