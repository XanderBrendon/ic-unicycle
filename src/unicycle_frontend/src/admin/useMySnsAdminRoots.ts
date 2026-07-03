import { useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';

export interface MySnsAdminRoots {
  // The SNS roots the signed-in identity may act on behalf of. Empty ⇒ the user
  // administers no SNS, so the SNS nav group is not shown.
  roots: Principal[] | null;
  error: string | null;
  loading: boolean;
}

export function useMySnsAdminRoots(identity: Identity | null): MySnsAdminRoots {
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
    // Drop the prior identity's roots while the new identity's set loads, so
    // stale SNS nav entries can't linger across an identity switch.
    setRoots(null);

    const backend = createUnicycleBackendActor(identity);
    backend
      .getMySnsAdminRoots()
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
