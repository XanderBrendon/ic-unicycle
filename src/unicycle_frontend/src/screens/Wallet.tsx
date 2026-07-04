// Wallet — local wallet, deposit balance, and deposit/withdraw/transfer flows.
// Port of design_files/screen-wallet.jsx wired to the real wallet hooks.
// Amounts are bigint smallest-units; user input is parsed with parseDecimalAmount.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import { createUnicycleBackendActor } from '../auth/actor';
import { Panel, Field, Modal, KV, Seg, Empty, ErrorText, TC } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { Sparkline } from '../ui/charts';
import { fmtAgo, fmtICP, nsToMs, type UserError } from '../ui/format';
import { useNow } from '../ui/now';
import { useToast } from '../ui/toast';
import { useLocalWalletBalances } from '../wallet/useLocalWalletBalances';
import { useDepositBalances } from '../wallet/useDepositBalances';
import { useBalanceHistory, reconstructSeries, eventLabel } from '../wallet/useBalanceHistory';
import { Token, Variant_credit_debit, type BalanceEvent } from '../bindings/unicycle_backend/unicycle_backend';
import { useCustomTokens } from '../wallet/useCustomTokens';
import { useDeposit } from '../wallet/useDeposit';
import { useWithdraw } from '../wallet/useWithdraw';
import { useTransfer } from '../wallet/useTransfer';
import { BUILT_IN_TOKENS, isBuiltIn, type TokenInfo } from '../wallet/tokens';
import { parseDecimalAmount, formatTokenAmount } from '../wallet/format';
import { parseDestination } from '../wallet/parseDestination';

export interface WalletProps {
  identity: Identity;
}

type FlowMode = 'deposit' | 'withdraw' | 'transfer';

function balanceText(raw: bigint | null, token: TokenInfo): { value: ReactNode; suffix: string } {
  if (raw === null) return { value: '—', suffix: '' };
  if (token.symbol === 'TCYCLES') return { value: <TC raw={raw} dp={4} />, suffix: 'TC' };
  return { value: formatTokenAmount(raw, token.decimals), suffix: '' };
}

function amountLabel(raw: bigint, token: TokenInfo): ReactNode {
  return token.symbol === 'TCYCLES' ? (
    <><TC raw={raw} dp={4} /> TC</>
  ) : (
    `${formatTokenAmount(raw, token.decimals)} ${token.symbol}`
  );
}

function TokenRow({
  token,
  balance,
  kind,
  onDeposit,
  onTransfer,
  onWithdraw,
  onRemove,
}: {
  token: TokenInfo;
  balance: bigint | null;
  kind: 'local' | 'deposit';
  onDeposit?: () => void;
  onTransfer?: () => void;
  onWithdraw?: () => void;
  onRemove?: () => void;
}) {
  const builtin = isBuiltIn(token);
  const b = balanceText(balance, token);
  return (
    <div className="token-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px var(--pad)', borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          width: 34,
          height: 34,
          flex: 'none',
          borderRadius: 7,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--panel-2)',
          border: '1px solid var(--border)',
          fontFamily: "'JetBrains Mono', monospace",
          fontWeight: 700,
          fontSize: 12,
          color: 'var(--accent-ink)',
        }}
      >
        {token.symbol.slice(0, 2)}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{token.symbol}</span>
          {!builtin && <span className="badge muted" style={{ height: 16, fontSize: 9 }}>custom</span>}
        </div>
        <div className="faint" style={{ fontSize: 11 }}>{token.name}</div>
      </div>
      <div className="mono" style={{ fontSize: 15, fontWeight: 600, textAlign: 'right', minWidth: 90 }}>
        {b.value}
        <span style={{ color: 'var(--text-2)', fontSize: 11, fontWeight: 500 }}> {b.suffix}</span>
      </div>
      <div className="row-actions" style={{ display: 'flex', gap: 6 }}>
        {kind === 'local' && builtin && (
          <button className="btn sm" onClick={onDeposit}>
            <Icon name="download" size={13} />
            Deposit
          </button>
        )}
        {kind === 'local' && (
          <button className="btn sm" onClick={onTransfer}>
            <Icon name="send" size={12} />
            Send
          </button>
        )}
        {kind === 'deposit' && (
          <button className="btn sm" onClick={onWithdraw}>
            <Icon name="upload" size={13} />
            Withdraw
          </button>
        )}
        {kind === 'local' && !builtin && (
          <button className="iconbtn" style={{ width: 27, height: 27 }} onClick={onRemove} title="Remove token">
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function FlowModal({
  identity,
  mode,
  token,
  srcBalance,
  onClose,
  onDone,
}: {
  identity: Identity;
  mode: FlowMode;
  token: TokenInfo;
  srcBalance: bigint | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const deposit = useDeposit(identity);
  const withdraw = useWithdraw(identity);
  const transfer = useTransfer(identity);
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [submitted, setSubmitted] = useState<bigint | null>(null);
  const [destError, setDestError] = useState<string | null>(null);

  const status = mode === 'deposit' ? deposit.status : mode === 'withdraw' ? withdraw.status : transfer.status;
  const busy = status.kind !== 'idle' && status.kind !== 'success' && status.kind !== 'error';

  const fee = token.fee;
  const totalFee = mode === 'deposit' ? fee * 2n : fee;
  const src = srcBalance ?? 0n;
  const maxSpendable = src > totalFee ? src - totalFee : 0n;
  const raw = parseDecimalAmount(amount, token.decimals);
  const amtValid = raw !== null && raw > 0n && raw <= maxSpendable;
  const destValid = mode !== 'transfer' || (dest.trim().length > 0 && parseDestination(dest).ok);
  const valid = amtValid && destValid;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (status.kind === 'success' && submitted !== null) {
      const verb = mode === 'deposit' ? 'Deposited' : mode === 'withdraw' ? 'Withdrew' : 'Sent';
      toast(
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          {verb} <b>{amountLabel(submitted, token)}</b>
        </>,
      );
      onDone();
      onClose();
    }
  }, [status.kind]);

  const titles: Record<FlowMode, string> = {
    deposit: 'Deposit to service',
    withdraw: 'Withdraw to local wallet',
    transfer: 'Send tokens',
  };
  const subt: Record<FlowMode, string> = {
    deposit: 'Move funds into your Unicycle deposit balance so the service can fund top-ups.',
    withdraw: 'Pull funds from your deposit balance back to your local wallet.',
    transfer: 'Send to any principal or ICRC-1 account.',
  };

  const setMax = () => setAmount(formatTokenAmount(maxSpendable, token.decimals));

  const confirm = () => {
    if (!valid || raw === null) return;
    setSubmitted(raw);
    if (mode === 'deposit') {
      deposit.deposit(token, raw);
    } else if (mode === 'withdraw') {
      withdraw.withdraw(token, raw);
    } else {
      const d = parseDestination(dest);
      if (!d.ok) {
        setDestError(d.error);
        return;
      }
      setDestError(null);
      transfer.transfer(token, d.account, raw);
    }
  };

  const afterRaw = raw !== null ? src - raw - totalFee : 0n;
  const insufficient = afterRaw < 0n;
  const after = insufficient ? 0n : afterRaw;

  return (
    <Modal
      title={titles[mode]}
      eyebrow={`// ${token.symbol}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn accent" disabled={!valid || busy} onClick={confirm}>
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </>
      }
    >
      <div className="grid" style={{ gap: 16 }}>
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.55 }}>{subt[mode]}</p>
        {mode === 'transfer' && (
          <Field label="Destination" error={destError ?? undefined}>
            <input
              className="input mono"
              placeholder="principal or ICRC-1 account"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
            />
          </Field>
        )}
        <Field
          label="Amount"
          hint={
            mode === 'deposit'
              ? 'The ledger fee is charged twice — on approve and on transfer_from.'
              : 'A ledger fee is charged on top of the amount.'
          }
        >
          <div className="input-group">
            <div className="input-suffix" style={{ flex: 1 }}>
              <input
                className="input mono"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
              <span className="sfx">{token.symbol === 'TCYCLES' ? 'TC' : token.symbol}</span>
            </div>
            <button className="btn" onClick={setMax}>
              Max
            </button>
          </div>
        </Field>
        <div className="panel" style={{ background: 'var(--bg-2)', padding: '10px 12px' }}>
          <KV k="Available">{amountLabel(src, token)}</KV>
          <KV k={mode === 'deposit' ? 'Network fee (2×)' : 'Network fee'}>{amountLabel(totalFee, token)}</KV>
          {raw !== null && raw > 0n && (
            <KV k="After">
              <span className={insufficient ? '' : 'accent'} style={{ color: insufficient ? 'var(--crit)' : undefined }}>
                {amountLabel(after, token)}
              </span>
            </KV>
          )}
        </div>
        {status.kind === 'error' && (
          <div className="hint" style={{ color: 'var(--crit)' }}>
            <ErrorText error={status} />
          </div>
        )}
      </div>
    </Modal>
  );
}

function eventAmount(e: BalanceEvent): ReactNode {
  const sign = e.direction === Variant_credit_debit.credit ? '+' : '−';
  return e.token === Token.ICP ? (
    `${sign}${fmtICP(e.amount)} ICP`
  ) : (
    <>{sign}<TC raw={e.amount} dp={3} /> TC</>
  );
}

// Deposit-balance history: a balance line reconstructed from the caller's
// balance-event stream (anchored to the live ledger balance) plus the most
// recent events. Rebate accruals appear in the list but not the line — they
// are credit accounting, not token movements.
function DepositHistoryPanel({
  events,
  liveBalances,
}: {
  events: BalanceEvent[] | null;
  liveBalances: { TCYCLES: bigint | null; ICP: bigint | null };
}) {
  const now = useNow();
  const [token, setToken] = useState<Token>(Token.TCYCLES);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const live = token === Token.ICP ? liveBalances.ICP : liveBalances.TCYCLES;
  const series = events && live !== null ? reconstructSeries(events, token, live) : null;

  const all = events ?? [];
  const total = all.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, pageCount - 1);
  const start = clampedPage * pageSize;
  const pageEvents = all.slice(start, start + pageSize);

  return (
    <Panel
      flush
      title="Deposit history"
      eyebrow="// balance over time"
      actions={
        <Seg<Token>
          options={[
            { value: Token.TCYCLES, label: 'TC' },
            { value: Token.ICP, label: 'ICP' },
          ]}
          value={token}
          onChange={setToken}
        />
      }
    >
      {!events || events.length === 0 ? (
        <Empty icon="activity" title="No activity yet">
          Deposits, withdrawals, top-up spends and fees will chart your balance here.
        </Empty>
      ) : (
        <>
          {series && series.length >= 2 && (
            <div style={{ padding: 'var(--pad)', borderBottom: '1px solid var(--border)' }}>
              <Sparkline data={series.map((p) => p.bal)} w={420} h={60} fill />
            </div>
          )}
          <div>
            {pageEvents.map((e, i) => {
              const rebate = e.kind.__kind__ === 'rebateSettled';
              return (
                <div
                  key={start + i}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px var(--pad)', borderBottom: '1px solid var(--border)' }}
                >
                  <span className="mono faint" style={{ fontSize: 10.5, width: 70, flex: 'none' }}>
                    {fmtAgo(nsToMs(e.at), now)}
                  </span>
                  <span style={{ fontSize: 12, flex: 1 }} className={rebate ? 'accent' : ''}>
                    {eventLabel(e)}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: rebate
                        ? 'var(--accent-ink)'
                        : e.direction === Variant_credit_debit.credit
                          ? 'var(--accent-ink)'
                          : undefined,
                    }}
                  >
                    {eventAmount(e)}
                  </span>
                </div>
              );
            })}
          </div>
          <div
            className="panel-head"
            style={{ borderBottom: 'none', borderTop: '1px solid var(--border)', gap: 12 }}
          >
            <span className="mono faint" style={{ fontSize: 11 }}>
              {total} record{total === 1 ? '' : 's'}
            </span>
            <label className="mono faint" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              Rows
              <select
                className="input mono"
                style={{ height: 26, fontSize: 11.5, width: 64 }}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="mono faint" style={{ fontSize: 11 }}>
                {start + 1}–{Math.min(start + pageSize, total)}
              </span>
              <button
                className="iconbtn"
                style={{ width: 26, height: 26, opacity: clampedPage === 0 ? 0.4 : 1 }}
                disabled={clampedPage === 0}
                onClick={() => setPage(Math.max(0, clampedPage - 1))}
                title="Previous page"
              >
                <Icon name="chevronR" size={14} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button
                className="iconbtn"
                style={{ width: 26, height: 26, opacity: clampedPage >= pageCount - 1 ? 0.4 : 1 }}
                disabled={clampedPage >= pageCount - 1}
                onClick={() => setPage(Math.min(pageCount - 1, clampedPage + 1))}
                title="Next page"
              >
                <Icon name="chevronR" size={14} />
              </button>
            </div>
          </div>
          <div
            className="faint"
            style={{ padding: '8px var(--pad)', fontSize: 10.5, lineHeight: 1.5, borderTop: '1px solid var(--border)' }}
          >
            Only Unicycle activity is shown — deposits, withdrawals, top-up spends and fees. Direct ledger transfers to your deposit account aren't listed here.
          </div>
        </>
      )}
    </Panel>
  );
}

function FlowDiagram() {
  const steps: Array<{ ico: Parameters<typeof Icon>[0]['name']; label: string; sub: string }> = [
    { ico: 'wallet', label: 'Local wallet', sub: 'your tokens' },
    { ico: 'download', label: 'Deposit balance', sub: 'service-held' },
    { ico: 'bolt', label: 'Canisters', sub: 'auto top-up' },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <div
            style={{
              flex: 1,
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '4px 0',
            }}
          >
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 9,
                display: 'grid',
                placeItems: 'center',
                background: i === 1 ? 'var(--accent-soft)' : 'var(--panel-2)',
                border: `1px solid ${i === 1 ? 'var(--accent-line)' : 'var(--border)'}`,
              }}
            >
              <Icon name={s.ico} size={17} style={{ color: i === 1 ? 'var(--accent-ink)' : 'var(--text-1)' }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</div>
              <div className="faint mono" style={{ fontSize: 9.5 }}>{s.sub}</div>
            </div>
          </div>
          {i < steps.length - 1 && <Icon name="chevronR" size={16} style={{ color: 'var(--text-2)', flex: 'none' }} />}
        </div>
      ))}
    </div>
  );
}

function AddTokenModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (ledgerCanisterId: string) => Promise<{ ok: true } | { ok: false; error: UserError }>;
}) {
  const toast = useToast();
  const [id, setId] = useState('');
  const [error, setError] = useState<UserError | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setError(null);
    const res = await onAdd(id.trim());
    setBusy(false);
    if (res.ok) {
      toast(
        <>
          <Icon name="check" size={14} style={{ color: 'var(--accent-ink)' }} />
          Token added
        </>,
      );
      onClose();
    } else {
      setError(res.error);
    }
  };

  return (
    <Modal
      title="Add custom token"
      eyebrow="// ICRC-1 ledger"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn accent" disabled={id.trim().length < 6 || busy} onClick={add}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </>
      }
    >
      <Field
        label="Ledger canister id"
        hint="Display + transfer only — custom tokens have no typed deposit path."
        error={error ? <ErrorText error={error} /> : undefined}
      >
        <input
          className="input mono"
          placeholder="aaaaa-bbbbb-ccccc-ddddd-cai"
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

export function Wallet({ identity }: WalletProps) {
  const { customTokens, addToken, removeToken } = useCustomTokens(identity);
  const local = useLocalWalletBalances(identity, customTokens);
  const deposit = useDepositBalances(identity);
  const history = useBalanceHistory(identity);
  const [flow, setFlow] = useState<{ mode: FlowMode; token: TokenInfo } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [rebate, setRebate] = useState<bigint | null>(null);

  const refreshRebate = () => {
    if (!identity) return;
    createUnicycleBackendActor(identity)
      .getMyLoyaltyStatus()
      .then((s) => setRebate(s.claimableRebateTcycles))
      .catch(() => {});
  };

  useEffect(() => {
    let cancelled = false;
    createUnicycleBackendActor(identity)
      .getMyLoyaltyStatus()
      .then((s) => {
        if (!cancelled) setRebate(s.claimableRebateTcycles);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [identity]);

  const localTokens: TokenInfo[] = [...BUILT_IN_TOKENS, ...customTokens];
  const depositTokens = BUILT_IN_TOKENS;

  const srcBalance = (mode: FlowMode, token: TokenInfo): bigint | null =>
    mode === 'withdraw' ? deposit.balances[token.symbol] ?? null : local.balances[token.symbol] ?? null;

  const onDone = () => {
    local.refresh();
    deposit.refresh();
    history.refresh();
    refreshRebate();
  };

  let footer: ReactNode = null;
  if (flow) {
    footer = (
      <FlowModal
        identity={identity}
        mode={flow.mode}
        token={flow.token}
        srcBalance={srcBalance(flow.mode, flow.token)}
        onClose={() => setFlow(null)}
        onDone={onDone}
      />
    );
  }

  return (
    <div className="grid" style={{ gap: 'var(--gap)' }}>
      <Panel>
        <FlowDiagram />
      </Panel>
      <div className="grid two-col" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <Panel
          flush
          title="Local wallet"
          eyebrow="// your tokens"
          actions={
            <button className="btn sm" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={13} />
              Token
            </button>
          }
        >
          {localTokens.map((token) => (
            <TokenRow
              key={token.ledgerCanisterId}
              token={token}
              balance={local.balances[token.symbol] ?? null}
              kind="local"
              onDeposit={() => setFlow({ mode: 'deposit', token })}
              onTransfer={() => setFlow({ mode: 'transfer', token })}
              onRemove={() => {
                removeToken(token.ledgerCanisterId);
                local.refresh();
              }}
            />
          ))}
        </Panel>

        <div className="grid" style={{ gap: 'var(--gap)' }}>
          <Panel
            flush
            title="Deposit balance"
            eyebrow="// available for top-ups"
            actions={<span className="dot ok" style={{ boxShadow: 'none' }} />}
          >
            {depositTokens.map((token) => (
              <TokenRow
                key={token.ledgerCanisterId}
                token={token}
                balance={deposit.balances[token.symbol] ?? null}
                kind="deposit"
                onWithdraw={() => setFlow({ mode: 'withdraw', token })}
              />
            ))}
          </Panel>
          {rebate !== null && rebate > 0n && (
            <div
              className="panel"
              style={{
                padding: '13px var(--pad)',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
                borderColor: 'var(--accent-line)',
                background: 'var(--accent-soft)',
              }}
            >
              <Icon name="bolt" size={16} style={{ color: 'var(--accent-ink)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>Fee rebate credit</div>
                <div className="faint" style={{ fontSize: 11 }}>
                  Earned from surplus LP rewards — offsets your next top-up fees.
                </div>
              </div>
              <div className="mono accent" style={{ fontSize: 15, fontWeight: 700 }}>
                <TC raw={rebate} /> TC
              </div>
            </div>
          )}
          <DepositHistoryPanel
            events={history.events}
            liveBalances={{
              TCYCLES: deposit.balances.TCYCLES ?? null,
              ICP: deposit.balances.ICP ?? null,
            }}
          />
        </div>
      </div>
      {footer}
      {addOpen && <AddTokenModal onClose={() => setAddOpen(false)} onAdd={addToken} />}
    </div>
  );
}
