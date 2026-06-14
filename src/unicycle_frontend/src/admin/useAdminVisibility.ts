import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import type {
  AdminMetrics,
  AdminTimerInfo,
  AdminTopUpRow,
  AdminTrackedRow,
} from '../bindings/unicycle_backend/unicycle_backend';

export interface AdminVisibilityState {
  tracked: AdminTrackedRow[] | null;
  topUps: AdminTopUpRow[] | null;
  timerInfo: AdminTimerInfo | null;
  metrics: AdminMetrics | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const TOP_UPS_LIMIT = 100n;

export function useAdminVisibility(identity: Identity | null): AdminVisibilityState {
  const [tracked, setTracked] = useState<AdminTrackedRow[] | null>(null);
  const [topUps, setTopUps] = useState<AdminTopUpRow[] | null>(null);
  const [timerInfo, setTimerInfo] = useState<AdminTimerInfo | null>(null);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setTracked(null);
      setTopUps(null);
      setTimerInfo(null);
      setMetrics(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const backend = createUnicycleBackendActor(identity);
    Promise.all([
      backend.adminListAllTracked(),
      backend.adminListRecentTopUps(TOP_UPS_LIMIT),
      backend.adminGetTimerInfo(),
      backend.adminGetMetrics(),
    ])
      .then(([t, tu, ti, m]) => {
        if (cancelled) return;
        setTracked(t.__kind__ === 'ok' ? t.ok : null);
        setTopUps(tu.__kind__ === 'ok' ? tu.ok : null);
        setTimerInfo(ti.__kind__ === 'ok' ? ti.ok : null);
        setMetrics(m.__kind__ === 'ok' ? m.ok : null);
        const firstErr =
          (t.__kind__ === 'err' && t.err) ||
          (tu.__kind__ === 'err' && tu.err) ||
          (ti.__kind__ === 'err' && ti.err) ||
          (m.__kind__ === 'err' && m.err) ||
          null;
        setError(firstErr ? JSON.stringify(firstErr) : null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  return { tracked, topUps, timerInfo, metrics, loading, error, refresh };
}
