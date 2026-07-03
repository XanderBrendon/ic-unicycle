// SNS admin settings tab: propose changes to the three Unicycle config twins
// (deposit auto-top-up, cycle report cadence, drain alerts) via SNS
// governance proposals. Current values come from the backend read-throughs;
// submitting creates a proposal that only takes effect once SNS voters
// approve it.
import { useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import type {
  SnsSetDepositConfigArg,
  SnsSetDrainAlertConfigArg,
  SnsSetReportConfigArg,
} from '../bindings/unicycle_backend/unicycle_backend';
import { useSnsConfigs } from '../sns/useSnsConfigs';
import { useSnsPendingConfigProposals } from '../sns/useSnsPendingProposals';
import { snsProposalUrl } from '../sns/snsInfo';
import { Panel, Field, Modal, ErrorHint } from '../ui/primitives';
import { useToast } from '../ui/toast';
import { parseDecimalAmount, formatTokenAmount } from '../wallet/format';

const ICP_DECIMALS = 8;

const parseNat = (s: string): bigint | null => (/^\d+$/.test(s.trim()) ? BigInt(s.trim()) : null);
const e8sToInput = (raw: bigint): string => formatTokenAmount(raw, ICP_DECIMALS).replace(/,/g, '');

// Display helpers — keep wording in sync with lib/SnsPropose.mo so the dialog
// matches the proposal text voters will read.
const icpDisp = (v: bigint) => `${formatTokenAmount(v, ICP_DECIMALS)} ICP`;
const minDisp = (v: bigint) => (v === 0n ? 'disabled' : icpDisp(v));
const pctDisp = (v: bigint) => (v === 0n ? 'disabled' : `${v.toString()}%`);
const daysDisp = (v: bigint) => (v === 0n ? 'disabled' : `${v.toString()} day(s)`);
const cooldownDisp = (v: bigint) => (v === 0n ? 'none' : `${v.toString()} day(s)`);

interface DiffRow {
  label: string;
  from: string; // "not set" when no current config
  to: string;
  changed: boolean;
}

type SubmitResult = { __kind__: 'ok'; ok: bigint } | { __kind__: 'err'; err: string };

function ConfirmProposalModal({ domainTitle, rows, submitting, error, onConfirm, onClose }: {
  domainTitle: string;
  rows: DiffRow[];
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title={`Propose: ${domainTitle}`}
      eyebrow="SNS proposal"
      onClose={submitting ? undefined : onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button className="btn accent" onClick={onConfirm} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Create proposal'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        This creates a proposal on the SNS governance canister. The configuration changes only if SNS
        voters approve it. The proposal is submitted through the SNS's Unicycle proposal neuron — which
        bears the rejection fee if voters reject it — and names you as the submitting admin.
      </p>
      <div className="vstack" style={{ gap: 4, margin: '10px 0' }}>
        {rows.map((r) => (
          <div key={r.label} className="mono" style={{ fontSize: 12, opacity: r.changed ? 1 : 0.55 }}>
            {r.label}: {r.changed ? `${r.from} → ${r.to}` : `${r.to} (unchanged)`}
          </div>
        ))}
      </div>
      {error && <ErrorHint message="Proposal submission failed" detail={error} />}
    </Modal>
  );
}

function PendingNote({ rootText, id }: { rootText: string; id: bigint | undefined }) {
  if (id === undefined) return null;
  return (
    <div className="faint" style={{ fontSize: 12, marginBottom: 8 }}>
      Proposal #{id.toString()} pending —{' '}
      <a href={snsProposalUrl(rootText, id)} target="_blank" rel="noreferrer">
        view on dashboard
      </a>
    </div>
  );
}

function DepositSection({ identity, root, current, pendingId, onProposed }: {
  identity: Identity;
  root: Principal;
  current: SnsSetDepositConfigArg | null | undefined;
  pendingId: bigint | undefined;
  onProposed: () => void;
}) {
  const toast = useToast();
  const [min, setMin] = useState('0');
  const [amount, setAmount] = useState('0');
  const [includeReport, setIncludeReport] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (current === undefined) return;
    setMin(e8sToInput(current?.minBalanceE8s ?? 0n));
    setAmount(e8sToInput(current?.depositAmountE8s ?? 0n));
    setIncludeReport(current?.includeReport ?? false);
  }, [current]);

  if (current === undefined) return null; // parent shows a single loading gate

  const minRaw = parseDecimalAmount(min, ICP_DECIMALS);
  const amountRaw = parseDecimalAmount(amount, ICP_DECIMALS);
  const parseError = minRaw === null || amountRaw === null ? 'Enter valid ICP amounts' : null;
  const validationError =
    minRaw !== null && amountRaw !== null && minRaw > 0n && amountRaw === 0n
      ? 'Deposit amount must be greater than 0 when a min balance is set'
      : null;
  const changed =
    minRaw !== null &&
    amountRaw !== null &&
    (minRaw !== (current?.minBalanceE8s ?? 0n) ||
      amountRaw !== (current?.depositAmountE8s ?? 0n) ||
      includeReport !== (current?.includeReport ?? false));

  const rows: DiffRow[] = minRaw === null || amountRaw === null ? [] : [
    {
      label: 'min balance',
      from: current ? minDisp(current.minBalanceE8s) : 'not set',
      to: minDisp(minRaw),
      changed: !current || current.minBalanceE8s !== minRaw,
    },
    {
      label: 'deposit amount',
      from: current ? icpDisp(current.depositAmountE8s) : 'not set',
      to: icpDisp(amountRaw),
      changed: !current || current.depositAmountE8s !== amountRaw,
    },
    {
      label: 'cycle usage report',
      from: current ? (current.includeReport ? 'included' : 'omitted') : 'not set',
      to: includeReport ? 'included' : 'omitted',
      changed: !current || current.includeReport !== includeReport,
    },
  ];

  const submit = async () => {
    if (minRaw === null || amountRaw === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res: SubmitResult = await createUnicycleBackendActor(identity).asSnsProposeSetDepositConfig(root, {
        minBalanceE8s: minRaw,
        depositAmountE8s: amountRaw,
        includeReport,
      });
      if (res.__kind__ === 'ok') {
        toast(
          <>
            Proposal{' '}
            <a href={snsProposalUrl(root.toText(), res.ok)} target="_blank" rel="noreferrer">
              #{res.ok.toString()}
            </a>{' '}
            submitted — SNS voters must approve before the change takes effect.
          </>,
        );
        setConfirming(false);
        onProposed();
      } else {
        setSubmitError(res.err);
      }
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel title="Deposit auto-top-up" eyebrow="// treasury → Unicycle ICP deposits">
      <PendingNote rootText={root.toText()} id={pendingId} />
      <Field label="Min balance (ICP)" hint="Top up the deposit when it falls below this. 0 disables auto-deposit." error={parseError ?? validationError}>
        <input className="input" value={min} onChange={(e) => setMin(e.target.value)} />
      </Field>
      <Field label="Deposit amount (ICP)" hint="ICP transferred from the SNS treasury per top-up.">
        <input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Include cycle usage report in the top-up proposal">
        <input type="checkbox" checked={includeReport} onChange={(e) => setIncludeReport(e.target.checked)} />
      </Field>
      <button
        className="btn accent sm"
        disabled={!changed || parseError !== null || validationError !== null}
        onClick={() => {
          setSubmitError(null);
          setConfirming(true);
        }}
      >
        Propose change
      </button>
      {confirming && (
        <ConfirmProposalModal
          domainTitle="deposit auto-top-up config"
          rows={rows}
          submitting={submitting}
          error={submitError}
          onConfirm={submit}
          onClose={() => setConfirming(false)}
        />
      )}
    </Panel>
  );
}

function ReportSection({ identity, root, current, pendingId, onProposed }: {
  identity: Identity;
  root: Principal;
  current: SnsSetReportConfigArg | null | undefined;
  pendingId: bigint | undefined;
  onProposed: () => void;
}) {
  const toast = useToast();
  const [cadence, setCadence] = useState('0');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (current === undefined) return;
    setCadence((current?.cadenceDays ?? 0n).toString());
  }, [current]);

  if (current === undefined) return null; // parent shows a single loading gate

  const cadenceRaw = parseNat(cadence);
  const parseError = cadenceRaw === null ? 'Enter a whole number of days' : null;
  const changed = cadenceRaw !== null && cadenceRaw !== (current?.cadenceDays ?? 0n);

  const rows: DiffRow[] = cadenceRaw === null ? [] : [
    {
      label: 'report cadence',
      from: current ? daysDisp(current.cadenceDays) : 'not set',
      to: daysDisp(cadenceRaw),
      changed: !current || current.cadenceDays !== cadenceRaw,
    },
  ];

  const submit = async () => {
    if (cadenceRaw === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res: SubmitResult = await createUnicycleBackendActor(identity).asSnsProposeSetReportConfig(root, {
        cadenceDays: cadenceRaw,
      });
      if (res.__kind__ === 'ok') {
        toast(
          <>
            Proposal{' '}
            <a href={snsProposalUrl(root.toText(), res.ok)} target="_blank" rel="noreferrer">
              #{res.ok.toString()}
            </a>{' '}
            submitted — SNS voters must approve before the change takes effect.
          </>,
        );
        setConfirming(false);
        onProposed();
      } else {
        setSubmitError(res.err);
      }
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel title="Cycle report" eyebrow="// recurring usage-report proposals">
      <PendingNote rootText={root.toText()} id={pendingId} />
      <Field label="Report cadence (days)" hint="Days between recurring cycle-usage report proposals. 0 disables." error={parseError}>
        <input className="input" value={cadence} onChange={(e) => setCadence(e.target.value)} />
      </Field>
      <button
        className="btn accent sm"
        disabled={!changed || parseError !== null}
        onClick={() => {
          setSubmitError(null);
          setConfirming(true);
        }}
      >
        Propose change
      </button>
      {confirming && (
        <ConfirmProposalModal
          domainTitle="cycle report cadence"
          rows={rows}
          submitting={submitting}
          error={submitError}
          onConfirm={submit}
          onClose={() => setConfirming(false)}
        />
      )}
    </Panel>
  );
}

function DrainAlertSection({ identity, root, current, pendingId, onProposed }: {
  identity: Identity;
  root: Principal;
  current: SnsSetDrainAlertConfigArg | null | undefined;
  pendingId: bigint | undefined;
  onProposed: () => void;
}) {
  const toast = useToast();
  const [weekly, setWeekly] = useState('0');
  const [monthly, setMonthly] = useState('0');
  const [dayOverDay, setDayOverDay] = useState('0');
  const [cooldown, setCooldown] = useState('0');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (current === undefined) return;
    setWeekly((current?.weeklyAvgFactorPct ?? 0n).toString());
    setMonthly((current?.monthlyAvgFactorPct ?? 0n).toString());
    setDayOverDay((current?.dayOverDayFactorPct ?? 0n).toString());
    setCooldown((current?.alertCooldownDays ?? 0n).toString());
  }, [current]);

  if (current === undefined) return null; // parent shows a single loading gate

  const weeklyRaw = parseNat(weekly);
  const monthlyRaw = parseNat(monthly);
  const dayOverDayRaw = parseNat(dayOverDay);
  const cooldownRaw = parseNat(cooldown);
  const parseError =
    weeklyRaw === null || monthlyRaw === null || dayOverDayRaw === null || cooldownRaw === null
      ? 'Enter whole numbers'
      : null;
  const changed =
    weeklyRaw !== null &&
    monthlyRaw !== null &&
    dayOverDayRaw !== null &&
    cooldownRaw !== null &&
    (weeklyRaw !== (current?.weeklyAvgFactorPct ?? 0n) ||
      monthlyRaw !== (current?.monthlyAvgFactorPct ?? 0n) ||
      dayOverDayRaw !== (current?.dayOverDayFactorPct ?? 0n) ||
      cooldownRaw !== (current?.alertCooldownDays ?? 0n));

  const rows: DiffRow[] =
    weeklyRaw === null || monthlyRaw === null || dayOverDayRaw === null || cooldownRaw === null
      ? []
      : [
          {
            label: 'weekly avg threshold',
            from: current ? pctDisp(current.weeklyAvgFactorPct) : 'not set',
            to: pctDisp(weeklyRaw),
            changed: !current || current.weeklyAvgFactorPct !== weeklyRaw,
          },
          {
            label: 'monthly avg threshold',
            from: current ? pctDisp(current.monthlyAvgFactorPct) : 'not set',
            to: pctDisp(monthlyRaw),
            changed: !current || current.monthlyAvgFactorPct !== monthlyRaw,
          },
          {
            label: 'day-over-day threshold',
            from: current ? pctDisp(current.dayOverDayFactorPct) : 'not set',
            to: pctDisp(dayOverDayRaw),
            changed: !current || current.dayOverDayFactorPct !== dayOverDayRaw,
          },
          {
            label: 'alert cooldown',
            from: current ? cooldownDisp(current.alertCooldownDays) : 'not set',
            to: cooldownDisp(cooldownRaw),
            changed: !current || current.alertCooldownDays !== cooldownRaw,
          },
        ];

  const submit = async () => {
    if (weeklyRaw === null || monthlyRaw === null || dayOverDayRaw === null || cooldownRaw === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res: SubmitResult = await createUnicycleBackendActor(identity).asSnsProposeSetDrainAlertConfig(root, {
        weeklyAvgFactorPct: weeklyRaw,
        monthlyAvgFactorPct: monthlyRaw,
        dayOverDayFactorPct: dayOverDayRaw,
        alertCooldownDays: cooldownRaw,
      });
      if (res.__kind__ === 'ok') {
        toast(
          <>
            Proposal{' '}
            <a href={snsProposalUrl(root.toText(), res.ok)} target="_blank" rel="noreferrer">
              #{res.ok.toString()}
            </a>{' '}
            submitted — SNS voters must approve before the change takes effect.
          </>,
        );
        setConfirming(false);
        onProposed();
      } else {
        setSubmitError(res.err);
      }
    } catch (e: unknown) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Panel title="Drain alerts" eyebrow="// unusual burn detection">
      <PendingNote rootText={root.toText()} id={pendingId} />
      <Field
        label="Weekly avg threshold (%)"
        hint="Alert when a day's burn exceeds this % of the 7-day average. 0 disables."
        error={parseError}
      >
        <input className="input" value={weekly} onChange={(e) => setWeekly(e.target.value)} />
      </Field>
      <Field
        label="Monthly avg threshold (%)"
        hint="Alert when a day's burn exceeds this % of the 30-day average. 0 disables."
      >
        <input className="input" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
      </Field>
      <Field label="Day-over-day threshold (%)" hint="Alert when a day's burn exceeds this % of the prior day. 0 disables.">
        <input className="input" value={dayOverDay} onChange={(e) => setDayOverDay(e.target.value)} />
      </Field>
      <Field label="Alert cooldown (days)" hint="Minimum days between alert proposals. 0 = no cooldown.">
        <input className="input" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
      </Field>
      <button
        className="btn accent sm"
        disabled={!changed || parseError !== null}
        onClick={() => {
          setSubmitError(null);
          setConfirming(true);
        }}
      >
        Propose change
      </button>
      {confirming && (
        <ConfirmProposalModal
          domainTitle="cycle drain alert config"
          rows={rows}
          submitting={submitting}
          error={submitError}
          onConfirm={submit}
          onClose={() => setConfirming(false)}
        />
      )}
    </Panel>
  );
}

export function SnsSettings({ identity, root, governance }: {
  identity: Identity;
  root: Principal;
  governance: Principal | null;
}) {
  const configs = useSnsConfigs(identity, governance);
  const pending = useSnsPendingConfigProposals(governance);

  if (!governance) {
    return (
      <ErrorHint
        message="SNS metadata unavailable"
        detail="The governance canister for this SNS could not be resolved. Use the refresh button in the header and try again."
      />
    );
  }
  if (configs.error) {
    return <ErrorHint message="Could not load current config values" detail={configs.error} />;
  }
  if (configs.loading && configs.deposit === undefined) {
    return <div className="faint" style={{ padding: 20 }}>Loading current configuration…</div>;
  }

  const onProposed = () => {
    pending.refresh();
  };

  return (
    <div className="fade-up grid" style={{ gap: 'var(--gap)' }}>
      {pending.error && (
        <ErrorHint message="Could not check for pending proposals" detail={pending.error} />
      )}
      <DepositSection identity={identity} root={root} current={configs.deposit} pendingId={pending.pending.deposit} onProposed={onProposed} />
      <ReportSection identity={identity} root={root} current={configs.report} pendingId={pending.pending.report} onProposed={onProposed} />
      <DrainAlertSection identity={identity} root={root} current={configs.drainAlert} pendingId={pending.pending.drainAlert} onProposed={onProposed} />
    </div>
  );
}
