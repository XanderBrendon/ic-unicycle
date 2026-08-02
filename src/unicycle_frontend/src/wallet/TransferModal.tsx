// TransferModal — the shared deposit / withdraw / send dialog. Opened from the
// Wallet's token rows and from the Deposit balance KPI cell on the fleet and
// SNS pages: the caller picks the starting tab and token, the user is free to
// change both without reopening.
//
// It reads its own balances rather than taking them as props. Both are needed
// at once — the source flips between the local wallet and the deposit balance
// as the user moves between tabs, and every derived figure (Max, the fee line,
// After) flips with it.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Identity } from '@icp-sdk/core/agent';
import type { Principal } from '@icp-sdk/core/principal';
import { Field, Modal, KV, ErrorText, TC, Tabs } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fmtPid } from '../ui/format';
import { useToast } from '../ui/toast';
import { useDeposit } from './useDeposit';
import { useWithdraw } from './useWithdraw';
import { useTransfer } from './useTransfer';
import { useLocalWalletBalances } from './useLocalWalletBalances';
import { useDepositBalances } from './useDepositBalances';
import { depositAccountFor } from './depositAccount';
import { BUILT_IN_TOKENS, type TokenInfo } from './tokens';
import { parseDecimalAmount, formatTokenAmount } from './format';
import { parseDestination } from './parseDestination';

export type TransferMode = 'deposit' | 'withdraw' | 'send';

export type TransferTarget =
  /** The signed-in user's own deposit subaccount — deposit and withdraw. */
  | { kind: 'self' }
  /**
   * An SNS root's deposit subaccount: DAO-controlled, so deposit only. `name`
   * is the governance metadata name, which is absent until that fetch lands and
   * null for an SNS that never set one — the root id stands in either way.
   */
  | { kind: 'sns'; root: Principal; name?: string | null };

export interface TransferModalProps {
  identity: Identity;
  target: TransferTarget;
  initialMode: TransferMode;
  initialToken: TokenInfo;
  /** Extra tokens offered in send mode. Only the Wallet has any. */
  customTokens?: TokenInfo[];
  onClose: () => void;
  onDone: () => void;
}

function amountLabel(raw: bigint, token: TokenInfo): ReactNode {
  return token.symbol === 'TCYCLES' ? (
    <><TC raw={raw} dp={4} /> TC</>
  ) : (
    `${formatTokenAmount(raw, token.decimals)} ${token.symbol}`
  );
}

export function TransferModal({
  identity,
  target,
  initialMode,
  initialToken,
  customTokens = [],
  onClose,
  onDone,
}: TransferModalProps) {
  const toast = useToast();
  const deposit = useDeposit(identity);
  const withdraw = useWithdraw(identity);
  const transfer = useTransfer(identity);
  const local = useLocalWalletBalances(identity, customTokens);
  const held = useDepositBalances(identity, target.kind === 'sns' ? target.root : undefined);

  const [mode, setMode] = useState<TransferMode>(initialMode);
  const [token, setToken] = useState<TokenInfo>(initialToken);
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [submitted, setSubmitted] = useState<bigint | null>(null);
  const [destError, setDestError] = useState<string | null>(null);
  // Confirming is a second, separate press: the first one only reveals what the
  // deposit means.
  const [confirming, setConfirming] = useState(false);

  const sns = target.kind === 'sns' ? target : null;
  const snsName = sns ? sns.name ?? fmtPid(sns.root.toText(), 6, 4) : '';

  const status = sns
    ? transfer.status
    : mode === 'deposit'
      ? deposit.status
      : mode === 'withdraw'
        ? withdraw.status
        : transfer.status;
  const busy = status.kind !== 'idle' && status.kind !== 'success' && status.kind !== 'error';

  // Send is the only mode custom tokens can reach: they carry no `backendToken`,
  // so there is no deposit or withdraw path for them.
  const tokenOptions: readonly TokenInfo[] =
    mode === 'send' ? [...BUILT_IN_TOKENS, ...customTokens] : BUILT_IN_TOKENS;

  // A deposit to your own balance is approve + transfer_from — two fee-charging
  // ledger operations. An SNS deposit is a single icrc1_transfer.
  const totalFee = mode === 'deposit' && !sns ? token.fee * 2n : token.fee;
  const src = (mode === 'withdraw' ? held.balances[token.symbol] : local.balances[token.symbol]) ?? 0n;
  const maxSpendable = src > totalFee ? src - totalFee : 0n;
  const raw = parseDecimalAmount(amount, token.decimals);
  const amtValid = raw !== null && raw > 0n && raw <= maxSpendable;
  const destValid = mode !== 'send' || (dest.trim().length > 0 && parseDestination(dest).ok);
  const valid = amtValid && destValid;

  // A failure carries the tab and token it happened on in its wording, so it
  // must not outlive a switch to another one.
  const clearStatus = () => {
    deposit.reset();
    withdraw.reset();
    transfer.reset();
    setDestError(null);
  };
  const pickMode = (next: TransferMode) => {
    clearStatus();
    setMode(next);
  };
  const pickToken = (next: TokenInfo) => {
    clearStatus();
    setToken(next);
  };

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

  const blurb = sns
    ? `Move funds into ${snsName}'s Unicycle deposit balance so the service can fund its canisters.`
    : mode === 'deposit'
      ? 'Move funds into your Unicycle deposit balance so the service can fund top-ups.'
      : mode === 'withdraw'
        ? 'Pull funds from your deposit balance back to your local wallet.'
        : 'Send to any principal or ICRC-1 account.';

  const setMax = () => setAmount(formatTokenAmount(maxSpendable, token.decimals));

  const confirm = () => {
    if (!valid || raw === null) return;
    // First press on an SNS deposit only opens the confirm step.
    if (sns && !confirming) {
      setConfirming(true);
      return;
    }
    setSubmitted(raw);
    if (sns) {
      // The backend's `deposit` always credits the *caller's* subaccount, so an
      // SNS deposit is a direct transfer to the account the SNS's own treasury
      // proposal funds.
      transfer.transfer(token, depositAccountFor(sns.root), raw);
    } else if (mode === 'deposit') {
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

  if (sns && confirming && raw !== null) {
    return (
      <Modal
        title={`Deposit to ${snsName}`}
        eyebrow="// confirm — this cannot be undone"
        onClose={onClose}
        footer={
          <>
            <button className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button className="btn accent" disabled={busy} onClick={confirm}>
              {busy ? 'Working…' : 'Yes, deposit'}
            </button>
          </>
        }
      >
        <div className="grid" style={{ gap: 16 }}>
          <div className="hint" style={{ color: 'var(--crit)', lineHeight: 1.55 }}>
            You are about to move {amountLabel(raw, token)} into an account controlled by{' '}
            {snsName}. These funds become {snsName}'s — they can only be moved by its
            governance, and neither you nor Unicycle can return them to you.
          </div>
          <div className="panel" style={{ background: 'var(--bg-2)', padding: '10px 12px' }}>
            <KV k="Amount">{amountLabel(raw, token)}</KV>
            <KV k="Network fee">{amountLabel(totalFee, token)}</KV>
            <KV k="Recipient">{snsName}</KV>
            <KV k="SNS root">{fmtPid(sns.root.toText(), 6, 4)}</KV>
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

  return (
    <Modal
      title={sns ? `Deposit to ${snsName}` : mode === 'send' ? 'Send tokens' : 'Deposit balance'}
      eyebrow={
        sns ? '// SNS-controlled account' : mode === 'send' ? `// ${token.symbol}` : '// deposit or withdraw'
      }
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
        {/* No tab row for an SNS: there is nothing to switch to, and the title
            already says what this does. */}
        {mode !== 'send' && !sns && (
          <Tabs
            tabs={[
              { id: 'deposit', label: 'Deposit' },
              { id: 'withdraw', label: 'Withdraw' },
            ]}
            active={mode}
            onChange={(id) => pickMode(id as TransferMode)}
          />
        )}
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.55 }}>{blurb}</p>
        {sns && (
          <div className="hint" style={{ color: 'var(--crit)', lineHeight: 1.55 }}>
            This deposit goes to an account controlled by {snsName}. You will not be able to
            withdraw it — once deposited, only {snsName} can move these funds.
          </div>
        )}
        {mode === 'send' && (
          <Field label="Destination" error={destError ?? undefined}>
            <input
              className="input mono"
              placeholder="principal"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
            />
          </Field>
        )}
        <Field label="Token">
          <select
            className="input mono"
            value={token.ledgerCanisterId}
            onChange={(e) => {
              const next = tokenOptions.find((t) => t.ledgerCanisterId === e.target.value);
              if (next) pickToken(next);
            }}
          >
            {tokenOptions.map((t) => (
              <option key={t.ledgerCanisterId} value={t.ledgerCanisterId}>
                {t.symbol === 'TCYCLES' ? 'TC' : t.symbol} — {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Amount"
          hint={
            mode === 'deposit' && !sns
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
          <KV k={mode === 'withdraw' ? 'Deposit balance' : 'Wallet balance'}>{amountLabel(src, token)}</KV>
          <KV k={mode === 'deposit' && !sns ? 'Network fee (2×)' : 'Network fee'}>{amountLabel(totalFee, token)}</KV>
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
