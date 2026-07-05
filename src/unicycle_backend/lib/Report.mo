// Cycle-usage report builder extracted from main.mo (US25).
//
// Invariants:
//   * `end` balance = latest `#ok` reading (newest-first list).
//   * Per-window `start` = oldest `#ok` reading at-or-after `now - days*DAY_NS`.
//   * Cell = `n/a` when no start exists OR `start.recordedAt >= latest.recordedAt`
//     (i.e. only the latest reading is in-window).
//   * Cell sign: `balStart >= balNow` → `"-"(balStart-balNow)` (consumed);
//     else `"+"(balNow-balStart)` (topped up / rose).
//   * Empty `canisters` array → "Cycle usage report: no tracked canisters."
//   * Header and per-canister format are verbatim from the original main.mo.
import Types "../types";
import History "History";
import Durations "Durations";
import NumFmt "NumFmt";
import Principal "mo:core/Principal";
import Nat "mo:core/Nat";

module {
  public let RANGES_DAYS : [Nat] = [1, 3, 7, 30];

  // net cycle change per window; end = latest #ok, start = oldest in-window #ok.
  // `now` is ns. Empty `canisters` → the "no tracked canisters" line.
  public func build(canisters : [(Principal, [Types.CycleReading])], now : Nat) : Text {
    if (canisters.size() == 0) return "Cycle usage report: no tracked canisters.";
    var out = "Cycle usage report (net cycle change per window; negative = consumed):";
    for ((canisterId, readings) in canisters.vals()) {
      out #= "\n- " # canisterId.toText() # ":";
      switch (History.latestOk(readings)) {
        case null { out #= " no successful readings yet" };
        case (?latest) {
          let balNow = History.okBal(latest);
          out #= " balance " # NumFmt.tcyclesE12s(balNow);
          for (days in RANGES_DAYS.vals()) {
            let since = if (now > days * Durations.DAY_NS) { (now - days * Durations.DAY_NS) : Nat } else { 0 };
            let cell = switch (History.oldestOkSince(readings, since)) {
              case (?start) {
                if (start.recordedAt >= latest.recordedAt) { "n/a" }
                else {
                  let balStart = History.okBal(start);
                  if (balStart >= balNow) { "-" # NumFmt.tcyclesE12s(balStart - balNow) }
                  else { "+" # NumFmt.tcyclesE12s(balNow - balStart) };
                };
              };
              case null { "n/a" };
            };
            out #= "  " # days.toText() # "d=" # cell;
          };
        };
      };
    };
    out;
  };
}
