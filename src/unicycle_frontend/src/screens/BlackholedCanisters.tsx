// The user's blackhole-verified canisters — the non-SNS slice of the personal
// fleet. Exists as a page only when the user also tracks SNSes (spec
// decision 6); otherwise the Overview covers it.
import { useCallback, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { useFleet } from '../canisters/useFleet';
import { useDepositBalances } from '../wallet/useDepositBalances';
import { useIcpTcRate } from '../canisters/useIcpTcRate';
import { useTimerSchedule } from '../canisters/useTimerSchedule';
import { AddCanisterModal } from '../canisters/CanisterModals';
import type { CanisterHistory } from '../bindings/unicycle_backend/unicycle_backend';
import { FleetKpiStrip, FleetDashboard, OverviewLoading, OverviewEmpty } from './Overview';

export function BlackholedCanisters({
  identity,
  onOpen,
  onChanged,
}: {
  identity: Identity;
  onOpen: (id: Principal) => void;
  onChanged: () => void;
}) {
  const filter = useCallback((h: CanisterHistory) => h.config.snsRoot === undefined, []);
  const fleet = useFleet(identity, null, filter);
  const deposit = useDepositBalances(identity);
  const rate = useIcpTcRate(identity);
  const schedule = useTimerSchedule(identity);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      {fleet.canisters === null && !fleet.error ? (
        <OverviewLoading />
      ) : !fleet.error && fleet.canisters?.length === 0 ? (
        <OverviewEmpty onAdd={() => setAddOpen(true)} />
      ) : (
        <div className="fade-up grid" style={{ gap: 'var(--gap)' }}>
          <FleetKpiStrip fleet={fleet} deposit={deposit} rate={rate} historyEvents={null} />
          <FleetDashboard fleet={fleet} onOpen={onOpen} onAdd={() => setAddOpen(true)} schedule={schedule} />
        </div>
      )}
      {addOpen && (
        <AddCanisterModal
          identity={identity}
          actingAs={null}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            fleet.refresh();
            onChanged();
            setAddOpen(false);
          }}
        />
      )}
    </>
  );
}
