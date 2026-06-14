// Admin-only LP funding flow. Mirrors wallet/useDeposit: approve the backend to
// pull TCYCLES from the admin's wallet, then call adminFundLpPosition, which
// folds the funds into the Unicycle-owned ICPSwap position. TCYCLES-only.
import { useCallback, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister, toCandidAccount } from '@icp-sdk/canisters/ledger/icrc';
import { buildAgent } from '../wallet/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { formatLedgerThrow } from '../wallet/ledgerErrors';
import { BUILT_IN_TOKENS } from '../wallet/tokens';
import { AdminError } from '../bindings/unicycle_backend/unicycle_backend';
import type { LpEvent } from '../bindings/unicycle_backend/unicycle_backend';

const TCYCLES = BUILT_IN_TOKENS.find((t) => t.symbol === 'TCYCLES')!;
const APPROVE_EXPIRY_MS = 5 * 60 * 1000;

export type FundLpStatus =
  | { kind: 'idle' }
  | { kind: 'approving' }
  | { kind: 'funding' }
  | { kind: 'success'; event: LpEvent }
  | { kind: 'error'; phase: 'approve' | 'fund'; message: string; detail?: string };

export interface UseFundLpResult {
  status: FundLpStatus;
  fund: (amount: bigint) => Promise<void>;
  reset: () => void;
}

function getBackendPrincipal(): Principal {
  const env = safeGetCanisterEnv();
  if (!env) {
    throw new Error(
      'No ic_env cookie — deploy via `icp deploy`, or implement the dev-server cookie shim before running `pnpm dev`.',
    );
  }
  return Principal.fromText(env['PUBLIC_CANISTER_ID:unicycle_backend']);
}

function gateError(err: AdminError): string {
  switch (err) {
    case AdminError.anonymous:
      return "Anonymous sessions can't fund the LP — sign in and try again.";
    case AdminError.notAdmin:
      return 'Only admins can fund the LP position.';
  }
}

export function useFundLp(identity: Identity | null): UseFundLpResult {
  const [status, setStatus] = useState<FundLpStatus>({ kind: 'idle' });

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);

  const fund = useCallback(
    async (amount: bigint) => {
      if (!identity) {
        setStatus({ kind: 'error', phase: 'approve', message: "You're not signed in — sign in and try again." });
        return;
      }
      if (amount <= 0n) {
        setStatus({ kind: 'error', phase: 'approve', message: 'Enter an amount greater than zero.' });
        return;
      }

      let backendPrincipal: Principal;
      try {
        backendPrincipal = getBackendPrincipal();
      } catch (e) {
        setStatus({ kind: 'error', phase: 'approve', message: e instanceof Error ? e.message : String(e) });
        return;
      }

      const agent = buildAgent(identity);
      const ledger = IcrcLedgerCanister.create({
        agent,
        canisterId: Principal.fromText(TCYCLES.ledgerCanisterId),
      });

      // Step 1: approve the backend to pull `amount + fee` (transfer_from also
      // charges a fee, so the allowance must cover it).
      setStatus({ kind: 'approving' });
      const expiresAtNs = BigInt(Date.now() + APPROVE_EXPIRY_MS) * 1_000_000n;
      try {
        await ledger.approve({
          spender: toCandidAccount({ owner: backendPrincipal }),
          amount: amount + TCYCLES.fee,
          expires_at: expiresAtNs,
        });
      } catch (e) {
        setStatus({ kind: 'error', phase: 'approve', ...formatLedgerThrow('approve the LP funding', e, TCYCLES) });
        return;
      }

      // Step 2: the backend pulls the funds via icrc2_transfer_from and folds
      // them into the position.
      setStatus({ kind: 'funding' });
      try {
        const backend = createUnicycleBackendActor(identity);
        const result = await backend.adminFundLpPosition(amount);
        if (result.__kind__ === 'err') {
          setStatus({ kind: 'error', phase: 'fund', message: gateError(result.err) });
          return;
        }
        // The actor call succeeded, but the LpEvent's own outcome can still be an
        // error (the wallet pull or a pool step failed) — surface that text.
        if (result.ok.outcome.__kind__ === 'err') {
          setStatus({ kind: 'error', phase: 'fund', message: 'LP funding failed', detail: result.ok.outcome.err });
          return;
        }
        setStatus({ kind: 'success', event: result.ok });
      } catch (e) {
        setStatus({ kind: 'error', phase: 'fund', message: e instanceof Error ? e.message : String(e) });
      }
    },
    [identity],
  );

  return { status, fund, reset };
}
