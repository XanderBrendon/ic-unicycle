import { useEffect, useMemo, useState } from 'react';
import type { Principal } from '@icp-sdk/core/principal';
import { useAuth } from './auth/useAuth';
import { useFleet } from './canisters/useFleet';
import { useIsAdmin } from './admin/useIsAdmin';
import { useMySnsAdminRoots } from './admin/useMySnsAdminRoots';
import { useMyTrackedSnsRoots } from './canisters/useMyTrackedSnsRoots';
import { useSnsInfos } from './sns/useSnsInfos';
import { Icon, type IconName } from './ui/icons';
import { useTheme } from './ui/theme';
import { fmtPid } from './ui/format';
import { IdentityMenu } from './ui/IdentityMenu';
import { SignIn } from './screens/SignIn';
import { Overview } from './screens/Overview';
import { CanisterDetail } from './screens/CanisterDetail';
import { Wallet } from './screens/Wallet';
import { Admin } from './screens/Admin';
import { SnsHome } from './screens/SnsHome';
import { TrackedSnsHome } from './screens/TrackedSnsHome';
import { BlackholedCanisters } from './screens/BlackholedCanisters';
import { AddCanisterModal } from './canisters/CanisterModals';
import { AddSnsModal } from './sns/AddSnsModal';
import { useHashRoute, type Page, type Route } from './router';

interface NavEntry {
  key: string;
  label: string;
  icon: IconName;
  route: Route;
  active: boolean;
  badge?: number;
}
interface NavGroup {
  sec: string | null;
  items: NavEntry[];
}

const TITLE: Record<Page, string> = { overview: 'Overview', wallet: 'Wallet', admin: 'Admin' };

export function App() {
  const { identity, loading, signIn, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const { route, navigate } = useHashRoute();
  const [addOpen, setAddOpen] = useState(false);
  const [addSnsOpen, setAddSnsOpen] = useState(false);

  const fleet = useFleet(identity);
  const { isAdmin, loading: adminLoading } = useIsAdmin(identity);
  const { roots: snsAdminRoots } = useMySnsAdminRoots(identity);
  const { roots: trackedSnsRoots, refresh: refreshTrackedSns } = useMyTrackedSnsRoots(identity);
  const allSnsRoots = useMemo(() => {
    const seen = new Set<string>();
    const out: Principal[] = [];
    for (const r of [...(snsAdminRoots ?? []), ...(trackedSnsRoots ?? [])]) {
      if (!seen.has(r.toText())) {
        seen.add(r.toText());
        out.push(r);
      }
    }
    return out;
  }, [snsAdminRoots, trackedSnsRoots]);
  const snsInfos = useSnsInfos(allSnsRoots);

  const selected = route.page === 'canister' ? route.id : null;

  // Keep the route valid: Admin is admin-only; an sns/snsCanister route must
  // still be one of the roots the identity administers. Replace (not push) so
  // back doesn't bounce, and wait for the roots to resolve (null while loading)
  // before kicking a deep-linked route out.
  useEffect(() => {
    if (route.page === 'admin' && !isAdmin && !adminLoading) navigate({ page: 'overview' }, { replace: true });
    if (
      (route.page === 'sns' || route.page === 'snsCanister') &&
      snsAdminRoots !== null &&
      !snsAdminRoots.some((r) => r.toText() === route.root.toText())
    ) {
      navigate({ page: 'overview' }, { replace: true });
    }
    if (
      route.page === 'trackedSns' &&
      trackedSnsRoots !== null &&
      !trackedSnsRoots.some((r) => r.toText() === route.root.toText())
    ) {
      navigate({ page: 'overview' }, { replace: true });
    }
    if (route.page === 'blackholed' && trackedSnsRoots !== null && trackedSnsRoots.length === 0) {
      navigate({ page: 'overview' }, { replace: true });
    }
  }, [route, isAdmin, adminLoading, snsAdminRoots, trackedSnsRoots, navigate]);

  if (!identity) {
    return <SignIn onSignIn={signIn} loading={loading} />;
  }

  const principalText = identity.getPrincipal().toString();

  const snsNavRoots = snsAdminRoots ?? [];
  const nav: NavGroup[] = [
    {
      sec: null,
      items: [
        {
          key: 'overview',
          label: 'Overview',
          icon: 'overview',
          route: { page: 'overview' },
          active: route.page === 'overview',
          badge: fleet.counts.atRisk > 0 ? fleet.counts.atRisk : undefined,
        },
        { key: 'wallet', label: 'Wallet', icon: 'wallet', route: { page: 'wallet' }, active: route.page === 'wallet' },
      ],
    },
    ...((trackedSnsRoots ?? []).length > 0
      ? [{
          sec: 'Tracked SNS',
          items: [
            ...(fleet.canisters?.some((c) => c.snsRoot === null)
              ? [{
                  key: 'blackholed',
                  label: 'Blackholed',
                  icon: 'canisters' as IconName,
                  route: { page: 'blackholed' } as Route,
                  active: route.page === 'blackholed',
                }]
              : []),
            ...(trackedSnsRoots ?? []).map((r): NavEntry => ({
              key: `tracked:${r.toText()}`,
              label: snsInfos.infos[r.toText()]?.name ?? fmtPid(r.toText(), 6, 4),
              icon: 'shield',
              route: { page: 'trackedSns', root: r },
              active: route.page === 'trackedSns' && route.root.toText() === r.toText(),
            })),
          ],
        }]
      : []),
    ...(snsNavRoots.length > 0
      ? [{
          sec: 'SNS',
          items: snsNavRoots.map((r): NavEntry => ({
            key: `sns:${r.toText()}`,
            label: snsInfos.infos[r.toText()]?.name ?? fmtPid(r.toText(), 6, 4),
            icon: 'shield',
            route: { page: 'sns', root: r, tab: 'overview' },
            active: (route.page === 'sns' || route.page === 'snsCanister') && route.root.toText() === r.toText(),
          })),
        }]
      : []),
    ...(isAdmin
      ? [{
          sec: 'Service',
          items: [{
            key: 'admin',
            label: 'Admin',
            icon: 'admin' as IconName,
            route: { page: 'admin', tab: 'overview' } as Route,
            active: route.page === 'admin',
          }],
        }]
      : []),
  ];

  const selectedRow = selected
    ? fleet.canisters?.find((c) => c.canisterId.toString() === selected.toString()) ?? null
    : null;
  const selectedLabel = selected ? selectedRow?.label ?? fmtPid(selected.toString()) : null;
  const crumbs: string[] = selected
    ? ['overview', selectedLabel as string]
    : route.page === 'sns'
      ? ['sns', snsInfos.infos[route.root.toText()]?.name ?? fmtPid(route.root.toText(), 6, 4)]
      : route.page === 'snsCanister'
        ? ['sns', fmtPid(route.id.toText(), 6, 4)]
        : route.page === 'trackedSns'
          ? ['tracked sns', snsInfos.infos[route.root.toText()]?.name ?? fmtPid(route.root.toText(), 6, 4)]
          : route.page === 'blackholed'
            ? ['blackholed']
            : [route.page];

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
              {group.items.map((it) => (
                <a key={it.key} className={`nav-item ${it.active ? 'active' : ''}`} onClick={() => navigate(it.route)}>
                  <Icon name={it.icon} size={16} className="ico" />
                  {it.label}
                  {it.badge !== undefined && <span className="nav-badge alert">{it.badge}</span>}
                </a>
              ))}
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
                    if (route.page === 'snsCanister' && i === 0) {
                      navigate({ page: 'sns', root: route.root, tab: 'overview' });
                    }
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
            {selected ? (
              <CanisterDetail
                identity={identity}
                canisterId={selected}
                actingAs={null}
                onBack={() => navigate({ page: 'overview' })}
                onChanged={fleet.refresh}
              />
            ) : route.page === 'overview' ? (
              <Overview
                identity={identity}
                fleet={fleet}
                onOpen={(id) => navigate({ page: 'canister', id })}
                onAdd={() => setAddOpen(true)}
                onAddSns={() => setAddSnsOpen(true)}
                snsNames={Object.fromEntries(
                  Object.entries(snsInfos.infos).map(([k, v]) => [k, v?.name ?? undefined]),
                )}
              />
            ) : route.page === 'wallet' ? (
              <Wallet identity={identity} />
            ) : route.page === 'admin' ? (
              <Admin
                identity={identity}
                tab={route.tab}
                onTabChange={(tab) => navigate({ page: 'admin', tab })}
              />
            ) : route.page === 'sns' ? (
              <SnsHome
                key={route.root.toText()}
                identity={identity}
                root={route.root}
                info={snsInfos.infos[route.root.toText()]}
                infoRefreshing={snsInfos.refreshing[route.root.toText()] ?? false}
                infoError={snsInfos.errors[route.root.toText()] ?? null}
                onRefreshInfo={() => snsInfos.refresh(route.root)}
                tab={route.tab}
                onTabChange={(tab) => navigate({ page: 'sns', root: route.root, tab })}
                onOpen={(id) => navigate({ page: 'snsCanister', root: route.root, id })}
              />
            ) : route.page === 'snsCanister' ? (
              <CanisterDetail
                identity={identity}
                canisterId={route.id}
                actingAs={route.root}
                onBack={() => navigate({ page: 'sns', root: route.root, tab: 'overview' })}
                onChanged={() => {}}
              />
            ) : route.page === 'trackedSns' ? (
              <TrackedSnsHome
                key={`tracked:${route.root.toText()}`}
                identity={identity}
                root={route.root}
                info={snsInfos.infos[route.root.toText()]}
                infoRefreshing={snsInfos.refreshing[route.root.toText()] ?? false}
                infoError={snsInfos.errors[route.root.toText()] ?? null}
                onRefreshInfo={() => snsInfos.refresh(route.root)}
                onOpen={(id) => navigate({ page: 'canister', id })}
                allCanisters={fleet.canisters ?? []}
                onChanged={fleet.refresh}
                onRemoved={() => {
                  refreshTrackedSns();
                  fleet.refresh();
                  navigate({ page: 'overview' });
                }}
              />
            ) : route.page === 'blackholed' ? (
              <BlackholedCanisters
                identity={identity}
                onOpen={(id) => navigate({ page: 'canister', id })}
                onChanged={fleet.refresh}
              />
            ) : null}
          </div>
        </div>
      </div>

      {addOpen && (
        <AddCanisterModal
          identity={identity}
          actingAs={null}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            fleet.refresh();
            setAddOpen(false);
          }}
        />
      )}

      {addSnsOpen && identity && (
        <AddSnsModal
          identity={identity}
          trackedRootIds={(trackedSnsRoots ?? []).map((r) => r.toText())}
          onClose={() => setAddSnsOpen(false)}
          onAdded={() => refreshTrackedSns()}
        />
      )}
    </div>
  );
}
