import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import {
  Token,
  Variant_credit_debit,
  type BalanceEvent,
} from '../bindings/unicycle_backend/unicycle_backend';
import { fmtPid, nsToMs, toTC, toICP } from '../ui/format';

export interface BalanceHistory {
  events: BalanceEvent[] | null; // newest-first, as returned by the backend
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useBalanceHistory(identity: Identity | null): BalanceHistory {
  const [events, setEvents] = useState<BalanceEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setEvents(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const backend = createUnicycleBackendActor(identity);
    backend
      .getMyBalanceHistory()
      .then((evts) => {
        if (cancelled) return;
        setEvents(evts);
        setError(null);
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

  return { events, loading, error, refresh };
}

export interface BalancePoint {
  atMs: number;
  bal: number; // display units (TC or ICP)
}

// Reconstruct a deposit-balance series for one token by walking the
// newest-first event stream backwards from the live ledger balance.
// `#rebateSettled` is pure rebate accounting (no token movement) and is
// excluded. Unrecorded flows (direct ledger transfers in, swap residue) show
// up as drift in *older* points only — the series is anchored at `live`.
// Returns ascending points (balance AFTER each event) plus a "now" point.
export function reconstructSeries(
  events: BalanceEvent[],
  token: Token,
  live: bigint,
): BalancePoint[] {
  const toDisplay = token === Token.ICP ? toICP : toTC;
  const relevant = events.filter((e) => e.token === token && e.kind.__kind__ !== 'rebateSettled');
  const points: BalancePoint[] = [{ atMs: Date.now(), bal: toDisplay(live) }];
  let after = live;
  for (const e of relevant) {
    points.push({ atMs: nsToMs(e.at), bal: toDisplay(after < 0n ? 0n : after) });
    after = e.direction === Variant_credit_debit.credit ? after - e.amount : after + e.amount;
  }
  // The loop pushes balance-after-event using the running value *before*
  // applying that event's delta, so points[i] pairs event timestamps with the
  // correct post-event balance; reverse into ascending time order.
  points.reverse();
  for (const p of points) {
    if (p.bal < 0) p.bal = 0;
  }
  return points;
}

// Rebate-credit series: `#rebateSettled` credits minus the rebate portion of
// `#feeCharge` debits, anchored at the caller's current claimable credit.
export function reconstructRebateSeries(events: BalanceEvent[], claimableNow: bigint): BalancePoint[] {
  const points: BalancePoint[] = [{ atMs: Date.now(), bal: toTC(claimableNow) }];
  let after = claimableNow;
  for (const e of events) {
    if (e.kind.__kind__ === 'rebateSettled') {
      points.push({ atMs: nsToMs(e.at), bal: toTC(after < 0n ? 0n : after) });
      after -= e.amount;
    } else if (e.kind.__kind__ === 'feeCharge' && e.kind.feeCharge.rebateApplied > 0n) {
      points.push({ atMs: nsToMs(e.at), bal: toTC(after < 0n ? 0n : after) });
      after += e.kind.feeCharge.rebateApplied;
    }
  }
  points.reverse();
  for (const p of points) {
    if (p.bal < 0) p.bal = 0;
  }
  return points;
}

// Human label for an event row ("Deposit", "Top-up abcde…xyz", …).
export function eventLabel(e: BalanceEvent): string {
  const k = e.kind;
  switch (k.__kind__) {
    case 'deposit':
      return 'Deposit';
    case 'withdraw':
      return 'Withdraw';
    case 'topUp':
      return `Top-up ${fmtPid(k.topUp.canisterId.toText())}`;
    case 'feeCharge':
      return k.feeCharge.rebateApplied > 0n ? 'Service fee (rebated)' : 'Service fee';
    case 'swapFunding':
      return 'Swap funding';
    case 'swapDelivery':
      return 'Swap delivery';
    case 'mintFunding':
      return 'Mint funding';
    case 'mintDelivery':
      return 'Mint delivery';
    case 'serviceFunding':
      return 'Service funding';
    case 'rebateSettled':
      return 'Rebate accrued';
  }
}
