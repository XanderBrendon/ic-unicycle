// Bulk-configure every SNS-controlled canister at once. Lists the SNS root's
// canisters (list_sns_canisters) in an editable table seeded from the already-
// tracked fleet. Each row has a tri-state toggle — Tracked / Suspended /
// Untracked. On Save the desired state is reconciled: Tracked/Suspended rows
// are upserted (and their suspension set), Untracked-but-previously-tracked
// rows are removed.
import { useEffect, useMemo, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { Modal, ErrorHint } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtPid, TCYCLES_DECIMALS } from '../ui/format';
import { useToast } from '../ui/toast';
import { parseDecimalAmount, formatTokenAmount } from '../wallet/format';
import { createUnicycleBackendActor } from '../auth/actor';
import {
  RemoveCanisterError,
  SuspendCanisterError,
  type BatchTrackEntry,
  type BatchTrackEntryResult,
  type BatchTrackError,
  type CanisterConfig,
} from '../bindings/unicycle_backend/unicycle_backend';
import { formatUpsertCanisterError } from './useUpsertCanister';
import { useSnsCanisterList, type SnsCanisterEntry } from '../sns/snsCanisterList';
import type { FleetCanister } from './useFleet';

const NICKNAME_MAX = 48;
const DEFAULT_MIN_TC = '1';
const DEFAULT_TOPUP_TC = '0.5';
// Entries per batch call — must match BatchTrack.MAX_ENTRIES in the backend.
const MAX_BATCH_ENTRIES = 100;

type RowState = 'tracked' | 'suspended' | 'untracked';

interface Row {
  entry: SnsCanisterEntry;
  idText: string;
  tracked: boolean; // persisted tracked state (at open / after a save)
  suspended: boolean; // persisted suspension state
  suspendedUntil: bigint | undefined; // preserved through upsert (discarded server-side, passed for parity)
  state: RowState; // desired state
  name: string;
  min: string;
  topup: string;
}

type RowResult = { ok: true } | { ok: false; error: string };

function removeErrMsg(err: RemoveCanisterError): string {
  switch (err) {
    case RemoveCanisterError.topUpInFlight:
      return 'A top-up is in flight — try again shortly.';
    case RemoveCanisterError.notTracked:
      return 'Already not tracked.';
    case RemoveCanisterError.anonymous:
      return "You're not signed in.";
    default:
      return String(err);
  }
}

function suspendErrMsg(err: SuspendCanisterError): string {
  switch (err) {
    case SuspendCanisterError.notTracked:
      return 'Not tracked — could not change its suspension.';
    case SuspendCanisterError.anonymous:
      return "You're not signed in.";
    default:
      return String(err);
  }
}

function rowInvalid(r: Row): boolean {
  if (r.state === 'untracked') return false;
  const min = parseDecimalAmount(r.min, TCYCLES_DECIMALS);
  const top = parseDecimalAmount(r.topup, TCYCLES_DECIMALS);
  return !min || min <= 0n || !top || top <= 0n;
}

function batchErrMsg(err: BatchTrackError): string {
  switch (err.__kind__) {
    case 'anonymous':
      return "You're not signed in.";
    case 'rateLimited':
      return 'The service is busy — try again in a moment.';
    case 'tooManyEntries':
      return `Too many canisters in one request (max ${err.tooManyEntries.max}).`;
    case 'duplicateEntry':
      return `The same canister appears twice: ${fmtPid(err.duplicateEntry.canisterId.toText())}.`;
  }
}

// One entry's outcome as a row error, or null when it landed.
function entryErrMsg(res: BatchTrackEntryResult, id: Principal): string | null {
  switch (res.__kind__) {
    case 'ok':
      return null;
    case 'upsertErr':
      return formatUpsertCanisterError(res.upsertErr, id).message;
    case 'suspendErr':
      return suspendErrMsg(res.suspendErr);
    case 'untrackErr':
      return removeErrMsg(res.untrackErr);
  }
}

// The batch entry for one row, or null when the row has no work to do. Rows
// that are untracked AND were never tracked are pure no-ops — sending them
// would only consume the call's payload budget.
function toEntry(r: Row): BatchTrackEntry | null {
  const canisterId = r.entry.canisterId;
  if (r.state === 'untracked') {
    return r.tracked ? { canisterId, intent: { __kind__: 'untrack', untrack: null } } : null;
  }
  const min = parseDecimalAmount(r.min, TCYCLES_DECIMALS);
  const top = parseDecimalAmount(r.topup, TCYCLES_DECIMALS);
  // Save is gated on rowInvalid, so this is belt-and-braces.
  if (!min || !top) return null;
  const config: CanisterConfig = {
    minCycleBalance: min,
    cycleTopUpAmount: top,
    suspendedUntil: r.suspendedUntil,
    nickname: r.name.trim().slice(0, NICKNAME_MAX) || undefined,
    snsRoot: undefined,
  };
  return {
    canisterId,
    intent: { __kind__: 'track', track: { config, suspended: r.state === 'suspended' } },
  };
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

const STATE_OPTS: Array<{ v: RowState; label: string; color: string }> = [
  { v: 'tracked', label: 'Tracked', color: 'var(--accent-ink)' },
  { v: 'suspended', label: 'Suspended', color: 'var(--warn)' },
  { v: 'untracked', label: 'Untracked', color: 'var(--text-2)' },
];

// Compact single-label pill: shows the active state and cycles
// Tracked → Suspended → Untracked on click.
function StateToggle({ value, onChange }: { value: RowState; onChange: (v: RowState) => void }) {
  const idx = STATE_OPTS.findIndex((o) => o.v === value);
  const cur = STATE_OPTS[idx];
  return (
    <button
      type="button"
      onClick={() => onChange(STATE_OPTS[(idx + 1) % STATE_OPTS.length].v)}
      title="Click to cycle: Tracked → Suspended → Untracked"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 7,
        minWidth: 108,
        padding: '4px 9px',
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        borderRadius: 6,
        border: `1px solid color-mix(in oklch, ${cur.color} 40%, var(--border))`,
        background: `color-mix(in oklch, ${cur.color} 16%, transparent)`,
        color: 'var(--text)',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: cur.color, flex: 'none' }} />
        {cur.label}
      </span>
      <Icon name="refresh" size={10} style={{ color: 'var(--text-2)', flex: 'none' }} />
    </button>
  );
}

export function GroupEditModal({
  identity,
  root,
  actingAs,
  tracked,
  onClose,
  onSaved,
}: {
  identity: Identity;
  // Where the canister list comes from (list_sns_canisters on this root).
  root: Principal;
  // Who the mutations act as: an SNS root (asSns* twins) or null for the
  // signed-in user's own tracking (plain upsert/suspend/remove).
  actingAs: Principal | null;
  tracked: FleetCanister[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { entries, loading, error } = useSnsCanisterList(root);
  const trackedById = useMemo(() => {
    const m = new Map<string, FleetCanister>();
    for (const c of tracked) m.set(c.idText, c);
    return m;
  }, [tracked]);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [phase, setPhase] = useState<'edit' | 'confirm' | 'saving'>('edit');
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    if (!entries) return;
    setRows(
      entries.map((entry) => {
        const idText = entry.canisterId.toText();
        const t = trackedById.get(idText);
        const suspended = !!t?.suspended;
        return {
          entry,
          idText,
          tracked: !!t,
          suspended,
          suspendedUntil: t?.config.suspendedUntil,
          state: !t ? 'untracked' : suspended ? 'suspended' : 'tracked',
          name: t?.config.nickname ?? entry.defaultName,
          min: t ? formatTokenAmount(t.config.minCycleBalance, TCYCLES_DECIMALS) : DEFAULT_MIN_TC,
          topup: t ? formatTokenAmount(t.config.cycleTopUpAmount, TCYCLES_DECIMALS) : DEFAULT_TOPUP_TC,
        };
      }),
    );
  }, [entries, trackedById]);

  const patch = (idText: string, p: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.idText === idText ? { ...r, ...p } : r)) ?? null);

  const toRemove = (rows ?? []).filter((r) => r.state === 'untracked' && r.tracked);
  const toApply = (rows ?? []).filter((r) => r.state !== 'untracked');
  const anyInvalid = (rows ?? []).some(rowInvalid);
  const nothingToDo = toApply.length === 0 && toRemove.length === 0;

  const runSave = async () => {
    if (!rows) return;
    setPhase('saving');
    setTopError(null);
    const backend = createUnicycleBackendActor(identity);

    // Keep rows paired with their entries so the positional mapping back from
    // the response stays honest.
    const paired = rows.map((row) => ({ row, entry: toEntry(row) }));
    const work = paired.filter((p): p is { row: Row; entry: BatchTrackEntry } => p.entry !== null);

    const next: Record<string, RowResult> = {};
    const persisted: Record<string, { tracked: boolean; suspended: boolean }> = {};
    let anyFail = false;

    // Rows with no entry are already in their desired state (untracked and
    // never tracked). They send nothing, but they did succeed.
    for (const { row, entry } of paired) {
      if (entry === null) next[row.idText] = { ok: true };
    }

    for (const batch of chunk(work, MAX_BATCH_ENTRIES)) {
      let results: BatchTrackEntryResult[] | null = null;
      let callError = '';
      try {
        const res = actingAs
          ? await backend.asSnsBatchTrackCanisters(actingAs, batch.map((b) => b.entry))
          : await backend.batchTrackCanisters(batch.map((b) => b.entry));
        if (res.__kind__ === 'ok') results = res.ok;
        else callError = batchErrMsg(res.err);
      } catch (e) {
        callError = e instanceof Error ? e.message : String(e);
      }

      for (const [i, { row }] of batch.entries()) {
        // A whole-call failure means nothing in this chunk ran: every row keeps
        // the state it had, and every row is flagged.
        const res = results?.[i];
        const err = res ? entryErrMsg(res, row.entry.canisterId) : callError;
        if (err === null) {
          next[row.idText] = { ok: true };
          persisted[row.idText] =
            row.state === 'untracked'
              ? { tracked: false, suspended: false }
              : { tracked: true, suspended: row.state === 'suspended' };
        } else {
          anyFail = true;
          next[row.idText] = { ok: false, error: err };
          // A suspendErr means the config DID land and only the suspension
          // toggle failed — record that, or a later Untrack on this row would
          // send nothing and leave it tracked on-chain.
          persisted[row.idText] =
            res?.__kind__ === 'suspendErr'
              ? { tracked: true, suspended: row.suspended }
              : { tracked: row.tracked, suspended: row.suspended };
        }
      }
    }
    setResults(next);
    if (anyFail) {
      // Reflect what actually persisted so a retry re-runs only the failures.
      setRows(
        (prev) =>
          prev?.map((r) => {
            const p = persisted[r.idText];
            return p ? { ...r, tracked: p.tracked, suspended: p.suspended } : r;
          }) ?? null,
      );
      setTopError('Some canisters could not be saved. Review the flagged rows and try again.');
      setPhase('edit');
    } else {
      toast(
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          Saved {toApply.length} canister{toApply.length === 1 ? '' : 's'}
          {toRemove.length ? `, untracked ${toRemove.length}` : ''}
        </>,
      );
      onSaved();
    }
  };

  const onSaveClick = () => {
    if (anyInvalid || nothingToDo || phase === 'saving') return;
    if (toRemove.length > 0 && phase !== 'confirm') {
      setPhase('confirm');
      return;
    }
    void runSave();
  };

  const footer = (
    <>
      <button className="btn" onClick={phase === 'confirm' ? () => setPhase('edit') : onClose}>
        {phase === 'confirm' ? 'Back' : 'Cancel'}
      </button>
      <button className="btn accent" disabled={anyInvalid || nothingToDo || phase === 'saving'} onClick={onSaveClick}>
        {phase === 'saving' ? 'Saving…' : phase === 'confirm' ? 'Confirm & save' : 'Save'}
      </button>
    </>
  );

  return (
    <Modal
      title="Group edit canisters"
      eyebrow="// configure all SNS-controlled canisters"
      onClose={onClose}
      width={720}
      footer={rows && rows.length > 0 ? footer : undefined}
    >
      {loading ? (
        <div className="faint" style={{ padding: '24px 0', textAlign: 'center' }}>Loading SNS canisters…</div>
      ) : error ? (
        <ErrorHint message="Couldn’t load the SNS canister list" detail={error} />
      ) : rows && rows.length === 0 ? (
        <div className="faint" style={{ padding: '24px 0', textAlign: 'center' }}>
          The SNS root reported no canisters to configure.
        </div>
      ) : rows ? (
        <div className="grid" style={{ gap: 14 }}>
          {phase === 'confirm' && (
            <div
              className="panel"
              style={{ background: 'var(--bg-2)', padding: '10px 12px', display: 'flex', gap: 9, alignItems: 'flex-start' }}
            >
              <Icon name="trash" size={14} style={{ color: 'var(--crit)', marginTop: 1, flex: 'none' }} />
              <span className="faint" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
                This will stop tracking {toRemove.length} canister{toRemove.length === 1 ? '' : 's'}:{' '}
                <span className="mono" style={{ color: 'var(--text-1)' }}>
                  {toRemove.map((r) => r.name || fmtPid(r.idText)).join(', ')}
                </span>
                . Confirm to save.
              </span>
            </div>
          )}
          <table className="tbl ge-table">
            <thead>
              <tr>
                <th style={{ width: 124 }}>State</th>
                <th>Name</th>
                <th>Canister</th>
                <th className="num" style={{ width: 130 }}>Min</th>
                <th className="num" style={{ width: 130 }}>Top-up</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const res = results[r.idText];
                const invalid = rowInvalid(r);
                const off = r.state === 'untracked';
                return (
                  <tr key={r.idText}>
                    <td>
                      <StateToggle value={r.state} onChange={(v) => patch(r.idText, { state: v })} />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={r.name}
                        maxLength={NICKNAME_MAX}
                        disabled={off}
                        onChange={(e) => patch(r.idText, { name: e.target.value })}
                        style={{ height: 30 }}
                      />
                    </td>
                    <td className="mono faint" style={{ fontSize: 11 }} title={r.idText}>
                      {fmtPid(r.idText, 6, 4)}
                    </td>
                    <td>
                      <div className="input-suffix">
                        <input
                          className="input mono"
                          value={r.min}
                          disabled={off}
                          inputMode="decimal"
                          onChange={(e) => patch(r.idText, { min: e.target.value })}
                          style={{ height: 30, paddingRight: 30, borderColor: invalid ? 'var(--crit)' : undefined }}
                        />
                        <span className="sfx">TC</span>
                      </div>
                    </td>
                    <td>
                      <div className="input-suffix">
                        <input
                          className="input mono"
                          value={r.topup}
                          disabled={off}
                          inputMode="decimal"
                          onChange={(e) => patch(r.idText, { topup: e.target.value })}
                          style={{ height: 30, paddingRight: 30, borderColor: invalid ? 'var(--crit)' : undefined }}
                        />
                        <span className="sfx">TC</span>
                      </div>
                    </td>
                    <td>
                      {res?.ok === true ? (
                        <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
                      ) : res && res.ok === false ? (
                        <span title={res.error} style={{ display: 'inline-flex' }}>
                          <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="ge-cards">
            {rows.map((r) => {
              const res = results[r.idText];
              const invalid = rowInvalid(r);
              const off = r.state === 'untracked';
              return (
                <div className="ge-card" key={r.idText}>
                  <div className="ge-card-head">
                    <StateToggle value={r.state} onChange={(v) => patch(r.idText, { state: v })} />
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span className="mono faint" title={r.idText}>{fmtPid(r.idText, 6, 4)}</span>
                      {res?.ok === true ? (
                        <Icon name="check" size={14} style={{ color: 'var(--accent-ink)', flex: 'none' }} />
                      ) : res && res.ok === false ? (
                        <span title={res.error} style={{ display: 'inline-flex', flex: 'none' }}>
                          <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <label className="ge-field">
                    <span>Name</span>
                    <input
                      className="input"
                      value={r.name}
                      maxLength={NICKNAME_MAX}
                      disabled={off}
                      onChange={(e) => patch(r.idText, { name: e.target.value })}
                    />
                  </label>
                  <div className="ge-card-nums">
                    <label className="ge-field">
                      <span>Min</span>
                      <div className="input-suffix">
                        <input
                          className="input mono"
                          value={r.min}
                          disabled={off}
                          inputMode="decimal"
                          onChange={(e) => patch(r.idText, { min: e.target.value })}
                          style={{ paddingRight: 32, borderColor: invalid ? 'var(--crit)' : undefined }}
                        />
                        <span className="sfx">TC</span>
                      </div>
                    </label>
                    <label className="ge-field">
                      <span>Top-up</span>
                      <div className="input-suffix">
                        <input
                          className="input mono"
                          value={r.topup}
                          disabled={off}
                          inputMode="decimal"
                          onChange={(e) => patch(r.idText, { topup: e.target.value })}
                          style={{ paddingRight: 32, borderColor: invalid ? 'var(--crit)' : undefined }}
                        />
                        <span className="sfx">TC</span>
                      </div>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          {topError && <ErrorHint message={topError} />}
        </div>
      ) : null}
    </Modal>
  );
}
