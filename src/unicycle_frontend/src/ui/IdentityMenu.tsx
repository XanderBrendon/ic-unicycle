// Topbar identity chip + dropdown panel: full principal with copy button,
// acting-as switcher, and sign out. Replaces the old sidebar identity box.
import { useEffect, useRef, useState } from 'react';
import type { Principal } from '@icp-sdk/core/principal';
import { Icon } from './icons';
import { fmtPid } from './format';

export function IdentityMenu({
  principalText,
  actingAs,
  roots,
  onActingAsChange,
  onSignOut,
}: {
  principalText: string;
  actingAs: Principal | null;
  roots: Principal[];
  onActingAsChange: (p: Principal | null) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copy = () => {
    navigator.clipboard
      ?.writeText(principalText)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1100);
      })
      .catch(() => {});
  };

  // Old native <select> only fired onChange on a real change; keep that, since
  // onActingAsChange resets the selected canister.
  const pick = (p: Principal | null) => {
    setOpen(false);
    if ((actingAs?.toString() ?? '') !== (p?.toString() ?? '')) onActingAsChange(p);
  };

  const effective = actingAs ? actingAs.toString() : principalText;

  return (
    <div className="identity-menu" ref={ref}>
      <button className="chip" title={effective} onClick={() => setOpen((v) => !v)}>
        {actingAs && <span className="acting-mark">acting as</span>}
        {fmtPid(effective, 6, 4)}
        <Icon name="chevronD" size={12} style={{ color: 'var(--text-2)' }} />
      </button>

      {open && (
        <div className="identity-panel">
          <div className="identity-sec">
            <div className="eyebrow">Internet Identity</div>
            <div className="identity-full">
              <span className="mono">{principalText}</span>
              <button
                className="iconbtn"
                style={{ width: 22, height: 22, border: 'none', background: 'transparent' }}
                onClick={copy}
                title="Copy principal"
              >
                <Icon
                  name={copied ? 'check' : 'copy'}
                  size={12}
                  style={{ color: copied ? 'var(--accent-ink)' : 'var(--text-2)' }}
                />
              </button>
            </div>
          </div>

          {roots.length > 0 && (
            <div className="identity-sec">
              <div className="eyebrow" style={{ marginBottom: 4 }}>Acting as</div>
              <button className="identity-opt" onClick={() => pick(null)}>
                <span className={actingAs === null ? 'dot ok' : 'dot'} style={{ width: 6, height: 6, boxShadow: 'none' }} />
                Self
              </button>
              {roots.map((r) => {
                const on = actingAs?.toString() === r.toString();
                return (
                  <button key={r.toString()} className="identity-opt" title={r.toString()} onClick={() => pick(r)}>
                    <span className={on ? 'dot ok' : 'dot'} style={{ width: 6, height: 6, boxShadow: 'none' }} />
                    <span className="mono">{fmtPid(r.toString(), 6, 4)}</span>
                    <span className="faint" style={{ marginLeft: 'auto', fontSize: 10.5 }}>SNS root</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="identity-sec">
            <button className="identity-opt" onClick={onSignOut}>
              <Icon name="ext" size={13} style={{ color: 'var(--text-2)' }} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
