import { test } "mo:test";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Report "../lib/Report";

let DAY = 24 * 60 * 60 * 1_000_000_000;
func ok(t : Nat, b : Nat) : { recordedAt : Nat; result : { #ok : Nat; #err : Text } } { { recordedAt = t; result = #ok b } };
let C = Principal.fromText("aaaaa-aa");

test("empty fleet message", func() {
  assert Report.build([], 10 * DAY) == "Cycle usage report: no tracked canisters.";
});

test("consumed window shows negative; no-start shows n/a", func() {
  let now = 10 * DAY;
  let rs = [ok(10 * DAY, 3_000_000_000_000), ok(8 * DAY, 5_000_000_000_000)];
  let r = Report.build([(C, rs)], now);
  assert Text.contains(r, #text "balance 3T (3_000_000_000_000 e12s)");
  assert Text.contains(r, #text "1d=n/a");
  assert Text.contains(r, #text "3d=-2T (2_000_000_000_000 e12s)");
});

test("rose since window start shows positive", func() {
  let now = 10 * DAY;
  let rs = [ok(10 * DAY, 5_000_000_000_000), ok(8 * DAY, 3_000_000_000_000)];
  assert Text.contains(Report.build([(C, rs)], now), #text "3d=+2T (2_000_000_000_000 e12s)");
});

test("cells round to 2dp; the exact e12s figure follows", func() {
  let now = 10 * DAY;
  // balance 3.145678901234T, down 3_000_000_000 (0.003T) since the 1d window start.
  let rs = [ok(10 * DAY, 3_145_678_901_234), ok(9 * DAY + 1, 3_148_678_901_234), ok(8 * DAY, 5_000_000_000_000)];
  let r = Report.build([(C, rs)], now);
  assert Text.contains(r, #text "balance 3.15T (3_145_678_901_234 e12s)");
  assert Text.contains(r, #text "1d=-<0.01T (3_000_000_000 e12s)");
  assert Text.contains(r, #text "3d=-1.85T (1_854_321_098_766 e12s)");
});

test("no successful readings line", func() {
  let r = Report.build([(C, [{ recordedAt = 1; result = #err "x" }])], 10 * DAY);
  assert Text.contains(r, #text "no successful readings yet");
});

test("all readings older than every window -> all n/a (null-oldest path)", func() {
  // only one #ok reading, far older than any window start -> oldestOkSince is
  // null for each range, so every cell is n/a (distinct from the equal-timestamp guard).
  let r = Report.build([(C, [ok(5 * DAY, 4_000_000_000_000)])], 100 * DAY);
  assert Text.contains(r, #text "balance 4T (4_000_000_000_000 e12s)");
  assert Text.contains(r, #text "1d=n/a");
  assert Text.contains(r, #text "30d=n/a");
});
