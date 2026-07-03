import { useEffect, useState } from 'react';
import { Principal } from '@icp-sdk/core/principal';
import { SnsRootCanister, type SnsRootDid } from '@icp-sdk/canisters/sns';
import { buildAgent } from '../wallet/agent';

export interface SnsCanisterEntry {
  canisterId: Principal;
  kind: 'root' | 'governance' | 'ledger' | 'index' | 'swap' | 'dapp' | 'archive' | 'extension';
  defaultName: string;
}

// Singletons are named by their role; grouped canisters get `${base}_${first5}`
// where first5 is the principal's leading 5-char block (e.g. dapp_5ceyv).
export function normalizeSnsCanisters(res: SnsRootDid.ListSnsCanistersResponse): SnsCanisterEntry[] {
  const out: SnsCanisterEntry[] = [];
  const single = (
    opt: [] | [Principal],
    kind: Extract<SnsCanisterEntry['kind'], 'root' | 'governance' | 'ledger' | 'index' | 'swap'>,
  ) => {
    const p = opt[0];
    if (p) out.push({ canisterId: p, kind, defaultName: kind });
  };
  const group = (
    ids: Principal[],
    kind: Extract<SnsCanisterEntry['kind'], 'dapp' | 'archive' | 'extension'>,
  ) => {
    for (const p of ids) out.push({ canisterId: p, kind, defaultName: `${kind}_${p.toText().slice(0, 5)}` });
  };

  single(res.root, 'root');
  single(res.governance, 'governance');
  single(res.ledger, 'ledger');
  single(res.index, 'index');
  single(res.swap, 'swap');
  group(res.dapps, 'dapp');
  group(res.archives, 'archive');
  group(res.extensions[0]?.extension_canister_ids ?? [], 'extension');
  return out;
}

export function useSnsCanisterList(root: Principal): {
  entries: SnsCanisterEntry[] | null;
  loading: boolean;
  error: string | null;
} {
  const [entries, setEntries] = useState<SnsCanisterEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setEntries(null);
    setError(null);
    const rootCanister = SnsRootCanister.create({ canisterId: root, agent: buildAgent() });
    rootCanister
      .listSnsCanisters({ certified: false })
      .then((res) => {
        if (cancelled) return;
        setEntries(normalizeSnsCanisters(res));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

  return { entries, loading, error };
}
