// Local stub for the ICPSwap V3 SwapPool. Exists purely so the US12 saga can
// be exercised end-to-end against a fresh local replica; mainnet deploys
// point the backend at the real ICPSwap V3 ICP/CYCLES pool
// (`pejtq-ciaaa-aaaar-qb5wq-cai`) and never load this canister.
//
// Exchange rate is a fixed `1 ICP = 10 TCYCLES` — chosen for the clean round
// number, not for any correspondence with mainnet price. The stub deliberately
// does not model AMM math, fee tiers, slippage, or per-tick liquidity; it is
// a saga test fixture, not a swap engine.
//
// Internal accounting tracks per-`caller` per-token balances credited on
// `depositFrom` (after a real ICRC-2 `transfer_from` from the caller's
// default account) and debited on `swap` / `withdrawToSubaccount`. The
// `withdrawToSubaccount` path issues a real ICRC-1 transfer from the stub's
// default account to `(caller, args.subaccount)`. Both ledgers run as
// separate local canisters; the stub must hold positive balances on each
// ledger before withdrawals will succeed, so local setup pre-funds it with
// raw cycles + TCYCLES via the cycles-ledger `deposit` flow.

import Principal "mo:core/Principal";
import Nat "mo:core/Nat";
import Map "mo:core/Map";
import Text "mo:core/Text";
import Error "mo:core/Error";
import ICRC1 "../../src/unicycle_backend/icrc1";
import ICRC2 "../../src/unicycle_backend/icrc2";

persistent actor class IcpSwapPoolStub() = self {

  public type PoolToken = { address : Text; standard : Text };
  public type PoolMetadata = {
    token0 : PoolToken;
    token1 : PoolToken;
    fee : Nat;
    sqrtPriceX96 : Nat;
  };
  public type DepositArgs = { token : Text; amount : Nat; fee : Nat };
  public type SwapArgs = {
    zeroForOne : Bool;
    amountIn : Text;
    amountOutMinimum : Text;
  };
  public type WithdrawToSubaccountArgs = {
    token : Text;
    fee : Nat;
    amount : Nat;
    subaccount : Blob;
  };
  public type MintArgs = {
    token0 : Text;
    token1 : Text;
    fee : Nat;
    tickLower : Int;
    tickUpper : Int;
    amount0Desired : Text;
    amount1Desired : Text;
  };
  public type IncreaseLiquidityArgs = {
    positionId : Nat;
    amount0Desired : Text;
    amount1Desired : Text;
  };
  public type ClaimArgs = { positionId : Nat };
  public type Error = {
    #CommonError;
    #InternalError : Text;
    #UnsupportedToken : Text;
    #InsufficientFunds;
  };

  // Canonical ledger ids — the same constants the backend's `ledgerCanisterId`
  // resolves to. token0 = ICP, token1 = TCYCLES.
  let ICP_LEDGER : Text = "ryjl3-tyaaa-aaaaa-aaaba-cai";
  let TCYCLES_LEDGER : Text = "um5iw-rqaaa-aaaaq-qaaba-cai";

  // Fixed display-scale rate of 1 ICP = 10 TCYCLES, converted into unit-scale
  // to account for the ICP/TCYCLES decimal mismatch (8 vs 12). 1 ICP-unit
  // becomes 100_000 TCYCLES-units: 10 (display rate) × 10^4 (decimal shift).
  let RATE_NUMERATOR : Nat = 100_000;
  let RATE_DENOMINATOR : Nat = 1;

  let balances : Map.Map<Principal, Map.Map<Text, Nat>> = Map.empty();

  // LP positions (US16). The stub does not model tick math — it tracks
  // per-position aggregated token balances so the LP saga can run end-to-end,
  // consuming from the same per-caller balances `depositFrom` / `swap` maintain.
  let positions : Map.Map<Nat, { token0 : Nat; token1 : Nat; owner : Principal }> = Map.empty();
  var nextPositionId : Nat = 1;

  // Accrued-but-unclaimed trading fees per position (US18). Seeded by the
  // diagnostic `bootstrapClaimable`; drained to the position owner's pool
  // balance by `claim`. token0 = ICP, token1 = TCYCLES.
  let pendingFees : Map.Map<Nat, { token0 : Nat; token1 : Nat }> = Map.empty();

  func getBalance(caller : Principal, token : Text) : Nat {
    switch (Map.get(balances, Principal.compare, caller)) {
      case null { 0 };
      case (?inner) {
        switch (Map.get(inner, Text.compare, token)) {
          case null { 0 };
          case (?n) { n };
        };
      };
    };
  };

  func addBalance(caller : Principal, token : Text, delta : Nat) {
    let inner = switch (Map.get(balances, Principal.compare, caller)) {
      case (?m) m;
      case null {
        let fresh = Map.empty<Text, Nat>();
        Map.add(balances, Principal.compare, caller, fresh);
        fresh;
      };
    };
    let prior = switch (Map.get(inner, Text.compare, token)) {
      case null { 0 };
      case (?n) { n };
    };
    Map.add(inner, Text.compare, token, prior + delta);
  };

  // Returns true on success, false if `caller`'s balance is insufficient;
  // mutates the map only on success.
  func subBalance(caller : Principal, token : Text, delta : Nat) : Bool {
    switch (Map.get(balances, Principal.compare, caller)) {
      case null { false };
      case (?inner) {
        switch (Map.get(inner, Text.compare, token)) {
          case null { false };
          case (?n) {
            if (n < delta) { false } else {
              Map.add(inner, Text.compare, token, n - delta);
              true;
            };
          };
        };
      };
    };
  };

  func computeQuote(amountIn : Nat, zeroForOne : Bool) : Nat {
    if (zeroForOne) {
      // ICP → TCYCLES: multiply.
      (amountIn * RATE_NUMERATOR) / RATE_DENOMINATOR;
    } else {
      // TCYCLES → ICP: divide.
      (amountIn * RATE_DENOMINATOR) / RATE_NUMERATOR;
    };
  };

  func tokenAt(zeroForOne : Bool, isInput : Bool) : Text {
    if (zeroForOne == isInput) { ICP_LEDGER } else { TCYCLES_LEDGER };
  };

  public query func metadata() : async { #ok : PoolMetadata; #err : Error } {
    #ok({
      token0 = { address = ICP_LEDGER; standard = "ICRC1" };
      token1 = { address = TCYCLES_LEDGER; standard = "ICRC1" };
      fee = 3_000;
      sqrtPriceX96 = 0;
    });
  };

  public query func quote(args : SwapArgs) : async { #ok : Nat; #err : Error } {
    switch (Nat.fromText(args.amountIn)) {
      case null { #err(#InternalError("invalid amountIn: " # args.amountIn)) };
      case (?amountIn) { #ok(computeQuote(amountIn, args.zeroForOne)) };
    };
  };

  public shared ({ caller }) func depositFrom(args : DepositArgs) : async {
    #ok : Nat;
    #err : Error;
  } {
    if (args.token != ICP_LEDGER and args.token != TCYCLES_LEDGER) {
      return #err(#UnsupportedToken(args.token));
    };
    let ledger : ICRC2.Self = actor (args.token);
    let result = try {
      await ledger.icrc2_transfer_from({
        spender_subaccount = null;
        from = { owner = caller; subaccount = null };
        to = { owner = Principal.fromActor(self); subaccount = null };
        amount = args.amount;
        fee = ?args.fee;
        memo = null;
        created_at_time = null;
      });
    } catch (e) {
      return #err(#InternalError("transfer_from threw: " # Error.message(e)));
    };
    switch (result) {
      case (#Ok _) {
        addBalance(caller, args.token, args.amount);
        #ok(args.amount);
      };
      case (#Err _err) { #err(#InsufficientFunds) };
    };
  };

  public shared ({ caller }) func swap(args : SwapArgs) : async {
    #ok : Nat;
    #err : Error;
  } {
    let amountIn = switch (Nat.fromText(args.amountIn)) {
      case null { return #err(#InternalError("invalid amountIn")) };
      case (?n) { n };
    };
    let amountOutMinimum = switch (Nat.fromText(args.amountOutMinimum)) {
      case null { return #err(#InternalError("invalid amountOutMinimum")) };
      case (?n) { n };
    };
    let inToken = tokenAt(args.zeroForOne, true);
    let outToken = tokenAt(args.zeroForOne, false);
    if (not subBalance(caller, inToken, amountIn)) {
      return #err(#InsufficientFunds);
    };
    let amountOut = computeQuote(amountIn, args.zeroForOne);
    if (amountOut < amountOutMinimum) {
      // Restore the deducted input balance — the swap "didn't happen".
      addBalance(caller, inToken, amountIn);
      return #err(#InternalError("amountOutMinimum not met"));
    };
    addBalance(caller, outToken, amountOut);
    #ok(amountOut);
  };

  public shared ({ caller }) func withdrawToSubaccount(
    args : WithdrawToSubaccountArgs,
  ) : async { #ok : Nat; #err : Error } {
    if (args.token != ICP_LEDGER and args.token != TCYCLES_LEDGER) {
      return #err(#UnsupportedToken(args.token));
    };
    if (not subBalance(caller, args.token, args.amount)) {
      return #err(#InsufficientFunds);
    };
    let ledger : ICRC1.Self = actor (args.token);
    let result = try {
      await ledger.icrc1_transfer({
        from_subaccount = null;
        to = { owner = caller; subaccount = ?args.subaccount };
        amount = if (args.amount > args.fee) { args.amount - args.fee } else { 0 };
        fee = ?args.fee;
        memo = null;
        created_at_time = null;
      });
    } catch (e) {
      addBalance(caller, args.token, args.amount);
      return #err(#InternalError("icrc1_transfer threw: " # Error.message(e)));
    };
    switch (result) {
      case (#Ok _) { #ok(args.amount) };
      case (#Err _err) {
        addBalance(caller, args.token, args.amount);
        #err(#InsufficientFunds);
      };
    };
  };

  // Returns the new position's id as a `Nat`, matching the real ICPSwap V3
  // pool (which keys positions by `Nat`).
  public shared ({ caller }) func mint(args : MintArgs) : async { #ok : Nat; #err : Error } {
    let a0 = switch (Nat.fromText(args.amount0Desired)) { case null { return #err(#InternalError("invalid amount0")) }; case (?n) { n } };
    let a1 = switch (Nat.fromText(args.amount1Desired)) { case null { return #err(#InternalError("invalid amount1")) }; case (?n) { n } };
    if (not subBalance(caller, args.token0, a0)) { return #err(#InsufficientFunds) };
    if (not subBalance(caller, args.token1, a1)) { addBalance(caller, args.token0, a0); return #err(#InsufficientFunds) };
    let id = nextPositionId;
    nextPositionId += 1;
    Map.add(positions, Nat.compare, id, { token0 = a0; token1 = a1; owner = caller });
    #ok(id);
  };

  // The real pool returns the liquidity delta added (a `Nat`). The stub does
  // not model tick math, so it returns the summed input amounts as a proxy;
  // the backend ignores this value either way.
  public shared ({ caller }) func increaseLiquidity(args : IncreaseLiquidityArgs) : async { #ok : Nat; #err : Error } {
    let pos = switch (Map.get(positions, Nat.compare, args.positionId)) {
      case null { return #err(#InternalError("unknown position: " # Nat.toText(args.positionId))) };
      case (?p) { p };
    };
    if (not Principal.equal(pos.owner, caller)) { return #err(#InternalError("position not owned by caller")) };
    let a0 = switch (Nat.fromText(args.amount0Desired)) { case null { return #err(#InternalError("invalid amount0")) }; case (?n) { n } };
    let a1 = switch (Nat.fromText(args.amount1Desired)) { case null { return #err(#InternalError("invalid amount1")) }; case (?n) { n } };
    if (not subBalance(caller, ICP_LEDGER, a0)) { return #err(#InsufficientFunds) };
    if (not subBalance(caller, TCYCLES_LEDGER, a1)) { addBalance(caller, ICP_LEDGER, a0); return #err(#InsufficientFunds) };
    Map.add(positions, Nat.compare, args.positionId, { token0 = pos.token0 + a0; token1 = pos.token1 + a1; owner = pos.owner });
    #ok(a0 + a1);
  };

  // Claim a position's accrued trading fees (US18) into the caller's pool
  // balance — mirrors how `swap` credits output — then zero the pending fees.
  // Returns the claimed (amount0, amount1). Positions are keyed by `Nat`,
  // matching the real ICPSwap pool.
  public shared ({ caller }) func claim(args : ClaimArgs) : async {
    #ok : { amount0 : Nat; amount1 : Nat };
    #err : Error;
  } {
    let pending = switch (Map.get(pendingFees, Nat.compare, args.positionId)) {
      case null { { token0 = 0; token1 = 0 } };
      case (?p) { p };
    };
    if (pending.token0 > 0) { addBalance(caller, ICP_LEDGER, pending.token0) };
    if (pending.token1 > 0) { addBalance(caller, TCYCLES_LEDGER, pending.token1) };
    Map.add(pendingFees, Nat.compare, args.positionId, { token0 = 0; token1 = 0 });
    #ok({ amount0 = pending.token0; amount1 = pending.token1 });
  };

  // Diagnostic — seed a position's claimable trading fees so the harvest saga
  // can be exercised locally. Mirrors `bootstrapTcycles`'s test-fixture role;
  // mainnet never invokes it (the real pool accrues fees from real trades).
  public func bootstrapClaimable(positionId : Nat, amount0 : Nat, amount1 : Nat) : async () {
    Map.add(pendingFees, Nat.compare, positionId, { token0 = amount0; token1 = amount1 });
  };

  // Diagnostic — peek at a position's recorded balances.
  public query func positionOf(id : Nat) : async ?{ token0 : Nat; token1 : Nat; owner : Principal } {
    Map.get(positions, Nat.compare, id);
  };

  // Diagnostic — returns the pool's recorded balance for the caller's
  // (principal, token) pair. Convenient for local smoke tests and not
  // exposed by the real ICPSwap pool with the same signature; safe to ignore
  // when pointing the backend at mainnet.
  public query ({ caller }) func balanceOf(token : Text) : async Nat {
    getBalance(caller, token);
  };

  // Bootstrap path used by `devscripts/seed-icpswap-stub.sh` to seed the stub's TCYCLES balance
  // on the cycles ledger. The cycles ledger's `deposit` mints TCYCLES into
  // the supplied account when the caller attaches raw cycles; this method
  // attaches `amount` from the stub's own canister cycle balance. Mainnet
  // never invokes this — the real ICPSwap pool already holds TCYCLES from
  // its liquidity providers. Returns the cycles-ledger block index on
  // success.
  public shared func bootstrapTcycles(amount : Nat) : async {
    #ok : Nat;
    #err : Text;
  } {
    let cyclesLedger : actor {
      deposit : shared { to : { owner : Principal; subaccount : ?Blob }; memo : ?Blob } -> async {
        balance : Nat;
        block_index : Nat;
      };
    } = actor (TCYCLES_LEDGER);
    let result = try {
      await (with cycles = amount) cyclesLedger.deposit({
        to = { owner = Principal.fromActor(self); subaccount = null };
        memo = null;
      });
    } catch (e) {
      return #err("cycles ledger unreachable: " # Error.message(e));
    };
    #ok(result.block_index);
  };
};
