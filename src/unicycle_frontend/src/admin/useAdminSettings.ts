import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import type {
  AdminSettings,
  UpdateAdminSettingsError,
} from '../bindings/unicycle_backend/unicycle_backend';

export interface UseAdminSettingsResult {
  settings: AdminSettings | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  save: (next: AdminSettings) => Promise<{ ok: true } | { ok: false; message: string }>;
  saveStatus:
    | { kind: 'idle' }
    | { kind: 'saving' }
    | { kind: 'success' }
    | { kind: 'error'; message: string };
  resetSaveStatus: () => void;
}

function formatUpdateError(err: UpdateAdminSettingsError): string {
  switch (err.__kind__) {
    case 'anonymous':
      return 'Anonymous callers cannot update settings.';
    case 'notAdmin':
      return 'Only admins can update settings.';
    case 'zeroValue':
      return `Field ${err.zeroValue.field} must be greater than zero.`;
    case 'intervalTooSmall':
      return `Cycle-check interval must be at least ${err.intervalTooSmall.minSeconds} seconds.`;
    case 'feeBpsTooHigh':
      return `Base service fee must be at most ${err.feeBpsTooHigh.maxBps} bps.`;
    case 'lpThresholdTooLow':
      return `LP drain threshold must be at least ${err.lpThresholdTooLow.minTcycles} tcycles.`;
    case 'swapSlippageTooHigh':
      return `Swap slippage must be at most ${err.swapSlippageTooHigh.maxBps} bps.`;
    default: {
      const _exhaustive: never = err;
      return `Unknown error: ${JSON.stringify(_exhaustive)}`;
    }
  }
}

export function useAdminSettings(identity: Identity | null): UseAdminSettingsResult {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [saveStatus, setSaveStatus] = useState<UseAdminSettingsResult['saveStatus']>({
    kind: 'idle',
  });

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const resetSaveStatus = useCallback(() => setSaveStatus({ kind: 'idle' }), []);

  useEffect(() => {
    if (!identity) {
      setSettings(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    createUnicycleBackendActor(identity)
      .getAdminSettings()
      .then((result) => {
        if (cancelled) return;
        if (result.__kind__ === 'ok') {
          setSettings(result.ok);
          setError(null);
        } else {
          setSettings(null);
          setError(result.err);
        }
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSettings(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  const save = useCallback(
    async (next: AdminSettings) => {
      if (!identity) {
        const message = 'Not signed in.';
        setSaveStatus({ kind: 'error', message });
        return { ok: false as const, message };
      }
      setSaveStatus({ kind: 'saving' });
      try {
        const result = await createUnicycleBackendActor(identity).updateAdminSettings(next);
        if (result.__kind__ === 'ok') {
          setSettings(next);
          setSaveStatus({ kind: 'success' });
          return { ok: true as const };
        }
        const message = formatUpdateError(result.err);
        setSaveStatus({ kind: 'error', message });
        return { ok: false as const, message };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setSaveStatus({ kind: 'error', message });
        return { ok: false as const, message };
      }
    },
    [identity],
  );

  return { settings, loading, error, refresh, save, saveStatus, resetSaveStatus };
}
