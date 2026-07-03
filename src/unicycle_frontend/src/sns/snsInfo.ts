import { Principal } from '@icp-sdk/core/principal';
import { SnsRootCanister, SnsGovernanceCanister } from '@icp-sdk/canisters/sns';
import { buildAgent } from '../wallet/agent';

// Per-root localStorage cache of an SNS's governance canister id and display
// name (from governance metadata). Entries never expire — the SNS page's
// refresh button and a cache miss are the only reasons to refetch. Keyed by
// root (not by user): SNS metadata is public, not user-specific.

export interface SnsInfo {
  root: string;
  governance: string;
  name: string | null;
  fetchedAt: number;
}

export const snsInfoKey = (root: string): string => `unicycle:snsInfo:${root}`;

export const snsProposalUrl = (root: string, id: bigint): string =>
  `https://dashboard.internetcomputer.org/sns/${root}/proposal/${id.toString()}`;

export function loadSnsInfo(root: string): SnsInfo | null {
  const raw = localStorage.getItem(snsInfoKey(root));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SnsInfo;
    if (typeof parsed?.governance !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSnsInfo(info: SnsInfo): void {
  localStorage.setItem(snsInfoKey(info.root), JSON.stringify(info));
}

export async function fetchSnsInfo(root: Principal): Promise<SnsInfo> {
  const agent = buildAgent(); // anonymous — queries only
  const rootCanister = SnsRootCanister.create({ canisterId: root, agent });
  const canisters = await rootCanister.listSnsCanisters({ certified: false });
  const governance = canisters.governance[0];
  if (!governance) throw new Error('SNS root did not report a governance canister');
  const gov = SnsGovernanceCanister.create({ canisterId: governance, agent });
  const metadata = await gov.metadata({ certified: false });
  return {
    root: root.toText(),
    governance: governance.toText(),
    name: metadata.name[0] ?? null,
    fetchedAt: Date.now(),
  };
}
