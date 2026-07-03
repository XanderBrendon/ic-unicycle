import { useCallback, useEffect, useState } from 'react';
import { Principal } from '@icp-sdk/core/principal';

// Hash-based client routing. Hash routing needs no asset-canister SPA fallback:
// refreshing or deep-linking `#/...` always loads index.html on the IC.

export type Page = 'overview' | 'wallet' | 'admin';
export type AdminTab = 'overview' | 'trends' | 'logs';
export type SnsTab = 'overview' | 'settings';

export type Route =
  | { page: 'overview' }
  | { page: 'wallet' }
  | { page: 'admin'; tab: AdminTab }
  | { page: 'canister'; id: Principal }
  | { page: 'sns'; root: Principal; tab: SnsTab }
  | { page: 'snsCanister'; root: Principal; id: Principal }
  | { page: 'trackedSns'; root: Principal }
  | { page: 'blackholed' };

export function parseHash(rawHash: string): Route {
  const segments = rawHash.replace(/^#/, '').split('/').filter(Boolean);
  switch (segments[0]) {
    case 'wallet':
      return { page: 'wallet' };
    case 'admin': {
      const tab = segments[1];
      return { page: 'admin', tab: tab === 'trends' || tab === 'logs' ? tab : 'overview' };
    }
    case 'canister':
      if (segments[1]) {
        try {
          return { page: 'canister', id: Principal.fromText(segments[1]) };
        } catch {
          return { page: 'overview' };
        }
      }
      return { page: 'overview' };
    case 'sns': {
      if (!segments[1]) return { page: 'overview' };
      let root: Principal;
      try {
        root = Principal.fromText(segments[1]);
      } catch {
        return { page: 'overview' };
      }
      if (segments[2] === 'canister' && segments[3]) {
        try {
          return { page: 'snsCanister', root, id: Principal.fromText(segments[3]) };
        } catch {
          return { page: 'sns', root, tab: 'overview' };
        }
      }
      return { page: 'sns', root, tab: segments[2] === 'settings' ? 'settings' : 'overview' };
    }
    case 'blackholed':
      return { page: 'blackholed' };
    case 'tracked': {
      if (!segments[1]) return { page: 'overview' };
      try {
        return { page: 'trackedSns', root: Principal.fromText(segments[1]) };
      } catch {
        return { page: 'overview' };
      }
    }
    default:
      return { page: 'overview' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.page) {
    case 'wallet':
      return '#/wallet';
    case 'admin':
      return route.tab === 'overview' ? '#/admin' : `#/admin/${route.tab}`;
    case 'canister':
      return `#/canister/${route.id.toText()}`;
    case 'sns':
      return route.tab === 'overview'
        ? `#/sns/${route.root.toText()}`
        : `#/sns/${route.root.toText()}/settings`;
    case 'snsCanister':
      return `#/sns/${route.root.toText()}/canister/${route.id.toText()}`;
    case 'trackedSns':
      return `#/tracked/${route.root.toText()}`;
    case 'blackholed':
      return '#/blackholed';
    case 'overview':
      return '#/overview';
  }
}

export interface UseHashRouteResult {
  route: Route;
  navigate: (route: Route, opts?: { replace?: boolean }) => void;
}

export function useHashRoute(): UseHashRouteResult {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((next: Route, opts?: { replace?: boolean }) => {
    const hash = routeToHash(next);
    if (opts?.replace) {
      // replaceState avoids a back-button bounce on guard redirects; it does not
      // fire `hashchange`, so update state directly.
      window.history.replaceState(null, '', hash);
      setRoute(next);
    } else if (window.location.hash !== hash) {
      window.location.hash = hash; // fires `hashchange` → setRoute
    }
  }, []);

  return { route, navigate };
}
