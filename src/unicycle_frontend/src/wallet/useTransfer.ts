import { useCallback, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import {
  IcrcLedgerCanister,
  toCandidAccount,
  type IcrcAccount,
} from '@icp-sdk/canisters/ledger/icrc';
import { buildAgent } from './agent';
import type { TokenInfo } from './tokens';
import { formatLedgerThrow } from './ledgerErrors';

export type TransferStatus =
  | { kind: 'idle' }
  | { kind: 'transferring' }
  | { kind: 'success'; blockIndex: bigint }
  | { kind: 'error'; message: string; detail?: string };

export interface UseTransferResult {
  status: TransferStatus;
  transfer: (token: TokenInfo, to: IcrcAccount, amount: bigint) => Promise<void>;
  reset: () => void;
}

export function useTransfer(
  identity: Identity | null,
  onSuccess?: () => void,
): UseTransferResult {
  const [status, setStatus] = useState<TransferStatus>({ kind: 'idle' });

  const reset = useCallback(() => setStatus({ kind: 'idle' }), []);

  const transfer = useCallback(
    async (token: TokenInfo, to: IcrcAccount, amount: bigint) => {
      if (!identity) {
        setStatus({ kind: 'error', message: "You're not signed in — sign in and try again." });
        return;
      }
      if (amount <= 0n) {
        setStatus({ kind: 'error', message: 'Enter an amount greater than zero.' });
        return;
      }

      setStatus({ kind: 'transferring' });
      try {
        const agent = buildAgent(identity);
        const ledger = IcrcLedgerCanister.create({
          agent,
          canisterId: Principal.fromText(token.ledgerCanisterId),
        });
        const blockIndex = await ledger.transfer({
          to: toCandidAccount(to),
          amount,
        });
        setStatus({ kind: 'success', blockIndex });
        onSuccess?.();
      } catch (e) {
        setStatus({
          kind: 'error',
          ...formatLedgerThrow('send the tokens', e, token),
        });
      }
    },
    [identity, onSuccess],
  );

  return { status, transfer, reset };
}
