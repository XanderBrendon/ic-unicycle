// Shared UI primitives. Port of design_files/ui.jsx to typed React.
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { fmtPid, fmtTC, fmtTCFull, statusClass, statusColor, STATUS_LABEL, type Status, type UserError } from './format';

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  flush,
  className = '',
  style,
  bodyStyle,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  className?: string;
  style?: CSSProperties;
  bodyStyle?: CSSProperties;
}) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || actions || eyebrow) && (
        <header className="panel-head">
          <div>
            {eyebrow && <div className="eyebrow" style={{ marginBottom: 2 }}>{eyebrow}</div>}
            {title && <div className="h2">{title}</div>}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>{actions}</div>
        </header>
      )}
      <div className={`panel-body ${flush ? 'flush' : ''}`} style={bodyStyle}>
        {children}
      </div>
    </section>
  );
}

export function Stat({
  label,
  value,
  unit,
  sub,
  icon,
  size = 26,
  accent = false,
  status,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  size?: number;
  accent?: boolean;
  status?: Status;
}) {
  return (
    <div className="stat">
      <div className="stat-label eyebrow">
        {icon}
        {label}
      </div>
      <div
        className="stat-value"
        style={{ fontSize: size, color: accent ? 'var(--accent-ink)' : status ? statusColor(status) : 'var(--text)' }}
      >
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="faint" style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono', monospace" }}>{sub}</div>}
    </div>
  );
}

// A TCYCLES amount: the rounded `fmtTC` display, with its fully-expanded
// 12-decimal value revealed on hover (native title tooltip). Renders only the
// number — call sites keep their own " TC" suffix and styling.
export function TC({ raw, dp = 2 }: { raw: bigint | number | null | undefined; dp?: number }) {
  if (raw === null || raw === undefined) return <>{fmtTC(raw, dp)}</>;
  return <span title={`${fmtTCFull(raw)} TC`}>{fmtTC(raw, dp)}</span>;
}

export function StatusBadge({ status, dot = true }: { status: Status; dot?: boolean }) {
  const cls = statusClass(status);
  return (
    <span className={`badge ${cls}`}>
      {dot && (
        <span
          className={`dot ${status === 'suspended' || status === 'unknown' ? '' : cls}`}
          style={{ width: 6, height: 6, boxShadow: 'none' }}
        />
      )}
      {STATUS_LABEL[status] || status}
    </span>
  );
}

export function IdTag({
  id,
  name,
  copyable = true,
}: {
  id: string;
  name?: ReactNode;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard
      ?.writeText(id)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      })
      .catch(() => {});
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
      {name && <span style={{ fontWeight: 600, fontSize: 13 }}>{name}</span>}
      <span className="mono" style={{ fontSize: 12, color: name ? 'var(--text-2)' : 'var(--text)' }} title={id}>
        {fmtPid(id)}
      </span>
      {copyable && (
        <button
          className="iconbtn"
          style={{ width: 22, height: 22, border: 'none', background: 'transparent' }}
          onClick={copy}
          title="Copy id"
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} style={{ color: copied ? 'var(--accent-ink)' : 'var(--text-2)' }} />
        </button>
      )}
    </span>
  );
}

// The fully-surfaced, more-technical tail of an error: visibly separated into
// its own block and de-emphasized (muted small mono), so it reads as secondary
// to the friendly message above it.
export function ErrorDetail({ detail }: { detail: string }) {
  return (
    <div
      className="panel mono"
      style={{
        background: 'var(--bg-2)',
        color: 'var(--text-2)',
        padding: '8px 10px',
        fontSize: 11,
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
        maxHeight: '40vh',
        overflowY: 'auto',
      }}
    >
      {detail}
    </div>
  );
}

// Friendly message stacked over its optional de-emphasized technical detail.
// Drop-in for inline error slots (Field `error`, toasts, status hints).
export function ErrorText({ error }: { error: UserError }) {
  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <span>{error.message}</span>
      {error.detail && <ErrorDetail detail={error.detail} />}
    </div>
  );
}

// Inline error message for modal/form bodies, with an optional de-emphasized
// technical detail and an optional copyable shell command that fixes the
// problem.
export function ErrorHint({ message, detail, command }: { message: ReactNode; detail?: string; command?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (!command) return;
    navigator.clipboard
      ?.writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      })
      .catch(() => {});
  };
  return (
    <div className="hint" style={{ color: 'var(--crit)', display: 'grid', gap: 8 }}>
      <span>{message}</span>
      {detail && <ErrorDetail detail={detail} />}
      {command && (
        <div
          className="panel mono"
          style={{
            background: 'var(--bg-2)',
            color: 'var(--text-1)',
            padding: '8px 10px',
            fontSize: 11.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            overflowWrap: 'anywhere',
          }}
        >
          <span style={{ flex: 1, userSelect: 'all' }}>{command}</span>
          <button
            className="iconbtn"
            style={{ width: 22, height: 22, border: 'none', background: 'transparent', flex: 'none' }}
            onClick={copy}
            title="Copy command"
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} style={{ color: copied ? 'var(--accent-ink)' : 'var(--text-2)' }} />
          </button>
        </div>
      )}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  error,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  error?: ReactNode;
}) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {error ? <div className="hint" style={{ color: 'var(--crit)' }}>{error}</div> : hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="panel-head">
          <div>
            {eyebrow && <div className="eyebrow" style={{ marginBottom: 2 }}>{eyebrow}</div>}
            <div className="h2">{title}</div>
          </div>
          <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </header>
        <div className="panel-body">{children}</div>
        {footer && (
          <div
            className="panel-head"
            style={{ borderBottom: 'none', borderTop: '1px solid var(--border)', justifyContent: 'flex-end' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export interface TabSpec {
  id: string;
  label: ReactNode;
  count?: number;
}

export function Tabs({ tabs, active, onChange }: { tabs: TabSpec[]; active: string; onChange: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)' }}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            background: 'none',
            border: 'none',
            padding: '10px 14px',
            fontSize: 13,
            fontWeight: 500,
            color: active === t.id ? 'var(--text)' : 'var(--text-1)',
            position: 'relative',
            marginBottom: -1,
            borderBottom: active === t.id ? '2px solid var(--accent)' : '2px solid transparent',
          }}
        >
          {t.label}
          {t.count !== undefined && <span className="mono faint" style={{ marginLeft: 6, fontSize: 11 }}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: IconName;
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={13} className="ico" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon = 'canisters', title, children }: { icon?: IconName; title: ReactNode; children?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '44px 20px', color: 'var(--text-2)' }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 10,
          border: '1px solid var(--border)',
          display: 'grid',
          placeItems: 'center',
          margin: '0 auto 12px',
          background: 'var(--panel-2)',
        }}
      >
        <Icon name={icon} size={20} />
      </div>
      <div style={{ color: 'var(--text-1)', fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, maxWidth: 320, margin: '0 auto' }}>{children}</div>
    </div>
  );
}

export function KV({ k, children, mono = true }: { k: ReactNode; children?: ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, padding: '7px 0' }}>
      <span className="faint" style={{ fontSize: 12 }}>{k}</span>
      <span className={mono ? 'mono' : ''} style={{ fontSize: 12.5, textAlign: 'right' }}>{children}</span>
    </div>
  );
}
