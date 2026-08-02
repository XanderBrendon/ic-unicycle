import { test } "mo:test";
import NumFmt "../lib/NumFmt";

test("group inserts underscores every 3 digits", func() {
  assert NumFmt.group(0) == "0";
  assert NumFmt.group(100) == "100";
  assert NumFmt.group(1_000) == "1_000";
  assert NumFmt.group(12_345) == "12_345";
  assert NumFmt.group(2_000_000_000) == "2_000_000_000";
  assert NumFmt.group(5_000_000_000_000) == "5_000_000_000_000";
});

test("decimal renders whole, fractional and tiny amounts", func() {
  assert NumFmt.decimal(0, 8) == "0";
  assert NumFmt.decimal(300_000_000, 8) == "3";
  assert NumFmt.decimal(150_000_000, 8) == "1.5";
  assert NumFmt.decimal(10_100_000, 8) == "0.101";
  assert NumFmt.decimal(1, 8) == "0.00000001";
  assert NumFmt.decimal(1_200_000_000_000, 12) == "1.2";
});

test("decimal2 rounds half-up and trims trailing zeros", func() {
  assert NumFmt.decimal2(0, 8) == "0";
  assert NumFmt.decimal2(2_000_000_000, 8) == "20";
  assert NumFmt.decimal2(50_000_000, 8) == "0.5";
  assert NumFmt.decimal2(10_100_000, 8) == "0.1";        // 0.101 -> down
  assert NumFmt.decimal2(10_500_000, 8) == "0.11";       // 0.105 -> half-up
  assert NumFmt.decimal2(3_145_678_901_234, 12) == "3.15";
  assert NumFmt.decimal2(42_000_000_000, 12) == "0.04";  // leading fraction zero kept
  assert NumFmt.decimal2(99_999_999, 8) == "1";          // rounds across the whole
});

test("decimal2 marks nonzero amounts below half a hundredth", func() {
  assert NumFmt.decimal2(1, 8) == "<0.01";
  assert NumFmt.decimal2(499_999, 8) == "<0.01";         // just under the boundary
  assert NumFmt.decimal2(500_000, 8) == "0.01";          // at it, rounds up
  assert NumFmt.decimal2(3_000_000_000, 12) == "<0.01";
});

test("icpE8s shows rounded ICP with exact underscored e8s", func() {
  assert NumFmt.icpE8s(2_000_000_000) == "20 ICP (2_000_000_000 e8s)";
  assert NumFmt.icpE8s(50_000_000) == "0.5 ICP (50_000_000 e8s)";
  assert NumFmt.icpE8s(0) == "0 ICP (0 e8s)";
  assert NumFmt.icpE8s(123_456_789) == "1.23 ICP (123_456_789 e8s)";
  assert NumFmt.icpE8s(1) == "<0.01 ICP (1 e8s)";
});

test("tcyclesE12s shows rounded T with exact underscored e12s", func() {
  assert NumFmt.tcyclesE12s(5_000_000_000_000) == "5T (5_000_000_000_000 e12s)";
  assert NumFmt.tcyclesE12s(1_200_000_000_000) == "1.2T (1_200_000_000_000 e12s)";
  assert NumFmt.tcyclesE12s(3_145_678_901_234) == "3.15T (3_145_678_901_234 e12s)";
  assert NumFmt.tcyclesE12s(3_000_000_000) == "<0.01T (3_000_000_000 e12s)";
});
