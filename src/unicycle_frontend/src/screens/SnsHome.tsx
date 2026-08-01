import { useMemo, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { useFleet } from '../canisters/useFleet';
import { useDepositBalances } from '../wallet/useDepositBalances';
import { useIcpTcRate } from '../canisters/useIcpTcRate';
import { useTimerSchedule } from '../canisters/useTimerSchedule';
import { AddCanisterModal } from '../canisters/CanisterModals';
import { GroupEditModal } from '../canisters/GroupEditModal';
import { CopyId, Tabs, ErrorHint } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtPid } from '../ui/format';
import type { SnsTab } from '../router';
import type { SnsInfo } from '../sns/snsInfo';
import { FleetKpiStrip, FleetDashboard, OverviewLoading, OverviewEmpty } from './Overview';
import { SnsProposals } from './SnsProposals';
import { SnsSettings } from './SnsSettings';

export interface SnsHomeProps {
  identity: Identity;
  root: Principal;
  info: SnsInfo | undefined;
  infoRefreshing: boolean;
  infoError: string | null;
  onRefreshInfo: () => void;
  tab: SnsTab;
  onTabChange: (tab: SnsTab) => void;
  onOpen: (id: Principal) => void;
  // True for anyone who is not one of this SNS's admins: the data is public,
  // the controls are not.
  readOnly: boolean;
}

export function SnsHome({
  identity, root, info, infoRefreshing, infoError, onRefreshInfo, tab, onTabChange, onOpen, readOnly,
}: SnsHomeProps) {
  const fleet = useFleet(identity, root);
  const deposit = useDepositBalances(identity, root); // the SNS root's deposit subaccount
  const rate = useIcpTcRate(identity);
  const schedule = useTimerSchedule(identity); // global fleet-wide sweep — same value as the personal overview
  const [addOpen, setAddOpen] = useState(false);
  const [groupEditOpen, setGroupEditOpen] = useState(false);
  const governance = useMemo(() => {
    if (!info) return null;
    try {
      return Principal.fromText(info.governance);
    } catch {
      return null;
    }
  }, [info?.governance]);

  return (
    <>
      <div className="sns-head" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--gap)' }}>
        <Icon name="shield" size={18} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            {info?.name ?? fmtPid(root.toText(), 6, 4)}
            {readOnly && <span className="badge muted">Read only</span>}
          </div>
          <CopyId id={root.toText()} />
        </div>
        <button
          className="btn ghost sm"
          style={{ marginLeft: 'auto' }}
          onClick={onRefreshInfo}
          disabled={infoRefreshing}
          title="Refresh SNS name from governance metadata"
        >
          <Icon name="refresh" size={14} />
        </button>
      </div>
      {infoError && <ErrorHint message="Could not load SNS metadata" detail={infoError} />}

      <div style={{ marginBottom: 'var(--gap)' }}>
        <Tabs
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'proposals', label: 'Proposals' },
            { id: 'settings', label: 'Settings' },
          ]}
          active={tab}
          onChange={(id) => onTabChange(id as SnsTab)}
        />
      </div>

      {tab === 'overview' &&
        (fleet.canisters === null && !fleet.error ? (
          <OverviewLoading />
        ) : !fleet.error && fleet.canisters?.length === 0 ? (
          readOnly ? (
            <div className="panel faint" style={{ padding: 24, textAlign: 'center' }}>
              This SNS has no canisters under Unicycle management yet.
            </div>
          ) : (
            <OverviewEmpty onAdd={() => setAddOpen(true)} onGroupEdit={() => setGroupEditOpen(true)} />
          )
        ) : (
          <div className="fade-up grid" style={{ gap: 'var(--gap)' }}>
            <FleetKpiStrip fleet={fleet} deposit={deposit} rate={rate} historyEvents={null} />
            <FleetDashboard
              fleet={fleet}
              onOpen={onOpen}
              onAdd={readOnly ? undefined : () => setAddOpen(true)}
              onGroupEdit={readOnly ? undefined : () => setGroupEditOpen(true)}
              schedule={schedule}
            />
          </div>
        ))}

      {/* Governance data, public either way — no readOnly branch. */}
      {tab === 'proposals' && <SnsProposals identity={identity} root={root} governance={governance} />}

      {tab === 'settings' && (
        <SnsSettings identity={identity} root={root} governance={governance} readOnly={readOnly} />
      )}

      {addOpen && (
        <AddCanisterModal
          identity={identity}
          actingAs={root}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            fleet.refresh();
            setAddOpen(false);
          }}
        />
      )}

      {groupEditOpen && (
        <GroupEditModal
          identity={identity}
          root={root}
          actingAs={root}
          tracked={fleet.canisters ?? []}
          onClose={() => setGroupEditOpen(false)}
          onSaved={() => {
            fleet.refresh();
            setGroupEditOpen(false);
          }}
        />
      )}
    </>
  );
}
