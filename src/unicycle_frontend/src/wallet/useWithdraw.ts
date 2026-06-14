import { useCallback, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { unexpectedError, type UserError } from '../ui/format';
import type { TokenInfo } from './tokens';
import { formatLedgerError } from './ledgerErrors';
import type { WithdrawError } from '../bindings/unicycle_backend/unicycle_backend';

export type WithdrawStatus =
  | { kind: 'idle' }
  | { kind: 'transferring' }
  | { kind: 'success'; blockIndex: bigint }
  | { kind: 'error'; message: string; detail?: string };

export interface UseWithdrawResult {
  status: WithdrawStatus;
  withdraw: (token: TokenInfo, amount: bigint) => Promise<void>;
  reset: () => void;
}

function formatWithdrawError(err: WithdrawError, token: TokenInfo): UserError {
  switch (err.__kind__) {
    case 'anonymous':
      return { message: "Anonymous sessions can't withdraw — sign in and try again." };
    case 'zeroAmount':
      return { message: 'Enter an amount greater than zero.' };
    case 'transfer':
      return formatLedgerError(err.transfer, token);
  }
}

export function useWithdraw(
  identity: Identity | null,
  onSuccess?: () => void,
): UseWithdrawResult {
  const [status, setStatus] = useState<WithdrawStatus>({ kind: 'idle' });

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);

  const withdraw = useCallback(
    async (token: TokenInfo, amount: bigint) => {
      if (!identity) {
        setStatus({ kind: 'error', message: "You're not signed in — sign in and try again." });
        return;
      }
      if (amount <= 0n) {
        setStatus({ kind: 'error', message: 'Enter an amount greater than zero.' });
        return;
      }
      if (token.backendToken === undefined) {
        setStatus({
          kind: 'error',
          message:
            "Only built-in tokens (ICP and TCYCLES) are held in deposit balances — there's nothing to withdraw for a custom token.",
        });
        return;
      }

      setStatus({ kind: 'transferring' });
      try {
        const backend = createUnicycleBackendActor(identity);
        const result = await backend.withdraw(token.backendToken, amount);
        if (result.__kind__ === 'ok') {
          setStatus({ kind: 'success', blockIndex: result.ok });
          onSuccess?.();
        } else {
          setStatus({ kind: 'error', ...formatWithdrawError(result.err, token) });
        }
      } catch (e) {
        setStatus({
          kind: 'error',
          ...unexpectedError('complete the withdrawal', e),
        });
      }
    },
    [identity, onSuccess],
  );

  return { status, withdraw, reset };
}
