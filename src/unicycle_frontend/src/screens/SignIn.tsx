// Centered sign-in card on a radial-masked grid. Port of the prototype SignIn,
// wired to the real Internet Identity flow (useAuth().signIn).
import { Icon } from '../ui/icons';

export function SignIn({ onSignIn, loading }: { onSignIn: () => void; loading: boolean }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: 0.5,
          background:
            'linear-gradient(var(--grid) 1px, transparent 1px) 0 0/100% 48px, linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0/48px 100%',
          maskImage: 'radial-gradient(circle at 50% 45%, black, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(circle at 50% 45%, black, transparent 70%)',
        }}
      />
      <div className="fade-up" style={{ position: 'relative', width: 380, textAlign: 'center' }}>
        <div
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: 56,
            height: 56,
            borderRadius: 14,
            border: '1px solid var(--border-2)',
            background: 'var(--panel)',
            marginBottom: 20,
            color: 'var(--accent-ink)',
          }}
        >
          <Icon name="wheel" size={30} />
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>Unicycle</h1>
        <p className="eyebrow" style={{ marginTop: 6 }}>
          Autonomous cycle top-ups for the IC
        </p>
        <p className="faint" style={{ fontSize: 13, margin: '18px 0 24px', lineHeight: 1.6 }}>
          Keep your canisters running without lifting a finger. Set a floor, fund a deposit, and Unicycle refills them —
          converting ICP to cycles automatically when needed.
        </p>
        <button
          className="btn accent"
          style={{ width: '100%', height: 42, justifyContent: 'center', fontSize: 14 }}
          onClick={onSignIn}
          disabled={loading}
        >
          <Icon name="shield" size={16} />
          Sign in with Internet Identity
        </button>
        <div className="mono faint" style={{ fontSize: 10.5, marginTop: 16, letterSpacing: '0.08em' }}>
          <span className="prompt">secured by Internet Identity</span>
          <span className="cursor" style={{ marginLeft: 4 }} />
        </div>
      </div>
    </div>
  );
}
