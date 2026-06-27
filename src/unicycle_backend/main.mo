import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
import Nat "mo:core/Nat";
import Nat8 "mo:core/Nat8";
import Nat64 "mo:core/Nat64";
import Result "mo:core/Result";
import Map "mo:core/Map";
import Set "mo:core/Set";
import Iter "mo:core/Iter";
import List "mo:core/List";
import Time "mo:core/Time";
import Timer "mo:core/Timer";
import Error "mo:core/Error";
import Int "mo:core/Int";
import Order "mo:core/Order";
import Runtime "mo:core/Runtime";
import Cycles "mo:core/Cycles";
import Prim "mo:⛔";
import ICRC2 "icrc2";
import ICRC1 "icrc1";
import CyclesLedger "cycles_ledger";
import Types "types";
import Durations "lib/Durations";
import Subaccount "lib/Subaccount";
import Tokens "lib/Tokens";
import Errors "lib/Errors";
import Settings "lib/Settings";
import Tracking "lib/Tracking";
import Loyalty "lib/Loyalty";
import SwapMath "lib/SwapMath";
import History "lib/History";
import DrainDetection "lib/DrainDetection";
import Report "lib/Report";
import RateLimit "lib/RateLimit";
import TokenBucket "lib/TokenBucket";

persistent actor class Unicycle(
  blackholeCanisterId : Principal,
  icpSwapPoolId : Principal,
  snsWasmCanisterId : Principal,
  cmcCanisterId : Principal,
) = self {

  // ---------------------------------------------------------------------------
  // Re-exported public types. Defined in types.mo; aliased here so the public
  // candid surface (and any Motoko consumer) is unchanged by the extraction.
  // ---------------------------------------------------------------------------

  public type Token = Types.Token;
  public type DepositError = Types.DepositError;
  public type WithdrawError = Types.WithdrawError;
  public type CanisterConfig = Types.CanisterConfig;
  public type UpsertCanisterError = Types.UpsertCanisterError;
  public type RecordCyclesError = Types.RecordCyclesError;
  public type SuspendCanisterError = Types.SuspendCanisterError;
  public type RemoveCanisterError = Types.RemoveCanisterError;
  public type AdminRemoveCanisterError = Types.AdminRemoveCanisterError;
  public type TrackedCanister = Types.TrackedCanister;
  public type CycleReading = Types.CycleReading;
  public type SwapAttempt = Types.SwapAttempt;
  public type TopUp = Types.TopUp;
  public type CanisterHistory = Types.CanisterHistory;
  public type SnsValidateResult = Types.SnsValidateResult;
  public type SnsDepositArg = Types.SnsDepositArg;
  public type SnsWithdrawArg = Types.SnsWithdrawArg;
  public type SnsUpsertCanisterArg = Types.SnsUpsertCanisterArg;
  public type SnsSetSuspendedArg = Types.SnsSetSuspendedArg;
  public type SnsRemoveCanisterArg = Types.SnsRemoveCanisterArg;
  public type SnsRecordCyclesArg = Types.SnsRecordCyclesArg;
  public type SnsSetProposalNeuronArg = Types.SnsSetProposalNeuronArg;
  public type SnsGrantAdminArg = Types.SnsGrantAdminArg;
  public type SnsRevokeAdminArg = Types.SnsRevokeAdminArg;
  public type SnsSetupArg = Types.SnsSetupArg;
  public type SnsSetDepositConfigArg = Types.SnsSetDepositConfigArg;
  public type SnsSetReportConfigArg = Types.SnsSetReportConfigArg;
  public type SnsSetDrainAlertConfigArg = Types.SnsSetDrainAlertConfigArg;
  public type SnsFunctionRegistration = Types.SnsFunctionRegistration;
  public type SnsDepositAction = Types.SnsDepositAction;
  public type SnsDepositCheckOutcome = Types.SnsDepositCheckOutcome;
  public type SnsReportAction = Types.SnsReportAction;
  public type SnsReportCheckOutcome = Types.SnsReportCheckOutcome;
  public type SnsDrainTrigger = Types.SnsDrainTrigger;
  public type SnsDrainAlertAction = Types.SnsDrainAlertAction;
  public type SnsDrainAlertCheckOutcome = Types.SnsDrainAlertCheckOutcome;
  public type AdminError = Types.AdminError;
  public type AdminSettings = Types.AdminSettings;
  public type AdminTrackedRow = Types.AdminTrackedRow;
  public type AdminTopUpRow = Types.AdminTopUpRow;
  public type AdminTimerInfo = Types.AdminTimerInfo;
  public type TimerSchedule = Types.TimerSchedule;
  public type AdminMetrics = Types.AdminMetrics;
  public type UpdateAdminSettingsError = Types.UpdateAdminSettingsError;
  public type AdminLpInfo = Types.AdminLpInfo;
  public type AdminServiceFundingInfo = Types.AdminServiceFundingInfo;
  public type AdminLoyaltyInfo = Types.AdminLoyaltyInfo;
  public type MyLoyaltyStatus = Types.MyLoyaltyStatus;
  public type LoyaltyAccount = Types.LoyaltyAccount;
  public type HarvestEvent = Types.HarvestEvent;
  public type LpEvent = Types.LpEvent;
  public type BalanceEventKind = Types.BalanceEventKind;
  public type BalanceEvent = Types.BalanceEvent;
  public type LogLevel = Types.LogLevel;
  public type LogCategory = Types.LogCategory;
  public type LogEntry = Types.LogEntry;
  public type LogFilter = Types.LogFilter;
  public type MetricsSnapshot = Types.MetricsSnapshot;
  public type IcpSwapPoolError = Types.IcpSwapPoolError;
  public type IcpSwapPoolToken = Types.IcpSwapPoolToken;
  public type IcpSwapPoolMetadata = Types.IcpSwapPoolMetadata;
  public type DrainSeedPoint = Types.DrainSeedPoint;

  // ---------------------------------------------------------------------------
  // Blackhole canister reference. The blackhole proxies the management
  // canister's `canister_status` and is the sole controller of every tracked
  // canister (set up by the user during registration). Structural typing only
  // needs the `cycles` field from the success branch.
  // ---------------------------------------------------------------------------

  func blackhole() : actor {
    canisterStatus : (Principal) -> async {
      #ok : { cycles : Nat };
      #err : Text;
    };
    canisterStatuses : ([Principal], Nat) -> async {
      #ok : [{ #ok : { cycles : Nat }; #err : Text }];
      #err : Text;
    };
  } {
    actor (blackholeId.toText());
  };

  // Cycles ledger reference — narrow structural type pinned to just `withdraw`.
  // The vendored binding's `Self` is a factory function (the upstream service
  // takes init args), so we declare the live actor type inline.
  transient let cyclesLedger : actor {
    withdraw : shared CyclesLedger.WithdrawArgs -> async {
      #Ok : Nat;
      #Err : CyclesLedger.WithdrawError;
    };
    // US30: re-wrap CMC-minted raw cycles as TCYCLES credited to a participant's
    // deposit subaccount — the same `(with cycles = …) deposit(...)` the icpswap
    // stub uses to pre-fund itself.
    deposit : shared CyclesLedger.DepositArgs -> async CyclesLedger.DepositResult;
  } = actor (Tokens.ledgerCanisterId(#TCYCLES).toText());

  // Cycles Minting Canister reference (US30). Typed to only the two methods the
  // direct-mint path uses: the flat ICP→cycles rate probe and the post-transfer
  // top-up notification. Mainnet id is `rkp4c-7iaaa-aaaaa-aaaca-cai` (passed via
  // the production init arg); local replicas point at the `cmc` stub. Like the
  // blackhole it stays a static `transient let` — it is not made runtime-settable
  // here (deferred, see US30 decision 8). The rate reply's certificate /
  // hash_tree fields are omitted — structural subtyping drops them on decode.
  // Confirm the reply variant tags against the live CMC `.did` before mainnet.
  transient let cmc : actor {
    get_icp_xdr_conversion_rate : () -> async {
      data : { xdr_permyriad_per_icp : Nat64; timestamp_seconds : Nat64 };
    };
    notify_top_up : ({ block_index : Nat64; canister_id : Principal }) -> async {
      #Ok : Nat;                       // cycles minted
      #Err : {
        #Refunded : { block_index : ?Nat64; reason : Text };
        #Processing;
        #TransactionTooOld : Nat64;
        #InvalidTransaction : Text;
        #Other : { error_code : Nat64; error_message : Text };
      };
    };
  } = actor (cmcCanisterId.toText());

  // ICPSwap V3 SwapPool reference — narrow structural subset of the upstream
  // candid surface vendored under `src/unicycle_backend/icpswap_pool.did`.
  // Only the five methods the US12 group-swap saga uses are typed here. The
  // `pejtq-…` mainnet pool is the production target; local replicas point at
  // the stub canister in `vendor/icpswap/`.
  // Full-range ticks for the canonical 0.3% fee tier. Confirm against the
  // mainnet pool's `metadata()` once at deploy time and lock as constants.
  let LP_FULL_TICK_LOWER : Int = -887220;
  let LP_FULL_TICK_UPPER : Int = 887220;
  let LP_POOL_FEE : Nat = 3_000;     // 0.3% fee tier — confirm against metadata()
  func icpSwapPool() : actor {
    metadata : shared query () -> async {
      #ok : IcpSwapPoolMetadata;
      #err : IcpSwapPoolError;
    };
    quote : shared query Types.IcpSwapArgs -> async {
      #ok : Nat;
      #err : IcpSwapPoolError;
    };
    depositFrom : shared Types.IcpSwapDepositArgs -> async {
      #ok : Nat;
      #err : IcpSwapPoolError;
    };
    swap : shared Types.IcpSwapArgs -> async {
      #ok : Nat;
      #err : IcpSwapPoolError;
    };
    withdrawToSubaccount : shared Types.IcpSwapWithdrawToSubaccountArgs -> async {
      #ok : Nat;
      #err : IcpSwapPoolError;
    };
    mint : shared Types.IcpSwapMintArgs -> async {
      #ok : Nat;
      #err : IcpSwapPoolError;
    };
    increaseLiquidity : shared Types.IcpSwapIncreaseLiquidityArgs -> async {
      #ok : Nat;
      #err : IcpSwapPoolError;
    };
    claim : shared Types.IcpSwapClaimArgs -> async {
      #ok : { amount0 : Nat; amount1 : Nat };
      #err : IcpSwapPoolError;
    };
    // Live unclaimed fees for a position (token0 = ICP, token1 = TCYCLES). A
    // query, awaited from update contexts the same way `quote` is. Narrow
    // two-field record; Candid subtyping drops any other fields on decode.
    refreshIncome : shared query Nat -> async {
      #ok : { tokensOwed0 : Nat; tokensOwed1 : Nat };
      #err : IcpSwapPoolError;
    };
  } {
    actor (swapPoolId.toText());
  };

  // NNS SNS-Wasm registry reference (US21). The canonical, NNS-rooted source of
  // truth for deployed SNSes: `list_deployed_snses` returns every instance with
  // both its `governance_canister_id` and `root_canister_id`, the reverse index
  // the backend needs to resolve a governance caller → SNS root. Mainnet id is
  // `qaa6y-5yaaa-aaaaa-aaafa-cai` (passed via the production init arg); local
  // replicas point at the `sns_wasm` stub. Only the two fields read are declared
  // — Candid record subtyping drops the unread ledger/swap/index fields on
  // decode. `list_deployed_snses` is a `query`, awaited from update contexts the
  // same way `icpSwapPool.quote` is.
  transient let snsWasm : actor {
    list_deployed_snses : shared query {} -> async { instances : [Types.DeployedSns] };
  } = actor (snsWasmCanisterId.toText());

  // SNS governance binding (US22). The backend submits proposals on an SNS's
  // behalf by calling that SNS's governance `manage_neuron` with a
  // `MakeProposal`/`Motion` command through a neuron the backend is hotkeyed on.
  // The governance canister varies per SNS (discovered via the US21 registry),
  // so the actor reference is built inline in `submitSnsMotionProposal` (like the
  // per-token `Tokens.ledgerCanisterId(...)` references) — not a module-level binding.
  // These are only the narrow structural types it sends/reads; Candid subtyping
  // drops every other command/field. Verified against a live SNS governance
  // candid (OpenChat `2jvtu-yqaaa-aaaaq-aaama-cai`): request
  // `MakeProposal : Proposal{title;url;summary;action}` with `Motion{motion_text}`;
  // response `command : opt variant { MakeProposal : record { proposal_id : opt
  // record { id : nat64 } }; Error : record { error_message : text } }` (the
  // governance `Error` branch also carries `error_type`, dropped on decode).

  // IC management canister — `canister_info` is callable by any canister and
  // returns the target's controller list. Used by `refreshControllers` so the
  // backend can discover its own controllers without being added as a
  // controller of anything. Called via a 0-delay timer at every install/upgrade.
  // Narrow structural type — `total_num_changes` and `recent_changes` are
  // dropped via Candid subtyping.
  transient let mgmt : actor {
    canister_info : ({
      canister_id : Principal;
      num_requested_changes : ?Nat64;
    }) -> async {
      controllers : [Principal];
      module_hash : ?Blob;
    };
  } = actor ("aaaaa-aa");

  // ---------------------------------------------------------------------------
  // SNS custom-function twins (US20). Each user-facing mutating method gets an
  // SNS-callable pair: an execute twin (`sns*`) and a validate twin
  // (`sns*Validate`). A generic-nervous-system-function proposal carries a
  // single Candid `payload`; governance calls `validator(payload) ->
  // Result<String,String>` to render to voters and `target(payload)` on
  // adoption (a trap = failed proposal). So twins take one record argument and
  // the validator returns the capitalized `variant { Ok; Err }` Rust decodes.
  // The frontend keeps calling the existing methods — these twins exist only
  // for the SNS-proposal path (registration is US23).
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Admin model (US29). Effective admin = caller ∈ admins ∪ cachedControllers.
  // `admins` holds principals added explicitly via addAdmin. `cachedControllers`
  // is a snapshot of this canister's own controllers, refreshed automatically
  // by a 0-delay timer at every install/upgrade (see bottom of actor). The
  // deployer is a controller by default, so the bootstrap requires no extra
  // setup — admin powers attach to the deploying identity as soon as the
  // post-install refresh completes (typically within a few seconds).
  // ---------------------------------------------------------------------------

  let MAX_TOP_CONTRIBUTORS : Nat = 10;

  // Cooldown between automatic deposit top-up proposals for one SNS (US24).
  // Default 4 days ≥ a typical SNS voting period, so the recurring check does not
  // re-file a transfer while the previous one is still in voting. Cleared by
  // `snsSetDepositConfig` so changed settings are acted on immediately.
  let DEPOSIT_PROPOSAL_COOLDOWN_NS : Nat = 4 * Durations.DAY_NS;

  var settings : AdminSettings = {
    cycleCheckIntervalSeconds = 14_400; // 4 hours
    maxReadingsPerCanister = 900;
    maxTopUpsPerCanister = 900;
    batchSize = 100;
    baseServiceFeeBps = 1_000;
    lpDrainThresholdTcycles = 1_000_000_000_000;
    serviceFundingThresholdTcycles = 10_000_000_000_000;
    maxOwners = 10_000;
    maxCanistersPerOwner = 200;
    swapSlippageBps = 300; // 3% floor on internal LP/harvest swaps (FIN-1)
    harvestThresholdTcycles = 100_000_000_000; // 0.1 T — min pending reward worth harvesting
  };

  let admins : Set.Set<Principal> = Set.empty();
  var cachedControllers : [Principal] = [];

  // Re-pointable ICPSwap pool (US29). Seeded from the icpSwapPoolId init arg;
  // changed at runtime via setIcpSwapPool so re-pointing at a new pool needs no
  // redeploy. Persisted — survives upgrades; --mode reinstall resets to the arg.
  var swapPoolId : Principal = icpSwapPoolId;

  // Re-pointable blackhole canister. Seeded from the blackholeCanisterId init
  // arg; changed at runtime via setBlackholeCanister so swapping the blackhole
  // (e.g. on mainnet) needs no redeploy. Persisted — survives upgrades;
  // --mode reinstall resets to the arg.
  var blackholeId : Principal = blackholeCanisterId;

  // SNS governance → root resolution cache (US21). Rebuilt from the NNS
  // SNS-Wasm registry by `refreshSnsRegistry` — a 0-delay startup timer (see
  // bottom of actor) and live on a cache miss in `resolveSnsRoot`. Persisted
  // but cheap to lose: fully reconstructable from the registry.
  var snsRootByGovernance : Map.Map<Principal, Principal> = Map.empty();

  // SNS proposal-submission neuron (US22), root-keyed: the neuron the SNS has
  // hotkeyed to the backend and recorded via `snsSetProposalNeuron`, used by
  // `submitSnsMotionProposal` to call that SNS's governance `manage_neuron`.
  // Persisted like `tracked` — cheap to lose, and the SNS re-records it via the
  // same twin (a `--mode reinstall` wipes it anyway).
  let snsProposalNeuron : Map.Map<Principal, Blob> = Map.empty();

  // SNS admins (US27): root → principals the SNS has authorized to act on its
  // behalf from the frontend. Additive grant (snsGrantAdmin); US28 revokes.
  // Persisted like `tracked` — cheap to lose (`--mode reinstall` wipes it).
  let snsAdmins : Map.Map<Principal, Set.Set<Principal>> = Map.empty();

  // Automatic deposit top-up config + resubmit guard (US24), both root-keyed.
  // `snsDepositConfig` holds the SNS's min/amount/report settings; an absent
  // entry (or `minBalanceE8s == 0`) means no auto-deposit. `snsLastDepositProposal`
  // records the ns timestamp of the last submitted transfer per root so the recurring
  // check honours `DEPOSIT_PROPOSAL_COOLDOWN_NS`. Persisted but cheap to lose —
  // the SNS re-sets config by proposal and the cooldown simply restarts.
  let snsDepositConfig : Map.Map<Principal, SnsSetDepositConfigArg> = Map.empty();
  let snsLastDepositProposal : Map.Map<Principal, Nat> = Map.empty();

  // Recurring cycle-usage report config + cadence guard (US25), both root-keyed.
  // `snsReportConfig` holds the SNS's cadence (`cadenceDays == 0` disables);
  // `snsLastReportProposal` records the ns timestamp of the last submitted report
  // so the recurring check fires only when `now − last ≥ cadenceDays · DAY_NS`. The
  // cadence itself is the guard — no separate cooldown. Persisted but cheap to
  // lose: the SNS re-sets config by proposal and the cadence simply restarts.
  let snsReportConfig : Map.Map<Principal, SnsSetReportConfigArg> = Map.empty();
  let snsLastReportProposal : Map.Map<Principal, Nat> = Map.empty();

  // Cycle-drain alert config + cooldown guard (US26), both root-keyed.
  // `snsDrainAlertConfig` holds the SNS's per-window % thresholds (all `== 0`
  // disables); `snsLastDrainAlertProposal` records the ns timestamp of the last
  // submitted alert so the recurring check honours `alertCooldownDays · DAY_NS` (the
  // configurable max frequency). `snsSetDrainAlertConfig` clears the timestamp so
  // a new config can alert on the next check. Persisted but cheap to lose.
  let snsDrainAlertConfig : Map.Map<Principal, SnsSetDrainAlertConfigArg> = Map.empty();
  let snsLastDrainAlertProposal : Map.Map<Principal, Nat> = Map.empty();   // root → ns timestamp of last alert

  // Tracked-canister registry: per-caller map of canister id → config. Persists
  // across upgrades via the persistent actor default.
  let tracked : Map.Map<Principal, Map.Map<Principal, CanisterConfig>> = Map.empty();

  // Cycle readings keyed by canister id only — history is a property of the
  // canister, not of the principal tracking it. Multiple owners tracking the
  // same canister share one newest-first list capped at
  // settings.maxReadingsPerCanister. Read access is still gated by `tracked` so
  // non-trackers cannot peek. Cross-owner cleanup on removal lives in
  // `removeTrackedEntry` — the row is dropped iff no owner still tracks it.
  let cycleHistory : Map.Map<Principal, [CycleReading]> = Map.empty();

  // Per-caller top-up attempts: owner → canister → newest-first capped at
  // settings.maxTopUpsPerCanister. Top-ups are keyed by owner because each one
  // burns that owner's deposited tcycles — unlike readings, which describe
  // the canister itself. Per-owner cleanup on removal lives in
  // `removeTrackedEntry`.
  let topUpHistory : Map.Map<Principal, Map.Map<Principal, [TopUp]>> = Map.empty();

  // (owner, canisterId) pairs with a withdraw in flight. Transient — resets
  // to empty on upgrade; acceptable because any in-flight `await` is dropped
  // on upgrade anyway. Nested Map<Principal, Set<Principal>> avoids the need
  // for a tuple-keyed compare function.
  transient let topUpsInFlight : Map.Map<Principal, Set.Set<Principal>> = Map.empty();

  // Recent manual "Record now" checks per account (caller, or SNS root) for the
  // todo-24 rate cap. Transient — resets on upgrade (controller-only); the
  // motoko skill recommends transient for rate limiters. See `lib/RateLimit`.
  transient let manualChecks : Map.Map<Principal, [RateLimit.Check]> = Map.empty();

  // Global token-bucket rate limit (DOS-2). The per-account `manualChecks` cap
  // is trivially bypassed by rotating principals; this bounds the AGGREGATE rate
  // of ingress calls that force backend-paid outbound calls (upsertCanister's
  // controllership probe; recordCyclesNow's status read + top-up). Sized for
  // ~60 calls/min sustained with a ~2-minute burst — far above any legitimate
  // single user, far below a drain. Transient: a cold/just-upgraded canister
  // starts with a full bucket. See `lib/TokenBucket`.
  let GLOBAL_BUCKET_CAPACITY : Nat = 120;
  let GLOBAL_BUCKET_REFILL_INTERVAL_NS : Nat = 1_000_000_000; // 1 token/sec → ~60/min
  transient var globalBucket : TokenBucket.Bucket = TokenBucket.init(GLOBAL_BUCKET_CAPACITY);

  // Throttle the live SNS-Wasm registry refresh triggered on a `resolveSnsRoot`
  // cache miss (DOS-3/AUTH-6): repeated misses from unrecognized/rotating
  // callers must not each force a paid `list_deployed_snses`. A genuinely new
  // SNS resolves on the next call after the window. Transient — a fresh 0 just
  // permits the first refresh.
  let SNS_REFRESH_MIN_INTERVAL_NS : Nat = 60_000_000_000; // 60s
  transient var lastSnsRefreshNs : Nat = 0;

  // Single-saga in-flight flag for the US12 group-swap path. Concurrent
  // firings during a running saga return silently; the next trigger
  // re-aggregates. Transient — resets to false on upgrade (any in-flight
  // saga's awaits are dropped anyway).
  transient var groupSwapInFlight : Bool = false;

  // Live ledger fees, lifted to constants so the saga's per-participant
  // deficit / staging math doesn't pay a round-trip per quote loop. Bump if
  // either ledger changes its `icrc1_fee`.
  let icpLedgerFee : Nat = 10_000;
  let tcyclesLedgerFee : Nat = 100_000_000;

  // "TPUP" — MEMO_TOP_UP_CANISTER; the NNS CMC only mints for an ICP transfer
  // carrying this memo (US30). The canonical NNS constant is the u64 0x50555054.
  // We transfer via `icrc1_transfer`, so the memo travels as the ICRC-1 blob
  // (`icrc1_memo`). The live CMC decodes that blob with `u64::from_le_bytes` and
  // requires EXACTLY 8 bytes — any other length is read as Memo(0) and rejected.
  // So the bytes below are 0x50555054 little-endian, zero-padded to 8 bytes.
  // (The local `cmc` stub ignores the memo, so a wrong value still passes local
  // verification — this encoding was confirmed against the mainnet CMC source.)
  let MEMO_TOP_UP_CANISTER : Blob = Blob.fromArray([0x54 : Nat8, 0x50, 0x55, 0x50, 0x00, 0x00, 0x00, 0x00]);

  // 10% over-purchase applied to the aggregated swap *target* (the ratio lives
  // in `SwapMath.OVER_PURCHASE_NUM`/`_DEN`), which sizes `quotedInput` /
  // `totalIcpIn` in `runGroupSwap`. The matching swap floor (`amountOutMinimum`
  // in step 4) is the bare `survivingDemand + n · tcyclesLedgerFee` — the 10%
  // gap is the slippage cushion. On a slip-free swap the excess TCYCLES land in
  // each user's deposit subaccount and are consumed by the next trigger's
  // pass-1 direct withdraw, paying for that retry's cycles-ledger fee.

  // ---------------------------------------------------------------------------
  // LP routing state (US16). Per-top-up service fees pool in the backend's own
  // default TCYCLES account; an LP-routing saga drains the pool into a single
  // Unicycle-owned ICPSwap position once it crosses `lpDrainThresholdTcycles`.
  // ---------------------------------------------------------------------------

  // Persistent: id of the Unicycle-owned LP position on the configured pool.
  // `null` until the first drain mints; thereafter survives upgrades.
  var lpPositionId : ?Nat = null;
  // Cumulative tcycles fees ever transferred into the fee pool. Stable; never
  // decremented (drains move the live balance, not this counter). Used by admin
  // LP info + US18's eventual proportional-rebate math.
  var cumulativeFeesTcycles : Nat = 0;
  // Cumulative tcycles ever funded into the LP directly by admins (not fees).
  // Stable audit counter; never decremented. Deliberately separate from
  // `cumulativeFeesTcycles` so admin funding grows the position without ever
  // touching the loyalty shares denominator (reward share unaffected).
  var cumulativeAdminFundedTcycles : Nat = 0;

  // ---------------------------------------------------------------------------
  // Service-funding routing state (US17). When the primary admin's TCYCLES
  // deposit subaccount is below `serviceFundingThresholdTcycles`, per-top-up
  // fees are redirected there (to fund the service canisters via the normal
  // top-up engine) instead of to the fee pool (US16 → LP).
  // ---------------------------------------------------------------------------

  // The one admin whose deposit subaccount funds the service canisters and
  // receives redirected fees. `null` until designated; while null, redirection
  // is off and all fees follow US16 (→ fee pool). Stable across upgrades.
  var primaryAdmin : ?Principal = null;

  // Cumulative TCYCLES fees ever redirected to the primary admin's subaccount
  // (the service-funding portion of total fees). Stable; never decremented.
  var cumulativeServiceFundingTcycles : Nat = 0;

  // ---------------------------------------------------------------------------
  // Loyalty rebate state (US18). Surplus LP rewards (trading fees the
  // Unicycle-owned position earns, net of the service-funding slice) are shared
  // to users on an accumulated-reward-per-share basis: a global accumulator
  // advances on each harvest by `surplus / totalShares`, where a user's shares
  // are the net fees they have historically paid. A rebate is pure internal
  // accounting — the user's accrued credit offsets the fee they owe and the
  // tokens never leave the LP. `cumulativeFeesTcycles` (US16) doubles as the
  // live total-shares denominator (both move by `net` on every charge).
  // ---------------------------------------------------------------------------

  // Per-user loyalty accounting. Empty until the first fee. Stable.
  let loyalty : Map.Map<Principal, LoyaltyAccount> = Map.empty();

  // Reward-per-share accumulator (scaled by Loyalty.ACC_PRECISION). Advances on
  // each harvest via Loyalty.advance(_, surplus, cumulativeFeesTcycles). Stable.
  var accRewardPerShare : Nat = 0;

  // Audit counters (stable; never decremented):
  var cumulativeSurplusRewardsTcycles : Nat = 0; // surplus shared to users over all harvests
  var cumulativeRebatesGrantedTcycles : Nat = 0; // rebate credit ever claimed

  let MAX_HARVEST_EVENTS : Nat = 30;
  var harvestHistory : [HarvestEvent] = [];
  transient var harvestInFlight : Bool = false;

  // Newest-first capped audit log of drain attempts (success + failure).
  let MAX_LP_EVENTS : Nat = 30;
  var lpHistory : [LpEvent] = [];

  // Saga-level guard. Concurrent firings during a running drain return silently;
  // the next firing re-checks the threshold. Transient — any in-flight async hop
  // is dropped on upgrade.
  transient var lpDrainInFlight : Bool = false;

  // Prevents the recurring sweep from overlapping itself (ASYNC-1). The timer is
  // a recurringTimer, so it fires every interval regardless of whether the prior
  // firing finished; without this, a sweep that outruns the interval (or a tight
  // `cycleCheckIntervalSeconds`) re-enters while suspended and doubles the
  // blackhole reads. Transient — like the harvest/lpDrain guards, a trap
  // mid-sweep leaves it set until the next upgrade (controller-only) resets it.
  transient var cycleCheckInFlight : Bool = false;

  // Per-root guard for the proposal-submitting SNS checks (ASYNC-1). Each
  // checkSns* core reads its cooldown, awaits, then stamps the cooldown only
  // AFTER submitting — a TOCTOU where two concurrent runs for the same root (a
  // timer overlap, or the timer racing an adminSnsRun*Check) both pass the
  // cooldown and submit DUPLICATE treasury/motion proposals. Claimed
  // synchronously right before each submit await and released on both outcomes,
  // so only one run per root can submit. Shared across the three check types:
  // they run sequentially within a sweep, so this only blocks a concurrent
  // (admin-vs-timer) check of the same root, deferring it one cycle.
  transient let snsCheckInFlight : Set.Set<Principal> = Set.empty<Principal>();

  // ---------------------------------------------------------------------------
  // History recording: per-owner balance events, operational/audit log, and
  // service-metrics snapshots. All newest-first, capped via
  // History.prependCapped — same shape as lpHistory/harvestHistory. Caps are
  // constants (not AdminSettings) following the MAX_LP_EVENTS precedent.
  // ---------------------------------------------------------------------------

  let MAX_BALANCE_EVENTS_PER_OWNER : Nat = 500;
  let MAX_LOG_ENTRIES : Nat = 1_000;
  let MAX_METRICS_SNAPSHOTS : Nat = 4096; // > 1 year of snapshots at the default check interval

  // owner → newest-first balance events (owner = person or SNS root).
  let balanceEvents : Map.Map<Principal, [BalanceEvent]> = Map.empty();
  var logEntries : [LogEntry] = [];
  var logSeq : Nat = 0;
  var metricsSnapshots : [MetricsSnapshot] = [];

  // Audit counters (stable; never decremented):
  var cumulativeTopUpsSucceeded : Nat = 0;
  var cumulativeTopUpsFailed : Nat = 0;
  var cumulativeTopUpTcycles : Nat = 0; // successful top-up volume
  var lastCycleCheckAt : ?Nat = null; // ns of the last completed sweep

  func recordBalanceEvent(
    owner : Principal,
    token : Token,
    amount : Nat,
    direction : { #credit; #debit },
    kind : Types.BalanceEventKind,
  ) {
    let prior = switch (balanceEvents.get(owner)) {
      case (?arr) arr;
      case null { [] };
    };
    let event : BalanceEvent = { at = Int.abs(Time.now()); token; amount; direction; kind };
    balanceEvents.add(owner, History.prependCapped(prior, event, MAX_BALANCE_EVENTS_PER_OWNER));
  };

  func log(level : Types.LogLevel, category : Types.LogCategory, message : Text, caller : ?Principal) {
    logSeq += 1;
    let entry : LogEntry = { seq = logSeq; at = Int.abs(Time.now()); level; category; message; caller };
    logEntries := History.prependCapped(logEntries, entry, MAX_LOG_ENTRIES);
  };

  func recordReading(
    canisterId : Principal,
    result : { #ok : Nat; #err : Text },
  ) {
    let reading : CycleReading = { recordedAt = Int.abs(Time.now()); result };
    cycleHistory.add(canisterId, History.prependCapped(readingsFor(canisterId), reading, settings.maxReadingsPerCanister));
  };

  func readingsFor(canisterId : Principal) : [CycleReading] {
    switch (cycleHistory.get(canisterId)) {
      case null { [] };
      case (?arr) { arr };
    };
  };

  func recordTopUp(
    owner : Principal,
    canisterId : Principal,
    amount : Nat,
    result : { #ok : Nat; #err : Text },
    swap : ?SwapAttempt,
    serviceFee : Nat,
    feeError : ?Text,
    rebateApplied : Nat,
  ) {
    let entry : TopUp = {
      attemptedAt = Int.abs(Time.now());
      amount;
      result;
      swap;
      serviceFee;
      feeError;
      rebateApplied;
    };
    let userMap = switch (topUpHistory.get(owner)) {
      case (?m) m;
      case null {
        let fresh = Map.empty<Principal, [TopUp]>();
        topUpHistory.add(owner, fresh);
        fresh;
      };
    };
    let prior = switch (userMap.get(canisterId)) {
      case (?arr) arr;
      case null { [] };
    };
    userMap.add(canisterId, History.prependCapped(prior, entry, settings.maxTopUpsPerCanister));

    // Counters + operational log + balance events. This is the single choke
    // point both passes record through, so every top-up attempt lands here.
    switch (result) {
      case (#ok _) {
        cumulativeTopUpsSucceeded += 1;
        cumulativeTopUpTcycles += amount;
        log(#info, #topUp, "top-up " # canisterId.toText() # " +" # amount.toText() # " cycles for " # owner.toText(), null);
        // Record the post-top-up balance as a fresh reading so the canister's
        // cycle-balance jump shows in the UI immediately, without waiting for
        // the next sweep (todo-17). Anchored on the reading taken moments ago in
        // this same firing; skipped if somehow no #ok reading exists.
        switch (History.postTopUpBalance(readingsFor(canisterId), amount)) {
          case (?bal) { recordReading(canisterId, #ok bal) };
          case null {};
        };
        recordBalanceEvent(owner, #TCYCLES, amount + tcyclesLedgerFee, #debit, #topUp { canisterId });
        // Fee charge moved tokens only when no transfer error and a net fee was
        // due; a fully-rebated charge moves nothing but still records the
        // rebate usage (amount 0, rebateApplied > 0).
        if (feeError == null and (serviceFee > 0 or rebateApplied > 0)) {
          let feeDelta = if (serviceFee > 0) serviceFee + tcyclesLedgerFee else 0;
          recordBalanceEvent(owner, #TCYCLES, feeDelta, #debit, #feeCharge { canisterId; rebateApplied });
        };
      };
      case (#err msg) {
        cumulativeTopUpsFailed += 1;
        log(#error, #topUp, "top-up " # canisterId.toText() # " failed for " # owner.toText() # ": " # msg, null);
      };
    };
    switch (feeError) {
      case (?msg) { log(#error, #fee, "fee transfer failed for " # owner.toText() # " (" # canisterId.toText() # "): " # msg, null) };
      case null {};
    };
    // Swap/mint funding legs: ICP debited from the owner's subaccount (fee
    // overhead differs per source — see prepareAndDepositIcp / mintForParticipant)
    // and TCYCLES delivered into it. A swap-source `#err` outcome means the
    // ICP was recovered back to the subaccount (only fees leaked) — no debit
    // event; a mint-source `#err` with a contribution means the ICP is parked
    // at the CMC, so the subaccount debit is real.
    switch (swap) {
      case (?s) {
        let consumed = switch (s.source, s.outcome) {
          case (#swap, #err _) { false };
          case (_, _) { s.amountIn > 0 };
        };
        if (consumed) {
          let feeOverhead = switch (s.source) {
            case (#swap) { 3 * icpLedgerFee };
            case (#mint) { icpLedgerFee };
          };
          let fundingKind : Types.BalanceEventKind = switch (s.source) {
            case (#swap) { #swapFunding { canisterId } };
            case (#mint) { #mintFunding { canisterId } };
          };
          recordBalanceEvent(owner, #ICP, s.amountIn + feeOverhead, #debit, fundingKind);
        };
        if (s.amountOut > 0) {
          let deliveryKind : Types.BalanceEventKind = switch (s.source) {
            case (#swap) { #swapDelivery { canisterId } };
            case (#mint) { #mintDelivery { canisterId } };
          };
          recordBalanceEvent(owner, #TCYCLES, s.amountOut, #credit, deliveryKind);
        };
      };
      case null {};
    };
  };

  func topUpsFor(owner : Principal, canisterId : Principal) : [TopUp] {
    switch (topUpHistory.get(owner)) {
      case null { [] };
      case (?userMap) {
        switch (userMap.get(canisterId)) {
          case null { [] };
          case (?arr) { arr };
        };
      };
    };
  };

  // Drops a (owner, canisterId) from the per-owner tracking + top-up history,
  // and drops the shared `cycleHistory[canisterId]` row iff no other owner
  // still tracks the canister. Called by the inline suspend-expiry branch in
  // the cycle-check sweeps and by the explicit `removeCanister` update — both
  // manual and timer-driven removal converge on this one helper.
  func removeTrackedEntry(owner : Principal, canisterId : Principal) {
    switch (tracked.get(owner)) {
      case null {};
      case (?userMap) { ignore userMap.delete(canisterId) };
    };
    switch (topUpHistory.get(owner)) {
      case null {};
      case (?userMap) { ignore userMap.delete(canisterId) };
    };
    // Scan the live `tracked` post-mutation: the just-removed owner is
    // correctly excluded. If no other owner still tracks the canister, drop
    // the shared readings — otherwise leave them for the remaining trackers.
    var stillTracked = false;
    label scan for ((_otherOwner, otherMap) in tracked.entries()) {
      switch (otherMap.get(canisterId)) {
        case (?_) { stillTracked := true; break scan };
        case null {};
      };
    };
    if (not stillTracked) {
      ignore cycleHistory.delete(canisterId);
    };
  };

  func inFlightContains(owner : Principal, canisterId : Principal) : Bool {
    switch (topUpsInFlight.get(owner)) {
      case null { false };
      case (?set) { set.contains(canisterId) };
    };
  };

  func inFlightAdd(owner : Principal, canisterId : Principal) {
    let set = switch (topUpsInFlight.get(owner)) {
      case (?s) s;
      case null {
        let fresh = Set.empty<Principal>();
        topUpsInFlight.add(owner, fresh);
        fresh;
      };
    };
    set.add(canisterId);
  };

  func inFlightRemove(owner : Principal, canisterId : Principal) {
    switch (topUpsInFlight.get(owner)) {
      case null {};
      case (?set) { ignore set.delete(canisterId) };
    };
  };

  // SNS admin nested-set helpers (US27), copying the inFlight* idiom. Whether a
  // caller may act for a root, and the additive grant `snsGrantAdmin` drives.
  func isSnsAdmin(caller : Principal, root : Principal) : Bool {
    if (caller.isAnonymous()) return false;
    switch (snsAdmins.get(root)) {
      case null { false };
      case (?set) { set.contains(caller) };
    };
  };

  func snsAddAdmin(root : Principal, admin : Principal) {
    let set = switch (snsAdmins.get(root)) {
      case (?s) s;
      case null { let fresh = Set.empty<Principal>(); snsAdmins.add(root, fresh); fresh };
    };
    set.add(admin);
  };

  // Revoke one admin (US28), mirroring `inFlightRemove`: a missing root/entry is
  // a no-op and the now-empty set stays in place (reads back identically through
  // `getSnsAdmins`/`getMySnsAdminRoots`).
  func snsRemoveAdmin(root : Principal, admin : Principal) {
    switch (snsAdmins.get(root)) {
      case null {};
      case (?set) { ignore set.delete(admin) };
    };
  };

  func requireSnsAdmin(caller : Principal, root : Principal, method : Text) {
    if (not isSnsAdmin(caller, root)) {
      Runtime.trap(method # ": caller is not an admin for this SNS");
    };
  };

  // Per-top-up fee charge (US16). A single `icrc1_transfer` from the user's
  // TCYCLES deposit subaccount to `toSubaccount` on the backend — `null` is the
  // default account (the fee pool → LP, US16); a primary-admin deposit
  // subaccount is the redirected service-funding destination (US17). The
  // cycles-ledger fee is paid by the user out of the same subaccount. The
  // function never mutates state — the caller decides whether to record
  // `serviceFee = fee` or `serviceFee = 0; feeError = ?msg`.
  func chargeServiceFee(owner : Principal, fee : Nat, toSubaccount : ?Blob) : async { #ok; #err : Text } {
    if (fee == 0) return #ok;
    let ledger : ICRC1.Self = actor (Tokens.ledgerCanisterId(#TCYCLES).toText());
    try {
      let r = await ledger.icrc1_transfer({
        from_subaccount = ?Subaccount.ofPrincipal(owner);
        to = { owner = Principal.fromActor(self); subaccount = toSubaccount };
        amount = fee;
        fee = ?tcyclesLedgerFee;
        memo = null;
        created_at_time = null;
      });
      switch (r) {
        case (#Ok _)    { #ok };
        case (#Err err) { #err("fee transfer failed: " # debug_show err) };
      };
    } catch (e) {
      #err("tcycles ledger unreachable (fee transfer): " # e.message());
    };
  };

  // ---------------------------------------------------------------------------
  // Loyalty accounting helpers (US18). `settle` banks reward accrued since the
  // last checkpoint; `applyFeeCharge` is the single fee path both top-up passes
  // call — it settles, applies the rebate as a pure discount, charges only the
  // net, and books all accounting on success.
  // ---------------------------------------------------------------------------

  func accountOf(owner : Principal) : LoyaltyAccount {
    switch (loyalty.get(owner)) {
      case (?a) a;
      case null { Loyalty.empty() };
    };
  };

  // Bank any reward accrued since the last checkpoint into `accrued`, then
  // re-checkpoint rewardDebt to the current accumulator. Shares unchanged here.
  // Any banked credit lands in the owner's balance-event stream as
  // `#rebateSettled` — pure accounting, excluded from deposit reconstruction.
  func settle(owner : Principal) {
    let before = accountOf(owner);
    let after = Loyalty.settle(before, accRewardPerShare);
    if (after.accrued > before.accrued) {
      recordBalanceEvent(owner, #TCYCLES, after.accrued - before.accrued, #credit, #rebateSettled);
    };
    loyalty.add(owner, after);
  };

  // Settles the caller, applies the rebate as a pure discount, charges only the
  // net fee, and books all accounting on success. Returns (netCharged, rebateApplied, ?feeErr).
  // On transfer failure nothing is booked (0, 0, ?msg) — matches US16/17 semantics.
  func applyFeeCharge(owner : Principal, grossFee : Nat, toSubaccount : ?Blob, toService : Bool) : async (Nat, Nat, ?Text) {
    if (grossFee == 0) return (0, 0, null);
    settle(owner);
    let a0 = accountOf(owner);
    let rebate = Loyalty.rebateFor(a0, grossFee);
    let net = grossFee - rebate : Nat;
    // Reserve the rebate BEFORE the await. The per-pair `topUpsInFlight` guard
    // does not serialise two canisters of the same owner (timer firing vs a
    // manual `recordCyclesNow`), so two charges for one owner can interleave
    // their awaits. Reserving up-front makes the second charge see the reduced
    // `accrued`, preventing a double-spend of the same credit (and the
    // underflow trap `accrued - rebate` would otherwise hit). Restored on #err.
    loyalty.add(owner, Loyalty.reserveRebate(a0, rebate));
    switch (await chargeServiceFee(owner, net, toSubaccount)) {
      case (#ok) {
        settle(owner); // re-settle for any harvest during the await
        loyalty.add(owner, Loyalty.onChargeSuccess(accountOf(owner), accRewardPerShare, net));
        cumulativeRebatesGrantedTcycles += rebate;
        cumulativeFeesTcycles += net; // US16 counter == total shares; now net
        if (toService) {
          cumulativeServiceFundingTcycles += net; // US17 counter, now net
          if (net > 0) {
            switch (primaryAdmin) {
              case (?admin) { recordBalanceEvent(admin, #TCYCLES, net, #credit, #serviceFunding) };
              case null {};
            };
          };
        };
        (net, rebate, null);
      };
      case (#err msg) {
        settle(owner); // bank any harvest during the await…
        loyalty.add(owner, Loyalty.unreserveRebate(accountOf(owner), rebate)); // …then un-reserve
        (0, 0, ?msg);
      };
    };
  };

  // Live read of the fee pool (the backend's default TCYCLES account). Ground
  // truth for the LP drain + admin LP info; throws collapse to 0.
  func feePoolBalance() : async Nat {
    let ledger : ICRC1.Self = actor (Tokens.ledgerCanisterId(#TCYCLES).toText());
    try {
      await ledger.icrc1_balance_of({
        owner = Principal.fromActor(self);
        subaccount = null;
      });
    } catch (_) { 0 };
  };

  // Reads the owner's TCYCLES deposit-subaccount balance — mirror of
  // `icpBalanceOf`, same throw-to-0 shape. Used by the fee-affordability gate.
  func tcyclesBalanceOf(owner : Principal) : async Nat {
    let ledger : ICRC1.Self = actor (Tokens.ledgerCanisterId(#TCYCLES).toText());
    try {
      await ledger.icrc1_balance_of({
        owner = Principal.fromActor(self);
        subaccount = ?Subaccount.ofPrincipal(owner);
      });
    } catch (_) { 0 };
  };

  // Fee-routing decision for a top-up firing (US17). Resolved once per
  // `runTopUps` invocation (decision 4) so every fee in the batch targets the
  // same destination and the primary-admin subaccount is read only once. When a
  // primary admin is set, the threshold is non-zero, and that admin's deposit
  // subaccount is below the threshold, `subaccount` is the admin's deposit
  // subaccount and `toService` is true; otherwise `subaccount = null` (the fee
  // pool, default account) and `toService` is false.
  func resolveFeeRouting() : async Types.FeeRouting {
    switch (primaryAdmin) {
      case null { { subaccount = null; toService = false; subaccountBalance = 0 } };
      case (?admin) {
        let bal = await tcyclesBalanceOf(admin);
        if (settings.serviceFundingThresholdTcycles > 0 and bal < settings.serviceFundingThresholdTcycles) {
          { subaccount = ?Subaccount.ofPrincipal(admin); toService = true; subaccountBalance = bal };
        } else {
          { subaccount = null; toService = false; subaccountBalance = bal };
        };
      };
    };
  };

  // Performs the direct cycles-ledger withdraw and returns a structured
  // outcome to the caller. Sets the per-pair in-flight guard before the await
  // and leaves it set on return — the caller (`runTopUps`) clears it AFTER
  // recording the outcome, so a concurrent `removeCanister` cannot slip in
  // between the await's resumption and the `recordTopUp` write and leak a
  // zombie history row. The `#insufficientFunds` outcome also leaves the flag
  // set: those pairs flow into Pass 2's saga retry, which clears the flag
  // after its own `recordTopUp`.
  //   - `#ok n`               : block index — record success, then clear flag.
  //   - `#insufficientFunds`  : candidate for the pass-2 group swap; flag stays
  //                             set until Pass 2 records and clears.
  //   - `#fail msg`           : non-recoverable; record as #err msg, then clear.
  //   - `#skipped`            : silent skip, the guard fired (flag was never
  //                             added by this call, so the caller must NOT
  //                             clear it).
  func attemptDirectTopUp(
    owner : Principal,
    canisterId : Principal,
    amount : Nat,
    serviceFee : Nat,
  ) : async Types.DirectTopUpOutcome {
    if (inFlightContains(owner, canisterId)) return #skipped;
    inFlightAdd(owner, canisterId);

    // Fee-affordability gate (decision 2): only deliver when the subaccount
    // also covers the service fee + both ledger fees, so a thin balance can't
    // make the withdraw succeed while the fee transfer fails (free service).
    // Below threshold behaves exactly like the cycles ledger's own
    // InsufficientFunds — the pair falls into Pass 2's fee-inclusive deficit.
    // `serviceFee` here is the GROSS fee — do NOT net out any loyalty rebate
    // (US18). A rebate only ever reduces what the user pays, so gating on the
    // gross stays conservatively correct; netting it would let a thin balance
    // pass the gate and then fail the actual (net) fee transfer.
    let needed = SwapMath.directTopUpNeeded(amount, serviceFee, tcyclesLedgerFee);
    let balance = await tcyclesBalanceOf(owner);
    if (balance < needed) { return #insufficientFunds { balance } };

    try {
      let result = await cyclesLedger.withdraw({
        from_subaccount = ?Subaccount.ofPrincipal(owner);
        to = canisterId;
        amount;
        created_at_time = null;
      });
      switch (result) {
        case (#Ok blockIndex) { #ok blockIndex };
        case (#Err(#InsufficientFunds { balance })) {
          #insufficientFunds { balance };
        };
        case (#Err err) { #fail(Errors.withdraw(err)) };
      };
    } catch (e) {
      #fail("cycles ledger unreachable: " # e.message());
    };
  };

  // ---------------------------------------------------------------------------
  // Group-swap saga (US12). Aggregate demand → quote loop with ICP-affordability
  // drop-out → per-participant icrc1_transfer + icrc2_approve + pool.depositFrom
  // → single pool.swap → proportional split-deliver via pool.withdrawToSubaccount
  // → caller retries the cycles-ledger withdraw per participant.
  // ---------------------------------------------------------------------------

  // Saga resolutions are accumulated into a List of tuples and returned as
  // an immutable `[(owner, canisterId, SwapResolution)]` — `async` return
  // types must be shared, so a mutable Map can't cross the saga's async
  // boundary back to the orchestrator. The orchestrator's lookup is O(N)
  // linear search, fine for the small participant counts a single firing
  // produces.
  func putResolution(
    resolutions : List.List<Types.ResolutionEntry>,
    owner : Principal,
    canisterId : Principal,
    resolution : Types.SwapResolution,
  ) {
    resolutions.add((owner, canisterId, resolution));
  };

  func findResolution(
    resolutions : [Types.ResolutionEntry],
    owner : Principal,
    canisterId : Principal,
  ) : ?Types.SwapResolution {
    for ((o, c, r) in resolutions.vals()) {
      if (Principal.equal(o, owner) and Principal.equal(c, canisterId)) {
        return ?r;
      };
    };
    null;
  };

  // Reads the owner's ICP deposit subaccount balance. Returns 0 on a thrown
  // call so a transient ICP-ledger blip drops the participant cleanly rather
  // than cascading the saga.
  func icpBalanceOf(owner : Principal) : async Nat {
    let icpLedger : ICRC1.Self = actor (Tokens.ledgerCanisterId(#ICP).toText());
    try {
      await icpLedger.icrc1_balance_of({
        owner = Principal.fromActor(self);
        subaccount = ?Subaccount.ofPrincipal(owner);
      });
    } catch (_) { 0 };
  };

  // Probes the pool's `quote` for a seed `amountIn` and arithmetically
  // inverts to compute the input ICP that yields `targetTcyclesOut`. ICPSwap
  // V3 returns unspent input back on the swap itself, so a probe-and-invert
  // is sufficient — no need to bisect.
  func quoteGroupSwap(targetTcyclesOut : Nat) : async {
    #ok : Nat;
    #err : Text;
  } {
    if (targetTcyclesOut == 0) return #ok 0;
    // Probe with a fixed 1 ICP (e8s). `quoteInvert` cancels the seed for the
    // pool's (near-linear) V3 quote, so the probe only needs to be ICP-scale
    // and within pool liquidity. Sizing it from the cycles-denominated target
    // mis-scaled the seed by ~xpe (a multi-thousand-ICP probe the pool can't
    // quote, returning 0), which wrongly forced the mint route every firing.
    let seedIcp : Nat = 100_000_000;
    let result = try {
      await icpSwapPool().quote({
        amountIn = seedIcp.toText();
        zeroForOne = true;
        amountOutMinimum = "0";
      });
    } catch (e) {
      return #err("swap pool unreachable (quote): " # e.message());
    };
    switch (result) {
      case (#err e) { #err(Errors.pool(e, "quote")) };
      case (#ok quotedOut) {
        if (quotedOut == 0) {
          #err("quote returned zero output");
        } else {
          #ok(SwapMath.quoteInvert(seedIcp, targetTcyclesOut, quotedOut));
        };
      };
    };
  };

  // The CMC's flat ICP→cycles rate, in cycles per ICP e8s (US30). Identity:
  // cycles/ICP `= (xpe / 10_000)·10¹² = xpe·10⁸`, and `1 ICP = 10⁸ e8s`, so per
  // e8s the rate is exactly `xdr_permyriad_per_icp`. Returns `#err` if the CMC
  // is unreachable so the rate gate can fall back to the swap path.
  func cmcCyclesPerE8s() : async { #ok : Nat; #err : Text } {
    try {
      let r = await cmc.get_icp_xdr_conversion_rate();
      #ok(Nat64.toNat(r.data.xdr_permyriad_per_icp));   // cycles per e8s == xpe
    } catch (e) { #err("cmc unreachable (rate): " # e.message()) };
  };

  // Stages a participant's ICP into the pool. ICPSwap V3's `depositFrom`
  // pulls from `(caller, null)` (the backend's default account), so the
  // saga first icrc1_transfers funds from the user's ICP subaccount to the
  // backend's default account, then approves + depositFrom's `share` to
  // the pool. Total ICP debited from the user subaccount =
  // `share + 3 * icpLedgerFee` (one fee on the staging transfer, one on the
  // approve, one on the pool's icrc2_transfer_from). Returns the amount
  // actually credited inside the pool on success.
  func prepareAndDepositIcp(owner : Principal, share : Nat) : async {
    #ok : Nat;
    #err : Text;
  } {
    let icpLedger : ICRC1.Self = actor (Tokens.ledgerCanisterId(#ICP).toText());
    let icpLedger2 : ICRC2.Self = actor (Tokens.ledgerCanisterId(#ICP).toText());
    let stagingAmount : Nat = share + 2 * icpLedgerFee;
    let stageOutcome = try {
      let r = await icpLedger.icrc1_transfer({
        from_subaccount = ?Subaccount.ofPrincipal(owner);
        to = { owner = Principal.fromActor(self); subaccount = null };
        amount = stagingAmount;
        fee = ?icpLedgerFee;
        memo = null;
        created_at_time = null;
      });
      switch (r) {
        case (#Ok _) { #ok };
        case (#Err err) { #err("stage transfer failed: " # debug_show err) };
      };
    } catch (e) {
      #err("icp ledger unreachable (stage transfer): " # e.message());
    };
    switch (stageOutcome) {
      case (#err msg) { return #err msg };
      case (#ok) {};
    };
    let approveOutcome = try {
      let r = await icpLedger2.icrc2_approve({
        from_subaccount = null;
        spender = { owner = swapPoolId; subaccount = null };
        amount = share + icpLedgerFee;
        expected_allowance = null;
        expires_at = null;
        fee = ?icpLedgerFee;
        memo = null;
        created_at_time = null;
      });
      switch (r) {
        case (#Ok _) { #ok };
        case (#Err err) { #err("approve failed: " # debug_show err) };
      };
    } catch (e) {
      #err("icp ledger unreachable (approve): " # e.message());
    };
    switch (approveOutcome) {
      case (#err msg) { return #err msg };
      case (#ok) {};
    };
    let depositResult = try {
      await icpSwapPool().depositFrom({
        token = Tokens.ledgerCanisterId(#ICP).toText();
        amount = share;
        fee = icpLedgerFee;
      });
    } catch (e) {
      return #err("swap pool unreachable (depositFrom): " # e.message());
    };
    switch (depositResult) {
      case (#err e) { #err(Errors.pool(e, "depositFrom")) };
      case (#ok credited) { #ok credited };
    };
  };

  // Returns the pool credit back to the owner's ICP subaccount on a swap
  // failure. `#recovered` means the funds landed in the subaccount; `#stuck`
  // means they're still credited to the backend inside the pool.
  func recoverIcpForParticipant(owner : Principal, amount : Nat) : async {
    #recovered;
    #stuck;
  } {
    try {
      let r = await icpSwapPool().withdrawToSubaccount({
        token = Tokens.ledgerCanisterId(#ICP).toText();
        fee = icpLedgerFee;
        amount;
        subaccount = Subaccount.ofPrincipal(owner);
      });
      switch (r) {
        case (#ok _) { #recovered };
        case (#err _) { #stuck };
      };
    } catch (_) { #stuck };
  };

  // The saga itself. Returns the per-participant resolutions as an
  // immutable array; the orchestrator walks them, retries the cycles-ledger
  // withdraw per successful participant, and records each `TopUp`.
  func runGroupSwap(initialDemand : [Types.SwapDemand]) : async [Types.ResolutionEntry] {
    let resolutions = List.empty<Types.ResolutionEntry>();
    if (initialDemand.size() == 0) return resolutions.toArray();

    // ---- Quote loop with affordability drop-out (decisions 4 & 5 step 2) ----
    var survivors : [Types.SwapDemand] = initialDemand;
    var quotedInputIcp : Nat = 0;
    label quoteLoop loop {
      let groupDemand = SwapMath.sumDeficits(survivors);
      if (groupDemand == 0) { quotedInputIcp := 0; break quoteLoop };
      // `targetOut` adds a flat `tcyclesLedgerFee` per surviving participant on
      // top of the 10% buffer. Reason: each participant's `pool.withdrawToSubaccount`
      // deducts `tcyclesLedgerFee` from `share` before crediting the user's
      // subaccount, so the landed amount is `share - tcyclesLedgerFee`. Without
      // the per-participant correction, a small deficit (≲ 10 × tcyclesLedgerFee)
      // leaves the post-withdraw TCYCLES balance below the cycles-ledger retry
      // amount + fee, even after a successful swap.
      let targetOut = SwapMath.overPurchaseTarget(groupDemand, survivors.size(), tcyclesLedgerFee);
      let quotedInput = switch (await quoteGroupSwap(targetOut)) {
        case (#err msg) {
          // Whole-group quote failure: every survivor gets a quote-failed entry.
          for (d in survivors.vals()) {
            putResolution(
              resolutions,
              d.owner,
              d.canisterId,
              {
                icpContribution = 0;
                tcyclesDelivered = 0;
                outcome = #err("group quote failed: " # msg);
              },
            );
          };
          return resolutions.toArray();
        };
        case (#ok n) { n };
      };

      let kept = List.empty<Types.SwapDemand>();
      var dropped : Nat = 0;
      for (d in survivors.vals()) {
        let share = SwapMath.proportionalShare(quotedInput, d.deficit, groupDemand);
        let balance = await icpBalanceOf(d.owner);
        let need = share + 3 * icpLedgerFee;
        if (balance < need) {
          putResolution(
            resolutions,
            d.owner,
            d.canisterId,
            {
              icpContribution = 0;
              tcyclesDelivered = 0;
              outcome = #err(
                "insufficient ICP for proportional share: needed "
                # need.toText()
                # ", had "
                # balance.toText()
              );
            },
          );
          dropped += 1;
        } else {
          kept.add(d);
        };
      };
      if (dropped == 0) {
        quotedInputIcp := quotedInput;
        break quoteLoop;
      };
      survivors := kept.toArray();
    };
    if (survivors.size() == 0) return resolutions.toArray();

    // ---- Step 3: per-participant stage + approve + depositFrom ----
    type Staged = { demand : Types.SwapDemand; deposited : Nat };
    let deposited = List.empty<Staged>();
    let groupDemand = SwapMath.sumDeficits(survivors);
    for (d in survivors.vals()) {
      let share = SwapMath.proportionalShare(quotedInputIcp, d.deficit, groupDemand);
      switch (await prepareAndDepositIcp(d.owner, share)) {
        case (#err msg) {
          putResolution(
            resolutions,
            d.owner,
            d.canisterId,
            {
              icpContribution = 0;
              tcyclesDelivered = 0;
              outcome = #err msg;
            },
          );
        };
        case (#ok credited) {
          deposited.add({ demand = d; deposited = credited });
        };
      };
    };
    if (deposited.size() == 0) return resolutions.toArray();

    // ---- Step 4: single pool.swap call ----
    // amountIn = sum of actual depositedSurvivors' contributions. The floor
    // (`amountOutMinimum`) is the bare aggregate: enough TCYCLES so that
    // after each `withdrawToSubaccount` debits its `tcyclesLedgerFee`, the
    // credited totals still cover `survivingDemand`. It is intentionally
    // below the over-purchase target that sized `totalIcpIn` (step 2's
    // `quotedInput` aimed for 1.1 × demand + n × fee); the 10% gap is the
    // slippage cushion the `SWAP_OVER_PURCHASE` buffer exists for. Returns
    // between this floor and the target are acceptable — excess TCYCLES
    // land in user subaccounts and reduce the next firing's pass-1 cost.
    // Only catastrophic slippage (>10%) aborts and triggers per-participant
    // ICP recovery below.
    var totalIcpIn : Nat = 0;
    var survivingDemand : Nat = 0;
    for (s in deposited.values()) {
      totalIcpIn += s.deposited;
      survivingDemand += s.demand.deficit;
    };
    let amountOutMinimum = survivingDemand + deposited.size() * tcyclesLedgerFee;
    let swapOutcome = try {
      await icpSwapPool().swap({
        amountIn = totalIcpIn.toText();
        zeroForOne = true;
        amountOutMinimum = amountOutMinimum.toText();
      });
    } catch (e) {
      // Swap call failed before any TCYCLES landed — recover each survivor's ICP.
      for (s in deposited.values()) {
        let recovery = await recoverIcpForParticipant(s.demand.owner, s.deposited);
        let outcome = switch (recovery) {
          case (#recovered) {
            #err("group swap failed: pool unreachable (swap): " # e.message());
          };
          case (#stuck) {
            #stuckInPool { token = "ICP"; amount = s.deposited };
          };
        };
        putResolution(
          resolutions,
          s.demand.owner,
          s.demand.canisterId,
          {
            icpContribution = s.deposited;
            tcyclesDelivered = 0;
            outcome;
          },
        );
      };
      return resolutions.toArray();
    };
    let amountOut = switch (swapOutcome) {
      case (#err e) {
        let msg = Errors.pool(e, "swap");
        for (s in deposited.values()) {
          let recovery = await recoverIcpForParticipant(s.demand.owner, s.deposited);
          let outcome = switch (recovery) {
            case (#recovered) { #err("group swap failed: " # msg) };
            case (#stuck) {
              #stuckInPool { token = "ICP"; amount = s.deposited };
            };
          };
          putResolution(
            resolutions,
            s.demand.owner,
            s.demand.canisterId,
            {
              icpContribution = s.deposited;
              tcyclesDelivered = 0;
              outcome;
            },
          );
        };
        return resolutions.toArray();
      };
      case (#ok n) { n };
    };

    // ---- Step 5: proportional split-deliver via withdrawToSubaccount ----
    let depositedArr = deposited.toArray();
    let shares = SwapMath.splitWithRemainder(Array.map<Staged, Nat>(depositedArr, func(s) { s.deposited }), amountOut);
    var i : Nat = 0;
    while (i < depositedArr.size()) {
      let s = depositedArr[i];
      let share = shares[i];
      let outcome = try {
        let r = await icpSwapPool().withdrawToSubaccount({
          token = Tokens.ledgerCanisterId(#TCYCLES).toText();
          fee = tcyclesLedgerFee;
          amount = share;
          subaccount = Subaccount.ofPrincipal(s.demand.owner);
        });
        switch (r) {
          case (#ok _) {
            // The pool's `withdrawToSubaccount` debits `share` from the pool
            // balance but credits `share - tcyclesLedgerFee` to the user's
            // subaccount (the ledger fee comes out of the transfer). Record
            // the actual landed amount so the UI's "ICP → T" line matches
            // what shows up in the user's deposit balance.
            let landed : Nat = if (share > tcyclesLedgerFee) {
              share - tcyclesLedgerFee : Nat;
            } else { 0 };
            {
              icpContribution = s.deposited;
              tcyclesDelivered = landed;
              outcome = #ok : {
                #ok;
                #err : Text;
                #stuckInPool : { token : Text; amount : Nat };
              };
            };
          };
          case (#err _) {
            {
              icpContribution = s.deposited;
              tcyclesDelivered = 0;
              outcome = #stuckInPool { token = "TCYCLES"; amount = share };
            };
          };
        };
      } catch (_) {
        {
          icpContribution = s.deposited;
          tcyclesDelivered = 0;
          outcome = #stuckInPool { token = "TCYCLES"; amount = share };
        };
      };
      putResolution(resolutions, s.demand.owner, s.demand.canisterId, outcome);
      i += 1;
    };
    resolutions.toArray();
  };

  // The direct-mint saga (US30). Routed to instead of `runGroupSwap` when the
  // CMC's flat rate beats the pool's effective rate. Returns the same
  // `[ResolutionEntry]` shape so the post-saga retry + record loop consumes it
  // unchanged. Sequential per participant — the CMC has no slippage, so unlike
  // the swap there is nothing to batch. Each participant's deficit (+10% buffer,
  // shared with the swap path) is minted into their TCYCLES deposit subaccount,
  // exactly where the swap path delivers, so only the deficit is bought from ICP.
  func runGroupMint(initialDemand : [Types.SwapDemand], xpe : Nat) : async [Types.ResolutionEntry] {
    let resolutions = List.empty<Types.ResolutionEntry>();
    if (initialDemand.size() == 0) return resolutions.toArray();
    let icpLedger : ICRC1.Self = actor (Tokens.ledgerCanisterId(#ICP).toText());
    for (d in initialDemand.vals()) {
      let resolution = await mintForParticipant(icpLedger, d, xpe);
      // Operational record of the mint's actual amounts/outcome — without this
      // a failed mint surfaces only as a downstream "insufficient tcycles".
      let (lvl, detail) : (LogLevel, Text) = switch (resolution.outcome) {
        case (#ok) {
          (#info, "minted " # resolution.tcyclesDelivered.toText() # " cycles for " # resolution.icpContribution.toText() # " e8s ICP");
        };
        case (#err msg) {
          (#error, "failed (" # msg # "), icp contributed " # resolution.icpContribution.toText() # " e8s");
        };
        case (#stuckInPool s) {
          (#error, "minted " # s.amount.toText() # " " # s.token # " but deposit failed (stuck in backend)");
        };
      };
      log(lvl, #swap, "mint " # d.canisterId.toText() # " for " # d.owner.toText() # ": " # detail, null);
      putResolution(resolutions, d.owner, d.canisterId, resolution);
    };
    resolutions.toArray();
  };

  // One participant's mint: size the buy, gate on affordability, transfer ICP to
  // the CMC's top-up subaccount for the backend, notify, then re-wrap the minted
  // cycles as TCYCLES in the participant's deposit subaccount. Returns the same
  // per-participant `SwapResolution` shape `runGroupSwap` produces. A `return`
  // per failure is the mint analog of the swap path's per-participant drop.
  func mintForParticipant(icpLedger : ICRC1.Self, d : Types.SwapDemand, xpe : Nat) : async Types.SwapResolution {
    // 1–2. Target tcycles (deficit + 10% buffer) and the ICP e8s it costs at
    //      rate `xpe` (ceil-divide so the buy never under-funds the target).
    let target = (d.deficit * SwapMath.OVER_PURCHASE_NUM) / SwapMath.OVER_PURCHASE_DEN;
    let icpNeeded = SwapMath.mintIcpNeeded(target, xpe);
    // 3. Affordability — same gate shape as the swap path.
    let balance = await icpBalanceOf(d.owner);
    if (balance < icpNeeded + icpLedgerFee) {
      return {
        icpContribution = 0;
        tcyclesDelivered = 0;
        outcome = #err(
          "insufficient ICP for mint: needed "
          # (icpNeeded + icpLedgerFee).toText()
          # ", had "
          # balance.toText()
        );
      };
    };
    // 4. Transfer the ICP to the CMC's top-up account for the backend.
    let transferResult = try {
      await icpLedger.icrc1_transfer({
        from_subaccount = ?Subaccount.ofPrincipal(d.owner);
        to = {
          owner = cmcCanisterId;
          subaccount = ?Subaccount.ofPrincipal(Principal.fromActor(self));
        };
        amount = icpNeeded;
        fee = ?icpLedgerFee;
        memo = ?MEMO_TOP_UP_CANISTER;
        created_at_time = null;
      });
    } catch (e) {
      return {
        icpContribution = 0;
        tcyclesDelivered = 0;
        outcome = #err("icp ledger unreachable (mint transfer): " # e.message());
      };
    };
    let blockIndex : Nat = switch (transferResult) {
      case (#Ok n) { n };
      case (#Err err) {
        return {
          icpContribution = 0;
          tcyclesDelivered = 0;
          outcome = #err("mint transfer failed: " # debug_show err);
        };
      };
    };
    // 5. Notify the CMC. On failure the ICP is parked under the backend's CMC
    //    subaccount (operator-recoverable); the block index is the ICP-ledger
    //    block (a Nat) converted to Nat64.
    let notifyResult = try {
      await cmc.notify_top_up({
        block_index = Nat64.fromNat(blockIndex);
        canister_id = Principal.fromActor(self);
      });
    } catch (e) {
      return {
        icpContribution = icpNeeded;
        tcyclesDelivered = 0;
        outcome = #err("mint notify failed: " # e.message());
      };
    };
    let minted : Nat = switch (notifyResult) {
      case (#Ok m) { m };
      case (#Err err) {
        return {
          icpContribution = icpNeeded;
          tcyclesDelivered = 0;
          outcome = #err("mint notify failed: " # debug_show err);
        };
      };
    };
    // 6. Re-wrap the minted raw cycles as TCYCLES in the participant's subaccount.
    try {
      ignore await (with cycles = minted) cyclesLedger.deposit({
        to = {
          owner = Principal.fromActor(self);
          subaccount = ?Subaccount.ofPrincipal(d.owner);
        };
        memo = null;
      });
      { icpContribution = icpNeeded; tcyclesDelivered = minted; outcome = #ok };
    } catch (_) {
      // Cycles minted but retained in the backend's balance (not the pool) —
      // `source = #mint` flags this as a backend-stuck case to the UI.
      {
        icpContribution = icpNeeded;
        tcyclesDelivered = 0;
        outcome = #stuckInPool { token = "cycles"; amount = minted };
      };
    };
  };

  // Orchestrator wired into `performCycleCheck` and `recordCyclesNow`. Pass 1
  // runs direct withdraws and records each non-`#InsufficientFunds` outcome
  // immediately. Pass 2, if any `#InsufficientFunds` entries piled up, runs
  // the group swap and per-participant cycles-ledger retry.
  func runTopUps(candidates : [(Principal, Principal, Nat)]) : async () {
    if (candidates.size() == 0) return;

    // Snapshot the fee rate once per invocation so a mid-firing settings edit
    // can't charge two different rates to the same batch (decision 1).
    let feeBps = settings.baseServiceFeeBps;
    func computeServiceFee(amount : Nat) : Nat { SwapMath.serviceFee(amount, feeBps) };

    // Snapshot the fee destination once for the whole firing (decision 4):
    // either the primary admin's deposit subaccount (service funding) or the
    // fee pool. Read here so a mid-firing settings edit or balance change
    // can't split one batch across two destinations.
    let feeRouting = await resolveFeeRouting();

    let swapDemand = List.empty<Types.SwapDemand>();

    // ---- Pass 1: direct withdraws ----
    // Always runs. `attemptDirectTopUp` sets the per-pair `topUpsInFlight`
    // flag before its await; this loop owns the *clear*, which happens
    // AFTER `recordTopUp` so a concurrent `removeCanister` cannot fall
    // between the await's resumption and the history write. The
    // `#insufficientFunds` branch deliberately leaves the flag set —
    // Pass 2 inherits it across the saga and clears it after its own
    // `recordTopUp`. Only Pass 2's saga uses the global `groupSwapInFlight`
    // flag.
    for ((owner, canisterId, amount) in candidates.vals()) {
      let serviceFee = computeServiceFee(amount);
      switch (await attemptDirectTopUp(owner, canisterId, amount, serviceFee)) {
        case (#ok blockIndex) {
          // Gate already proved affordability; a failure here is the rare
          // concurrent-withdraw race — record feeError, keep the top-up #ok.
          // `applyFeeCharge` settles loyalty, applies any rebate as a pure
          // discount, charges only the net, and records `net` as the serviceFee.
          let (chargedFee, rebate, feeErr) = await applyFeeCharge(owner, serviceFee, feeRouting.subaccount, feeRouting.toService);
          recordTopUp(owner, canisterId, amount, #ok blockIndex, null, chargedFee, feeErr, rebate);
          inFlightRemove(owner, canisterId);
        };
        case (#fail msg) {
          recordTopUp(owner, canisterId, amount, #err msg, null, 0, null, 0);
          inFlightRemove(owner, canisterId);
        };
        case (#skipped) { /* silent — guard fired; next reading retries */ };
        case (#insufficientFunds { balance }) {
          let needed = SwapMath.directTopUpNeeded(amount, serviceFee, tcyclesLedgerFee);  // withdraw fee + fee-transfer fee
          let deficit = SwapMath.deficit(needed, balance);
          swapDemand.add(
            {
              owner;
              canisterId;
              cycleTopUpAmount = amount;
              deficit;
              tcyclesBalanceBefore = balance;
            }
          );
        };
      };
    };
    if (swapDemand.size() == 0) return;
    let demandArr = swapDemand.toArray();

    // ---- US30 rate gate: swap vs direct mint for the whole batch ----
    // Both rates are flat across the firing, so the batch routes one way as a
    // unit. `target` is the same over-purchased demand `runGroupSwap` quotes for
    // (groupDemand × 1.10 + n · fee). Mint wins iff the same ICP buys more cycles
    // by minting than swapping (`xpe · swapInputIcp > target`). If exactly one
    // rate source is reachable, use it; if neither is, every participant records
    // a rate-unavailable `#err` (no saga runs).
    let groupDemand = SwapMath.sumDeficits(demandArr);
    let target = SwapMath.overPurchaseTarget(groupDemand, demandArr.size(), tcyclesLedgerFee);
    let swapInput = await quoteGroupSwap(target);   // { #ok : Nat; #err : Text }
    let mintRate = await cmcCyclesPerE8s();          // { #ok : Nat; #err : Text }
    let route = SwapMath.chooseRoute(swapInput, mintRate, target);
    let source : { #swap; #mint } = switch (route) {
      case (#mint _) { #mint };
      case _ { #swap };
    };
    let routeLabel = switch (route) {
      case (#mint _) { "mint" };
      case (#swap) { "swap" };
      case (#none _) { "none (no rate source)" };
    };
    log(#info, #swap, "group saga: " # demandArr.size().toText() # " participant(s), route=" # routeLabel, null);

    // ---- Pass 2: group swap / mint saga ----
    // Concurrent firings during a running saga silently drop the demand
    // accumulated here; the next trigger re-aggregates them. The per-pair
    // flags carried over from Pass 1's `#insufficientFunds` outcomes must be
    // released on this drop, otherwise they leak forever and block both
    // future top-ups and `removeCanister` for those pairs.
    if (groupSwapInFlight) {
      for (d in swapDemand.values()) {
        inFlightRemove(d.owner, d.canisterId);
      };
      return;
    };
    groupSwapInFlight := true;
    let resolutions : [Types.ResolutionEntry] = try {
      switch (route) {
        case (#mint xpe) { await runGroupMint(demandArr, xpe) };
        case (#swap) { await runGroupSwap(demandArr) };
        case (#none msg) {
          // Neither rate source reachable — no saga runs; synthesise a
          // rate-unavailable `#err` for every participant.
          let buf = List.empty<Types.ResolutionEntry>();
          for (d in demandArr.vals()) {
            putResolution(
              buf,
              d.owner,
              d.canisterId,
              {
                icpContribution = 0;
                tcyclesDelivered = 0;
                outcome = #err msg;
              },
            );
          };
          buf.toArray();
        };
      };
    } catch (e) {
      // Saga itself threw — synthesise per-participant exception entries.
      log(#error, #swap, "group saga exception: " # e.message(), null);
      let buf = List.empty<Types.ResolutionEntry>();
      for (d in demandArr.vals()) {
        putResolution(
          buf,
          d.owner,
          d.canisterId,
          {
            icpContribution = 0;
            tcyclesDelivered = 0;
            outcome = #err("saga exception: " # e.message());
          },
        );
      };
      buf.toArray();
    };
    groupSwapInFlight := false;

    // ---- Per-participant retry + record ----
    // Every demand pair carries Pass 1's per-pair flag set; the in-flight
    // guard the original retry checked was a self-check that would always
    // skip under the new race-free ordering. Each branch ends with
    // `inFlightRemove` AFTER `recordTopUp` to keep `removeCanister` blocked
    // through the entire write window.
    for (demand in demandArr.vals()) {
      let resolution = switch (
        findResolution(resolutions, demand.owner, demand.canisterId)
      ) {
        case (?r) r;
        case null {
          {
            icpContribution = 0;
            tcyclesDelivered = 0;
            outcome = #err("group swap did not resolve participant");
          };
        };
      };
      let originalErr = "insufficient deposited tcycles (balance: "
      # demand.tcyclesBalanceBefore.toText() # ")";
      switch (resolution.outcome) {
        case (#ok) {
          let retryOutcome : { #ok : Nat; #err : Text } = try {
            let result = await cyclesLedger.withdraw({
              from_subaccount = ?Subaccount.ofPrincipal(demand.owner);
              to = demand.canisterId;
              amount = demand.cycleTopUpAmount;
              created_at_time = null;
            });
            switch (result) {
              case (#Ok blockIndex) { #ok blockIndex };
              case (#Err err) { #err(Errors.withdraw(err)) };
            };
          } catch (e) {
            #err("cycles ledger unreachable (retry): " # e.message());
          };
          // Charge the fee symmetrically with Pass 1 — only when the retry
          // withdraw itself succeeded (decision 3).
          var chargedFee : Nat = 0;
          var rebateApplied : Nat = 0;
          var feeErr : ?Text = null;
          switch (retryOutcome) {
            case (#ok _) {
              let (net, rebate, err) = await applyFeeCharge(demand.owner, computeServiceFee(demand.cycleTopUpAmount), feeRouting.subaccount, feeRouting.toService);
              chargedFee := net;
              rebateApplied := rebate;
              feeErr := err;
            };
            case (#err _) {};   // retry failed — no fee charged
          };
          recordTopUp(
            demand.owner,
            demand.canisterId,
            demand.cycleTopUpAmount,
            retryOutcome,
            ?{
              source;
              amountIn = resolution.icpContribution;
              amountOut = resolution.tcyclesDelivered;
              outcome = #ok;
            },
            chargedFee,
            feeErr,
            rebateApplied,
          );
          inFlightRemove(demand.owner, demand.canisterId);
        };
        case (#err msg) {
          recordTopUp(
            demand.owner,
            demand.canisterId,
            demand.cycleTopUpAmount,
            // Lead with the actual saga failure; the deposit shortfall that
            // triggered the saga is the de-emphasized tail, not the headline.
            #err(msg # " — " # originalErr),
            ?{
              source;
              amountIn = resolution.icpContribution;
              amountOut = 0;
              outcome = #err msg;
            },
            0,
            null,
            0,
          );
          inFlightRemove(demand.owner, demand.canisterId);
        };
        case (#stuckInPool stuck) {
          recordTopUp(
            demand.owner,
            demand.canisterId,
            demand.cycleTopUpAmount,
            #err("minted " # stuck.amount.toText() # " " # stuck.token # " but the deposit failed (stuck in backend) — " # originalErr),
            ?{
              source;
              amountIn = resolution.icpContribution;
              amountOut = resolution.tcyclesDelivered;
              outcome = #stuckInPool stuck;
            },
            0,
            null,
            0,
          );
          inFlightRemove(demand.owner, demand.canisterId);
        };
      };
    };
  };

  // ---------------------------------------------------------------------------
  // LP routing saga (US16). Drains the fee pool (backend default TCYCLES
  // account) into a single Unicycle-owned ICPSwap position once it crosses the
  // admin-tunable threshold. Three flat async steps: depositFrom the whole
  // balance, swap half to ICP, pair both halves into the position. Best-effort:
  // failures land in `lpHistory` and never raise to the originating top-up flow.
  // ---------------------------------------------------------------------------

  func recordLpEvent(event : LpEvent) {
    lpHistory := History.prependCapped(lpHistory, event, MAX_LP_EVENTS);
    switch (event.outcome) {
      case (#ok) { log(#info, #lp, "lp drain: " # event.tcyclesIn.toText() # " tcycles in, " # event.icpOut.toText() # " icp out", null) };
      case (#err msg) { log(#error, #lp, "lp drain failed: " # msg, null) };
    };
  };

  // Step 1: approve + depositFrom the whole fee balance from the backend default
  // account into the pool's unused balance. Two ledger fees (approve + the pool's
  // transfer_from); credited amount = balance - 2 * tcyclesLedgerFee.
  func depositFeesToPool(balance : Nat) : async { #ok : Nat; #err : Text } {
    let depositAmount : Nat = if (balance > 2 * tcyclesLedgerFee) { balance - 2 * tcyclesLedgerFee : Nat } else { 0 };
    if (depositAmount == 0) return #err("balance below deposit fees");
    let ledger : ICRC2.Self = actor (Tokens.ledgerCanisterId(#TCYCLES).toText());
    let approveResult = try {
      await ledger.icrc2_approve({
        from_subaccount = null;
        spender = { owner = swapPoolId; subaccount = null };
        amount = depositAmount + tcyclesLedgerFee;
        expected_allowance = null;
        expires_at = null;
        fee = ?tcyclesLedgerFee;
        memo = null;
        created_at_time = null;
      });
    } catch (e) { return #err("tcycles approve unreachable: " # e.message()) };
    switch (approveResult) {
      case (#Err err) { return #err("approve: " # debug_show err) };
      case (#Ok _)    {};
    };
    try {
      switch (await icpSwapPool().depositFrom({ token = Tokens.ledgerCanisterId(#TCYCLES).toText(); amount = depositAmount; fee = tcyclesLedgerFee })) {
        case (#err e)       { #err(Errors.pool(e, "depositFrom")) };
        case (#ok credited) { #ok credited };
      };
    } catch (e) { #err("pool depositFrom unreachable: " # e.message()) };
  };

  // Step 2: swap `half` TCYCLES → ICP. Funds are already credited to the pool
  // from step 1; the swap output is credited to the backend's pool ICP balance.
  func swapHalfTcyclesForIcp(half : Nat) : async { #ok : Nat; #err : Text } {
    // Slippage floor (FIN-1): the CMC peg is a one-way ICP→cycles mint rate, so
    // it overvalues TCYCLES on the sell leg — TCYCLES trades below peg on the
    // pool, and a peg-priced floor rejects even tiny swaps. Quote the pool for
    // this exact trade (like quoteGroupSwap) and require at least
    // (1 - swapSlippageBps) of the quoted ICP out. If the pool is unreachable or
    // quotes zero we can't price the swap, so skip it (best-effort; the next
    // drain retries) rather than swap unprotected.
    let quoted = try {
      await icpSwapPool().quote({ zeroForOne = false; amountIn = half.toText(); amountOutMinimum = "0" });
    } catch (e) { return #err("swap pool unreachable (quote): " # e.message()) };
    let quotedOut = switch (quoted) {
      case (#err e) { return #err(Errors.pool(e, "quote")) };
      case (#ok 0)  { return #err("quote returned zero output") };
      case (#ok n)  { n };
    };
    let minOut = SwapMath.slippageFloor(quotedOut, settings.swapSlippageBps);
    try {
      switch (await icpSwapPool().swap({ zeroForOne = false; amountIn = half.toText(); amountOutMinimum = minOut.toText() })) {
        case (#err e) { #err(Errors.pool(e, "swap")) };
        case (#ok n)  { #ok n };
      };
    } catch (e) { #err("pool swap unreachable: " # e.message()) };
  };

  func mintNewPosition(amount0 : Nat, amount1 : Nat) : async { #ok : Nat; #err : Text } {
    try {
      switch (await icpSwapPool().mint({
        token0 = Tokens.ledgerCanisterId(#ICP).toText();
        token1 = Tokens.ledgerCanisterId(#TCYCLES).toText();
        fee = LP_POOL_FEE;
        tickLower = LP_FULL_TICK_LOWER;
        tickUpper = LP_FULL_TICK_UPPER;
        amount0Desired = amount0.toText();
        amount1Desired = amount1.toText();
      })) {
        case (#ok id) { #ok id };
        case (#err e) { #err(Errors.pool(e, "mint")) };
      };
    } catch (e) { #err("pool mint unreachable: " # e.message()) };
  };

  func increaseExistingPosition(id : Nat, amount0 : Nat, amount1 : Nat) : async { #ok : Nat; #err : Text } {
    try {
      switch (await icpSwapPool().increaseLiquidity({ positionId = id; amount0Desired = amount0.toText(); amount1Desired = amount1.toText() })) {
        case (#ok _) { #ok id };
        case (#err e) { #err(Errors.pool(e, "increaseLiquidity")) };
      };
    } catch (e) { #err("pool increaseLiquidity unreachable: " # e.message()) };
  };

  // Step 3: mint a new full-range position or increase the existing one, pairing
  // the remaining-half TCYCLES with the swapped ICP — both already in the pool.
  func pairIntoPosition(halfTcycles : Nat, icpAmount : Nat) : async { #ok : Nat; #err : Text } {
    switch (lpPositionId) {
      case null   { await mintNewPosition(icpAmount, halfTcycles) };
      case (?id)  { await increaseExistingPosition(id, icpAmount, halfTcycles) };
    };
  };

  func runLpDrain() : async () {
    // Claim the guard synchronously, BEFORE the first await — otherwise two
    // concurrent firings (timer + manual recordCyclesNow) could both pass the
    // check and double-drain the same balance. Mirrors how `attemptDirectTopUp`
    // sets its in-flight flag before awaiting. Released on the sub-threshold
    // early return and on every step outcome below.
    if (lpDrainInFlight) return;
    lpDrainInFlight := true;
    let balance = await feePoolBalance();
    if (balance < settings.lpDrainThresholdTcycles) {
      lpDrainInFlight := false;
      return;
    };

    let now = Int.abs(Time.now());

    // ---- Step 1: approve + depositFrom the whole fee balance into the pool ----
    // No stage transfer: the fees already sit in the backend's default account,
    // which is exactly where depositFrom pulls from.
    let credited : Nat = switch (await depositFeesToPool(balance)) {
      case (#err msg) {
        recordLpEvent({ at = now; tcyclesIn = 0; icpOut = 0; positionId = lpPositionId; outcome = #err("deposit: " # msg) });
        lpDrainInFlight := false;
        return;
      };
      case (#ok n) { n };
    };
    let half = credited / 2;

    // ---- Step 2: swap one half tcycles → ICP (funds already in the pool) ----
    let swappedIcp : Nat = switch (await swapHalfTcyclesForIcp(half)) {
      case (#err msg) {
        // The deposited TCYCLES sit in the pool's unused balance and the swap
        // didn't run — pull them back to the fee pool so a floored/failed swap
        // (FIN-1) doesn't strand the batch; the next drain retries from scratch.
        let recovery = if (credited > tcyclesLedgerFee) {
          switch (await withdrawTcyclesToFeePool(credited)) { case (#ok _) { "" }; case (#err w) { "; recover failed: " # w } };
        } else { "" };
        recordLpEvent({ at = now; tcyclesIn = credited; icpOut = 0; positionId = lpPositionId; outcome = #err("swap: " # msg # recovery) });
        lpDrainInFlight := false;
        return;
      };
      case (#ok n) { n };
    };

    // ---- Step 3: pair the remaining half tcycles + swapped ICP into the LP ----
    switch (await pairIntoPosition(credited - half, swappedIcp)) {
      case (#err msg) {
        recordLpEvent({ at = now; tcyclesIn = credited; icpOut = swappedIcp; positionId = lpPositionId; outcome = #err("lp pair: " # msg) });
      };
      case (#ok newPositionId) {
        if (lpPositionId == null) { lpPositionId := ?newPositionId };
        recordLpEvent({ at = now; tcyclesIn = credited; icpOut = swappedIcp; positionId = lpPositionId; outcome = #ok });
      };
    };
    lpDrainInFlight := false;
  };

  // ---------------------------------------------------------------------------
  // Loyalty harvest saga (US18). Claims the LP position's accrued trading fees,
  // consolidates them to TCYCLES, takes the service-funding slice first (admin,
  // no accrual), leaves the remaining surplus in the fee pool for US16's drain
  // to compound into the position, and advances the reward-per-share
  // accumulator with the surplus. Best-effort like `runLpDrain`: every failure
  // lands a `#err` HarvestEvent and releases the guard, never raising to the
  // top-up flow.
  // ---------------------------------------------------------------------------

  func recordHarvestEvent(event : HarvestEvent) {
    harvestHistory := History.prependCapped(harvestHistory, event, MAX_HARVEST_EVENTS);
    switch (event.outcome) {
      case (#ok) { log(#info, #harvest, "harvest: " # event.claimedTcycles.toText() # " tcycles claimed (" # event.toAdmin.toText() # " to admin, " # event.toSurplus.toText() # " to surplus)", null) };
      case (#err msg) { log(#error, #harvest, "harvest failed: " # msg, null) };
    };
  };

  // Claim the position's accrued fees into the backend's unused pool balance.
  func claimPositionFees(positionId : Nat) : async { #ok : { amount0 : Nat; amount1 : Nat }; #err : Text } {
    try {
      switch (await icpSwapPool().claim({ positionId })) {
        case (#ok amts) { #ok amts };
        case (#err e)   { #err(Errors.pool(e, "claim")) };
      };
    } catch (e) { #err("pool claim unreachable: " # e.message()) };
  };

  // Swap claimed ICP → TCYCLES in-pool so the reward is single-unit (TCYCLES).
  // Funds are already credited to the pool from the claim; output is credited to
  // the backend's pool TCYCLES balance.
  func swapIcpForTcycles(amountIcp : Nat) : async { #ok : Nat; #err : Text } {
    // Slippage floor (FIN-1): mirror swapHalfTcyclesForIcp — expected TCYCLES out
    // priced off the CMC peg, require at least (1 - swapSlippageBps) of it, and
    // skip (best-effort retry) if the rate is unavailable.
    let xpe = switch (await cmcCyclesPerE8s()) {
      case (#ok r) { r };
      case (#err e) { return #err("no rate for slippage floor: " # e) };
    };
    if (xpe == 0) return #err("no rate for slippage floor: cmc rate zero");
    let minOut = SwapMath.slippageFloor(SwapMath.expectedTcyclesOut(amountIcp, xpe), settings.swapSlippageBps);
    try {
      switch (await icpSwapPool().swap({ zeroForOne = true; amountIn = amountIcp.toText(); amountOutMinimum = minOut.toText() })) {
        case (#ok n)  { #ok n };
        case (#err e) { #err(Errors.pool(e, "swap")) };
      };
    } catch (e) { #err("pool swap unreachable: " # e.message()) };
  };

  // Withdraw `amount` TCYCLES from the pool's unused balance to the backend's
  // default TCYCLES account (the fee pool). Returns the landed amount (net of
  // the ledger fee the pool's transfer pays).
  func withdrawTcyclesToFeePool(amount : Nat) : async { #ok : Nat; #err : Text } {
    try {
      switch (await icpSwapPool().withdrawToSubaccount({
        token = Tokens.ledgerCanisterId(#TCYCLES).toText();
        fee = tcyclesLedgerFee;
        amount;
        subaccount = Subaccount.DEFAULT;
      })) {
        case (#ok _)  { #ok(if (amount > tcyclesLedgerFee) { amount - tcyclesLedgerFee : Nat } else { 0 }) };
        case (#err e) { #err(Errors.pool(e, "withdrawToSubaccount")) };
      };
    } catch (e) { #err("pool withdraw unreachable: " # e.message()) };
  };

  // Withdraw `amount` ICP from the pool's unused balance back to the backend's
  // default ICP account. Mirrors withdrawTcyclesToFeePool; used to un-strand
  // claimed ICP when a floored harvest swap aborts (FIN-1). Returns the landed
  // amount (net of the ICP ledger fee the pool's transfer pays).
  func withdrawIcpFromPool(amount : Nat) : async { #ok : Nat; #err : Text } {
    try {
      switch (await icpSwapPool().withdrawToSubaccount({
        token = Tokens.ledgerCanisterId(#ICP).toText();
        fee = icpLedgerFee;
        amount;
        subaccount = Subaccount.DEFAULT;
      })) {
        case (#ok _)  { #ok(if (amount > icpLedgerFee) { amount - icpLedgerFee : Nat } else { 0 }) };
        case (#err e) { #err(Errors.pool(e, "withdrawToSubaccount")) };
      };
    } catch (e) { #err("pool withdraw unreachable: " # e.message()) };
  };

  // Move `amount` TCYCLES from the fee pool (backend default account) to one of
  // the backend's own deposit subaccounts. The ledger fee is paid out of the
  // fee pool. Used by the harvest's admin-first service-funding slice.
  func transferFromFeePool(amount : Nat, toSubaccount : Blob) : async { #ok; #err : Text } {
    let ledger : ICRC1.Self = actor (Tokens.ledgerCanisterId(#TCYCLES).toText());
    try {
      switch (await ledger.icrc1_transfer({
        from_subaccount = null;
        to = { owner = Principal.fromActor(self); subaccount = ?toSubaccount };
        amount;
        fee = ?tcyclesLedgerFee;
        memo = null;
        created_at_time = null;
      })) {
        case (#Ok _)    { #ok };
        case (#Err err) { #err("admin slice transfer failed: " # debug_show err) };
      };
    } catch (e) { #err("tcycles ledger unreachable (admin slice): " # e.message()) };
  };

  // Value the position's pending fees against the harvest threshold, consulting
  // the CMC rate only when the TCYCLES leg alone doesn't already clear it and
  // there is ICP owed (US18 review). Callers invoke it only when the threshold is
  // enabled (> 0). #err means the value can't be determined right now (pool or
  // rate unreachable) — the harvest couldn't complete anyway, so callers skip.
  func harvestPendingMeetsThreshold(positionId : Nat) : async { #meets; #below; #err : Text } {
    let income = try {
      switch (await icpSwapPool().refreshIncome(positionId)) {
        case (#ok inc) { inc };
        case (#err e)  { return #err(Errors.pool(e, "refreshIncome")) };
      };
    } catch (e) { return #err("pool refreshIncome unreachable: " # e.message()) };
    switch (SwapMath.harvestThresholdPrecheck(income.tokensOwed1, income.tokensOwed0, settings.harvestThresholdTcycles)) {
      case (#meets) { #meets };
      case (#below) { #below };
      case (#needsRate) {
        let xpe = switch (await cmcCyclesPerE8s()) {
          case (#ok r)  { r };
          case (#err e) { return #err("no rate to value ICP leg: " # e) };
        };
        if (xpe == 0) return #err("no rate to value ICP leg: cmc rate zero");
        let total = income.tokensOwed1 + SwapMath.expectedTcyclesOut(income.tokensOwed0, xpe);
        if (total >= settings.harvestThresholdTcycles) { #meets } else { #below };
      };
    };
  };

  func runHarvest() : async () {
    // Claim the guard synchronously before the first await — mirrors runLpDrain.
    if (harvestInFlight) return;
    harvestInFlight := true;
    let positionId = switch (lpPositionId) {
      case (?id) id;
      case null { harvestInFlight := false; return };
    };
    let now = Int.abs(Time.now());

    // 1. claim accrued fees into the pool's unused balance (ICP + TCYCLES).
    let claimed = switch (await claimPositionFees(positionId)) {
      case (#err msg) {
        recordHarvestEvent({ at = now; claimedIcp = 0; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #err("claim: " # msg) });
        harvestInFlight := false;
        return;
      };
      case (#ok amts) { amts };
    };
    let claimedIcp = claimed.amount0;

    // 2. swap claimed ICP → TCYCLES in-pool (skip if none claimed).
    let swappedTcycles = if (claimedIcp == 0) { 0 } else {
      switch (await swapIcpForTcycles(claimedIcp)) {
        case (#err msg) {
          // The claimed fees sit in the pool's unused balance and the swap
          // didn't run — pull both legs out so a floored/failed swap (FIN-1)
          // doesn't strand them: TCYCLES rejoin the fee pool (the next drain
          // folds them into the LP); ICP returns to the backend's own account
          // rather than sitting in the pool's opaque unused balance.
          let recTc = if (claimed.amount1 > tcyclesLedgerFee) {
            switch (await withdrawTcyclesToFeePool(claimed.amount1)) { case (#ok _) { "" }; case (#err w) { "; tcycles recover failed: " # w } };
          } else { "" };
          let recIcp = if (claimedIcp > icpLedgerFee) {
            switch (await withdrawIcpFromPool(claimedIcp)) { case (#ok _) { "" }; case (#err w) { "; icp recover failed: " # w } };
          } else { "" };
          recordHarvestEvent({ at = now; claimedIcp; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #err("swap: " # msg # recTc # recIcp) });
          harvestInFlight := false;
          return;
        };
        case (#ok n) { n };
      };
    };
    let poolTcycles = claimed.amount1 + swappedTcycles;
    if (poolTcycles == 0) {
      recordHarvestEvent({ at = now; claimedIcp; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #ok });
      harvestInFlight := false;
      return;
    };

    // 3. withdraw the consolidated TCYCLES to the fee pool (default account).
    let total = switch (await withdrawTcyclesToFeePool(poolTcycles)) {
      case (#err msg) {
        recordHarvestEvent({ at = now; claimedIcp; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #err("withdraw: " # msg) });
        harvestInFlight := false;
        return;
      };
      case (#ok n) { n };
    };
    if (total == 0) {
      recordHarvestEvent({ at = now; claimedIcp; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #ok });
      harvestInFlight := false;
      return;
    };

    // 4. admin-first slice (reuse US17 primary-admin + threshold); no accrual.
    //    On transfer failure the slice stays in the fee pool and falls through
    //    to the surplus, so toAdmin reflects only what actually left the pool.
    let toAdmin = switch (primaryAdmin) {
      case (?admin) {
        let bal = await tcyclesBalanceOf(admin);
        let need = if (settings.serviceFundingThresholdTcycles > bal) { settings.serviceFundingThresholdTcycles - bal : Nat } else { 0 };
        let slice = Nat.min(total, need);
        if (slice > 0) {
          switch (await transferFromFeePool(slice, Subaccount.ofPrincipal(admin))) {
            case (#ok)     { recordBalanceEvent(admin, #TCYCLES, slice, #credit, #serviceFunding); slice };
            case (#err _)  { 0 };
          };
        } else { 0 };
      };
      case null { 0 };
    };
    // The admin-slice transfer paid an extra `tcyclesLedgerFee` out of the fee
    // pool, so the tokens actually left for users are `total - toAdmin - fee`.
    // Credit the accumulator with that conservative amount (not `total -
    // toAdmin`) so cumulative credited surplus never exceeds what lands in the
    // LP. Saturate at 0 for the edge where the slice consumes nearly all of it.
    let adminCost = if (toAdmin > 0) { toAdmin + tcyclesLedgerFee } else { 0 };
    let surplus = if (total > adminCost) { total - adminCost : Nat } else { 0 }; // remains in the fee pool → US16 drain pairs it into the LP

    // 5. advance the accumulator (skip when no shares exist yet — the surplus
    //    still drains into the LP, just uncredited).
    if (surplus > 0 and cumulativeFeesTcycles > 0) {
      accRewardPerShare := Loyalty.advance(accRewardPerShare, surplus, cumulativeFeesTcycles);
      cumulativeSurplusRewardsTcycles += surplus;
    };
    recordHarvestEvent({ at = now; claimedIcp; claimedTcycles = total; toAdmin; toSurplus = surplus; outcome = #ok });
    harvestInFlight := false;
  };

  // Recurring harvest entry: apply the harvest threshold, then run the saga. A
  // sub-threshold (or unvaluable) cycle skips silently — recording an event every
  // 4h while fees accrue would churn the 30-deep harvestHistory and evict real
  // harvests. `runHarvest` re-reads the position and reclaims the guard itself.
  func runHarvestGated() : async () {
    let positionId = switch (lpPositionId) { case (?id) id; case null { return } };
    if (settings.harvestThresholdTcycles > 0) {
      switch (await harvestPendingMeetsThreshold(positionId)) {
        case (#meets) {};
        case (#below) { return };
        case (#err _) { return };
      };
    };
    await runHarvest();
  };

  // Read the live config for one pair (used by both callers below).
  func configFor(owner : Principal, canisterId : Principal) : ?CanisterConfig {
    switch (tracked.get(owner)) {
      case null { null };
      case (?userMap) { userMap.get(canisterId) };
    };
  };

  func checkCanister(owner : Principal, canisterId : Principal) : async () {
    let cyclesOpt = try {
      switch (await blackhole().canisterStatus(canisterId)) {
        case (#ok status) {
          recordReading(canisterId, #ok(status.cycles));
          ?status.cycles;
        };
        case (#err msg) {
          recordReading(canisterId, #err(msg));
          null;
        };
      };
    } catch (e) {
      recordReading(canisterId, #err("blackhole unreachable: " # e.message()));
      null;
    };
    switch (cyclesOpt) {
      case null {};
      case (?cycles) {
        switch (configFor(owner, canisterId)) {
          case null {};
          case (?cfg) {
            switch (Tracking.classifyForTopUp(cfg, cycles, Int.abs(Time.now()))) {
              case (#remove) { removeTrackedEntry(owner, canisterId) };
              case (#topUp amt) { await runTopUps([(owner, canisterId, amt)]) };
              case (#skip) {};
            };
          };
        };
      };
    };
  };

  // Owners + unique tracked canister counts (shared by adminGetMetrics and the
  // recurring metrics snapshot).
  func trackedCounts() : (Nat, Nat) {
    var ownersCount : Nat = 0;
    let canisters = Set.empty<Principal>();
    for ((_owner, userMap) in tracked.entries()) {
      ownersCount += 1;
      for ((canisterId, _cfg) in userMap.entries()) {
        canisters.add(canisterId);
      };
    };
    (ownersCount, canisters.size());
  };

  // Sample the service-level metrics into the capped snapshot history. Driven
  // by the timer at the end of each firing so consecutive snapshots can be
  // diffed into per-day series (fees collected, top-up volume, growth).
  func recordMetricsSnapshot() : async () {
    let feePool = await feePoolBalance();
    let (ownersCount, trackedCanistersCount) = trackedCounts();
    let snapshot : MetricsSnapshot = {
      at = Int.abs(Time.now());
      ownersCount;
      trackedCanistersCount;
      feePoolBalanceTcycles = feePool;
      serviceCyclesBalance = Cycles.balance();
      cumulativeFeesTcycles;
      cumulativeServiceFundingTcycles;
      cumulativeSurplusRewardsTcycles;
      cumulativeRebatesGrantedTcycles;
      cumulativeTopUpsSucceeded;
      cumulativeTopUpsFailed;
      cumulativeTopUpTcycles;
      accRewardPerShare;
      lpPositionId;
    };
    metricsSnapshots := History.prependCapped(metricsSnapshots, snapshot, MAX_METRICS_SNAPSHOTS);
  };

  // Timer entry point: the sweep plus bookkeeping that must happen once per
  // firing (completion timestamp, metrics snapshot, start/complete log lines).
  // A trap inside the sweep skips the snapshot + completion line — a missing
  // "complete" entry after a "started" one is itself the failure signal.
  func performCycleCheck() : async () {
    if (cycleCheckInFlight) {
      log(#info, #timer, "cycle check still in progress; skipping this firing", null);
      return;
    };
    cycleCheckInFlight := true;
    log(#info, #timer, "cycle check started", null);
    await runCycleSweep();
    lastCycleCheckAt := ?Int.abs(Time.now());
    await recordMetricsSnapshot();
    log(#info, #timer, "cycle check complete", null);
    cycleCheckInFlight := false;
  };

  func runCycleSweep() : async () {
    // Collect the unique set of tracked canister ids across all owners — one
    // reading per canister per firing, regardless of how many users track it.
    let seen = Map.empty<Principal, ()>();
    let ids = List.empty<Principal>();
    for ((_owner, userMap) in tracked.entries()) {
      for ((canisterId, _cfg) in userMap.entries()) {
        if (seen.get(canisterId) == null) {
          seen.add(canisterId, ());
          ids.add(canisterId);
        };
      };
    };
    if (ids.size() == 0) return;

    let idsArr = ids.toArray();
    let outcome = try {
      #ok(await blackhole().canisterStatuses(idsArr, settings.batchSize));
    } catch (e) {
      #err("blackhole unreachable: " # e.message());
    };

    switch (outcome) {
      case (#err msg) {
        log(#error, #timer, "cycle check batch failed: " # msg, null);
        for (canisterId in idsArr.vals()) {
          recordReading(canisterId, #err("batch failed: " # msg));
        };
      };
      case (#ok(#err msg)) {
        log(#error, #timer, "cycle check batch failed: " # msg, null);
        for (canisterId in idsArr.vals()) {
          recordReading(canisterId, #err("batch failed: " # msg));
        };
      };
      case (#ok(#ok results)) {
        let n = if (results.size() < idsArr.size()) results.size() else idsArr.size();
        // Track successful readings by canister id so the top-up sweep below
        // can decide per-(owner, canister) pair without re-fetching.
        let readingByCanister = Map.empty<Principal, Nat>();
        var i = 0;
        while (i < n) {
          let canisterId = idsArr[i];
          switch (results[i]) {
            case (#ok status) {
              recordReading(canisterId, #ok(status.cycles));
              readingByCanister.add(canisterId, status.cycles);
            };
            case (#err msg) { recordReading(canisterId, #err(msg)) };
          };
          i += 1;
        };
        // Guard against the blackhole returning fewer results than ids. The
        // contract says input/output align, but record an explicit error for
        // any tail id so a partial response doesn't silently disappear.
        while (i < idsArr.size()) {
          let canisterId = idsArr[i];
          recordReading(canisterId, #err("batch length mismatch: no reading returned"));
          i += 1;
        };
        // Snapshot below-threshold (owner, canisterId, cycleTopUpAmount)
        // candidates BEFORE any awaits. Iterating `tracked` (a mutable map)
        // across an `await` is unsafe — `upsertCanister` or a parallel
        // `recordCyclesNow` could mutate it mid-sweep. The snapshot reads
        // the live config so any edits up to this point win; subsequent
        // edits during the saga don't affect what runTopUps sees.
        let candidates = List.empty<(Principal, Principal, Nat)>();
        // Suspended canisters whose deadline has expired during this sweep.
        // Mutating `tracked` mid-iteration is unsafe, so collect the pairs
        // here and untrack after both loops finish but before the saga starts.
        let toRemove = List.empty<(Principal, Principal)>();
        for ((owner, userMap) in tracked.entries()) {
          for ((canisterId, cfg) in userMap.entries()) {
            switch (readingByCanister.get(canisterId)) {
              case (?cycles) {
                switch (Tracking.classifyForTopUp(cfg, cycles, Int.abs(Time.now()))) {
                  case (#remove) { toRemove.add((owner, canisterId)) };
                  case (#topUp amt) { candidates.add((owner, canisterId, amt)) };
                  case (#skip) {};
                };
              };
              case null {};
            };
          };
        };
        for ((owner, canisterId) in toRemove.values()) {
          removeTrackedEntry(owner, canisterId);
        };
        await runTopUps(candidates.toArray());
        await runHarvestGated();
        await runLpDrain();
        await runSnsDepositChecks();
        await runSnsReportChecks();
        await runSnsDrainAlertChecks();
      };
    };
  };

  public shared query ({ caller }) func whoami() : async Principal {
    caller;
  };

  public query func getBlackholeCanister() : async Principal {
    blackholeId;
  };

  public query func getIcpSwapPool() : async Principal {
    swapPoolId;
  };

  public query func getCmcCanister() : async Principal {
    cmcCanisterId;
  };

  public query func getSnsWasmCanister() : async Principal {
    snsWasmCanisterId;
  };

  // Owner-facing view of the cycle-check timer (todo-18): the last completed
  // sweep timestamp + the configured interval. Global (the sweep covers the
  // whole fleet in one firing), so it takes no caller and needs no SNS twin;
  // the client estimates the next check as lastCycleCheckAt + interval.
  public query func getTimerSchedule() : async TimerSchedule {
    { lastCycleCheckAt; cycleCheckIntervalSeconds = settings.cycleCheckIntervalSeconds };
  };

  public query func getDepositAccount(owner : Principal) : async ICRC2.Account {
    {
      owner = Principal.fromActor(self);
      subaccount = ?Subaccount.ofPrincipal(owner);
    };
  };

  // The fee pool is the backend's own default TCYCLES account (US16). Exposed
  // so the frontend / CLI can read or audit it directly.
  public query func getFeePoolAccount() : async ICRC2.Account {
    { owner = Principal.fromActor(self); subaccount = null };
  };

  // The caller's own loyalty status (US18). A `query`, so it computes pending
  // reward without mutating. Anonymous callers reflect a zeroed account.
  public shared query ({ caller }) func getMyLoyaltyStatus() : async MyLoyaltyStatus {
    let a = accountOf(caller);
    let pending = Loyalty.pendingReward(a, accRewardPerShare);
    { feeContributedTcycles = a.shares; claimableRebateTcycles = a.accrued + pending };
  };

  public shared ({ caller }) func deposit(
    token : Token,
    amount : Nat,
  ) : async Result.Result<Nat, DepositError> {
    await depositFor(caller, token, amount);
  };

  func depositFor(
    caller : Principal,
    token : Token,
    amount : Nat,
  ) : async Result.Result<Nat, DepositError> {
    if (caller.isAnonymous()) {
      return #err(#anonymous);
    };
    if (amount == 0) {
      return #err(#zeroAmount);
    };

    let ledger : ICRC2.Self = actor (Tokens.ledgerCanisterId(token).toText());

    let result = await ledger.icrc2_transfer_from({
      spender_subaccount = null;
      from = { owner = caller; subaccount = null };
      to = {
        owner = Principal.fromActor(self);
        subaccount = ?Subaccount.ofPrincipal(caller);
      };
      amount;
      fee = null;
      memo = null;
      created_at_time = null;
    });

    switch (result) {
      case (#Ok blockIndex) {
        // The transfer_from fee comes out of the sender's main account, so the
        // subaccount credit is exactly `amount`.
        recordBalanceEvent(caller, token, amount, #credit, #deposit);
        #ok blockIndex;
      };
      case (#Err err) { #err(#transferFrom err) };
    };
  };

  public shared ({ caller }) func withdraw(
    token : Token,
    amount : Nat,
  ) : async Result.Result<Nat, WithdrawError> {
    await withdrawFor(caller, token, amount);
  };

  func withdrawFor(
    caller : Principal,
    token : Token,
    amount : Nat,
  ) : async Result.Result<Nat, WithdrawError> {
    if (caller.isAnonymous()) {
      return #err(#anonymous);
    };
    if (amount == 0) {
      return #err(#zeroAmount);
    };

    let ledger : ICRC1.Self = actor (Tokens.ledgerCanisterId(token).toText());

    let result = await ledger.icrc1_transfer({
      from_subaccount = ?Subaccount.ofPrincipal(caller);
      to = { owner = caller; subaccount = null };
      amount;
      fee = null;
      memo = null;
      created_at_time = null;
    });

    switch (result) {
      case (#Ok blockIndex) {
        // `fee = null` → the ledger's default fee is debited from the sending
        // subaccount on top of `amount`.
        let ledgerFee = switch (token) {
          case (#ICP) { icpLedgerFee };
          case (#TCYCLES) { tcyclesLedgerFee };
        };
        recordBalanceEvent(caller, token, amount + ledgerFee, #debit, #withdraw);
        #ok blockIndex;
      };
      case (#Err err) { #err(#transfer err) };
    };
  };

  public shared query ({ caller }) func getTrackedCanisters() : async [TrackedCanister] {
    switch (tracked.get(caller)) {
      case null { [] };
      case (?userMap) {
        userMap.entries().map(
          func((id, cfg)) { { canisterId = id; config = cfg } }
        ).toArray();
      };
    };
  };

  public shared query ({ caller }) func getCanisterHistory(
    canisterId : Principal
  ) : async ?CanisterHistory {
    switch (tracked.get(caller)) {
      case null { null };
      case (?userMap) {
        switch (userMap.get(canisterId)) {
          case null { null };
          case (?cfg) {
            ?{
              canisterId;
              config = cfg;
              readings = readingsFor(canisterId);
              topUps = topUpsFor(caller, canisterId);
            };
          };
        };
      };
    };
  };

  // Whole-fleet batch of the per-canister CanisterHistory that
  // getCanisterHistory returns one-at-a-time, so the Overview can fetch current
  // cycles + reading series + top-up activity for every tracked canister in a
  // single query instead of one call per canister (todo-4). Per-canister payload
  // is bounded by settings.maxReadingsPerCanister / maxTopUpsPerCanister (~11 KB
  // fully saturated), so the aggregate stays under the ~2 MB query-response limit
  // up to ~150 tracked canisters; revisit with pagination if a fleet nears that.
  func fleetSummaryFor(owner : Principal) : [CanisterHistory] {
    switch (tracked.get(owner)) {
      case null { [] };
      case (?userMap) {
        userMap.entries().map(
          func((id, cfg)) {
            {
              canisterId = id;
              config = cfg;
              readings = readingsFor(id);
              topUps = topUpsFor(owner, id);
            }
          }
        ).toArray();
      };
    };
  };

  public shared query ({ caller }) func getFleetSummary() : async [CanisterHistory] {
    fleetSummaryFor(caller);
  };

  public shared ({ caller }) func upsertCanister(
    canisterId : Principal,
    config : CanisterConfig,
  ) : async Result.Result<(), UpsertCanisterError> {
    await upsertCanisterFor(caller, canisterId, config, true);
  };

  // Keep the blackhole controllership precondition isolated in this one helper:
  // US23 branches here (blackhole vs. SNS-root controllership) without touching
  // either the public method or the SNS twin. `enforceGlobalLimit` is true for
  // the user-facing method; the SNS twin passes false (a passed proposal must
  // execute, never be throttled).
  func upsertCanisterFor(
    caller : Principal,
    canisterId : Principal,
    config : CanisterConfig,
    enforceGlobalLimit : Bool,
  ) : async Result.Result<(), UpsertCanisterError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (config.minCycleBalance == 0) return #err(#zeroMinCycleBalance);
    if (config.cycleTopUpAmount == 0) return #err(#zeroCycleTopUpAmount);

    // Growth caps (DOS-1): bound distinct owner principals and per-owner
    // canisters so principal-rotation cannot grow `tracked` toward an
    // unrecoverable heap brick. Checked BEFORE the global token and the paid
    // blackhole probe so a capped-out registry costs nothing. Only *growth* is
    // capped: re-upserting an already-tracked pair is an in-place update and
    // always passes. (This is a pre-probe gate; the authoritative add below
    // re-reads `tracked` after the probe's commit point.)
    switch (tracked.get(caller)) {
      case null {
        if (tracked.size() >= settings.maxOwners) {
          return #err(#ownerLimitReached { maxOwners = settings.maxOwners });
        };
      };
      case (?userMap) {
        switch (userMap.get(canisterId)) {
          case null {
            if (userMap.size() >= settings.maxCanistersPerOwner) {
              return #err(#canisterLimitReached { maxCanistersPerOwner = settings.maxCanistersPerOwner });
            };
          };
          case (?_) {};
        };
      };
    };

    // Global rate limit (DOS-2): user path only. After the caps so a rejected
    // call spends no token; before the probe so the bucket bounds the
    // backend-paid outbound rate.
    if (enforceGlobalLimit and not consumeGlobalToken()) return #err(#rateLimited);

    // Blackhole controllership precondition. A returned #err means the
    // blackhole is not a controller of the target (its own mgmt-canister call
    // was rejected); a try/catch covers the blackhole itself being
    // unreachable. Status payload is discarded — the recurring timer or
    // recordCyclesNow seed the first reading.
    let probe = try {
      #ok(await blackhole().canisterStatus(canisterId));
    } catch (e) {
      #err("blackhole unreachable: " # e.message());
    };
    switch (probe) {
      case (#err reason) {
        return #err(#blackholeNotController { blackholeCanisterId = blackholeId; reason });
      };
      case (#ok(#err msg)) {
        return #err(#blackholeNotController { blackholeCanisterId = blackholeId; reason = msg });
      };
      case (#ok(#ok _status)) { /* controllership confirmed */ };
    };

    let userMap = switch (tracked.get(caller)) {
      case (?m) m;
      case null {
        let fresh = Map.empty<Principal, CanisterConfig>();
        tracked.add(caller, fresh);
        fresh;
      };
    };
    let prior = userMap.get(canisterId);
    let merged = Tracking.mergeConfig(prior, config);
    userMap.add(canisterId, merged);
    // Audit the tracking-config change. Without this, a later threshold raise is
    // indistinguishable in the cycle history from a missed top-up: an old reading
    // that was fine under the threshold then in effect looks below-threshold once
    // the higher line is drawn over it. The prior->new diff lets the threshold (and
    // top-up amount) in effect at any time be reconstructed. Mirrors
    // updateAdminSettings' diff style; covers the direct + both SNS upsert paths,
    // which all funnel through here.
    log(#info, #topUp, "upsertCanister " # canisterId.toText() # " " # debug_show prior # " -> " # debug_show merged, ?caller);
    #ok();
  };

  public shared ({ caller }) func setCanisterSuspended(
    canisterId : Principal,
    suspend : Bool,
  ) : async Result.Result<(), SuspendCanisterError> {
    setCanisterSuspendedFor(caller, canisterId, suspend);
  };

  func setCanisterSuspendedFor(
    caller : Principal,
    canisterId : Principal,
    suspend : Bool,
  ) : Result.Result<(), SuspendCanisterError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    let userMap = switch (tracked.get(caller)) {
      case null { return #err(#notTracked) };
      case (?m) m;
    };
    let cfg = switch (userMap.get(canisterId)) {
      case null { return #err(#notTracked) };
      case (?c) c;
    };
    // `true` always overwrites with a fresh `now + 60d` — this is also the
    // Extend affordance (re-calling with `true` resets the deadline). `false`
    // clears the field. Idempotent: re-calling with the same value is a
    // no-op as far as visible behaviour goes.
    let nextSuspendedUntil : ?Nat = if (suspend) {
      ?(Settings.suspendDeadline(Int.abs(Time.now())));
    } else { null };
    userMap.add(canisterId, {
      minCycleBalance = cfg.minCycleBalance;
      cycleTopUpAmount = cfg.cycleTopUpAmount;
      suspendedUntil = nextSuspendedUntil;
      nickname = cfg.nickname;
    });
    #ok();
  };

  public shared ({ caller }) func removeCanister(
    canisterId : Principal
  ) : async Result.Result<(), RemoveCanisterError> {
    removeCanisterFor(caller, canisterId);
  };

  func removeCanisterFor(
    caller : Principal,
    canisterId : Principal,
  ) : Result.Result<(), RemoveCanisterError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    let userMap = switch (tracked.get(caller)) {
      case null { return #err(#notTracked) };
      case (?m) m;
    };
    switch (userMap.get(canisterId)) {
      case null { return #err(#notTracked) };
      case (?_cfg) {};
    };
    // Refusing mid-saga keeps `recordTopUp`'s post-await write from
    // resurrecting a zombie `topUpHistory` row for a no-longer-tracked
    // canister. Sagas are short — the caller retries when the in-flight
    // top-up settles.
    if (inFlightContains(caller, canisterId)) {
      return #err(#topUpInFlight);
    };
    removeTrackedEntry(caller, canisterId);
    #ok();
  };

  // Admin twin of removeCanister: an admin drops another owner's tracked
  // canister. Delegates to removeCanisterFor so the notTracked + topUpInFlight
  // guards (and the removeTrackedEntry mutation) are shared with the user path;
  // only the auth gate differs. No stable-state change beyond the existing
  // removeTrackedEntry, so nothing to migrate.
  public shared ({ caller }) func adminRemoveCanister(
    owner : Principal,
    canisterId : Principal,
  ) : async Result.Result<(), AdminRemoveCanisterError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    switch (removeCanisterFor(owner, canisterId)) {
      case (#err(#anonymous)) { #err(#notTracked) }; // owner is a real pid; treat as not tracked
      case (#err(#notTracked)) { #err(#notTracked) };
      case (#err(#topUpInFlight)) { #err(#topUpInFlight) };
      case (#ok) {
        log(#info, #admin, "adminRemoveCanister owner=" # owner.toText() # " canister=" # canisterId.toText(), ?caller);
        #ok();
      };
    };
  };

  public shared ({ caller }) func recordCyclesNow(
    canisterId : Principal
  ) : async Result.Result<(), RecordCyclesError> {
    await recordCyclesNowFor(caller, canisterId, true);
  };

  // Spend one global token (DOS-2). Synchronous — the bucket read-modify-write
  // is atomic against concurrent callers (no `await` between). Returns false
  // when the aggregate rate cap is hit; callers map that to `#rateLimited`.
  func consumeGlobalToken() : Bool {
    let (next, granted) = TokenBucket.tryConsume(
      globalBucket,
      GLOBAL_BUCKET_CAPACITY,
      GLOBAL_BUCKET_REFILL_INTERVAL_NS,
      Int.abs(Time.now()),
    );
    globalBucket := next;
    granted;
  };

  // Enforce the todo-24 manual-check rate cap for `account` against `canisterId`
  // and, if allowed, record the attempt. Synchronous (no `await`) so the
  // check-and-record is atomic against concurrent calls from the same account.
  func registerManualCheck(account : Principal, canisterId : Principal) : Result.Result<(), RecordCyclesError> {
    let prior = switch (manualChecks.get(account)) { case null { [] }; case (?cs) { cs } };
    switch (RateLimit.register(prior, canisterId, Int.abs(Time.now()))) {
      case (#denied) { #err(#rateLimited) };
      case (#ok next) { manualChecks.add(account, next); #ok() };
    };
  };

  func recordCyclesNowFor(
    caller : Principal,
    canisterId : Principal,
    enforceRateLimit : Bool,
  ) : async Result.Result<(), RecordCyclesError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    let isTracked = switch (tracked.get(caller)) {
      case null { false };
      case (?userMap) {
        switch (userMap.get(canisterId)) {
          case null { false };
          case (?_cfg) { true };
        };
      };
    };
    if (not isTracked) return #err(#notTracked);
    // Rate-cap only the user-initiated paths (frontend "Record now"); the SNS
    // governance twin passes false so an adopted proposal never trips the cap.
    // Per-principal cap first (a single spamming principal hits its own cap
    // before it can drain the shared bucket), then the global bucket (DOS-2).
    if (enforceRateLimit) {
      switch (registerManualCheck(caller, canisterId)) {
        case (#err e) { return #err(e) };
        case (#ok) {};
      };
      if (not consumeGlobalToken()) return #err(#rateLimited);
    };
    // Record the reading and run this caller's own top-up only. Harvest and the
    // LP drain are owned by the recurring sweep (`performCycleCheck`); keeping
    // them off the user path drops a paid `feePoolBalance()` read per click and
    // removes a per-call amplifier from the abuse surface (DOS-2).
    await checkCanister(caller, canisterId);
    #ok();
  };

  // ---------------------------------------------------------------------------
  // SNS custom-function twins (US20). Execute twins delegate to the shared
  // `*For` helpers keyed to `caller` (the SNS governance canister when
  // invoked by an adopted proposal) and `Runtime.trap` on the error path so a
  // failed operation fails the proposal execution rather than reporting a
  // silent success. Validate twins run only the cheap synchronous input checks
  // the originals do up front and render a one-line summary (raw base units, no
  // formatting) — no inter-canister calls, no controllership probe.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // SNS caller identification (US21). An adopted SNS proposal executes a generic
  // nervous-system function with the SNS *governance* canister as caller, but
  // [[Deposits]] requires treasury funds and tracking to key to the SNS *root*.
  // `refreshSnsRegistry` rebuilds the governance→root index from the NNS
  // SNS-Wasm registry — mirroring `refreshControllers`: wrap in try/catch and
  // swallow errors (no caller to surface to at startup). `resolveSnsRoot`
  // returns the cached root and, on a miss, does one live refresh then
  // re-checks, so a newly-launched SNS resolves on first use. Every `sns*`
  // execute twin resolves through this and keys to the root; `requireSnsRoot`
  // traps for an unrecognized caller — the same failed-proposal semantics the
  // twins use for #err.
  // ---------------------------------------------------------------------------

  func refreshSnsRegistry() : async () {
    try {
      let { instances } = await snsWasm.list_deployed_snses({});
      let fresh = Map.empty<Principal, Principal>();
      for (sns in instances.vals()) {
        switch (sns.governance_canister_id, sns.root_canister_id) {
          case (?gov, ?root) { fresh.add(gov, root) };
          case _ {};
        };
      };
      snsRootByGovernance := fresh;
    } catch (_) {};
  };

  func resolveSnsRoot(caller : Principal) : async ?Principal {
    if (caller.isAnonymous()) return null;
    switch (snsRootByGovernance.get(caller)) {
      case (?root) { ?root };
      case null {
        // Throttle the live registry refresh (DOS-3/AUTH-6): claim the window
        // synchronously, BEFORE the await, so a burst of concurrent misses from
        // unrecognized/rotating callers triggers at most one `list_deployed_snses`
        // per window. A genuinely new SNS resolves on the next call after it.
        let now = Int.abs(Time.now());
        if (now >= lastSnsRefreshNs + SNS_REFRESH_MIN_INTERVAL_NS) {
          lastSnsRefreshNs := now;
          await refreshSnsRegistry();
        };
        snsRootByGovernance.get(caller);
      };
    };
  };

  func requireSnsRoot(resolved : ?Principal, method : Text) : Principal {
    switch (resolved) {
      case (?root) { root };
      case null { Runtime.trap(method # ": caller is not a recognized SNS") };
    };
  };

  public shared ({ caller }) func snsDeposit(arg : SnsDepositArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsDeposit");
    switch (await depositFor(root, arg.token, arg.amount)) {
      case (#ok _) {};
      case (#err e) { Runtime.trap("snsDeposit: " # debug_show e) };
    };
  };

  public shared ({ caller }) func snsWithdraw(arg : SnsWithdrawArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsWithdraw");
    switch (await withdrawFor(root, arg.token, arg.amount)) {
      case (#ok _) {};
      case (#err e) { Runtime.trap("snsWithdraw: " # debug_show e) };
    };
  };

  public shared ({ caller }) func snsUpsertCanister(arg : SnsUpsertCanisterArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsUpsertCanister");
    switch (await upsertCanisterFor(root, arg.canisterId, arg.config, false)) {
      case (#ok _) {};
      case (#err e) { Runtime.trap("snsUpsertCanister: " # debug_show e) };
    };
  };

  public shared ({ caller }) func snsSetCanisterSuspended(arg : SnsSetSuspendedArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsSetCanisterSuspended");
    switch (setCanisterSuspendedFor(root, arg.canisterId, arg.suspend)) {
      case (#ok _) {};
      case (#err e) { Runtime.trap("snsSetCanisterSuspended: " # debug_show e) };
    };
  };

  public shared ({ caller }) func snsRemoveCanister(arg : SnsRemoveCanisterArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsRemoveCanister");
    switch (removeCanisterFor(root, arg.canisterId)) {
      case (#ok _) {};
      case (#err e) { Runtime.trap("snsRemoveCanister: " # debug_show e) };
    };
  };

  public shared ({ caller }) func snsRecordCyclesNow(arg : SnsRecordCyclesArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsRecordCyclesNow");
    switch (await recordCyclesNowFor(root, arg.canisterId, false)) {
      case (#ok _) {};
      case (#err e) { Runtime.trap("snsRecordCyclesNow: " # debug_show e) };
    };
  };

  public func snsDepositValidate(arg : SnsDepositArg) : async SnsValidateResult {
    if (arg.amount == 0) return #Err("amount must be > 0");
    #Ok(
      "Deposit " # arg.amount.toText() # " " # Tokens.toText(arg.token)
      # " base units into the Unicycle deposit subaccount."
    );
  };

  public func snsWithdrawValidate(arg : SnsWithdrawArg) : async SnsValidateResult {
    if (arg.amount == 0) return #Err("amount must be > 0");
    #Ok(
      "Withdraw " # arg.amount.toText() # " " # Tokens.toText(arg.token)
      # " base units from the Unicycle deposit subaccount to the caller's wallet."
    );
  };

  public func snsUpsertCanisterValidate(arg : SnsUpsertCanisterArg) : async SnsValidateResult {
    if (arg.config.minCycleBalance == 0) return #Err("minCycleBalance must be > 0");
    if (arg.config.cycleTopUpAmount == 0) return #Err("cycleTopUpAmount must be > 0");
    #Ok(
      "Track " # arg.canisterId.toText()
      # ": min " # arg.config.minCycleBalance.toText()
      # ", top-up " # arg.config.cycleTopUpAmount.toText() # "."
    );
  };

  public func snsSetCanisterSuspendedValidate(arg : SnsSetSuspendedArg) : async SnsValidateResult {
    #Ok(
      "Set suspension of " # arg.canisterId.toText() # " to "
      # (if (arg.suspend) "suspended" else "active") # "."
    );
  };

  public func snsRemoveCanisterValidate(arg : SnsRemoveCanisterArg) : async SnsValidateResult {
    #Ok("Stop tracking " # arg.canisterId.toText() # ".");
  };

  public func snsRecordCyclesNowValidate(arg : SnsRecordCyclesArg) : async SnsValidateResult {
    #Ok("Record a cycle reading now for " # arg.canisterId.toText() # ".");
  };

  // The exact deposit account an SNS's treasury transfers ICP/tcycles into:
  // `{ owner = backend; subaccount = Subaccount.ofPrincipal(root) }`, keyed to
  // the SNS *root*. Resolves the governance caller → root, so it doubles as the
  // "does Unicycle recognize my SNS?" check — `null` for an unrecognized
  // governance principal. An update method (not `query`) so a cache miss
  // triggers the live registry refresh in `resolveSnsRoot`.
  public func getSnsDepositAccount(governance : Principal) : async ?ICRC2.Account {
    switch (await resolveSnsRoot(governance)) {
      case null { null };
      case (?root) {
        ?{
          owner = Principal.fromActor(self);
          subaccount = ?Subaccount.ofPrincipal(root);
        };
      };
    };
  };

  // ---------------------------------------------------------------------------
  // SNS proposal-submission neuron + Motion submission (US22). The SNS hotkeys a
  // neuron to the backend (done SNS-side via `add_neuron_permissions`) and
  // records *which* neuron via the root-keyed `snsSetProposalNeuron` twin; the
  // backend can then call that SNS's governance `manage_neuron` to make a
  // proposal. US22 proves the round-trip with the simplest proposal — a Motion —
  // which needs no pre-registered generic function (that is US23) yet exercises
  // the exact hotkey path the later automation (US24–US26) builds on.
  // ---------------------------------------------------------------------------

  // SNS-only execute twin (US22) mirroring the US21 twins: resolves the
  // governance caller → SNS root and records the proposal neuron against it.
  // There is no plain-user equivalent — configuring a proposal neuron is an
  // SNS-only operation. Traps (failing the proposal) on an unrecognized caller
  // or a non-32-byte id.
  public shared ({ caller }) func snsSetProposalNeuron(arg : SnsSetProposalNeuronArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsSetProposalNeuron");
    if (arg.neuronId.size() != 32) {
      Runtime.trap("snsSetProposalNeuron: neuronId must be 32 bytes");
    };
    snsProposalNeuron.add(root, arg.neuronId);
    log(#info, #sns, "snsSetProposalNeuron for root " # root.toText(), ?caller);
  };

  public func snsSetProposalNeuronValidate(arg : SnsSetProposalNeuronArg) : async SnsValidateResult {
    if (arg.neuronId.size() != 32) return #Err("neuronId must be 32 bytes");
    #Ok(
      "Set the Unicycle proposal-submission neuron for this SNS ("
      # arg.neuronId.size().toText() # "-byte id)."
    );
  };

  // The neuron an SNS has recorded for Unicycle to submit proposals through
  // (US22), keyed to the SNS *root*. Resolves the governance caller → root, so
  // it returns `null` for an unrecognized governance principal or an SNS that
  // has not recorded a neuron. An update method (not `query`) so a cache miss
  // triggers the live registry refresh in `resolveSnsRoot`, mirroring
  // `getSnsDepositAccount`.
  public func getSnsProposalNeuron(governance : Principal) : async ?Blob {
    switch (await resolveSnsRoot(governance)) {
      case null { null };
      case (?root) { snsProposalNeuron.get(root) };
    };
  };

  // ---------------------------------------------------------------------------
  // SNS admin grant + act-on-behalf (US27). The first SNS story to reach the
  // frontend. (a) The grant: an SNS designates an admin principal via the
  // root-keyed SNS-only `snsGrantAdmin` twin, mirroring `snsSetProposalNeuron`.
  // (b) Acting on behalf: that admin signs into the frontend and runs the
  // canister-management ops keyed to the SNS root via the `asSns*` family, which
  // authorizes `caller ∈ snsAdmins[root]` (synchronously, before any await) then
  // delegates to the same `*For(root, …)` helpers the US21 twins use. Treasury
  // movement (deposit/withdraw) is deliberately excluded — money stays
  // proposal-gated.
  // ---------------------------------------------------------------------------

  // SNS-only execute twin (US27) mirroring `snsSetProposalNeuron`: resolve the
  // governance caller → root and add the admin against it. No plain-user
  // equivalent — only the SNS may name its admins. Traps (failing the proposal)
  // on an unrecognized caller or an anonymous admin.
  public shared ({ caller }) func snsGrantAdmin(arg : SnsGrantAdminArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsGrantAdmin");
    if (arg.admin.isAnonymous()) { Runtime.trap("snsGrantAdmin: admin must not be anonymous") };
    snsAddAdmin(root, arg.admin);
    log(#info, #sns, "snsGrantAdmin " # arg.admin.toText() # " for root " # root.toText(), ?caller);
  };

  public func snsGrantAdminValidate(arg : SnsGrantAdminArg) : async SnsValidateResult {
    if (arg.admin.isAnonymous()) return #Err("admin must not be anonymous");
    #Ok("Grant Unicycle admin access on this SNS's behalf to " # arg.admin.toText() # ".");
  };

  // SNS-only execute twin (US28) mirroring `snsGrantAdmin`: resolve the
  // governance caller → root and remove one admin against it. Idempotent — a
  // not-currently-an-admin target (or a re-run revoke proposal) is harmless.
  public shared ({ caller }) func snsRevokeAdmin(arg : SnsRevokeAdminArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsRevokeAdmin");
    if (arg.admin.isAnonymous()) { Runtime.trap("snsRevokeAdmin: admin must not be anonymous") };
    snsRemoveAdmin(root, arg.admin);
    log(#info, #sns, "snsRevokeAdmin " # arg.admin.toText() # " for root " # root.toText(), ?caller);
  };

  public func snsRevokeAdminValidate(arg : SnsRevokeAdminArg) : async SnsValidateResult {
    if (arg.admin.isAnonymous()) return #Err("admin must not be anonymous");
    #Ok("Revoke Unicycle admin access on this SNS's behalf from " # arg.admin.toText() # ".");
  };

  // The admins an SNS has authorized (US27), keyed to the SNS *root*. Resolves
  // the governance caller → root, mirroring `getSnsProposalNeuron`: `null` for an
  // unrecognized governance principal, `?[]` for a recognized SNS with no admins
  // yet. An update method (not `query`) so a cache miss refreshes the registry.
  public func getSnsAdmins(governance : Principal) : async ?[Principal] {
    switch (await resolveSnsRoot(governance)) {
      case null { null };
      case (?root) {
        switch (snsAdmins.get(root)) {
          case null { ?[] };
          case (?set) { ?set.values().toArray() };
        };
      };
    };
  };

  // The SNS roots the caller administers (US27) — the frontend "Acting as"
  // switcher reads this for the signed-in identity. A `query` keyed to caller:
  // `[]` if anonymous, else the roots whose admin set contains the caller.
  public shared query ({ caller }) func getMySnsAdminRoots() : async [Principal] {
    if (caller.isAnonymous()) return [];
    snsAdmins.entries()
      .filter(func((_root, set)) { set.contains(caller) })
      .map(func((root, _set)) { root })
      .toArray();
  };

  // Act-on-behalf family (US27): each authorizes `caller ∈ snsAdmins[root]` via
  // `requireSnsAdmin` (which *traps* on failure, before any await) then delegates
  // to the existing `*For(root, …)` helper, returning its Result unchanged. The
  // queries trap on a non-admin caller too. Surface = canister-management only.
  public shared query ({ caller }) func asSnsGetTrackedCanisters(root : Principal) : async [TrackedCanister] {
    requireSnsAdmin(caller, root, "asSnsGetTrackedCanisters");
    switch (tracked.get(root)) {
      case null { [] };
      case (?userMap) {
        userMap.entries().map(
          func((id, cfg)) { { canisterId = id; config = cfg } }
        ).toArray();
      };
    };
  };

  public shared query ({ caller }) func asSnsGetCanisterHistory(
    root : Principal,
    canisterId : Principal,
  ) : async ?CanisterHistory {
    requireSnsAdmin(caller, root, "asSnsGetCanisterHistory");
    switch (tracked.get(root)) {
      case null { null };
      case (?userMap) {
        switch (userMap.get(canisterId)) {
          case null { null };
          case (?cfg) {
            ?{
              canisterId;
              config = cfg;
              readings = readingsFor(canisterId);
              topUps = topUpsFor(root, canisterId);
            };
          };
        };
      };
    };
  };

  public shared query ({ caller }) func asSnsGetFleetSummary(root : Principal) : async [CanisterHistory] {
    requireSnsAdmin(caller, root, "asSnsGetFleetSummary");
    fleetSummaryFor(root);
  };

  public shared ({ caller }) func asSnsUpsertCanister(
    root : Principal,
    canisterId : Principal,
    config : CanisterConfig,
  ) : async Result.Result<(), UpsertCanisterError> {
    requireSnsAdmin(caller, root, "asSnsUpsertCanister");
    await upsertCanisterFor(root, canisterId, config, true);
  };

  public shared ({ caller }) func asSnsSetCanisterSuspended(
    root : Principal,
    canisterId : Principal,
    suspend : Bool,
  ) : async Result.Result<(), SuspendCanisterError> {
    requireSnsAdmin(caller, root, "asSnsSetCanisterSuspended");
    setCanisterSuspendedFor(root, canisterId, suspend);
  };

  public shared ({ caller }) func asSnsRemoveCanister(
    root : Principal,
    canisterId : Principal,
  ) : async Result.Result<(), RemoveCanisterError> {
    requireSnsAdmin(caller, root, "asSnsRemoveCanister");
    removeCanisterFor(root, canisterId);
  };

  public shared ({ caller }) func asSnsRecordCyclesNow(
    root : Principal,
    canisterId : Principal,
  ) : async Result.Result<(), RecordCyclesError> {
    requireSnsAdmin(caller, root, "asSnsRecordCyclesNow");
    await recordCyclesNowFor(root, canisterId, true);
  };

  // ---------------------------------------------------------------------------
  // Automatic deposit top-up config (US24). An SNS configures a minimum balance
  // and a deposit amount (both ICP e8s) for its Unicycle deposit subaccount; the
  // recurring `performCycleCheck` then submits a `TransferSnsTreasuryFunds` proposal
  // when the balance falls below the minimum (see `checkSnsDeposit`). Backend-only
  // like US22/US23 — the SNS sets config by proposal, not the frontend.
  // ---------------------------------------------------------------------------

  // SNS-only execute twin mirroring the US21/US22 twins: resolve caller → root,
  // validate, store. Also clears the resubmit cooldown so changed settings take
  // effect on the very next check.
  public shared ({ caller }) func snsSetDepositConfig(arg : SnsSetDepositConfigArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsSetDepositConfig");
    if (arg.minBalanceE8s > 0 and arg.depositAmountE8s == 0) {
      Runtime.trap("snsSetDepositConfig: depositAmountE8s must be > 0 when minBalanceE8s > 0");
    };
    snsDepositConfig.add(root, arg);
    ignore snsLastDepositProposal.delete(root);   // act on new settings immediately
    log(#info, #sns, "snsSetDepositConfig for root " # root.toText() # ": " # debug_show arg, ?caller);
  };

  public func snsSetDepositConfigValidate(arg : SnsSetDepositConfigArg) : async SnsValidateResult {
    if (arg.minBalanceE8s == 0) return #Ok("Disable Unicycle auto-deposit for this SNS (min balance 0).");
    if (arg.depositAmountE8s == 0) return #Err("depositAmountE8s must be > 0 when minBalanceE8s > 0");
    #Ok(
      "Auto-deposit: when this SNS's Unicycle ICP deposit balance falls below "
      # arg.minBalanceE8s.toText() # " e8s, submit a proposal to transfer "
      # arg.depositAmountE8s.toText() # " e8s ICP from the SNS treasury. Cycle usage report "
      # (if (arg.includeReport) { "included." } else { "omitted." })
    );
  };

  // The deposit auto-top-up config an SNS has set (US24), keyed to the SNS root.
  // Resolves the governance caller → root, so it returns `null` for an
  // unrecognized governance principal or an SNS that has not set a config. An
  // update method (not `query`) so a cache miss triggers the live registry
  // refresh in `resolveSnsRoot`, mirroring `getSnsProposalNeuron`.
  public func getSnsDepositConfig(governance : Principal) : async ?SnsSetDepositConfigArg {
    switch (await resolveSnsRoot(governance)) {
      case null { null };
      case (?root) { snsDepositConfig.get(root) };
    };
  };

  // ---------------------------------------------------------------------------
  // Recurring cycle-usage report config (US25). An SNS configures a cadence (in
  // days); the recurring `performCycleCheck` then submits a `#Motion` proposal whose
  // body is the multi-range cycle-usage report whenever a report is due (see
  // `checkSnsReport`). Backend-only like US22–US24 — the SNS sets config by
  // proposal, never the frontend.
  // ---------------------------------------------------------------------------

  // SNS-only execute twin mirroring `snsSetDepositConfig`: resolve caller → root,
  // store, then clear the cadence timestamp so a new cadence acts on the very
  // next check (and enabling sends an immediate first report).
  public shared ({ caller }) func snsSetReportConfig(arg : SnsSetReportConfigArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsSetReportConfig");
    snsReportConfig.add(root, arg);
    ignore snsLastReportProposal.delete(root);   // new cadence → due on next check
    log(#info, #sns, "snsSetReportConfig for root " # root.toText() # ": " # debug_show arg, ?caller);
  };

  public func snsSetReportConfigValidate(arg : SnsSetReportConfigArg) : async SnsValidateResult {
    if (arg.cadenceDays == 0) return #Ok("Disable recurring Unicycle cycle-usage reports for this SNS.");
    #Ok(
      "Submit a Unicycle cycle-usage report motion proposal every "
      # arg.cadenceDays.toText()
      # " day(s), summarizing each tracked canister's net cycle change over the past 1, 3, 7 and 30 days."
    );
  };

  // The report cadence an SNS has set (US25), keyed to the SNS root. An update
  // method (not `query`) so a cache miss triggers the live registry refresh in
  // `resolveSnsRoot`, mirroring `getSnsDepositConfig`.
  public func getSnsReportConfig(governance : Principal) : async ?SnsSetReportConfigArg {
    switch (await resolveSnsRoot(governance)) {
      case null { null };
      case (?root) { snsReportConfig.get(root) };
    };
  };

  // ---------------------------------------------------------------------------
  // Cycle-drain alert config (US26). An SNS configures per-window % thresholds; the
  // recurring `performCycleCheck` then detects per-canister cycle anomalies and, when
  // any tracked canister trips an enabled threshold, submits a single `#Motion`
  // alert proposal naming the offenders (see `checkSnsDrainAlert`). Backend-only
  // like US22–US25 — the SNS sets config by proposal, never the frontend.
  // ---------------------------------------------------------------------------

  // SNS-only execute twin mirroring `snsSetReportConfig`: resolve caller → root,
  // store, then clear the cooldown timestamp so a new config can alert on the
  // very next check.
  public shared ({ caller }) func snsSetDrainAlertConfig(arg : SnsSetDrainAlertConfigArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsSetDrainAlertConfig");
    snsDrainAlertConfig.add(root, arg);
    ignore snsLastDrainAlertProposal.delete(root);   // new config → may alert on next check
    log(#info, #sns, "snsSetDrainAlertConfig for root " # root.toText() # ": " # debug_show arg, ?caller);
  };

  public func snsSetDrainAlertConfigValidate(arg : SnsSetDrainAlertConfigArg) : async SnsValidateResult {
    if (arg.weeklyAvgFactorPct == 0 and arg.monthlyAvgFactorPct == 0 and arg.dayOverDayFactorPct == 0) {
      return #Ok("Disable Unicycle cycle-drain alerts for this SNS (all thresholds 0).");
    };
    #Ok(
      "Cycle-drain alerts: file a motion proposal when a tracked canister's daily cycle burn exceeds "
      # Nat.toText(arg.weeklyAvgFactorPct) # "% of its 7-day average, "
      # Nat.toText(arg.monthlyAvgFactorPct) # "% of its 30-day average, or "
      # Nat.toText(arg.dayOverDayFactorPct) # "% of the previous day (a 0 disables that check). "
      # "At most one alert per " # Nat.toText(arg.alertCooldownDays) # " day(s)."
    );
  };

  // The drain-alert config an SNS has set (US26), keyed to the SNS root. An update
  // method (not `query`) so a cache miss triggers the live registry refresh in
  // `resolveSnsRoot`, mirroring `getSnsReportConfig`.
  public func getSnsDrainAlertConfig(governance : Principal) : async ?SnsSetDrainAlertConfigArg {
    switch (await resolveSnsRoot(governance)) {
      case null { null };
      case (?root) { snsDrainAlertConfig.get(root) };
    };
  };

  // Shared core for submitting a proposal on an SNS's behalf (US22/US23). Builds
  // that SNS's governance `manage_neuron` → `MakeProposal` call through the given
  // hotkeyed neuron and maps the response. The governance actor is built inline
  // (the governance canister varies per SNS). Callers supply the `action` — a
  // `#Motion` for US22's test path, an `#AddGenericNervousSystemFunction` for
  // US23's setup. `url` is empty for now (richer bodies are US25/US26).
  // Governance accepts the call only if the backend is a hotkey on the neuron; a
  // governance `#Error` and an unreachable governance both surface as `#err` —
  // the error path is the proof the hotkey matters.
  func submitSnsProposal(
    governance : Principal,
    neuronId : Blob,
    title : Text,
    summary : Text,
    action : Types.SnsAction,
  ) : async Result.Result<Nat, Text> {
    let gov : actor {
      manage_neuron : shared Types.SnsManageNeuron -> async Types.SnsManageNeuronResponse;
    } = actor (governance.toText());
    try {
      let response = await gov.manage_neuron({
        subaccount = neuronId;
        command = ?#MakeProposal({ title; url = ""; summary; action = ?action });
      });
      switch (response.command) {
        case (?#MakeProposal({ proposal_id = ?{ id } })) { #ok(id.toNat()) };
        case (?#MakeProposal({ proposal_id = null })) {
          #err("proposal accepted but no id returned");
        };
        case (?#Error({ error_message })) { #err("governance error: " # error_message) };
        case (_) { #err("unexpected manage_neuron response") };
      };
    } catch (e) {
      #err("governance unreachable: " # e.message());
    };
  };

  // Submit a Motion proposal on an SNS's behalf (US22). Resolves the governance
  // principal → SNS root (US21 map) only to fetch the root-keyed neuron, then
  // delegates to `submitSnsProposal` with a `#Motion` action (`motion_text =
  // summary`). The unrecognized-SNS and not-configured `#err`s live here.
  func submitSnsMotionProposal(governance : Principal, title : Text, summary : Text) : async Result.Result<Nat, Text> {
    let root = switch (await resolveSnsRoot(governance)) {
      case (?r) r;
      case null { return #err("caller is not a recognized SNS") };
    };
    let neuronId = switch (snsProposalNeuron.get(root)) {
      case (?n) n;
      case null { return #err("no proposal neuron configured for this SNS") };
    };
    await submitSnsProposal(governance, neuronId, title, summary, #Motion({ motion_text = summary }));
  };

  // ---------------------------------------------------------------------------
  // One-time SNS setup (US23). A single `snsSetup` custom function fans out one
  // `AddGenericNervousSystemFunction` proposal per existing Unicycle twin so the
  // SNS can invoke them all by proposal — onboarding becomes one click after the
  // SNS manually registers `snsSetup` itself (the unavoidable bootstrap). The
  // arg also carries the proposal neuron, which `snsSetup` records (US22 store)
  // before submitting — breaking the chicken-and-egg that `snsSetProposalNeuron`
  // is itself an unregistered generic function at setup time.
  // ---------------------------------------------------------------------------

  // The Unicycle twins registered by `snsSetup`, in a stable order (US24–US26
  // append their config twins here as they land). `snsSetup` itself is NOT in
  // this list — it is the manually-registered bootstrap and must not
  // re-register itself.
  let snsFunctionSpecs : [Types.SnsFunctionSpec] = [
    { name = "Unicycle: Deposit"; description = "Deposit ICP/tcycles into the SNS's Unicycle subaccount."; target = "snsDeposit"; validator = "snsDepositValidate" },
    { name = "Unicycle: Withdraw"; description = "Withdraw ICP/tcycles from the SNS's Unicycle subaccount."; target = "snsWithdraw"; validator = "snsWithdrawValidate" },
    { name = "Unicycle: Track Canister"; description = "Register or update a tracked canister's top-up config."; target = "snsUpsertCanister"; validator = "snsUpsertCanisterValidate" },
    { name = "Unicycle: Set Canister Suspended"; description = "Suspend or resume automatic top-ups for a tracked canister."; target = "snsSetCanisterSuspended"; validator = "snsSetCanisterSuspendedValidate" },
    { name = "Unicycle: Remove Canister"; description = "Stop tracking a canister."; target = "snsRemoveCanister"; validator = "snsRemoveCanisterValidate" },
    { name = "Unicycle: Record Cycles Now"; description = "Record a cycle reading now for a tracked canister."; target = "snsRecordCyclesNow"; validator = "snsRecordCyclesNowValidate" },
    { name = "Unicycle: Set Proposal Neuron"; description = "Set the neuron Unicycle uses to submit proposals for this SNS."; target = "snsSetProposalNeuron"; validator = "snsSetProposalNeuronValidate" },
    { name = "Unicycle: Set Deposit Auto-Top-Up"; description = "Configure automatic SNS treasury → Unicycle ICP deposits (min balance, deposit amount, report toggle)."; target = "snsSetDepositConfig"; validator = "snsSetDepositConfigValidate" },
    { name = "Unicycle: Set Cycle Report Cadence"; description = "Configure recurring cycle-usage report proposals (cadence in days; 0 disables)."; target = "snsSetReportConfig"; validator = "snsSetReportConfigValidate" },
    { name = "Unicycle: Set Cycle Drain Alerts"; description = "Configure cycle-drain alert proposals (per-window % thresholds; 0 disables a check; cooldown in days)."; target = "snsSetDrainAlertConfig"; validator = "snsSetDrainAlertConfigValidate" },
    // US27/US28 — admin grant/revoke, appended at the END so existing functions'
    // `baseFunctionId + i` ids stay stable.
    { name = "Unicycle: Grant Admin"; description = "Grant a principal admin access to manage this SNS's Unicycle fleet from the frontend."; target = "snsGrantAdmin"; validator = "snsGrantAdminValidate" },
    { name = "Unicycle: Revoke Admin"; description = "Revoke a principal's Unicycle admin access for this SNS."; target = "snsRevokeAdmin"; validator = "snsRevokeAdminValidate" },
  ];

  // Build the AddGenericNervousSystemFunction proposal for one Unicycle twin and
  // submit it through the hotkeyed neuron (US23). Summary is plain text — no
  // backend formatting (US20).
  func submitSnsAddFunctionProposal(
    governance : Principal,
    neuronId : Blob,
    fn : Types.SnsNervousSystemFunction,
  ) : async Result.Result<Nat, Text> {
    await submitSnsProposal(
      governance,
      neuronId,
      "Register Unicycle function: " # fn.name,
      "Registers the Unicycle \"" # fn.name # "\" custom function on this SNS so it can be invoked by proposal.",
      #AddGenericNervousSystemFunction(fn),
    );
  };

  // Thin wrapper supplying the `#TransferSnsTreasuryFunds` action (US24) — the
  // `manage_neuron` call and response mapping stay in the single `submitSnsProposal`
  // core. Used by `checkSnsDeposit` for the automatic deposit top-up.
  func submitSnsTreasuryTransferProposal(
    governance : Principal,
    neuronId : Blob,
    title : Text,
    summary : Text,
    transfer : Types.SnsTransferTreasuryFunds,
  ) : async Result.Result<Nat, Text> {
    await submitSnsProposal(governance, neuronId, title, summary, #TransferSnsTreasuryFunds(transfer));
  };

  // Core of US23 setup, shared by the `snsSetup` twin and `adminSnsSetup`.
  // Records the proposal neuron (US22 store) then walks `snsFunctionSpecs`,
  // submitting one registration proposal per twin with id `baseFunctionId + i`
  // (both target and validator are this backend). Best-effort: each
  // `manage_neuron` call is already committed on governance once it returns, so a
  // later failure cannot roll back earlier ones — per-function outcomes are
  // returned for inspection rather than trapping mid-walk.
  func runSnsSetup(
    governance : Principal,
    root : Principal,
    neuronId : Blob,
    baseFunctionId : Nat64,
  ) : async [SnsFunctionRegistration] {
    snsProposalNeuron.add(root, neuronId);
    let backendId = Principal.fromActor(self);
    let regs = List.empty<SnsFunctionRegistration>();
    var i : Nat = 0;
    for (spec in snsFunctionSpecs.vals()) {
      let functionId = baseFunctionId + Nat64.fromNat(i);
      let fn : Types.SnsNervousSystemFunction = {
        id = functionId;
        name = spec.name;
        description = ?spec.description;
        function_type = ?#GenericNervousSystemFunction({
          target_canister_id = ?backendId;
          target_method_name = ?spec.target;
          validator_canister_id = ?backendId;
          validator_method_name = ?spec.validator;
          topic = ?#ApplicationBusinessLogic;
        });
      };
      let result = await submitSnsAddFunctionProposal(governance, neuronId, fn);
      regs.add({ method = spec.target; functionId; result });
      i += 1;
    };
    regs.toArray();
  };

  // SNS-only execute twin (US23). Resolves the governance caller → SNS root
  // (US21), records the proposal neuron from the arg (US22 store), then submits
  // the registration proposals. Traps only on *systemic* failure (nothing
  // submitted) so a genuinely-failed setup fails the proposal; a partial success
  // reports success, with per-function outcomes inspectable via `adminSnsSetup`.
  public shared ({ caller }) func snsSetup(arg : SnsSetupArg) : async () {
    let root = requireSnsRoot(await resolveSnsRoot(caller), "snsSetup");
    if (arg.neuronId.size() != 32) { Runtime.trap("snsSetup: neuronId must be 32 bytes") };
    let regs = await runSnsSetup(caller, root, arg.neuronId, arg.baseFunctionId);
    var anyOk = false;
    for (r in regs.vals()) {
      switch (r.result) { case (#ok _) { anyOk := true }; case (#err _) {} };
    };
    if (not anyOk) {
      Runtime.trap("snsSetup: no registration proposals submitted (neuron not hotkeyed / governance unreachable)");
    };
    log(#info, #sns, "snsSetup for root " # root.toText(), ?caller);
  };

  // Pure payload validation for `snsSetup` (no caller). Echoes the id range so
  // voters see exactly which functions will be registered; rejects a base in the
  // reserved native range (< 1000) and a non-32-byte neuron.
  public func snsSetupValidate(arg : SnsSetupArg) : async SnsValidateResult {
    if (arg.neuronId.size() != 32) return #Err("neuronId must be 32 bytes");
    if (arg.baseFunctionId < 1000) return #Err("baseFunctionId must be >= 1000");
    let count = snsFunctionSpecs.size();
    let lastId = arg.baseFunctionId + Nat64.fromNat(count) - 1;
    #Ok(
      "Register " # count.toText() # " Unicycle custom functions (ids "
      # arg.baseFunctionId.toText() # "–" # lastId.toText()
      # ") on this SNS and set the proposal-submission neuron."
    );
  };

  // ---------------------------------------------------------------------------
  // Automatic deposit top-up check (US24). Run for each configured SNS on the
  // recurring `performCycleCheck`: read the SNS's Unicycle ICP deposit-subaccount
  // balance and, when it is below the configured minimum, submit one
  // `TransferSnsTreasuryFunds` proposal moving the configured amount from the SNS
  // treasury into that subaccount — optionally embedding a cycle-usage report.
  // ---------------------------------------------------------------------------

  // Multi-range cycle-usage report engine (US25). Gathers (canisterId, readings)
  // pairs from `tracked` then delegates to the pure Report.build.
  func buildCycleUsageReport(root : Principal) : Text {
    let pairs = List.empty<(Principal, [CycleReading])>();
    switch (tracked.get(root)) {
      case null {};
      case (?userMap) { for ((canisterId, _cfg) in userMap.entries()) { pairs.add((canisterId, readingsFor(canisterId))) } };
    };
    Report.build(pairs.toArray(), Int.abs(Time.now()));
  };

  // Per-SNS check core, shared by the timer fan-out and `adminSnsRunDepositCheck`.
  // Reuses `icpBalanceOf(root)` (reads the US21 deposit subaccount on the ICP
  // ledger) and `Subaccount.ofPrincipal(root)` for the transfer destination — the
  // exact account `getSnsDepositAccount` returns. Skips (with a reason) when
  // disabled, in cooldown, above threshold, or missing a proposal neuron; on a
  // submitted proposal it records the cooldown timestamp.
  func checkSnsDeposit(governance : Principal, root : Principal, cfg : SnsSetDepositConfigArg) : async SnsDepositCheckOutcome {
    let mk = func(bal : Nat, action : SnsDepositAction) : SnsDepositCheckOutcome {
      { governance; root; balanceE8s = bal; minBalanceE8s = cfg.minBalanceE8s; depositAmountE8s = cfg.depositAmountE8s; action };
    };
    if (cfg.minBalanceE8s == 0) return mk(0, #skippedDisabled);
    switch (snsLastDepositProposal.get(root)) {
      case (?t) { if ((Int.abs(Time.now()) - t : Nat) < DEPOSIT_PROPOSAL_COOLDOWN_NS) return mk(0, #skippedCooldown) };
      case null {};
    };
    let bal = await icpBalanceOf(root);
    if (bal >= cfg.minBalanceE8s) return mk(bal, #skippedAboveThreshold);
    let neuronId = switch (snsProposalNeuron.get(root)) { case (?n) n; case null { return mk(bal, #skippedNoNeuron) } };
    var summary = "The SNS's Unicycle ICP deposit balance (" # bal.toText()
      # " e8s) is below the configured minimum (" # cfg.minBalanceE8s.toText()
      # " e8s). This proposal transfers " # cfg.depositAmountE8s.toText()
      # " e8s ICP from the SNS treasury into the SNS's Unicycle deposit subaccount.";
    if (cfg.includeReport) { summary #= "\n\n" # buildCycleUsageReport(root) };
    let transfer : Types.SnsTransferTreasuryFunds = {
      from_treasury = 1;        // ICP treasury (verified against the live candid)
      to_principal = ?Principal.fromActor(self);
      to_subaccount = ?{ subaccount = Subaccount.ofPrincipal(root) };
      memo = null;
      amount_e8s = Nat64.fromNat(cfg.depositAmountE8s);
    };
    // ASYNC-1: claim the per-root guard synchronously before the submit await so
    // a concurrent run for this root can't also submit a duplicate proposal.
    if (snsCheckInFlight.contains(root)) return mk(bal, #skippedCooldown);
    snsCheckInFlight.add(root);
    switch (await submitSnsTreasuryTransferProposal(governance, neuronId, "Unicycle: top up SNS deposit", summary, transfer)) {
      case (#ok id) {
        snsLastDepositProposal.add(root, Int.abs(Time.now()));
        ignore snsCheckInFlight.delete(root);
        log(#info, #sns, "deposit proposal " # id.toText() # " submitted for root " # root.toText(), null);
        mk(bal, #submitted(id));
      };
      case (#err e) {
        ignore snsCheckInFlight.delete(root);
        log(#error, #sns, "deposit proposal failed for root " # root.toText() # ": " # e, null);
        mk(bal, #failed(e));
      };
    };
  };

  // Timer fan-out (US24): snapshot `(governance, root, cfg)` for every configured
  // SNS BEFORE any await — iterating the mutable `snsRootByGovernance` /
  // `snsDepositConfig` maps across an await is unsafe (a parallel
  // `snsSetDepositConfig` could mutate them mid-sweep) — then check each. Wired
  // into `performCycleCheck` alongside `runTopUps` / `runHarvest` / `runLpDrain`.
  func runSnsDepositChecks() : async () {
    let jobs = List.empty<(Principal, Principal, SnsSetDepositConfigArg)>();
    for ((governance, root) in snsRootByGovernance.entries()) {
      switch (snsDepositConfig.get(root)) {
        case (?cfg) { jobs.add((governance, root, cfg)) };
        case null {};
      };
    };
    for ((governance, root, cfg) in jobs.values()) {
      ignore (await checkSnsDeposit(governance, root, cfg));
    };
  };

  // ---------------------------------------------------------------------------
  // Automatic cycle-usage report check (US25). Run for each configured SNS on the
  // recurring `performCycleCheck`: when a report is due per the configured cadence,
  // submit one `#Motion` proposal whose body is `buildCycleUsageReport(root)`.
  // The cadence is the only frequency guard (no separate cooldown). An empty
  // fleet still fires — the engine renders the one-line "no tracked canisters"
  // body and the motion is still submitted (an opt-in recurring heartbeat).
  // ---------------------------------------------------------------------------

  // Per-SNS check core, shared by the timer fan-out and `adminSnsRunReportCheck`.
  // Mirrors `checkSnsDeposit` but gates on the cadence and submits a `#Motion`.
  // On a submitted proposal it stamps the cadence timestamp.
  func checkSnsReport(governance : Principal, root : Principal, cfg : SnsSetReportConfigArg) : async SnsReportCheckOutcome {
    let trackedCount = switch (tracked.get(root)) { case (?m) m.size(); case null 0 };
    let mk = func(action : SnsReportAction) : SnsReportCheckOutcome {
      { governance; root; cadenceDays = cfg.cadenceDays; trackedCount; action };
    };
    if (cfg.cadenceDays == 0) return mk(#skippedDisabled);
    switch (snsLastReportProposal.get(root)) {
      case (?t) { if ((Int.abs(Time.now()) - t : Nat) < cfg.cadenceDays * Durations.DAY_NS) return mk(#skippedNotDue) };
      case null {};
    };
    let neuronId = switch (snsProposalNeuron.get(root)) { case (?n) n; case null { return mk(#skippedNoNeuron) } };
    let summary = buildCycleUsageReport(root);
    // ASYNC-1: per-root guard before the submit await (see checkSnsDeposit).
    if (snsCheckInFlight.contains(root)) return mk(#skippedNotDue);
    snsCheckInFlight.add(root);
    switch (await submitSnsProposal(governance, neuronId, "Unicycle: cycle usage report", summary, #Motion({ motion_text = summary }))) {
      case (#ok id) {
        snsLastReportProposal.add(root, Int.abs(Time.now()));
        ignore snsCheckInFlight.delete(root);
        log(#info, #sns, "report proposal " # id.toText() # " submitted for root " # root.toText(), null);
        mk(#submitted(id));
      };
      case (#err e) {
        ignore snsCheckInFlight.delete(root);
        log(#error, #sns, "report proposal failed for root " # root.toText() # ": " # e, null);
        mk(#failed(e));
      };
    };
  };

  // Timer fan-out (US25): snapshot `(governance, root, cfg)` for every configured
  // SNS BEFORE any await — iterating the mutable `snsRootByGovernance` /
  // `snsReportConfig` maps across an await is unsafe — then check each. Wired into
  // `performCycleCheck` immediately after `runSnsDepositChecks`.
  func runSnsReportChecks() : async () {
    let jobs = List.empty<(Principal, Principal, SnsSetReportConfigArg)>();
    for ((governance, root) in snsRootByGovernance.entries()) {
      switch (snsReportConfig.get(root)) {
        case (?cfg) { jobs.add((governance, root, cfg)) };
        case null {};
      };
    };
    for ((governance, root, cfg) in jobs.values()) {
      ignore (await checkSnsReport(governance, root, cfg));
    };
  };

  // ---------------------------------------------------------------------------
  // Automatic cycle-drain alert check (US26). Run for each configured SNS on the
  // recurring `performCycleCheck`: per tracked canister compute the most recent day's
  // cycle burn and compare it against three configurable baselines — the 7-day and
  // 30-day average daily burn and the previous day's burn — firing one `#Motion`
  // alert proposal naming every canister that tripped an enabled threshold. The
  // detection is pure integer arithmetic over `cycleHistory` (US10), reusing the
  // US25 readings helpers. Backend-only like US22–US25.
  // ---------------------------------------------------------------------------

  func detectDrainTriggers(root : Principal, cfg : SnsSetDrainAlertConfigArg) : [SnsDrainTrigger] {
    let pairs = List.empty<(Principal, [CycleReading])>();
    switch (tracked.get(root)) {
      case null {};
      case (?userMap) { for ((canisterId, _cfg) in userMap.entries()) { pairs.add((canisterId, readingsFor(canisterId))) } };
    };
    DrainDetection.detectTriggers(pairs.toArray(), Int.abs(Time.now()), cfg);
  };

  // Per-SNS check core, shared by the timer fan-out and `adminSnsRunDrainAlertCheck`.
  // Mirrors `checkSnsReport` but gates on detection results and the cooldown. On a
  // submitted proposal it stamps the cooldown timestamp.
  func checkSnsDrainAlert(governance : Principal, root : Principal, cfg : SnsSetDrainAlertConfigArg) : async SnsDrainAlertCheckOutcome {
    let trackedCount = switch (tracked.get(root)) { case (?m) m.size(); case null 0 };
    let mk = func(triggers : [SnsDrainTrigger], action : SnsDrainAlertAction) : SnsDrainAlertCheckOutcome {
      { governance; root; trackedCount; triggers; action };
    };
    if (cfg.weeklyAvgFactorPct == 0 and cfg.monthlyAvgFactorPct == 0 and cfg.dayOverDayFactorPct == 0) {
      return mk([], #skippedDisabled);
    };
    switch (snsLastDrainAlertProposal.get(root)) {
      case (?t) { if (cfg.alertCooldownDays > 0 and (Int.abs(Time.now()) - t : Nat) < cfg.alertCooldownDays * Durations.DAY_NS) { return mk([], #skippedCooldown) } };
      case null {};
    };
    let triggers = detectDrainTriggers(root, cfg);   // pure, no await
    if (triggers.size() == 0) return mk([], #skippedNoAnomaly);
    let neuronId = switch (snsProposalNeuron.get(root)) { case (?n) n; case null { return mk(triggers, #skippedNoNeuron) } };
    let summary = DrainDetection.buildDrainAlertReport(triggers);
    // ASYNC-1: per-root guard before the submit await (see checkSnsDeposit).
    if (snsCheckInFlight.contains(root)) return mk(triggers, #skippedCooldown);
    snsCheckInFlight.add(root);
    switch (await submitSnsProposal(governance, neuronId, "Unicycle: cycle drain alert", summary, #Motion({ motion_text = summary }))) {
      case (#ok id) {
        snsLastDrainAlertProposal.add(root, Int.abs(Time.now()));
        ignore snsCheckInFlight.delete(root);
        log(#info, #sns, "drain alert proposal " # id.toText() # " submitted for root " # root.toText(), null);
        mk(triggers, #submitted(id));
      };
      case (#err e) {
        ignore snsCheckInFlight.delete(root);
        log(#error, #sns, "drain alert proposal failed for root " # root.toText() # ": " # e, null);
        mk(triggers, #failed(e));
      };
    };
  };

  // Timer fan-out (US26): snapshot `(governance, root, cfg)` for every configured
  // SNS BEFORE any await — iterating the mutable `snsRootByGovernance` /
  // `snsDrainAlertConfig` maps across an await is unsafe — then check each. Wired
  // into `performCycleCheck` immediately after `runSnsReportChecks`.
  func runSnsDrainAlertChecks() : async () {
    let jobs = List.empty<(Principal, Principal, SnsSetDrainAlertConfigArg)>();
    for ((governance, root) in snsRootByGovernance.entries()) {
      switch (snsDrainAlertConfig.get(root)) {
        case (?cfg) { jobs.add((governance, root, cfg)) };
        case null {};
      };
    };
    for ((governance, root, cfg) in jobs.values()) {
      ignore (await checkSnsDrainAlert(governance, root, cfg));
    };
  };

  // ---------------------------------------------------------------------------
  // Admin gating helpers + methods (US29).
  // ---------------------------------------------------------------------------

  func isAdmin(p : Principal) : Bool {
    if (p.isAnonymous()) return false;
    if (admins.contains(p)) return true;
    for (c in cachedControllers.vals()) {
      if (Principal.equal(c, p)) return true;
    };
    false;
  };

  // Queries the IC mgmt canister for this backend's controllers and caches the
  // result. canister_info is a public update method on aaaaa-aa — any canister
  // can call it on its own ID. Fired by a 0-delay timer at every install/upgrade
  // (see bottom of actor); errors are swallowed because there's no caller to
  // surface them to. If a startup refresh fails the cache stays empty until the
  // next upgrade — reinstall to recover.
  func refreshControllers() : async () {
    try {
      let info = await mgmt.canister_info({
        canister_id = Principal.fromActor(self);
        num_requested_changes = ?0;
      });
      cachedControllers := info.controllers;
    } catch (_) {};
  };

  public shared query ({ caller }) func amIAdmin() : async Bool {
    isAdmin(caller);
  };

  public query func getCachedControllers() : async [Principal] {
    cachedControllers;
  };

  public query func getAdmins() : async [Principal] {
    admins.values().toArray();
  };

  public shared ({ caller }) func addAdmin(p : Principal) : async Result.Result<(), AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    admins.add(p);
    log(#info, #admin, "addAdmin " # p.toText(), ?caller);
    #ok();
  };

  public shared ({ caller }) func removeAdmin(p : Principal) : async Result.Result<(), AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    ignore admins.delete(p);
    log(#info, #admin, "removeAdmin " # p.toText(), ?caller);
    #ok();
  };

  // Designate the primary admin whose deposit subaccount funds the service
  // canisters and receives redirected fees (US17). The target must already be
  // an admin — a non-admin target reuses `#notAdmin` rather than adding a new
  // error variant. Call again with a different admin principal to change it.
  public shared ({ caller }) func setPrimaryAdmin(p : Principal) : async Result.Result<(), AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    if (not isAdmin(p)) return #err(#notAdmin);   // target must already be an admin
    primaryAdmin := ?p;
    log(#info, #admin, "setPrimaryAdmin " # p.toText(), ?caller);
    #ok();
  };

  public query func getPrimaryAdmin() : async ?Principal {
    primaryAdmin;
  };

  // Re-point the ICPSwap pool used by US12 without a redeploy (US29). Admin-gated
  // like every admin* method; accepts any principal (a mis-set pool is recoverable
  // by calling this again). The live value is read back via getIcpSwapPool.
  public shared ({ caller }) func setIcpSwapPool(p : Principal) : async Result.Result<(), AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    swapPoolId := p;
    log(#info, #admin, "setIcpSwapPool " # p.toText(), ?caller);
    #ok();
  };

  // Re-point the blackhole canister used for cycle-balance reads without a
  // redeploy. Admin-gated like setIcpSwapPool; accepts any principal (a mis-set
  // blackhole is recoverable by calling this again). The live value is read back
  // via getBlackholeCanister.
  public shared ({ caller }) func setBlackholeCanister(p : Principal) : async Result.Result<(), AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    blackholeId := p;
    log(#info, #admin, "setBlackholeCanister " # p.toText(), ?caller);
    #ok();
  };

  public shared query ({ caller }) func getAdminSettings() : async Result.Result<AdminSettings, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    #ok(settings);
  };

  public shared ({ caller }) func updateAdminSettings(
    next : AdminSettings
  ) : async Result.Result<(), UpdateAdminSettingsError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    switch (Settings.validate(next)) { case (#err e) { return #err(e) }; case (#ok) {} };
    let intervalChanged = next.cycleCheckIntervalSeconds != settings.cycleCheckIntervalSeconds;
    log(#info, #admin, "updateAdminSettings " # debug_show settings # " -> " # debug_show next, ?caller);
    settings := next;
    if (intervalChanged) {
      Timer.cancelTimer(cycleCheckTimerId);
      cycleCheckTimerId := Timer.recurringTimer<system>(
        #seconds(settings.cycleCheckIntervalSeconds),
        performCycleCheck,
      );
    };
    #ok();
  };

  public shared query ({ caller }) func adminListAllTracked() : async Result.Result<[AdminTrackedRow], AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    let rows = List.empty<AdminTrackedRow>();
    for ((owner, userMap) in tracked.entries()) {
      for ((canisterId, config) in userMap.entries()) {
        rows.add({ owner; canisterId; config; latestReading = History.latestOk(readingsFor(canisterId)) });
      };
    };
    #ok(rows.toArray());
  };

  public shared query ({ caller }) func adminListRecentTopUps(
    limit : Nat
  ) : async Result.Result<[AdminTopUpRow], AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    let rows = List.empty<AdminTopUpRow>();
    for ((owner, userMap) in topUpHistory.entries()) {
      for ((canisterId, arr) in userMap.entries()) {
        for (topUp in arr.vals()) {
          rows.add({ owner; canisterId; topUp });
        };
      };
    };
    let all = rows.toArray();
    // Newest-first across all owners. Stored arrays are already newest-first
    // per (owner, canister); a merged sort by attemptedAt descending stitches
    // them into a single timeline.
    let sorted = all.sort(
      func(a, b) {
        if (a.topUp.attemptedAt > b.topUp.attemptedAt) #less else if (a.topUp.attemptedAt < b.topUp.attemptedAt) #greater else #equal;
      }
    );
    let n = if (sorted.size() < limit) sorted.size() else limit;
    #ok(sorted.sliceToArray(0, n));
  };

  public shared query ({ caller }) func adminGetTimerInfo() : async Result.Result<AdminTimerInfo, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    #ok({ cycleCheckIntervalSeconds = settings.cycleCheckIntervalSeconds });
  };

  public shared query ({ caller }) func adminGetMetrics() : async Result.Result<AdminMetrics, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);

    let (ownersCount, trackedCanistersCount) = trackedCounts();

    var readingsTotal : Nat = 0;
    for ((_canisterId, arr) in cycleHistory.entries()) {
      readingsTotal += arr.size();
    };

    var topUpsTotal : Nat = 0;
    for ((_owner, userMap) in topUpHistory.entries()) {
      for ((_canisterId, arr) in userMap.entries()) {
        topUpsTotal += arr.size();
      };
    };

    var inFlightCount : Nat = 0;
    for ((_owner, set) in topUpsInFlight.entries()) {
      inFlightCount += set.size();
    };

    var balanceEventsTotal : Nat = 0;
    for ((_owner, arr) in balanceEvents.entries()) {
      balanceEventsTotal += arr.size();
    };

    #ok({
      ownersCount;
      trackedCanistersCount;
      readingsTotal;
      topUpsTotal;
      inFlightCount;
      serviceCyclesBalance = Cycles.balance();
      memorySizeBytes = Prim.rts_memory_size();
      heapSizeBytes = Prim.rts_heap_size();
      lastCycleCheckAt;
      cumulativeTopUpsSucceeded;
      cumulativeTopUpsFailed;
      balanceEventsTotal;
      logEntriesCount = logEntries.size();
    });
  };

  // The caller's own balance-event stream (newest-first, capped). Anonymous
  // callers get an empty list — same soft-deny shape as getTrackedCanisters.
  public shared query ({ caller }) func getMyBalanceHistory() : async [BalanceEvent] {
    switch (balanceEvents.get(caller)) {
      case (?arr) arr;
      case null { [] };
    };
  };

  // Filtered, newest-first page of the operational/audit log. `beforeSeq` is a
  // strictly-below cursor (pass the last received entry's seq for the next
  // page); a full page (`size == limit`) means there may be more.
  public shared query ({ caller }) func adminGetLogs(filter : LogFilter) : async Result.Result<[LogEntry], AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    let limit = Nat.min(filter.limit, 200);
    let out = List.empty<LogEntry>();
    label scan for (entry in logEntries.vals()) {
      if (out.size() >= limit) break scan;
      switch (filter.beforeSeq) {
        case (?cursor) { if (entry.seq >= cursor) continue scan };
        case null {};
      };
      switch (filter.level) {
        case (?lvl) { if (entry.level != lvl) continue scan };
        case null {};
      };
      switch (filter.category) {
        case (?cat) { if (entry.category != cat) continue scan };
        case null {};
      };
      out.add(entry);
    };
    #ok(out.toArray());
  };

  // The whole capped snapshot history (newest-first, ≤ MAX_METRICS_SNAPSHOTS
  // small records) — the trends dashboard diffs consecutive entries client-side.
  public shared query ({ caller }) func adminGetMetricsSnapshots() : async Result.Result<[MetricsSnapshot], AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    #ok(metricsSnapshots);
  };

  // LP / fee-pool observability (US16). Update method (not query) because it
  // awaits the live fee-pool ledger read. Same admin gating as the other
  // admin-* surfaces.
  public shared ({ caller }) func adminGetLpInfo() : async Result.Result<AdminLpInfo, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    let balance = await feePoolBalance();
    #ok({
      feePoolBalanceTcycles = balance;
      cumulativeFeesTcycles;
      cumulativeAdminFundedTcycles;
      lpPositionId;
      lpHistory;
    });
  };

  // Service-funding observability (US17). Update method (not query) because it
  // awaits the live primary-admin subaccount read via `resolveFeeRouting`.
  // Same admin gating as the other admin-* surfaces.
  public shared ({ caller }) func adminGetServiceFundingInfo() : async Result.Result<AdminServiceFundingInfo, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    let routing = await resolveFeeRouting();
    #ok({
      primaryAdmin;
      serviceFundingThresholdTcycles = settings.serviceFundingThresholdTcycles;
      primaryAdminSubaccountTcycles = routing.subaccountBalance;
      feeRoutingToService = routing.toService;
      cumulativeFeesTcycles;
      cumulativeServiceFundingTcycles;
    });
  };

  // Loyalty observability (US18). A `query` — all reads are in-memory counters.
  // Same admin gating as the other admin-* surfaces.
  public shared query ({ caller }) func adminGetLoyaltyInfo() : async Result.Result<AdminLoyaltyInfo, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    let contribList = List.empty<(Principal, Nat)>();
    for ((p, a) in loyalty.entries()) { contribList.add((p, a.shares)) };
    func bySharesDesc(x : (Principal, Nat), y : (Principal, Nat)) : Order.Order {
      Nat.compare(y.1, x.1);
    };
    let sorted = contribList.toArray().sort(bySharesDesc);
    let topContributors = if (sorted.size() > MAX_TOP_CONTRIBUTORS) {
      sorted.sliceToArray(0, MAX_TOP_CONTRIBUTORS);
    } else { sorted };
    #ok({
      accRewardPerShare;
      totalSharesTcycles = cumulativeFeesTcycles;
      cumulativeSurplusRewardsTcycles;
      cumulativeRebatesGrantedTcycles;
      outstandingRebateCreditTcycles = cumulativeSurplusRewardsTcycles - cumulativeRebatesGrantedTcycles : Nat;
      contributorCount = loyalty.size();
      topContributors;
      harvestHistory;
    });
  };

  // Admin-invoked harvest trigger (US18). Runs the harvest saga and returns the
  // event it just recorded (or a synthesised no-op event if the saga was a
  // guarded no-op). Same admin gating as the other admin-* surfaces.
  public shared ({ caller }) func adminHarvestLpRewards() : async Result.Result<HarvestEvent, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    log(#info, #admin, "adminHarvestLpRewards", ?caller);
    // Apply the same harvest threshold as the recurring path. Below threshold,
    // return a benign zero event (nothing claimed) instead of running the saga; a
    // valuation error falls through so runHarvest surfaces the real failure.
    switch (lpPositionId) {
      case (?pid) {
        if (settings.harvestThresholdTcycles > 0) {
          switch (await harvestPendingMeetsThreshold(pid)) {
            case (#below) {
              return #ok({ at = Int.abs(Time.now()); claimedIcp = 0; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #ok });
            };
            case (#meets) {};
            case (#err _)  {};
          };
        };
      };
      case null {};
    };
    await runHarvest();
    let event = switch (harvestHistory.size()) {
      case 0 { { at = Int.abs(Time.now()); claimedIcp = 0; claimedTcycles = 0; toAdmin = 0; toSurplus = 0; outcome = #ok } };
      case _ { harvestHistory[0] };
    };
    #ok(event);
  };

  // Admin-funded LP top-up. Pulls `amount` TCYCLES from the admin's own wallet
  // (icrc2 approve on the client + transfer_from here, like `deposit`) into the
  // fee pool, then runs the same three drain steps (depositFrom → swap half →
  // pair) to fold exactly that amount into the Unicycle-owned position. Mints the
  // position if none exists yet, else increases it. Deliberately never touches
  // `cumulativeFeesTcycles` / `accRewardPerShare` / `loyalty`, so reward share is
  // unaffected: the admin grows position liquidity but earns no loyalty shares.
  // Gating failures return `#err`; everything past the gate folds into the
  // returned LpEvent's `outcome` (same shape as `adminHarvestLpRewards`). Shares
  // the `lpDrainInFlight` guard with `runLpDrain` for mutual exclusion.
  public shared ({ caller }) func adminFundLpPosition(amount : Nat) : async Result.Result<LpEvent, AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    log(#info, #lp, "adminFundLpPosition " # amount.toText(), ?caller);
    let now = Int.abs(Time.now());
    func fundErr(msg : Text, tcyclesIn : Nat, icpOut : Nat) : LpEvent {
      { at = now; tcyclesIn; icpOut; positionId = lpPositionId; outcome = #err msg };
    };
    func recordFund(event : LpEvent) {
      lpHistory := History.prependCapped(lpHistory, event, MAX_LP_EVENTS);
      switch (event.outcome) {
        case (#ok) { log(#info, #lp, "admin lp fund: " # event.tcyclesIn.toText() # " tcycles in, " # event.icpOut.toText() # " icp out", ?caller) };
        case (#err msg) { log(#error, #lp, "admin lp fund failed: " # msg, ?caller) };
      };
    };

    if (amount == 0) return #ok(fundErr("zero amount", 0, 0));

    // Claim the saga guard synchronously, before the first await — mutual
    // exclusion with the timer-driven drain (and concurrent admin funds).
    // Released on every return path below.
    if (lpDrainInFlight) return #ok(fundErr("LP operation in flight; retry", 0, 0));
    lpDrainInFlight := true;

    // Step 0: pull the admin's TCYCLES from their wallet into the fee pool
    // (backend default account). The transfer_from fee is paid by the admin's
    // account, so the pool is credited exactly `amount`.
    let ledger : ICRC2.Self = actor (Tokens.ledgerCanisterId(#TCYCLES).toText());
    let pulled = try {
      await ledger.icrc2_transfer_from({
        spender_subaccount = null;
        from = { owner = caller; subaccount = null };
        to = { owner = Principal.fromActor(self); subaccount = null };
        amount;
        fee = null;
        memo = null;
        created_at_time = null;
      });
    } catch (e) {
      lpDrainInFlight := false;
      return #ok(fundErr("transfer_from unreachable: " # e.message(), 0, 0));
    };
    switch (pulled) {
      case (#Err err) { lpDrainInFlight := false; return #ok(fundErr("transfer_from: " # debug_show err, 0, 0)) };
      case (#Ok _)    {};
    };
    // Funds are now committed to the LP flow — count them even if a later step
    // parks them in the fee pool (the next drain folds them into the position).
    cumulativeAdminFundedTcycles += amount;

    // Steps 1-3: identical to runLpDrain, but scoped to exactly `amount` (the
    // helpers approve/depositFrom a specific amount, so pre-existing accrued
    // fees in the pool are left untouched).
    let credited : Nat = switch (await depositFeesToPool(amount)) {
      case (#err msg) { let e = fundErr("deposit: " # msg, 0, 0); recordFund(e); lpDrainInFlight := false; return #ok(e) };
      case (#ok n) { n };
    };
    let half = credited / 2;
    let swappedIcp : Nat = switch (await swapHalfTcyclesForIcp(half)) {
      case (#err msg) {
        // Un-strand the deposited TCYCLES on a floored/failed swap (FIN-1),
        // mirroring runLpDrain — pull them back to the fee pool.
        let recovery = if (credited > tcyclesLedgerFee) {
          switch (await withdrawTcyclesToFeePool(credited)) { case (#ok _) { "" }; case (#err w) { "; recover failed: " # w } };
        } else { "" };
        let e = fundErr("swap: " # msg # recovery, credited, 0); recordFund(e); lpDrainInFlight := false; return #ok(e);
      };
      case (#ok n) { n };
    };
    let event : LpEvent = switch (await pairIntoPosition(credited - half, swappedIcp)) {
      case (#err msg) { fundErr("lp pair: " # msg, credited, swappedIcp) };
      case (#ok newPositionId) {
        if (lpPositionId == null) { lpPositionId := ?newPositionId };
        { at = now; tcyclesIn = credited; icpOut = swappedIcp; positionId = lpPositionId; outcome = #ok };
      };
    };
    recordFund(event);
    lpDrainInFlight := false;
    #ok(event);
  };

  // Admin-triggerable test of the US22 hotkey submission path. US22 has no
  // automatic trigger yet (those are US24+), so the submission helper is
  // verified — and operationally confirmable ("is this SNS's hotkey live?") —
  // by an admin calling it directly. Returns the new `proposal_id` on success,
  // or the governance/config error. Not an SNS twin (an SNS would need a
  // registered function to call it, which is US23).
  public shared ({ caller }) func adminSubmitSnsTestMotion(governance : Principal, summary : Text) : async Result.Result<Nat, Text> {
    if (not isAdmin(caller)) return #err("not admin");
    log(#info, #admin, "adminSubmitSnsTestMotion " # governance.toText(), ?caller);
    await submitSnsMotionProposal(governance, "Unicycle hotkey test", summary);
  };

  // Admin-gated runner for the US23 one-time setup. Runs the same `runSnsSetup`
  // core the `snsSetup` twin uses, but returns the per-function registration
  // outcomes so an operator can see exactly which functions registered (the twin
  // returns `()` / traps, so it is unobservable locally).
  public shared ({ caller }) func adminSnsSetup(
    governance : Principal,
    neuronId : Blob,
    baseFunctionId : Nat64,
  ) : async Result.Result<[SnsFunctionRegistration], Text> {
    if (not isAdmin(caller)) return #err("not admin");
    let root = switch (await resolveSnsRoot(governance)) {
      case (?r) r;
      case null { return #err("governance is not a recognized SNS") };
    };
    if (neuronId.size() != 32) return #err("neuronId must be 32 bytes");
    log(#info, #admin, "adminSnsSetup " # governance.toText(), ?caller);
    #ok(await runSnsSetup(governance, root, neuronId, baseFunctionId));
  };

  // Admin-gated observability for the US24 automatic deposit check. The real path
  // is timer-driven and returns nothing, so — mirroring `adminSubmitSnsTestMotion`
  // / `adminSnsSetup` — an admin runs the same `checkSnsDeposit` core for one SNS
  // and gets back the structured outcome (it faithfully honours the cooldown).
  public shared ({ caller }) func adminSnsRunDepositCheck(governance : Principal) : async Result.Result<SnsDepositCheckOutcome, Text> {
    if (not isAdmin(caller)) return #err("not admin");
    let root = switch (await resolveSnsRoot(governance)) {
      case (?r) r;
      case null { return #err("governance is not a recognized SNS") };
    };
    let cfg = switch (snsDepositConfig.get(root)) {
      case (?c) c;
      case null { return #err("no deposit config set for this SNS") };
    };
    #ok(await checkSnsDeposit(governance, root, cfg));
  };

  // Admin-gated observability for the US25 automatic report check (mirrors
  // `adminSnsRunDepositCheck`): runs the same `checkSnsReport` core for one SNS
  // and returns the structured outcome (faithfully honouring the cadence guard).
  public shared ({ caller }) func adminSnsRunReportCheck(governance : Principal) : async Result.Result<SnsReportCheckOutcome, Text> {
    if (not isAdmin(caller)) return #err("not admin");
    let root = switch (await resolveSnsRoot(governance)) {
      case (?r) r;
      case null { return #err("governance is not a recognized SNS") };
    };
    let cfg = switch (snsReportConfig.get(root)) {
      case (?c) c;
      case null { return #err("no report config set for this SNS") };
    };
    #ok(await checkSnsReport(governance, root, cfg));
  };

  // Admin-gated observability for the US26 automatic drain-alert check (mirrors
  // `adminSnsRunReportCheck`): runs the same `checkSnsDrainAlert` core for one SNS
  // and returns the structured outcome (faithfully honouring the cooldown guard).
  public shared ({ caller }) func adminSnsRunDrainAlertCheck(governance : Principal) : async Result.Result<SnsDrainAlertCheckOutcome, Text> {
    if (not isAdmin(caller)) return #err("not admin");
    let root = switch (await resolveSnsRoot(governance)) {
      case (?r) r;
      case null { return #err("governance is not a recognized SNS") };
    };
    let cfg = switch (snsDrainAlertConfig.get(root)) {
      case (?c) c;
      case null { return #err("no drain-alert config set for this SNS") };
    };
    #ok(await checkSnsDrainAlert(governance, root, cfg));
  };

  // Admin-only seeding diagnostic (US26). Unlike US24/US25's skip/submit paths,
  // the drain-alert headline path needs a day-spanning cycle spike in
  // `cycleHistory`, which there is no production way to create on the local replica
  // (US06 registration requires blackhole controllership and the recurring recorder
  // writes real balances at one instant). This overwrites the canister's history
  // with `#ok` readings at `now − daysAgo·DAY_NS` and inserts a placeholder tracked
  // entry under `owner`, bypassing US06's precondition — the same spirit as
  // US24/US25's admin run-check twins. Admin-gated; never SNS-callable.
  public shared ({ caller }) func adminSeedDrainFixture(
    owner : Principal, canisterId : Principal, points : [DrainSeedPoint],
  ) : async Result.Result<(), AdminError> {
    if (caller.isAnonymous()) return #err(#anonymous);
    if (not isAdmin(caller)) return #err(#notAdmin);
    log(#info, #admin, "adminSeedDrainFixture " # canisterId.toText() # " (" # points.size().toText() # " points)", ?caller);
    let now = Int.abs(Time.now());
    // newest-first (cycleHistory invariant): smallest daysAgo first
    let sorted = Array.sort<DrainSeedPoint>(points, func(a, b) { Nat.compare(a.daysAgo, b.daysAgo) });
    let readings = Array.map<DrainSeedPoint, CycleReading>(sorted, func(p) {
      { recordedAt = if (now > p.daysAgo * Durations.DAY_NS) { now - p.daysAgo * Durations.DAY_NS } else { 0 }; result = #ok(p.balanceCycles) };
    });
    cycleHistory.add(canisterId, readings);
    let userMap = switch (tracked.get(owner)) {
      case (?m) m;
      case null { let f = Map.empty<Principal, CanisterConfig>(); tracked.add(owner, f); f };
    };
    switch (userMap.get(canisterId)) {
      case (?_) {};
      case null { userMap.add(canisterId, { minCycleBalance = 1; cycleTopUpAmount = 1; suspendedUntil = null; nickname = null }) };
    };
    #ok();
  };

  // ---------------------------------------------------------------------------
  // Ingress message inspection (todo-25) — cycle-drain pre-filter.
  //
  // `inspect` runs on a single replica *before* consensus and lets us reject an
  // obviously-illegitimate ingress update call before it costs the canister the
  // cycles of consensus + argument decoding + any inter-canister fan-out. It is
  // NOT a security boundary (it runs on one, possibly-malicious replica and is
  // never invoked for inter-canister or query calls) so every check below is
  // *also* enforced inside the method itself (`isAdmin` / `requireSnsRoot` /
  // `isAnonymous`). This is purely an optimization that makes spam cheap to shed.
  //
  // Buckets (the rest fall through to `accept`):
  //   * admin-only update methods        → require `isAdmin(caller)`. These fan
  //     out to ledger / swap-pool / mgmt calls, so unauthenticated spam is the
  //     most expensive to let through.
  //   * SNS governance-only execute twins → reject ALL ingress. Their only
  //     legitimate caller is an SNS governance canister (an inter-canister call,
  //     which bypasses inspect entirely), so any message that reaches inspect is
  //     an attacker — and letting one through would trigger `resolveSnsRoot`'s
  //     live SNS-Wasm registry refresh (an inter-canister call) per spam call.
  //   * authenticated user methods        → reject the anonymous principal.
  //
  // Payloads are typed `Any` (we never decode them here, only the caller + the
  // raw `arg` size matter). The global cap sheds oversized argument blobs up
  // front: every real call is well under 1 KiB — the only variable-size args are
  // a `CanisterConfig` nickname (a short UI label) and `adminSeedDrainFixture`'s
  // point vector (a few hundred points, admin-only local diagnostic). 4 KiB
  // leaves comfortable headroom while bounding how much junk an identity-passing
  // caller can force the canister to ingest per message: inspect doesn't decode
  // the arg, so a malformed-but-accepted blob is paid for at induction, then
  // traps on decode inside the method (before the todo-24 rate limiter sees it).
  transient let MAX_INGRESS_ARG_BYTES : Nat = 4_096; // 4 KiB

  system func inspect(
    {
      caller : Principal;
      arg : Blob;
      // moc requires inspect's `msg` variant to enumerate *every* public method.
      // Payloads are `Any` — we branch on `caller` + the raw `arg` size only,
      // never on decoded arguments. The actual accept/reject decisions live in
      // the `switch` below; anything not in an explicit bucket there is accepted
      // (queries never reach inspect; the `get*` / `*Validate` reads are public).
      msg : {
        #addAdmin : Any;
        #adminFundLpPosition : Any;
        #adminGetLogs : Any;
        #adminGetLoyaltyInfo : Any;
        #adminGetLpInfo : Any;
        #adminGetMetrics : Any;
        #adminGetMetricsSnapshots : Any;
        #adminGetServiceFundingInfo : Any;
        #adminGetTimerInfo : Any;
        #adminHarvestLpRewards : Any;
        #adminListAllTracked : Any;
        #adminListRecentTopUps : Any;
        #adminRemoveCanister : Any;
        #adminSeedDrainFixture : Any;
        #adminSnsRunDepositCheck : Any;
        #adminSnsRunDrainAlertCheck : Any;
        #adminSnsRunReportCheck : Any;
        #adminSnsSetup : Any;
        #adminSubmitSnsTestMotion : Any;
        #amIAdmin : Any;
        #asSnsGetCanisterHistory : Any;
        #asSnsGetFleetSummary : Any;
        #asSnsGetTrackedCanisters : Any;
        #asSnsRecordCyclesNow : Any;
        #asSnsRemoveCanister : Any;
        #asSnsSetCanisterSuspended : Any;
        #asSnsUpsertCanister : Any;
        #deposit : Any;
        #getAdmins : Any;
        #getAdminSettings : Any;
        #getBlackholeCanister : Any;
        #getCachedControllers : Any;
        #getCanisterHistory : Any;
        #getCmcCanister : Any;
        #getDepositAccount : Any;
        #getFeePoolAccount : Any;
        #getFleetSummary : Any;
        #getIcpSwapPool : Any;
        #getMyBalanceHistory : Any;
        #getMyLoyaltyStatus : Any;
        #getMySnsAdminRoots : Any;
        #getPrimaryAdmin : Any;
        #getSnsAdmins : Any;
        #getSnsDepositAccount : Any;
        #getSnsDepositConfig : Any;
        #getSnsDrainAlertConfig : Any;
        #getSnsProposalNeuron : Any;
        #getSnsReportConfig : Any;
        #getSnsWasmCanister : Any;
        #getTimerSchedule : Any;
        #getTrackedCanisters : Any;
        #recordCyclesNow : () -> Principal; // arg decoded for the rate pre-check below
        #removeAdmin : Any;
        #removeCanister : Any;
        #setBlackholeCanister : Any;
        #setCanisterSuspended : Any;
        #setIcpSwapPool : Any;
        #setPrimaryAdmin : Any;
        #snsDeposit : Any;
        #snsDepositValidate : Any;
        #snsGrantAdmin : Any;
        #snsGrantAdminValidate : Any;
        #snsRecordCyclesNow : Any;
        #snsRecordCyclesNowValidate : Any;
        #snsRemoveCanister : Any;
        #snsRemoveCanisterValidate : Any;
        #snsRevokeAdmin : Any;
        #snsRevokeAdminValidate : Any;
        #snsSetCanisterSuspended : Any;
        #snsSetCanisterSuspendedValidate : Any;
        #snsSetDepositConfig : Any;
        #snsSetDepositConfigValidate : Any;
        #snsSetDrainAlertConfig : Any;
        #snsSetDrainAlertConfigValidate : Any;
        #snsSetProposalNeuron : Any;
        #snsSetProposalNeuronValidate : Any;
        #snsSetReportConfig : Any;
        #snsSetReportConfigValidate : Any;
        #snsSetup : Any;
        #snsSetupValidate : Any;
        #snsUpsertCanister : Any;
        #snsUpsertCanisterValidate : Any;
        #snsWithdraw : Any;
        #snsWithdrawValidate : Any;
        #updateAdminSettings : Any;
        #upsertCanister : Any;
        #whoami : Any;
        #withdraw : Any;
      };
    }
  ) : Bool {
    if (arg.size() > MAX_INGRESS_ARG_BYTES) return false;

    switch (msg) {
      // Admin-only: mirror the internal `isAdmin(caller)` gate.
      case (
        #addAdmin _ or #removeAdmin _ or #setPrimaryAdmin _ or #setIcpSwapPool _
        or #setBlackholeCanister _
        or #updateAdminSettings _ or #adminGetLpInfo _ or #adminGetServiceFundingInfo _
        or #adminFundLpPosition _
        or #adminHarvestLpRewards _ or #adminSubmitSnsTestMotion _ or #adminSnsSetup _
        or #adminSnsRunDepositCheck _ or #adminSnsRunReportCheck _
        or #adminSnsRunDrainAlertCheck _ or #adminSeedDrainFixture _
        or #adminRemoveCanister _
      ) { isAdmin(caller) };

      // SNS governance-only execute twins: legitimate callers are governance
      // canisters (inter-canister → never reaches inspect), so reject all ingress.
      case (
        #snsDeposit _ or #snsWithdraw _ or #snsUpsertCanister _
        or #snsSetCanisterSuspended _ or #snsRemoveCanister _ or #snsRecordCyclesNow _
        or #snsSetProposalNeuron _ or #snsGrantAdmin _ or #snsRevokeAdmin _
        or #snsSetDepositConfig _ or #snsSetReportConfig _ or #snsSetDrainAlertConfig _
        or #snsSetup _
      ) { false };

      // Manual "check now": reject anonymous, then shed a caller that has
      // already hit its todo-24 manual-check cap — a best-effort, read-only
      // mirror of `registerManualCheck` (inspect can read `manualChecks` but not
      // mutate it, so `recordCyclesNowFor` stays the authoritative enforcer; a
      // burst can still slip a few past before the committed state reflects them,
      // and the method rejects those). Decoding the canisterId arg also rejects a
      // malformed payload here rather than trapping inside the method.
      case (#recordCyclesNow getCanisterId) {
        if (caller.isAnonymous()) { false } else {
          let prior = switch (manualChecks.get(caller)) { case null { [] }; case (?cs) { cs } };
          switch (RateLimit.register(prior, getCanisterId(), Int.abs(Time.now()))) {
            case (#denied) { false };
            case (#ok _) { true };
          };
        };
      };

      // Authenticated user methods: reject the anonymous principal.
      case (
        #deposit _ or #withdraw _ or #upsertCanister _ or #setCanisterSuspended _
        or #removeCanister _ or #asSnsUpsertCanister _
        or #asSnsSetCanisterSuspended _ or #asSnsRemoveCanister _ or #asSnsRecordCyclesNow _
      ) { not caller.isAnonymous() };

      // Queries never reach inspect; public SNS reads / `*Validate` twins accept.
      case (_) { true };
    };
  };

  // Re-armed on every install/upgrade — mo:core/Timer timers are not
  // persisted across upgrades, and re-running the actor body is the
  // documented re-establishment pattern. `var` so updateAdminSettings can
  // cancel-and-rearm with a fresh interval.
  transient var cycleCheckTimerId : Nat = Timer.recurringTimer<system>(
    #seconds(settings.cycleCheckIntervalSeconds),
    performCycleCheck,
  );

  // Bootstrap cachedControllers right after install/upgrade. Actor bodies are
  // synchronous so we can't await mgmt.canister_info directly — a 0-delay
  // timer is the standard pattern for "async setup at canister start".
  ignore Timer.setTimer<system>(#nanoseconds(0), refreshControllers);

  // Bootstrap the SNS governance→root cache from the NNS SNS-Wasm registry on
  // every install/upgrade — same 0-delay pattern (US21).
  ignore Timer.setTimer<system>(#nanoseconds(0), refreshSnsRegistry);
};
