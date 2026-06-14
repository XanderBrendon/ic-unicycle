import { HttpAgent, type Identity } from '@icp-sdk/core/agent';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';

export function buildAgent(identity?: Identity): HttpAgent {
  const env = safeGetCanisterEnv();
  if (!env) {
    throw new Error(
      'No ic_env cookie — deploy via `icp deploy`, or implement the dev-server cookie shim before running `pnpm dev`.',
    );
  }
  return HttpAgent.createSync({
    identity,
    host: window.location.origin,
    rootKey: env.IC_ROOT_KEY,
  });
}
