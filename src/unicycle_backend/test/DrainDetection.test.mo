import { test } "mo:test";
import Principal "mo:core/Principal";
import DrainDetection "../lib/DrainDetection";

let DAY = 24 * 60 * 60 * 1_000_000_000;
func ok(t : Nat, b : Nat) : { recordedAt : Nat; result : { #ok : Nat; #err : Text } } { { recordedAt = t; result = #ok b } };
func cfg(w : Nat, m : Nat, d : Nat) : { weeklyAvgFactorPct : Nat; monthlyAvgFactorPct : Nat; dayOverDayFactorPct : Nat; alertCooldownDays : Nat } {
  { weeklyAvgFactorPct = w; monthlyAvgFactorPct = m; dayOverDayFactorPct = d; alertCooldownDays = 0 };
};
let C = Principal.fromText("aaaaa-aa");

test("exceedsFactor is strict >", func() {
  assert DrainDetection.exceedsFactor(101, 100, 100) == true;
  assert DrainDetection.exceedsFactor(100, 100, 100) == false;
});

test("avgDailyBurn: two in-window points, span>=1day", func() {
  let now = 10 * DAY;
  let rs = [ok(10 * DAY, 100), ok(8 * DAY, 300)];
  switch (DrainDetection.avgDailyBurn(rs, rs[0], now, 7)) { case (?v) { assert v == 100 }; case null { assert false } };
});

test("avgDailyBurn: only latest in-window -> null", func() {
  let now = 10 * DAY;
  let rs = [ok(10 * DAY, 100), ok(1 * DAY, 300)];
  assert DrainDetection.avgDailyBurn(rs, rs[0], now, 7) == null;
});

test("detectTriggers: day-over-day fires when last burn exceeds % of prev burn", func() {
  let now = 4 * DAY;
  let rs = [ok(4 * DAY, 0), ok(3 * DAY, 1_000), ok(2 * DAY, 1_100)];
  let trig = DrainDetection.detectTriggers([(C, rs)], now, cfg(0, 0, 200));
  assert trig.size() == 1;
  assert trig[0].reasons.size() == 1;
});

test("detectTriggers: needs >=3 readings for day-over-day; rise -> no trigger", func() {
  let now = 2 * DAY;
  let rs = [ok(2 * DAY, 0), ok(1 * DAY, 1_000)];
  assert DrainDetection.detectTriggers([(C, rs)], now, cfg(0, 0, 200)).size() == 0;
  let rise = [ok(2 * DAY, 1_000), ok(1 * DAY, 500), ok(0, 400)];
  assert DrainDetection.detectTriggers([(C, rise)], now, cfg(0, 0, 200)).size() == 0;
});

test("buildDrainAlertReport names the breaches", func() {
  let r = DrainDetection.buildDrainAlertReport([{ canisterId = C; reasons = ["boom"] }]);
  assert r.size() > 0;
});
