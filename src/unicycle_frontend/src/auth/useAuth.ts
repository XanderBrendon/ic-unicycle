import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import {
  getIdentity,
  isAuthenticated,
  login,
  logout,
  onAuthExpired,
} from './authClient';

export interface UseAuth {
  identity: Identity | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuth {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isAuthenticated()) {
        const id = await getIdentity();
        if (!cancelled) setIdentity(id);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Delegation expired mid-session: drop the identity so the app falls back to
  // the sign-in screen, and clear the stale delegation from storage.
  useEffect(
    () =>
      onAuthExpired(() => {
        void logout();
        setIdentity(null);
      }),
    [],
  );

  const signIn = useCallback(async () => {
    const id = await login();
    setIdentity(id);
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setIdentity(null);
  }, []);

  return { identity, loading, signIn, signOut };
}
