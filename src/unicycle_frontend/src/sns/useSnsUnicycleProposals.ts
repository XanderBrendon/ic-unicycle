import { useCallback, useEffect, useRef, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { SnsGovernanceCanister, type SnsGovernanceDid } from '@icp-sdk/canisters/sns';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { buildAgent } from '../wallet/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { principalToSubaccount } from '../wallet/depositAccount';
import { classifyProposal, needsPayload, type UnicycleContext, type UnicycleProposal } from './unicycleProposals';

const PAGE_SIZE = 100;
const TARGET_MATCHES = 10;
const MAX_PAGES_PER_LOAD = 2;

export interface SnsUnicycleProposals {
  proposals: UnicycleProposal[] | null; // null while the first load runs
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  refresh: () => void;
  loadMore: () => void;
}

// `list_proposals` hands back every generic-function payload blanked to zero
// bytes, so the rows that describe themselves from their arguments arrive as
// `Unicycle: <method>`. Re-read just those through `get_proposal`, which
// carries the real bytes, and describe them again from the full record. Bounded
// by TARGET_MATCHES and skipped entirely for the rows that never needed a
// payload, so a load costs at most a handful of extra queries.
async function withPayloads(
  gov: SnsGovernanceCanister,
  ctx: UnicycleContext,
  matched: { raw: SnsGovernanceDid.ProposalData; match: UnicycleProposal }[],
): Promise<UnicycleProposal[]> {
  return Promise.all(
    matched.map(async ({ raw, match }) => {
      if (!needsPayload(raw, ctx)) return match;
      try {
        const full = await gov.getProposal({ proposalId: { id: match.id }, certified: false });
        // Governance substitutes a human-readable redaction notice for a large
        // payload rather than returning the bytes. That fails to decode, and
        // the row keeps the `Unicycle: <method>` description it already had.
        return classifyProposal(full, ctx) ?? match;
      } catch {
        return match; // one unreadable proposal degrades its row, not the page
      }
    }),
  );
}

// Governance exposes no server-side "Unicycle-relevant" filter, so we page
// `list_proposals` newest-first and classify client-side. Each load stops at
// TARGET_MATCHES matches or MAX_PAGES_PER_LOAD pages, whichever comes first —
// draining the whole history on every visit would mean an unbounded number of
// sequential queries for a busy SNS. `loadMore` resumes from the cursor.
async function collect(gov: SnsGovernanceCanister, ctx: UnicycleContext, before: bigint | null) {
  const matched: { raw: SnsGovernanceDid.ProposalData; match: UnicycleProposal }[] = [];
  let cursor = before;
  let pages = 0;
  let exhausted = false;

  while (pages < MAX_PAGES_PER_LOAD && matched.length < TARGET_MATCHES) {
    const res = await gov.listProposals({
      limit: PAGE_SIZE,
      beforeProposal: cursor === null ? undefined : { id: cursor },
      certified: false,
    });
    pages += 1;

    // The cursor advances one proposal at a time so a page can be abandoned
    // part-way through once TARGET_MATCHES is reached — a dense page would
    // otherwise hand back its whole yield at once, and the rest of it would be
    // skipped if the cursor had already jumped to the end.
    let consumed = 0;
    for (const p of res.proposals) {
      const id = p.id[0]?.id;
      // No id leaves the cursor with nowhere to advance to, so stop rather
      // than re-walk this page forever.
      if (id === undefined) {
        exhausted = true;
        break;
      }
      consumed += 1;
      cursor = id;
      const match = classifyProposal(p, ctx);
      if (match) matched.push({ raw: p, match });
      if (matched.length >= TARGET_MATCHES) break;
    }

    // Only a page walked to its end, and short, proves there is nothing left
    // behind the cursor. A page we stopped part-way through always has more.
    if (!exhausted && consumed === res.proposals.length && res.proposals.length < PAGE_SIZE) exhausted = true;
    if (exhausted) break;
  }

  return { found: await withPayloads(gov, ctx, matched), cursor, exhausted };
}

export function useSnsUnicycleProposals(
  identity: Identity | null,
  governance: Principal | null,
  root: Principal,
): SnsUnicycleProposals {
  const [proposals, setProposals] = useState<UnicycleProposal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Carried across renders so `loadMore` can resume where the last load
  // stopped without rebuilding the context or restarting from the newest
  // proposal.
  const govRef = useRef<SnsGovernanceCanister | null>(null);
  const ctxRef = useRef<UnicycleContext | null>(null);
  const cursorRef = useRef<bigint | null>(null);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity || !governance) return;
    const env = safeGetCanisterEnv();
    if (!env) return;
    const backendId = Principal.fromText(env['PUBLIC_CANISTER_ID:unicycle_backend']);

    let cancelled = false;
    setLoading(true);
    setProposals(null);
    govRef.current = null;
    ctxRef.current = null;
    cursorRef.current = null;

    (async () => {
      const gov = SnsGovernanceCanister.create({ canisterId: governance, agent: buildAgent() });

      // Only the neuron comes from Unicycle, and only as a query — proposals
      // and function ids come straight from governance.
      const [fns, proposalNeuron] = await Promise.all([
        gov.listNervousSystemFunctions({ certified: false }),
        createUnicycleBackendActor(identity).getSnsProposalNeuronByRoot(root),
      ]);

      const functionMethods = new Map<bigint, string>();
      for (const fn of fns.functions) {
        const ft = fn.function_type[0];
        if (!ft || !('GenericNervousSystemFunction' in ft)) continue;
        const g = ft.GenericNervousSystemFunction;
        const target = g.target_canister_id[0];
        const method = g.target_method_name[0];
        if (target && method && target.toText() === backendId.toText()) functionMethods.set(fn.id, method);
      }

      const ctx: UnicycleContext = {
        functionMethods,
        proposalNeuron,
        backendId,
        depositSubaccount: principalToSubaccount(root),
      };
      const page = await collect(gov, ctx, null);
      return { gov, ctx, page };
    })()
      .then(({ gov, ctx, page }) => {
        if (cancelled) return;
        govRef.current = gov;
        ctxRef.current = ctx;
        cursorRef.current = page.cursor;
        setProposals(page.found);
        setHasMore(!page.exhausted);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setHasMore(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, governance, root, tick]);

  const loadMore = useCallback(() => {
    const gov = govRef.current;
    const ctx = ctxRef.current;
    if (!gov || !ctx || loadingMore) return;
    setLoadingMore(true);
    collect(gov, ctx, cursorRef.current)
      .then((page) => {
        cursorRef.current = page.cursor;
        setProposals((prev) => [...(prev ?? []), ...page.found]);
        setHasMore(!page.exhausted);
        setError(null);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoadingMore(false));
  }, [loadingMore]);

  return { proposals, loading, loadingMore, hasMore, error, refresh, loadMore };
}
