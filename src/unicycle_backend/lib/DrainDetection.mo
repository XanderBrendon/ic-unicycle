// Cycle-drain detection logic extracted from main.mo (US26).
//
// Invariants:
//   * All arithmetic is integer-only; no floats.
//   * `avgDailyBurn` requires two distinct-time in-window #ok points; returns null otherwise.
//   * A balance that rose between readings yields netBurn = 0 (saturating subtraction).
//   * `dayOverDayFactorPct` check requires >=3 recent #ok readings.
//   * Reason strings are byte-identical to the originals in main.mo.
import Types "../types";
import History "History";
import Durations "Durations";
import Nat "mo:core/Nat";
import List "mo:core/List";
import Principal "mo:core/Principal";

module {
  // value > (factorPct/100) * baseline, without floats
  public func exceedsFactor(value : Nat, factorPct : Nat, baseline : Nat) : Bool {
    value * 100 > factorPct * baseline;
  };

  // avg daily burn over the last `days` days; null unless there is an in-window
  // #ok reading strictly older than `latest` (i.e. two distinct-time in-window points)
  public func avgDailyBurn(readings : [Types.CycleReading], latest : Types.CycleReading, now : Nat, days : Nat) : ?Nat {
    let since = if (now > days * Durations.DAY_NS) { (now - days * Durations.DAY_NS) : Nat } else { 0 };
    switch (History.oldestOkSince(readings, since)) {
      case null { null };
      case (?oldest) {
        if (oldest.recordedAt >= latest.recordedAt) { return null };
        let spanNs = (latest.recordedAt - oldest.recordedAt) : Nat;
        let spanDays = if (spanNs >= Durations.DAY_NS) { spanNs / Durations.DAY_NS } else { 1 };
        let netBurn = if (History.okBal(oldest) >= History.okBal(latest)) { (History.okBal(oldest) - History.okBal(latest)) : Nat } else { 0 };
        ?(netBurn / spanDays);
      };
    };
  };

  // Pure detector over already-fetched (canisterId, readings) pairs. `now` is ns.
  public func detectTriggers(
    canisters : [(Principal, [Types.CycleReading])],
    now : Nat,
    cfg : Types.SnsSetDrainAlertConfigArg,
  ) : [Types.SnsDrainTrigger] {
    let out = List.empty<Types.SnsDrainTrigger>();
    for ((canisterId, readings) in canisters.vals()) {
      let ok = History.recentOk(readings, 3);
      if (ok.size() >= 2) {
        let balNow = History.okBal(ok[0]);
        let lastDayBurn = if (History.okBal(ok[1]) >= balNow) { (History.okBal(ok[1]) - balNow) : Nat } else { 0 };
        let reasons = List.empty<Text>();
        if (cfg.weeklyAvgFactorPct > 0) {
          switch (avgDailyBurn(readings, ok[0], now, 7)) {
            case (?avg) { if (avg > 0 and exceedsFactor(lastDayBurn, cfg.weeklyAvgFactorPct, avg)) {
              reasons.add("daily burn " # Nat.toText(lastDayBurn) # " > " # Nat.toText(cfg.weeklyAvgFactorPct) # "% of 7-day avg " # Nat.toText(avg));
            } };
            case null {};
          };
        };
        if (cfg.monthlyAvgFactorPct > 0) {
          switch (avgDailyBurn(readings, ok[0], now, 30)) {
            case (?avg) { if (avg > 0 and exceedsFactor(lastDayBurn, cfg.monthlyAvgFactorPct, avg)) {
              reasons.add("daily burn " # Nat.toText(lastDayBurn) # " > " # Nat.toText(cfg.monthlyAvgFactorPct) # "% of 30-day avg " # Nat.toText(avg));
            } };
            case null {};
          };
        };
        if (cfg.dayOverDayFactorPct > 0 and ok.size() >= 3) {
          let prevDayBurn = if (History.okBal(ok[2]) >= History.okBal(ok[1])) { (History.okBal(ok[2]) - History.okBal(ok[1])) : Nat } else { 0 };
          if (prevDayBurn > 0 and exceedsFactor(lastDayBurn, cfg.dayOverDayFactorPct, prevDayBurn)) {
            reasons.add("daily burn " # Nat.toText(lastDayBurn) # " > " # Nat.toText(cfg.dayOverDayFactorPct) # "% of previous-day burn " # Nat.toText(prevDayBurn));
          };
        };
        if (reasons.size() > 0) { out.add({ canisterId; reasons = reasons.toArray() }) };
      };
    };
    out.toArray();
  };

  public func buildDrainAlertReport(triggers : [Types.SnsDrainTrigger]) : Text {
    var out = "Unicycle cycle drain alert: unusual cycle consumption detected for "
      # Nat.toText(triggers.size()) # " tracked canister(s).";
    for (t in triggers.vals()) {
      out #= "\n\n- " # t.canisterId.toText() # ":";
      for (r in t.reasons.vals()) { out #= "\n  - " # r };
    };
    out;
  };
}
