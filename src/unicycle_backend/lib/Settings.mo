import Types "../types";
import Result "mo:core/Result";
import Durations "Durations";

// Admin-settings validation + derived bounds (US29 knobs).
// INVARIANTS:
//   * validate returns the FIRST failing check in source order (zeroValue per
//     field, then intervalTooSmall, feeBpsTooHigh, lpThresholdTooLow), else #ok.
//   * suspendDeadline enforces the server-side 60-day auto-removal cap.
module {
  public let MIN_CYCLE_CHECK_INTERVAL_SECONDS : Nat = 60;
  public let MAX_BASE_SERVICE_FEE_BPS : Nat = 2_000;
  public let MIN_LP_DRAIN_THRESHOLD_TCYCLES : Nat = 100_000_000;
  public let MAX_SWAP_SLIPPAGE_BPS : Nat = 2_000; // above this the floor stops protecting

  public func validate(next : Types.AdminSettings) : Result.Result<(), Types.UpdateAdminSettingsError> {
    if (next.cycleCheckIntervalSeconds == 0) { return #err(#zeroValue { field = "cycleCheckIntervalSeconds" }) };
    if (next.cycleCheckIntervalSeconds < MIN_CYCLE_CHECK_INTERVAL_SECONDS) { return #err(#intervalTooSmall { minSeconds = MIN_CYCLE_CHECK_INTERVAL_SECONDS }) };
    if (next.maxReadingsPerCanister == 0) { return #err(#zeroValue { field = "maxReadingsPerCanister" }) };
    if (next.maxTopUpsPerCanister == 0) { return #err(#zeroValue { field = "maxTopUpsPerCanister" }) };
    if (next.batchSize == 0) { return #err(#zeroValue { field = "batchSize" }) };
    if (next.maxOwners == 0) { return #err(#zeroValue { field = "maxOwners" }) };
    if (next.maxCanistersPerOwner == 0) { return #err(#zeroValue { field = "maxCanistersPerOwner" }) };
    if (next.baseServiceFeeBps > MAX_BASE_SERVICE_FEE_BPS) { return #err(#feeBpsTooHigh { maxBps = MAX_BASE_SERVICE_FEE_BPS }) };
    if (next.lpDrainThresholdTcycles < MIN_LP_DRAIN_THRESHOLD_TCYCLES) { return #err(#lpThresholdTooLow { minTcycles = MIN_LP_DRAIN_THRESHOLD_TCYCLES }) };
    if (next.swapSlippageBps > MAX_SWAP_SLIPPAGE_BPS) { return #err(#swapSlippageTooHigh { maxBps = MAX_SWAP_SLIPPAGE_BPS }) };
    #ok();
  };

  // server-side 60-day suspension cap; `now` is ns-since-epoch.
  public func suspendDeadline(now : Nat) : Nat { now + 60 * Durations.DAY_NS };
}
