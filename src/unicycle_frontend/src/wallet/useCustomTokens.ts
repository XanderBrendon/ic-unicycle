import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { UserError } from '../ui/format';
import { BUILT_IN_TOKENS, type TokenInfo } from './tokens';
import { loadCustomTokens, saveCustomTokens } from './customTokens';
import { fetchTokenMetadata } from './fetchTokenMetadata';

export interface UseCustomTokens {
  customTokens: TokenInfo[];
  addToken: (ledgerCanisterId: string) => Promise<{ ok: true } | { ok: false; error: UserError }>;
  removeToken: (ledgerCanisterId: string) => void;
}

export function useCustomTokens(identity: Identity | null): UseCustomTokens {
  const principal = identity?.getPrincipal().toText() ?? null;
  const [customTokens, setCustomTokens] = useState<TokenInfo[]>([]);

  useEffect(() => {
    setCustomTokens(principal ? loadCustomTokens(principal) : []);
  }, [principal]);

  const addToken = useCallback(
    async (ledgerCanisterId: string): Promise<{ ok: true } | { ok: false; error: UserError }> => {
      if (!principal) return { ok: false, error: { message: 'Sign in to add a token.' } };

      const result = await fetchTokenMetadata(ledgerCanisterId);
      if (!result.ok) return result;
      const token = result.token;

      const existing = [...BUILT_IN_TOKENS, ...customTokens];
      if (existing.some((t) => t.ledgerCanisterId === token.ledgerCanisterId)) {
        return { ok: false, error: { message: 'That ledger is already in your token list.' } };
      }
      if (existing.some((t) => t.symbol === token.symbol)) {
        return {
          ok: false,
          error: {
            message: `Symbol ${token.symbol} is already used by another token in your list — remove that one first if you want to replace it.`,
          },
        };
      }

      const next = [...customTokens, token];
      setCustomTokens(next);
      saveCustomTokens(principal, next);
      return { ok: true };
    },
    [principal, customTokens],
  );

  const removeToken = useCallback(
    (ledgerCanisterId: string) => {
      if (!principal) return;
      const next = customTokens.filter((t) => t.ledgerCanisterId !== ledgerCanisterId);
      setCustomTokens(next);
      saveCustomTokens(principal, next);
    },
    [principal, customTokens],
  );

  return { customTokens, addToken, removeToken };
}
