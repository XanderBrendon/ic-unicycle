import { useEffect, useState } from 'react';
import type { Principal } from '@icp-sdk/core/principal';
import { useAuth } from './auth/useAuth';
import { useFleet } from './canisters/useFleet';
import { useIsAdmin } from './admin/useIsAdmin';
import { useMySnsAdminRoots } from './admin/useMySnsAdminRoots';
import { Icon, type IconName } from './ui/icons';
import { useTheme } from './ui/theme';
import { fmtPid } from './ui/format';
import { IdentityMenu } from './ui/IdentityMenu';
import { SignIn } from './screens/SignIn';
import { Overview } from './screens/Overview';
import { CanisterDetail } from './screens/CanisterDetail';
import { Wallet } from './screens/Wallet';
import { Admin } from './screens/Admin';
import { AddCanisterModal } from './canisters/CanisterModals';
import { useHashRoute, type Page } from './router';

interface NavItem {
  id: Page;
  label: string;
  icon: IconName;
}
interface NavGroup {
  sec: string | null;
  items: NavItem[];
}

const TITLE: Record<Page, string> = { overview: 'Overview', wallet: 'Wallet', admin: 'Admin' };

export function App() {
  const { identity, loading, signIn, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const [actingAs, setActingAs] = useState<Principal | null>(null);
  const { route, navigate } = useHashRoute();
  const [addOpen, setAddOpen] = useState(false);

  const fleet = useFleet(identity, actingAs);
  const { isAdmin, loading: adminLoading } = useIsAdmin(identity);
  const { roots: snsAdminRoots } = useMySnsAdminRoots(identity);

  const selected = route.page === 'canister' ? route.id : null;

  // Drop a stale "Acting as" selection when the signed-in identity no longer
  // administers that root (sign-out clears roots; a new identity has its own).
  useEffect(() => {
    if (actingAs && !(snsAdminRoots ?? []).some((r) => r.toString() === actingAs.toString())) {
      setActingAs(null);
    }
  }, [snsAdminRoots, actingAs]);

  // Keep the route valid: Admin is admin-only; the personal Wallet is hidden
  // while acting as an SNS root. Replace (not push) so back doesn't bounce, and
  // wait for the admin check to resolve before kicking a deep-linked admin out.
  useEffect(() => {
    if (route.page === 'admin' && !isAdmin && !adminLoading) navigate({ page: 'overview' }, { replace: true });
    if (route.page === 'wallet' && actingAs) navigate({ page: 'overview' }, { replace: true });
  }, [route, isAdmin, adminLoading, actingAs, navigate]);

  if (!identity) {
    return <SignIn onSignIn={signIn} loading={loading} />;
  }

  const principalText = identity.getPrincipal().toString();

  const go = (p: Page) => navigate(p === 'admin' ? { page: 'admin', tab: 'overview' } : { page: p });

  const nav: NavGroup[] = [
    {
      sec: null,
      items: [
        { id: 'overview', label: 'Overview', icon: 'overview' },
        ...(actingAs ? [] : [{ id: 'wallet' as Page, label: 'Wallet', icon: 'wallet' as IconName }]),
      ],
    },
    ...(isAdmin
      ? [{ sec: 'Service', items: [{ id: 'admin' as Page, label: 'Admin', icon: 'admin' as IconName }] }]
      : []),
  ];

  const selectedRow = selected
    ? fleet.canisters?.find((c) => c.canisterId.toString() === selected.toString()) ?? null
    : null;
  const selectedLabel = selected ? selectedRow?.label ?? fmtPid(selected.toString()) : null;
  const crumbs: string[] = selected ? ['overview', selectedLabel as string] : [route.page];

  return (
    <div className="app">
      {/* sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark accent" style={{ color: 'var(--accent-ink)' }}>
            <Icon name="wheel" size={24} />
          </span>
          <div>
            <div className="brand-name">Unicycle</div>
            <div className="brand-sub">cycle autopilot</div>
          </div>
        </div>
        <nav className="nav">
          {nav.map((group, gi) => (
            <div key={gi} style={{ display: 'contents' }}>
              {group.sec && <div className="nav-sec">{group.sec}</div>}
              {group.items.map((it) => {
                const active = route.page === it.id && !selected;
                return (
                  <a key={it.id} className={`nav-item ${active ? 'active' : ''}`} onClick={() => go(it.id)}>
                    <Icon name={it.icon} size={16} className="ico" />
                    {it.label}
                    {it.id === 'overview' && fleet.counts.atRisk > 0 && (
                      <span className="nav-badge alert">{fleet.counts.atRisk}</span>
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* main */}
      <div className="main">
        <header className="topbar">
          <div className="crumbs">
            <Icon name="wheel" size={14} style={{ color: 'var(--text-2)' }} />
            {crumbs.map((c, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <span className="seg">/</span>
                <span
                  className={i === crumbs.length - 1 ? 'cur' : 'seg'}
                  style={{ cursor: i < crumbs.length - 1 ? 'pointer' : 'default' }}
                  onClick={() => {
                    if (selected && i === 0) navigate({ page: 'overview' });
                  }}
                >
                  {TITLE[c as Page] || c}
                </span>
              </div>
            ))}
          </div>
          <div className="topbar-spacer" />

          <IdentityMenu
            principalText={principalText}
            actingAs={actingAs}
            roots={snsAdminRoots ?? []}
            onActingAsChange={(p) => {
              setActingAs(p);
              if (route.page === 'canister') navigate({ page: 'overview' });
            }}
            onSignOut={() => {
              signOut();
              navigate({ page: 'overview' });
            }}
          />

          <button className="iconbtn" title="Toggle theme" onClick={toggle}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
        </header>

        <div className="content">
          <div className="page">
            {actingAs && !selected && (
              <div
                className="panel"
                style={{
                  marginBottom: 'var(--gap)',
                  padding: '10px var(--pad)',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  borderColor: 'var(--accent-line)',
                  background: 'var(--accent-soft)',
                }}
              >
                <Icon name="shield" size={14} style={{ color: 'var(--accent-ink)' }} />
                <span style={{ fontSize: 12.5 }}>
                  Acting as SNS root <span className="mono">{fmtPid(actingAs.toString())}</span>. Managing the SNS fleet —
                  your personal wallet is hidden.
                </span>
                <button className="btn sm ghost" style={{ marginLeft: 'auto' }} onClick={() => setActingAs(null)}>
                  Exit
                </button>
              </div>
            )}

            {selected ? (
              <CanisterDetail
                identity={identity}
                canisterId={selected}
                actingAs={actingAs}
                onBack={() => navigate({ page: 'overview' })}
                onChanged={fleet.refresh}
              />
            ) : route.page === 'overview' ? (
              <Overview
                identity={identity}
                actingAs={actingAs}
                fleet={fleet}
                onOpen={(id) => navigate({ page: 'canister', id })}
                onAdd={() => setAddOpen(true)}
              />
            ) : route.page === 'wallet' ? (
              <Wallet identity={identity} />
            ) : route.page === 'admin' ? (
              <Admin
                identity={identity}
                tab={route.tab}
                onTabChange={(tab) => navigate({ page: 'admin', tab })}
              />
            ) : null}
          </div>
        </div>
      </div>

      {addOpen && (
        <AddCanisterModal
          identity={identity}
          actingAs={actingAs}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            fleet.refresh();
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
