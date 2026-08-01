// One-shot migration dropping the 19 stale stable module-level constants
// (MIG-3, 2026-07-31).
//
// Every module-level constant in main.mo was a plain `let` in a `persistent
// actor`, which moc persists as a stable variable. On upgrade the stored value
// was restored and the source initializer SKIPPED, so editing a constant never
// reached the deployed canister. This was not theoretical: the deposit-proposal
// cooldown could not be corrected after it filed a duplicate SNS treasury
// proposal, and `icpLedgerFee` / `tcyclesLedgerFee` carried a comment promising
// "Bump if either ledger changes its `icrc1_fee`" that could not work.
//
// The constants are now `transient` (so a redeploy takes effect) and the
// operational ones read through the `tunableOverrides` map. Motoko forbids
// implicitly discarding a previously-stable variable (error M0169), so this
// explicit migration consumes all 19 and produces no new stable fields. Every
// other stable variable is carried through untouched, and `tunableOverrides`
// initializes itself from its own initializer.
//
// The input record must match the DEPLOYED `.most` exactly — same names, same
// types — or the upgrade fails its domain check at install. Verify before
// deploying (`<pre>` = the .most of the deployed commit):
//   moc --stable-types -o /tmp/new.wasm src/unicycle_backend/main.mo
//   moc --stable-compatible /tmp/pre.most /tmp/new.most
//
// ONE-SHOT: remove this module and its `(with migration = ...)` attachment in
// main.mo in the first commit after the upgrade lands. Because it drops these
// variables, re-attaching it to a later upgrade fails (M0169: the prior version
// no longer has them).
module {
  public func run(
    _old : {
      DEPOSIT_PROPOSAL_COOLDOWN_NS : Nat;
      GLOBAL_BUCKET_CAPACITY : Nat;
      GLOBAL_BUCKET_REFILL_INTERVAL_NS : Nat;
      LP_FULL_TICK_LOWER : Int;
      LP_FULL_TICK_UPPER : Int;
      LP_MIN_ICP_DEPOSIT : Nat;
      LP_POOL_FEE : Nat;
      MAX_BALANCE_EVENTS_PER_OWNER : Nat;
      MAX_HARVEST_EVENTS : Nat;
      MAX_LOG_ENTRIES : Nat;
      MAX_LP_EVENTS : Nat;
      MAX_METRICS_SNAPSHOTS : Nat;
      MAX_TOP_CONTRIBUTORS : Nat;
      MAX_TRACKED_SNS_PER_USER : Nat;
      MEMO_TOP_UP_CANISTER : Blob;
      SETTLE_POLL_ATTEMPTS : Nat;
      SNS_REFRESH_MIN_INTERVAL_NS : Nat;
      icpLedgerFee : Nat;
      tcyclesLedgerFee : Nat;
    }
  ) : {} {
    {};
  };
};
