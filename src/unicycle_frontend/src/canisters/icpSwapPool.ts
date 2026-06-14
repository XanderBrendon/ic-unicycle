// Narrow client for the ICPSwap V3 pool's query methods we consume directly from
// the frontend. Originally just `quote` (for the Overview spot rate); extended
// with the read methods the admin LP card needs (position liquidity, unused
// balance, accrued fees, pool price). Mirrors the pool's candid surface; the
// backend takes the same "narrow subset" approach (a hand-typed reference rather
// than full bindgen, since we only consume a few of the pool's ~30 methods).
import { Actor, type HttpAgent } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import type { Principal } from '@icp-sdk/core/principal';

export interface PoolQuoteArgs {
  zeroForOne: boolean; // true = ICP → TCYCLES (token0 → token1)
  amountIn: string; // smallest units, decimal string (ICPSwap wire format)
  amountOutMinimum: string;
}

// Raw candid decoding of a bare one-key variant, not the bindgen `__kind__` wrapper.
type PoolResult<T> = { ok: T } | { err: unknown };
type PoolResultNat = PoolResult<bigint>;

// Subsets of the decoded records — only the fields we read. The IDL declares the
// full wire records (below), so decoding succeeds; these types narrow to use.
export interface PoolMetadata {
  sqrtPriceX96: bigint;
}
export interface UserPosition {
  liquidity: bigint;
  tickLower: bigint;
  tickUpper: bigint;
}
export interface UnusedBalance {
  balance0: bigint; // ICP
  balance1: bigint; // TCYCLES
}
export interface PositionIncome {
  tokensOwed0: bigint; // ICP
  tokensOwed1: bigint; // TCYCLES
}

export interface IcpSwapPool {
  quote(args: PoolQuoteArgs): Promise<PoolResultNat>;
  metadata(): Promise<PoolResult<PoolMetadata>>;
  getUserPosition(positionId: bigint): Promise<PoolResult<UserPosition>>;
  getUserUnusedBalance(owner: Principal): Promise<PoolResult<UnusedBalance>>;
  refreshIncome(positionId: bigint): Promise<PoolResult<PositionIncome>>;
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
  const Token = IDL.Record({ address: IDL.Text, standard: IDL.Text });
  // Full wire records so decode matches; the TS interfaces above narrow to use.
  const PoolMetadata = IDL.Record({
    fee: IDL.Nat,
    key: IDL.Text,
    liquidity: IDL.Nat,
    maxLiquidityPerTick: IDL.Nat,
    nextPositionId: IDL.Nat,
    sqrtPriceX96: IDL.Nat,
    tick: IDL.Int,
    token0: Token,
    token1: Token,
  });
  const UserPositionInfo = IDL.Record({
    feeGrowthInside0LastX128: IDL.Nat,
    feeGrowthInside1LastX128: IDL.Nat,
    liquidity: IDL.Nat,
    tickLower: IDL.Int,
    tickUpper: IDL.Int,
    tokensOwed0: IDL.Nat,
    tokensOwed1: IDL.Nat,
  });
  const UnusedBalance = IDL.Record({ balance0: IDL.Nat, balance1: IDL.Nat });
  const Income = IDL.Record({ tokensOwed0: IDL.Nat, tokensOwed1: IDL.Nat });
  const Result_Nat = IDL.Variant({ ok: IDL.Nat, err: Error });
  const Result_Metadata = IDL.Variant({ ok: PoolMetadata, err: Error });
  const Result_Position = IDL.Variant({ ok: UserPositionInfo, err: Error });
  const Result_Unused = IDL.Variant({ ok: UnusedBalance, err: Error });
  const Result_Income = IDL.Variant({ ok: Income, err: Error });
  return IDL.Service({
    quote: IDL.Func([SwapArgs], [Result_Nat], ['query']),
    metadata: IDL.Func([], [Result_Metadata], ['query']),
    getUserPosition: IDL.Func([IDL.Nat], [Result_Position], ['query']),
    getUserUnusedBalance: IDL.Func([IDL.Principal], [Result_Unused], ['query']),
    refreshIncome: IDL.Func([IDL.Nat], [Result_Income], ['query']),
  });
};

export function createIcpSwapPoolActor(canisterId: Principal, agent: HttpAgent): IcpSwapPool {
  return Actor.createActor(idlFactory, { agent, canisterId }) as unknown as IcpSwapPool;
}

// --- Uniswap V3 amounts-for-liquidity (client-side) -------------------------
// The position is always full-range (the backend mints at ticks ±887220), so the
// current price is always within range and the in-range formulas apply. The two
// boundary sqrt-ratios are precomputed (Uniswap TickMath) so we don't ship the
// full tick math; FULL_TICK_* let callers assert the position is still full-range
// before trusting these constants.
export const FULL_TICK_LOWER = -887220n;
export const FULL_TICK_UPPER = 887220n;
const Q96 = 2n ** 96n;
const SQRT_RATIO_AT_MIN_FULL_TICK = 4306310044n; // sqrtRatioAtTick(-887220)
const SQRT_RATIO_AT_MAX_FULL_TICK =
  1457652066949847389969617340386294118487833376468n; // sqrtRatioAtTick(887220)

// Token amounts held by a full-range position with the given liquidity at the
// given current price. token0 = ICP, token1 = TCYCLES (the pool/backend order).
export function positionAmounts(liquidity: bigint, sqrtPriceX96: bigint): { icp: bigint; tc: bigint } {
  const sa = SQRT_RATIO_AT_MIN_FULL_TICK;
  const sb = SQRT_RATIO_AT_MAX_FULL_TICK;
  const p = sqrtPriceX96 < sa ? sa : sqrtPriceX96 > sb ? sb : sqrtPriceX96;
  const icp = (liquidity * (sb - p) * Q96) / (sb * p); // getAmount0(p, sb, L)
  const tc = (liquidity * (p - sa)) / Q96; // getAmount1(sa, p, L)
  return { icp, tc };
}
