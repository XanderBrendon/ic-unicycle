import Principal "mo:core/Principal";
import Types "../types";

// Token registry: maps the built-in Token tags to their canonical system-ledger
// principals and display labels.
// INVARIANT: #ICP -> ryjl3-tyaaa-aaaaa-aaaba-cai, #TCYCLES -> um5iw-rqaaa-aaaaq-qaaba-cai
// (canonical ids, identical local and on mainnet).
module {
  public func ledgerCanisterId(t : Types.Token) : Principal {
    switch (t) {
      case (#ICP) { Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai") };
      case (#TCYCLES) { Principal.fromText("um5iw-rqaaa-aaaaq-qaaba-cai") };
    };
  };

  public func toText(t : Types.Token) : Text {
    switch (t) { case (#ICP) { "ICP" }; case (#TCYCLES) { "TCYCLES" } };
  };
}
