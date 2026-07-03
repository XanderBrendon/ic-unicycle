import { useCallback, useEffect, useState } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import type {
  SnsSetDepositConfigArg,
  SnsSetDrainAlertConfigArg,
  SnsSetReportConfigArg,
} from '../bindings/unicycle_backend/unicycle_backend';

export interface SnsConfigs {
  deposit: SnsSetDepositConfigArg | null | undefined; // undefined = loading, null = not set
  report: SnsSetReportConfigArg | null | undefined;
  drainAlert: SnsSetDrainAlertConfigArg | null | undefined;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// Current on-chain config values via the backend read-throughs (update calls —
// they may refresh the SNS registry server-side, so expect ~2s).
export function useSnsConfigs(identity: Identity | null, governance: Principal | null): SnsConfigs {
  const [deposit, setDeposit] = useState<SnsSetDepositConfigArg | null | undefined>(undefined);
  const [report, setReport] = useState<SnsSetReportConfigArg | null | undefined>(undefined);
  const [drainAlert, setDrainAlert] = useState<SnsSetDrainAlertConfigArg | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!identity || !governance) return;
    let cancelled = false;
    setLoading(true);
    setDeposit(undefined);
    setReport(undefined);
    setDrainAlert(undefined);
    const backend = createUnicycleBackendActor(identity);
    Promise.all([
      backend.getSnsDepositConfig(governance),
      backend.getSnsReportConfig(governance),
      backend.getSnsDrainAlertConfig(governance),
    ])
      .then(([d, r, a]) => {
        if (cancelled) return;
        setDeposit(d);
        setReport(r);
        setDrainAlert(a);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [identity, governance, tick]);

  return { deposit, report, drainAlert, loading, error, refresh };
}
