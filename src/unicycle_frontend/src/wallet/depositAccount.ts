// -----------------------------------------------------------------------------
// SYNC-BINDING: the encoding produced by `principalToSubaccount` below is the
// TS twin of `principalToSubaccount` in `src/unicycle_backend/main.mo`. The two
// MUST stay byte-for-byte identical — any divergence would corrupt every read
// against an existing deposit (US03 wrote with the backend encoding; this
// helper reads at the same address without a network round-trip). Per US03,
// this is a forever-stable on-chain identifier. Any change to the encoding
// must land in BOTH files in the SAME commit.
// -----------------------------------------------------------------------------

import { Principal } from '@icp-sdk/core/principal';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import type { IcrcAccount } from '@icp-sdk/canisters/ledger/icrc';

// 32-byte subaccount: 1-byte length prefix + principal bytes + zero pad.
export function principalToSubaccount(p: Principal): Uint8Array {
  const principalBytes = p.toUint8Array();
  const length = principalBytes.length;
  const subaccount = new Uint8Array(32);
  subaccount[0] = length;
  subaccount.set(principalBytes, 1);
  return subaccount;
}

export function depositAccountFor(owner: Principal): IcrcAccount {
  const env = safeGetCanisterEnv();
  if (!env) {
    throw new Error(
      'No ic_env cookie — deploy via `icp deploy`, or implement the dev-server cookie shim before running `pnpm dev`.',
    );
  }
  return {
    owner: Principal.fromText(env['PUBLIC_CANISTER_ID:unicycle_backend']),
    subaccount: principalToSubaccount(owner),
  };
}
