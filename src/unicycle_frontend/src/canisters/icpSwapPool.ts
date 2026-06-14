// Narrow client for the ICPSwap V3 pool's `quote` query — just enough to read a
// spot ICP→TCYCLES rate for the Overview runway/deposit cards. Mirrors the
// `quote` method of the vendored `icpswap_pool.did`; the backend takes the same
// "narrow subset" approach (a hand-typed reference rather than full bindgen,
// since we only consume one of the pool's ~30 methods).
import { Actor, type HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import type { Principal } from '@icp-sdk/core/principal';

export interface PoolQuoteArgs {
  zeroForOne: boolean; // true = ICP → TCYCLES (token0 → token1)
  amountIn: string; // smallest units, decimal string (ICPSwap wire format)
  amountOutMinimum: string;
}

// Raw candid decoding of `Result_Nat` — a bare one-key variant, not the
// bindgen `__kind__` wrapper.
type PoolResultNat = { ok: bigint } | { err: unknown };

export interface IcpSwapPool {
  quote(args: PoolQuoteArgs): Promise<PoolResultNat>;
}

const idlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const SwapArgs = IDL.Record({
    zeroForOne: IDL.Bool,
    amountIn: IDL.Text,
    amountOutMinimum: IDL.Text,
  });
  const Error = IDL.Variant({
    CommonError: IDL.Null,
    InternalError: IDL.Text,
    UnsupportedToken: IDL.Text,
    InsufficientFunds: IDL.Null,
  });
  const Result_Nat = IDL.Variant({ ok: IDL.Nat, err: Error });
  return IDL.Service({
    quote: IDL.Func([SwapArgs], [Result_Nat], ['query']),
  });
};

export function createIcpSwapPoolActor(canisterId: Principal, agent: HttpAgent): IcpSwapPool {
  return Actor.createActor(idlFactory, { agent, canisterId }) as unknown as IcpSwapPool;
}
