import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { useSnsUnicycleProposals } from '../sns/useSnsUnicycleProposals';
import type { ProposalOutcome } from '../sns/unicycleProposals';
import { nnsProposalUrl } from '../sns/snsInfo';
import { Panel, Empty, ErrorHint } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtAgo } from '../ui/format';

// Rejection is an ordinary governance outcome, failure is an error — so the
// two don't share a tone.
const OUTCOME: Record<ProposalOutcome, { label: string; cls: string }> = {
  open: { label: 'Open', cls: '' },
  adopted: { label: 'Adopted', cls: 'ok' },
  executed: { label: 'Executed', cls: 'ok' },
  rejected: { label: 'Rejected', cls: 'muted' },
  failed: { label: 'Failed', cls: 'crit' },
};

export interface SnsProposalsProps {
  identity: Identity;
  root: Principal;
  governance: Principal | null;
}

export function SnsProposals({ identity, root, governance }: SnsProposalsProps) {
  const { proposals, loading, loadingMore, hasMore, error, refresh, loadMore } =
    useSnsUnicycleProposals(identity, governance, root);

  if (!governance) {
    return (
      <Panel title="Unicycle proposals">
        <div className="faint" style={{ padding: 24, textAlign: 'center' }}>
          Waiting for this SNS's governance canister.
        </div>
      </Panel>
    );
  }

  return (
    <div className="fade-up grid" style={{ gap: 'var(--gap)' }}>
      {error && <ErrorHint message="Could not load proposals" detail={error} />}
      <Panel
        flush
        title="Unicycle proposals"
        eyebrow="// newest first"
        actions={
          <button className="btn ghost sm" onClick={refresh} disabled={loading} title="Reload proposals">
            <Icon name="refresh" size={14} />
          </button>
        }
      >
        {proposals === null ? (
          <div className="faint" style={{ padding: 24, textAlign: 'center' }}>Loading proposals…</div>
        ) : proposals.length === 0 ? (
          <Empty icon="list" title="No Unicycle proposals">
            Nothing in this SNS's recent proposal history touches Unicycle.
          </Empty>
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 46 }}></th>
                  <th className="num" style={{ width: 70 }}>#</th>
                  <th>What it does</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 110 }}>Proposed</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id.toString()}>
                    <td>
                      {p.byUnicycle && (
                        // Icon-only, so it carries the tooltip the word used to be.
                        <span className="badge ok" title="Proposed through this SNS's Unicycle neuron">
                          <Icon name="wheel" size={12} />
                        </span>
                      )}
                    </td>
                    <td className="num mono">{p.id.toString()}</td>
                    <td style={{ whiteSpace: 'normal', lineHeight: 1.45 }}>{p.description}</td>
                    <td>
                      <span className={`badge ${OUTCOME[p.outcome].cls}`}>{OUTCOME[p.outcome].label}</span>
                    </td>
                    <td className="mono faint" style={{ fontSize: 11.5 }}>{fmtAgo(p.createdMs)}</td>
                    <td>
                      <a
                        className="iconbtn"
                        href={nnsProposalUrl(root.toText(), p.id)}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in the NNS app"
                      >
                        <Icon name="ext" size={13} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && (
              <div style={{ padding: 'var(--pad)', textAlign: 'center' }}>
                <button className="btn ghost sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
