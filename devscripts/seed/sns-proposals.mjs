// Generate a governance init payload whose `proposals` and
// `id_to_nervous_system_functions` are pre-seeded, so the SNS Proposals tab has
// something to render locally. Driven by devscripts/seed-sns-proposals.sh,
// which encodes the emitted candid and reinstalls sns_governance.
//
// The real DFINITY governance wasm has no method that writes a proposal, and
// its only ingress (`manage_neuron`) auto-adopts and executes everything the
// dominant neuron submits — so every row would read `Executed` with a
// just-now timestamp. Both fields are init fields, though, so the whole history
// can be baked in with the ids, timestamps, and outcomes we want.
//
// Real Sneed proposals come from a committed fixture (--refresh re-fetches);
// the rest are synthesised to cover the branches Sneed's own history never
// exercises. See planning/docs/superpowers/specs/
// 2026-08-01-sns-proposals-local-seed-design.md.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { IDL } from '@icp-sdk/core/candid';
import { SnsGovernanceCanister } from '@icp-sdk/canisters/sns';
import { idlFactory } from '../../src/unicycle_frontend/src/bindings/unicycle_backend/declarations/unicycle_backend.did.js';

const SNEED_GOVERNANCE = 'fi3zi-fyaaa-aaaaq-aachq-cai';
const SNEED_BACKEND = '2ccdl-vaaaa-aaaan-q6h5a-cai'; // mainnet unicycle_backend
const FIXTURE = 'vendor/sns_governance/sneed_proposals.json';
const TEMPLATE = 'vendor/sns_governance/governance_init.candid';

// The dev identity that controls the dominant neuron (governance_init.candid).
const DEV = 'nas6b-kglsn-zvzrl-o4vro-775rf-ls5mb-bwknk-gqgfq-gi2pm-23xbm-gqe';
// The dominant neuron baked into governance_init.candid, and its stake. Ballots
// are keyed by neuron id hex, and this is the only neuron that exists, so it is
// the only key whose vote governance will count.
const DOMINANT_NEURON = '01'.repeat(32);
const VOTING_POWER = 100_000_000_000_000n;
// A stand-in for an ordinary DAO member's neuron, so `byUnicycle` is not
// uniformly true across the seeded set.
const COMMUNITY_NEURON = 'c0'.repeat(32);

// Proposal id range. The newest 100 (271-370) are one `list_proposals` page, so
// putting 20 matches there is what makes `collect()` report `hasMore` and offer
// `Load more`; the rest of the matches sit in the page below it so pressing it
// actually adds rows. Sneed's real ids (327, 341-345) fall inside the top page.
const OLDEST_ID = 141;
const NEWEST_ID = 370;

const E8S = 100_000_000n;
const TC = 1_000_000_000_000n;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const REFRESH = flag('--refresh');
const BASE_FN = BigInt(value('--base', '4000'));
const OUT = value('--out', null);
if (!OUT) die('usage: sns-proposals.mjs --out <path> [--refresh] [--base ID]');

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Candid text emission
// ---------------------------------------------------------------------------
//
// Hand-rolled rather than type-driven: the seed only ever emits ProposalData
// and NervousSystemFunction, and a literal emitter is far easier to read (and
// to eyeball in the generated file) than a generic IDL walker.

const nat64 = (v) => `${BigInt(v)} : nat64`;
const int32 = (v) => `${v} : int32`;

// Every byte as \hh — safe for arbitrary payload blobs and neuron ids alike.
const blob = (bytes) => `blob "${Array.from(bytes, (b) => `\\${b.toString(16).padStart(2, '0')}`).join('')}"`;

// Candid text literals must be valid UTF-8, so escape at the byte level and
// leave printable ASCII alone. Sneed's summaries carry newlines and the odd
// non-ASCII character.
function text(s) {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (const b of bytes) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += '\\\\';
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\${b.toString(16).padStart(2, '0')}`;
  }
  return `"${out}"`;
}

// Parenthesised because `opt` binds looser than the `:` type annotation —
// `opt 0 : nat64` is read as `(opt 0) : nat64` and fails to typecheck.
const opt = (v) => (v === null || v === undefined ? 'null' : `opt (${v})`);
const record = (fields) =>
  `record { ${Object.entries(fields)
    .map(([k, v]) => `${k} = ${v}`)
    .join('; ')} }`;
const vec = (items) => `vec { ${items.map((i) => `${i};`).join(' ')} }`;
const principal = (p) => `principal ${text(typeof p === 'string' ? p : p.toText())}`;

// ---------------------------------------------------------------------------
// Fixture (de)serialisation
// ---------------------------------------------------------------------------
//
// bigint, Uint8Array, and Principal all vanish through JSON.stringify, so they
// are tagged on the way out and rebuilt on the way in.

function toJson(v) {
  if (typeof v === 'bigint') return { __bigint: v.toString() };
  if (v instanceof Uint8Array) return { __bytes: Buffer.from(v).toString('hex') };
  if (v instanceof Principal) return { __principal: v.toText() };
  if (Array.isArray(v)) return v.map(toJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]));
  return v;
}

function fromJson(v) {
  if (Array.isArray(v)) return v.map(fromJson);
  if (v && typeof v === 'object') {
    if ('__bigint' in v) return BigInt(v.__bigint);
    if ('__bytes' in v) return Uint8Array.from(Buffer.from(v.__bytes, 'hex'));
    if ('__principal' in v) return Principal.fromText(v.__principal);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fromJson(x)]));
  }
  return v;
}

// ---------------------------------------------------------------------------
// Mainnet fetch
// ---------------------------------------------------------------------------

// Everything on Sneed the Proposals tab would render, plus the Unicycle
// function records themselves — the seed rewrites those into the local registry
// rather than inventing one, so the local ids and descriptions are Sneed's.
async function fetchFixture() {
  const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
  const gov = SnsGovernanceCanister.create({ canisterId: Principal.fromText(SNEED_GOVERNANCE), agent });

  const fns = (await gov.listNervousSystemFunctions({ certified: false })).functions.filter((f) => {
    const ft = f.function_type[0];
    return ft && 'GenericNervousSystemFunction' in ft
      && ft.GenericNervousSystemFunction.target_canister_id[0]?.toText() === SNEED_BACKEND;
  });
  const unicycleFns = new Set(fns.map((f) => f.id));

  const proposals = [];
  let cursor;
  for (;;) {
    const res = await gov.listProposals({ limit: 100, beforeProposal: cursor, certified: false });
    for (const p of res.proposals) {
      const action = p.proposal[0]?.action[0];
      if (!action) continue;
      const relevant =
        ('ExecuteGenericNervousSystemFunction' in action
          && unicycleFns.has(action.ExecuteGenericNervousSystemFunction.function_id))
        || ('TransferSnsTreasuryFunds' in action && action.TransferSnsTreasuryFunds.to_principal[0]?.toText() === SNEED_BACKEND)
        || ('Motion' in action && p.proposal[0].title.startsWith('Unicycle'));
      if (relevant) proposals.push(p);
    }
    const last = res.proposals[res.proposals.length - 1]?.id[0]?.id;
    if (res.proposals.length < 100 || last === undefined) break;
    cursor = { id: last };
  }

  // `list_proposals` blanks the payload of every
  // ExecuteGenericNervousSystemFunction, so re-read each one through
  // `get_proposal`, which returns it (redacted with a human-readable notice
  // only when it is large). Without this the fixture would carry 0-byte
  // payloads and the seeded proposals would be undecodable.
  for (const p of proposals) {
    const a = p.proposal[0].action[0];
    if (!('ExecuteGenericNervousSystemFunction' in a)) continue;
    const full = await gov.getProposal({ proposalId: { id: p.id[0].id }, certified: false });
    const fullAction = full.proposal?.[0]?.action?.[0];
    if (fullAction && 'ExecuteGenericNervousSystemFunction' in fullAction) {
      a.ExecuteGenericNervousSystemFunction.payload = fullAction.ExecuteGenericNervousSystemFunction.payload;
    }
  }

  proposals.sort((a, b) => Number(a.id[0].id - b.id[0].id));
  return { functions: fns, proposals };
}

// ---------------------------------------------------------------------------
// Local context
// ---------------------------------------------------------------------------

function readIds() {
  const ids = {};
  for (const env of ['local', 'ledger']) {
    const path = `.icp/cache/mappings/${env}.ids.json`;
    if (existsSync(path)) Object.assign(ids, JSON.parse(readFileSync(path, 'utf8')));
  }
  return ids;
}

// SYNC-BINDING twin of `principalToSubaccount` in main.mo and
// src/unicycle_frontend/src/wallet/depositAccount.ts — 1-byte length prefix,
// principal bytes, zero pad. Replicated rather than imported because those are
// Motoko and TypeScript; if the encoding ever changes, this changes with them.
function principalToSubaccount(p) {
  const bytes = p.toUint8Array();
  const sub = new Uint8Array(32);
  sub[0] = bytes.length;
  sub.set(bytes, 1);
  return sub;
}

async function readProposalNeuron(backendId, root, host) {
  const agent = await HttpAgent.create({ host, shouldFetchRootKey: true });
  const actor = Actor.createActor(idlFactory, { agent, canisterId: backendId });
  const neuron = await actor.getSnsProposalNeuronByRoot(root);
  return neuron[0] ?? null;
}

// ---------------------------------------------------------------------------
// Payload encoding
// ---------------------------------------------------------------------------

// Argument types straight off the generated bindings — the same source
// unicycleProposals.ts builds ARG_TYPES from, so a seeded payload cannot decode
// differently from how the page reads it.
const ARG_TYPES = new Map(idlFactory({ IDL })._fields.map(([name, fn]) => [name, fn.argTypes]));

function encodeArg(method, arg) {
  const types = ARG_TYPES.get(method);
  if (!types) die(`no candid arg type for backend method '${method}'`);
  return new Uint8Array(IDL.encode(types, [arg]));
}

// ---------------------------------------------------------------------------
// ProposalData construction
// ---------------------------------------------------------------------------

const ACTION_MOTION = 1n;
const ACTION_TRANSFER_TREASURY = 9n;

// The five outcomes `proposalOutcome` distinguishes, expressed through the
// fields it actually reads. `isAccepted` applies the SNS threshold rule rather
// than a majority, so `rejected` needs a tally that genuinely fails it.
//
// `vote` is the dominant neuron's ballot: 1 = yes, 2 = no, 0 = not yet cast.
// Governance recomputes `latest_tally` from ballots for any proposal still
// inside its voting period, so a seeded tally with no matching ballot is zeroed
// and every row collapses to `rejected`. Keeping the two consistent means the
// outcome survives whether or not governance recomputes it. An open proposal
// needs an *uncast* ballot for the same reason: with no outstanding voter,
// governance decides it immediately instead of leaving it open.
function outcomeFields(outcome, created) {
  const pass = { yes: VOTING_POWER, no: 0n, total: VOTING_POWER };
  const fail = { yes: 0n, no: VOTING_POWER, total: VOTING_POWER };
  const decided = created + 3600n;
  switch (outcome) {
    case 'open':
      return { tally: { yes: 0n, no: 0n, total: VOTING_POWER }, decided: 0n, executed: 0n, failed: 0n, vote: 0 };
    case 'rejected':
      return { tally: fail, decided, executed: 0n, failed: 0n, vote: 2 };
    case 'executed':
      return { tally: pass, decided, executed: decided + 10n, failed: 0n, vote: 1 };
    case 'failed':
      return { tally: pass, decided, executed: 0n, failed: decided + 10n, vote: 1 };
    case 'adopted':
      return { tally: pass, decided, executed: 0n, failed: 0n, vote: 1 };
    default:
      return die(`unknown outcome '${outcome}'`);
  }
}

function proposalData({ id, actionId, action, title, summary, proposer, created, outcome, topic }) {
  const { tally, decided, executed, failed, vote } = outcomeFields(outcome, created);
  const ballot = record({
    vote: int32(vote),
    cast_timestamp_seconds: nat64(vote === 0 ? 0 : created + 60n),
    voting_power: nat64(VOTING_POWER),
  });
  return record({
    id: opt(record({ id: nat64(id) })),
    payload_text_rendering: 'null',
    action: nat64(actionId),
    failure_reason:
      failed > 0n
        ? opt(record({ error_message: text('canister trapped during execution'), error_type: int32(9) }))
        : 'null',
    action_auxiliary: 'null',
    ballots: vec([`record { ${text(DOMINANT_NEURON)}; ${ballot} }`]),
    minimum_yes_proportion_of_total: 'null',
    reward_event_round: nat64(0),
    failed_timestamp_seconds: nat64(failed),
    reward_event_end_timestamp_seconds: 'null',
    proposal_creation_timestamp_seconds: nat64(created),
    initial_voting_period_seconds: nat64(345_600),
    reject_cost_e8s: nat64(10_000_000),
    latest_tally: opt(
      record({
        no: nat64(tally.no),
        yes: nat64(tally.yes),
        total: nat64(tally.total),
        timestamp_seconds: nat64(decided > 0n ? decided : created),
      }),
    ),
    wait_for_quiet_deadline_increase_seconds: nat64(86_400),
    decided_timestamp_seconds: nat64(decided),
    proposal: opt(record({ url: text(''), title: text(title), action: opt(action), summary: text(summary) })),
    proposer: opt(record({ id: blob(proposer) })),
    wait_for_quiet_state: opt(record({ current_deadline_timestamp_seconds: nat64(created + 345_600n) })),
    minimum_yes_proportion_of_exercised: 'null',
    is_eligible_for_rewards: 'true',
    executed_timestamp_seconds: nat64(executed),
    topic: opt(`variant { ${topic ?? 'ApplicationBusinessLogic'} }`),
  });
}

// ---------------------------------------------------------------------------
// Action builders
// ---------------------------------------------------------------------------

const motionAction = (motionText) => `variant { Motion = ${record({ motion_text: text(motionText) })} }`;

const execAction = (functionId, payload) =>
  `variant { ExecuteGenericNervousSystemFunction = ${record({
    function_id: nat64(functionId),
    payload: blob(payload),
  })} }`;

const treasuryAction = (backendId, subaccount, amountE8s, memo) =>
  `variant { TransferSnsTreasuryFunds = ${record({
    from_treasury: int32(1), // 1 = ICP
    to_principal: opt(principal(backendId)),
    to_subaccount: opt(record({ subaccount: blob(subaccount) })),
    memo: opt(nat64(memo)),
    amount_e8s: nat64(amountE8s),
  })} }`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ids = readIds();
for (const key of ['unicycle_backend', 'sns_root', 'sns_governance']) {
  if (!ids[key]) die(`${key} is not deployed locally — run 'icp deploy' and 'icp deploy -e ledger' first`);
}
const backendId = Principal.fromText(ids.unicycle_backend);
const rootId = Principal.fromText(ids.sns_root);
const host = process.env.ICP_HOST ?? 'http://127.0.0.1:8000';

const proposalNeuron = await readProposalNeuron(backendId, rootId, host);
if (!proposalNeuron) {
  die(
    `the backend has no proposal neuron for root ${rootId.toText()} — run devscripts/seed-local.sh `
      + `(or onboard the SNS) first, otherwise no seeded proposal can carry the Unicycle badge`,
  );
}
const UNICYCLE_NEURON = new Uint8Array(proposalNeuron);
const COMMUNITY = Uint8Array.from(Buffer.from(COMMUNITY_NEURON, 'hex'));

let fixture;
if (REFRESH || !existsSync(FIXTURE)) {
  console.log(`==> fetching Unicycle proposals from Sneed (${SNEED_GOVERNANCE})`);
  const fetched = await fetchFixture();
  writeFileSync(FIXTURE, `${JSON.stringify(toJson(fetched), null, 1)}\n`);
  console.log(`    ${fetched.proposals.length} proposals, ${fetched.functions.length} functions -> ${FIXTURE}`);
  fixture = fetched;
} else {
  fixture = fromJson(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  console.log(`==> using cached fixture ${FIXTURE} (${fixture.proposals.length} proposals) — --refresh to re-fetch`);
}

// --- function registry -----------------------------------------------------
//
// Sneed's own records, retargeted at the local backend. `target_canister_id` is
// what useSnsUnicycleProposals filters on when it builds `functionMethods`.
// Sneed's layout is base+0 = snsSetup then the thirteen twins, and keeping the
// base at 4000 leaves register-fns' 1000-series free.

const sneedBase = fixture.functions.reduce((min, f) => (f.id < min ? f.id : min), fixture.functions[0].id);
const localFnId = (sneedId) => BASE_FN + (sneedId - sneedBase);
const methodToLocalId = new Map();

const functionEntries = fixture.functions.map((f) => {
  const g = f.function_type[0].GenericNervousSystemFunction;
  const id = localFnId(f.id);
  methodToLocalId.set(g.target_method_name[0], id);
  return record({
    id: nat64(id),
    name: text(f.name),
    description: opt(text(f.description[0] ?? '')),
    function_type: opt(
      `variant { GenericNervousSystemFunction = ${record({
        validator_canister_id: opt(principal(backendId)),
        target_canister_id: opt(principal(backendId)),
        validator_method_name: opt(text(g.validator_method_name[0])),
        target_method_name: opt(text(g.target_method_name[0])),
        topic: opt('variant { ApplicationBusinessLogic }'),
      })} }`,
    ),
  });
});

const fn = (method) => methodToLocalId.get(method) ?? die(`fixture has no function for '${method}'`);

// --- real proposals --------------------------------------------------------
//
// Three rewrites; the payload blobs are left alone, since the ones Sneed
// actually has carry only user principals and integers, which render as-is.

const depositSubaccount = principalToSubaccount(rootId);
const realIds = new Set();

const realProposals = fixture.proposals.map((p) => {
  const id = p.id[0].id;
  realIds.add(id);
  const src = p.proposal[0];
  const a = src.action[0];
  let action;
  let actionId;

  if ('ExecuteGenericNervousSystemFunction' in a) {
    const e = a.ExecuteGenericNervousSystemFunction;
    actionId = localFnId(e.function_id);
    action = execAction(actionId, e.payload);
  } else if ('TransferSnsTreasuryFunds' in a) {
    const t = a.TransferSnsTreasuryFunds;
    actionId = ACTION_TRANSFER_TREASURY;
    action = treasuryAction(backendId, depositSubaccount, t.amount_e8s, t.memo[0] ?? 0n);
  } else if ('Motion' in a) {
    actionId = ACTION_MOTION;
    action = motionAction(a.Motion.motion_text);
  } else {
    return null; // not a shape the page renders; nothing to seed
  }

  return {
    id,
    candid: proposalData({
      id,
      actionId,
      action,
      title: src.title,
      summary: src.summary,
      proposer: UNICYCLE_NEURON,
      created: p.proposal_creation_timestamp_seconds,
      outcome: 'executed',
      topic: 'ApplicationBusinessLogic',
    }),
  };
});

// --- synthetic proposals ---------------------------------------------------
//
// Everything Sneed's own history never exercised: the remaining describeTwin
// branches (including the disable-variants), both Motion titles the backend
// emits, the unregistered-function fallback, and the four outcome badges that
// an all-Executed history never shows.

const now = BigInt(Math.floor(Date.now() / 1000));
const DAY = 86_400n;
// Ids run newest-first, so map the range onto the past. The +7 day offset puts
// even the newest decided proposal past its 4-day voting deadline, so
// governance's periodic task treats the whole history as settled and never
// re-tallies it. Open proposals override this below — they need a live deadline.
const SETTLED_MARGIN = 7n;
const createdFor = (id) => now - (BigInt(NEWEST_ID - Number(id)) + SETTLED_MARGIN) * DAY;

const tracked = Principal.fromText(ids.sns_ledger ?? ids.unicycle_backend);
const tracked2 = Principal.fromText(ids.sns_index ?? ids.unicycle_backend);

const canisterConfig = (nickname, minTc, topUpTc) => ({
  snsRoot: [rootId],
  nickname: nickname === null ? [] : [nickname],
  minCycleBalance: minTc * TC,
  cycleTopUpAmount: topUpTc * TC,
  suspendedUntil: [],
});

// `method`+`arg` is an ExecuteGenericNervousSystemFunction against that twin;
// `motion`, `treasury`, and `unknownFn` are the three other shapes the page
// renders. The action id follows from the shape, so it is never stated twice.
const SYNTHETIC = [
  // --- top page (271-370): 14 matches, which with the 6 real ones is the 20
  // that make `collect()` stop early and report hasMore.
  { id: 370n, outcome: 'executed', unicycle: true, motion: 'Cycle usage report for the period.',
    title: 'Unicycle: cycle usage report',
    summary: 'Fleet burned 12.4 TC over the last 7 days across 5 canisters.' },
  { id: 368n, outcome: 'open', unicycle: true, treasury: { amount: 25n * E8S, memo: 7n },
    title: 'Unicycle: top up SNS deposit', summary: 'Deposit balance is below the configured minimum.' },
  { id: 364n, outcome: 'adopted', unicycle: true, method: 'snsUpsertCanister',
    arg: { canisterId: tracked, config: canisterConfig('sns_ledger', 2n, 5n) },
    title: 'Unicycle: track canister', summary: 'Track the SNS ledger.' },
  { id: 360n, outcome: 'executed', unicycle: true, motion: 'Cycle drain alert.',
    title: 'Unicycle: cycle drain alert',
    summary: 'sns_ledger burned 340% of its weekly average in the last day.' },
  { id: 355n, outcome: 'executed', unicycle: true, method: 'snsSetReportConfig', arg: { cadenceDays: 7n },
    title: 'Unicycle: update cycle report cadence', summary: 'Report weekly.' },
  { id: 349n, outcome: 'failed', unicycle: true, method: 'snsWithdraw',
    arg: { token: { ICP: null }, amount: 3n * E8S },
    title: 'Unicycle: withdraw', summary: 'Return unused ICP to the treasury.' },
  { id: 338n, outcome: 'executed', unicycle: true, method: 'snsSetDrainAlertConfig',
    arg: { weeklyAvgFactorPct: 150n, monthlyAvgFactorPct: 200n, dayOverDayFactorPct: 300n, alertCooldownDays: 3n },
    title: 'Unicycle: update cycle drain alerts', summary: 'Enable all three drain checks.' },
  { id: 336n, outcome: 'executed', unicycle: true, method: 'snsSetCanisterSuspended',
    arg: { canisterId: tracked2, suspend: true },
    title: 'Unicycle: set canister suspended', summary: 'Pause top-ups while the canister is being replaced.' },
  { id: 333n, outcome: 'rejected', unicycle: false, method: 'snsRemoveCanister', arg: { canisterId: tracked2 },
    title: 'Unicycle: remove canister', summary: 'Stop tracking the index canister.' },
  { id: 322n, outcome: 'open', unicycle: false, method: 'snsGrantAdmin', arg: { admin: Principal.fromText(DEV) },
    title: 'Unicycle: grant admin', summary: 'Grant the operations team fleet access.' },
  { id: 315n, outcome: 'executed', unicycle: true, method: 'snsSetWithdrawDestination',
    arg: { destination: { owner: Principal.fromText(DEV), subaccount: [principalToSubaccount(rootId)] } },
    title: 'Unicycle: set withdraw destination', summary: 'Send non-ICP withdrawals to the DAO wallet.' },
  { id: 305n, outcome: 'executed', unicycle: false, method: 'snsUpsertCanister',
    arg: { canisterId: tracked2, config: canisterConfig(null, 1n, 3n) },
    title: 'Unicycle: track canister', summary: 'Track the index canister.' },
  { id: 292n, outcome: 'executed', unicycle: true, method: 'snsRecordCyclesNow', arg: { canisterId: tracked },
    title: 'Unicycle: record cycles now', summary: 'Take an immediate reading.' },
  { id: 278n, outcome: 'rejected', unicycle: true, method: 'snsSetDepositConfig',
    arg: { minBalanceE8s: 0n, depositAmountE8s: 0n, includeReport: false },
    title: 'Unicycle: update deposit auto-top-up config', summary: 'Turn automatic deposits off.' },

  // --- page below (141-270): what `Load more` reveals.
  { id: 265n, outcome: 'executed', unicycle: true, method: 'snsSetReportConfig', arg: { cadenceDays: 0n },
    title: 'Unicycle: update cycle report cadence', summary: 'Stop recurring reports.' },
  { id: 260n, outcome: 'rejected', unicycle: true, method: 'snsDeregister', arg: {},
    title: 'Unicycle: deregister', summary: 'Offboard the SNS from Unicycle.' },
  { id: 251n, outcome: 'adopted', unicycle: true, method: 'snsSetDrainAlertConfig',
    arg: { weeklyAvgFactorPct: 0n, monthlyAvgFactorPct: 0n, dayOverDayFactorPct: 0n, alertCooldownDays: 0n },
    title: 'Unicycle: update cycle drain alerts', summary: 'Disable drain alerting.' },
  // The only route to the `Unicycle function #N` fallback: an id the registry
  // does not know, proposed by the Unicycle neuron — what a deregistered
  // function leaves behind.
  { id: 245n, outcome: 'rejected', unicycle: true, unknownFn: 9_999n,
    title: 'Unicycle: removed function', summary: 'Calls a function that no longer exists.' },
  { id: 236n, outcome: 'executed', unicycle: false, method: 'snsWithdraw',
    arg: { token: { TCYCLES: null }, amount: 4n * TC },
    title: 'Unicycle: withdraw', summary: 'Withdraw surplus cycles.' },
  { id: 218n, outcome: 'executed', unicycle: true, method: 'snsSetCanisterSuspended',
    arg: { canisterId: tracked2, suspend: false },
    title: 'Unicycle: set canister suspended', summary: 'Resume automatic top-ups.' },
  { id: 199n, outcome: 'failed', unicycle: true, method: 'snsRevokeAdmin', arg: { admin: Principal.fromText(DEV) },
    title: 'Unicycle: revoke admin', summary: 'Remove fleet access.' },
  { id: 175n, outcome: 'executed', unicycle: true, method: 'snsSetProposalNeuron', arg: { neuronId: UNICYCLE_NEURON },
    title: 'Unicycle: set proposal neuron', summary: 'Point Unicycle at the DAO neuron.' },
];

function synthAction(s) {
  if (s.motion) return { actionId: ACTION_MOTION, action: motionAction(s.motion) };
  if (s.treasury) {
    return {
      actionId: ACTION_TRANSFER_TREASURY,
      action: treasuryAction(backendId, depositSubaccount, s.treasury.amount, s.treasury.memo),
    };
  }
  if (s.unknownFn) {
    // A bare candid header — the page's decode fails and falls through to the
    // `Unicycle function #N` label, which is the point of this row.
    return { actionId: s.unknownFn, action: execAction(s.unknownFn, new Uint8Array([0x44, 0x49, 0x44, 0x4c, 0, 0])) };
  }
  const id = fn(s.method);
  return { actionId: id, action: execAction(id, encodeArg(s.method, s.arg)) };
}

const syntheticProposals = SYNTHETIC.map((s) => {
  if (realIds.has(s.id)) die(`synthetic id ${s.id} collides with a real Sneed proposal id`);
  const { actionId, action } = synthAction(s);
  return {
    id: s.id,
    candid: proposalData({
      id: s.id,
      actionId,
      action,
      title: s.title,
      summary: s.summary,
      proposer: s.unicycle ? UNICYCLE_NEURON : COMMUNITY,
      // An open proposal past its deadline gets closed by governance's periodic
      // task, so stamp those at now rather than on the historical curve.
      created: s.outcome === 'open' ? now - 3600n : createdFor(s.id),
      outcome: s.outcome,
    }),
  };
});

// --- filler ----------------------------------------------------------------
//
// `collect()` only reports hasMore when a page comes back full at 100, so the
// history has to be deeper than one page for `Load more` to appear at all.
// Non-Unicycle motions are also what a real SNS's history is mostly made of —
// Sneed has 369 proposals of which 6 are ours — so this exercises the
// classifier's reject path at a realistic ratio.

const FILLER_TITLES = [
  'Adjust the reward rate',
  'Upgrade the frontend canister',
  'Fund the community grants pool',
  'Set the transaction fee',
  'Register a new dapp canister',
  'Change the DAO description',
  'Rotate a treasury signer',
  'Approve the quarterly roadmap',
];

const taken = new Set([...realIds, ...SYNTHETIC.map((s) => s.id)]);
const fillerProposals = [];
for (let id = BigInt(OLDEST_ID); id <= BigInt(NEWEST_ID); id += 1n) {
  if (taken.has(id)) continue;
  const title = FILLER_TITLES[Number(id) % FILLER_TITLES.length];
  fillerProposals.push({
    id,
    candid: proposalData({
      id,
      actionId: ACTION_MOTION,
      action: motionAction(`${title}.`),
      title,
      summary: `Community proposal ${id}.`,
      proposer: COMMUNITY,
      created: createdFor(id),
      outcome: Number(id) % 5 === 0 ? 'rejected' : 'executed',
      topic: 'Governance',
    }),
  });
}

// --- emit ------------------------------------------------------------------

const all = [...realProposals.filter(Boolean), ...syntheticProposals, ...fillerProposals]
  .sort((a, b) => Number(a.id - b.id));

// The tuple form `record { <id>; <ProposalData> }` has no field names, so build
// it directly rather than through the keyed `record` helper.
const proposalsLiteral = vec(all.map((p) => `record { ${nat64(p.id)}; ${p.candid} }`));
const functionsLiteral = vec(fixture.functions.map((f, i) => `record { ${nat64(localFnId(f.id))}; ${functionEntries[i]} }`));

let template = readFileSync(TEMPLATE, 'utf8');
for (const [name, id] of Object.entries(ids)) template = template.split(`@@${name}@@`).join(id);
if (template.includes('@@')) die(`unresolved @@placeholder@@ in ${TEMPLATE} — check the ids mappings`);

const filled = template
  .replace('proposals = vec {};', `proposals = ${proposalsLiteral};`)
  .replace('id_to_nervous_system_functions = vec {};', `id_to_nervous_system_functions = ${functionsLiteral};`);

if (filled === template) die(`could not inject into ${TEMPLATE} — its proposals/functions fields have changed shape`);

writeFileSync(OUT, filled);

const matched = realProposals.filter(Boolean).length + SYNTHETIC.length;
console.log(`==> ${all.length} proposals (${matched} Unicycle-relevant, ${fillerProposals.length} filler)`);
console.log(`    ${fixture.functions.length} functions at ${BASE_FN}-${BASE_FN + BigInt(fixture.functions.length - 1)} -> ${backendId.toText()}`);
console.log(`    proposer neuron ${Buffer.from(UNICYCLE_NEURON).toString('hex').slice(0, 16)}… -> ${OUT}`);
