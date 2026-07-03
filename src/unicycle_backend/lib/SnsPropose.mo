import Nat "mo:core/Nat";
import Principal "mo:core/Principal";
import Types "../types";

// Pure text builders for the admin-initiated config-change proposals
// (asSnsPropose* in main.mo). Summaries render a field-by-field diff of the
// current vs proposed config and name the submitting admin, so SNS voters see
// exactly what changes and who asked for it.
module {

  // e8s → human ICP text: "3 ICP", "1.5 ICP", "0.00000001 ICP".
  public func icpText(e8s : Nat) : Text {
    let whole = e8s / 100_000_000;
    var frac = e8s % 100_000_000;
    if (frac == 0) return Nat.toText(whole) # " ICP";
    var digits = 8;
    while (frac % 10 == 0) { frac /= 10; digits -= 1 };
    var fracText = Nat.toText(frac);
    while (fracText.size() < digits) { fracText := "0" # fracText };
    Nat.toText(whole) # "." # fracText # " ICP";
  };

  // One diff line: "name: old → new", "name: value (unchanged)", or
  // "name: not set → new" when there is no current config.
  func line(name : Text, current : ?Text, next : Text) : Text {
    switch (current) {
      case null { name # ": not set → " # next };
      case (?c) {
        if (c == next) { name # ": " # next # " (unchanged)" } else {
          name # ": " # c # " → " # next;
        };
      };
    };
  };

  func mapCur<A>(current : ?A, f : A -> Text) : ?Text {
    switch (current) { case null null; case (?c) ?(f(c)) };
  };

  func footer(admin : Principal) : Text {
    "\n\nProposed via Unicycle by admin " # admin.toText() # ".";
  };

  public func depositSummary(
    current : ?Types.SnsSetDepositConfigArg,
    next : Types.SnsSetDepositConfigArg,
    admin : Principal,
  ) : Text {
    func minText(a : Types.SnsSetDepositConfigArg) : Text {
      if (a.minBalanceE8s == 0) "disabled" else icpText(a.minBalanceE8s);
    };
    func amountText(a : Types.SnsSetDepositConfigArg) : Text = icpText(a.depositAmountE8s);
    func reportText(a : Types.SnsSetDepositConfigArg) : Text {
      if (a.includeReport) "included" else "omitted";
    };
    "This proposal updates the Unicycle deposit auto-top-up configuration for this SNS.\n\n"
    # line("min balance", mapCur(current, minText), minText(next)) # "\n"
    # line("deposit amount", mapCur(current, amountText), amountText(next)) # "\n"
    # line("cycle usage report", mapCur(current, reportText), reportText(next))
    # footer(admin);
  };

  public func reportSummary(
    current : ?Types.SnsSetReportConfigArg,
    next : Types.SnsSetReportConfigArg,
    admin : Principal,
  ) : Text {
    func cadenceText(a : Types.SnsSetReportConfigArg) : Text {
      if (a.cadenceDays == 0) "disabled" else Nat.toText(a.cadenceDays) # " day(s)";
    };
    "This proposal updates the Unicycle cycle-usage report cadence for this SNS.\n\n"
    # line("report cadence", mapCur(current, cadenceText), cadenceText(next))
    # footer(admin);
  };

  public func drainAlertSummary(
    current : ?Types.SnsSetDrainAlertConfigArg,
    next : Types.SnsSetDrainAlertConfigArg,
    admin : Principal,
  ) : Text {
    func pct(v : Nat) : Text { if (v == 0) "disabled" else Nat.toText(v) # "%" };
    func cooldown(v : Nat) : Text { if (v == 0) "none" else Nat.toText(v) # " day(s)" };
    func weekly(a : Types.SnsSetDrainAlertConfigArg) : Text = pct(a.weeklyAvgFactorPct);
    func monthly(a : Types.SnsSetDrainAlertConfigArg) : Text = pct(a.monthlyAvgFactorPct);
    func dayOverDay(a : Types.SnsSetDrainAlertConfigArg) : Text = pct(a.dayOverDayFactorPct);
    func cool(a : Types.SnsSetDrainAlertConfigArg) : Text = cooldown(a.alertCooldownDays);
    "This proposal updates the Unicycle cycle-drain alert configuration for this SNS.\n\n"
    # line("weekly avg threshold", mapCur(current, weekly), weekly(next)) # "\n"
    # line("monthly avg threshold", mapCur(current, monthly), monthly(next)) # "\n"
    # line("day-over-day threshold", mapCur(current, dayOverDay), dayOverDay(next)) # "\n"
    # line("alert cooldown", mapCur(current, cool), cool(next))
    # footer(admin);
  };
};
