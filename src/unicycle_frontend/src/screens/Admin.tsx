// Admin console. Port of design_files/screen-admin.jsx wired to the admin
// hooks (useAdminSettings / useAdmins / useAdminVisibility / useServiceConfig)
// plus the adminGet*Info / adminHarvestLpRewards actor calls.
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { createUnicycleBackendActor } from '../auth/actor';
import { Panel, Field, KV, StatusBadge, Modal, Empty, Tabs, ErrorText, TC, CopyId } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtAgo, fmtICP, fmtInt, fmtPid, fmtTC, healthStatus, nsToMs, type UserError } from '../ui/format';
import { useNow } from '../ui/now';
import { useToast } from '../ui/toast';
import { useAdminSettings } from '../admin/useAdminSettings';
import { useAdmins } from '../admin/useAdmins';
import { useAdminVisibility } from '../admin/useAdminVisibility';
import { useServiceConfig } from '../admin/useServiceConfig';
import { useFundLp } from '../admin/useFundLp';
import { useLpPoolBalances } from '../canisters/useLpPoolBalances';
import { parseDecimalAmount } from '../wallet/format';
import { AdminTrends } from './AdminTrends';
import { AdminLogs } from './AdminLogs';
import type { AdminTab } from '../router';
import type {
  AdminLoyaltyInfo,
  AdminLpInfo,
  AdminServiceFundingInfo,
  AdminSettings,
} from '../bindings/unicycle_backend/unicycle_backend';

export interface AdminProps {
  identity: Identity;
  tab: AdminTab;
  onTabChange: (tab: AdminTab) => void;
}

type SettingKey = keyof AdminSettings;

const SETTING_FIELDS: Array<{ key: SettingKey; label: string; hint?: string }> = [
  { key: 'cycleCheckIntervalSeconds', label: 'Cycle-check interval', hint: 'seconds, min 60' },
  { key: 'maxReadingsPerCanister', label: 'Max readings / canister' },
  { key: 'maxTopUpsPerCanister', label: 'Max top-ups / canister' },
  { key: 'batchSize', label: 'Batch size', hint: 'blackhole canisterStatuses' },
  { key: 'baseServiceFeeBps', label: 'Base service fee', hint: 'bps, max 2000 = 20%' },
  { key: 'lpDrainThresholdTcycles', label: 'LP drain threshold', hint: 'cycles, min 1e8' },
  { key: 'serviceFundingThresholdTcycles', label: 'Service funding threshold', hint: 'TCYCLES, 0 disables redirection' },
  { key: 'harvestThresholdTcycles', label: 'Harvest threshold', hint: 'TCYCLES, 0 disables; min reward to collect' },
  { key: 'maxOwners', label: 'Max owners', hint: 'distinct principals, abuse cap' },
  { key: 'maxCanistersPerOwner', label: 'Max canisters / owner', hint: 'abuse cap' },
  { key: 'swapSlippageBps', label: 'Swap slippage', hint: 'bps, max 2000 = 20%; floor on LP/harvest swaps' },
];

function AdminMetric({ label, value, unit, accent }: { label: string; value: ReactNode; unit?: string; accent?: boolean }) {
  return (
    <div style={{ padding: 'var(--pad)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
      <div className="eyebrow" style={{ marginBottom: 7 }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: accent ? 'var(--accent-ink)' : 'var(--text)' }}>
        {value}
        {unit && <span style={{ fontSize: 11, color: 'var(--text-2)', fontWeight: 500 }}> {unit}</span>}
      </div>
    </div>
  );
}

function SettingRow({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px',
        gap: 14,
        alignItems: 'center',
        padding: '9px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div>
        <div style={{ fontSize: 12.5 }}>{label}</div>
        {hint && <div className="faint" style={{ fontSize: 10.5 }}>{hint}</div>}
      </div>
      <input className="input mono" style={{ height: 32 }} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AddAdminModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (text: string) => Promise<{ ok: true } | { ok: false; message: string; detail?: string }>;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<UserError | null>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setError(null);
    const res = await onAdd(text.trim());
    setBusy(false);
    if (res.ok) onClose();
    else setError({ message: res.message, detail: res.detail });
  };
  return (
    <Modal
      title="Add admin"
      eyebrow="// principal"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn accent" disabled={text.trim().length < 6 || busy} onClick={add}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </>
      }
    >
      <Field label="Principal" error={error ? <ErrorText error={error} /> : undefined}>
        <input
          className="input mono"
          placeholder="aaaaa-bbbbb-ccccc-ddddd-cai"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

// Spot pool price as human "TC per ICP" from the X96 sqrt price. token0 = ICP
// (8 dp), token1 = TCYCLES (12 dp): price_raw (TC_e12 per ICP_e8) = (sqrtP/2^96)^2,
// and TC-per-ICP = price_raw * 1e8 / 1e12. Display-only, so float is fine.
function tcPerIcpFromSqrt(sqrtPriceX96: bigint): number {
  const sp = Number(sqrtPriceX96) / 2 ** 96;
  return (sp * sp * 1e8) / 1e12;
}

// One labelled ICP/TC pair in the position-balances row.
function PoolBalCell({ label, icp, tc }: { label: string; icp: bigint; tc: bigint }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 5 }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
        {fmtICP(icp, 4)} <span className="faint" style={{ fontSize: 10 }}>ICP</span>
      </div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
        <TC raw={tc} /> <span className="faint" style={{ fontSize: 10 }}>TC</span>
      </div>
    </div>
  );
}

export function Admin({ identity, tab, onTabChange }: AdminProps) {
  const settingsHook = useAdminSettings(identity);
  const adminsHook = useAdmins(identity);
  const visibility = useAdminVisibility(identity);
  const config = useServiceConfig(identity);
  const now = useNow();
  const toast = useToast();

  // ---- settings form ----
  const [form, setForm] = useState<Record<SettingKey, string> | null>(null);
  useEffect(() => {
    if (settingsHook.settings) {
      const s = settingsHook.settings;
      setForm({
        cycleCheckIntervalSeconds: String(s.cycleCheckIntervalSeconds),
        maxReadingsPerCanister: String(s.maxReadingsPerCanister),
        maxTopUpsPerCanister: String(s.maxTopUpsPerCanister),
        batchSize: String(s.batchSize),
        baseServiceFeeBps: String(s.baseServiceFeeBps),
        lpDrainThresholdTcycles: String(s.lpDrainThresholdTcycles),
        serviceFundingThresholdTcycles: String(s.serviceFundingThresholdTcycles),
        harvestThresholdTcycles: String(s.harvestThresholdTcycles),
        maxOwners: String(s.maxOwners),
        maxCanistersPerOwner: String(s.maxCanistersPerOwner),
        swapSlippageBps: String(s.swapSlippageBps),
      });
    }
  }, [settingsHook.settings]);

  const dirty = useMemo(() => {
    const s = settingsHook.settings;
    if (!s || !form) return false;
    return SETTING_FIELDS.some((f) => form[f.key] !== String(s[f.key]));
  }, [form, settingsHook.settings]);

  const parsedSettings = useMemo<AdminSettings | null>(() => {
    if (!form) return null;
    try {
      return {
        cycleCheckIntervalSeconds: BigInt(form.cycleCheckIntervalSeconds),
        maxReadingsPerCanister: BigInt(form.maxReadingsPerCanister),
        maxTopUpsPerCanister: BigInt(form.maxTopUpsPerCanister),
        batchSize: BigInt(form.batchSize),
        baseServiceFeeBps: BigInt(form.baseServiceFeeBps),
        lpDrainThresholdTcycles: BigInt(form.lpDrainThresholdTcycles),
        serviceFundingThresholdTcycles: BigInt(form.serviceFundingThresholdTcycles),
        harvestThresholdTcycles: BigInt(form.harvestThresholdTcycles),
        maxOwners: BigInt(form.maxOwners),
        maxCanistersPerOwner: BigInt(form.maxCanistersPerOwner),
        swapSlippageBps: BigInt(form.swapSlippageBps),
      };
    } catch {
      return null;
    }
  }, [form]);

  const saveSettings = async () => {
    if (!parsedSettings) return;
    const res = await settingsHook.save(parsedSettings);
    if (res.ok) {
      toast(
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          Settings saved
        </>,
      );
    } else {
      toast(
        <>
          <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
          <ErrorText error={res} />
        </>,
      );
    }
  };

  // ---- service config (ICPSwap pool) ----
  const [poolText, setPoolText] = useState('');
  useEffect(() => {
    if (config.icpSwapPool) setPoolText(config.icpSwapPool.toString());
  }, [config.icpSwapPool]);
  const poolDirty = !!config.icpSwapPool && poolText.trim() !== config.icpSwapPool.toString();
  const savePool = async () => {
    const res = await config.setIcpSwapPool(poolText.trim());
    toast(
      res.ok ? (
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          ICPSwap pool updated
        </>
      ) : (
        <>
          <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
          <ErrorText error={res} />
        </>
      ),
    );
  };

  // ---- service config (blackhole) ----
  const [blackholeText, setBlackholeText] = useState('');
  useEffect(() => {
    if (config.blackhole) setBlackholeText(config.blackhole.toString());
  }, [config.blackhole]);
  const blackholeDirty = !!config.blackhole && blackholeText.trim() !== config.blackhole.toString();
  const saveBlackhole = async () => {
    const res = await config.setBlackholeCanister(blackholeText.trim());
    toast(
      res.ok ? (
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          Blackhole canister updated
        </>
      ) : (
        <>
          <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
          <ErrorText error={res} />
        </>
      ),
    );
  };

  // ---- LP / loyalty / funding info ----
  const [lp, setLp] = useState<AdminLpInfo | null>(null);
  const [loyalty, setLoyalty] = useState<AdminLoyaltyInfo | null>(null);
  const [funding, setFunding] = useState<AdminServiceFundingInfo | null>(null);
  const [infoTick, setInfoTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const b = createUnicycleBackendActor(identity);
    b.adminGetLpInfo().then((r) => { if (!cancelled && r.__kind__ === 'ok') setLp(r.ok); }).catch(() => {});
    b.adminGetLoyaltyInfo().then((r) => { if (!cancelled && r.__kind__ === 'ok') setLoyalty(r.ok); }).catch(() => {});
    b.adminGetServiceFundingInfo().then((r) => { if (!cancelled && r.__kind__ === 'ok') setFunding(r.ok); }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [identity, infoTick]);

  // Live ICPSwap position/pool balances — read directly from the pool, not the
  // backend (see useLpPoolBalances). Keyed off the position id from `lp` and the
  // same `infoTick` the Refresh button bumps.
  const poolBal = useLpPoolBalances(identity, lp?.lpPositionId, infoTick);

  const harvest = async () => {
    try {
      const res = await createUnicycleBackendActor(identity).adminHarvestLpRewards();
      toast(
        res.__kind__ === 'ok' ? (
          <>
            <Icon name="bolt" size={14} style={{ color: 'var(--accent-ink)' }} />
            {res.ok.claimedTcycles === 0n ? 'Nothing to harvest yet' : 'Harvested LP rewards'}
          </>
        ) : (
          <>
            <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
            <ErrorText error={{ message: 'Harvest failed', detail: String(res.err) }} />
          </>
        ),
      );
      setInfoTick((n) => n + 1);
    } catch (e) {
      toast(<>{e instanceof Error ? e.message : String(e)}</>);
    }
  };

  // ---- fund LP position from the admin's wallet (TCYCLES) ----
  const fundLp = useFundLp(identity);
  const [fundAmount, setFundAmount] = useState('');
  const fundRaw = parseDecimalAmount(fundAmount, 12); // TCYCLES has 12 decimals
  const fundBusy = fundLp.status.kind === 'approving' || fundLp.status.kind === 'funding';
  const fundError =
    fundLp.status.kind === 'error' ? { message: fundLp.status.message, detail: fundLp.status.detail } : undefined;
  const doFund = () => {
    if (fundRaw !== null && fundRaw > 0n) fundLp.fund(fundRaw);
  };
  useEffect(() => {
    if (fundLp.status.kind === 'success') {
      const ev = fundLp.status.event;
      toast(
        <>
          <Icon name="plus" size={14} style={{ color: 'var(--accent-ink)' }} />
          Funded LP — <TC raw={ev.tcyclesIn} /> TC in
        </>,
      );
      setFundAmount('');
      setInfoTick((n) => n + 1);
      fundLp.reset();
    }
  }, [fundLp.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- admins (controllers ∪ explicit admins) ----
  const adminRows = useMemo(() => {
    const controllers = adminsHook.cachedControllers ?? [];
    const explicit = adminsHook.admins ?? [];
    const seen = new Map<string, Principal>();
    for (const p of [...controllers, ...explicit]) seen.set(p.toString(), p);
    const primaryText = adminsHook.primaryAdmin?.toString();
    const controllerSet = new Set(controllers.map((p) => p.toString()));
    const explicitSet = new Set(explicit.map((p) => p.toString()));
    return [...seen.values()].map((p) => {
      const t = p.toString();
      return { principal: p, text: t, primary: t === primaryText, controller: controllerSet.has(t), explicit: explicitSet.has(t) };
    });
  }, [adminsHook.cachedControllers, adminsHook.admins, adminsHook.primaryAdmin]);

  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ owner: Principal; canisterId: Principal } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const runAdminAction = async (
    p: Promise<{ ok: true } | { ok: false; message: string; detail?: string }>,
    success: string,
  ) => {
    const res = await p;
    toast(
      res.ok ? (
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          {success}
        </>
      ) : (
        <>
          <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
          <ErrorText error={res} />
        </>
      ),
    );
  };

  const metrics = visibility.metrics;
  const tracked = visibility.tracked ?? [];
  const recentTopUps = visibility.topUps ?? [];
  const intervalSecs = visibility.timerInfo?.cycleCheckIntervalSeconds ?? settingsHook.settings?.cycleCheckIntervalSeconds;

  return (
    <div className="grid fade-up" style={{ gap: 'var(--gap)' }}>
      <div
        className="panel"
        style={{
          background: 'color-mix(in oklch, var(--warn) 6%, transparent)',
          borderColor: 'color-mix(in oklch, var(--warn) 30%, transparent)',
          padding: '11px var(--pad)',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <Icon name="shield" size={15} style={{ color: 'var(--warn)' }} />
        <span style={{ fontSize: 12.5 }}>
          Administrative controls for the Unicycle service. Changes take effect immediately across all owners.
        </span>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'trends', label: 'Trends' },
          { id: 'logs', label: 'Logs' },
        ]}
        active={tab}
        onChange={(id) => onTabChange(id as AdminTab)}
      />

      {tab === 'trends' && <AdminTrends identity={identity} metrics={metrics} />}
      {tab === 'logs' && <AdminLogs identity={identity} />}

      {tab === 'overview' && (
        <>
      {/* metrics strip */}
      <Panel
        flush
        title="System metrics"
        eyebrow="// live"
        actions={
          <>
            {intervalSecs !== undefined && (
              <span className="badge">
                <Icon name="clock" size={10} />
                timer {intervalSecs.toString()}s
              </span>
            )}
            <button className="btn sm" onClick={() => visibility.refresh()}>
              <Icon name="refresh" size={13} />
              Refresh
            </button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <AdminMetric label="Owners" value={metrics ? fmtInt(metrics.ownersCount) : '—'} />
          <AdminMetric label="Tracked" value={metrics ? fmtInt(metrics.trackedCanistersCount) : '—'} />
          <AdminMetric label="Readings" value={metrics ? fmtInt(metrics.readingsTotal) : '—'} />
          <AdminMetric label="Top-ups" value={metrics ? fmtInt(metrics.topUpsTotal) : '—'} />
          <AdminMetric
            label="In flight"
            value={metrics ? fmtInt(metrics.inFlightCount) : '—'}
            accent={!!metrics && metrics.inFlightCount > 0n}
          />
          <AdminMetric label="Svc cycles" value={metrics ? <TC raw={metrics.serviceCyclesBalance} /> : '—'} unit="TC" />
        </div>
      </Panel>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        {/* settings */}
        <Panel
          title="Settings"
          eyebrow="// tunable params"
          actions={
            <button className="btn sm accent" disabled={!dirty || !parsedSettings} onClick={saveSettings}>
              {dirty ? 'Save' : 'Saved'}
            </button>
          }
        >
          {form ? (
            SETTING_FIELDS.map((f) => (
              <SettingRow
                key={f.key}
                label={f.label}
                hint={f.hint}
                value={form[f.key]}
                onChange={(v) => setForm((prev) => (prev ? { ...prev, [f.key]: v } : prev))}
              />
            ))
          ) : (
            <div className="faint">Loading settings…</div>
          )}
        </Panel>

        <div className="grid" style={{ gap: 'var(--gap)' }}>
          {/* service config */}
          <Panel title="Service configuration" eyebrow="// canister wiring">
            <Field label="ICPSwap pool">
              <div className="input-group">
                <input className="input mono" value={poolText} onChange={(e) => setPoolText(e.target.value)} style={{ flex: 1 }} />
                {poolDirty && (
                  <button className="btn" onClick={savePool}>
                    Set
                  </button>
                )}
              </div>
            </Field>
            <Field label="Blackhole">
              <div className="input-group">
                <input className="input mono" value={blackholeText} onChange={(e) => setBlackholeText(e.target.value)} style={{ flex: 1 }} />
                {blackholeDirty && (
                  <button className="btn" onClick={saveBlackhole}>
                    Set
                  </button>
                )}
              </div>
            </Field>
            <div style={{ marginTop: 12 }}>
              <KV k="SNS-Wasm registry">{config.snsWasm ? fmtPid(config.snsWasm.toString(), 8, 5) : '—'}</KV>
            </div>
            <div className="faint" style={{ fontSize: 10.5, marginTop: 8 }}>
              Static init-arg config — set at deploy, not runtime-changeable.
            </div>
          </Panel>

          {/* admins */}
          <Panel
            title="Admins"
            eyebrow="// principals with control"
            actions={
              <button className="btn sm" onClick={() => setAddAdminOpen(true)}>
                <Icon name="plus" size={13} />
                Add
              </button>
            }
          >
            {adminRows.length === 0 ? (
              <div className="faint">Loading…</div>
            ) : (
              adminRows.map((a) => (
                <div
                  key={a.text}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)' }}
                >
                  <span style={{ flex: 1 }}><CopyId id={a.text} head={10} tail={6} /></span>
                  {a.primary && <span className="badge ok">primary</span>}
                  {a.controller && <span className="badge muted">controller</span>}
                  {!a.primary && (
                    <button
                      className="btn sm ghost"
                      onClick={() => runAdminAction(adminsHook.setPrimaryAdmin(a.principal), 'Primary admin updated')}
                    >
                      Make primary
                    </button>
                  )}
                  {a.explicit && !a.primary && (
                    <button
                      className="iconbtn"
                      style={{ width: 27, height: 27 }}
                      title="Remove admin"
                      onClick={() => runAdminAction(adminsHook.removeAdmin(a.principal), 'Admin removed')}
                    >
                      <Icon name="x" size={13} />
                    </button>
                  )}
                </div>
              ))
            )}
          </Panel>
        </div>
      </div>

      {/* fee pool / LP + loyalty */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <Panel
          title="Fee pool & LP"
          eyebrow="// liquidity"
          actions={
            <button className="btn sm" onClick={() => setInfoTick((n) => n + 1)}>
              <Icon name="refresh" size={13} />
              Refresh
            </button>
          }
        >
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0 16px', marginBottom: 12 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Fee pool</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                {lp ? <TC raw={lp.feePoolBalanceTcycles} /> : '—'} <span className="faint" style={{ fontSize: 10 }}>TC</span>
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Cumulative</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                {lp ? <TC raw={lp.cumulativeFeesTcycles} /> : '—'} <span className="faint" style={{ fontSize: 10 }}>TC</span>
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Admin funded</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                {lp ? <TC raw={lp.cumulativeAdminFundedTcycles} /> : '—'} <span className="faint" style={{ fontSize: 10 }}>TC</span>
              </div>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 5 }}>Position</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>
                {lp?.lpPositionId !== undefined ? `#${lp.lpPositionId.toString()}` : '—'}
              </div>
            </div>
          </div>
          {lp?.lpPositionId !== undefined && (
            <div style={{ marginBottom: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Position balances // live from pool</div>
              {poolBal.error ? (
                <div className="faint" style={{ fontSize: 11.5 }}>Pool read failed: {poolBal.error}</div>
              ) : !poolBal.data ? (
                <div className="faint" style={{ fontSize: 11.5 }}>{poolBal.loading ? 'Loading…' : '—'}</div>
              ) : (
                <>
                  <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', gap: '0 16px' }}>
                    <PoolBalCell label="In position" icp={poolBal.data.positionIcp} tc={poolBal.data.positionTcycles} />
                    <PoolBalCell label="Unused (not in pool)" icp={poolBal.data.unusedIcp} tc={poolBal.data.unusedTcycles} />
                    <PoolBalCell label="Unclaimed fees" icp={poolBal.data.unclaimedIcp} tc={poolBal.data.unclaimedTcycles} />
                  </div>
                  <div className="faint mono" style={{ fontSize: 11, marginTop: 6 }}>
                    pool price ≈ 1 ICP : {fmtTC(tcPerIcpFromSqrt(poolBal.data.sqrtPriceX96), 2)} TC
                  </div>
                </>
              )}
            </div>
          )}
          <Field
            label="Fund position from wallet"
            hint="TCYCLES — adds liquidity to the position; reward share unchanged"
            error={fundError ? <ErrorText error={fundError} /> : undefined}
          >
            <div className="input-group">
              <input
                className="input mono"
                placeholder="0.0 TC"
                value={fundAmount}
                onChange={(e) => setFundAmount(e.target.value)}
                disabled={fundBusy}
                style={{ flex: 1 }}
              />
              <button className="btn" onClick={doFund} disabled={fundBusy || fundRaw === null || fundRaw <= 0n}>
                {fundLp.status.kind === 'approving' ? 'Approving…' : fundLp.status.kind === 'funding' ? 'Funding…' : 'Fund'}
              </button>
            </div>
          </Field>
          <div className="eyebrow" style={{ marginBottom: 6, marginTop: 14 }}>Recent LP drains</div>
          {lp && lp.lpHistory.length > 0 ? (
            <table className="tbl" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>When</th>
                  <th className="num">T in</th>
                  <th className="num">ICP out</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {lp.lpHistory.map((e, i) => (
                  <tr key={i}>
                    <td className="mono faint" style={{ fontSize: 11 }}>{fmtAgo(nsToMs(e.at), now)}</td>
                    <td className="num mono"><TC raw={e.tcyclesIn} /></td>
                    <td className="num mono">{fmtICP(e.icpOut, 2)}</td>
                    <td>
                      {e.outcome.__kind__ === 'ok' ? <span className="badge ok">ok</span> : <span className="badge crit">err</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="faint" style={{ fontSize: 11.5 }}>No LP drains recorded.</div>
          )}
        </Panel>

        <Panel
          title="Loyalty rebates"
          eyebrow="// US18 surplus sharing"
          actions={
            <button className="btn sm" onClick={harvest}>
              <Icon name="bolt" size={13} />
              Harvest now
            </button>
          }
        >
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0 22px', marginBottom: 12 }}>
            <KV k="Total shares">{loyalty ? <TC raw={loyalty.totalSharesTcycles} /> : '—'} TC</KV>
            <KV k="Contributors">{loyalty ? fmtInt(loyalty.contributorCount) : '—'}</KV>
            <KV k="Cumulative surplus">{loyalty ? <TC raw={loyalty.cumulativeSurplusRewardsTcycles} /> : '—'} TC</KV>
            <KV k="Rebates granted">{loyalty ? <TC raw={loyalty.cumulativeRebatesGrantedTcycles} /> : '—'} TC</KV>
            <KV k="Outstanding">
              <span className="accent">{loyalty ? <TC raw={loyalty.outstandingRebateCreditTcycles} /> : '—'} TC</span>
            </KV>
          </div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Top contributors</div>
          {loyalty && loyalty.topContributors.length > 0 ? (
            loyalty.topContributors.map(([pid, sh], i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                <span className="mono faint" style={{ fontSize: 11, width: 16 }}>{i + 1}</span>
                <span className="mono" style={{ fontSize: 11.5, flex: 1 }}>{fmtPid(pid.toString(), 8, 5)}</span>
                <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}><TC raw={sh} /> TC</span>
              </div>
            ))
          ) : (
            <div className="faint" style={{ fontSize: 11.5 }}>No contributors yet.</div>
          )}
        </Panel>
      </div>

      {/* service funding */}
      <Panel title="Service funding" eyebrow="// fee routing">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '0 22px' }}>
          <KV k="Primary admin">{funding?.primaryAdmin ? fmtPid(funding.primaryAdmin.toString(), 8, 5) : '—'}</KV>
          <KV k="Funding threshold">{funding ? <TC raw={funding.serviceFundingThresholdTcycles} /> : '—'} TC</KV>
          <KV k="Subaccount balance">{funding ? <TC raw={funding.primaryAdminSubaccountTcycles} /> : '—'} TC</KV>
          <KV k="Routing">
            {funding ? (
              funding.feeRoutingToService ? (
                <span className="badge warn">→ service</span>
              ) : (
                <span className="badge ok">→ LP pool</span>
              )
            ) : (
              '—'
            )}
          </KV>
          <KV k="Cumulative fees">{funding ? <TC raw={funding.cumulativeFeesTcycles} /> : '—'} TC</KV>
          <KV k="…redirected">{funding ? <TC raw={funding.cumulativeServiceFundingTcycles} /> : '—'} TC</KV>
        </div>
      </Panel>

      {/* all tracked + recent top-ups */}
      <Panel
        flush
        title="All tracked canisters"
        eyebrow={`// ${tracked.length} across fleet`}
        actions={
          <button className="btn sm" onClick={() => visibility.refresh()} disabled={visibility.loading} title="Refresh">
            <Icon name="refresh" size={13} />
          </button>
        }
      >
        {tracked.length === 0 ? (
          <Empty icon="canisters" title="None tracked">No canisters are tracked across the service yet.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Owner</th>
                <th>Canister</th>
                <th className="num">Balance</th>
                <th className="num">Min</th>
                <th className="num">Top-up</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tracked.slice(0, 50).map((row, i) => {
                const cur =
                  row.latestReading?.result.__kind__ === 'ok' ? row.latestReading.result.ok : null;
                const status = healthStatus(
                  cur,
                  row.config.minCycleBalance,
                  row.config.suspendedUntil !== undefined,
                  { topUpAmount: row.config.cycleTopUpAmount },
                );
                return (
                  <tr key={i}>
                    <td><CopyId id={row.owner.toString()} head={6} tail={4} size={11} faint /></td>
                    <td><CopyId id={row.canisterId.toString()} head={8} tail={5} size={11.5} /></td>
                    <td className="num mono"><TC raw={cur} /></td>
                    <td className="num mono"><TC raw={row.config.minCycleBalance} /></td>
                    <td className="num mono"><TC raw={row.config.cycleTopUpAmount} /></td>
                    <td>
                      <StatusBadge status={status} dot={false} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="iconbtn"
                        style={{ width: 27, height: 27 }}
                        title="Remove tracked canister"
                        onClick={() => setRemoveTarget({ owner: row.owner, canisterId: row.canisterId })}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel flush title="Recent top-ups" eyebrow="// newest first">
        {recentTopUps.length === 0 ? (
          <Empty icon="bolt" title="No top-ups yet">No top-up attempts recorded across the service.</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Owner</th>
                <th>Canister</th>
                <th className="num">Amount</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {recentTopUps.slice(0, 20).map((row, i) => {
                const u = row.topUp;
                const ok = u.result.__kind__ === 'ok';
                return (
                  <tr key={i}>
                    <td className="mono faint" style={{ fontSize: 11 }}>{fmtAgo(nsToMs(u.attemptedAt), now)}</td>
                    <td><CopyId id={row.owner.toString()} head={6} tail={4} size={11} faint /></td>
                    <td><CopyId id={row.canisterId.toString()} head={7} tail={4} size={11.5} /></td>
                    <td className="num mono" style={{ fontWeight: 600 }}><TC raw={u.amount} /> TC</td>
                    <td>
                      {ok && u.result.__kind__ === 'ok' ? (
                        <span className="badge ok">block {u.result.ok.toString()}</span>
                      ) : (
                        <>
                          <span className="badge crit">err</span>
                          {u.result.__kind__ === 'err' && (
                            <div
                              className="mono"
                              style={{ fontSize: 9.5, color: 'var(--crit)', marginTop: 3, maxWidth: 280, whiteSpace: 'normal', lineHeight: 1.4 }}
                            >
                              {u.result.err}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
        </>
      )}

      {addAdminOpen && <AddAdminModal onClose={() => setAddAdminOpen(false)} onAdd={adminsHook.addAdmin} />}
      {removeTarget && (
        <Modal
          title="Remove tracked canister?"
          eyebrow={`// owner ${fmtPid(removeTarget.owner.toString(), 6, 4)}`}
          onClose={() => (removeBusy ? undefined : setRemoveTarget(null))}
          footer={
            <>
              <button className="btn" disabled={removeBusy} onClick={() => setRemoveTarget(null)}>
                Cancel
              </button>
              <button
                className="btn accent"
                disabled={removeBusy}
                onClick={async () => {
                  setRemoveBusy(true);
                  const res = await visibility.removeTracked(removeTarget.owner, removeTarget.canisterId);
                  setRemoveBusy(false);
                  toast(
                    res.ok ? (
                      <>
                        <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
                        Canister removed
                      </>
                    ) : (
                      <>
                        <Icon name="x" size={14} style={{ color: 'var(--crit)' }} />
                        <ErrorText error={res} />
                      </>
                    ),
                  );
                  setRemoveTarget(null);
                  if (res.ok) visibility.refresh();
                }}
              >
                {removeBusy ? 'Removing…' : 'Remove'}
              </button>
            </>
          }
        >
          <div style={{ fontSize: 13 }}>
            <span className="mono">{fmtPid(removeTarget.canisterId.toString(), 8, 5)}</span> will stop being monitored for owner{' '}
            <span className="mono">{fmtPid(removeTarget.owner.toString(), 6, 4)}</span>. They can re-add it later.
          </div>
        </Modal>
      )}
    </div>
  );
}
