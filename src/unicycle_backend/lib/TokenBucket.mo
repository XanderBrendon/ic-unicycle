// Global token-bucket rate limiter (pre-mainnet abuse hardening, DOS-2).
//
// The per-principal `RateLimit` cap is bypassed by an attacker who rotates
// through fresh principals. This bucket bounds the AGGREGATE rate of ingress
// calls that force the backend to make paid outbound calls, independent of how
// many principals are involved: `capacity` tokens regenerate one per
// `refillIntervalNs`, and each gated call must consume one.
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

  // Refill `b` for the time elapsed up to `now`, then try to spend one token.
  // Returns the post-call bucket and whether a token was granted. `lastRefillNs`
  // advances by whole consumed intervals (not to `now`) so sub-interval time is
  // carried forward rather than discarded.
  public func tryConsume(b : Bucket, capacity : Nat, refillIntervalNs : Nat, now : Nat) : (Bucket, Bool) {
    let elapsed : Nat = if (now > b.lastRefillNs) { (now - b.lastRefillNs) : Nat } else { 0 };
    let regenerated = elapsed / refillIntervalNs;
    let refilled = Nat.min(capacity, b.tokens + regenerated);
    let lastRefillNs = b.lastRefillNs + regenerated * refillIntervalNs;
    if (refilled >= 1) {
      ({ tokens = (refilled - 1) : Nat; lastRefillNs }, true);
    } else {
      ({ tokens = refilled; lastRefillNs }, false);
    };
  };
}
