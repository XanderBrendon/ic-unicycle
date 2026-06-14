import type { Identity } from '@icp-sdk/core/agent';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import {
  createActor,
  type Unicycle_backend,
} from '../bindings/unicycle_backend/unicycle_backend';

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
  return createActor(env['PUBLIC_CANISTER_ID:unicycle_backend'], {
    agentOptions: {
      identity,
      host: window.location.origin,
      rootKey: env.IC_ROOT_KEY,
    },
  });
}
