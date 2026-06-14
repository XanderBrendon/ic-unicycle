// Admin "Logs" tab: filterable, paged viewer over the backend's operational +
// audit log (adminGetLogs). Timer-driven entries have no caller; admin/SNS
// actions carry the caller principal.
import type { Identity } from '@icp-sdk/core/agent';
import { Panel, Empty, Seg } from '../ui/primitives';
import { fmtDateTime, fmtPid, nsToMs } from '../ui/format';
import { useAdminLogs } from '../admin/useAdminLogs';
import {
  LogCategory,
  LogLevel,
  type LogEntry,
} from '../bindings/unicycle_backend/unicycle_backend';

export interface AdminLogsProps {
  identity: Identity;
}

type LevelChoice = 'all' | LogLevel;

const LEVEL_OPTIONS: Array<{ value: LevelChoice; label: string }> = [
  { value: 'all', label: 'All' },
  { value: LogLevel.info, label: 'Info' },
  { value: LogLevel.warn, label: 'Warn' },
  { value: LogLevel.error, label: 'Error' },
];

const CATEGORIES: LogCategory[] = [
  LogCategory.timer,
  LogCategory.topUp,
  LogCategory.fee,
  LogCategory.swap,
  LogCategory.lp,
  LogCategory.harvest,
  LogCategory.sns,
  LogCategory.admin,
];

function levelBadge(level: LogLevel) {
  switch (level) {
    case LogLevel.error:
      return <span className="badge crit">error</span>;
    case LogLevel.warn:
      return <span className="badge warn">warn</span>;
    default:
      return <span className="badge muted">info</span>;
  }
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <tr>
      <td className="mono faint" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDateTime(nsToMs(entry.at))}</td>
      <td>{levelBadge(entry.level)}</td>
      <td className="mono faint" style={{ fontSize: 11 }}>{entry.category}</td>
      <td className="mono" style={{ fontSize: 11.5, wordBreak: 'break-word' }}>{entry.message}</td>
      <td className="mono faint" style={{ fontSize: 11 }} title={entry.caller?.toText()}>
        {entry.caller ? fmtPid(entry.caller.toText(), 6, 4) : '—'}
      </td>
    </tr>
  );
}

export function AdminLogs({ identity }: AdminLogsProps) {
  const logs = useAdminLogs(identity);
  const entries = logs.entries ?? [];

  return (
    <div className="grid fade-up" style={{ gap: 'var(--gap)' }}>
      <Panel
        flush
        title="Service log"
        eyebrow="// operational + audit, newest first"
        actions={
          <>
            <Seg<LevelChoice>
              options={LEVEL_OPTIONS}
              value={logs.level ?? 'all'}
              onChange={(v) => logs.setLevel(v === 'all' ? null : v)}
            />
            <select
              className="input mono"
              style={{ height: 28, fontSize: 11.5, width: 110 }}
              value={logs.category ?? 'all'}
              onChange={(e) => logs.setCategory(e.target.value === 'all' ? null : (e.target.value as LogCategory))}
            >
              <option value="all">all categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button className="btn sm" onClick={() => logs.refresh()}>
              Refresh
            </button>
          </>
        }
      >
        {logs.error && (
          <div className="faint" style={{ fontSize: 11.5, padding: 'var(--pad)' }}>Failed to load logs: {logs.error}</div>
        )}
        {entries.length === 0 && !logs.loading ? (
          <Empty icon="list" title="No log entries">
            Nothing recorded {logs.level || logs.category ? 'for this filter' : 'yet'} — timer runs, top-ups,
            fee charges, LP/harvest events, SNS proposals and admin actions land here.
          </Empty>
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Level</th>
                  <th>Category</th>
                  <th>Message</th>
                  <th>Caller</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <LogRow key={e.seq.toString()} entry={e} />
                ))}
              </tbody>
            </table>
            {logs.hasMore && (
              <div style={{ padding: '10px var(--pad)', textAlign: 'center' }}>
                <button className="btn sm" disabled={logs.loading} onClick={() => logs.loadMore()}>
                  {logs.loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
