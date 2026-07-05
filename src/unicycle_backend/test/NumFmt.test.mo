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

test("icpE8s shows decimal ICP with underscored e8s", func() {
  assert NumFmt.icpE8s(2_000_000_000) == "20 ICP (2_000_000_000 e8s)";
  assert NumFmt.icpE8s(50_000_000) == "0.5 ICP (50_000_000 e8s)";
  assert NumFmt.icpE8s(0) == "0 ICP (0 e8s)";
});

test("tcyclesE12s shows decimal T with underscored e12s", func() {
  assert NumFmt.tcyclesE12s(5_000_000_000_000) == "5T (5_000_000_000_000 e12s)";
  assert NumFmt.tcyclesE12s(1_200_000_000_000) == "1.2T (1_200_000_000_000 e12s)";
});
