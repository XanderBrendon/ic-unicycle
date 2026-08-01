import { useCallback, useEffect, useRef, useState } from 'react';
import type { Principal } from '@icp-sdk/core/principal';
import { fetchSnsInfo, loadSnsInfo, saveSnsInfo, type SnsInfo } from './snsInfo';

export interface SnsInfos {
  infos: Record<string, SnsInfo | undefined>; // keyed by root text
  refreshing: Record<string, boolean>;
  refresh: (root: Principal) => void;
  errors: Record<string, string | undefined>; // keyed by root text
}

// Cache-first name/governance lookup for every administered root. `refresh`
// forces a refetch for one root (the SNS page's refresh button).
// `governanceByRoot` (from `getOnboardedSnsRoots`) saves the root-canister hop
// for the roots it covers; roots it doesn't — user-tracked SNSes that were
// never onboarded — fall back to asking the SNS root canister.
export function useSnsInfos(roots: Principal[] | null, governanceByRoot: Record<string, Principal>): SnsInfos {
  const [infos, setInfos] = useState<Record<string, SnsInfo | undefined>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const load = useCallback((root: Principal, force: boolean) => {
    const key = root.toText();
    if (inFlight.current.has(key)) return;
    if (!force) {
      const cached = loadSnsInfo(key);
      if (cached) {
        setInfos((m) => (m[key] ? m : { ...m, [key]: cached }));
        return;
      }
    }
    inFlight.current.add(key);
    setRefreshing((m) => ({ ...m, [key]: true }));
    fetchSnsInfo(root, governanceByRoot[key])
      .then((info) => {
        saveSnsInfo(info);
        setInfos((m) => ({ ...m, [key]: info }));
        setErrors((m) => ({ ...m, [key]: undefined }));
      })
      .catch((e: unknown) => setErrors((m) => ({ ...m, [key]: e instanceof Error ? e.message : String(e) })))
      .finally(() => {
        inFlight.current.delete(key);
        setRefreshing((m) => ({ ...m, [key]: false }));
      });
  }, [governanceByRoot]);

  useEffect(() => {
    for (const root of roots ?? []) load(root, false);
  }, [roots, load]);

  const refresh = useCallback((root: Principal) => load(root, true), [load]);

  return { infos, refreshing, refresh, errors };
}
