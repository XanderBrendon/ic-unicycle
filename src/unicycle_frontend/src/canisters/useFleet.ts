// Fleet aggregation for the Overview dashboard. A single `getFleetSummary`
// query returns config + reading series + top-up history for every tracked
// canister at once (one call regardless of fleet size — see todo-4), from which
// we derive everything the Overview needs that the backend doesn't return
// directly: current cycles (latest reading), health status, the cross-fleet
// top-up activity stream, 24h volume, the 14-day volume histogram, and the
// reading-delta daily burn that drives the runway.
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import type {
  CanisterConfig,
  CanisterHistory,
  CycleReading,
  TopUp,
} from '../bindings/unicycle_backend/unicycle_backend';
import {
  canisterBurnPerDayCycles,
  estDaysToTopUp,
  fmtPid,
  healthStatus,
  nsToMs,
  toTC,
  topUpHorizon,
  type Horizon,
  type Status,
} from '../ui/format';

const DAY_MS = 86_400_000;

export interface FleetCanister {
  canisterId: Principal;
  idText: string;
  name: string | null; // config.nickname, or null when unnamed
  label: string; // name ?? truncated id
  config: CanisterConfig;
  snsRoot: Principal | null; // tracked-SNS stamp; null = blackhole-verified
  min: bigint;
  topup: bigint;
  suspended: boolean;
  suspendedUntilMs: number | null;
  cur: bigint | null; // latest ok reading, or null if none yet
  status: Status;
  burnPerDayCycles: number | null; // per-canister drops-only burn/day; null while < 1 day of history ("measuring")
  estDaysToTopUp: number | null; // estimated days until cur hits min (null if not estimable)
  horizon: Horizon; // bucket for the "Upcoming top ups" card
  readings: CycleReading[]; // ascending by recordedAt
  series: number[]; // ok readings (last 30 days) as TC numbers, ascending (for the 30d sparkline)
  topUps: TopUp[];
  lastReadingMs: number | null;
}

export interface FleetActivityItem {
  key: string;
  canisterId: Principal;
  idText: string;
  label: string;
  topUp: TopUp;
  atMs: number;
}

export interface FleetCounts {
  ok: number;
  warn: number;
  crit: number;
  suspended: number;
  unknown: number;
  total: number;
  atRisk: number;
  // "Upcoming top ups" horizon buckets. now == crit, soon == warn; `upcoming`
  // (4–7 days) and `later` (further out / no estimate / suspended / no-data)
  // split the Healthy/other canisters.
  upcoming: number;
  later: number;
}

export interface Fleet {
  canisters: FleetCanister[] | null;
  counts: FleetCounts;
  activity: FleetActivityItem[];
  dailyBurnCycles: number | null; // fleet burn/day; null only when every canister is still "measuring"
  volume14: number[]; // TC per day, oldest → newest (14 buckets)
  toppedUp24Cycles: bigint;
  toppedUp7dCycles: bigint;
  toppedUp14dCycles: bigint;
  fetchedAt: number | null; // ms of the last successful getFleetSummary
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const EMPTY_COUNTS: FleetCounts = {
  ok: 0,
  warn: 0,
  crit: 0,
  suspended: 0,
  unknown: 0,
  total: 0,
  atRisk: 0,
  upcoming: 0,
  later: 0,
};

function topUpOk(t: TopUp): boolean {
  return t.result.__kind__ === 'ok';
}

// Latest ok reading value (scanning newest → oldest), or null.
function latestCur(readingsAsc: CycleReading[]): bigint | null {
  for (let i = readingsAsc.length - 1; i >= 0; i--) {
    const r = readingsAsc[i].result;
    if (r.__kind__ === 'ok') return r.ok;
  }
  return null;
}

function buildCanister(
  config: CanisterConfig,
  history: CanisterHistory | null,
  canisterId: Principal,
  nowMs: number,
): FleetCanister {
  const idText = canisterId.toString();
  const readings = (history?.readings ?? [])
    .slice()
    .sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
  const topUps = history?.topUps ?? [];
  const suspended = config.suspendedUntil !== undefined;
  const cur = latestCur(readings);
  const burnPerDayCycles = canisterBurnPerDayCycles(readings, nowMs);
  const estDays = estDaysToTopUp(cur, config.minCycleBalance, burnPerDayCycles);
  const status = healthStatus(cur, config.minCycleBalance, suspended, {
    topUpAmount: config.cycleTopUpAmount,
    estDays,
  });
  const horizon = topUpHorizon(status, estDays);
  // 30d sparkline series: ok readings inside the trailing 30-day window, by
  // timestamp — not a fixed count of recent readings (todo-30).
  const cutoff30dMs = nowMs - 30 * DAY_MS;
  const series = readings
    .filter(
      (r): r is CycleReading & { result: { __kind__: 'ok'; ok: bigint } } =>
        r.result.__kind__ === 'ok' && nsToMs(r.recordedAt) >= cutoff30dMs,
    )
    .map((r) => toTC(r.result.ok));
  const name = config.nickname ?? null;
  const lastReadingMs = readings.length ? nsToMs(readings[readings.length - 1].recordedAt) : null;
  return {
    canisterId,
    idText,
    name,
    label: name ?? fmtPid(idText),
    config,
    snsRoot: config.snsRoot ?? null,
    min: config.minCycleBalance,
    topup: config.cycleTopUpAmount,
    suspended,
    suspendedUntilMs: config.suspendedUntil !== undefined ? nsToMs(config.suspendedUntil) : null,
    cur,
    status,
    burnPerDayCycles,
    estDaysToTopUp: estDays,
    horizon,
    readings,
    series,
    topUps,
    lastReadingMs,
  };
}

// Fleet daily burn (cycles/day) = sum of the per-canister drops-only burns.
// Canisters still "measuring" (null, < 1 day of history) are excluded from the
// sum rather than counted as 0, so a single new canister in an established fleet
// contributes nothing for at most a day instead of skewing the total. Null only
// when every canister is measuring; an empty fleet is 0, not measuring.
function dailyBurn(canisters: FleetCanister[]): number | null {
  let total = 0;
  let measured = 0;
  for (const c of canisters) {
    if (c.burnPerDayCycles === null) continue;
    total += c.burnPerDayCycles;
    measured++;
  }
  if (canisters.length > 0 && measured === 0) return null;
  return total;
}

export function useFleet(
  identity: Identity | null,
  actingAs?: Principal | null,
  // Optional summary filter (e.g. one tracked SNS's canisters, or blackholed
  // only). Applied before derivation so counts/activity/volumes reflect the
  // filtered set. MUST be referentially stable (useMemo/useCallback) — it is
  // a dependency of the derivation memo.
  filter?: (h: CanisterHistory) => boolean,
): Fleet {
  const [summaries, setSummaries] = useState<CanisterHistory[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setSummaries(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const backend = createUnicycleBackendActor(identity);
    (actingAs ? backend.asSnsGetFleetSummary(actingAs) : backend.getFleetSummary())
      .then((result) => {
        if (cancelled) return;
        setSummaries(result);
        setFetchedAt(Date.now());
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setSummaries(null);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, actingAs, tick]);

  const derived = useMemo(() => {
    if (!summaries) {
      return {
        canisters: null as FleetCanister[] | null,
        counts: EMPTY_COUNTS,
        activity: [] as FleetActivityItem[],
        dailyBurnCycles: null,
        volume14: new Array(14).fill(0) as number[],
        toppedUp24Cycles: 0n,
        toppedUp7dCycles: 0n,
        toppedUp14dCycles: 0n,
      };
    }
    const source = filter ? summaries.filter(filter) : summaries;
    const nowMs = Date.now();
    const canisters = source.map((h) => buildCanister(h.config, h, h.canisterId, nowMs));

    const counts = { ...EMPTY_COUNTS } as FleetCounts;
    for (const c of canisters) {
      counts[c.status] += 1;
      counts.total += 1;
      if (c.horizon === 'upcoming') counts.upcoming += 1;
      else if (c.horizon === 'later') counts.later += 1;
    }
    counts.atRisk = counts.crit + counts.warn;

    const activity: FleetActivityItem[] = [];
    for (const c of canisters) {
      for (const t of c.topUps) {
        const atMs = nsToMs(t.attemptedAt);
        activity.push({
          key: `${c.idText}:${t.attemptedAt.toString()}`,
          canisterId: c.canisterId,
          idText: c.idText,
          label: c.label,
          topUp: t,
          atMs,
        });
      }
    }
    activity.sort((a, b) => b.atMs - a.atMs);

    const volume14 = new Array(14).fill(0) as number[];
    let toppedUp24Cycles = 0n;
    let toppedUp7dCycles = 0n;
    let toppedUp14dCycles = 0n;
    for (const item of activity) {
      if (!topUpOk(item.topUp)) continue;
      const dayIndex = Math.floor((nowMs - item.atMs) / DAY_MS);
      if (dayIndex >= 0 && dayIndex < 14) volume14[13 - dayIndex] += toTC(item.topUp.amount);
      if (item.atMs > nowMs - DAY_MS) toppedUp24Cycles += item.topUp.amount;
      if (item.atMs > nowMs - 7 * DAY_MS) toppedUp7dCycles += item.topUp.amount;
      if (item.atMs > nowMs - 14 * DAY_MS) toppedUp14dCycles += item.topUp.amount;
    }

    return {
      canisters,
      counts,
      activity,
      dailyBurnCycles: dailyBurn(canisters),
      volume14,
      toppedUp24Cycles,
      toppedUp7dCycles,
      toppedUp14dCycles,
    };
  }, [summaries, filter]);

  return {
    ...derived,
    fetchedAt,
    loading,
    error,
    refresh,
  };
}
