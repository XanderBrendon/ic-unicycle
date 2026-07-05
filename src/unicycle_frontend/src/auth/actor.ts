import type { Identity } from '@icp-sdk/core/agent';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import {
  createActor,
  type Unicycle_backend,
} from '../bindings/unicycle_backend/unicycle_backend';
import { isDelegationExpiredError, notifyAuthExpired } from './authClient';

// Wrap the actor so any backend call rejected due to an expired II delegation
// signals the app to return the user to sign-in, instead of surfacing the raw
// replica error. Applied centrally here so every caller is covered.
function withAuthExpiryGuard(actor: Unicycle_backend): Unicycle_backend {
  return new Proxy(actor, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = value.apply(target, args);
        if (result instanceof Promise) {
          return result.catch((err: unknown) => {
            if (isDelegationExpiredError(err)) notifyAuthExpired();
            throw err;
          });
        }
        return result;
      };
    },
  });
}

declare module '@icp-sdk/core/agent/canister-env' {
  interface CanisterEnv {
    readonly 'PUBLIC_CANISTER_ID:unicycle_backend': string;
  }
}

export function createUnicycleBackendActor(identity?: Identity): Unicycle_backend {
  const env = safeGetCanisterEnv();
  if (!env) {
    throw new Error(
      'No ic_env cookie — deploy via `icp deploy`, or implement the dev-server cookie shim before running `pnpm dev`.',
    );
  }
  return withAuthExpiryGuard(
    createActor(env['PUBLIC_CANISTER_ID:unicycle_backend'], {
      agentOptions: {
        identity,
        host: window.location.origin,
        rootKey: env.IC_ROOT_KEY,
      },
    }),
  );
}
