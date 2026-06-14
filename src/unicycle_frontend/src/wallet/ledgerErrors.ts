import { IcrcTransferError } from '@icp-sdk/canisters/ledger/icrc';
import type { TransferFromError } from '../bindings/unicycle_backend/unicycle_backend';
import { unexpectedError, type UserError } from '../ui/format';
import type { TokenInfo } from './tokens';
import { formatTokenAmount } from './format';

// Human-readable formatting for ICRC ledger errors, shared by deposit,
// withdraw, and send flows. The bindgen TransferFromError is a structural
// superset of TransferError; approve responses can additionally fail with
// AllowanceChanged/Expired (ApproveError variants).
export type LedgerError =
  | TransferFromError
  | { __kind__: 'AllowanceChanged'; AllowanceChanged: { current_allowance: bigint } }
  | { __kind__: 'Expired'; Expired: { ledger_time: bigint } };

export function formatLedgerError(err: LedgerError, token: TokenInfo): UserError {
  const amt = (n: bigint) => `${formatTokenAmount(n, token.decimals)} ${token.symbol}`;
  switch (err.__kind__) {
    case 'InsufficientFunds':
      return {
        message:
          `Insufficient funds — the available balance is ${amt(err.InsufficientFunds.balance)}, ` +
          `and the amount plus the ${amt(token.fee)} ledger fee must fit within it. ` +
          `Enter a smaller amount or use Max.`,
      };
    case 'InsufficientAllowance':
      return {
        message:
          `The transfer approval no longer covers this amount ` +
          `(current allowance ${amt(err.InsufficientAllowance.allowance)}). ` +
          `Approvals expire after a few minutes — start the deposit again to create a fresh one.`,
      };
    case 'BadFee':
      return {
        message:
          `The ledger fee changed — it now expects ${amt(err.BadFee.expected_fee)}. ` +
          `Refresh the page to pick up the new fee and try again.`,
      };
    case 'BadBurn':
      return {
        message: `Amount is below the ledger's minimum burn of ${amt(err.BadBurn.min_burn_amount)} — enter at least that much.`,
      };
    case 'TooOld':
      return { message: 'The request expired before the ledger processed it — try again.' };
    case 'CreatedInFuture':
      return { message: "Your device's clock appears to be ahead of the ledger's — check your system time and try again." };
    case 'Duplicate':
      return {
        message:
          `The ledger already processed an identical transfer (block ${err.Duplicate.duplicate_of}) — ` +
          `check your balance and recent activity before retrying.`,
      };
    case 'TemporarilyUnavailable':
      return { message: 'The ledger is temporarily unavailable — wait a moment and try again.' };
    case 'GenericError':
      return {
        message: `The ledger rejected the request (code ${err.GenericError.error_code}). Try again shortly.`,
        detail: err.GenericError.message,
      };
    case 'AllowanceChanged':
      return {
        message:
          `An existing approval changed while this request was in flight ` +
          `(current allowance ${amt(err.AllowanceChanged.current_allowance)}) — try again.`,
      };
    case 'Expired':
      return { message: 'The approval expired before the deposit completed — try again.' };
    default: {
      const _exhaustive: never = err;
      return { message: 'Unexpected ledger error.', detail: JSON.stringify(_exhaustive) };
    }
  }
}

const LEDGER_ERROR_KINDS = new Set([
  'GenericError',
  'TemporarilyUnavailable',
  'InsufficientAllowance',
  'BadBurn',
  'Duplicate',
  'BadFee',
  'CreatedInFuture',
  'TooOld',
  'InsufficientFunds',
  'AllowanceChanged',
  'Expired',
]);

// IcrcTransferError.errorType (thrown by @icp-sdk ledger transfer/approve)
// carries the raw candid variant — { TooOld: null }, { InsufficientFunds:
// { balance } } — rather than the bindgen __kind__ shape. Returns null for
// unrecognized variants so callers can fall back to a generic message.
export function ledgerErrorFromCandid(value: unknown): LedgerError | null {
  if (typeof value !== 'object' || value === null) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || !LEDGER_ERROR_KINDS.has(keys[0])) return null;
  const kind = keys[0];
  return { __kind__: kind, [kind]: (value as Record<string, unknown>)[kind] ?? null } as LedgerError;
}

// Formats exceptions thrown by the @icp-sdk ledger client: typed ledger
// rejections get the human-readable treatment above, anything else falls back
// to the generic unexpected-error message.
export function formatLedgerThrow(action: string, e: unknown, token: TokenInfo): UserError {
  if (e instanceof IcrcTransferError) {
    const ledgerError = ledgerErrorFromCandid(e.errorType);
    if (ledgerError) return formatLedgerError(ledgerError, token);
  }
  return unexpectedError(action, e);
}
