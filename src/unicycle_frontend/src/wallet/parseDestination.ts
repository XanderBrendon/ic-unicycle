import { decodeIcrcAccount, type IcrcAccount } from '@icp-sdk/canisters/ledger/icrc';

export function parseDestination(
  input: string,
): { ok: true; account: IcrcAccount } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, error: 'Destination is required.' };
  }
  try {
    return { ok: true, account: decodeIcrcAccount(trimmed) };
  } catch {
    return {
      ok: false,
      error: "That destination isn't valid — paste a principal (e.g. w7x7r-cok77-xa) or an ICRC-1 textual account.",
    };
  }
}
