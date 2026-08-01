// Classify an SNS's governance proposals down to the ones that concern
// Unicycle, and render each as a one-line description a voter can read without
// opening the payload.
//
// Everything here is pure: no React, no network. The caller supplies the
// context (`UnicycleContext`) that identifying a Unicycle proposal needs.

import { IDL } from '@icp-sdk/core/candid';
import type { Principal } from '@icp-sdk/core/principal';
import type { SnsGovernanceDid } from '@icp-sdk/canisters/sns';
import { idlFactory } from '../bindings/unicycle_backend/declarations/unicycle_backend.did';
import type {
  SnsGrantAdminArg,
  SnsRecordCyclesArg,
  SnsRemoveCanisterArg,
  SnsRevokeAdminArg,
  SnsSetDepositConfigArg,
  SnsSetDrainAlertConfigArg,
  SnsSetProposalNeuronArg,
  SnsSetReportConfigArg,
  SnsSetSuspendedArg,
  SnsSetWithdrawDestinationArg,
  SnsUpsertCanisterArg,
  SnsWithdrawArg,
} from '../bindings/unicycle_backend/declarations/unicycle_backend.did';
import { fmtPid, fmtTC } from '../ui/format';

// Types come from `declarations/`, not the `unicycle_backend` wrapper: these
// records are decoded straight out of a candid blob, so they carry the raw
// candid shapes (`[] | [T]` for opt, `{ ICP: null }` for variants) rather than
// the wrapper's transformed ones.

export type ProposalOutcome = 'open' | 'adopted' | 'executed' | 'rejected' | 'failed';

export interface UnicycleProposal {
  id: bigint;
  description: string;
  outcome: ProposalOutcome;
  createdMs: number;
  // Submitted through the neuron the SNS configured for Unicycle.
  byUnicycle: boolean;
}

export interface UnicycleContext {
  // Unicycle generic-function id → the backend method it targets. Built from
  // `list_nervous_system_functions`, keeping only functions whose target is
  // the Unicycle backend — the same self-discovery the backend itself uses.
  functionMethods: Map<bigint, string>;
  // The neuron this SNS recorded for Unicycle to propose through, or null.
  proposalNeuron: Uint8Array | null;
  // The Unicycle backend, and this root's deposit subaccount on it — together
  // the destination that marks a treasury transfer as a deposit top-up.
  backendId: Principal;
  depositSubaccount: Uint8Array;
}

// ---------------------------------------------------------------------------
// Decision status
// ---------------------------------------------------------------------------

const BASIS_POINTS = 10_000n;
const DEFAULT_MIN_YES_EXERCISED = 5_000n; // 50%
const DEFAULT_MIN_YES_TOTAL = 300n; //  3%

// The SNS acceptance rule, not a plain `yes > no`: a critical proposal (which
// `TransferSnsTreasuryFunds` is) carries a 2/3 exercised threshold, so a
// majority test would show a rejected deposit top-up as adopted.
function isAccepted(p: SnsGovernanceDid.ProposalData): boolean {
  const tally = p.latest_tally[0];
  if (!tally) return false;
  const minExercised = p.minimum_yes_proportion_of_exercised[0]?.basis_points[0] ?? DEFAULT_MIN_YES_EXERCISED;
  const minTotal = p.minimum_yes_proportion_of_total[0]?.basis_points[0] ?? DEFAULT_MIN_YES_TOTAL;
  return (
    tally.yes * BASIS_POINTS > (tally.yes + tally.no) * minExercised &&
    tally.yes * BASIS_POINTS >= tally.total * minTotal
  );
}

export function proposalOutcome(p: SnsGovernanceDid.ProposalData): ProposalOutcome {
  if (p.decided_timestamp_seconds === 0n) return 'open';
  if (!isAccepted(p)) return 'rejected';
  if (p.executed_timestamp_seconds > 0n) return 'executed';
  if (p.failed_timestamp_seconds > 0n) return 'failed';
  return 'adopted';
}

// ---------------------------------------------------------------------------
// Payload decoding
// ---------------------------------------------------------------------------

// Candid arg types for every backend method, lifted out of the generated
// bindings rather than re-declared here — `pnpm bindgen` keeps them in step
// with the backend, so there is no parallel set of definitions to drift.
const ARG_TYPES: Map<string, IDL.Type[]> = new Map(
  idlFactory({ IDL })._fields.map(([name, fn]) => [name, fn.argTypes as IDL.Type[]]),
);

// Null when the method is unknown or the blob doesn't decode — a malformed
// payload degrades one row's description, it never blanks the page.
function decodeArg(method: string, payload: Uint8Array): unknown {
  const types = ARG_TYPES.get(method);
  if (!types || types.length === 0) return null;
  try {
    return IDL.decode(types, payload)[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

// "10 ICP", "0.5 ICP", "0.00000001 ICP" — trailing zeros trimmed, unlike the
// fixed-decimal `fmtICP` the tables use. Mirrors the backend's NumFmt.icpE8s,
// which is what the proposal summaries themselves say.
function icp(e8s: bigint): string {
  const whole = e8s / 100_000_000n;
  const frac = (e8s % 100_000_000n).toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''} ICP`;
}

function days(n: bigint): string {
  return `${n.toString()} day${n === 1n ? '' : 's'}`;
}

function hex(bytes: Uint8Array, max = 8): string {
  const head = Array.from(bytes.slice(0, max), (b) => b.toString(16).padStart(2, '0')).join('');
  return bytes.length > max ? `${head}…` : head;
}

// ---------------------------------------------------------------------------
// Twin descriptions
// ---------------------------------------------------------------------------

function describeTwin(method: string, payload: Uint8Array): string {
  const arg = decodeArg(method, payload);

  switch (method) {
    case 'snsSetup':
      return 'Onboard this SNS to Unicycle';
    case 'snsDeregister':
      return 'Offboard this SNS from Unicycle';
  }

  if (arg === null) return `Unicycle: ${method}`;

  switch (method) {
    case 'snsSetDepositConfig': {
      const a = arg as SnsSetDepositConfigArg;
      if (a.minBalanceE8s === 0n) return 'Disable deposit auto-top-up';
      return (
        `Auto-deposit: top up with ${icp(a.depositAmountE8s)} when the deposit balance falls below ` +
        `${icp(a.minBalanceE8s)}${a.includeReport ? ' (cycle report included)' : ''}`
      );
    }
    case 'snsSetReportConfig': {
      const a = arg as SnsSetReportConfigArg;
      if (a.cadenceDays === 0n) return 'Disable recurring cycle reports';
      return `Set cycle report cadence to every ${days(a.cadenceDays)}`;
    }
    case 'snsSetDrainAlertConfig': {
      const a = arg as SnsSetDrainAlertConfigArg;
      const checks: string[] = [];
      if (a.weeklyAvgFactorPct > 0n) checks.push(`weekly ${a.weeklyAvgFactorPct}%`);
      if (a.monthlyAvgFactorPct > 0n) checks.push(`monthly ${a.monthlyAvgFactorPct}%`);
      if (a.dayOverDayFactorPct > 0n) checks.push(`day-over-day ${a.dayOverDayFactorPct}%`);
      if (checks.length === 0) return 'Disable cycle drain alerts';
      const cooldown = a.alertCooldownDays > 0n ? `${a.alertCooldownDays}-day cooldown` : 'no cooldown';
      return `Drain alerts: ${checks.join(', ')}, ${cooldown}`;
    }
    case 'snsGrantAdmin':
      return `Add ${fmtPid((arg as SnsGrantAdminArg).admin.toText())} as a Unicycle admin`;
    case 'snsRevokeAdmin':
      return `Remove ${fmtPid((arg as SnsRevokeAdminArg).admin.toText())} as a Unicycle admin`;
    case 'snsUpsertCanister': {
      const a = arg as SnsUpsertCanisterArg;
      const name = a.config.nickname[0];
      const who = name ? `${name} (${fmtPid(a.canisterId.toText())})` : fmtPid(a.canisterId.toText());
      return `Track canister ${who} — min ${fmtTC(a.config.minCycleBalance)} TC, top up ${fmtTC(a.config.cycleTopUpAmount)} TC`;
    }
    case 'snsSetCanisterSuspended': {
      const a = arg as SnsSetSuspendedArg;
      return `${a.suspend ? 'Suspend' : 'Resume'} automatic top-ups for ${fmtPid(a.canisterId.toText())}`;
    }
    case 'snsRemoveCanister':
      return `Stop tracking canister ${fmtPid((arg as SnsRemoveCanisterArg).canisterId.toText())}`;
    case 'snsRecordCyclesNow':
      return `Record a cycle reading now for ${fmtPid((arg as SnsRecordCyclesArg).canisterId.toText())}`;
    case 'snsWithdraw': {
      const a = arg as SnsWithdrawArg;
      const amount = 'ICP' in a.token ? icp(a.amount) : `${fmtTC(a.amount)} TC`;
      return `Withdraw ${amount} from the Unicycle account`;
    }
    case 'snsSetWithdrawDestination': {
      const d = (arg as SnsSetWithdrawDestinationArg).destination;
      const sub = d.subaccount[0] ? ' (custom subaccount)' : '';
      return `Set the non-ICP withdrawal destination to ${fmtPid(d.owner.toText())}${sub}`;
    }
    case 'snsSetProposalNeuron':
      return `Set the Unicycle proposal neuron to ${hex((arg as SnsSetProposalNeuronArg).neuronId)}`;
    default:
      return `Unicycle: ${method}`;
  }
}

// Unicycle's motion titles are already readable ("Unicycle: cycle usage
// report"); drop the product prefix so the column doesn't repeat it on every
// row.
function describeMotion(title: string): string {
  const stripped = title.startsWith('Unicycle: ') ? title.slice('Unicycle: '.length) : title;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function sameBytes(a: Uint8Array | undefined, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}

// A treasury transfer counts as a Unicycle deposit top-up when it lands in
// exactly the account `getSnsDepositAccount` reports for this root.
function isDepositTopUp(t: SnsGovernanceDid.TransferSnsTreasuryFunds, ctx: UnicycleContext): boolean {
  const to = t.to_principal[0];
  if (!to || to.toText() !== ctx.backendId.toText()) return false;
  return sameBytes(t.to_subaccount[0]?.subaccount, ctx.depositSubaccount);
}

// The one-line description, or null when the proposal has nothing to do with
// Unicycle. `AddGenericNervousSystemFunction` — the registrations `snsSetup`
// fans out — is a different action variant, so it drops out with no special
// case.
function describe(
  action: SnsGovernanceDid.Action,
  title: string,
  byUnicycle: boolean,
  ctx: UnicycleContext,
): string | null {
  if ('ExecuteGenericNervousSystemFunction' in action) {
    const { function_id, payload } = action.ExecuteGenericNervousSystemFunction;
    const method = ctx.functionMethods.get(function_id);
    // Unknown id: either not a Unicycle function, or one a deregister removed.
    // Only the second is interesting, and only when Unicycle proposed it.
    if (!method) return byUnicycle ? `Unicycle function #${function_id}` : null;
    return describeTwin(method, payload);
  }

  if ('TransferSnsTreasuryFunds' in action) {
    const t = action.TransferSnsTreasuryFunds;
    if (!isDepositTopUp(t, ctx)) return null;
    // from_treasury: 1 = ICP, 2 = the SNS token. Only ICP belongs here, but
    // label rather than hide anything else that reaches the account.
    const amount = t.from_treasury === 1 ? icp(t.amount_e8s) : `${icp(t.amount_e8s).replace(' ICP', '')} SNS tokens`;
    return `Transfer ${amount} from the treasury to the Unicycle deposit account`;
  }

  if ('Motion' in action) {
    // A motion carries no structural marker, so it needs both tests: the title
    // alone would admit any neuron's lookalike, the proposer alone would admit
    // the neuron owner's unrelated motions.
    if (!byUnicycle || !title.startsWith('Unicycle')) return null;
    return describeMotion(title);
  }

  return null;
}

export function classifyProposal(
  p: SnsGovernanceDid.ProposalData,
  ctx: UnicycleContext,
): UnicycleProposal | null {
  const id = p.id[0]?.id;
  const proposal = p.proposal[0];
  const action = proposal?.action[0];
  if (id === undefined || !proposal || !action) return null;

  const byUnicycle = sameBytes(p.proposer[0]?.id, ctx.proposalNeuron);
  const description = describe(action, proposal.title, byUnicycle, ctx);
  if (description === null) return null;

  return {
    id,
    description,
    outcome: proposalOutcome(p),
    createdMs: Number(p.proposal_creation_timestamp_seconds) * 1000,
    byUnicycle,
  };
}
