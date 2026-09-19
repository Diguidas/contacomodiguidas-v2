import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Menu, RefreshCw, Home, Users, LineChart, Clock, FolderClock, Link2, Briefcase, ShieldCheck, LogOut } from 'lucide-react';
import { WorkItem } from '../models/workItem';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { AppSettings } from '../services/settingsService';
import { SupabaseConfigService } from '../services/supabaseConfigService';
import type { AppUser } from '../services/authService';
import { Sprint, SprintService } from '../services/sprintService';
import { BrandColors } from '../theme';
import abapinhoLogo from '../assets/abapinho.png';
import poletechBadge from '../assets/poletech.png';
import { DashboardScreen } from './DashboardScreen';
import { TeamDashboardScreen } from './TeamDashboardScreen';
import { HistoryScreen } from './HistoryScreen';
import { SlaScreen } from './SlaScreen';
import { GroupingScreen } from './GroupingScreen';
import { SettingsScreen } from './SettingsScreen';
import { ProjectsScreen } from './ProjectsScreen';
import { AdminScreen } from './AdminScreen';

type Destination = 'dashboard' | 'team' | 'history' | 'sla' | 'grouping' | 'connection' | 'projects' | 'admin';

const configService = new SupabaseConfigService();
const sprintService = new SprintService();

/** App-wide shell: owns the settings/data state and renders a persistent
 * sidebar. `appUser` (resolved by AuthGate before this ever mounts) decides
 * what's visible: a "responsavel" login only ever sees Dashboard, locked to
 * their own name — every other nav item (Visão do time, Projetos, Cycle
 * Time, SLA, Agrupamento, Conexão) is admin-only, plus the "Administração"
 * screen itself. */
export function AppShell({ appUser, onSignOut }: { appUser: AppUser; onSignOut: () => void }) {
  const isAdmin = appUser.role === 'admin';
  const [settings, setSettings] = useState<AppSettings>(new AppSettings());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [destination, setDestination] = useState<Destination>('dashboard');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const sprints = useRef<Sprint[]>(sprintService.recentSprints());
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(
    sprintService.sprintFor(sprintService.sprintNumberContaining(new Date())),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  );

  // Histórico owns a much heavier fetch (many sprints in one broad query),
  // so it's cached here at the shell level — switching tabs away and back
  // must never silently re-trigger it. Only a real reason (first visit,
  // range changed, explicit "Atualizar") should.
  const [historyItems, setHistoryItems] = useState<WorkItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySprintCount, setHistorySprintCount] = useState(6);

  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 900);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    (async () => {
      const loaded = await configService.load();
      setSettings(loaded);
      setSettingsLoaded(true);
      if (loaded.isConfigured) {
        // kick off first refresh
        refresh(loaded, selectedSprint);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(useSettings?: AppSettings, useSprint?: Sprint | null) {
    const s = useSettings ?? settings;
    const sprint = useSprint === undefined ? selectedSprint : useSprint;
    if (!s.isConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const service = new AzureDevOpsService(s);
      const fetched = await service.fetchMyWorkItems({
        changedSince: sprint?.start,
        changedUntil: sprint?.end,
      });
      setItems(fetched);
      setLastUpdated(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  /** The sprint dropdown changed — that decides what gets fetched now, so a
   * new selection means a new (fast, scoped) fetch. */
  function onSprintChanged(sprint: Sprint | null) {
    setSelectedSprint(sprint);
    refresh(settings, sprint);
  }

  function historySprints(count: number): Sprint[] {
    const current = sprintService.sprintNumberContaining(new Date());
    const result: Sprint[] = [];
    for (let n = current - count + 1; n <= current; n++) result.push(sprintService.sprintFor(n));
    return result;
  }

  async function loadHistory(force = false, count?: number) {
    if (!settings.isConfigured) return;
    if (historyLoading) return;
    // Already loaded for this exact range and not a forced refresh — the
    // whole point of caching it here, so re-entering the tab is instant.
    if (!force && historyItems != null && count === undefined) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const earliestStart = historySprints(count ?? historySprintCount)[0].start;
      const service = new AzureDevOpsService(settings);
      const fetched = await service.fetchMyWorkItems({ changedSince: earliestStart });
      setHistoryItems(fetched);
    } catch (e) {
      setHistoryError(String(e));
    } finally {
      setHistoryLoading(false);
    }
  }

  function onHistorySprintCountChanged(count: number) {
    setHistorySprintCount(count);
    setHistoryItems(null); // range grew/shrank — the cached fetch no longer covers it
    loadHistory(false, count);
  }

  async function saveSettings(next: AppSettings) {
    await configService.save(next);
    setSettings(next);
    refresh(next, selectedSprint);
  }

  /** Switches the visible tab and, if that tab needs its own data (only
   * Histórico does) and doesn't have it cached yet, kicks off that load —
   * but only then, never on every rebuild. */
  function selectDestination(d: Destination) {
    // Defense in depth — the Sidebar only ever renders "Dashboard" for a
    // non-admin, but this keeps a stray/forged call from switching tabs too.
    if (!isAdmin && d !== 'dashboard') return;
    setDestination(d);
    if ((d === 'history' || d === 'sla') && historyItems == null) {
      loadHistory();
    }
  }

  if (!settingsLoaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span>Carregando...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: BrandColors.background }}>
      <header
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          height: 56,
          padding: '0 20px',
          backgroundColor: BrandColors.cardBg,
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
          position: 'relative',
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {isNarrow && (
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="menu"
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
            >
              <Menu size={22} strokeWidth={2} />
            </button>
          )}
        </div>
        <img src={abapinhoLogo} alt="Conta com o Diguidas" style={{ height: 32, objectFit: 'contain' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => refresh()}
            disabled={loading}
            title="Atualizar itens em aberto + sprint selecionada"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${BrandColors.border}`,
              backgroundColor: '#fff',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontSize: 13,
              fontWeight: 600,
              color: '#334155',
            }}
          >
            <RefreshCw size={16} strokeWidth={2} />
            {!isNarrow && 'Atualizar'}
          </button>
        </div>
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {!isNarrow && (
          <>
            <Sidebar settings={settings} appUser={appUser} destination={destination} onSelect={selectDestination} onSignOut={onSignOut} />
          </>
        )}
        {isNarrow && drawerOpen && (
          <div
            style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 10 }}
            onClick={() => setDrawerOpen(false)}
          >
            <div style={{ height: '100%' }} onClick={(e) => e.stopPropagation()}>
              <Sidebar
                settings={settings}
                appUser={appUser}
                destination={destination}
                onSelect={(d) => {
                  selectDestination(d);
                  setDrawerOpen(false);
                }}
                onSignOut={onSignOut}
              />
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          {destination === 'dashboard' && (
            <DashboardScreen
              settings={settings}
              items={items}
              loading={loading}
              error={error}
              lastUpdated={lastUpdated}
              selectedSprint={selectedSprint}
              sprints={sprints.current}
              onRefresh={() => refresh()}
              onSprintChanged={onSprintChanged}
              lockedResponsible={isAdmin ? undefined : (appUser.responsavelName ?? undefined)}
            />
          )}
          {destination === 'admin' && isAdmin && <AdminScreen />}
          {destination === 'projects' && (
            <ProjectsScreen
              settings={settings}
              items={items}
              loading={loading}
              error={error}
              selectedSprint={selectedSprint}
              onRefresh={() => refresh()}
            />
          )}
          {destination === 'team' && (
            <TeamDashboardScreen
              settings={settings}
              items={items}
              loading={loading}
              error={error}
              selectedSprint={selectedSprint}
              sprints={sprints.current}
              onSprintChanged={onSprintChanged}
            />
          )}
          {destination === 'history' && (
            <HistoryScreen
              settings={settings}
              items={historyItems}
              loading={historyLoading}
              error={historyError}
              sprintCount={historySprintCount}
              onSprintCountChanged={onHistorySprintCountChanged}
              onRefresh={() => loadHistory(true)}
            />
          )}
          {destination === 'sla' && (
            <SlaScreen
              settings={settings}
              items={historyItems}
              loading={historyLoading}
              error={historyError}
              onRefresh={() => loadHistory(true)}
            />
          )}
          {destination === 'grouping' && (
            <GroupingScreen settings={settings} items={items} onSaved={saveSettings} />
          )}
          {destination === 'connection' && (
            <SettingsScreen initialSettings={settings} onSaved={saveSettings} />
          )}
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 1).toUpperCase();
  return (parts[0].substring(0, 1) + parts[parts.length - 1].substring(0, 1)).toUpperCase();
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1][0]}. ${parts[parts.length - 1]}`;
}

function Sidebar({
  settings,
  appUser,
  destination,
  onSelect,
  onSignOut,
}: {
  settings: AppSettings;
  appUser: AppUser;
  destination: Destination;
  onSelect: (d: Destination) => void;
  onSignOut: () => void;
}) {
  const isAdmin = appUser.role === 'admin';
  // A responsável logged in sees who they're browsing as; an admin still
  // reads by the shared "tag owner" name (settings.myDisplayName) here,
  // same as before — that name isn't tied to whoever's logged in.
  const displayName = appUser.responsavelName ?? settings.myDisplayName;
  return (
    <div
      style={{
        width: 240,
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        boxShadow: '1px 0 2px rgba(15, 23, 42, 0.05)',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <NavItem icon={<Home size={16} strokeWidth={2} />} label="Dashboard" selected={destination === 'dashboard'} onClick={() => onSelect('dashboard')} />
        {isAdmin && (
          <>
            <NavItem icon={<Users size={16} strokeWidth={2} />} label="Visão do time" selected={destination === 'team'} onClick={() => onSelect('team')} />
            <NavItem icon={<Briefcase size={16} strokeWidth={2} />} label="Projetos" selected={destination === 'projects'} onClick={() => onSelect('projects')} />
            <NavItem icon={<LineChart size={16} strokeWidth={2} />} label="Cycle Time & Histórico" selected={destination === 'history'} onClick={() => onSelect('history')} />
            <NavItem icon={<Clock size={16} strokeWidth={2} />} label="SLA" selected={destination === 'sla'} onClick={() => onSelect('sla')} />
            <NavItem icon={<FolderClock size={16} strokeWidth={2} />} label="Agrupamento" selected={destination === 'grouping'} onClick={() => onSelect('grouping')} />
            <NavItem icon={<Link2 size={16} strokeWidth={2} />} label="Conexão" selected={destination === 'connection'} onClick={() => onSelect('connection')} />
            <NavItem icon={<ShieldCheck size={16} strokeWidth={2} />} label="Administração" selected={destination === 'admin'} onClick={() => onSelect('admin')} />
          </>
        )}
      </div>
      <div style={{ padding: '0 12px 12px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 12px',
            borderRadius: 12,
            backgroundColor: '#F8FAFC',
            border: `1px solid ${BrandColors.border}`,
          }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              backgroundColor: BrandColors.primaryLightBg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              color: BrandColors.primaryDark,
              fontSize: 12.5,
              flexShrink: 0,
            }}
          >
            {initials(displayName)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 13,
                color: '#1E293B',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={appUser.email}
            >
              {shortName(displayName)}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500 }}>
              {isAdmin ? 'Administrador' : 'Responsável'}
            </div>
          </div>
          <button
            onClick={onSignOut}
            title="Sair"
            aria-label="Sair"
            style={{
              background: 'none',
              border: 'none',
              padding: 6,
              borderRadius: 8,
              cursor: 'pointer',
              color: '#94A3B8',
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = '#EEF2F6';
              e.currentTarget.style.color = BrandColors.danger;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = '#94A3B8';
            }}
          >
            <LogOut size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '10px 16px',
          borderTop: `1px solid ${BrandColors.border}`,
          backgroundColor: '#FAFBFC',
        }}
      >
        <span style={{ fontSize: 10, color: '#B0B9C6', letterSpacing: 0.3 }}>desenvolvido por</span>
        <img src={poletechBadge} alt="Pole Tech" style={{ height: 18, objectFit: 'contain', opacity: 0.85 }} />
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  selected,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div style={{ padding: '4px 12px' }}>
      <button
        onClick={onClick}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px',
          borderRadius: 10,
          border: 'none',
          cursor: 'pointer',
          backgroundColor: selected ? BrandColors.primary : 'transparent',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            width: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: selected ? '#FFFFFF' : '#334155',
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontWeight: selected ? 700 : 400,
            color: selected ? '#FFFFFF' : '#334155',
            fontSize: 14,
          }}
        >
          {label}
        </span>
      </button>
    </div>
  );
}
