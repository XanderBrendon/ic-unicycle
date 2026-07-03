import { useCallback, useEffect, useState } from 'react';
import type { Principal } from '@icp-sdk/core/principal';
import { fetchSnsInfo, loadSnsInfo, saveSnsInfo, type SnsInfo } from './snsInfo';

export interface SnsInfos {
  infos: Record<string, SnsInfo | undefined>; // keyed by root text
  refreshing: Record<string, boolean>;
  refresh: (root: Principal) => void;
  error: string | null;
}

// Cache-first name/governance lookup for every administered root. `refresh`
// forces a refetch for one root (the SNS page's refresh button).
export function useSnsInfos(roots: Principal[] | null): SnsInfos {
  const [infos, setInfos] = useState<Record<string, SnsInfo | undefined>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((root: Principal, force: boolean) => {
    const key = root.toText();
    if (!force) {
      const cached = loadSnsInfo(key);
      if (cached) {
        setInfos((m) => (m[key] ? m : { ...m, [key]: cached }));
        return;
      }
    }
    setRefreshing((m) => ({ ...m, [key]: true }));
    fetchSnsInfo(root)
      .then((info) => {
        saveSnsInfo(info);
        setInfos((m) => ({ ...m, [key]: info }));
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRefreshing((m) => ({ ...m, [key]: false })));
  }, []);

  useEffect(() => {
    for (const root of roots ?? []) load(root, false);
  }, [roots, load]);

  const refresh = useCallback((root: Principal) => load(root, true), [load]);

  return { infos, refreshing, refresh, error };
}
