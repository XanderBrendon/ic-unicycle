import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import { unexpectedError, type UserError } from '../ui/format';
import { formatAdminError } from './useAdmins';

export interface UseServiceConfigResult {
  icpSwapPool: Principal | null;
  blackhole: Principal | null;
  snsWasm: Principal | null;
  loading: boolean;
  error: UserError | null;
  refresh: () => void;
  setIcpSwapPool: (text: string) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>;
  setBlackholeCanister: (text: string) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>;
}

export function useServiceConfig(identity: Identity | null): UseServiceConfigResult {
  const [icpSwapPool, setIcpSwapPoolState] = useState<Principal | null>(null);
  const [blackhole, setBlackhole] = useState<Principal | null>(null);
  const [snsWasm, setSnsWasm] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UserError | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setIcpSwapPoolState(null);
      setBlackhole(null);
      setSnsWasm(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const backend = createUnicycleBackendActor(identity);
    Promise.all([backend.getIcpSwapPool(), backend.getBlackholeCanister(), backend.getSnsWasmCanister()])
      .then(([pool, bh, sns]) => {
        if (cancelled) return;
        setIcpSwapPoolState(pool);
        setBlackhole(bh);
        setSnsWasm(sns);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setIcpSwapPoolState(null);
        setBlackhole(null);
        setSnsWasm(null);
        setError(unexpectedError('load the service config', e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  const setIcpSwapPool = useCallback(
    async (text: string) => {
      if (!identity) return { ok: false as const, message: "You're not signed in — sign in and try again." };
      let p: Principal;
      try {
        p = Principal.fromText(text.trim());
      } catch {
        return {
          ok: false as const,
          message: "That isn't a valid canister id — paste the ICPSwap pool's canister id.",
        };
      }
      try {
        const result = await createUnicycleBackendActor(identity).setIcpSwapPool(p);
        if (result.__kind__ === 'ok') {
          refresh();
          return { ok: true as const };
        }
        return { ok: false as const, ...formatAdminError(result.err) };
      } catch (e) {
        return { ok: false as const, ...unexpectedError('update the service config', e) };
      }
    },
    [identity, refresh],
  );

  const setBlackholeCanister = useCallback(
    async (text: string) => {
      if (!identity) return { ok: false as const, message: "You're not signed in — sign in and try again." };
      let p: Principal;
      try {
        p = Principal.fromText(text.trim());
      } catch {
        return {
          ok: false as const,
          message: "That isn't a valid canister id — paste the blackhole canister's canister id.",
        };
      }
      try {
        const result = await createUnicycleBackendActor(identity).setBlackholeCanister(p);
        if (result.__kind__ === 'ok') {
          refresh();
          return { ok: true as const };
        }
        return { ok: false as const, ...formatAdminError(result.err) };
      } catch (e) {
        return { ok: false as const, ...unexpectedError('update the service config', e) };
      }
    },
    [identity, refresh],
  );

  return { icpSwapPool, blackhole, snsWasm, loading, error, refresh, setIcpSwapPool, setBlackholeCanister };
}
