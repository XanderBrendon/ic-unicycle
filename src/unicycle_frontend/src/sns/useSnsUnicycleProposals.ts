import { useCallback, useEffect, useRef, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { SnsGovernanceCanister } from '@icp-sdk/canisters/sns';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { buildAgent } from '../wallet/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { principalToSubaccount } from '../wallet/depositAccount';
import { classifyProposal, type UnicycleContext, type UnicycleProposal } from './unicycleProposals';

const PAGE_SIZE = 100;
const TARGET_MATCHES = 20;
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

// Governance exposes no server-side "Unicycle-relevant" filter, so we page
// `list_proposals` newest-first and classify client-side. Each load stops at
// TARGET_MATCHES matches or MAX_PAGES_PER_LOAD pages, whichever comes first —
// draining the whole history on every visit would mean an unbounded number of
// sequential queries for a busy SNS. `loadMore` resumes from the cursor.
async function collect(gov: SnsGovernanceCanister, ctx: UnicycleContext, before: bigint | null) {
  const found: UnicycleProposal[] = [];
  let cursor = before;
  let pages = 0;
  let exhausted = false;

  while (pages < MAX_PAGES_PER_LOAD && found.length < TARGET_MATCHES) {
    const res = await gov.listProposals({
      limit: PAGE_SIZE,
      beforeProposal: cursor === null ? undefined : { id: cursor },
      certified: false,
    });
    pages += 1;
    const last = res.proposals[res.proposals.length - 1]?.id[0]?.id;
    for (const p of res.proposals) {
      const match = classifyProposal(p, ctx);
      if (match) found.push(match);
    }
    // A short page, an empty page, or one whose last entry has no id (which
    // would leave the cursor stuck) all mean there is nothing more to walk.
    if (res.proposals.length < PAGE_SIZE || last === undefined) {
      exhausted = true;
      break;
    }
    cursor = last;
  }

  return { found, cursor, exhausted };
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
