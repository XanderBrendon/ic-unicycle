// Live ICP→TCYCLES conversion rate for the Overview. We read the pool id the
// backend already exposes (`getIcpSwapPool`) and quote 1 ICP against the ICPSwap
// pool's `quote` query to get a spot rate — the calculation (folding the ICP
// deposit into the TC-equivalent balance and the runway) stays client-side per
// todo-11. `quote` is an unauthenticated query, so we use the shared anonymous
// agent (same pattern as useDepositBalances).
import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { buildAgent } from '../wallet/agent';
import { createIcpSwapPoolActor } from './icpSwapPool';

const ICP_E8S = 100_000_000n; // 1 ICP — the seed amount we quote
const TC_UNIT = 1e12;

export interface IcpTcRate {
  cyclesPerE8s: number | null; // cycles delivered per e8s of ICP
  tcPerIcp: number | null; // TC delivered per 1 ICP
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useIcpTcRate(identity: Identity | null): IcpTcRate {
  const [cyclesPerE8s, setCyclesPerE8s] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const agent = buildAgent();
    const backend = createUnicycleBackendActor(identity ?? undefined);

    backend
      .getIcpSwapPool()
      .then((poolId) =>
        createIcpSwapPoolActor(poolId, agent).quote({
          amountIn: ICP_E8S.toString(),
          zeroForOne: true,
          amountOutMinimum: '0',
        }),
      )
      .then((res) => {
        if (cancelled) return;
        if ('ok' in res && res.ok > 0n) {
          setCyclesPerE8s(Number(res.ok) / Number(ICP_E8S));
          setError(null);
        } else {
          setCyclesPerE8s(null);
          setError('pool quote unavailable');
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCyclesPerE8s(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  const tcPerIcp = cyclesPerE8s === null ? null : (cyclesPerE8s * Number(ICP_E8S)) / TC_UNIT;
  return { cyclesPerE8s, tcPerIcp, loading, error, refresh };
}
