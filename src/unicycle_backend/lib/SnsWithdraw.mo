import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Types "../types";

module {
  public type Account = { owner : Principal; subaccount : ?Blob };

  func governanceDefault(governance : Principal) : Account {
    { owner = governance; subaccount = null };
  };

  // ICP is locked to the SNS treasury (governance default account); the
  // configured destination is ignored. Non-ICP tokens use the configured
  // destination, falling back to the governance default account.
  public func resolveDestination(
    token : Types.Token,
    configured : ?Account,
    governance : Principal,
  ) : Account {
    switch (token) {
      case (#ICP) { governanceDefault(governance) };
      case (_) {
        switch (configured) {
          case (?acct) { acct };
          case null { governanceDefault(governance) };
        };
      };
    };
  };

  // True iff `dest` is the ledger's minting (burn) account. ICRC treats a null
  // subaccount and an all-zero 32-byte subaccount as the same account, so we
  // normalize before comparing. `minting == null` (e.g. the cycles ledger) can
  // never match.
  public func isMintingAccount(dest : Account, minting : ?Account) : Bool {
    switch (minting) {
      case null { false };
      case (?m) {
        Principal.equal(dest.owner, m.owner)
        and subaccountEqual(dest.subaccount, m.subaccount);
      };
    };
  };

  func subaccountEqual(a : ?Blob, b : ?Blob) : Bool {
    switch (normalize(a), normalize(b)) {
      case (null, null) { true };
      case (?x, ?y) { x == y };
      case _ { false };
    };
  };

  // null or all-zero 32 bytes -> the canonical default subaccount (null).
  func normalize(s : ?Blob) : ?Blob {
    switch (s) {
      case null { null };
      case (?blob) { if (isZero(blob)) { null } else { ?blob } };
    };
  };

  func isZero(blob : Blob) : Bool {
    let bytes = Blob.toArray(blob);
    if (bytes.size() != 32) return false;
    for (b in bytes.vals()) { if (b != 0) { return false } };
    true;
  };
}
