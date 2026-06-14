import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import { unexpectedError, type UserError } from '../ui/format';
import { AdminError } from '../bindings/unicycle_backend/unicycle_backend';

export interface UseAdminsResult {
  admins: Principal[] | null;
  cachedControllers: Principal[] | null;
  primaryAdmin: Principal | null;
  loading: boolean;
  error: UserError | null;
  refresh: () => void;
  addAdmin: (text: string) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>;
  removeAdmin: (p: Principal) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>;
  setPrimaryAdmin: (p: Principal) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>;
}

export function formatAdminError(err: AdminError | string): UserError {
  if (typeof err === 'string') return { message: err };
  switch (err) {
    case AdminError.anonymous:
      return { message: "Anonymous sessions can't perform admin actions — sign in with an admin identity." };
    case AdminError.notAdmin:
      return { message: 'Only admins can do this — switch to an admin identity, or ask an existing admin to add yours.' };
    default:
      return { message: 'Unknown error.', detail: JSON.stringify(err) };
  }
}

export function useAdmins(identity: Identity | null): UseAdminsResult {
  const [admins, setAdmins] = useState<Principal[] | null>(null);
  const [cachedControllers, setCachedControllers] = useState<Principal[] | null>(null);
  const [primaryAdmin, setPrimaryAdminState] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UserError | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setAdmins(null);
      setCachedControllers(null);
      setPrimaryAdminState(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const backend = createUnicycleBackendActor(identity);
    Promise.all([backend.getAdmins(), backend.getCachedControllers(), backend.getPrimaryAdmin()])
      .then(([a, c, primary]) => {
        if (cancelled) return;
        setAdmins(a);
        setCachedControllers(c);
        setPrimaryAdminState(primary ?? null);
        setError(null);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAdmins(null);
        setCachedControllers(null);
        setPrimaryAdminState(null);
        setError(unexpectedError('load admin data', e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [identity, tick]);

  const addAdmin = useCallback(
    async (text: string) => {
      if (!identity) return { ok: false as const, message: "You're not signed in — sign in and try again." };
      let p: Principal;
      try {
        p = Principal.fromText(text.trim());
      } catch {
        return {
          ok: false as const,
          message: "That isn't a valid principal — paste the new admin's full principal text.",
        };
      }
      try {
        const result = await createUnicycleBackendActor(identity).addAdmin(p);
        if (result.__kind__ === 'ok') {
          refresh();
          return { ok: true as const };
        }
        return { ok: false as const, ...formatAdminError(result.err) };
      } catch (e) {
        return { ok: false as const, ...unexpectedError('update admins', e) };
      }
    },
    [identity, refresh],
  );

  const removeAdmin = useCallback(
    async (p: Principal) => {
      if (!identity) return { ok: false as const, message: "You're not signed in — sign in and try again." };
      try {
        const result = await createUnicycleBackendActor(identity).removeAdmin(p);
        if (result.__kind__ === 'ok') {
          refresh();
          return { ok: true as const };
        }
        return { ok: false as const, ...formatAdminError(result.err) };
      } catch (e) {
        return { ok: false as const, ...unexpectedError('update admins', e) };
      }
    },
    [identity, refresh],
  );

  const setPrimaryAdmin = useCallback(
    async (p: Principal) => {
      if (!identity) return { ok: false as const, message: "You're not signed in — sign in and try again." };
      try {
        const result = await createUnicycleBackendActor(identity).setPrimaryAdmin(p);
        if (result.__kind__ === 'ok') {
          refresh();
          return { ok: true as const };
        }
        return { ok: false as const, ...formatAdminError(result.err) };
      } catch (e) {
        return { ok: false as const, ...unexpectedError('update admins', e) };
      }
    },
    [identity, refresh],
  );

  return {
    admins,
    cachedControllers,
    primaryAdmin,
    loading,
    error,
    refresh,
    addAdmin,
    removeAdmin,
    setPrimaryAdmin,
  };
}
