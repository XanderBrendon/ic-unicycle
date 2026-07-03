import { useCallback, useEffect, useRef, useState } from 'react';
import { Principal } from '@icp-sdk/core/principal';

// Directory of all SNSes (name + root canister id) from the public dashboard
// SNS API — a picker convenience only: addTrackedSns re-validates the root
// against the on-chain SNS-Wasm registry, so this list is not a trust anchor.
// Cached in localStorage like sns/snsInfo.ts; refreshed when older than a day
// or via the modal's refresh button.

export interface SnsDirectoryEntry {
  rootId: string;
  name: string;
}

const CACHE_KEY = 'unicycle:snsDirectory';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BASE = 'https://sns-api.internetcomputer.org/api/v2/snses';

interface CacheShape {
  entries: SnsDirectoryEntry[];
  fetchedAt: number;
}

function loadCache(): CacheShape | null {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CacheShape;
    if (!Array.isArray(parsed?.entries) || typeof parsed?.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(entries: SnsDirectoryEntry[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ entries, fetchedAt: Date.now() } satisfies CacheShape));
}

interface ApiSns {
  name?: string | null;
  root_canister_id?: string | null;
}
interface ApiPage {
  data: ApiSns[];
  next_cursor: string | null;
}

export async function fetchSnsDirectory(): Promise<SnsDirectoryEntry[]> {
  const entries: SnsDirectoryEntry[] = [];
  let after: string | null = null;
  do {
    const url: string = after
      ? `${BASE}?limit=100&after=${encodeURIComponent(after)}`
      : `${BASE}?limit=100`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`SNS API returned ${res.status}`);
    const page = (await res.json()) as ApiPage;
    for (const sns of page.data) {
      const rootId = sns.root_canister_id;
      if (!rootId) continue;
      try {
        Principal.fromText(rootId);
      } catch {
        continue;
      }
      entries.push({ rootId, name: sns.name?.trim() || rootId });
    }
    after = page.next_cursor;
  } while (after !== null);
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export function useSnsDirectory(): {
  entries: SnsDirectoryEntry[] | null;
  loading: boolean;
  error: string | null;
  stale: boolean; // showing a cached list after a failed refresh
  refresh: () => void;
} {
  const [entries, setEntries] = useState<SnsDirectoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback((force: boolean) => {
    if (inFlight.current) return;
    const cached = loadCache();
    if (cached) setEntries(cached.entries);
    const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
    if (fresh && !force) return;
    inFlight.current = true;
    setLoading(true);
    fetchSnsDirectory()
      .then((list) => {
        saveCache(list);
        setEntries(list);
        setError(null);
        setStale(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setStale(!!cached);
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, []);

  useEffect(() => load(false), [load]);
  const refresh = useCallback(() => load(true), [load]);

  return { entries, loading, error, stale, refresh };
}
