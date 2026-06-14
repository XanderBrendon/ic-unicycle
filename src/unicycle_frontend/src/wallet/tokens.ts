import { Token as BackendToken } from '../bindings/unicycle_backend/unicycle_backend';

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  ledgerCanisterId: string;
  /** Per-transfer fee in the token's smallest unit, as reported by icrc1_fee. */
  fee: bigint;
  /**
   * The backend `Token` enum value that maps to this token. Built-in tokens set
   * this; custom (user-added) tokens leave it `undefined` — they are display +
   * transfer only and have no typed deposit path.
   */
  backendToken?: BackendToken;
}

/** Built-in tokens carry a `backendToken`; custom tokens don't. */
export function isBuiltIn(token: TokenInfo): boolean {
  return token.backendToken !== undefined;
}

export const BUILT_IN_TOKENS: readonly TokenInfo[] = [
  {
    symbol: 'ICP',
    name: 'Internet Computer',
    decimals: 8,
    ledgerCanisterId: 'ryjl3-tyaaa-aaaaa-aaaba-cai',
    fee: 10_000n,
    backendToken: BackendToken.ICP,
  },
  {
    symbol: 'TCYCLES',
    name: 'Trillion cycles',
    decimals: 12,
    ledgerCanisterId: 'um5iw-rqaaa-aaaaq-qaaba-cai',
    fee: 100_000_000n,
    backendToken: BackendToken.TCYCLES,
  },
] as const;
