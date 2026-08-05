// Global token-bucket rate limiter (pre-mainnet abuse hardening, DOS-2).
//
// The per-principal `RateLimit` cap is bypassed by an attacker who rotates
// through fresh principals. This bucket bounds the AGGREGATE rate of ingress
// calls that force the backend to make paid outbound calls, independent of how
// many principals are involved: `capacity` tokens regenerate one per
// `refillIntervalNs`, and each gated call must consume one — or `n` at once for
// a batch call, which pays a flat cost for the outbound calls it makes.
//
// Pure over the bucket state so it is unit-testable; main.mo owns the
// (transient) state. All times are ns.
import Nat "mo:core/Nat";

module {
  public type Bucket = { tokens : Nat; lastRefillNs : Nat };

  // A fresh bucket starts full so a cold canister isn't throttled on its first
  // calls. `lastRefillNs = 0` means the first `tryConsume` sees a huge elapsed
  // time and simply clamps to `capacity` — no special-casing needed.
  public func init(capacity : Nat) : Bucket = { tokens = capacity; lastRefillNs = 0 };

  // Refill `b` for the time elapsed up to `now`, then try to spend `n` tokens
  // ALL-OR-NOTHING: a caller that cannot pay in full spends nothing, so a
  // denied batch does not drain the bucket on its way out. Returns the
  // post-call bucket and whether the spend was granted. `lastRefillNs` advances
  // by whole consumed intervals (not to `now`) so sub-interval time is carried
  // forward rather than discarded.
  public func tryConsumeN(b : Bucket, capacity : Nat, refillIntervalNs : Nat, now : Nat, n : Nat) : (Bucket, Bool) {
    let elapsed : Nat = if (now > b.lastRefillNs) { (now - b.lastRefillNs) : Nat } else { 0 };
    let regenerated = elapsed / refillIntervalNs;
    let refilled = Nat.min(capacity, b.tokens + regenerated);
    let lastRefillNs = b.lastRefillNs + regenerated * refillIntervalNs;
    if (refilled >= n) {
      ({ tokens = (refilled - n) : Nat; lastRefillNs }, true);
    } else {
      ({ tokens = refilled; lastRefillNs }, false);
    };
  };

  // The single-token spend every gated ingress call uses.
  public func tryConsume(b : Bucket, capacity : Nat, refillIntervalNs : Nat, now : Nat) : (Bucket, Bool) {
    tryConsumeN(b, capacity, refillIntervalNs, now, 1);
  };
}
