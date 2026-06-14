import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';

export interface UseIsAdminResult {
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useIsAdmin(identity: Identity | null): UseIsAdminResult {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setIsAdmin(false);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    createUnicycleBackendActor(identity)
      .amIAdmin()
      .then((value) => {
        if (cancelled) return;
        setIsAdmin(value);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setIsAdmin(false);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  return { isAdmin, loading, error, refresh };
}
