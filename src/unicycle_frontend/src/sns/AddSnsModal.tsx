// Pick SNSes to help fund from the local wallet. Lists every SNS (dashboard
// SNS API) with a search box; already-tracked roots are marked and disabled.
// Confirm calls addTrackedSns per selection sequentially, keeping successes
// applied and flagging failures inline. A manual root-id input covers the
// directory being unreachable — the backend validates against the on-chain
// registry either way.
import { useMemo, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { Modal, ErrorHint } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtPid } from '../ui/format';
import { useToast } from '../ui/toast';
import { createUnicycleBackendActor } from '../auth/actor';
import type { AddTrackedSnsError } from '../bindings/unicycle_backend/unicycle_backend';
import { useSnsDirectory } from './snsDirectory';

function addErrMsg(err: AddTrackedSnsError): string {
  switch (err.__kind__) {
    case 'anonymous':
      return "You're not signed in.";
    case 'notAnSnsRoot':
      return 'Not a recognized SNS root canister.';
    case 'alreadyTracked':
      return 'Already tracked.';
    case 'limitReached':
      return `You can track at most ${err.limitReached.maxTrackedSns.toString()} SNSes.`;
    default: {
      const _exhaustive: never = err;
      return `Unknown error: ${JSON.stringify(_exhaustive)}`;
    }
  }
}

export function AddSnsModal({
  identity,
  trackedRootIds,
  onClose,
  onAdded,
}: {
  identity: Identity;
  trackedRootIds: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const { entries, loading, error, stale, refresh } = useSnsDirectory();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState('');
  const [saving, setSaving] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const tracked = useMemo(() => new Set(trackedRootIds), [trackedRootIds]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const all = entries ?? [];
    return query
      ? all.filter((e) => e.name.toLowerCase().includes(query) || e.rootId.includes(query))
      : all;
  }, [entries, q]);

  const manualId = manual.trim();
  const manualValid = useMemo(() => {
    if (!manualId) return false;
    try {
      Principal.fromText(manualId);
      return true;
    } catch {
      return false;
    }
  }, [manualId]);

  const toggle = (rootId: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId);
      else next.add(rootId);
      return next;
    });

  const targets = useMemo(() => {
    const ids = [...picked];
    if (manualValid && !picked.has(manualId) && !tracked.has(manualId)) ids.push(manualId);
    return ids;
  }, [picked, manualValid, manualId, tracked]);

  const save = async () => {
    if (targets.length === 0 || saving) return;
    setSaving(true);
    setRowErrors({});
    const backend = createUnicycleBackendActor(identity);
    const failed: Record<string, string> = {};
    let added = 0;
    for (const rootId of targets) {
      try {
        const res = await backend.addTrackedSns(Principal.fromText(rootId));
        if (res.__kind__ === 'ok') added += 1;
        else failed[rootId] = addErrMsg(res.err);
      } catch (e) {
        failed[rootId] = e instanceof Error ? e.message : String(e);
      }
    }
    setSaving(false);
    if (added > 0) {
      toast(
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          Tracking {added} SNS{added === 1 ? '' : 'es'}
        </>,
      );
      onAdded();
    }
    if (Object.keys(failed).length > 0) {
      setRowErrors(failed);
      setPicked(new Set(Object.keys(failed).filter((id) => id !== manualId)));
    } else if (added > 0) {
      onClose();
    }
  };

  return (
    <Modal
      title="Track an SNS"
      eyebrow="// help fund a DAO's canisters from your wallet"
      onClose={onClose}
      width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn accent" disabled={targets.length === 0 || saving} onClick={() => void save()}>
            {saving ? 'Adding…' : `Track ${targets.length || ''} SNS${targets.length === 1 ? '' : 'es'}`}
          </button>
        </>
      }
    >
      <div className="grid" style={{ gap: 12 }}>
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.55, margin: 0 }}>
          Tracking an SNS adds a page for it where you pick which of its canisters to keep
          funded — paid from your own deposit, no proposals involved.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="input-suffix" style={{ flex: 1 }}>
            <input
              className="input"
              placeholder="search by name or root id…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ height: 32, paddingRight: 28 }}
            />
            <Icon name="search" size={13} className="sfx" style={{ pointerEvents: 'none' }} />
          </div>
          <button className="btn ghost sm" onClick={refresh} disabled={loading} title="Refresh the SNS list">
            <Icon name="refresh" size={14} />
          </button>
        </div>
        {stale && <ErrorHint message="Couldn't refresh the SNS list — showing a cached copy." detail={error ?? undefined} />}
        {error && !entries && (
          <ErrorHint message="Couldn't load the SNS list — paste a root canister id below." detail={error} />
        )}
        {loading && !entries ? (
          <div className="faint" style={{ padding: '18px 0', textAlign: 'center' }}>Loading SNSes…</div>
        ) : entries && (
          <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {list.length === 0 ? (
              <div className="faint" style={{ padding: '18px 0', textAlign: 'center' }}>No SNS matches your search.</div>
            ) : (
              list.map((e) => {
                const isTracked = tracked.has(e.rootId);
                const isPicked = picked.has(e.rootId);
                const rowError = rowErrors[e.rootId];
                return (
                  <label
                    key={e.rootId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 12px',
                      borderBottom: '1px solid var(--border)',
                      cursor: isTracked ? 'default' : 'pointer',
                      opacity: isTracked ? 0.55 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isTracked || isPicked}
                      disabled={isTracked || saving}
                      onChange={() => toggle(e.rootId)}
                    />
                    <span style={{ fontWeight: 600, fontSize: 12.5 }}>{e.name}</span>
                    <span className="mono faint" style={{ fontSize: 10.5 }}>{fmtPid(e.rootId, 6, 4)}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11 }}>
                      {isTracked ? <span className="faint">tracked</span> : rowError ? (
                        <span title={rowError} style={{ color: 'var(--crit)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="x" size={12} />
                          {rowError}
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        )}
        <div>
          <div className="faint" style={{ fontSize: 11, marginBottom: 4 }}>Or paste an SNS root canister id</div>
          <input
            className="input mono"
            placeholder="e.g. ibahq-taaaa-aaaaq-aadna-cai"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            style={{ height: 32, borderColor: manualId && !manualValid ? 'var(--crit)' : undefined }}
          />
          {rowErrors[manualId] && <ErrorHint message={rowErrors[manualId]} />}
        </div>
      </div>
    </Modal>
  );
}
