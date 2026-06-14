// Admin "Trends" tab: service-level time series from the MetricsSnapshot
// history (adminGetMetricsSnapshots) plus the live runtime stats from
// adminGetMetrics. Level series plot the sampled value per snapshot; delta
// series diff consecutive snapshots (fees collected, top-up volume per interval).
import type { ReactNode } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Panel, Empty, TC } from '../ui/primitives';
import { Sparkline, MiniBars } from '../ui/charts';
import { fmtAgo, fmtInt, nsToMs, toTC } from '../ui/format';
import { useNow } from '../ui/now';
import { useAdminTrends, levelSeries, deltaSeries } from '../admin/useAdminTrends';
import type { AdminMetrics } from '../bindings/unicycle_backend/unicycle_backend';

export interface AdminTrendsProps {
  identity: Identity;
  metrics: AdminMetrics | null;
}

function TrendPanel({
  title,
  latest,
  unit,
  children,
}: {
  title: string;
  latest: ReactNode;
  unit?: string;
  children: ReactNode;
}) {
  return (
    <div className="panel" style={{ padding: 'var(--pad)' }}>
      <div className="eyebrow" style={{ marginBottom: 5 }}>{title}</div>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
        {latest}
        {unit && <span className="faint" style={{ fontSize: 10 }}> {unit}</span>}
      </div>
      {children}
    </div>
  );
}

const fmtBytes = (n: bigint): string => {
  const mb = Number(n) / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(Number(n) / 1024)} KB`;
};

export function AdminTrends({ identity, metrics }: AdminTrendsProps) {
  const trends = useAdminTrends(identity);
  const now = useNow();
  const snaps = trends.snapshots ?? [];
  const latest = snaps.length > 0 ? snaps[snaps.length - 1] : null;

  return (
    <div className="grid fade-up" style={{ gap: 'var(--gap)' }}>
      {/* runtime stats strip (live, from adminGetMetrics) */}
      <Panel
        flush
        title="Service health"
        eyebrow="// live"
        actions={
          <button className="btn sm" onClick={() => trends.refresh()}>
            Refresh
          </button>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {[
            { label: 'Memory', value: metrics ? fmtBytes(metrics.memorySizeBytes) : '—' },
            { label: 'Heap', value: metrics ? fmtBytes(metrics.heapSizeBytes) : '—' },
            {
              label: 'Last cycle check',
              value: metrics?.lastCycleCheckAt !== undefined ? fmtAgo(nsToMs(metrics.lastCycleCheckAt), now) : 'never',
            },
            { label: 'Top-ups ok', value: metrics ? fmtInt(metrics.cumulativeTopUpsSucceeded) : '—' },
            { label: 'Top-ups failed', value: metrics ? fmtInt(metrics.cumulativeTopUpsFailed) : '—' },
          ].map((m) => (
            <div key={m.label} style={{ padding: 'var(--pad)', borderRight: '1px solid var(--border)' }}>
              <div className="eyebrow" style={{ marginBottom: 7 }}>{m.label}</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{m.value}</div>
            </div>
          ))}
        </div>
      </Panel>

      {trends.error && <div className="faint" style={{ fontSize: 11.5 }}>Failed to load snapshots: {trends.error}</div>}

      {snaps.length < 2 ? (
        <Panel flush>
          <Empty icon="activity" title="Not enough history yet">
            Snapshots are recorded by the regular cycle check — trends appear once at least two exist
            ({snaps.length} so far).
          </Empty>
        </Panel>
      ) : (
        <>
          {/* level series */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <TrendPanel title="Fee pool" latest={latest ? <TC raw={latest.feePoolBalanceTcycles} /> : '—'} unit="TC">
              <Sparkline data={levelSeries(snaps, (s) => toTC(s.feePoolBalanceTcycles))} w={220} h={56} fill />
            </TrendPanel>
            <TrendPanel title="Service cycles" latest={latest ? <TC raw={latest.serviceCyclesBalance} /> : '—'} unit="TC">
              <Sparkline data={levelSeries(snaps, (s) => toTC(s.serviceCyclesBalance))} w={220} h={56} fill />
            </TrendPanel>
            <TrendPanel title="Owners" latest={latest ? fmtInt(latest.ownersCount) : '—'}>
              <Sparkline data={levelSeries(snaps, (s) => Number(s.ownersCount))} w={220} h={56} fill />
            </TrendPanel>
            <TrendPanel title="Tracked canisters" latest={latest ? fmtInt(latest.trackedCanistersCount) : '—'}>
              <Sparkline data={levelSeries(snaps, (s) => Number(s.trackedCanistersCount))} w={220} h={56} fill />
            </TrendPanel>
          </div>

          {/* per-interval deltas of the cumulative counters */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <TrendPanel title="Fees collected / interval" latest={latest ? <TC raw={latest.cumulativeFeesTcycles} /> : '—'} unit="TC total">
              <MiniBars data={deltaSeries(snaps, (s) => s.cumulativeFeesTcycles).map((v) => v / 1e12)} w={300} h={56} />
            </TrendPanel>
            <TrendPanel title="Top-up volume / interval" latest={latest ? <TC raw={latest.cumulativeTopUpTcycles} /> : '—'} unit="TC total">
              <MiniBars data={deltaSeries(snaps, (s) => s.cumulativeTopUpTcycles).map((v) => v / 1e12)} w={300} h={56} />
            </TrendPanel>
            <TrendPanel title="Top-up failures / interval" latest={latest ? fmtInt(latest.cumulativeTopUpsFailed) : '—'} unit="total">
              <MiniBars data={deltaSeries(snaps, (s) => s.cumulativeTopUpsFailed)} w={300} h={56} color="var(--crit)" />
            </TrendPanel>
          </div>

          {/* loyalty counters over time */}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <TrendPanel title="Surplus shared" latest={latest ? <TC raw={latest.cumulativeSurplusRewardsTcycles} /> : '—'} unit="TC total">
              <Sparkline data={levelSeries(snaps, (s) => toTC(s.cumulativeSurplusRewardsTcycles))} w={300} h={56} fill />
            </TrendPanel>
            <TrendPanel title="Rebates granted" latest={latest ? <TC raw={latest.cumulativeRebatesGrantedTcycles} /> : '—'} unit="TC total">
              <Sparkline data={levelSeries(snaps, (s) => toTC(s.cumulativeRebatesGrantedTcycles))} w={300} h={56} fill />
            </TrendPanel>
            <TrendPanel title="Service funding" latest={latest ? <TC raw={latest.cumulativeServiceFundingTcycles} /> : '—'} unit="TC total">
              <Sparkline data={levelSeries(snaps, (s) => toTC(s.cumulativeServiceFundingTcycles))} w={300} h={56} fill />
            </TrendPanel>
          </div>
        </>
      )}
    </div>
  );
}
