import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister } from '@icp-sdk/canisters/ledger/icrc';
import { buildAgent } from './agent';
import { BUILT_IN_TOKENS, type TokenInfo } from './tokens';

export interface LocalWalletBalances {
  balances: Record<string, bigint | null>;
  errors: Record<string, string | null>;
  loading: boolean;
  refresh: () => void;
}

const empty = <T>(tokens: readonly TokenInfo[]): Record<string, T | null> =>
  Object.fromEntries(tokens.map((t) => [t.symbol, null]));

export function useLocalWalletBalances(
  identity: Identity | null,
  customTokens: TokenInfo[] = [],
): LocalWalletBalances {
  const tokens: TokenInfo[] = [...BUILT_IN_TOKENS, ...customTokens];
  const [balances, setBalances] = useState<Record<string, bigint | null>>(() => empty(tokens));
  const [errors, setErrors] = useState<Record<string, string | null>>(() => empty(tokens));
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // Re-key by symbol so the combined list (custom tokens added/removed) drives
  // both the read loop and the records.
  const symbolKey = tokens.map((t) => t.symbol).join(',');

  useEffect(() => {
    if (!identity) {
      setBalances(empty(tokens));
      setErrors(empty(tokens));
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // ICRC-1 balance is a query that takes the owner principal as an argument,
    // so we don't authenticate the request — that avoids the cross-subnet
    // delegation trust issue local PocketIC has when II lives on a different
    // subnet than the ledger.
    const agent = buildAgent();
    const owner = identity.getPrincipal();

    const reads = tokens.map((token) => {
      const canisterId = Principal.fromText(token.ledgerCanisterId);
      const ledger = IcrcLedgerCanister.create({ agent, canisterId });
      return ledger.balance({ owner });
    });

    Promise.allSettled(reads).then((results) => {
      if (cancelled) return;
      const nextBalances = empty<bigint>(tokens);
      const nextErrors = empty<string>(tokens);
      results.forEach((result, i) => {
        const symbol = tokens[i].symbol;
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
  }, [identity, tick, symbolKey]);

  return { balances, errors, loading, refresh };
}
