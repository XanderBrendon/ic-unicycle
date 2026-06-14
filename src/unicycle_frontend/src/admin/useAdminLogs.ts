import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import type {
  LogCategory,
  LogEntry,
  LogLevel,
} from '../bindings/unicycle_backend/unicycle_backend';

export interface AdminLogsState {
  entries: LogEntry[] | null; // newest-first, accumulated across pages
  level: LogLevel | null;
  category: LogCategory | null;
  setLevel: (level: LogLevel | null) => void;
  setCategory: (category: LogCategory | null) => void;
  loadMore: () => void;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const PAGE_SIZE = 50n;

// Paged reader for adminGetLogs. Filter changes and refresh() reset to the
// first page; loadMore() appends the next page using the last entry's seq as
// the strictly-below cursor. A full page means there may be more.
export function useAdminLogs(identity: Identity | null): AdminLogsState {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [level, setLevel] = useState<LogLevel | null>(null);
  const [category, setCategory] = useState<LogCategory | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  // null = load the first page; a seq = append the page below that cursor.
  const [cursor, setCursor] = useState<bigint | null>(null);

  const refresh = useCallback(() => {
    setCursor(null);
    setTick((n) => n + 1);
  }, []);

  const updateLevel = useCallback((next: LogLevel | null) => {
    setLevel(next);
    setCursor(null);
    setTick((n) => n + 1);
  }, []);

  const updateCategory = useCallback((next: LogCategory | null) => {
    setCategory(next);
    setCursor(null);
    setTick((n) => n + 1);
  }, []);

  const loadMore = useCallback(() => {
    setEntries((prev) => {
      const last = prev?.[prev.length - 1];
      if (last) {
        setCursor(last.seq);
        setTick((n) => n + 1);
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    if (!identity) {
      setEntries(null);
      setError(null);
      setLoading(false);
      setHasMore(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const backend = createUnicycleBackendActor(identity);
    backend
      .adminGetLogs({
        limit: PAGE_SIZE,
        ...(level !== null ? { level } : {}),
        ...(category !== null ? { category } : {}),
        ...(cursor !== null ? { beforeSeq: cursor } : {}),
      })
      .then((res) => {
        if (cancelled) return;
        if (res.__kind__ === 'ok') {
          const page = res.ok;
          setEntries((prev) => (cursor !== null && prev ? [...prev, ...page] : page));
          setHasMore(BigInt(page.length) === PAGE_SIZE);
          setError(null);
        } else {
          setError(JSON.stringify(res.err));
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, tick]);

  return {
    entries,
    level,
    category,
    setLevel: updateLevel,
    setCategory: updateCategory,
    loadMore,
    hasMore,
    loading,
    error,
    refresh,
  };
}
