// Canister detail. Port of design_files/screen-canisters.jsx CanisterDetail +
// HistoryChart, wired to useCanisterHistory and the real action methods
// (recordCyclesNow / setCanisterSuspended / removeCanister, + asSns* variants).
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { AgentError, ErrorKindEnum } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import { useCanisterHistory } from '../canisters/useCanisterHistory';
import { EditCanisterModal } from '../canisters/CanisterModals';
import { Icon } from '../ui/icons';
import { Panel, KV, Seg, StatusBadge, Empty, Modal, ErrorText, TC } from '../ui/primitives';
import { HealthGauge, GAUGE_STYLE } from '../ui/charts';
import {
  canisterBurnPerDayCycles,
  estDaysToTopUp,
  fmtAgo,
  fmtDate,
  fmtDateTime,
  fmtICP,
  fmtInt,
  fmtPid,
  fmtTC,
  fmtTime,
  fmtUntil,
  healthStatus,
  nsToMs,
  statusColor,
  toTC,
  unexpectedError,
  type Status,
  type UserError,
} from '../ui/format';
import { useNow } from '../ui/now';
import { useTimerSchedule } from '../canisters/useTimerSchedule';
import { useToast } from '../ui/toast';
import type { CycleReading, TopUp } from '../bindings/unicycle_backend/unicycle_backend';

export interface CanisterDetailProps {
  identity: Identity;
  canisterId: Principal;
  actingAs: Principal | null;
  onBack: () => void;
  onChanged: () => void;
}

interface Point {
  at: number; // ms
  bal: number; // TC
}

const DAY_MS = 86_400_000;

function latestOk(readingsAsc: CycleReading[]): bigint | null {
  for (let i = readingsAsc.length - 1; i >= 0; i--) {
    const r = readingsAsc[i].result;
    if (r.__kind__ === 'ok') return r.ok;
  }
  return null;
}

// RecordCycles/Suspend/RemoveCanisterError are string enums in the binding.
function actionErrorMessage(err: string): UserError {
  switch (err) {
    case 'anonymous':
      return { message: 'Sign in first.' };
    case 'notTracked':
      return { message: 'This canister is no longer tracked — refresh the list.' };
    case 'topUpInFlight':
      return { message: 'A top-up is in flight — try again shortly.' };
    case 'rateLimited':
      return { message: 'Too many manual checks — limited to 2 per 5 min per canister and 20 per hour. Try again shortly.' };
    default:
      return { message: 'Action failed — try again.', detail: err };
  }
}

// `recordCyclesNow` is rate-capped at ingress by `inspect` (main.mo), which sheds
// a capped call *before* execution. The agent surfaces that as an *uncertified*
// reject (the message never entered a block); a reject *during* execution comes
// back certified. Anonymous + malformed args are already prevented client-side,
// so an uncertified reject of this method means the manual-check cap was hit —
// map it to the same friendly message as the `#err(#rateLimited)` reply path.
// Anything else (certified trap, connection failure) falls through to the
// generic unexpected-error message.
function rateLimitThrowMessage(e: unknown): UserError | null {
  if (e instanceof AgentError && e.kind === ErrorKindEnum.Reject && !e.isCertified) {
    return actionErrorMessage('rateLimited');
  }
  return null;
}

/* ---- history chart with threshold (all label text is HTML) ---- */
function HistoryChart({ points, minTC, status, topUps }: { points: Point[]; minTC: number; status: Status; topUps: TopUp[] }) {
  const w = 720;
  const h = 200;
  const pad = { t: 16, b: 10 };
  const ih = h - pad.t - pad.b;
  const yAxisW = 40;
  const n = points.length;
  const vals = points.map((p) => p.bal);
  const maxV = Math.max(...vals, minTC) * 1.14;
  const minV = 0;
  const x = (i: number) => (i / (n - 1)) * w;
  const y = (v: number) => pad.t + (1 - (v - minV) / (maxV - minV || 1)) * ih;
  const line = points.map((p, i) => `${x(i)},${y(p.bal)}`).join(' ');
  const area = `0,${pad.t + ih} ${line} ${w},${pad.t + ih}`;
  const col = statusColor(status);
  // Map a ms timestamp onto the index-spaced line: the fractional index between
  // the two readings that bracket it in time, then the line's x/y there. Used to
  // drop top-up markers onto the line where the balance jumps (todo-20).
  const ats = points.map((p) => p.at);
  const posForMs = (ms: number): [number, number] => {
    if (ms <= ats[0]) return [x(0), y(points[0].bal)];
    if (ms >= ats[n - 1]) return [x(n - 1), y(points[n - 1].bal)];
    let i = 0;
    while (i < n - 1 && ats[i + 1] < ms) i++;
    const f = (ms - ats[i]) / (ats[i + 1] - ats[i] || 1);
    return [x(i + f), y(points[i].bal + f * (points[i + 1].bal - points[i].bal))];
  };
  // ~weekly x-axis ticks, always including the first and last reading so the
  // range's start and end are both labelled (todo-28).
  const ticks: number[] = [0];
  let last = points[0].at;
  for (let i = 1; i < n; i++) {
    if (points[i].at - last >= 6.5 * DAY_MS) {
      ticks.push(i);
      last = points[i].at;
    }
  }
  if (ticks[ticks.length - 1] !== n - 1) {
    const li = ticks[ticks.length - 1];
    // snap a near-the-end weekly tick to the end, but never drop the start tick
    if (li !== 0 && points[n - 1].at - points[li].at < 3.5 * DAY_MS) ticks[ticks.length - 1] = n - 1;
    else ticks.push(n - 1);
  }
  // Always show the date; add the time when readings are sub-daily, i.e. when
  // the time-of-day actually carries information (todo-28).
  const showTime = (points[n - 1].at - points[0].at) / (n - 1) < DAY_MS;
  const xLabel = (i: number) =>
    showTime
      ? `${fmtDate(points[i].at).slice(5)} ${fmtTime(points[i].at).slice(0, 5)}`
      : fmtDate(points[i].at).slice(5);
  // y-axis (TC) tick values at the gridline fractions; top tick carries the unit (todo-28).
  const yTickFracs = [0, 0.25, 0.5, 0.75, 1];
  const yDp = maxV >= 100 ? 0 : maxV >= 10 ? 1 : 2;
  const minPct = (y(minTC) / h) * 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '10px 16px 4px' }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div style={{ position: 'relative', width: yAxisW, flexShrink: 0 }}>
          {yTickFracs.map((f, i) => {
            const v = maxV * (1 - f);
            return (
              <span
                key={i}
                className="mono faint"
                style={{
                  position: 'absolute',
                  right: 6,
                  top: `${((pad.t + f * ih) / h) * 100}%`,
                  transform: 'translateY(-50%)',
                  fontSize: 10,
                  whiteSpace: 'nowrap',
                }}
              >
                {v <= 0 ? '0' : fmtTC(v, yDp)}
                {i === 0 ? ' TC' : ''}
              </span>
            );
          })}
        </div>
        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          style={{ position: 'absolute', inset: 0, display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id="histfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={col} stopOpacity="0.2" />
              <stop offset="100%" stopColor={col} stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
            <line key={i} x1="0" y1={pad.t + f * ih} x2={w} y2={pad.t + f * ih} stroke="var(--border)" strokeDasharray="2 4" />
          ))}
          {ticks.map((i) => (
            <line key={`vt${i}`} x1={x(i)} y1={pad.t} x2={x(i)} y2={pad.t + ih} stroke="var(--border)" strokeDasharray="2 4" opacity="0.55" />
          ))}
          <polygon points={area} fill="url(#histfill)" />
          <polyline points={line} fill="none" stroke={col} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          <line x1="0" y1={y(minTC)} x2={w} y2={y(minTC)} stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          {/* cycle-check markers: a small dot on every reading + a larger
              transparent hover target carrying the native tooltip (todo-20) */}
          {points.map((p, i) => {
            const delta = i > 0 ? p.bal - points[i - 1].bal : null;
            const title =
              `${fmtTC(p.bal, 3)} TC\n${fmtDateTime(p.at)}` +
              (delta !== null ? `\nΔ ${delta >= 0 ? '+' : ''}${fmtTC(delta, 3)} TC` : '');
            return (
              <g key={`rd${i}`}>
                <circle cx={x(i)} cy={y(p.bal)} r="2.2" fill={col} stroke="var(--panel)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                <circle cx={x(i)} cy={y(p.bal)} r="6" fill="transparent">
                  <title>{title}</title>
                </circle>
              </g>
            );
          })}
          {/* top-up markers: placed on the line at the attempt time — accent for a
              success, crit for a failed attempt (todo-20). Drawn after the reading
              markers so their hover target wins where a top-up lands on a reading. */}
          {topUps.map((u, i) => {
            const ms = nsToMs(u.attemptedAt);
            const [cx, cy] = posForMs(ms);
            const ok = u.result.__kind__ === 'ok';
            const funding = u.swap
              ? `${u.swap.source} · ${fmtICP(u.swap.amountIn, 2)} ICP → ${fmtTC(u.swap.amountOut)} TC`
              : 'deposit balance';
            const title = ok
              ? `Top-up +${fmtTC(u.amount, 3)} TC\n${fmtDateTime(ms)}\n${funding}` +
                (u.serviceFee > 0n ? `\nfee ${fmtTC(u.serviceFee, 3)} TC` : '')
              : `Top-up failed\n${fmtDateTime(ms)}${u.result.__kind__ === 'err' ? `\n${u.result.err}` : ''}`;
            return (
              <g key={`tu${i}`}>
                <circle cx={cx} cy={cy} r="4" fill={ok ? 'var(--accent)' : 'var(--crit)'} stroke="var(--panel)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                <circle cx={cx} cy={cy} r="8" fill="transparent">
                  <title>{title}</title>
                </circle>
              </g>
            );
          })}
        </svg>
        <div
          className="mono"
          style={{
            position: 'absolute',
            top: `${minPct}%`,
            left: 0,
            transform: 'translateY(-50%)',
            fontSize: 10,
            color: 'var(--warn)',
            background: 'var(--panel)',
            padding: '0 5px',
            borderRadius: 3,
            pointerEvents: 'none',
          }}
        >
          min {fmtTC(minTC)} TC
        </div>
        </div>
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: yAxisW, flexShrink: 0 }} />
        <div style={{ position: 'relative', flex: 1, height: 13, marginTop: 9 }}>
        {ticks.map((i) => {
          const isFirst = i === 0;
          const isLast = i === n - 1;
          return (
            <span
              key={i}
              className="mono faint"
              style={{
                position: 'absolute',
                left: `${(i / (n - 1)) * 100}%`,
                fontSize: 10,
                whiteSpace: 'nowrap',
                transform: isFirst ? 'none' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {xLabel(i)}
            </span>
          );
        })}
        </div>
      </div>
    </div>
  );
}

export function CanisterDetail({ identity, canisterId, actingAs, onBack, onChanged }: CanisterDetailProps) {
  const { data, loading, error, refresh } = useCanisterHistory(identity, canisterId, actingAs);
  const schedule = useTimerSchedule(identity);
  const now = useNow();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [histView, setHistView] = useState<'chart' | 'table'>('chart');
  const [busy, setBusy] = useState(false);

  const idText = canisterId.toString();

  if (loading && !data) {
    return (
      <Panel title={fmtPid(idText)} actions={<button className="btn ghost sm" onClick={onBack}>Back</button>}>
        <div className="faint">Loading history…</div>
      </Panel>
    );
  }
  if (error) {
    return (
      <Panel title={fmtPid(idText)} actions={<button className="btn ghost sm" onClick={onBack}>Back</button>}>
        <div className="hint" style={{ color: 'var(--crit)' }}>{error}</div>
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel actions={<button className="btn ghost sm" onClick={onBack}>Back</button>}>
        <Empty icon="canisters" title="Not tracked">This canister isn't tracked under the current identity.</Empty>
      </Panel>
    );
  }

  const config = data.config;
  const readingsAsc = [...data.readings].sort((a, b) =>
    a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0,
  );
  const cur = latestOk(readingsAsc);
  const min = config.minCycleBalance;
  const topup = config.cycleTopUpAmount;
  const suspended = config.suspendedUntil !== undefined;
  const estDays = estDaysToTopUp(cur, min, canisterBurnPerDayCycles(readingsAsc, Date.now()));
  const status = healthStatus(cur, min, suspended, { topUpAmount: topup, estDays });
  const label = config.nickname ?? fmtPid(idText);
  const ratioPct = cur === null ? 0 : Math.round((Number(cur) / Number(min)) * 100);
  const lastReadingMs = readingsAsc.length ? nsToMs(readingsAsc[readingsAsc.length - 1].recordedAt) : null;

  const points: Point[] = readingsAsc
    .filter((r): r is CycleReading & { result: { __kind__: 'ok'; ok: bigint } } => r.result.__kind__ === 'ok')
    .map((r) => ({ at: nsToMs(r.recordedAt), bal: toTC(r.result.ok) }));

  const topUps = [...data.topUps].sort((a, b) =>
    a.attemptedAt < b.attemptedAt ? 1 : a.attemptedAt > b.attemptedAt ? -1 : 0,
  );

  type ActionResult = { __kind__: 'ok'; ok: null } | { __kind__: 'err'; err: string };

  const runAction = async (
    fn: (backend: ReturnType<typeof createUnicycleBackendActor>) => Promise<ActionResult>,
    success: ReactNode,
    after?: () => void,
    // Maps a thrown error to a friendlier message when the caller can recognize
    // it (e.g. the recordCyclesNow ingress rate-limit reject); null → fall back.
    mapThrow?: (e: unknown) => UserError | null,
  ) => {
    setBusy(true);
    try {
      const backend = createUnicycleBackendActor(identity);
      const res = await fn(backend);
      if (res.__kind__ === 'ok') {
        toast(success);
        refresh();
        onChanged();
        after?.();
      } else {
        toast(
          <>
            <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
            <ErrorText error={actionErrorMessage(res.err)} />
          </>,
          { sticky: true },
        );
      }
    } catch (e) {
      toast(
        <>
          <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
          <ErrorText error={mapThrow?.(e) ?? unexpectedError('complete the action', e)} />
        </>,
        { sticky: true },
      );
    } finally {
      setBusy(false);
    }
  };

  const recordNow = () =>
    runAction(
      (b) => (actingAs ? b.asSnsRecordCyclesNow(actingAs, canisterId) : b.recordCyclesNow(canisterId)),
      <>
        <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
        Recorded cycles for <b>{label}</b>
      </>,
      undefined,
      rateLimitThrowMessage,
    );

  const toggleSuspend = () => {
    const next = !suspended;
    runAction(
      (b) =>
        actingAs ? b.asSnsSetCanisterSuspended(actingAs, canisterId, next) : b.setCanisterSuspended(canisterId, next),
      <>
        <Icon name={next ? 'pause' : 'play'} size={14} />
        {next ? 'Suspended' : 'Resumed'} top-ups for <b>{label}</b>
      </>,
    );
  };

  const remove = () =>
    runAction(
      (b) => (actingAs ? b.asSnsRemoveCanister(actingAs, canisterId) : b.removeCanister(canisterId)),
      <>
        <Icon name="trash" size={14} style={{ color: 'var(--crit)' }} />
        Removed <b>{label}</b> from fleet
      </>,
      onBack,
    );

  return (
    <div className="grid fade-up" style={{ gap: 'var(--gap)' }}>
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="iconbtn" onClick={onBack}>
            <Icon name="arrowLeft" size={16} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="h1">{label}</span>
              <StatusBadge status={status} />
            </div>
            <div className="mono faint" style={{ fontSize: 12, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              {idText}
              <a
                className="extlink"
                href={`https://dashboard.internetcomputer.org/canister/${idText}`}
                target="_blank"
                rel="noopener noreferrer"
                title="View on the IC Dashboard"
                style={{ display: 'inline-flex', alignItems: 'center' }}
              >
                <Icon name="ext" size={11} />
              </a>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={recordNow} disabled={busy}>
            <Icon name="refresh" size={14} />
            Record now
          </button>
          <button className="btn" onClick={() => setEditing(true)} disabled={busy}>
            <Icon name="edit" size={14} />
            Edit
          </button>
          <button className="btn" onClick={toggleSuspend} disabled={busy}>
            <Icon name={suspended ? 'play' : 'pause'} size={14} />
            {suspended ? 'Resume' : 'Suspend'}
          </button>
          <button className="btn danger" onClick={() => setConfirmRemove(true)} disabled={busy}>
            <Icon name="trash" size={14} />
          </button>
        </div>
      </div>

      {suspended && config.suspendedUntil !== undefined && (
        <div
          className="panel"
          style={{
            borderColor: 'color-mix(in oklch, var(--warn) 40%, transparent)',
            background: 'color-mix(in oklch, var(--warn) 7%, transparent)',
            padding: '12px var(--pad)',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <Icon name="pause" size={15} style={{ color: 'var(--warn)' }} />
          <span style={{ fontSize: 12.5 }}>
            Top-ups are suspended. Auto-removes on{' '}
            <span className="mono" style={{ color: 'var(--warn)' }}>
              {fmtDate(nsToMs(config.suspendedUntil))}
            </span>{' '}
            if not resumed. No further top-ups will be attempted.
          </span>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'stretch' }}>
        <Panel title="Health" eyebrow="// current vs threshold">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '6px 0' }}>
            <HealthGauge cur={cur} min={min} status={status} style={GAUGE_STYLE} size={120} />
            <div style={{ textAlign: 'center' }}>
              <div className="mono" style={{ fontSize: 13, color: statusColor(status), fontWeight: 600 }}>
                {cur === null ? 'No readings yet' : `${ratioPct}% of minimum`}
              </div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>
                {cur === null ? 'Record now to take a first reading' : cur < min ? 'Below threshold — top-up imminent' : 'Above threshold'}
              </div>
            </div>
          </div>
          <div className="hr" style={{ margin: '4px 0 8px' }} />
          <KV k="Current balance">
            <span style={{ color: statusColor(status), fontWeight: 600 }}><TC raw={cur} /> TC</span>
          </KV>
          <KV k="Min cycle balance"><TC raw={min} /> TC</KV>
          <KV k="Top-up amount"><TC raw={topup} /> TC</KV>
          <KV k="Last check">{suspended || lastReadingMs === null ? '—' : fmtAgo(lastReadingMs, now)}</KV>
          <KV k="Next check">{suspended || schedule.nextCheckMs === null ? '—' : `~${fmtUntil(schedule.nextCheckMs, now)}`}</KV>
        </Panel>

        <Panel
          title="Cycle history"
          eyebrow={`// ${data.readings.length} readings`}
          style={{ display: 'flex', flexDirection: 'column' }}
          bodyStyle={{ flex: 1, minHeight: 0, position: 'relative' }}
          actions={
            <Seg
              options={[
                { value: 'chart', icon: 'activity' },
                { value: 'table', icon: 'list' },
              ]}
              value={histView}
              onChange={setHistView}
            />
          }
        >
          {histView === 'chart' ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
              {points.length < 2 ? (
                <Empty icon="activity" title="Not enough readings">At least two cycle readings are needed to draw the history chart.</Empty>
              ) : (
                <HistoryChart points={points} minTC={toTC(min)} status={status} topUps={topUps} />
              )}
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', overflowX: 'hidden' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th className="num">Balance</th>
                    <th className="num">Δ since prev</th>
                    <th>Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {[...readingsAsc]
                    .reverse()
                    .map((r, i, arr) => {
                      const when = fmtDateTime(nsToMs(r.recordedAt));
                      if (r.result.__kind__ !== 'ok') {
                        return (
                          <tr key={i}>
                            <td className="mono" style={{ fontSize: 11.5 }}>{when}</td>
                            <td className="num faint" style={{ fontSize: 11.5 }}>{r.result.err}</td>
                            <td className="num faint">—</td>
                            <td>
                              <StatusBadge status="unknown" dot={false} />
                            </td>
                          </tr>
                        );
                      }
                      const bal = r.result.ok;
                      const st = healthStatus(bal, min, false, { topUpAmount: topup });
                      const prev = arr[i + 1];
                      const delta = prev && prev.result.__kind__ === 'ok' ? bal - prev.result.ok : null;
                      return (
                        <tr key={i}>
                          <td className="mono" style={{ fontSize: 11.5 }}>{when}</td>
                          <td className="num mono" style={{ color: statusColor(st), fontWeight: 600 }}><TC raw={bal} /> TC</td>
                          <td
                            className="num mono"
                            style={{
                              fontSize: 11,
                              color: delta === null ? 'var(--text-2)' : delta > 0n ? 'var(--accent-ink)' : 'var(--text-1)',
                            }}
                          >
                            {delta === null ? '—' : <>{delta > 0n ? '+' : ''}<TC raw={delta} /> TC</>}
                          </td>
                          <td>
                            <StatusBadge status={st} dot={false} />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        flush
        title="Top-up history"
        eyebrow="// attempts, newest first"
        actions={<span className="chip">{topUps.length} events</span>}
      >
        {topUps.length === 0 ? (
          <Empty icon="bolt" title="No top-ups yet">The cycle check hasn't triggered a refill for this canister.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 30 }}></th>
                <th>When</th>
                <th className="num">Amount</th>
                <th>Funding</th>
                <th className="num">Service fee</th>
                <th className="num">Block</th>
              </tr>
            </thead>
            <tbody>
              {topUps.map((u: TopUp, i) => {
                const ok = u.result.__kind__ === 'ok';
                return (
                  <tr key={i}>
                    <td>
                      <Icon name={ok ? 'bolt' : 'x'} size={13} style={{ color: ok ? 'var(--accent-ink)' : 'var(--crit)' }} />
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{fmtDateTime(nsToMs(u.attemptedAt))}</td>
                    <td className="num mono" style={{ color: ok ? 'var(--accent-ink)' : 'var(--crit)', fontWeight: 600 }}>
                      {ok ? '+' : '×'}
                      <TC raw={u.amount} /> TC
                    </td>
                    <td>
                      {u.swap ? (
                        <span className="badge">
                          <Icon name="link" size={10} />
                          {u.swap.source} · {fmtICP(u.swap.amountIn, 2)} ICP → <TC raw={u.swap.amountOut} /> TC
                        </span>
                      ) : (
                        <span className="faint" style={{ fontSize: 11.5 }}>deposit balance</span>
                      )}
                      {u.result.__kind__ === 'err' && (
                        <div
                          className="mono"
                          style={{ fontSize: 9.5, color: 'var(--crit)', marginTop: 3, maxWidth: 340, whiteSpace: 'normal', lineHeight: 1.4 }}
                        >
                          {u.result.err}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      {/* serviceFee is the NET fee actually paid (0.000 when fully
                          covered by rebate); rebateApplied is the loyalty credit
                          netted off the gross fee. */}
                      <span className="mono faint" style={{ fontSize: 11.5 }}><TC raw={u.serviceFee} dp={3} /> TC</span>
                      {u.rebateApplied > 0n && (
                        <div className="mono" style={{ fontSize: 9.5, color: 'var(--accent-ink)' }}>
                          rebate −<TC raw={u.rebateApplied} dp={3} /> TC
                        </div>
                      )}
                      {u.feeError && (
                        <div className="mono" style={{ fontSize: 9.5, color: 'var(--crit)' }} title={u.feeError}>
                          fee transfer failed
                        </div>
                      )}
                    </td>
                    <td className="num mono faint" style={{ fontSize: 11.5 }}>
                      {u.result.__kind__ === 'ok' ? fmtInt(u.result.ok) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {editing && (
        <EditCanisterModal
          identity={identity}
          actingAs={actingAs}
          canisterId={canisterId}
          config={config}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
            onChanged();
          }}
        />
      )}
      {confirmRemove && (
        <Modal
          title="Remove canister"
          eyebrow="// destructive"
          onClose={() => setConfirmRemove(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmRemove(false)}>
                Cancel
              </button>
              <button
                className="btn danger"
                disabled={busy}
                onClick={() => {
                  setConfirmRemove(false);
                  remove();
                }}
              >
                <Icon name="trash" size={14} />
                Confirm remove
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.6 }}>
            Removes <b style={{ color: 'var(--text)' }}>{label}</b> <span className="mono faint">{fmtPid(idText)}</span> from
            your fleet. Top-up history is dropped. Cycle readings are preserved only if another user still tracks this
            canister.
          </p>
        </Modal>
      )}
    </div>
  );
}
