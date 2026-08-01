import { useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';

export interface OnboardedSnsRoots {
  // Every SNS root onboarded to Unicycle. Not keyed to the caller — the same
  // list for everyone — so it drives the read-only "SNS DAO" nav group and the
  // sns/snsCanister route guard. Null while loading.
  roots: Principal[] | null;
  error: string | null;
  loading: boolean;
}

export function useOnboardedSnsRoots(identity: Identity | null): OnboardedSnsRoots {
  const [roots, setRoots] = useState<Principal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      .getOnboardedSnsRoots()
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
  }, [identity]);

  return { roots, error, loading };
}
