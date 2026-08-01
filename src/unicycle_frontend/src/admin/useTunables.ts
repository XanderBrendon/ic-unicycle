import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import type { TunableInfo } from '../bindings/unicycle_backend/unicycle_backend';
import { formatAdminError } from './useAdmins';
import type { UserError } from '../ui/format';

// Runtime-tunable constants (MIG-3). Deliberately separate from
// useAdminSettings: these are compiled constants with an override map, not
// fields on AdminSettings, and the row list is driven by the backend so a
// tunable added later shows up with no frontend change.
export interface UseTunablesResult {
  tunables: TunableInfo[] | null;
  loading: boolean;
  error: UserError | null;
  refresh: () => void;
  // `null` clears the override, returning the key to its compiled default.
  set: (key: string, value: bigint | null) => Promise<{ ok: true } | { ok: false; message: string }>;
  saving: string | null;
}

export function useTunables(identity: Identity | null): UseTunablesResult {
  const [tunables, setTunables] = useState<TunableInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UserError | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setTunables(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    createUnicycleBackendActor(identity)
      .adminListTunables()
      .then((result) => {
        if (cancelled) return;
        if (result.__kind__ === 'ok') {
          setTunables(result.ok);
          setError(null);
        } else {
          setTunables(null);
          setError(formatAdminError(result.err));
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setTunables(null);
        setError({ message: e instanceof Error ? e.message : String(e) });
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  const set = useCallback(
    async (key: string, value: bigint | null) => {
      if (!identity) return { ok: false as const, message: 'Not signed in.' };
      setSaving(key);
      try {
        const result = await createUnicycleBackendActor(identity).adminSetTunable(key, value);
        setSaving(null);
        if (result.__kind__ === 'ok') {
          refresh();
          return { ok: true as const };
        }
        return { ok: false as const, message: result.err };
      } catch (e) {
        setSaving(null);
        return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
      }
    },
    [identity, refresh],
  );

  return { tunables, loading, error, refresh, set, saving };
}
