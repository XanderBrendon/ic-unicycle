// Pure number formatting for human-facing proposal / report text. Each combined
// form shows a decimal amount followed by the raw integer amount grouped with
// underscores every 3 digits, so voters can read the value and still verify the
// exact base-unit figure:
//   icpE8s      "20 ICP (2_000_000_000 e8s)"    -- ICP is denominated in e8s
//   tcyclesE12s "5T (5_000_000_000_000 e12s)"   -- TCycles are e12s, NOT e8s
import Nat "mo:core/Nat";
import Char "mo:core/Char";

module {

  // "2000000000" -> "2_000_000_000"; values with <= 3 digits are unchanged.
  public func group(n : Nat) : Text {
    let digits = Nat.toText(n);
    let size = digits.size();
    var out = "";
    var i = 0;
    for (c in digits.chars()) {
      if (i > 0 and (size - i) % 3 == 0) { out #= "_" };
      out #= Char.toText(c);
      i += 1;
    };
    out;
  };

  // value / 10^decimals as a trimmed decimal string, no unit:
  //   (150_000_000, 8) -> "1.5"   (1, 8) -> "0.00000001"   (0, 8) -> "0"
  public func decimal(value : Nat, decimals : Nat) : Text {
    let scale = 10 ** decimals;
    let whole = value / scale;
    var frac = value % scale;
    if (frac == 0) return Nat.toText(whole);
    var digits = decimals;
    while (frac % 10 == 0) { frac /= 10; digits -= 1 };
    var fracText = Nat.toText(frac);
    while (fracText.size() < digits) { fracText := "0" # fracText };
    Nat.toText(whole) # "." # fracText;
  };

  // ICP amount (e8s): "20 ICP (2_000_000_000 e8s)".
  public func icpE8s(e8s : Nat) : Text {
    decimal(e8s, 8) # " ICP (" # group(e8s) # " e8s)";
  };

  // TCycles amount (e12s): "5T (5_000_000_000_000 e12s)".
  public func tcyclesE12s(cycles : Nat) : Text {
    decimal(cycles, 12) # "T (" # group(cycles) # " e12s)";
  };
};
