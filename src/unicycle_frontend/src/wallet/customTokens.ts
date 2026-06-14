import type { TokenInfo } from './tokens';

/**
 * Per-principal localStorage persistence for the user's custom-token list.
 * Keyed by principal so one signed-in user's custom-token list doesn't leak
 * into another's view on a shared browser. `fee` (a bigint) is serialized as a
 * decimal string and rehydrated on load.
 */

export const customTokensKey = (principal: string): string =>
  `unicycle:customTokens:${principal}`;

interface SerializedToken {
  symbol: string;
  name: string;
  decimals: number;
  ledgerCanisterId: string;
  fee: string;
}

export function loadCustomTokens(principal: string): TokenInfo[] {
  const raw = localStorage.getItem(customTokensKey(principal));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SerializedToken[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      ledgerCanisterId: t.ledgerCanisterId,
      fee: BigInt(t.fee),
    }));
  } catch {
    return [];
  }
}

export function saveCustomTokens(principal: string, tokens: TokenInfo[]): void {
  const serialized: SerializedToken[] = tokens.map((t) => ({
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    ledgerCanisterId: t.ledgerCanisterId,
    fee: t.fee.toString(),
  }));
  localStorage.setItem(customTokensKey(principal), JSON.stringify(serialized));
}
