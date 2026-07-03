// Topbar identity chip + dropdown panel: full principal with copy button,
// and sign out. Replaces the old sidebar identity box.
import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { fmtPid } from './format';

export function IdentityMenu({
  principalText,
  onSignOut,
}: {
  principalText: string;
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

  return (
    <div className="identity-menu" ref={ref}>
      <button className="chip" title={principalText} onClick={() => setOpen((v) => !v)}>
        {fmtPid(principalText, 6, 4)}
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
