// Gauges, sparkline, area + bar charts. Port of design_files/charts.jsx.
// Inputs are real units: `cur`/`min` are bigint smallest-unit cycle balances
// (cur may be null when a canister has no readings yet); chart series are TC
// number arrays. SVG geometry uses preserveAspectRatio="none" and all gauge
// value text is real SVG <text> sized relative to the gauge (no distortion,
// since gauges are square and not stretched).
import { fmtTC, fmtTCFull, gaugeRatio, statusColor, toTC, type Status } from './format';

export type GaugeStyle = 'ring' | 'dial' | 'bar';

// Hardcoded product default (README: ring gauge).
export const GAUGE_STYLE: GaugeStyle = 'ring';

const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const DAY_MS = 86_400_000;

function gaugeValueText(cur: bigint | null): string {
  if (cur === null) return '—';
  const curTC = toTC(cur);
  return fmtTC(cur, curTC < 10 ? 1 : 0);
}

// Fully-expanded value for the gauge's hover tooltip (native title), so the
// rounded SVG digits reveal their exact balance. null cur → no tooltip.
function gaugeValueTitle(cur: bigint | null): string | undefined {
  return cur === null ? undefined : `${fmtTCFull(cur)} TC`;
}

interface GaugeProps {
  cur: bigint | null;
  min: bigint;
  status: Status;
  size?: number;
  showValue?: boolean;
}

function RingGauge({ cur, min, status, size = 64, stroke = 6, showValue = true }: GaugeProps & { stroke?: number }) {
  const { ratio, thr } = gaugeRatio(cur, min);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const col = statusColor(status);
  const thrAngle = -90 + thr * 360;
  const tx = size / 2 + r * Math.cos((thrAngle * Math.PI) / 180);
  const ty = size / 2 + r * Math.sin((thrAngle * Math.PI) / 180);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={col}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${ratio * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray .5s var(--ease)' }}
      />
      <circle cx={tx} cy={ty} r={stroke / 2 + 1.2} fill="var(--panel)" stroke="var(--text-1)" strokeWidth="1.4" />
      {showValue && (
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={size * 0.26}
          fontWeight="600"
          fill="var(--text)"
        >
          {gaugeValueText(cur)}
          {cur !== null && <title>{gaugeValueTitle(cur)}</title>}
        </text>
      )}
    </svg>
  );
}

function DialGauge({ cur, min, status, size = 64, showValue = true }: GaugeProps) {
  const { ratio, thr } = gaugeRatio(cur, min);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 6;
  const start = 135;
  const sweep = 270;
  const pol = (deg: number): [number, number] => [
    cx + r * Math.cos((deg * Math.PI) / 180),
    cy + r * Math.sin((deg * Math.PI) / 180),
  ];
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pol(a0);
    const [x1, y1] = pol(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  const col = statusColor(status);
  const [tx, ty] = pol(start + thr * sweep);
  const ti: [number, number] = [
    cx + (r - 5) * Math.cos(((start + thr * sweep) * Math.PI) / 180),
    cy + (r - 5) * Math.sin(((start + thr * sweep) * Math.PI) / 180),
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <path d={arc(start, start + sweep)} fill="none" stroke="var(--border)" strokeWidth="6" strokeLinecap="round" />
      <path
        d={arc(start, start + Math.max(0.001, ratio) * sweep)}
        fill="none"
        stroke={col}
        strokeWidth="6"
        strokeLinecap="round"
        style={{ transition: 'all .5s var(--ease)' }}
      />
      <line x1={tx} y1={ty} x2={ti[0]} y2={ti[1]} stroke="var(--text-1)" strokeWidth="1.6" />
      {showValue && (
        <text
          x="50%"
          y="58%"
          dominantBaseline="central"
          textAnchor="middle"
          fontFamily="'JetBrains Mono', monospace"
          fontSize={size * 0.24}
          fontWeight="600"
          fill="var(--text)"
        >
          {gaugeValueText(cur)}
          {cur !== null && <title>{gaugeValueTitle(cur)}</title>}
        </text>
      )}
    </svg>
  );
}

function BarGauge({ cur, min, status, size = 64 }: GaugeProps) {
  const { ratio, thr } = gaugeRatio(cur, min);
  const col = statusColor(status);
  const w = Math.max(26, size * 0.42);
  const h = size;
  const curTC = cur === null ? 0 : toTC(cur);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          position: 'relative',
          width: w,
          height: h,
          borderRadius: 4,
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: `${ratio * 100}%`,
            background: col,
            transition: 'height .5s var(--ease)',
            borderRadius: '0 0 3px 3px',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: -1,
            right: -1,
            bottom: `${thr * 100}%`,
            height: 0,
            borderTop: '1.5px dashed var(--text-1)',
            opacity: 0.85,
          }}
        />
      </div>
      <div
        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: size * 0.2, fontWeight: 600, lineHeight: 1.1 }}
        title={gaugeValueTitle(cur)}
      >
        {fmtTC(cur, curTC < 10 ? 2 : 1)}
        <span style={{ color: 'var(--text-2)', fontSize: '0.7em' }}> TC</span>
      </div>
    </div>
  );
}

export function HealthGauge({
  cur,
  min,
  status,
  style = 'ring',
  size = 64,
  showValue = true,
}: GaugeProps & { style?: GaugeStyle }) {
  if (style === 'dial') return <DialGauge cur={cur} min={min} status={status} size={size} showValue={showValue} />;
  if (style === 'bar') return <BarGauge cur={cur} min={min} status={status} size={size} />;
  return <RingGauge cur={cur} min={min} status={status} size={size} showValue={showValue} />;
}

export function FuelBar({ cur, min, status, width = 120 }: { cur: bigint | null; min: bigint; status: Status; width?: number }) {
  const { ratio, thr } = gaugeRatio(cur, min);
  const cls = status === 'crit' ? 'crit' : status === 'warn' ? 'warn' : '';
  return (
    <div className={`fuel ${cls}`} style={{ width }}>
      <i
        style={{
          width: `${ratio * 100}%`,
          background: status === 'suspended' || status === 'unknown' ? 'var(--text-2)' : undefined,
          transition: 'width .5s var(--ease)',
        }}
      />
      <span className="thr" style={{ left: `${thr * 100}%` }} />
    </div>
  );
}

export function Sparkline({
  data,
  w = 120,
  h = 30,
  color = 'var(--accent)',
  fill = false,
  strokeW = 1.5,
}: {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  fill?: boolean;
  strokeW?: number;
}) {
  if (data.length < 2) {
    return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }} preserveAspectRatio="none" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - ((v - min) / rng) * (h - 4) - 2] as const);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `${pts[0][0]},${h} ${line} ${pts[pts.length - 1][0]},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }} preserveAspectRatio="none">
      {fill && <polygon points={area} fill={color} opacity="0.12" />}
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2" fill={color} />
    </svg>
  );
}

// Runway chart. Default mode (no `history`): balance sloping to zero at
// `burnPerDay` over `days`. When `history` (TC-equivalent balance points,
// [atMs, balTC] ascending) and `nowMs` are supplied, the chart plots the recent
// `windowDays` of actual balance (solid, left half) up to a "now" divider, then
// the forward projection from `balance` (dashed, right half) — see todo-11.
export function AreaChart({
  balance,
  burnPerDay,
  days = 60,
  w = 640,
  h = 200,
  history,
  nowMs,
  windowDays = 7,
}: {
  balance: number;
  burnPerDay: number;
  days?: number;
  w?: number;
  h?: number;
  history?: Array<[number, number]>;
  nowMs?: number;
  windowDays?: number;
}) {
  const pad = { t: 14 };
  const ih = h - pad.t;
  const ylines = [0.25, 0.5, 0.75].map((f) => pad.t + f * ih);

  if (history && nowMs !== undefined) {
    const startMs = nowMs - windowDays * DAY_MS;
    const endMs = nowMs + windowDays * DAY_MS;
    const span = endMs - startMs || 1;
    const xAt = (ms: number) => clamp((ms - startMs) / span) * w;

    const hist = history.filter(([ms]) => ms >= startMs && ms <= nowMs);
    const steps = 24;
    const proj: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const ms = nowMs + (i / steps) * (endMs - nowMs);
      const fwdDays = (ms - nowMs) / DAY_MS;
      proj.push([ms, Math.max(0, balance - burnPerDay * fwdDays)]);
    }
    const histPath: Array<[number, number]> = [...hist, [nowMs, balance]];
    const full = [...histPath, ...proj];
    const maxBal = Math.max(...full.map(([, b]) => b), balance * 1.05, 0.0001);
    const toStr = ([ms, b]: [number, number]) => `${xAt(ms)},${pad.t + (1 - b / maxBal) * ih}`;
    const nowX = xAt(nowMs);
    const area = `${xAt(full[0][0])},${pad.t + ih} ${full.map(toStr).join(' ')} ${xAt(full[full.length - 1][0])},${pad.t + ih}`;
    const runwayDays = burnPerDay > 0 ? balance / burnPerDay : Infinity;
    const depleteX = runwayDays <= windowDays ? xAt(nowMs + runwayDays * DAY_MS) : null;
    return (
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="runfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {ylines.map((y, i) => (
          <line key={i} x1="0" y1={y} x2={w} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
        ))}
        <polygon points={area} fill="url(#runfill)" />
        <polyline points={histPath.map(toStr).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <polyline points={proj.map(toStr).join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeOpacity="0.8" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <line x1={nowX} y1={pad.t} x2={nowX} y2={pad.t + ih} stroke="var(--border)" strokeWidth="1" />
        {depleteX !== null && (
          <g>
            <line x1={depleteX} y1={pad.t} x2={depleteX} y2={pad.t + ih} stroke="var(--warn)" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <circle cx={depleteX} cy={pad.t + ih} r="3.5" fill="var(--warn)" />
          </g>
        )}
      </svg>
    );
  }

  const maxBal = Math.max(balance * 1.05, 0.0001);
  const n = days;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const bal = Math.max(0, balance - burnPerDay * i);
    pts.push([(i / n) * w, pad.t + (1 - bal / maxBal) * ih]);
  }
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `0,${pad.t + ih} ${line} ${w},${pad.t + ih}`;
  const runway = burnPerDay > 0 ? Math.floor(balance / burnPerDay) : Infinity;
  const refillX = clamp(runway / n) * w;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="runfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {ylines.map((y, i) => (
        <line key={i} x1="0" y1={y} x2={w} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      <polygon points={area} fill="url(#runfill)" />
      <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {runway <= n && (
        <g>
          <line
            x1={refillX}
            y1={pad.t}
            x2={refillX}
            y2={pad.t + ih}
            stroke="var(--warn)"
            strokeWidth="1.5"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={refillX} cy={pad.t + ih} r="3.5" fill="var(--warn)" />
        </g>
      )}
    </svg>
  );
}

// `tip(value, index)` adds a native hover tooltip per bar (e.g. "3.2 TC · 2026-06-13").
// Omitted → no tooltip (existing callers unchanged).
export function MiniBars({
  data,
  w = 200,
  h = 48,
  color = 'var(--accent)',
  tip,
}: {
  data: number[];
  w?: number;
  h?: number;
  color?: string;
  tip?: (value: number, index: number) => string;
}) {
  const max = Math.max(...data, 1);
  const bw = w / data.length;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {data.map((v, i) => {
        const bh = (v / max) * (h - 4);
        return (
          <rect key={i} x={i * bw + 1} y={h - bh} width={bw - 2} height={bh} rx="1" fill={color} opacity={0.35 + 0.65 * (v / max)}>
            {tip && <title>{tip(v, i)}</title>}
          </rect>
        );
      })}
    </svg>
  );
}
