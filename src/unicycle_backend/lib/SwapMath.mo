// Pure sizing + routing math for the US12 group-swap and US30 direct-mint
// sagas. Extracted from main.mo unchanged so the arithmetic stays identical.
//
// Invariants:
//   * proportionalShare/splitWithRemainder floor each share; group/Σweights == 0
//     yields 0 shares (trap-free) rather than dividing by zero.
//   * mintIcpNeeded ceil-divides so a buy never under-funds the target; xpe == 0
//     yields 0 (trap-free).
//   * chooseRoute picks mint iff `xpe · inIcp > target` (STRICT) when both rate
//     sources are reachable; a tie (or worse) swaps. Pool-down + usable rate
//     mints; pool-down + xpe == 0, or both sources down, returns #none with the
//     same message strings the saga records per participant.
//   * splitWithRemainder: the last index absorbs the rounding remainder, so
//     Σ(result) == total whenever Σweights > 0. Empty weights yield [].
import Types "../types";
import List "mo:core/List";

module {
  public let OVER_PURCHASE_NUM : Nat = 110;
  public let OVER_PURCHASE_DEN : Nat = 100;

  public func sumDeficits(demand : [Types.SwapDemand]) : Nat {
    var t : Nat = 0;
    for (d in demand.vals()) { t += d.deficit };
    t;
  };

  public func proportionalShare(total : Nat, part : Nat, group : Nat) : Nat {
    if (group == 0) { 0 } else { (total * part) / group };
  };

  public func overPurchaseTarget(groupDemand : Nat, participants : Nat, tcyclesFee : Nat) : Nat {
    (groupDemand * OVER_PURCHASE_NUM) / OVER_PURCHASE_DEN + participants * tcyclesFee;
  };

  public func quoteInvert(seedIcp : Nat, targetOut : Nat, quotedOut : Nat) : Nat {
    (seedIcp * targetOut) / quotedOut;
  };

  // Slippage floor for the internal LP-drain / harvest swaps (FIN-1). Price the
  // expected output against the CMC's XDR peg (`xpe` = cycles per ICP e8s) — an
  // oracle a pool front-runner can't move — then keep at least
  // (1 - slippageBps/10_000) of it as `amountOutMinimum`.
  //   * ICP -> TCYCLES: expected cycles out = amountIcpE8s · xpe
  //   * TCYCLES -> ICP: expected e8s out    = tcyclesIn / xpe   (xpe == 0 -> 0)
  // slippageFloor is trap-free: slippageBps >= 10_000 yields 0.
  public func expectedTcyclesOut(amountIcpE8s : Nat, xpe : Nat) : Nat = amountIcpE8s * xpe;

  public func expectedIcpOut(tcyclesIn : Nat, xpe : Nat) : Nat {
    if (xpe == 0) { 0 } else { tcyclesIn / xpe };
  };

  public func slippageFloor(expected : Nat, slippageBps : Nat) : Nat {
    if (slippageBps >= 10_000) { 0 } else { (expected * ((10_000 - slippageBps) : Nat)) / 10_000 };
  };

  // ceil-divide so a buy never under-funds the target; xpe==0 -> 0 (trap-free)
  public func mintIcpNeeded(target : Nat, xpe : Nat) : Nat {
    if (xpe == 0) { 0 } else {
      let q = target / xpe;
      if (target % xpe == 0) { q } else { q + 1 };
    };
  };

  // batch route: mint wins iff the same ICP buys more cycles minting than swapping
  public func chooseRoute(
    swapInput : { #ok : Nat; #err : Text },
    mintRate : { #ok : Nat; #err : Text },
    target : Nat,
  ) : { #mint : Nat; #swap; #none : Text } {
    switch (swapInput, mintRate) {
      case (#ok inIcp, #ok xpe) {
        if (xpe * inIcp > target) { #mint xpe } else { #swap };
      };
      case (#err sErr, #ok xpe) {
        if (xpe > 0) { #mint xpe } else {
          #none("rate sources unavailable — swap: " # sErr # "; cmc rate zero");
        };
      };
      case (#ok _, #err _) { #swap };
      case (#err sErr, #err mErr) {
        #none("rate sources unavailable — swap: " # sErr # "; cmc: " # mErr);
      };
    };
  };

  // per-index shares of `total` weighted by `weights`; last index absorbs the
  // rounding remainder so Σ(result) == total when Σweights > 0.
  public func splitWithRemainder(weights : [Nat], total : Nat) : [Nat] {
    let n = weights.size();
    if (n == 0) return [];
    var sumW : Nat = 0;
    for (w in weights.vals()) { sumW += w };
    let lastIdx : Nat = n - 1 : Nat;
    let out = List.empty<Nat>();
    var deliveredSoFar : Nat = 0;
    var i : Nat = 0;
    while (i < n) {
      let share : Nat = if (i == lastIdx) {
        if (total > deliveredSoFar) { total - deliveredSoFar : Nat } else { 0 };
      } else {
        if (sumW == 0) { 0 } else { (total * weights[i]) / sumW };
      };
      deliveredSoFar += share;
      out.add(share);
      i += 1;
    };
    out.toArray();
  };

  public func serviceFee(amount : Nat, bps : Nat) : Nat {
    if (bps == 0) { 0 } else { (amount * bps) / 10_000 };
  };

  public func directTopUpNeeded(amount : Nat, serviceFee : Nat, tcyclesFee : Nat) : Nat {
    amount + serviceFee + 2 * tcyclesFee;
  };

  public func deficit(needed : Nat, balance : Nat) : Nat {
    if (needed > balance) { needed - balance : Nat } else { 0 };
  };
}
