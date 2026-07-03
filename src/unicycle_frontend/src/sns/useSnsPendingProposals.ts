import { useCallback, useEffect, useState } from 'react';
import type { Principal } from '@icp-sdk/core/principal';
import { SnsGovernanceCanister, SnsProposalDecisionStatus } from '@icp-sdk/canisters/sns';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { buildAgent } from '../wallet/agent';

export type SnsConfigDomain = 'deposit' | 'report' | 'drainAlert';

const DOMAIN_BY_METHOD: Record<string, SnsConfigDomain> = {
  snsSetDepositConfig: 'deposit',
  snsSetReportConfig: 'report',
  snsSetDrainAlertConfig: 'drainAlert',
};

export interface PendingConfigProposals {
  pending: Partial<Record<SnsConfigDomain, bigint>>; // domain → newest open proposal id
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// Open (undecided) governance proposals that would execute one of the three
// Unicycle config twins. Function ids are resolved by listing the SNS's
// nervous-system functions and matching target canister + method name — same
// discovery the backend uses; nothing stores baseFunctionId.
export function useSnsPendingConfigProposals(governance: Principal | null): PendingConfigProposals {
  const [pending, setPending] = useState<Partial<Record<SnsConfigDomain, bigint>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!governance) return;
    const env = safeGetCanisterEnv();
    if (!env) return;
    const backendId = env['PUBLIC_CANISTER_ID:unicycle_backend'];
    let cancelled = false;
    setLoading(true);
    const gov = SnsGovernanceCanister.create({ canisterId: governance, agent: buildAgent() });
    (async () => {
      const fns = await gov.listNervousSystemFunctions({ certified: false });
      const domainByFunctionId = new Map<bigint, SnsConfigDomain>();
      for (const fn of fns.functions) {
        const ft = fn.function_type[0];
        if (!ft || !('GenericNervousSystemFunction' in ft)) continue;
        const g = ft.GenericNervousSystemFunction;
        const target = g.target_canister_id[0];
        const method = g.target_method_name[0];
        if (!target || target.toText() !== backendId || !method) continue;
        const domain = DOMAIN_BY_METHOD[method];
        if (domain) domainByFunctionId.set(fn.id, domain);
      }
      const res = await gov.listProposals({
        includeStatus: [SnsProposalDecisionStatus.PROPOSAL_DECISION_STATUS_OPEN],
        limit: 100,
        certified: false,
      });
      const next: Partial<Record<SnsConfigDomain, bigint>> = {};
      for (const p of res.proposals) {
        const action = p.proposal[0]?.action[0];
        if (!action || !('ExecuteGenericNervousSystemFunction' in action)) continue;
        const domain = domainByFunctionId.get(action.ExecuteGenericNervousSystemFunction.function_id);
        const id = p.id[0]?.id;
        // proposals arrive newest-first; keep the newest per domain
        if (domain && id !== undefined && next[domain] === undefined) next[domain] = id;
      }
      return next;
    })()
      .then((next) => {
        if (cancelled) return;
        setPending(next);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [governance, tick]);

  return { pending, loading, error, refresh };
}
