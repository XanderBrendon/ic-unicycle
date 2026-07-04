// Per-tracked-SNS page: the user's own canisters stamped with this SNS root,
// funded from the user's local wallet / deposit subaccount. Mirrors SnsHome's
// overview minus the Settings/proposal surface — mutations act as the user,
// not the SNS.
import { useCallback, useMemo, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { useFleet } from '../canisters/useFleet';
import type { FleetCanister } from '../canisters/useFleet';
import { useDepositBalances } from '../wallet/useDepositBalances';
import { useIcpTcRate } from '../canisters/useIcpTcRate';
import { useTimerSchedule } from '../canisters/useTimerSchedule';
import { GroupEditModal } from '../canisters/GroupEditModal';
import { CopyId, Modal, ErrorHint } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtPid } from '../ui/format';
import { useToast } from '../ui/toast';
import { createUnicycleBackendActor } from '../auth/actor';
import { RemoveTrackedSnsError } from '../bindings/unicycle_backend/unicycle_backend';
import type { CanisterHistory } from '../bindings/unicycle_backend/unicycle_backend';
import type { SnsInfo } from '../sns/snsInfo';
import { FleetKpiStrip, FleetDashboard, OverviewLoading } from './Overview';

export interface TrackedSnsHomeProps {
  identity: Identity;
  root: Principal;
  info: SnsInfo | undefined;
  infoRefreshing: boolean;
  infoError: string | null;
  onRefreshInfo: () => void;
  onOpen: (id: Principal) => void;
  // The user's FULL, unfiltered fleet (App's global fleet) — seeds Group Edit
  // so canisters already tracked under a different stamp render with their real
  // config, not as untracked (see the tracked= site below).
  allCanisters: FleetCanister[];
  // App's global fleet refresh — kept in sync with this page's filtered fleet
  // after a Group Edit save.
  onChanged: () => void;
  // Called after a successful removeTrackedSns: App refreshes the tracked
  // roots (nav) and navigates back to the Overview.
  onRemoved: () => void;
}

function removeSnsErrMsg(err: RemoveTrackedSnsError): string {
  switch (err) {
    case RemoveTrackedSnsError.topUpInFlight:
      return 'A top-up is in flight for one of these canisters — try again shortly.';
    case RemoveTrackedSnsError.anonymous:
      return "You're not signed in.";
    default:
      return String(err);
  }
}

export function TrackedSnsHome({
  identity, root, info, infoRefreshing, infoError, onRefreshInfo, onOpen,
  allCanisters, onChanged, onRemoved,
}: TrackedSnsHomeProps) {
  const rootText = root.toText();
  const filter = useCallback(
    (h: CanisterHistory) => h.config.snsRoot !== undefined && h.config.snsRoot.toText() === rootText,
    [rootText],
  );
  const fleet = useFleet(identity, null, filter);
  const deposit = useDepositBalances(identity); // the user's OWN deposit subaccount
  const rate = useIcpTcRate(identity);
  const schedule = useTimerSchedule(identity);
  const toast = useToast();
  const [groupEditOpen, setGroupEditOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const trackedCount = useMemo(() => fleet.canisters?.length ?? 0, [fleet.canisters]);

  const doRemove = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      const res = await createUnicycleBackendActor(identity).removeTrackedSns(root);
      if (res.__kind__ === 'ok') {
        toast(
          <>
            <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
            Stopped tracking {info?.name ?? fmtPid(rootText, 6, 4)}
            {res.ok > 0n ? ` — untracked ${res.ok.toString()} canister${res.ok === 1n ? '' : 's'}` : ''}
          </>,
        );
        onRemoved();
      } else {
        setRemoveError(removeSnsErrMsg(res.err));
      }
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="sns-head" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--gap)' }}>
        <Icon name="shield" size={18} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{info?.name ?? fmtPid(rootText, 6, 4)}</div>
          <CopyId id={rootText} />
        </div>
        <span className="faint" style={{ fontSize: 11.5 }}>funded from your wallet</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            className="btn ghost sm"
            onClick={onRefreshInfo}
            disabled={infoRefreshing}
            title="Refresh SNS name from governance metadata"
          >
            <Icon name="refresh" size={14} />
          </button>
          <button className="btn ghost sm" onClick={() => setConfirmRemove(true)}>
            <Icon name="trash" size={14} />
            Stop tracking
          </button>
        </div>
      </div>
      {infoError && <ErrorHint message="Could not load SNS metadata" detail={infoError} />}

      {fleet.canisters === null && !fleet.error ? (
        <OverviewLoading />
      ) : (
        <div className="fade-up grid" style={{ gap: 'var(--gap)' }}>
          <FleetKpiStrip fleet={fleet} deposit={deposit} rate={rate} historyEvents={null} />
          <FleetDashboard
            fleet={fleet}
            onOpen={onOpen}
            onAdd={() => setGroupEditOpen(true)}
            onGroupEdit={() => setGroupEditOpen(true)}
            schedule={schedule}
          />
        </div>
      )}

      {groupEditOpen && (
        <GroupEditModal
          identity={identity}
          root={root}
          actingAs={null}
          // Seed with the user's FULL fleet, not this page's root-filtered
          // slice: a canister already tracked under a different stamp must show
          // its real config, else saving would silently overwrite it.
          tracked={allCanisters}
          onClose={() => setGroupEditOpen(false)}
          onSaved={() => {
            fleet.refresh();
            onChanged();
            setGroupEditOpen(false);
          }}
        />
      )}

      {confirmRemove && (
        <Modal
          title="Stop tracking this SNS"
          eyebrow="// remove from your configuration"
          onClose={() => setConfirmRemove(false)}
          width={440}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmRemove(false)}>Cancel</button>
              <button className="btn accent" disabled={removing} onClick={() => void doRemove()}>
                {removing ? 'Removing…' : 'Stop tracking'}
              </button>
            </>
          }
        >
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
            This removes {info?.name ?? fmtPid(rootText, 6, 4)} from your tracked SNSes
            {trackedCount > 0
              ? ` and stops funding ${trackedCount} canister${trackedCount === 1 ? '' : 's'} you track under it.`
              : '.'}
            {' '}Your deposit balance is unaffected.
          </p>
          {removeError && <ErrorHint message={removeError} />}
        </Modal>
      )}
    </>
  );
}
