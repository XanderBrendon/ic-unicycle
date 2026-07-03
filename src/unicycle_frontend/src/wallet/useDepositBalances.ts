import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister } from '@icp-sdk/canisters/ledger/icrc';
import { buildAgent } from './agent';
import { depositAccountFor } from './depositAccount';
import { BUILT_IN_TOKENS } from './tokens';

type Symbol = (typeof BUILT_IN_TOKENS)[number]['symbol'];

export interface DepositBalances {
  balances: Record<Symbol, bigint | null>;
  errors: Record<Symbol, string | null>;
  loading: boolean;
  refresh: () => void;
}

const emptyBalances = (): Record<Symbol, bigint | null> =>
  Object.fromEntries(BUILT_IN_TOKENS.map((t) => [t.symbol, null])) as Record<
    Symbol,
    bigint | null
  >;

const emptyErrors = (): Record<Symbol, string | null> =>
  Object.fromEntries(BUILT_IN_TOKENS.map((t) => [t.symbol, null])) as Record<
    Symbol,
    string | null
  >;

export function useDepositBalances(identity: Identity | null, accountOwner?: Principal): DepositBalances {
  const [balances, setBalances] = useState<Record<Symbol, bigint | null>>(emptyBalances);
  const [errors, setErrors] = useState<Record<Symbol, string | null>>(emptyErrors);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity) {
      setBalances(emptyBalances());
      setErrors(emptyErrors());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // ICRC-1 balance is a query that takes the account as an argument, so we
    // don't authenticate the request — that avoids the cross-subnet delegation
    // trust issue local PocketIC has when II lives on a different subnet than
    // the ledger. Same pattern as useLocalWalletBalances.
    const agent = buildAgent();
    const account = depositAccountFor(accountOwner ?? identity.getPrincipal());

    const reads = BUILT_IN_TOKENS.map((token) => {
      const canisterId = Principal.fromText(token.ledgerCanisterId);
      const ledger = IcrcLedgerCanister.create({ agent, canisterId });
      return ledger.balance({ owner: account.owner, subaccount: account.subaccount });
    });

    Promise.allSettled(reads).then((results) => {
      if (cancelled) return;
      const nextBalances = emptyBalances();
      const nextErrors = emptyErrors();
      results.forEach((result, i) => {
        const symbol = BUILT_IN_TOKENS[i].symbol;
        if (result.status === 'fulfilled') {
          nextBalances[symbol] = result.value;
        } else {
          nextErrors[symbol] =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
        }
      });
      setBalances(nextBalances);
      setErrors(nextErrors);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [identity, accountOwner, tick]);

  return { balances, errors, loading, refresh };
}
