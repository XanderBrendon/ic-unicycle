// Overview — the "Command" dashboard. Port of design_files/dashboard.jsx,
// driven by the real fleet aggregation (useFleet) + deposit balances.
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { Icon } from '../ui/icons';
import { Panel, Empty, StatusBadge, TC } from '../ui/primitives';
import { AreaChart, FuelBar, MiniBars, Sparkline } from '../ui/charts';
import {
  fmtAgo,
  fmtDate,
  fmtDateTime,
  fmtICP,
  fmtPid,
  fmtTC,
  fmtUntil,
  statusColor,
  STATUS_LABEL,
  STATUS_ORDER,
  toTC,
  type Status,
} from '../ui/format';
import { useNow } from '../ui/now';
import { useDepositBalances, type DepositBalances } from '../wallet/useDepositBalances';
import { useBalanceHistory, reconstructSeries, type BalancePoint } from '../wallet/useBalanceHistory';
import { useIcpTcRate, type IcpTcRate } from '../canisters/useIcpTcRate';
import { useTimerSchedule } from '../canisters/useTimerSchedule';
import { Token, type BalanceEvent } from '../bindings/unicycle_backend/unicycle_backend';
import type { Fleet, FleetActivityItem, FleetCanister } from '../canisters/useFleet';

const DAY_MS = 86_400_000;
const TC_UNIT = 1e12;

export interface OverviewProps {
  identity: Identity;
  fleet: Fleet;
  onOpen: (id: Principal) => void;
  onAdd: () => void;
  onAddSns?: () => void;
  snsNames?: Record<string, string | undefined>;
}

type SortKey = 'risk' | 'name' | 'health' | 'cur' | 'min' | 'topup' | 'last';
interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

const healthRatio = (c: FleetCanister): number => (c.cur === null ? Infinity : Number(c.cur) / Number(c.min));

/* ---------------- KPI cell ---------------- */
function KpiCell({
  label,
  value,
  unit,
  sub,
  icon,
  status,
  accent,
  children,
  last,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  status?: Status;
  accent?: boolean;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: 'var(--pad)',
        borderRight: last ? 'none' : '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon}
        {label}
      </div>
      <div
        className="stat-value"
        style={{ fontSize: 30, color: accent ? 'var(--accent-ink)' : status ? statusColor(status) : 'var(--text)' }}
      >
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="faint mono" style={{ fontSize: 11.5 }}>{sub}</div>}
      {children}
    </div>
  );
}

/* ---------------- KPI cell with three values ---------------- */
interface TripleStat {
  value: ReactNode;
  caption: ReactNode;
  color?: string;
}
function TripleCell({
  label,
  icon,
  stats,
  sub,
  children,
  last,
}: {
  label: ReactNode;
  icon?: ReactNode;
  stats: [TripleStat, TripleStat, TripleStat];
  sub?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: 'var(--pad)',
        borderRight: last ? 'none' : '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {icon}
        {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {stats.map((s, i) => (
          <div key={i} style={{ minWidth: 0 }}>
            <div className="stat-value" style={{ fontSize: 21, color: s.color ?? 'var(--text)', whiteSpace: 'nowrap' }}>
              {s.value}
            </div>
            <div className="faint mono" style={{ fontSize: 9.5, letterSpacing: '0.04em', marginTop: 2 }}>
              {s.caption}
            </div>
          </div>
        ))}
      </div>
      {sub && <div className="faint mono" style={{ fontSize: 11 }}>{sub}</div>}
      {children}
    </div>
  );
}

/* ---------------- rate + runway-history helpers ---------------- */
// Most-recent realized ICP→cycles rate from the fleet's successful swaps
// (cycles per e8s), used as a fallback when the live pool quote is unavailable.
function realizedRateFromActivity(activity: FleetActivityItem[]): number | null {
  for (const item of activity) {
    const s = item.topUp.swap;
    if (s && s.outcome.__kind__ === 'ok' && s.amountIn > 0n && s.amountOut > 0n) {
      return Number(s.amountOut) / Number(s.amountIn);
    }
  }
  return null;
}

// Piecewise-constant balance at time `t` from a reconstructed (ascending) series:
// the value that held at `t` is the latest point at or before it.
function stepValue(pts: BalancePoint[], t: number): number {
  if (pts.length === 0) return 0;
  let val = pts[0].bal;
  for (const p of pts) {
    if (p.atMs <= t) val = p.bal;
    else break;
  }
  return val;
}

// Combined TC-equivalent deposit balance (TC + ICP·rate) sampled across the
// trailing window, for the runway chart's history half. ICP is converted with
// `cyclesPerE8s`; with no rate the ICP contribution is dropped (0).
function historyTcEquiv(
  events: BalanceEvent[],
  depositTC: bigint,
  depositICP: bigint | null,
  cyclesPerE8s: number | null,
  nowMs: number,
  windowDays = 7,
  samples = 28,
): Array<[number, number]> {
  const tcPts = reconstructSeries(events, Token.TCYCLES, depositTC);
  const icpPts = reconstructSeries(events, Token.ICP, depositICP ?? 0n);
  const tcPerIcp = cyclesPerE8s === null ? 0 : cyclesPerE8s / 1e4; // cycles/e8s → TC/ICP
  const startMs = nowMs - windowDays * DAY_MS;
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const t = startMs + (i / samples) * (nowMs - startMs);
    out.push([t, stepValue(tcPts, t) + stepValue(icpPts, t) * tcPerIcp]);
  }
  return out;
}

/* ---------------- activity feed ---------------- */
function ActivityFeed({ activity, limit = 9 }: { activity: FleetActivityItem[]; limit?: number }) {
  const now = useNow();
  if (activity.length === 0) {
    return <Empty icon="activity" title="No top-ups yet">Top-up attempts across your fleet will stream in here.</Empty>;
  }
  return (
    <div className="vstack">
      {activity.slice(0, limit).map((item) => {
        const u = item.topUp;
        const ok = u.result.__kind__ === 'ok';
        return (
          <div
            key={item.key}
            style={{
              display: 'flex',
              gap: 11,
              padding: '11px var(--pad)',
              borderBottom: '1px solid var(--border)',
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                flex: 'none',
                borderRadius: 5,
                display: 'grid',
                placeItems: 'center',
                marginTop: 1,
                background: ok ? 'var(--accent-soft)' : 'color-mix(in oklch, var(--crit) 14%, transparent)',
                border: `1px solid ${ok ? 'var(--accent-line)' : 'color-mix(in oklch, var(--crit) 32%, transparent)'}`,
              }}
            >
              <Icon name={ok ? 'bolt' : 'x'} size={12} style={{ color: ok ? 'var(--accent-ink)' : 'var(--crit)' }} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 12.5 }} className="ellipsis">
                  {item.label}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 12, color: ok ? 'var(--accent-ink)' : 'var(--crit)', whiteSpace: 'nowrap' }}
                >
                  {ok ? '+' : '×'}
                  <TC raw={u.amount} /> TC
                </span>
              </div>
              <div className="faint mono" style={{ fontSize: 10.5, marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  {u.swap ? <>{fmtICP(u.swap.amountIn, 2)} ICP → <TC raw={u.swap.amountOut} /> TC</> : 'from deposit'}
                </span>
                <span>{fmtAgo(item.atMs, now)}</span>
              </div>
              {u.result.__kind__ === 'err' && (
                <div className="mono" style={{ fontSize: 10, color: 'var(--crit)', marginTop: 2, whiteSpace: 'normal', lineHeight: 1.4 }}>
                  {u.result.err}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- status legend (click to filter) ---------------- */
function StatusLegend({
  counts,
  active,
  onPick,
}: {
  counts: Fleet['counts'];
  active: Status | null;
  onPick: (s: Status | null) => void;
}) {
  const items: Array<[Status, number]> = [
    ['ok', counts.ok],
    ['warn', counts.warn],
    ['crit', counts.crit],
    ['suspended', counts.suspended],
  ];
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {items.map(([s, n]) => {
        const on = active === s;
        return (
          <button
            key={s}
            onClick={() => onPick(on ? null : s)}
            className="chip clickable"
            title={`Filter: ${STATUS_LABEL[s]}`}
            style={{
              height: 24,
              gap: 6,
              paddingInline: 8,
              borderColor: on ? statusColor(s) : 'var(--border)',
              background: on ? `color-mix(in oklch, ${statusColor(s)} 14%, transparent)` : 'var(--panel-2)',
              color: on ? 'var(--text)' : 'var(--text-1)',
            }}
          >
            <span className={`dot ${s === 'suspended' ? '' : s}`} style={{ boxShadow: 'none', width: 7, height: 7 }} />
            <span style={{ fontSize: 11 }}>{STATUS_LABEL[s]}</span>
            <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- sortable fleet table ---------------- */
function FleetTable({
  fleet,
  onOpen,
  sort,
  onSort,
  snsNames,
}: {
  fleet: FleetCanister[];
  onOpen: (id: Principal) => void;
  sort: SortState;
  onSort: (k: SortKey) => void;
  snsNames?: Record<string, string | undefined>;
}) {
  const now = useNow();
  const Th = ({ k, children, num, w }: { k?: SortKey; children?: ReactNode; num?: boolean; w?: number }) => {
    const on = !!k && sort.key === k;
    return (
      <th
        className={num ? 'num' : ''}
        style={{ width: w, cursor: k ? 'pointer' : 'default', userSelect: 'none', color: on ? 'var(--accent-ink)' : undefined }}
        onClick={k ? () => onSort(k) : undefined}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexDirection: num ? 'row-reverse' : 'row' }}>
          {children}
          {on && <Icon name={sort.dir === 'asc' ? 'arrowUp' : 'arrowDown'} size={11} style={{ color: 'var(--accent-ink)' }} />}
        </span>
      </th>
    );
  };
  return (
    <>
    <table className="tbl tbl-fleet">
      <thead>
        <tr>
          <th style={{ width: 34 }}></th>
          <Th k="name">Canister</Th>
          <Th k="health" w={150}>
            Fuel
          </Th>
          <Th k="cur" num>
            Balance
          </Th>
          <Th k="min" num>
            Min
          </Th>
          <Th k="topup" num>
            Top-up
          </Th>
          <th style={{ width: 96 }}>30d</th>
          <Th k="last" num>
            Last check
          </Th>
          <th style={{ width: 28 }}></th>
        </tr>
      </thead>
      <tbody>
        {fleet.map((c) => (
          <tr key={c.idText} className="clickable" onClick={() => onOpen(c.canisterId)}>
            <td>
              <span
                className={`dot ${c.status === 'suspended' || c.status === 'unknown' ? '' : c.status} ${
                  c.status === 'crit' ? 'pulse' : ''
                }`}
              />
            </td>
            <td>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600, fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {c.label}
                  {c.snsRoot && (
                    <span
                      title={`Funded via tracked SNS ${c.snsRoot.toText()}`}
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        padding: '1px 6px',
                        borderRadius: 5,
                        border: '1px solid var(--border-2)',
                        color: 'var(--text-2)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {snsNames?.[c.snsRoot.toText()] ?? fmtPid(c.snsRoot.toText(), 4, 3)}
                    </span>
                  )}
                </span>
                <span className="mono faint" style={{ fontSize: 10.5 }}>
                  {fmtPid(c.idText, 7, 4)}
                </span>
              </div>
            </td>
            <td>
              <FuelBar cur={c.cur} min={c.min} status={c.status} width={130} />
            </td>
            <td className="num mono" style={{ color: statusColor(c.status), fontWeight: 600 }}>
              <TC raw={c.cur} />
            </td>
            <td className="num mono faint"><TC raw={c.min} /></td>
            <td className="num mono faint"><TC raw={c.topup} /></td>
            <td>
              <Sparkline data={c.series} w={80} h={22} color={statusColor(c.status)} fill />
            </td>
            <td className="num mono faint" style={{ fontSize: 11 }}>
              {c.suspended || c.lastReadingMs === null ? '—' : fmtAgo(c.lastReadingMs, now)}
            </td>
            <td>
              <Icon name="chevronR" size={14} style={{ color: 'var(--text-2)' }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>

    <div className="fleet-cards">
      {fleet.map((c) => (
        <button key={c.idText} className="fleet-card" onClick={() => onOpen(c.canisterId)}>
          <div className="fc-top">
            <span
              className={`dot ${c.status === 'suspended' || c.status === 'unknown' ? '' : c.status} ${
                c.status === 'crit' ? 'pulse' : ''
              }`}
            />
            <div className="fc-name">
              <span className="fc-title">
                <span className="ellipsis">{c.label}</span>
                {c.snsRoot && (
                  <span
                    style={{
                      fontSize: 9.5, fontWeight: 600, padding: '1px 6px', borderRadius: 5,
                      border: '1px solid var(--border-2)', color: 'var(--text-2)',
                      whiteSpace: 'nowrap', flex: 'none',
                    }}
                  >
                    {snsNames?.[c.snsRoot.toText()] ?? fmtPid(c.snsRoot.toText(), 4, 3)}
                  </span>
                )}
              </span>
              <span className="mono faint fc-id ellipsis">{fmtPid(c.idText, 8, 5)}</span>
            </div>
            <StatusBadge status={c.status} />
          </div>
          <FuelBar cur={c.cur} min={c.min} status={c.status} width="100%" />
          <div className="fc-stats">
            <div><label>Balance</label><span className="v" style={{ color: statusColor(c.status) }}><TC raw={c.cur} /></span></div>
            <div><label>Min</label><span className="v faint"><TC raw={c.min} /></span></div>
            <div><label>Top-up</label><span className="v faint"><TC raw={c.topup} /></span></div>
            <div><label>Last</label><span className="v faint">{c.suspended || c.lastReadingMs === null ? '—' : fmtAgo(c.lastReadingMs, now)}</span></div>
          </div>
        </button>
      ))}
    </div>
    </>
  );
}

/* ---------------- pre-resolve loading state ---------------- */
export function OverviewLoading() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '70vh' }}>
      <Empty icon="canisters" title="Loading fleet…">Fetching your tracked canisters.</Empty>
    </div>
  );
}

/* ---------------- empty state (no tracked canisters) ---------------- */
export function OverviewEmpty({ onAdd, onAddSns, onGroupEdit }: { onAdd: () => void; onAddSns?: () => void; onGroupEdit?: () => void }) {
  return (
    <div className="fade-up" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh', textAlign: 'center' }}>
      <div style={{ width: 380, maxWidth: '100%' }}>
        <div
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 56,
            height: 56,
            borderRadius: 14,
            border: '1px solid var(--border-2)',
            background: 'var(--panel)',
            marginBottom: 20,
            color: 'var(--accent-ink)',
          }}
        >
          <Icon name="canisters" size={28} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em' }}>Track your first canister</h1>
        <p className="faint" style={{ fontSize: 13, margin: '12px 0 24px', lineHeight: 1.6 }}>
          Set a minimum balance and Unicycle keeps it funded — converting ICP to cycles automatically when it runs low.
        </p>
        <button
          className="btn accent"
          style={{ height: 42, paddingInline: 22, justifyContent: 'center', fontSize: 14 }}
          onClick={onAdd}
        >
          <Icon name="plus" size={16} />
          Track canister
        </button>
        {onAddSns && (
          <button
            className="btn ghost"
            style={{ height: 42, paddingInline: 22, justifyContent: 'center', fontSize: 14, marginLeft: 10 }}
            onClick={onAddSns}
          >
            <Icon name="shield" size={16} />
            Track SNS
          </button>
        )}
        {onGroupEdit && (
          <button
            className="btn ghost"
            style={{ height: 42, paddingInline: 22, justifyContent: 'center', fontSize: 14, marginLeft: 10 }}
            onClick={onGroupEdit}
          >
            <Icon name="edit" size={16} />
            Group Edit
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- KPI strip ---------------- */
export function FleetKpiStrip({ fleet, deposit, rate, historyEvents }: {
  fleet: Fleet;
  deposit: DepositBalances;
  rate: IcpTcRate;
  historyEvents: BalanceEvent[] | null; // null → runway chart renders without history
}) {
  const nowMs = Date.now();
  const depositTC = deposit.balances.TCYCLES;
  const depositICP = deposit.balances.ICP;
  const burnCyclesPerDay = fleet.dailyBurnCycles;
  const burnMeasuring = burnCyclesPerDay === null; // < 1 day of history across the whole fleet
  const burnTCPerDay = burnCyclesPerDay === null ? null : burnCyclesPerDay / TC_UNIT;

  // ICP→cycles rate: live pool quote, falling back to the most recent realized
  // swap rate from top-ups. ICP is folded into the deposit's TC-equivalent and
  // the runway; with no rate, ICP is excluded (and the TC-equivalent is hidden).
  const cyclesPerE8s = rate.cyclesPerE8s ?? realizedRateFromActivity(fleet.activity);
  const depositICPCycles =
    depositICP !== null && cyclesPerE8s !== null ? Number(depositICP) * cyclesPerE8s : null;
  // Deposit TC-equivalent (TC + ICP·rate). Null when we can't convert a nonzero
  // ICP balance (no rate yet) — better to show "—" than an understated total.
  const tcEquivNum =
    depositTC === null
      ? null
      : depositICP && depositICP > 0n && cyclesPerE8s === null
        ? null
        : toTC(depositTC) + (depositICPCycles ?? 0) / TC_UNIT;

  // Runway over the combined deposit (TC + convertible ICP), in cycle units.
  const totalCycles = depositTC === null ? null : Number(depositTC) + (depositICPCycles ?? 0);
  // Cap the runway at a sane horizon: a >100y runway is "effectively stable",
  // and projecting one onto a calendar date overflows JS's max Date (~273k
  // years from epoch), which makes fmtDate throw "Invalid time value". Beyond
  // the cap we collapse to the same ∞ / "stable" display as a zero-burn fleet.
  const MAX_RUNWAY_DAYS = 36_500; // 100 years
  const rawRunwayDays =
    totalCycles !== null && burnCyclesPerDay !== null && burnCyclesPerDay > 0
      ? Math.floor(totalCycles / burnCyclesPerDay)
      : null;
  const runwayDays = rawRunwayDays !== null && rawRunwayDays <= MAX_RUNWAY_DAYS ? rawRunwayDays : null;
  const runwayValue =
    depositTC === null ? '—' : burnMeasuring ? '—' : runwayDays === null ? '∞' : runwayDays;
  const runwaySub =
    depositTC === null
      ? 'awaiting balance'
      : burnMeasuring
        ? 'measuring burn…'
        : runwayDays === null
          ? 'stable at current burn'
          : `depletes ${fmtDate(nowMs + runwayDays * DAY_MS)}`;
  const runwayBalanceTC = tcEquivNum ?? (depositTC === null ? 0 : toTC(depositTC));
  const runwayHistory =
    historyEvents && depositTC !== null
      ? historyTcEquiv(historyEvents, depositTC, depositICP, cyclesPerE8s, nowMs)
      : undefined;

  const c = fleet.counts;
  return (
    <div className="panel kpi-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', overflow: 'hidden' }}>
      <TripleCell
        label="Deposit balance"
        icon={<Icon name="wallet" size={12} />}
        stats={[
          { value: <TC raw={depositTC} />, caption: 'TC' },
          { value: fmtICP(depositICP, 2), caption: 'ICP' },
          { value: tcEquivNum === null ? '—' : fmtTC(tcEquivNum), caption: '≈ TC total', color: 'var(--accent-ink)' },
        ]}
        sub={burnMeasuring ? 'measuring burn…' : <><TC raw={burnTCPerDay} dp={2} /> TC/day burn</>}
      >
        <div className="faint mono" style={{ fontSize: 9, marginTop: 4, lineHeight: 1.4 }}>
          ICP→TC rate is based on the current swap price and may change unpredictably.
        </div>
      </TripleCell>
      <KpiCell
        label="Deposit runway"
        value={runwayValue}
        unit="days"
        accent
        sub={runwaySub}
        icon={<Icon name="flame" size={12} style={{ color: 'var(--accent-ink)' }} />}
      >
        <div style={{ marginTop: 2, position: 'relative' }}>
          <AreaChart balance={runwayBalanceTC} burnPerDay={burnTCPerDay ?? 0} history={runwayHistory} nowMs={nowMs} w={170} h={42} />
        </div>
        <div className="faint mono" style={{ fontSize: 9, marginTop: 4, lineHeight: 1.4 }}>
          Estimates based on recent usage and conversion rates.
        </div>
      </KpiCell>
      <TripleCell
        label="Upcoming top ups"
        icon={<Icon name="shield" size={12} />}
        stats={[
          { value: c.crit, caption: 'now', color: 'var(--crit)' },
          { value: c.warn, caption: '1–3 days', color: 'var(--warn)' },
          { value: c.upcoming, caption: '4–7 days', color: 'var(--accent-ink)' },
        ]}
        sub={`${c.later} not due in 7 days`}
      />
      <TripleCell
        label="Topped up"
        icon={<Icon name="bolt" size={12} />}
        last
        stats={[
          { value: <TC raw={fleet.toppedUp24Cycles} />, caption: '24h' },
          { value: <TC raw={fleet.toppedUp7dCycles} />, caption: '7d' },
          { value: <TC raw={fleet.toppedUp14dCycles} />, caption: '14d' },
        ]}
      >
        <div style={{ marginTop: 'auto', paddingTop: 4 }}>
          <div className="faint mono" style={{ fontSize: 9.5, marginBottom: 3, letterSpacing: '0.04em' }}>
            14-DAY VOLUME · TC
          </div>
          <MiniBars
            data={fleet.volume14}
            h={28}
            tip={(v, i) => `${fmtTC(v)} TC · ${fmtDate(nowMs - (13 - i) * DAY_MS)}`}
          />
        </div>
      </TripleCell>
    </div>
  );
}

/* ---------------- fleet dashboard ---------------- */
export function FleetDashboard({ fleet, onOpen, onAdd, onAddSns, onGroupEdit, schedule, snsNames }: {
  fleet: Fleet;
  onOpen: (id: Principal) => void;
  onAdd: () => void;
  onAddSns?: () => void;
  onGroupEdit?: () => void;
  schedule: { nextCheckMs: number | null; refresh: () => void } | null; // null hides the next-check indicator
  snsNames?: Record<string, string | undefined>;
}) {
  const now = useNow();
  const [sort, setSort] = useState<SortState>({ key: 'risk', dir: 'asc' });
  const [filter, setFilter] = useState<Status | null>(null);
  const [q, setQ] = useState('');

  const onSort = (k: SortKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  const canisters = fleet.canisters ?? [];

  const rows = useMemo(() => {
    let r = filter ? canisters.filter((c) => c.status === filter) : canisters;
    const query = q.trim().toLowerCase();
    if (query) r = r.filter((c) => c.label.toLowerCase().includes(query) || c.idText.toLowerCase().includes(query));
    const dir = sort.dir === 'asc' ? 1 : -1;
    const num = (c: FleetCanister): number =>
      sort.key === 'health'
        ? healthRatio(c)
        : sort.key === 'cur'
          ? c.cur === null
            ? -1
            : Number(c.cur)
          : sort.key === 'min'
            ? Number(c.min)
            : sort.key === 'topup'
              ? Number(c.topup)
              : sort.key === 'last'
                ? c.lastReadingMs ?? 0
                : STATUS_ORDER[c.status];
    return [...r].sort((a, b) => {
      if (sort.key === 'risk') {
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || healthRatio(a) - healthRatio(b);
      }
      if (sort.key === 'name') return a.label.localeCompare(b.label) * dir;
      return (num(a) - num(b)) * dir;
    });
  }, [canisters, sort, filter, q]);

  const c = fleet.counts;
  return (
    <div className="grid fleet-layout" style={{ gridTemplateColumns: '1fr 340px', alignItems: 'start' }}>
      <Panel
        flush
        title="Fleet"
        eyebrow={filter ? `// filtered · ${STATUS_LABEL[filter].toLowerCase()}` : `// ${c.total} tracked canisters`}
        actions={
          <>
            {schedule && schedule.nextCheckMs !== null && (
              <span className="faint mono" style={{ fontSize: 11 }} title="Estimated next automatic cycle check across the fleet">
                next check ~{fmtUntil(schedule.nextCheckMs, now)}
              </span>
            )}
            <button
              className="btn ghost sm"
              onClick={() => {
                fleet.refresh();
                schedule?.refresh();
              }}
              disabled={fleet.loading}
              title="Refresh fleet"
            >
              <Icon name="refresh" size={14} />
            </button>
            {onGroupEdit && (
              <button className="btn ghost sm" onClick={onGroupEdit}>
                <Icon name="edit" size={14} />
                Group Edit
              </button>
            )}
            {onAddSns && (
              <button className="btn ghost sm" onClick={onAddSns}>
                <Icon name="shield" size={14} />
                Track SNS
              </button>
            )}
            <button className="btn accent sm" onClick={onAdd}>
              <Icon name="plus" size={14} />
              Track canister
            </button>
          </>
        }
      >
        <div
          className="fleet-toolbar"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px var(--pad)',
            borderBottom: '1px solid var(--border)',
            flexWrap: 'wrap',
          }}
        >
          <StatusLegend counts={c} active={filter} onPick={setFilter} />
          <div className="input-suffix" style={{ marginLeft: 'auto', width: 218 }}>
            <input
              className="input mono"
              placeholder="search name or id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ height: 30, paddingRight: 28 }}
            />
            <Icon name="search" size={13} className="sfx" style={{ pointerEvents: 'none' }} />
          </div>
        </div>
        {fleet.loading && canisters.length === 0 ? (
          <Empty icon="canisters" title="Loading fleet…">Fetching your tracked canisters.</Empty>
        ) : fleet.error ? (
          <Empty icon="x" title="Couldn’t load fleet">{fleet.error}</Empty>
        ) : rows.length === 0 ? (
          <Empty icon="canisters" title="Nothing here">
            {canisters.length === 0
              ? 'No canisters tracked yet. Use “Track canister” to add one.'
              : q
                ? 'No canisters match your search.'
                : 'No canisters match this filter.'}
          </Empty>
        ) : (
          <FleetTable fleet={rows} onOpen={onOpen} sort={sort} onSort={onSort} snsNames={snsNames} />
        )}
      </Panel>
      <Panel
        flush
        title="Activity"
        eyebrow="// top-up stream"
        actions={
          fleet.fetchedAt !== null && (
            <span className="faint mono" style={{ fontSize: 11 }} title={fmtDateTime(fleet.fetchedAt)}>
              as of {fmtAgo(fleet.fetchedAt, now)}
            </span>
          )
        }
      >
        <ActivityFeed activity={fleet.activity} limit={9} />
      </Panel>
    </div>
  );
}

/* ---------------- Dashboard ---------------- */
export function Overview({ identity, fleet, onOpen, onAdd, onAddSns, snsNames }: OverviewProps) {
  const deposit = useDepositBalances(identity);
  const rate = useIcpTcRate(identity);
  const balHist = useBalanceHistory(identity);
  const schedule = useTimerSchedule(identity);

  // Until the first fleet response resolves we don't yet know whether the user
  // has any canisters, so show a neutral loading state rather than the full
  // dashboard — otherwise its controls flash for a moment before an empty
  // result swaps in the call to action below. Errors fall through to the
  // dashboard's own in-panel handling. (todo-13)
  if (fleet.canisters === null && !fleet.error) {
    return <OverviewLoading />;
  }
  // No tracked canisters: replace the empty dashboard with a focused call to
  // action to add the first one. (todo-13)
  if (!fleet.error && fleet.canisters?.length === 0) {
    return <OverviewEmpty onAdd={onAdd} onAddSns={onAddSns} />;
  }

  return (
    <div className="fade-up grid" style={{ gap: 'var(--gap)' }}>
      <FleetKpiStrip fleet={fleet} deposit={deposit} rate={rate} historyEvents={balHist.events} />
      <FleetDashboard fleet={fleet} onOpen={onOpen} onAdd={onAdd} onAddSns={onAddSns} schedule={schedule} snsNames={snsNames} />
    </div>
  );
}
