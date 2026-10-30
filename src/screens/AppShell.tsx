import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Home, Users, Contact, LineChart, Clock, Settings, Briefcase, LogOut, Sunrise, AlertTriangle, Ellipsis } from 'lucide-react';
import { WorkItem } from '../models/workItem';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import { AppSettings } from '../services/settingsService';
import { SupabaseConfigService } from '../services/supabaseConfigService';
import { CardRating, CardRatingService } from '../services/cardRatingService';
import { loadWorkItemCache, saveWorkItemCache } from '../services/workItemCache';
import type { AppUser } from '../services/authService';
import { Sprint, SprintService } from '../services/sprintService';
import { BrandColors } from '../theme';
import poletechBadge from '../assets/poletech.png';
import { DashboardScreen } from './DashboardScreen';
import { TeamDashboardScreen } from './TeamDashboardScreen';
import { AttentionScreen } from './AttentionScreen';
import { DailyScreen } from './DailyScreen';
import { UsersScreen } from './UsersScreen';
import { HistoryScreen } from './HistoryScreen';
import { SlaScreen } from './SlaScreen';
import { ConfiguracoesScreen } from './ConfiguracoesScreen';
import { ProjectsScreen } from './ProjectsScreen';
import '../nav.css';

type Destination = 'dashboard' | 'team' | 'attention' | 'daily' | 'users' | 'history' | 'sla' | 'projects' | 'settings';

const configService = new SupabaseConfigService();
const sprintService = new SprintService();
const cardRatingService = new CardRatingService();

const DESTINATIONS: Destination[] = ['dashboard', 'team', 'attention', 'daily', 'users', 'history', 'sla', 'projects', 'settings'];
const DESTINATION_STORAGE_KEY = 'appShell:destination';

// Top bar tabs (admin only). Configurações isn't here — it lives in the
// avatar menu, same as "Acesso" in the redespacho dashboard.
const NAV_ITEMS: { id: Destination; label: string; icon: (size: number) => ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: (s) => <Home size={s} strokeWidth={2} /> },
  { id: 'team', label: 'Visão do time', icon: (s) => <Users size={s} strokeWidth={2} /> },
  { id: 'attention', label: 'Atenção', icon: (s) => <AlertTriangle size={s} strokeWidth={2} /> },
  { id: 'daily', label: 'Daily', icon: (s) => <Sunrise size={s} strokeWidth={2} /> },
  { id: 'users', label: 'Usuários', icon: (s) => <Contact size={s} strokeWidth={2} /> },
  { id: 'projects', label: 'Projetos', icon: (s) => <Briefcase size={s} strokeWidth={2} /> },
  { id: 'history', label: 'Cycle Time & Histórico', icon: (s) => <LineChart size={s} strokeWidth={2} /> },
  { id: 'sla', label: 'SLA', icon: (s) => <Clock size={s} strokeWidth={2} /> },
];

// Which tab was open, so it survives the tab getting reloaded (Chrome's
// Memory Saver discarding a backgrounded tab is the common case) instead of
// silently dropping you back on Dashboard every time you switch away and
// back. `isAdmin` gets checked again here, not just in selectDestination —
// a stored destination from a previous admin session should never leak
// through for a "responsável" login on the same browser.
function loadStoredDestination(isAdmin: boolean): Destination {
  if (!isAdmin) return 'dashboard';
  try {
    const stored = sessionStorage.getItem(DESTINATION_STORAGE_KEY);
    if (stored != null && (DESTINATIONS as string[]).includes(stored)) return stored as Destination;
  } catch {
    // sessionStorage unavailable — fall through to the default.
  }
  return 'dashboard';
}

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
  const [destination, setDestination] = useState<Destination>(() => loadStoredDestination(appUser.role === 'admin'));
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const sprints = useRef<Sprint[]>(sprintService.recentSprints());
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(
    sprintService.sprintFor(sprintService.sprintNumberContaining(new Date())),
  );
  // Dashboard fetches a rolling window of the last DASHBOARD_CACHE_SPRINTS
  // sprints up front (open items + everything changed since then) and keeps
  // it around — switching the sprint dropdown just re-filters this in
  // memory (DashboardScreen already slices completed items by date range),
  // so it's instant as long as the picked sprint falls inside that window.
  // Only picking something older triggers a real (loading) fetch, which
  // also widens the cached window to cover it from then on.
  const [cachedFromSprintNumber, setCachedFromSprintNumber] = useState<number | null>(null);
  // The main content area is one scrollable div shared by every screen —
  // React doesn't reset its scrollTop just because a different screen (or a
  // different internal tab, e.g. Visão do time's Ranking/WIP/Sofrimento)
  // got rendered into it, so without this a scrolled-down position leaks
  // into whatever you open next.
  const contentRef = useRef<HTMLDivElement>(null);
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

  // card_ratings, loaded once here (not per-screen) so Dashboard (who's
  // writing them), Visão do time and Usuários (who are both just reading)
  // always see the same list without each firing its own fetch.
  const [ratings, setRatings] = useState<CardRating[]>([]);
  const [ratingsLoading, setRatingsLoading] = useState(false);

  async function refreshRatings() {
    setRatingsLoading(true);
    try {
      setRatings(await cardRatingService.loadAll());
    } catch (e) {
      console.error('Falha ao carregar avaliações:', e);
    } finally {
      setRatingsLoading(false);
    }
  }

  useEffect(() => {
    refreshRatings();
  }, []);

  useEffect(() => {
    function onResize() {
      setIsNarrow(window.innerWidth < 900);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [destination]);

  useEffect(() => {
    (async () => {
      const loaded = await configService.load();
      setSettings(loaded);
      setSettingsLoaded(true);
      if (loaded.isConfigured) {
        // Reload from sessionStorage before hitting the API — survives the
        // browser reloading this tab (Chrome discarding it in the
        // background is the common case), which otherwise wipes this
        // rolling-window cache and forces a full re-fetch on every tab
        // switch, defeating the whole point of caching it.
        const cached = loadWorkItemCache(loaded.organization, loaded.project);
        if (cached != null) {
          setItems(cached.items);
          setCachedFromSprintNumber(cached.fromSprintNumber);
          setLastUpdated(cached.lastUpdated);
        } else {
          refresh(loaded);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restored a Histórico/SLA destination from sessionStorage on a fresh
  // reload — that data load normally only kicks off inside selectDestination
  // when the nav item is clicked, so a page that opens straight into one of
  // those tabs needs it triggered here instead, once `settings` has
  // actually loaded (not the stale unconfigured default from this render).
  useEffect(() => {
    if (!settingsLoaded || !settings.isConfigured) return;
    if ((destination === 'history' || destination === 'sla') && historyItems == null) {
      loadHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsLoaded]);

  /** How many sprints back the Dashboard keeps warm without asking the API
   * again — matches the size of the dropdown's usual browsing range. */
  const DASHBOARD_CACHE_SPRINTS = 6;

  /** Fetches open items + everything changed since `fromSprintNumber` (the
   * last DASHBOARD_CACHE_SPRINTS by default, or further back when a caller
   * needs to widen the cache to reach an older sprint). */
  async function refresh(useSettings?: AppSettings, fromSprintNumber?: number) {
    const s = useSettings ?? settings;
    if (!s.isConfigured) return;
    const currentSprintNumber = sprintService.sprintNumberContaining(new Date());
    const targetFrom = Math.min(
      fromSprintNumber ?? currentSprintNumber,
      cachedFromSprintNumber ?? currentSprintNumber - (DASHBOARD_CACHE_SPRINTS - 1),
    );
    setLoading(true);
    setError(null);
    try {
      const service = new AzureDevOpsService(s);
      const fetched = await service.fetchMyWorkItems({
        changedSince: sprintService.sprintFor(targetFrom).start,
      });
      const now = new Date();
      setItems(fetched);
      setCachedFromSprintNumber(targetFrom);
      setLastUpdated(now);
      saveWorkItemCache(s.organization, s.project, { items: fetched, fromSprintNumber: targetFrom, lastUpdated: now });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  /** The sprint dropdown changed. If it's still inside the cached window,
   * just switch — DashboardScreen re-filters the already-loaded items
   * locally, no loading spinner. Otherwise, widen the cache with a real
   * (loading) fetch reaching back to that sprint. */
  function onSprintChanged(sprint: Sprint | null) {
    setSelectedSprint(sprint);
    if (sprint != null && (cachedFromSprintNumber == null || sprint.number < cachedFromSprintNumber)) {
      refresh(settings, sprint.number);
    }
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

    const wantedCount = count ?? historySprintCount;
    const currentSprintNumber = sprintService.sprintNumberContaining(new Date());
    const neededFromSprintNumber = currentSprintNumber - wantedCount + 1;
    // The Dashboard already keeps open items + the last DASHBOARD_CACHE_SPRINTS
    // sprints warm — if that already reaches back far enough for what
    // Histórico wants, reuse it instead of firing a second, near-identical
    // fetch the moment this tab is opened.
    if (!force && cachedFromSprintNumber != null && cachedFromSprintNumber <= neededFromSprintNumber && items.length > 0) {
      setHistoryItems(items);
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const earliestStart = historySprints(wantedCount)[0].start;
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
    refresh(next);
  }

  /** Switches the visible tab and, if that tab needs its own data (only
   * Histórico does) and doesn't have it cached yet, kicks off that load —
   * but only then, never on every rebuild. */
  function selectDestination(d: Destination) {
    // Defense in depth — the Sidebar only ever renders "Dashboard" for a
    // non-admin, but this keeps a stray/forged call from switching tabs too.
    if (!isAdmin && d !== 'dashboard') return;
    setDestination(d);
    try {
      sessionStorage.setItem(DESTINATION_STORAGE_KEY, d);
    } catch {
      // Ignore — losing this is just "back to Dashboard on reload", not fatal.
    }
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
      <header className="nav-topbar">
        <span className="nav-brand">Pole Performance</span>
        {isAdmin && (
          <TopTabs items={NAV_ITEMS} destination={destination} onSelect={selectDestination} />
        )}
        <div className="nav-actions">
          <button
            className="nav-refresh"
            onClick={() => refresh()}
            disabled={loading}
            title="Atualizar itens em aberto + sprint selecionada"
          >
            <RefreshCw size={16} strokeWidth={2} />
            {!isNarrow && 'Atualizar'}
          </button>
          <UserMenu
            appUser={appUser}
            settings={settings}
            isAdmin={isAdmin}
            onOpenSettings={() => selectDestination('settings')}
            onSignOut={onSignOut}
          />
        </div>
      </header>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div ref={contentRef} className="nav-content" style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
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
              onTabChange={() => contentRef.current?.scrollTo(0, 0)}
              ratingsLoading={ratingsLoading}
            />
          )}
          {destination === 'attention' && isAdmin && (
            <AttentionScreen
              settings={settings}
              items={items}
              loading={loading}
              error={error}
              selectedSprint={selectedSprint}
              sprints={sprints.current}
              onSprintChanged={onSprintChanged}
            />
          )}
          {destination === 'daily' && (
            <DailyScreen settings={settings} items={items} loading={loading} error={error} />
          )}
          {destination === 'users' && (
            <UsersScreen
              settings={settings}
              items={items}
              loading={loading}
              error={error}
              selectedSprint={selectedSprint}
              sprints={sprints.current}
              onSprintChanged={onSprintChanged}
              ratings={ratings}
              ratingsLoading={ratingsLoading}
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
          {destination === 'settings' && isAdmin && (
            <ConfiguracoesScreen settings={settings} items={items} onSaved={saveSettings} />
          )}
        </div>
      </div>
      {isAdmin && <BottomNav items={NAV_ITEMS} destination={destination} onSelect={selectDestination} />}
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

type NavItemDef = (typeof NAV_ITEMS)[number];

/** Closes `open` stuff on a click outside `ref` or Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/** Desktop tabs: as many as fit the available width, the rest behind a
 * "Mais" dropdown — never a scrollbar. A hidden copy of every tab (plus the
 * "Mais" button) is measured so the count is exact, and re-measured whenever
 * the bar or the fonts resize it. */
function TopTabs({
  items,
  destination,
  onSelect,
}: {
  items: NavItemDef[];
  destination: Destination;
  onSelect: (d: Destination) => void;
}) {
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [moreOpen, setMoreOpen] = useState(false);
  useDismiss(moreOpen, moreRef, () => setMoreOpen(false));

  useLayoutEffect(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (nav == null || measure == null) return;
    const GAP = 4;
    function recompute() {
      const kids = Array.from(measure!.children) as HTMLElement[];
      const moreWidth = kids[kids.length - 1].offsetWidth;
      const widths = kids.slice(0, -1).map((k) => k.offsetWidth);
      const available = nav!.clientWidth;
      const total = widths.reduce((s, w) => s + w, 0) + GAP * (widths.length - 1);
      if (total <= available) {
        setVisibleCount(widths.length);
        return;
      }
      let used = moreWidth;
      let count = 0;
      for (const w of widths) {
        if (used + GAP + w > available) break;
        used += GAP + w;
        count++;
      }
      setVisibleCount(count);
    }
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(nav);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [items]);

  const shown = items.slice(0, visibleCount);
  const hidden = items.slice(visibleCount);
  const hiddenActive = hidden.some((n) => n.id === destination);

  return (
    <nav className="nav-tabs" aria-label="Principal" ref={navRef}>
      {shown.map((n) => (
        <button key={n.id} className={`nav-tab${destination === n.id ? ' active' : ''}`} onClick={() => onSelect(n.id)}>
          {n.icon(16)}
          {n.label}
        </button>
      ))}
      {hidden.length > 0 && (
        <div className="nav-more" ref={moreRef}>
          <button
            className={`nav-tab${hiddenActive ? ' active' : ''}`}
            onClick={() => setMoreOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
          >
            <Ellipsis size={16} strokeWidth={2} />
            Mais
          </button>
          {moreOpen && (
            <div className="nav-more-panel" role="menu">
              {hidden.map((n) => (
                <button
                  key={n.id}
                  className={`nav-user-item${destination === n.id ? ' active' : ''}`}
                  role="menuitem"
                  onClick={() => {
                    setMoreOpen(false);
                    onSelect(n.id);
                  }}
                >
                  {n.icon(15)}
                  {n.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="nav-tabs-measure" ref={measureRef} aria-hidden>
        {items.map((n) => (
          <button key={n.id} className="nav-tab active" tabIndex={-1}>
            {n.icon(16)}
            {n.label}
          </button>
        ))}
        <button className="nav-tab active" tabIndex={-1}>
          <Ellipsis size={16} strokeWidth={2} />
          Mais
        </button>
      </div>
    </nav>
  );
}

const BOTTOM_VISIBLE = 3;

/** Phone navigation: the first three screens plus "Mais", which slides up a
 * small sheet with the rest to pick from. */
function BottomNav({
  items,
  destination,
  onSelect,
}: {
  items: NavItemDef[];
  destination: Destination;
  onSelect: (d: Destination) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const shown = items.slice(0, BOTTOM_VISIBLE);
  const rest = items.slice(BOTTOM_VISIBLE);
  const restActive = rest.some((n) => n.id === destination);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  return (
    <>
      <nav className="nav-bottom" aria-label="Principal">
        {shown.map((n) => (
          <button
            key={n.id}
            className={`nav-bottom-tab${destination === n.id ? ' active' : ''}`}
            onClick={() => onSelect(n.id)}
          >
            {n.icon(22)}
            <span>{n.label}</span>
          </button>
        ))}
        <button
          className={`nav-bottom-tab${restActive || sheetOpen ? ' active' : ''}`}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
        >
          <Ellipsis size={22} strokeWidth={2} />
          <span>Mais</span>
        </button>
      </nav>
      {sheetOpen && (
        <div className="nav-sheet-backdrop" onClick={() => setSheetOpen(false)}>
          <div className="nav-sheet" role="dialog" aria-label="Mais telas" onClick={(e) => e.stopPropagation()}>
            <div className="nav-sheet-handle" />
            {rest.map((n) => (
              <button
                key={n.id}
                className={`nav-sheet-item${destination === n.id ? ' active' : ''}`}
                onClick={() => {
                  setSheetOpen(false);
                  onSelect(n.id);
                }}
              >
                {n.icon(20)}
                {n.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Avatar button at the right of the top bar. Opens a small panel with who is
 * signed in, Configurações (admin only), Sair and the Pole Tech badge — what
 * used to live in the sidebar footer (and in the responsável's header badge). */
function UserMenu({
  appUser,
  settings,
  isAdmin,
  onOpenSettings,
  onSignOut,
}: {
  appUser: AppUser;
  settings: AppSettings;
  isAdmin: boolean;
  onOpenSettings: () => void;
  onSignOut: () => void;
}) {
  const displayName = appUser.responsavelName ?? settings.myDisplayName;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, () => setOpen(false));

  return (
    <div className="nav-user" ref={ref}>
      <button
        className="nav-avatar"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
      >
        {initials(displayName)}
      </button>
      {open && (
        <div className="nav-user-panel" role="menu">
          <div className="nav-user-header" title={appUser.email}>
            <span className="nav-user-name">{shortName(displayName)}</span>
            <span className="nav-user-role">{isAdmin ? 'Administrador' : 'Responsável'}</span>
          </div>
          {isAdmin && (
            <button
              className="nav-user-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings size={15} />
              Configurações
            </button>
          )}
          <button
            className="nav-user-item danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut size={15} />
            Sair
          </button>
          <div className="nav-made-by">
            <span>desenvolvido por</span>
            <img src={poletechBadge} alt="Pole Tech" />
          </div>
        </div>
      )}
    </div>
  );
}
