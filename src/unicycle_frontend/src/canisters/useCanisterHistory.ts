import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import type { CanisterHistory } from '../bindings/unicycle_backend/unicycle_backend';

export interface UseCanisterHistoryResult {
  data: CanisterHistory | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useCanisterHistory(
  identity: Identity | null,
  canisterId: Principal | null,
  actAs?: Principal | null,
): UseCanisterHistoryResult {
  const [data, setData] = useState<CanisterHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity || !canisterId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const backend = createUnicycleBackendActor(identity);
    (actAs
      ? backend.asSnsGetCanisterHistory(actAs, canisterId)
      : backend.getCanisterHistory(canisterId))
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, canisterId, tick, actAs]);

  return { data, error, loading, refresh };
}
