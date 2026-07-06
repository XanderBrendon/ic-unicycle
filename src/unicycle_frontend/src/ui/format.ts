// Display helpers for the redesigned UI. Mirrors the prototype's `UC.fmt`,
// `health`, `statusColor`, and `gaugeRatio` (design_files/data.js + charts.jsx)
// but operates on the real backend units: amounts are bigint smallest-units
// (TCYCLES = 12 decimals, ICP = 8 decimals) and timestamps are ns-since-epoch
// bigints. Every TCYCLES value is labelled "TC" by the call sites.
import type { CycleReading } from '../bindings/unicycle_backend/unicycle_backend';

export const TCYCLES_DECIMALS = 12;
export const ICP_DECIMALS = 8;

const TC_UNIT = 1e12;
const ICP_UNIT = 1e8;
const DAY_MS = 86_400_000;

// ns-since-epoch (backend) -> ms-since-epoch (JS Date / Date.now()).
export function nsToMs(ns: bigint): number {
  return Number(ns / 1_000_000n);
}

// bigint smallest-units -> a display float. Safe for display magnitudes
// (a fleet's balances are at most millions of TC, well under 2^53).
export function toTC(raw: bigint): number {
  return Number(raw) / TC_UNIT;
}
export function toICP(raw: bigint): number {
  return Number(raw) / ICP_UNIT;
}

// ---- formatters (port of UC.fmt) ----

// TCYCLES display. <1000 → fixed `dp` decimals ("0.34", "38.64", "0.010");
// ≥1000 → thousands-separated integer ("3,680"). Matches the screenshots.
export function fmtTC(raw: bigint | number | null | undefined, dp = 2): string {
  if (raw === null || raw === undefined) return '—';
  const v = typeof raw === 'bigint' ? toTC(raw) : raw;
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// Fully-expanded TCYCLES decimal for hover tooltips — every one of the 12
// fraction digits that `fmtTC` rounds away. bigint inputs are rendered exactly
// via integer math (no float round-trip); numbers fall back to ≤12 dp. Trailing
// zeros are trimmed ("38" not "38.000000000000"). Unit-less; callers add "TC".
export function fmtTCFull(raw: bigint | number): string {
  if (typeof raw === 'number') {
    return raw.toLocaleString('en-US', { maximumFractionDigits: TCYCLES_DECIMALS });
  }
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const unit = 10n ** BigInt(TCYCLES_DECIMALS);
  const intStr = (abs / unit).toLocaleString('en-US');
  const frac = (abs % unit).toString().padStart(TCYCLES_DECIMALS, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${intStr}${frac ? '.' + frac : ''}`;
}

// ICP display — fixed `dp` decimals (default 4).
export function fmtICP(raw: bigint | number | null | undefined, dp = 4): string {
  if (raw === null || raw === undefined) return '—';
  const v = typeof raw === 'bigint' ? toICP(raw) : raw;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtInt(n: number | bigint): string {
  return Number(n).toLocaleString('en-US');
}

// Truncate a principal id for dense display: head…tail.
export function fmtPid(id: string | null | undefined, head = 5, tail = 3): string {
  if (!id) return '—';
  if (id.length <= head + tail + 1) return id;
  return id.slice(0, head) + '…' + id.slice(-tail);
}

// Relative time from an ms timestamp.
export function fmtAgo(ms: number, now: number = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

// Relative future time, mirroring fmtAgo for the other direction. Used for the
// estimated next cycle-check (todo-18); returns 'now' once the estimate passes.
export function fmtUntil(ms: number, now: number = Date.now()): string {
  const s = Math.round((ms - now) / 1000);
  if (s <= 0) return 'now';
  if (s < 60) return '<1m';
  if (s < 3600) return Math.round(s / 60) + 'm';
  if (s < 86400) return Math.round(s / 3600) + 'h';
  return Math.round(s / 86400) + 'd';
}

export function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function fmtTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19) + 'Z';
}
export function fmtDateTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}
export function fmtPct(n: number): string {
  return Math.round(n * 100) + '%';
}

// A user-facing error: a friendly, human message and an optional `detail` —
// the fully-surfaced, more-technical tail (raw exception/replica/ledger text)
// that callers render separated and de-emphasized.
export interface UserError {
  message: string;
  detail?: string;
}

// Wraps an unexpected exception for display: the friendly guidance is the
// `message`; the raw exception text (replica rejects can be paragraphs) is the
// de-emphasized `detail`, surfaced in full.
export function unexpectedError(action: string, e: unknown): UserError {
  const raw = (e instanceof Error ? e.message : String(e)).trim();
  return {
    message: `Couldn't ${action}. Check your connection and try again.`,
    detail: raw || undefined,
  };
}

// ---- health model (port of UC.health + charts helpers) ----

export type Status = 'ok' | 'warn' | 'crit' | 'suspended' | 'unknown';

export const STATUS_LABEL: Record<Status, string> = {
  ok: 'Healthy',
  warn: 'Low',
  crit: 'Below threshold',
  suspended: 'Suspended',
  unknown: 'No data',
};

// Order used for "by risk" sorting and the status legend.
export const STATUS_ORDER: Record<Status, number> = {
  crit: 0,
  warn: 1,
  ok: 2,
  suspended: 3,
  unknown: 4,
};

// Trailing window for the reading-delta burn estimate (shared by the fleet
// aggregate and the per-canister time-to-top-up estimate). 7 days smooths spikes.
export const BURN_WINDOW_DAYS = 7;

// Minimum observed history before a burn rate is reported. Below this the rate
// would be extrapolated from a single ~4h sample and swing wildly, so we return
// null ("measuring") instead. A newly-tracked canister reads "measuring" for its
// first day, then reports a real rate.
export const BURN_MIN_SPAN_DAYS = 1;

// Drops-only daily burn (cycles/day) for one canister over the trailing window:
// the sum of negative reading deltas ÷ the span actually observed (not a fixed 7
// days), so a canister with only N days of history divides by N — no underestimate
// while the window fills. Top-up jumps (positive deltas) don't count. Returns null
// when < BURN_MIN_SPAN_DAYS of usable history ("measuring"), and 0 when ≥1 day was
// observed with no drops (genuinely stable). `readingsAsc` must be ascending by
// `recordedAt`.
export function canisterBurnPerDayCycles(
  readingsAsc: CycleReading[],
  nowMs: number,
  windowDays = BURN_WINDOW_DAYS,
): number | null {
  const windowStartMs = nowMs - windowDays * DAY_MS;
  let totalDrop = 0;
  let spanMs = 0;
  for (let i = 1; i < readingsAsc.length; i++) {
    const prev = readingsAsc[i - 1].result;
    const cur = readingsAsc[i].result;
    if (prev.__kind__ !== 'ok' || cur.__kind__ !== 'ok') continue;
    const curMs = nsToMs(readingsAsc[i].recordedAt);
    if (curMs < windowStartMs) continue;
    spanMs += curMs - nsToMs(readingsAsc[i - 1].recordedAt);
    if (cur.ok < prev.ok) totalDrop += Number(prev.ok - cur.ok);
  }
  const spanDays = spanMs / DAY_MS;
  if (spanDays < BURN_MIN_SPAN_DAYS) return null; // not enough history yet
  return totalDrop / spanDays;
}

// Estimated days until `cur` decays to the top-up threshold `min` at
// `burnPerDayCycles`. 0 if already at/below `min`; null when not estimable (no
// balance, or no positive burn observed yet — including a null/"measuring" burn
// while history is still building).
export function estDaysToTopUp(cur: bigint | null, min: bigint, burnPerDayCycles: number | null): number | null {
  if (cur === null) return null;
  if (cur <= min) return 0;
  if (burnPerDayCycles === null || !(burnPerDayCycles > 0)) return null;
  return Number(cur - min) / burnPerDayCycles;
}

// Status from current balance vs the canister's top-up threshold `min`:
//   cur < min          → 'crit' (below the top-up threshold)
//   estDays available  → 'warn' if ≤3 days to the next top-up, else 'ok'
//   no burn data yet    → 'warn' if cur < min + topUpAmount/2 (i.e. it has burned
//                         through half its last top-up), else 'ok'
//   no opts at all      → legacy fallback: 'warn' if cur < 1.5·min
// `suspended` overrides; a null `cur` (no readings yet) is 'unknown'. bigint
// comparisons are exact (`1.5·min` is rewritten as `2·cur < 3·min`).
export function healthStatus(
  cur: bigint | null,
  min: bigint,
  suspended: boolean,
  opts?: { topUpAmount?: bigint; estDays?: number | null },
): Status {
  if (suspended) return 'suspended';
  if (cur === null) return 'unknown';
  if (cur < min) return 'crit';
  const estDays = opts?.estDays;
  if (estDays !== undefined && estDays !== null) return estDays <= 3 ? 'warn' : 'ok';
  const topUpAmount = opts?.topUpAmount;
  if (topUpAmount !== undefined) return cur < min + topUpAmount / 2n ? 'warn' : 'ok';
  return 2n * cur < 3n * min ? 'warn' : 'ok';
}

// Bucket for the Overview "Upcoming top ups" card. Derived from status + the
// day estimate so it stays consistent with the badge: crit→now, warn→soon
// (≤3 days / no-burn low), ok within 7 days→upcoming (4–7 days), everything
// else (further out, no estimate, suspended, no-data)→later.
export type Horizon = 'now' | 'soon' | 'upcoming' | 'later';

export function topUpHorizon(status: Status, estDays: number | null): Horizon {
  if (status === 'crit') return 'now';
  if (status === 'warn') return 'soon';
  if (status === 'ok' && estDays !== null && estDays <= 7) return 'upcoming';
  return 'later';
}

// CSS variable for a status colour.
export function statusColor(s: Status): string {
  switch (s) {
    case 'crit':
      return 'var(--crit)';
    case 'warn':
      return 'var(--warn)';
    case 'ok':
      return 'var(--accent)';
    default:
      return 'var(--text-2)';
  }
}

// Badge/dot class for a status (.badge.ok/.warn/.crit/.muted, .dot.ok/...).
export function statusClass(s: Status): 'ok' | 'warn' | 'crit' | 'muted' {
  if (s === 'ok' || s === 'warn' || s === 'crit') return s;
  return 'muted';
}

// Gauge fill ratio + threshold marker. Reference scale = 2.5× minimum, so the
// threshold marker always sits at 0.4 (= min / (min·2.5)).
export function gaugeRatio(cur: bigint | null, min: bigint): { ratio: number; thr: number } {
  const ref = Math.max(toTC(min) * 2.5, 0.0001);
  const curT = cur === null ? 0 : toTC(cur);
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  return { ratio: clamp(curT / ref), thr: clamp(toTC(min) / ref) };
}
