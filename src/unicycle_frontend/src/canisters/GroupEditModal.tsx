// Bulk-configure every SNS-controlled canister at once. Lists the SNS root's
// canisters (list_sns_canisters) in an editable table seeded from the already-
// tracked fleet; Save reconciles the checked set — checked rows are upserted,
// unchecked-but-previously-tracked rows are untracked.
import { useEffect, useMemo, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { Modal, ErrorHint } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtPid, TCYCLES_DECIMALS } from '../ui/format';
import { useToast } from '../ui/toast';
import { parseDecimalAmount, formatTokenAmount } from '../wallet/format';
import { createUnicycleBackendActor } from '../auth/actor';
import { RemoveCanisterError, type CanisterConfig } from '../bindings/unicycle_backend/unicycle_backend';
import { formatUpsertCanisterError } from './useUpsertCanister';
import { useSnsCanisterList, type SnsCanisterEntry } from '../sns/snsCanisterList';
import type { FleetCanister } from './useFleet';

const NICKNAME_MAX = 48;
const DEFAULT_MIN_TC = '1';
const DEFAULT_TOPUP_TC = '0.5';

interface Row {
  entry: SnsCanisterEntry;
  idText: string;
  tracked: boolean; // tracked at the moment of (re)seeding
  suspendedUntil: bigint | undefined; // preserved through upsert
  checked: boolean;
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

function rowInvalid(r: Row): boolean {
  if (!r.checked) return false;
  const min = parseDecimalAmount(r.min, TCYCLES_DECIMALS);
  const top = parseDecimalAmount(r.topup, TCYCLES_DECIMALS);
  return !min || min <= 0n || !top || top <= 0n;
}

export function GroupEditModal({
  identity,
  root,
  tracked,
  onClose,
  onSaved,
}: {
  identity: Identity;
  root: Principal;
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
        return {
          entry,
          idText,
          tracked: !!t,
          suspendedUntil: t?.config.suspendedUntil,
          checked: !!t,
          name: t?.config.nickname ?? entry.defaultName,
          min: t ? formatTokenAmount(t.config.minCycleBalance, TCYCLES_DECIMALS) : DEFAULT_MIN_TC,
          topup: t ? formatTokenAmount(t.config.cycleTopUpAmount, TCYCLES_DECIMALS) : DEFAULT_TOPUP_TC,
        };
      }),
    );
  }, [entries, trackedById]);

  const patch = (idText: string, p: Partial<Row>) =>
    setRows((prev) => prev?.map((r) => (r.idText === idText ? { ...r, ...p } : r)) ?? null);

  const toRemove = (rows ?? []).filter((r) => !r.checked && r.tracked);
  const toUpsert = (rows ?? []).filter((r) => r.checked);
  const anyInvalid = (rows ?? []).some(rowInvalid);
  const nothingToDo = toUpsert.length === 0 && toRemove.length === 0;

  const runSave = async () => {
    if (!rows) return;
    setPhase('saving');
    setTopError(null);
    const backend = createUnicycleBackendActor(identity);
    const next: Record<string, RowResult> = {};
    let anyFail = false;
    for (const r of rows) {
      if (r.checked) {
        const min = parseDecimalAmount(r.min, TCYCLES_DECIMALS);
        const top = parseDecimalAmount(r.topup, TCYCLES_DECIMALS);
        if (!min || !top) continue; // guarded by anyInvalid; belt-and-suspenders
        const label = r.name.trim().slice(0, NICKNAME_MAX);
        const config: CanisterConfig = {
          minCycleBalance: min,
          cycleTopUpAmount: top,
          suspendedUntil: r.suspendedUntil,
          nickname: label || undefined,
        };
        try {
          const res = await backend.asSnsUpsertCanister(root, r.entry.canisterId, config);
          if (res.__kind__ === 'ok') next[r.idText] = { ok: true };
          else {
            next[r.idText] = { ok: false, error: formatUpsertCanisterError(res.err, r.entry.canisterId).message };
            anyFail = true;
          }
        } catch (e) {
          next[r.idText] = { ok: false, error: e instanceof Error ? e.message : String(e) };
          anyFail = true;
        }
      } else if (r.tracked) {
        try {
          const res = await backend.asSnsRemoveCanister(root, r.entry.canisterId);
          if (res.__kind__ === 'ok') next[r.idText] = { ok: true };
          else {
            next[r.idText] = { ok: false, error: removeErrMsg(res.err) };
            anyFail = true;
          }
        } catch (e) {
          next[r.idText] = { ok: false, error: e instanceof Error ? e.message : String(e) };
          anyFail = true;
        }
      }
    }
    setResults(next);
    if (anyFail) {
      // Reflect what actually persisted so a retry converges: succeeded upserts
      // are now tracked; succeeded removes are no longer tracked (and, being
      // unchecked, become no-ops on the next Save).
      setRows(
        (prev) =>
          prev?.map((r) => {
            const res = next[r.idText];
            if (!res || !res.ok) return r;
            return { ...r, tracked: r.checked };
          }) ?? null,
      );
      setTopError('Some canisters could not be saved. Review the flagged rows and try again.');
      setPhase('edit');
    } else {
      toast(
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          Saved {toUpsert.length} canister{toUpsert.length === 1 ? '' : 's'}
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
      width={760}
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
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}>Track</th>
                <th>Name</th>
                <th>Canister</th>
                <th className="num" style={{ width: 150 }}>Min</th>
                <th className="num" style={{ width: 150 }}>Top-up</th>
                <th style={{ width: 28 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const res = results[r.idText];
                const invalid = rowInvalid(r);
                return (
                  <tr key={r.idText}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.checked}
                        onChange={(e) => patch(r.idText, { checked: e.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={r.name}
                        maxLength={NICKNAME_MAX}
                        disabled={!r.checked}
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
                          disabled={!r.checked}
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
                          disabled={!r.checked}
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
          {topError && <ErrorHint message={topError} />}
        </div>
      ) : null}
    </Modal>
  );
}
