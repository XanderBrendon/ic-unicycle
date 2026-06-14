import { AuthClient } from '@icp-sdk/auth/client';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';

const MAX_TIME_TO_LIVE_NS = BigInt(8) * BigInt(3_600_000_000_000);

// Use the mainnet II frontend (`https://id.ai`) in both local and production.
// `icp-cli` ≥ 0.2.4 sets up the local replica to validate signatures from
// id.ai, which sidesteps the cross-subnet delegation-trust gap a locally
// deployed II canister hits when calling pre-installed system ledgers.
// See the `internet-identity` skill's "Using II during local development".
const II_PROVIDER_URL = 'https://id.ai/authorize';

let client: AuthClient | undefined;

export function getAuthClient(): AuthClient {
  if (!client) {
    client = new AuthClient({
      identityProvider: II_PROVIDER_URL,
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
