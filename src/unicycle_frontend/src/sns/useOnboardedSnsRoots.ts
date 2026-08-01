import { useEffect, useMemo, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import type { OnboardedSns } from '../bindings/unicycle_backend/unicycle_backend';

export interface OnboardedSnsRoots {
  // Every SNS root onboarded to Unicycle. Not keyed to the caller — the same
  // list for everyone — so it drives the read-only "SNS DAO" nav group and the
  // sns/snsCanister route guard. Null while loading.
  roots: Principal[] | null;
  // Governance canister by root text, from the same payload: the backend's own
  // SNS-Wasm registry index, so nothing has to ask the SNS root canister for it.
  governance: Record<string, Principal>;
  error: string | null;
  loading: boolean;
}

export function useOnboardedSnsRoots(identity: Identity | null): OnboardedSnsRoots {
  const [entries, setEntries] = useState<OnboardedSns[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!identity) {
      setEntries(null);
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
        setEntries(result);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setEntries(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity]);

  const roots = useMemo(() => entries?.map((e) => e.root) ?? null, [entries]);
  const governance = useMemo(() => {
    const out: Record<string, Principal> = {};
    for (const e of entries ?? []) if (e.governance) out[e.root.toText()] = e.governance;
    return out;
  }, [entries]);

  return { roots, governance, error, loading };
}
