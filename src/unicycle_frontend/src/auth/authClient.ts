import { AuthClient } from '@icp-sdk/auth/client';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';

// II delegation lifetime: 7 days (well under II's 30-day maximum).
const MAX_TIME_TO_LIVE_NS = BigInt(7) * BigInt(24) * BigInt(3_600_000_000_000);

// Use the mainnet II frontend (`https://id.ai`) in both local and production.
// `icp-cli` ≥ 0.2.4 sets up the local replica to validate signatures from
// id.ai, which sidesteps the cross-subnet delegation-trust gap a locally
// deployed II canister hits when calling pre-installed system ledgers.
// See the `internet-identity` skill's "Using II during local development".
const II_PROVIDER_URL = 'https://id.ai/authorize';

// Canonical origin every principal is derived from. By pinning the derivation
// origin to the frontend canister's own URL (production frontend id, see
// .icp/data/mappings/production.ids.json), a user's principal is identical
// whether they reach the app through the canister URL or a custom domain
// (ic-unicycle.com), and it stays fixed across any future domain change. The
// custom domain is authorized for this via /.well-known/ii-alternative-origins
// served from this canister.
const CANISTER_ORIGIN = 'https://2fdf7-yyaaa-aaaan-q6h5q-cai.icp0.io';

// Skip the derivation origin during local dev: mainnet II would reject a
// localhost origin that isn't listed in the production ii-alternative-origins
// file. Local sessions keep their (throwaway) origin-derived principal.
function getDerivationOrigin(): string | undefined {
  const host = window.location.hostname;
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost');
  return isLocal ? undefined : CANISTER_ORIGIN;
}

let client: AuthClient | undefined;

export function getAuthClient(): AuthClient {
  if (!client) {
    client = new AuthClient({
      identityProvider: II_PROVIDER_URL,
      derivationOrigin: getDerivationOrigin(),
      idleOptions: { disableIdle: true },
    });
  }
  return client;
}

export function isAuthenticated(): boolean {
  return getAuthClient().isAuthenticated();
}

export async function getIdentity(): Promise<Identity> {
  return getAuthClient().getIdentity();
}

export async function getPrincipal(): Promise<Principal> {
  const identity = await getIdentity();
  return identity.getPrincipal();
}

export async function login(): Promise<Identity> {
  try {
    return await getAuthClient().signIn({ maxTimeToLive: MAX_TIME_TO_LIVE_NS });
  } catch (err) {
    console.error('Internet Identity sign-in failed:', err);
    throw err;
  }
}

export async function logout(): Promise<void> {
  await getAuthClient().signOut();
}

// True when an agent/replica error is caused by an expired II delegation. The
// replica rejects such calls with e.g. "Invalid delegation expiry: Specified
// sender delegation has expired". `isAuthenticated()` only reflects expiry at
// page load, so a session that expires mid-use surfaces here instead.
export function isDelegationExpiredError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  return /invalid delegation expiry|delegation has expired/i.test(message);
}

// Notify listeners (see useAuth) that the current session's delegation expired
// so the app can drop back to the sign-in screen. There is no auth context to
// prop-drill through, so backend calls signal expiry via this module-level bus.
type AuthExpiredListener = () => void;
const authExpiredListeners = new Set<AuthExpiredListener>();

export function onAuthExpired(listener: AuthExpiredListener): () => void {
  authExpiredListeners.add(listener);
  return () => authExpiredListeners.delete(listener);
}

export function notifyAuthExpired(): void {
  for (const listener of authExpiredListeners) listener();
}
