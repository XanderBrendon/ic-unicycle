import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Result "mo:core/Result";
import ICRC2 "icrc2";
import ICRC1 "icrc1";

module {

  // ===========================================================================
  // STABLE SCHEMA EVOLUTION POLICY (MIG-1 / MIG-2)
  //
  // The canister runs on enhanced orthogonal persistence (moc default; no
  // `--legacy-persistence`), so live state survives upgrades automatically. What
  // is NOT automatic is *type evolution* of the records persisted in main.mo
  // (the `tracked` / history / audit / metrics state). The types below are the
  // frozen v1 on-chain schema; treat changes to them as schema migrations:
  //
  //   * ADDING A FIELD: make it OPTIONAL (`?T`). An added `?T` field is
  //     upgrade-compatible and needs no migration code — old values read back as
  //     `null`. This is the default for every new field on a stored record
  //     (the pattern `CanisterConfig.nickname` already uses). DO THIS.
  //
  //   * NON-OPTIONAL field add, type change, field rename/removal, or changing a
  //     variant tag's payload: these are NOT upgrade-compatible. The upgrade
  //     TRAPS at install (error M0170, which is intentionally not suppressed in
  //     mops.toml) unless shipped with an explicit `(with migration = <func>)`
  //     module on the actor. Avoid them; when unavoidable, write the migration.
  //
  // Stored records this governs (see main.mo persistent state): CanisterConfig,
  // TopUp, SwapAttempt, CycleReading, HarvestEvent, LpEvent, BalanceEvent,
  // LogEntry, MetricsSnapshot, LoyaltyAccount, AdminSettings. Several embed
  // closed inline variants (e.g. `result`, BalanceEventKind, LogCategory,
  // SwapAttempt.source) — adding a tag to a variant is compatible, but changing
  // an existing tag's payload type is not.
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // Token registry — mirrors BUILT_IN_TOKENS in the frontend wallet. Canonical
  // system ledger ids are identical local and on mainnet.
  // ---------------------------------------------------------------------------

  public type Token = { #ICP; #TCYCLES };

  // ICPSwap V3 SwapPool reference — narrow structural subset of the upstream
  // candid surface vendored under `src/unicycle_backend/icpswap_pool.did`.
  // Only the five methods the US12 group-swap saga uses are typed here. The
  // `pejtq-…` mainnet pool is the production target; local replicas point at
  // the stub canister in `vendor/icpswap/`.
  public type IcpSwapPoolError = {
    #CommonError;
    #InternalError : Text;
    #UnsupportedToken : Text;
    #InsufficientFunds;
  };
  public type IcpSwapPoolToken = { address : Text; standard : Text };
  public type IcpSwapPoolMetadata = {
    token0 : IcpSwapPoolToken;
    token1 : IcpSwapPoolToken;
    fee : Nat;
    sqrtPriceX96 : Nat;
  };
  // --- Internal types — referenced as Types.* in main.mo; NOT part of the candid surface ---

  public type IcpSwapDepositArgs = { token : Text; amount : Nat; fee : Nat };
  public type IcpSwapArgs = {
    zeroForOne : Bool;
    amountIn : Text;
    amountOutMinimum : Text;
  };
  public type IcpSwapWithdrawToSubaccountArgs = {
    token : Text;
    fee : Nat;
    amount : Nat;
    subaccount : Blob;
  };
  // LP-position args (US16). `mint` opens a new position and returns its id;
  // `increaseLiquidity` grows an existing one. Both consume from the backend's
  // unused pool balance (no extra ledger transfer).
  public type IcpSwapMintArgs = {
    token0 : Text;
    token1 : Text;
    fee : Nat;
    tickLower : Int;
    tickUpper : Int;
    amount0Desired : Text;
    amount1Desired : Text;
  };
  public type IcpSwapIncreaseLiquidityArgs = {
    positionId : Nat;
    amount0Desired : Text;
    amount1Desired : Text;
  };
  // Claim the position's accrued trading fees into the backend's unused pool
  // balance (US18). Positions are keyed by `Nat`, matching the real ICPSwap
  // V3 pool (`lpPositionId : ?Nat`).
  public type IcpSwapClaimArgs = { positionId : Nat };

  public type DeployedSns = {
    root_canister_id : ?Principal;
    governance_canister_id : ?Principal;
  };

  // SNS root `list_sns_canisters` response — a query twin of the summary the
  // upsert verification already reads, listing ids regardless of status. Only
  // fields we read are typed; Candid record subtyping drops any extras. The
  // `extensions` slot is deliberately NOT typed here: the reading path
  // (`get_sns_canisters_summary` via `snsRootCycles`) has no extensions slot,
  // so an extension canister can never be read/topped up — dropping it keeps
  // the verification surface equal to the reading surface.
  public type SnsListCanistersResponse = {
    root : ?Principal;
    governance : ?Principal;
    ledger : ?Principal;
    swap : ?Principal;
    index : ?Principal;
    dapps : [Principal];
    archives : [Principal];
  };

  public type SnsMotion = { motion_text : Text };
  // US23 extends the action surface with `AddGenericNervousSystemFunction` so
  // `snsSetup` can register the Unicycle twins as SNS custom functions. Verified
  // against the dfinity/ic SNS governance candid: `topic` is `opt Topic` and we
  // send `?#ApplicationBusinessLogic`. As with `#Motion`, only the tags actually
  // sent are typed — Candid variant subtyping drops the Native function type and
  // the other six `Topic` tags.
  public type SnsTopic = { #ApplicationBusinessLogic };
  public type SnsGenericFunction = {
    target_canister_id : ?Principal;
    target_method_name : ?Text;
    validator_canister_id : ?Principal;
    validator_method_name : ?Text;
    topic : ?SnsTopic;
  };
  public type SnsFunctionType = { #GenericNervousSystemFunction : SnsGenericFunction };
  public type SnsNervousSystemFunction = {
    id : Nat64;
    name : Text;
    description : ?Text;
    function_type : ?SnsFunctionType;
  };
  // Response of SNS governance `list_nervous_system_functions` (query). Only the
  // fields we read are typed; Candid record subtyping drops any extras.
  public type SnsListFunctionsResponse = {
    functions : [SnsNervousSystemFunction];
    reserved_ids : [Nat64];
  };
  // US24 extends the action surface with `TransferSnsTreasuryFunds` — the only
  // mechanism by which SNS governance can move treasury funds, used by the
  // automatic deposit top-up. Verified against a live SNS governance candid
  // (OpenChat `2jvtu-yqaaa-aaaaq-aaama-cai`): `from_treasury` is an `int32`
  // (1 = ICP treasury) and `Subaccount = record { subaccount : blob }`. Only the
  // tags actually sent are typed — Candid variant subtyping drops the rest.
  public type SnsSubaccount = { subaccount : Blob };
  public type SnsTransferTreasuryFunds = {
    from_treasury : Int32;        // 1 = ICP treasury
    to_principal : ?Principal;
    to_subaccount : ?SnsSubaccount;
    memo : ?Nat64;
    amount_e8s : Nat64;
  };
  public type SnsExecuteGenericFunction = { function_id : Nat64; payload : Blob };
  public type SnsAction = {
    #Motion : SnsMotion;
    #AddGenericNervousSystemFunction : SnsNervousSystemFunction;
    #RemoveGenericNervousSystemFunction : Nat64;
    #TransferSnsTreasuryFunds : SnsTransferTreasuryFunds;
    #ExecuteGenericNervousSystemFunction : SnsExecuteGenericFunction;
  };
  public type SnsProposalArg = { title : Text; url : Text; summary : Text; action : ?SnsAction };
  public type SnsManageNeuron = { subaccount : Blob; command : ?{ #MakeProposal : SnsProposalArg } };
  public type SnsProposalId = { id : Nat64 };
  public type SnsManageNeuronResponse = {
    command : ?{
      #MakeProposal : { proposal_id : ?SnsProposalId };
      #Error : { error_message : Text };
    };
  };

  public type DepositError = {
    #anonymous;
    #zeroAmount;
    #transferFrom : ICRC2.TransferFromError;
  };

  public type WithdrawError = {
    #anonymous;
    #zeroAmount;
    #transfer : ICRC1.TransferError;
  };

  public type CanisterConfig = {
    minCycleBalance : Nat;
    cycleTopUpAmount : Nat;
    // ns-since-epoch deadline; null = not suspended. When non-null, top-up
    // triggers are skipped and the entry is auto-removed once the deadline
    // passes. Mutable only via `setCanisterSuspended` — `upsertCanister`
    // preserves the prior value and discards the incoming one.
    suspendedUntil : ?Nat;
    // Optional human label for the canister; null = unnamed (the UI falls
    // back to the principal id). Additive optional field — existing stored
    // configs deserialize as null on upgrade. Settable via `upsertCanister`:
    // `mergeConfig` takes the incoming value (unlike `suspendedUntil`).
    nickname : ?Text;
    // The SNS root this entry was verified against (user-tracked SNS funding).
    // null = blackhole-verified, or an entry owned by an SNS root itself.
    // Additive optional field — existing stored configs deserialize as null.
    // Written ONLY by upsertCanisterFor's verification outcome; incoming
    // values are discarded like `suspendedUntil`.
    snsRoot : ?Principal;
  };

  public type UpsertCanisterError = {
    #anonymous;
    #zeroMinCycleBalance;
    #zeroCycleTopUpAmount;
    #blackholeNotController : { blackholeCanisterId : Principal; reason : Text };
    #snsRootNotController : { snsRootCanisterId : Principal; reason : Text };
    #ownerLimitReached : { maxOwners : Nat };
    #canisterLimitReached : { maxCanistersPerOwner : Nat };
    #rateLimited;
  };

  public type RecordCyclesError = {
    #anonymous;
    #notTracked;
    #rateLimited;
  };

  public type SuspendCanisterError = {
    #anonymous;
    #notTracked;
  };

  public type RemoveCanisterError = {
    #anonymous;
    #notTracked;
    #topUpInFlight;
  };

  public type AddTrackedSnsError = {
    #anonymous;
    #notAnSnsRoot;
    #alreadyTracked;
    #limitReached : { maxTrackedSns : Nat };
  };

  public type RemoveTrackedSnsError = {
    #anonymous;
    #topUpInFlight;
  };

  public type TrackedCanister = {
    canisterId : Principal;
    config : CanisterConfig;
  };

  public type CycleReading = {
    recordedAt : Nat;
    result : { #ok : Nat; #err : Text };
  };

  // Optional per-`TopUp` swap context (US12). Present when the top-up was
  // funded by routing the owner's deposited ICP through the ICPSwap pool;
  // absent for the direct deposited-tcycles path US11 shipped. `amountIn`
  // and `amountOut` are this participant's proportional share of the group
  // swap — `amountIn` is the ICP actually deposited on their behalf,
  // `amountOut` is the TCYCLES the pool was asked to release into their
  // deposit subaccount on the directly-spent leg of the share (the +10%
  // over-purchase buffer's residue lands in the subaccount silently and is
  // consumed by the next trigger). `#stuckInPool` carries the token and the
  // per-participant amount left credited to the pool when the recovery /
  // delivery `withdrawToSubaccount` itself failed.
  //
  // `source` (US30) records which path funded the top-up: `#swap` is US12's
  // ICPSwap route; `#mint` is the direct CMC mint route, which delivers TCYCLES
  // into the same deposit subaccount. For `#mint`, `#stuckInPool { token =
  // "cycles" }` means the minted cycles were retained by the backend (not the
  // pool) after a failed post-mint deposit — `source` disambiguates the location.
  public type SwapAttempt = {
    source : { #swap; #mint };
    amountIn : Nat;
    amountOut : Nat;
    outcome : {
      #ok;
      #err : Text;
      #stuckInPool : { token : Text; amount : Nat };
    };
  };

  // Per-owner top-up attempt. `amount` is captured at trigger time so the
  // recorded entry stays meaningful even if the owner edits cycleTopUpAmount
  // after the fact. `result` carries the cycles-ledger block index on success
  // and a formatted human-readable message on failure. `swap` is populated
  // iff this top-up went through US12's group-swap path.
  public type TopUp = {
    attemptedAt : Nat;
    amount : Nat;
    result : { #ok : Nat; #err : Text };
    swap : ?SwapAttempt;
    serviceFee : Nat;      // NET tcycles transferred to the fee pool for this top-up (0 if disabled/error)
    feeError : ?Text;      // present iff the fee transfer failed but the top-up succeeded
    rebateApplied : Nat;   // loyalty rebate credit netted off the gross fee (US18)
  };

  // Detail-view shape; future additive fields per US13.
  public type CanisterHistory = {
    canisterId : Principal;
    config : CanisterConfig;
    readings : [CycleReading];
    topUps : [TopUp];
  };

  // Validator reply. Capitalized tags so SNS governance can decode it as Rust
  // `Result<String,String>` → `variant { Ok : text; Err : text }`. Do NOT use
  // `Result.Result` here — its lowercase `ok`/`err` would fail to decode.
  public type SnsValidateResult = { #Ok : Text; #Err : Text };

  public type SnsWithdrawArg = { token : Token; amount : Nat };
  public type SnsWithdrawDestinationAccount = { owner : Principal; subaccount : ?Blob };
  public type SnsSetWithdrawDestinationArg = { destination : SnsWithdrawDestinationAccount };
  public type SnsWithdrawDestinationInfo = { destination : SnsWithdrawDestinationAccount; explicit : Bool };
  public type SnsUpsertCanisterArg = {
    canisterId : Principal;
    config : CanisterConfig;
  };
  public type SnsSetSuspendedArg = { canisterId : Principal; suspend : Bool };
  public type SnsRemoveCanisterArg = { canisterId : Principal };
  public type SnsRecordCyclesArg = { canisterId : Principal };
  public type SnsSetProposalNeuronArg = { neuronId : Blob };
  public type SnsGrantAdminArg = { admin : Principal };
  public type SnsRevokeAdminArg = { admin : Principal };
  public type SnsSetupArg = { neuronId : Blob; baseFunctionId : Nat64 };
  // snsDeregister takes no parameters — the SNS is identified by the governance
  // caller. Empty record so the generic-function payload encodes cleanly.
  public type SnsDeregisterArg = {};
  // Automatic deposit top-up config (US24), root-keyed. `minBalanceE8s == 0`
  // means auto-deposit is disabled — a "below minimum" check can never fire at 0.
  public type SnsSetDepositConfigArg = {
    minBalanceE8s : Nat;       // 0 = auto-deposit disabled
    depositAmountE8s : Nat;    // ICP e8s to transfer when below min
    includeReport : Bool;      // embed the cycle-usage report in the proposal
  };
  // Recurring cycle-usage report config (US25), root-keyed. `cadenceDays == 0`
  // means recurring reports are disabled (mirrors US24's `minBalanceE8s == 0`).
  public type SnsSetReportConfigArg = {
    cadenceDays : Nat;   // 0 = recurring reports disabled; else submit a report every N days
  };
  // Cycle-drain alert config (US26), root-keyed. Each factor is a percentage of
  // a fixed baseline a day's burn must exceed to fire; `== 0` turns that check
  // off and all three `== 0` disables the feature (mirrors US24/US25's `== 0`
  // off-switch). `alertCooldownDays` is the configurable max frequency.
  public type SnsSetDrainAlertConfigArg = {
    weeklyAvgFactorPct : Nat;    // fire if a day's burn exceeds this % of the 7-day daily-avg burn; 0 = this check off
    monthlyAvgFactorPct : Nat;   // ... 30-day daily-avg burn; 0 = this check off
    dayOverDayFactorPct : Nat;   // fire if a day's burn exceeds this % of the previous day's burn; 0 = this check off
    alertCooldownDays : Nat;     // min days between alert proposals (max frequency); 0 = no cooldown
  };
  // Per-function outcome of `adminSnsSetup` — `ok` carries the governance
  // proposal id for that registration.
  public type SnsFunctionRegistration = {
    method : Text;
    functionId : Nat64;
    result : Result.Result<Nat, Text>;
  };
  // Per-token outcome of a deregister withdraw. `amount` is what was attempted
  // (0 when skipped for dust); `result` is the ledger block index on success or
  // a human message on skip/failure.
  public type SnsWithdrawOutcome = {
    token : Token;
    amount : Nat;
    result : Result.Result<Nat, Text>;
  };
  // Per-function outcome of a deregister removal. `result` carries the
  // governance proposal id on success.
  public type SnsFunctionRemoval = {
    functionId : Nat64;
    method : Text;
    result : Result.Result<Nat, Text>;
  };
  // What `snsDeregister` / `adminSnsDeregister` did for one SNS.
  public type SnsDeregisterReport = {
    withdrawals : [SnsWithdrawOutcome];
    removedFunctions : [SnsFunctionRemoval];
    clearedConfig : Bool;
  };

  // Outcome of one automatic deposit check (US24). The timer path returns
  // nothing; `adminSnsRunDepositCheck` runs the same `checkSnsDeposit` core for
  // one SNS and returns this so an operator can see exactly what happened.
  public type SnsDepositAction = {
    #submitted : Nat;          // governance proposal id
    #skippedDisabled;
    #skippedCooldown;
    #skippedAboveThreshold;
    #skippedNoNeuron;
    #failed : Text;            // governance/config error from the submit core
  };
  public type SnsDepositCheckOutcome = {
    governance : Principal;
    root : Principal;
    balanceE8s : Nat;
    minBalanceE8s : Nat;
    depositAmountE8s : Nat;
    action : SnsDepositAction;
  };

  // Outcome of one automatic cycle-usage report check (US25). Like US24's
  // deposit outcome, the timer path returns nothing; `adminSnsRunReportCheck`
  // runs the same `checkSnsReport` core for one SNS and returns this.
  public type SnsReportAction = {
    #submitted : Nat;          // governance proposal id
    #skippedDisabled;
    #skippedNotDue;
    #skippedNoNeuron;
    #failed : Text;            // governance/config error from the submit core
  };
  public type SnsReportCheckOutcome = {
    governance : Principal;
    root : Principal;
    cadenceDays : Nat;
    trackedCount : Nat;
    action : SnsReportAction;
  };

  // Outcome of one automatic cycle-drain alert check (US26). Like US24/US25, the
  // timer path returns nothing; `adminSnsRunDrainAlertCheck` runs the same
  // `checkSnsDrainAlert` core for one SNS and returns this. `triggers` carries the
  // detected per-canister breaches so detection is inspectable on a `#submitted`.
  public type SnsDrainTrigger = {
    canisterId : Principal;
    reasons : [Text];   // one human-readable line per breached threshold
  };
  public type SnsDrainAlertAction = {
    #submitted : Nat;          // governance proposal id
    #skippedDisabled;
    #skippedCooldown;
    #skippedNoAnomaly;
    #skippedNoNeuron;
    #failed : Text;            // governance/config error from the submit core
  };
  public type SnsDrainAlertCheckOutcome = {
    governance : Principal;
    root : Principal;
    trackedCount : Nat;
    triggers : [SnsDrainTrigger];
    action : SnsDrainAlertAction;
  };

  public type AdminError = { #anonymous; #notAdmin };

  public type AdminRemoveCanisterError = {
    #anonymous;
    #notAdmin;
    #notTracked;
    #topUpInFlight;
  };

  public type AdminSettings = {
    cycleCheckIntervalSeconds : Nat;
    maxReadingsPerCanister : Nat;
    maxTopUpsPerCanister : Nat;
    batchSize : Nat;
    baseServiceFeeBps : Nat;          // default 1_000 (10.00%)
    lpDrainThresholdTcycles : Nat;    // default 1_000_000_000_000 (1 T)
    serviceFundingThresholdTcycles : Nat;  // US17 — default 10_000_000_000_000 (10 T); 0 disables redirection
    maxOwners : Nat;                  // cap on distinct owner principals in `tracked` (abuse: unbounded heap)
    maxCanistersPerOwner : Nat;       // cap on canisters one owner may track (abuse: unbounded heap)
    swapSlippageBps : Nat;            // FIN-1 — min output floor for internal LP/harvest swaps, vs CMC peg
    harvestThresholdTcycles : Nat;    // default 100_000_000_000 (0.1 T); min pending-reward value to harvest; 0 disables
  };

  public type AdminTrackedRow = {
    owner : Principal;
    canisterId : Principal;
    config : CanisterConfig;
    latestReading : ?CycleReading;   // newest #ok reading, if any — drives the health badge
  };

  public type AdminTopUpRow = {
    owner : Principal;
    canisterId : Principal;
    topUp : TopUp;
  };

  public type AdminTimerInfo = {
    cycleCheckIntervalSeconds : Nat;
  };

  // Owner-facing view of the cycle-check timer (todo-18): the last completed
  // sweep + the configured interval, from which the client estimates the next
  // check (lastCycleCheckAt + interval). The sweep covers the whole fleet in
  // one firing, so this is a single global value, not per-canister.
  public type TimerSchedule = {
    lastCycleCheckAt : ?Nat;          // ns of the last completed sweep; null until first firing
    cycleCheckIntervalSeconds : Nat;
  };

  public type AdminMetrics = {
    ownersCount : Nat;
    trackedCanistersCount : Nat;
    readingsTotal : Nat;
    topUpsTotal : Nat;
    inFlightCount : Nat;
    serviceCyclesBalance : Nat;
    memorySizeBytes : Nat;            // Prim.rts_memory_size()
    heapSizeBytes : Nat;              // Prim.rts_heap_size()
    lastCycleCheckAt : ?Nat;          // ns of the last completed sweep; null until first firing
    cumulativeTopUpsSucceeded : Nat;
    cumulativeTopUpsFailed : Nat;
    balanceEventsTotal : Nat;
    logEntriesCount : Nat;
  };

  public type UpdateAdminSettingsError = {
    #anonymous;
    #notAdmin;
    #zeroValue : { field : Text };
    #intervalTooSmall : { minSeconds : Nat };
    #feeBpsTooHigh : { maxBps : Nat };
    #lpThresholdTooLow : { minTcycles : Nat };
    #swapSlippageTooHigh : { maxBps : Nat };
  };

  public type AdminLpInfo = {
    feePoolBalanceTcycles : Nat;     // live read of the backend default TCYCLES account
    cumulativeFeesTcycles : Nat;
    cumulativeAdminFundedTcycles : Nat; // total ever admin-funded into the LP from a wallet
    lpPositionId : ?Nat;
    lpHistory : [LpEvent];
  };

  // Service-funding observability (US17). Surfaces the primary-admin designation,
  // the redirection threshold, the live primary-admin subaccount balance, the
  // current routing flag, and the cumulative fee vs redirected-fee counters.
  public type AdminServiceFundingInfo = {
    primaryAdmin : ?Principal;
    serviceFundingThresholdTcycles : Nat;
    primaryAdminSubaccountTcycles : Nat;   // live ledger read (0 if no primary admin)
    feeRoutingToService : Bool;            // true iff fees are currently being redirected
    cumulativeFeesTcycles : Nat;           // US16 — total fees ever collected
    cumulativeServiceFundingTcycles : Nat; // US17 — portion redirected to the service
  };

  // Loyalty observability (US18). Aggregate accumulator state + per-contributor
  // shares for the admin loyalty card. A `query` — all reads are in-memory
  // counters. `topContributors` is capped to `MAX_TOP_CONTRIBUTORS`.
  public type AdminLoyaltyInfo = {
    accRewardPerShare : Nat;
    totalSharesTcycles : Nat;                 // = cumulativeFeesTcycles
    cumulativeSurplusRewardsTcycles : Nat;
    cumulativeRebatesGrantedTcycles : Nat;
    outstandingRebateCreditTcycles : Nat;     // surplus − rebates (aggregate unclaimed)
    contributorCount : Nat;
    topContributors : [(Principal, Nat)];     // by shares, descending, capped
    harvestHistory : [HarvestEvent];
  };

  // The caller's own loyalty status (US18). Read-only projection surfaced in the
  // deposit area: cumulative net fees paid + the claimable rebate credit that
  // offsets the next top-up fees.
  public type MyLoyaltyStatus = {
    feeContributedTcycles : Nat;     // caller's shares (cumulative net fees paid)
    claimableRebateTcycles : Nat;    // accrued + pending; offsets the next fees
  };

  public type LoyaltyAccount = {
    shares : Nat; // cumulative NET fees paid by this user (the acc-per-share "shares")
    rewardDebt : Nat; // shares * accRewardPerShare / ACC_PRECISION at last checkpoint
    accrued : Nat; // settled-but-unclaimed rebate credit, in TCYCLES
  };

  public type HarvestEvent = {
    at : Int;
    claimedIcp : Nat; // token0 claimed from the position
    claimedTcycles : Nat; // token1 + ICP-swap output, total TCYCLES realised
    toAdmin : Nat; // service-funding slice sent to the primary admin
    toSurplus : Nat; // remainder shared to users / drained to the LP
    outcome : { #ok; #err : Text };
  };

  public type LpEvent = {
    at : Nat;                  // ns since epoch
    tcyclesIn : Nat;           // tcycles deposited into the pool this event
    icpOut : Nat;              // ICP received from the half-tcycles swap (0 on swap failure)
    positionId : ?Nat;         // id used / created
    outcome : { #ok; #err : Text };
  };

  // Per-owner balance-event ledger. Every backend-driven change to an owner's
  // deposit subaccounts (and their loyalty rebate credit) lands here so the
  // frontend can reconstruct balance series over time, anchored to the live
  // ledger balance. `#rebateSettled` and `#feeCharge.rebateApplied` track the
  // rebate CREDIT — pure accounting, not token movements — and must be
  // excluded from deposit-balance reconstruction.
  public type BalanceEventKind = {
    #deposit;                                                     // credit
    #withdraw;                                                    // debit (amount + ledger fee)
    #topUp : { canisterId : Principal };                          // TCYCLES debit (amount + ledger fee)
    #feeCharge : { canisterId : Principal; rebateApplied : Nat }; // TCYCLES debit (net + ledger fee; 0 if fully rebated)
    #swapFunding : { canisterId : Principal };                    // ICP debit funding the swap leg
    #swapDelivery : { canisterId : Principal };                   // TCYCLES credit landed from the swap
    #mintFunding : { canisterId : Principal };                    // ICP debit funding the direct-mint leg
    #mintDelivery : { canisterId : Principal };                   // TCYCLES credit landed from the mint
    #serviceFunding;                                              // TCYCLES credit to the primary admin (US17)
    #rebateSettled;                                               // rebate credit banked into `accrued` — NOT a token movement
  };

  public type BalanceEvent = {
    at : Nat;                       // ns since epoch
    token : Token;
    amount : Nat;                   // exact subaccount delta incl. ledger fees (rebate kinds: credit amount)
    direction : { #credit; #debit };
    kind : BalanceEventKind;
  };

  // Structured operational + audit log (admin-only surface). `seq` is a
  // monotone id that doubles as the pagination cursor; `caller` is set for
  // admin/SNS-initiated actions and null for timer-driven entries.
  public type LogLevel = { #info; #warn; #error };
  public type LogCategory = { #timer; #topUp; #fee; #swap; #lp; #harvest; #sns; #admin };

  public type LogEntry = {
    seq : Nat;
    at : Nat;                       // ns since epoch
    level : LogLevel;
    category : LogCategory;
    message : Text;
    caller : ?Principal;
  };

  public type LogFilter = {
    level : ?LogLevel;
    category : ?LogCategory;
    beforeSeq : ?Nat;               // strictly-below cursor; null = newest
    limit : Nat;                    // server-capped
  };

  // Service-level snapshot recorded at the end of each cycle-check
  // firing. Cumulative counters are sampled so per-interval deltas (fees collected,
  // top-up volume) can be derived by diffing consecutive snapshots.
  public type MetricsSnapshot = {
    at : Nat;                       // ns since epoch
    ownersCount : Nat;
    trackedCanistersCount : Nat;
    feePoolBalanceTcycles : Nat;
    serviceCyclesBalance : Nat;
    cumulativeFeesTcycles : Nat;
    cumulativeServiceFundingTcycles : Nat;
    cumulativeSurplusRewardsTcycles : Nat;
    cumulativeRebatesGrantedTcycles : Nat;
    cumulativeTopUpsSucceeded : Nat;
    cumulativeTopUpsFailed : Nat;
    cumulativeTopUpTcycles : Nat;
    accRewardPerShare : Nat;
    lpPositionId : ?Nat;
  };

  public type FeeRouting = { subaccount : ?Blob; toService : Bool; subaccountBalance : Nat };

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
  public type DirectTopUpOutcome = {
    #ok : Nat;
    #insufficientFunds : { balance : Nat };
    #fail : Text;
    #skipped;
  };

  public type SwapDemand = {
    owner : Principal;
    canisterId : Principal;
    cycleTopUpAmount : Nat;
    deficit : Nat;
    tcyclesBalanceBefore : Nat;
  };

  public type SwapResolution = {
    icpContribution : Nat;
    tcyclesDelivered : Nat;
    outcome : {
      #ok;
      #err : Text;
      #stuckInPool : { token : Text; amount : Nat };
    };
  };

  // Saga resolutions are accumulated into a List of tuples and returned as
  // an immutable `[(owner, canisterId, SwapResolution)]` — `async` return
  // types must be shared, so a mutable Map can't cross the saga's async
  // boundary back to the orchestrator. The orchestrator's lookup is O(N)
  // linear search, fine for the small participant counts a single firing
  // produces.
  public type ResolutionEntry = (Principal, Principal, SwapResolution);

  public type SnsFunctionSpec = { name : Text; description : Text; target : Text; validator : Text };

  public type DrainSeedPoint = { daysAgo : Nat; balanceCycles : Nat };

}
