import { useCallback, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { safeGetCanisterEnv } from '@icp-sdk/core/agent/canister-env';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister, toCandidAccount } from '@icp-sdk/canisters/ledger/icrc';
import { buildAgent } from './agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { unexpectedError, type UserError } from '../ui/format';
import type { TokenInfo } from './tokens';
import { formatLedgerError, formatLedgerThrow } from './ledgerErrors';
import type { DepositError } from '../bindings/unicycle_backend/unicycle_backend';

export type DepositStatus =
  | { kind: 'idle' }
  | { kind: 'approving' }
  | { kind: 'transferring' }
  | { kind: 'success'; blockIndex: bigint }
  | { kind: 'error'; phase: 'approve' | 'transfer'; message: string; detail?: string };

export interface UseDepositResult {
  status: DepositStatus;
  deposit: (token: TokenInfo, amount: bigint) => Promise<void>;
  reset: () => void;
}

function formatDepositError(err: DepositError, token: TokenInfo): UserError {
  switch (err.__kind__) {
    case 'anonymous':
      return { message: "Anonymous sessions can't deposit — sign in and try again." };
    case 'zeroAmount':
      return { message: 'Enter an amount greater than zero.' };
    case 'transferFrom':
      return formatLedgerError(err.transferFrom, token);
  }
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

const APPROVE_EXPIRY_MS = 5 * 60 * 1000;

export function useDeposit(identity: Identity | null): UseDepositResult {
  const [status, setStatus] = useState<DepositStatus>({ kind: 'idle' });

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);

  const deposit = useCallback(
    async (token: TokenInfo, amount: bigint) => {
      if (!identity) {
        setStatus({
          kind: 'error',
          phase: 'approve',
          message: "You're not signed in — sign in and try again.",
        });
        return;
      }
      if (amount <= 0n) {
        setStatus({
          kind: 'error',
          phase: 'approve',
          message: 'Enter an amount greater than zero.',
        });
        return;
      }
      if (token.backendToken === undefined) {
        setStatus({
          kind: 'error',
          phase: 'approve',
          message:
            'Only built-in tokens (ICP and TCYCLES) can be deposited to Unicycle — custom tokens are display and send only.',
        });
        return;
      }
      const backendToken = token.backendToken;

      let backendPrincipal: Principal;
      try {
        backendPrincipal = getBackendPrincipal();
      } catch (e) {
        // Thrown message is already instructive (missing ic_env cookie in dev).
        setStatus({
          kind: 'error',
          phase: 'approve',
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }
      const agent = buildAgent(identity);
      const ledger = IcrcLedgerCanister.create({
        agent,
        canisterId: Principal.fromText(token.ledgerCanisterId),
      });

      // Step 1: approve the backend to pull `amount + fee` (transfer_from
      // also charges a fee, so the approved allowance must cover it).
      setStatus({ kind: 'approving' });
      const expiresAtNs = BigInt(Date.now() + APPROVE_EXPIRY_MS) * 1_000_000n;
      try {
        await ledger.approve({
          spender: toCandidAccount({ owner: backendPrincipal }),
          amount: amount + token.fee,
          expires_at: expiresAtNs,
        });
      } catch (e) {
        setStatus({
          kind: 'error',
          phase: 'approve',
          ...formatLedgerThrow('approve the deposit', e, token),
        });
        return;
      }

      // Step 2: call the backend, which pulls the funds via icrc2_transfer_from.
      setStatus({ kind: 'transferring' });
      try {
        const backend = createUnicycleBackendActor(identity);
        const result = await backend.deposit(backendToken, amount);
        if (result.__kind__ === 'ok') {
          setStatus({ kind: 'success', blockIndex: result.ok });
        } else {
          setStatus({
            kind: 'error',
            phase: 'transfer',
            ...formatDepositError(result.err, token),
          });
        }
      } catch (e) {
        setStatus({
          kind: 'error',
          phase: 'transfer',
          ...unexpectedError('complete the deposit', e),
        });
      }
    },
    [identity],
  );

  return { status, deposit, reset };
}
