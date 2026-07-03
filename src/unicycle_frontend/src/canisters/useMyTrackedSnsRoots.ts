import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';

export interface MyTrackedSnsRoots {
  // The SNS roots the signed-in identity tracks (self-funded). Empty ⇒ the
  // Tracked SNS nav group is not shown.
  roots: Principal[] | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useMyTrackedSnsRoots(identity: Identity | null): MyTrackedSnsRoots {
  const [roots, setRoots] = useState<Principal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setRoots(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const backend = createUnicycleBackendActor(identity);
    backend
      .getMyTrackedSnsRoots()
      .then((result) => {
        if (cancelled) return;
        setRoots(result);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRoots(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  return { roots, error, loading, refresh };
}
