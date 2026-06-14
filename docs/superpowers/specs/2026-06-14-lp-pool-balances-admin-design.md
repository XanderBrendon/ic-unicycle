# LP pool/position balances in the admin panel

**Date:** 2026-06-14
**Status:** approved

## Goal

Surface, in the admin panel's existing "Fee pool & LP" card, the live balances of
the Unicycle LP position on the ICPSwap pool:

1. **In position** — ICP / TC currently held as liquidity in the position.
2. **Unused** — ICP / TC deposited to the pool on the backend's behalf but not in
   the position (the "unused balance"; this is where slippage-leftover ICP accrues).
3. **Unclaimed fees** — ICP / TC of accrued, not-yet-claimed trading fees.

Plus the current pool price for reference.

Read-only. Withdrawing/sweeping the unused ICP is explicitly out of scope (later).

## Approach (decided)

The admin frontend calls the **ICPSwap pool canister directly** and does the math
client-side. **No `unicycle_backend` changes.** This mirrors the existing
`useIcpTcRate` / `icpSwapPool.ts` pattern (which already reads the pool's `quote`
query directly).

### Inputs the frontend already has
- **Pool id** (re-pointable): `backend.getIcpSwapPool()` — existing public query.
- **Position id**: `backend.adminGetLpInfo().lpPositionId` (`bigint | undefined`) —
  already fetched into the `lp` state in `Admin.tsx`.
- **Position owner** (= principal owning the position & unused balance): the backend
  canister id, from `safeGetCanisterEnv()['PUBLIC_CANISTER_ID:unicycle_backend']`.

### Pool reads (all `query`, verified on `pejtq-ciaaa-aaaar-qb5wq-cai`)
| Group | Method | Fields used |
|-------|--------|-------------|
| Unused | `getUserUnusedBalance(owner)` | `balance0`→ICP, `balance1`→TC |
| Unclaimed fees | `refreshIncome(positionId)` | `tokensOwed0`→ICP, `tokensOwed1`→TC |
| In position (liquidity) | `getUserPosition(positionId)` | `liquidity`, `tickLower`, `tickUpper` |
| Price | `metadata()` | `sqrtPriceX96` |

Token mapping `token0 = ICP`, `token1 = TCYCLES` mirrors the backend's own
convention (it treats `amount0` as ICP, `amount1` as TC in its mint/claim code).

### Client-side math (Uniswap V3 amounts-for-liquidity, `bigint`)
Position is always full-range (ticks `±887220`, backend constants). For an in-range
position:
- `amount0 (ICP) = L * (sqrtB - sqrtP) * 2^96 / (sqrtB * sqrtP)`
- `amount1 (TC)  = L * (sqrtP - sqrtA) / 2^96`

`sqrtP` is `metadata.sqrtPriceX96`, clamped to `[sqrtA, sqrtB]`. The two boundary
ratios are hardcoded constants (no TickMath shipped), guarded by a runtime assert
that `getUserPosition` returns `tickLower == -887220 && tickUpper == 887220`:
```
sqrtRatioAtTick(-887220) = 4306310044
sqrtRatioAtTick( 887220) = 1457652066949847389969617340386294118487833376468
```
(These bracket the known Uniswap MIN/MAX sqrt ratios — sanity-checked.)

## Changes

1. **`src/canisters/icpSwapPool.ts`** — extend the narrow IDL + actor with the four
   query methods above; add the V3 math helpers (`positionAmounts(L, sqrtP)`) and
   the boundary constants as exported pure functions.
2. **`src/canisters/useLpPoolBalances.ts`** (new) — hook mirroring `useIcpTcRate`:
   takes `(identity, positionId, tick)`, resolves pool id + owner, runs the three
   reads in parallel, computes amounts, returns
   `{ positionIcp, positionTcycles, unusedIcp, unusedTcycles, unclaimedIcp,
   unclaimedTcycles, sqrtPriceX96, loading, error }`.
3. **`src/screens/Admin.tsx`** — call the hook (wired to the existing `infoTick`
   refresh + `lp.lpPositionId`), render a sub-block in the "Fee pool & LP" card with
   the three ICP/TC groups + price. Reuse `<TC>` / `fmtTC` and `fmtICP`.

## Behavior / edge cases
- No position yet (`lpPositionId === undefined`) → skip pool calls, show dashes.
- Pool unreachable / `refreshIncome` error → inline error in the sub-block; the rest
  of the card (fee pool, drain history) is a separate fetch and stays unaffected.
- Tick assert fails (position not full-range) → surface an error rather than show
  wrong numbers.

## Verification
- No test runner exists in the project (scripts: bindgen/dev/build/typecheck), and
  adding one is out of scope. The pure V3 math is verified by a one-off cross-check
  against a Python reference vector during implementation; correctness in situ is
  confirmable against the pool's own `getUserPositionWithTokenAmount` once a position
  exists.
- `pnpm typecheck` must pass.
