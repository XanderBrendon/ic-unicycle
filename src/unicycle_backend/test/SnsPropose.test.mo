import { test } "mo:test";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Types "../types";
import SnsPropose "../lib/SnsPropose";

let admin = Principal.fromText("aaaaa-aa");

test("icpText renders whole, fractional and tiny amounts", func() {
  assert SnsPropose.icpText(0) == "0 ICP";
  assert SnsPropose.icpText(300_000_000) == "3 ICP";
  assert SnsPropose.icpText(150_000_000) == "1.5 ICP";
  assert SnsPropose.icpText(10_100_000) == "0.101 ICP";
  assert SnsPropose.icpText(1) == "0.00000001 ICP";
});

test("depositSummary diffs against current config", func() {
  let current = { minBalanceE8s = 100_000_000; depositAmountE8s = 50_000_000; includeReport = true };
  let next = { minBalanceE8s = 200_000_000; depositAmountE8s = 50_000_000; includeReport = true };
  let s = SnsPropose.depositSummary(?current, next, admin);
  assert Text.contains(s, #text "min balance: 1 ICP → 2 ICP");
  assert Text.contains(s, #text "deposit amount: 0.5 ICP (unchanged)");
  assert Text.contains(s, #text "cycle usage report: included (unchanged)");
  assert Text.contains(s, #text ("Proposed via Unicycle by admin " # admin.toText()));
});

test("depositSummary renders unset config and disabled min", func() {
  let next = { minBalanceE8s = 0; depositAmountE8s = 0; includeReport = false };
  let s = SnsPropose.depositSummary(null, next, admin);
  assert Text.contains(s, #text "min balance: not set → disabled");
  assert Text.contains(s, #text "cycle usage report: not set → omitted");
});

test("reportSummary renders cadence and disabled", func() {
  let s = SnsPropose.reportSummary(?{ cadenceDays = 7 }, { cadenceDays = 0 }, admin);
  assert Text.contains(s, #text "report cadence: 7 day(s) → disabled");
  assert Text.contains(s, #text ("Proposed via Unicycle by admin " # admin.toText()));
});

test("drainAlertSummary renders thresholds, disabled checks and cooldown", func() {
  let current = { weeklyAvgFactorPct = 150; monthlyAvgFactorPct = 0; dayOverDayFactorPct = 200; alertCooldownDays = 3 };
  let next = { weeklyAvgFactorPct = 200; monthlyAvgFactorPct = 0; dayOverDayFactorPct = 200; alertCooldownDays = 0 };
  let s = SnsPropose.drainAlertSummary(?current, next, admin);
  assert Text.contains(s, #text "weekly avg threshold: 150% → 200%");
  assert Text.contains(s, #text "monthly avg threshold: disabled (unchanged)");
  assert Text.contains(s, #text "day-over-day threshold: 200% (unchanged)");
  assert Text.contains(s, #text "alert cooldown: 3 day(s) → none");
});
