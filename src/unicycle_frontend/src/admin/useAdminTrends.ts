import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import type { MetricsSnapshot } from '../bindings/unicycle_backend/unicycle_backend';

export interface AdminTrendsState {
  snapshots: MetricsSnapshot[] | null; // ascending by time (oldest first)
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// MetricsSnapshot history for the trends dashboard. The backend stores
// newest-first; this hook reverses into ascending order so chart series read
// left-to-right oldest→newest.
export function useAdminTrends(identity: Identity | null): AdminTrendsState {
  const [snapshots, setSnapshots] = useState<MetricsSnapshot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setSnapshots(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const backend = createUnicycleBackendActor(identity);
    backend
      .adminGetMetricsSnapshots()
      .then((res) => {
        if (cancelled) return;
        if (res.__kind__ === 'ok') {
          setSnapshots([...res.ok].reverse());
          setError(null);
        } else {
          setError(JSON.stringify(res.err));
        }
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

  return { snapshots, loading, error, refresh };
}

// Level series: one value per snapshot (e.g. fee pool balance over time).
export function levelSeries(
  snapshots: MetricsSnapshot[],
  select: (s: MetricsSnapshot) => number,
): number[] {
  return snapshots.map(select);
}

// Delta series: the increase of a cumulative counter between consecutive
// snapshots (fees collected per day, top-up volume per day). Floors at 0 so a
// reinstall (counters reset) doesn't plot a negative bar. Length is
// snapshots.length - 1.
export function deltaSeries(
  snapshots: MetricsSnapshot[],
  select: (s: MetricsSnapshot) => bigint,
): number[] {
  const out: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const d = select(snapshots[i]) - select(snapshots[i - 1]);
    out.push(d > 0n ? Number(d) : 0);
  }
  return out;
}
