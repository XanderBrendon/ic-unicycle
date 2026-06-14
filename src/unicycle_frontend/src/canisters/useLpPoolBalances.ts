// Live ICPSwap LP position balances for the admin card. We read the pool id the
// backend already exposes (`getIcpSwapPool`) and the position owner (the backend
// canister itself), then query the pool directly for: the position's liquidity
// (→ ICP/TC amounts via client-side V3 math), the unused (deposited-but-not-in-
// position) balance, and the accrued-but-unclaimed fees. All four are pool query
// methods, so the shared anonymous agent suffices. The backend is not involved
// in the math (per the design) — same direct-to-pool pattern as `useIcpTcRate`.
import { useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import { buildAgent } from '../wallet/agent';
import {
  createIcpSwapPoolActor,
  positionAmounts,
  FULL_TICK_LOWER,
  FULL_TICK_UPPER,
} from './icpSwapPool';

export interface LpPoolBalances {
  positionIcp: bigint;
  positionTcycles: bigint;
  unusedIcp: bigint;
  unusedTcycles: bigint;
  unclaimedIcp: bigint;
  unclaimedTcycles: bigint;
  sqrtPriceX96: bigint;
}

export interface UseLpPoolBalances {
  data: LpPoolBalances | null;
  loading: boolean;
  error: string | null;
}

export function useLpPoolBalances(
  identity: Identity | null,
  positionId: bigint | undefined,
  tick: number,
): UseLpPoolBalances {
  const [data, setData] = useState<LpPoolBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No position yet — nothing in the pool to show.
    if (positionId === undefined) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    const agent = buildAgent();
    const backend = createUnicycleBackendActor(identity ?? undefined);

    (async () => {
      try {
        // Position owner = the backend canister itself (it mints/deposits on its
        // own behalf). Same env source createUnicycleBackendActor resolves from.
        const env = safeGetCanisterEnv();
        if (!env) throw new Error('no ic_env cookie');
        const owner = Principal.fromText(env['PUBLIC_CANISTER_ID:unicycle_backend']);
        const poolId = await backend.getIcpSwapPool();
        const pool = createIcpSwapPoolActor(poolId, agent);
        const [pos, meta, unused, income] = await Promise.all([
          pool.getUserPosition(positionId),
          pool.metadata(),
          pool.getUserUnusedBalance(owner),
          pool.refreshIncome(positionId),
        ]);
        if (cancelled) return;
        if (!('ok' in pos)) throw new Error('getUserPosition: ' + JSON.stringify(pos.err));
        if (!('ok' in meta)) throw new Error('metadata: ' + JSON.stringify(meta.err));
        if (!('ok' in unused)) throw new Error('getUserUnusedBalance: ' + JSON.stringify(unused.err));
        if (!('ok' in income)) throw new Error('refreshIncome: ' + JSON.stringify(income.err));
        // The math constants assume the full-range position the backend mints.
        if (pos.ok.tickLower !== FULL_TICK_LOWER || pos.ok.tickUpper !== FULL_TICK_UPPER) {
          throw new Error(`position not full-range (ticks ${pos.ok.tickLower}..${pos.ok.tickUpper})`);
        }
        const { icp, tc } = positionAmounts(pos.ok.liquidity, meta.ok.sqrtPriceX96);
        setData({
          positionIcp: icp,
          positionTcycles: tc,
          unusedIcp: unused.ok.balance0,
          unusedTcycles: unused.ok.balance1,
          unclaimedIcp: income.ok.tokensOwed0,
          unclaimedTcycles: income.ok.tokensOwed1,
          sqrtPriceX96: meta.ok.sqrtPriceX96,
        });
        setError(null);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, positionId, tick]);

  return { data, loading, error };
}
