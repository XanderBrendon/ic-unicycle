// Add / Edit canister modals, wired to useUpsertCanister. Ports of the
// prototype's AddCanisterModal + EditCanisterModal. Amounts are entered as
// decimal TC and converted to bigint smallest-units (12 decimals).
import { useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { Modal, Field, ErrorHint } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtPid, TCYCLES_DECIMALS } from '../ui/format';
import { useToast } from '../ui/toast';
import { parseDecimalAmount, formatTokenAmount } from '../wallet/format';
import { useUpsertCanister } from './useUpsertCanister';
import { useServiceConfig } from '../admin/useServiceConfig';
import type { CanisterConfig } from '../bindings/unicycle_backend/unicycle_backend';

const NICKNAME_MAX = 48;

// Prefilled when adding a canister so the form is submittable without typing.
const DEFAULT_MIN_TC = '1';
const DEFAULT_TOPUP_TC = '0.5';

function tryPrincipal(text: string): Principal | null {
  try {
    return Principal.fromText(text.trim());
  } catch {
    return null;
  }
}

export interface AddCanisterModalProps {
  identity: Identity;
  actingAs: Principal | null;
  onClose: () => void;
  onAdded: () => void;
}

export function AddCanisterModal({ identity, actingAs, onClose, onAdded }: AddCanisterModalProps) {
  const toast = useToast();
  const { upsertCanister, status } = useUpsertCanister(identity, undefined, actingAs);
  const { blackhole } = useServiceConfig(identity);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [min, setMin] = useState(DEFAULT_MIN_TC);
  const [topup, setTopup] = useState(DEFAULT_TOPUP_TC);

  const canisterId = tryPrincipal(id);
  const minRaw = parseDecimalAmount(min, TCYCLES_DECIMALS);
  const topupRaw = parseDecimalAmount(topup, TCYCLES_DECIMALS);
  const valid = !!canisterId && !!minRaw && minRaw > 0n && !!topupRaw && topupRaw > 0n;
  const submitting = status.kind === 'submitting';

  const submit = async () => {
    if (!valid || !canisterId || !minRaw || !topupRaw) return;
    const label = name.trim().slice(0, NICKNAME_MAX);
    const res = await upsertCanister(canisterId, {
      minCycleBalance: minRaw,
      cycleTopUpAmount: topupRaw,
      suspendedUntil: undefined,
      nickname: label || undefined,
      snsRoot: undefined,
    });
    if (res.ok) {
      toast(
        <>
          <Icon name="bolt" size={14} style={{ color: 'var(--accent-ink)' }} />
          Now tracking <b>{label || fmtPid(canisterId.toString())}</b>
        </>,
      );
      onAdded();
    }
  };

  return (
    <Modal
      title="Track a canister"
      eyebrow="// add to fleet"
      onClose={onClose}
      width={500}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn accent" disabled={!valid || submitting} onClick={submit}>
            <Icon name="plus" size={14} />
            {submitting ? 'Tracking…' : 'Track'}
          </button>
        </>
      }
    >
      <div className="grid" style={{ gap: 16 }}>
        <div
          className="panel"
          style={{ background: 'var(--bg-2)', padding: '10px 12px', display: 'flex', gap: 9, alignItems: 'flex-start' }}
        >
          <Icon name="shield" size={14} style={{ color: 'var(--text-2)', marginTop: 1, flex: 'none' }} />
          <span className="faint" style={{ fontSize: 11.5, lineHeight: 1.55 }}>
            Tracking requires the blackhole canister{' '}
            <span className="mono" style={{ color: 'var(--text-1)' }}>
              {blackhole ? fmtPid(blackhole.toString(), 6, 4) : '…'}
            </span>{' '}
            to be a controller of your canister so Unicycle can read its cycle balance.
          </span>
        </div>
        <Field label="Canister id">
          <input
            className="input mono"
            placeholder="aaaaa-bbbbb-ccccc-ddddd-cai"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </Field>
        <Field label="Label" hint="Optional — a friendly name for your fleet.">
          <input
            className="input"
            placeholder="e.g. asset_canister"
            value={name}
            maxLength={NICKNAME_MAX}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Min cycle balance">
            <div className="input-suffix">
              <input
                className="input mono"
                placeholder={DEFAULT_MIN_TC}
                value={min}
                onChange={(e) => setMin(e.target.value)}
                inputMode="decimal"
              />
              <span className="sfx">TC</span>
            </div>
          </Field>
          <Field label="Top-up amount">
            <div className="input-suffix">
              <input
                className="input mono"
                placeholder={DEFAULT_TOPUP_TC}
                value={topup}
                onChange={(e) => setTopup(e.target.value)}
                inputMode="decimal"
              />
              <span className="sfx">TC</span>
            </div>
          </Field>
        </div>
        {status.kind === 'error' && <ErrorHint message={status.message} detail={status.detail} command={status.command} />}
      </div>
    </Modal>
  );
}

export interface EditCanisterModalProps {
  identity: Identity;
  actingAs: Principal | null;
  canisterId: Principal;
  config: CanisterConfig;
  onClose: () => void;
  onSaved: () => void;
}

export function EditCanisterModal({ identity, actingAs, canisterId, config, onClose, onSaved }: EditCanisterModalProps) {
  const toast = useToast();
  const { upsertCanister, status } = useUpsertCanister(identity, undefined, actingAs);
  const [name, setName] = useState(config.nickname ?? '');
  const [min, setMin] = useState(formatTokenAmount(config.minCycleBalance, TCYCLES_DECIMALS));
  const [topup, setTopup] = useState(formatTokenAmount(config.cycleTopUpAmount, TCYCLES_DECIMALS));

  const minRaw = parseDecimalAmount(min, TCYCLES_DECIMALS);
  const topupRaw = parseDecimalAmount(topup, TCYCLES_DECIMALS);
  const valid = !!minRaw && minRaw > 0n && !!topupRaw && topupRaw > 0n;
  const submitting = status.kind === 'submitting';

  const save = async () => {
    if (!valid || !minRaw || !topupRaw) return;
    const label = name.trim().slice(0, NICKNAME_MAX);
    const res = await upsertCanister(canisterId, {
      minCycleBalance: minRaw,
      cycleTopUpAmount: topupRaw,
      // Server preserves the prior suspension regardless; pass it through.
      suspendedUntil: config.suspendedUntil,
      nickname: label || undefined,
      snsRoot: undefined,
    });
    if (res.ok) {
      toast(
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          Updated <b>{label || fmtPid(canisterId.toString())}</b>
        </>,
      );
      onSaved();
    }
  };

  return (
    <Modal
      title="Edit canister"
      eyebrow={`// ${fmtPid(canisterId.toString())}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn accent" disabled={!valid || submitting} onClick={save}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid" style={{ gap: 16 }}>
        <Field label="Label" hint="A friendly name for this canister — for your own reference.">
          <input
            className="input"
            value={name}
            maxLength={NICKNAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. asset_canister"
          />
        </Field>
        <Field label="Min cycle balance" hint="Trigger a top-up when the balance falls below this.">
          <div className="input-suffix">
            <input className="input mono" value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" />
            <span className="sfx">TC</span>
          </div>
        </Field>
        <Field label="Top-up amount" hint="How many cycles to add on each refill.">
          <div className="input-suffix">
            <input className="input mono" value={topup} onChange={(e) => setTopup(e.target.value)} inputMode="decimal" />
            <span className="sfx">TC</span>
          </div>
        </Field>
        {status.kind === 'error' && <ErrorHint message={status.message} detail={status.detail} command={status.command} />}
      </div>
    </Modal>
  );
}
