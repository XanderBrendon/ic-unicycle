import { Principal } from '@icp-sdk/core/principal';
import { IcrcLedgerCanister, mapTokenMetadata } from '@icp-sdk/canisters/ledger/icrc';
import { buildAgent } from './agent';
import { unexpectedError, type UserError } from '../ui/format';
import type { TokenInfo } from './tokens';

/**
 * Reads ICRC-1 metadata from a ledger to build a custom `TokenInfo`. The ledger
 * is authoritative for symbol/name/decimals/fee; a successful read also doubles
 * as "is this a real ICRC-1 ledger?" validation. Unauthenticated query — same
 * pattern as useLocalWalletBalances.
 */
export async function fetchTokenMetadata(
  ledgerCanisterId: string,
): Promise<{ ok: true; token: TokenInfo } | { ok: false; error: UserError }> {
  let canisterId: Principal;
  try {
    canisterId = Principal.fromText(ledgerCanisterId.trim());
  } catch {
    return {
      ok: false,
      error: { message: "That isn't a valid canister id — paste the ledger's canister id (e.g. ryjl3-tyaaa-aaaaa-aaaba-cai)." },
    };
  }

  try {
    const ledger = IcrcLedgerCanister.create({ agent: buildAgent(), canisterId });
    const metadata = mapTokenMetadata(await ledger.metadata({}));
    if (!metadata) {
      return {
        ok: false,
        error: {
          message:
            "That canister doesn't expose standard ICRC-1 metadata — double-check the id points at an ICRC-1 ledger.",
        },
      };
    }
    return {
      ok: true,
      token: {
        symbol: metadata.symbol,
        name: metadata.name,
        decimals: metadata.decimals,
        ledgerCanisterId: canisterId.toText(),
        fee: metadata.fee,
      },
    };
  } catch (err) {
    return { ok: false, error: unexpectedError('read the ledger metadata', err) };
  }
}
