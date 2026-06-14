// Cycle-check timer schedule (todo-18). The backend records when the timer
// last swept the whole fleet and the configured interval; from those two we
// estimate the next check (lastCheck + interval). The sweep is global, so this
// is a single fleet-wide value — shown on the Overview fleet panel and each
// canister's detail page. No actingAs variant: the schedule is identical for
// every caller.
import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { nsToMs } from '../ui/format';

export interface TimerSchedule {
  lastCheckMs: number | null; // last completed sweep, or null until the first firing
  nextCheckMs: number | null; // estimated next sweep (lastCheckMs + interval), or null
  intervalMs: number;
  refresh: () => void;
}

export function useTimerSchedule(identity: Identity | null): TimerSchedule {
  const [lastCheckMs, setLastCheckMs] = useState<number | null>(null);
  const [intervalMs, setIntervalMs] = useState(0);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setLastCheckMs(null);
      setIntervalMs(0);
      return;
    }
    let cancelled = false;
    createUnicycleBackendActor(identity)
      .getTimerSchedule()
      .then((s) => {
        if (cancelled) return;
        setLastCheckMs(s.lastCycleCheckAt === undefined ? null : nsToMs(s.lastCycleCheckAt));
        setIntervalMs(Number(s.cycleCheckIntervalSeconds) * 1000);
      })
      .catch(() => {
        // A missing schedule just hides the indicator — not worth surfacing.
        if (cancelled) return;
        setLastCheckMs(null);
        setIntervalMs(0);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  const nextCheckMs = lastCheckMs !== null && intervalMs > 0 ? lastCheckMs + intervalMs : null;
  return { lastCheckMs, nextCheckMs, intervalMs, refresh };
}
