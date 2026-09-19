import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { boardColumnMatches, WorkItem } from '../models/workItem';
import {
  groupBreakdown,
  ItemMetric,
  MetricsCalculator,
  MetricsSummary,
} from '../services/metricsService';
import { AppSettings } from '../services/settingsService';
import { Sprint, SprintService } from '../services/sprintService';
import { buildHealthScoreRanking } from '../services/sprintSnapshotService';
import { BrandColors } from '../theme';
import { ToggleChip } from '../components/ToggleChip';
import abapinhoLogo from '../assets/abapinho.png';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  BarChart3,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Flag,
  HeartPulse,
  Inbox,
  LayoutList,
  PauseCircle,
  RefreshCw,
  Search,
  Tag as TagIcon,
  Truck,
  TrendingUp,
  UserRound,
  X,
  Zap,
} from 'lucide-react';

/** Traffic-light coloring for flow efficiency: above 40% is considered
 * healthy, 20-40% is typical-but-improvable, below 20% flags a flow
 * dominated by waiting rather than working. */
export function flowEfficiencyColor(pct: number | null | undefined): string {
  if (pct == null) return '#64748B';
  if (pct >= 40) return BrandColors.user;
  if (pct >= 20) return BrandColors.queue;
  return BrandColors.danger;
}

/** Traffic-light coloring for on-time delivery: 80%+ is a reliable
 * forecast, 50-80% is inconsistent, below 50% means deadlines are
 * essentially not being met. */
export function predictabilityColor(pct: number | null | undefined): string {
  if (pct == null) return '#64748B';
  if (pct >= 80) return BrandColors.user;
  if (pct >= 50) return BrandColors.queue;
  return BrandColors.danger;
}

type TypeFilter = 'cards' | 'features' | 'all';
type BreakdownDimension = 'complexity' | 'department' | 'priority' | 'requestType';
type SortMode = 'defaultOrder' | 'responsible';

/** Which category counts as "Cycle Time" throughout the dashboard — cards,
 * chart reference line, and the breakdown table all follow this. */
type CycleTimeCategory = 'triage' | 'queue' | 'developer' | 'user' | 'vendor' | 'general';

const CYCLE_TIME_CATEGORIES: CycleTimeCategory[] = [
  'triage',
  'queue',
  'developer',
  'user',
  'vendor',
  'general',
];

function cycleTimeLabel(c: CycleTimeCategory): string {
  switch (c) {
    case 'triage':
      return 'Triagem';
    case 'queue':
      return 'Fila';
    case 'developer':
      return 'Desenvolvedor';
    case 'user':
      return 'Usuário';
    case 'vendor':
      return 'Fornecedor';
    case 'general':
      return 'Geral';
  }
}

function cycleTimeColor(c: CycleTimeCategory): string {
  switch (c) {
    case 'triage':
      return BrandColors.triage;
    case 'queue':
      return BrandColors.queue;
    case 'developer':
      return BrandColors.developer;
    case 'user':
      return BrandColors.user;
    case 'vendor':
      return BrandColors.vendor;
    case 'general':
      return BrandColors.general;
  }
}

function cycleTimeSelect(c: CycleTimeCategory, m: ItemMetric): number {
  switch (c) {
    case 'triage':
      return m.triageDays;
    case 'queue':
      return m.queueDays;
    case 'developer':
      return m.cycleTimeDays;
    case 'user':
      return m.userDays;
    case 'vendor':
      return m.vendorDays;
    case 'general':
      return m.generalDays;
  }
}

/** Sums every checked category's time on the same item — checking more than
 * one chip adds them together (e.g. Desenvolvedor + Fila = time actually
 * worked plus time waiting to be picked up), instead of only ever showing
 * one category at a time. */
function cycleTimeSelectMulti(categories: Set<CycleTimeCategory>, m: ItemMetric): number {
  let total = 0;
  for (const c of CYCLE_TIME_CATEGORIES) {
    if (categories.has(c)) total += cycleTimeSelect(c, m);
  }
  return total;
}

function cycleTimeCombinedLabel(categories: Set<CycleTimeCategory>): string {
  const labels = CYCLE_TIME_CATEGORIES.filter((c) => categories.has(c)).map(cycleTimeLabel);
  return labels.length === 0 ? 'Nenhum grupo' : labels.join(' + ');
}

function cycleTimeCombinedColor(categories: Set<CycleTimeCategory>): string {
  if (categories.size === 1) return cycleTimeColor([...categories][0]);
  return BrandColors.primary;
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

const sprintService = new SprintService();

/** Pure content view for the dashboard tab — data (settings/items/loading
 * state) is owned by the shell and passed in, so this widget only holds
 * UI-local filter state (which group/type/sprint is selected). */
export function DashboardScreen({
  settings,
  items,
  loading,
  error,
  lastUpdated,
  selectedSprint,
  sprints,
  onRefresh,
  onSprintChanged,
  lockedResponsible,
}: {
  settings: AppSettings;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  selectedSprint: Sprint | null;
  sprints: Sprint[];
  onRefresh: () => void;
  onSprintChanged: (sprint: Sprint | null) => void;
  // Set for a non-admin "responsável" login — the "Responsável" dropdown
  // disappears entirely and every filter is pinned to this name, so a
  // regular user can only ever see their own data, not just default to it.
  lockedResponsible?: string;
}) {
  const completedSectionRef = useRef<HTMLDivElement>(null);

  // "Active" filters — what's actually applied to the data right now. The
  // "Responsável" dropdown is just a name: picking settings.myDisplayName
  // specifically triggers the merged "meus itens + marcados" rule inside
  // itemsInSelectedGroup below, picking anyone else is a plain
  // assignedTo match — no separate "mode" toggle needed anymore.
  const [selectedType, setSelectedType] = useState<TypeFilter>('cards');
  const [selectedSpecificPerson, setSelectedSpecificPerson] = useState<string | null>(lockedResponsible ?? settings.myDisplayName);
  const [selectedArea, setSelectedArea] = useState<string | null>(null);

  // "Pending" filters — what the dropdowns show while you're setting them
  // up; only copied into the active filters (and, for the sprint, only
  // then triggers a new fetch) when you press "Pesquisar".
  const [pendingType, setPendingType] = useState<TypeFilter>(selectedType);
  const [pendingSpecificPerson, setPendingSpecificPerson] = useState<string | null>(selectedSpecificPerson);
  const [pendingArea, setPendingArea] = useState<string | null>(null);
  const [pendingSprint, setPendingSprint] = useState<Sprint | null>(selectedSprint);

  const [showAllAging, setShowAllAging] = useState(false);
  const [triageExpanded, setTriageExpanded] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('defaultOrder');
  const [selectedBreakdown, setSelectedBreakdown] = useState<BreakdownDimension>('complexity');
  const [selectedCycleTimeCategories, setSelectedCycleTimeCategories] = useState<Set<CycleTimeCategory>>(
    () => new Set<CycleTimeCategory>(['general']),
  );
  function toggleCycleTimeCategory(c: CycleTimeCategory) {
    setSelectedCycleTimeCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }
  const [detailItem, setDetailItem] = useState<ItemMetric | null>(null);

  function applyPendingFilters() {
    setSelectedType(pendingType);
    setSelectedSpecificPerson(pendingSpecificPerson);
    setSelectedArea(pendingArea);
    if (pendingSprint?.number !== selectedSprint?.number) {
      onSprintChanged(pendingSprint);
    }
  }

  // Every distinct assignee found in the loaded items, alphabetically —
  // feeds the "responsável específico" dropdown.
  // Always includes settings.myDisplayName even if he has zero items
  // literally assigned to him right now (e.g. everything of his came in via
  // tag) — otherwise he couldn't be selected at all.
  const knownResponsibles = [...new Set([settings.myDisplayName.trim(), ...items.map((i) => i.assignedTo.trim())])]
    .filter((n) => n !== '')
    .sort();

  // Every distinct area path found in the loaded items — feeds the "Área"
  // dropdown. Kept as the full path (e.g. "TI Pole\Sustentação") so two
  // areas with the same leaf name in different projects don't collide;
  // only the leaf is shown in the dropdown label.
  const knownAreas = [...new Set(items.map((i) => i.areaPath.trim()).filter((a) => a))].sort();
  const areaLeaf = (areaPath: string) => areaPath.split('\\').pop() ?? areaPath;

  // Applies the current "Ordenar por" choice on top of whatever order the
  // list already came in — grouping by responsável makes a lot more sense
  // than the default order once you're looking at the whole sprint mixed
  // together (group: Tudo).
  function applySort(list: ItemMetric[]): ItemMetric[] {
    if (sortMode !== 'responsible') return list;
    return [...list].sort((a, b) => {
      const cmp = a.item.assignedTo.trim().toLowerCase().localeCompare(b.item.assignedTo.trim().toLowerCase());
      if (cmp !== 0) return cmp;
      return b.totalDays - a.totalDays;
    });
  }

  const itemsInSelectedGroup = items.filter((item) => {
    // Cancelled items (removed, or abandoned for lack of user response)
    // are dead work — never show them anywhere.
    if (item.isCancelled) return false;

    let matchesGroup: boolean;
    if (selectedSpecificPerson == null) {
      matchesGroup = false;
    } else if (selectedSpecificPerson.trim().toLowerCase() === settings.myDisplayName.trim().toLowerCase()) {
      // Picking Guilherme himself merges two sources that both end up
      // meaning "this is his work": items actually assigned to him (always
      // count, whatever state/column they're in — it's literally his), and
      // items tagged for him but assigned to someone else (only count once
      // they're either done — the tagged work got delivered, credit it
      // regardless of which column it happened to finish in — or currently
      // sitting in Desenvolvedor right now — someone is actively working it
      // on his behalf at this moment). A tagged item still open in Triagem,
      // Fila, Usuário or Fornecedor isn't "his" yet: nobody has picked it up
      // as dev work, so counting it now would flag things Guilherme has no
      // actual claim on yet.
      const isMine = item.assignedTo.trim().toLowerCase() === settings.myDisplayName.trim().toLowerCase();
      const hasTag = item.tags.some((t) => t.trim().toLowerCase() === settings.tagFilter.trim().toLowerCase());
      if (isMine) {
        matchesGroup = true;
      } else if (!hasTag) {
        matchesGroup = false;
      } else if (item.isDone(settings.doneStateSet, settings.doneColumn)) {
        matchesGroup = true;
      } else {
        matchesGroup = boardColumnMatches(settings.developerColumnSet, item.currentBoardColumn);
      }
    } else {
      // Anyone else: a plain "this is literally assigned to them" filter —
      // the tag-merge rule above only applies to settings.myDisplayName,
      // since settings.tagFilter models one specific relationship (other
      // people invoking *his* services), not a personal tag per person.
      matchesGroup = item.assignedTo.trim().toLowerCase() === selectedSpecificPerson.trim().toLowerCase();
    }
    if (!matchesGroup) return false;

    if (selectedArea != null && item.areaPath.trim() !== selectedArea) return false;

    const type = item.type.trim().toLowerCase();
    if (selectedType === 'cards') return type === 'user story';
    if (selectedType === 'features') return type === 'feature';
    return true;
  });

  // All metrics for the selected group, independent of the sprint filter —
  // used for aging (items must always show up regardless of sprint).
  const groupSummary = new MetricsCalculator({
    triageColumns: settings.triageColumnSet,
    queueColumns: settings.queueColumnSet,
    developerColumns: settings.developerColumnSet,
    userColumns: settings.userColumnSet,
    vendorColumns: settings.vendorColumnSet,
    generalColumns: settings.generalColumnSet,
    doneColumn: settings.doneColumn,
    doneStates: settings.doneStateSet,
  }).calculate(itemsInSelectedGroup);

  // Completed items whose conclusion date falls inside the selected sprint.
  // Feeds the cycle-time cards, chart and completed table.
  function sprintFilteredSummary(): MetricsSummary {
    const sprint = selectedSprint;
    if (sprint == null) return new MetricsSummary(groupSummary.completed);
    const rangeEnd = new Date(sprint.end.getTime() + 24 * 60 * 60 * 1000);
    const filtered = groupSummary.completed.filter((m) => {
      const end = m.endDate;
      return end != null && end.getTime() >= sprint.start.getTime() && end.getTime() < rangeEnd.getTime();
    });
    return new MetricsSummary(filtered);
  }

  // Deliberately NOT scoped to the selected sprint — "Tempo médio por
  // coluna" needs a decent sample size at any point in the sprint,
  // including right after a new one starts (when sprintFilteredSummary()
  // would have close to nothing closed yet). A rolling 30-day window gives
  // a stable read regardless of where the team is in the current sprint.
  function last30DaysSummary(): MetricsSummary {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const filtered = groupSummary.completed.filter((m) => m.endDate != null && m.endDate.getTime() >= cutoff.getTime());
    return new MetricsSummary(filtered);
  }

  // A column value that means "disregard this item entirely" — some cards
  // come back with no board column at all (shown as "-" on the board).
  function hasUsableColumn(item: WorkItem): boolean {
    const col = item.currentBoardColumn.trim();
    return col !== '' && col !== '-';
  }
  const isInTriage = (item: WorkItem) => boardColumnMatches(settings.triageColumnSet, item.currentBoardColumn);

  // Every open item in the selected group that's past Triagem and has a
  // real board column — no matter which column it's currently sitting in
  // otherwise — always broken down by the same structure. Shown regardless
  // of the sprint filter. Triagem items get their own section instead
  // (triageItems), and items with no usable column are disregarded.
  const agingItems = groupSummary.inProgress
    .filter((m) => hasUsableColumn(m.item) && !isInTriage(m.item))
    .sort((a, b) => b.totalDays - a.totalDays);

  // Open items currently sitting in Triagem — shown separately so they
  // don't inflate "Itens em aberto", with the time spent there specifically.
  const triageItems = groupSummary.inProgress
    .filter((m) => hasUsableColumn(m.item) && isInTriage(m.item))
    .sort((a, b) => b.triageDays - a.triageDays);

  const openedSprintNumber = (item: WorkItem) => sprintService.sprintNumberContaining(item.createdDate);

  function timeInCurrentColumnDays(item: WorkItem): number {
    const history = item.boardColumnHistory;
    const since = history.length === 0 ? item.createdDate : history[history.length - 1].date;
    return (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24);
  }

  // Every distinct Kanban board column value seen across all fetched items
  // (current + historical), so we can warn when none matches configuration.
  const detectedBoardColumns = new Set<string>();
  for (const item of items) {
    if (item.currentBoardColumn) detectedBoardColumns.add(item.currentBoardColumn);
    for (const change of item.boardColumnHistory) detectedBoardColumns.add(change.state);
  }

  function categoryColorFor(column: string): string {
    if (boardColumnMatches(settings.developerColumnSet, column)) return BrandColors.developer;
    if (boardColumnMatches(settings.queueColumnSet, column)) return BrandColors.queue;
    if (boardColumnMatches(settings.triageColumnSet, column)) return BrandColors.triage;
    if (boardColumnMatches(settings.userColumnSet, column)) return BrandColors.user;
    if (boardColumnMatches(settings.vendorColumnSet, column)) return BrandColors.vendor;
    if (boardColumnMatches(settings.generalColumnSet, column)) return BrandColors.general;
    if (boardColumnMatches(new Set([settings.doneColumn]), column)) return BrandColors.total;
    return '#64748B';
  }

  if (!settings.isConfigured) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div style={{ textAlign: 'center', maxWidth: 360 }}>
          <img src={abapinhoLogo} alt="" style={{ height: 90, objectFit: 'contain' }} />
          <div style={{ height: 24 }} />
          <p style={{ fontWeight: 600 }}>Configure a Conexão para começar.</p>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <Clock size={28} strokeWidth={1.75} color="#64748B" />
          </div>
          <div style={{ height: 12 }} />
          <p style={{ fontSize: 13 }}>Buscando seus cards no Azure Boards...</p>
        </div>
      </div>
    );
  }
  if (error != null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ display: 'flex', justifyContent: 'center', color: BrandColors.danger }}>
            <AlertTriangle size={40} strokeWidth={1.75} />
          </div>
          <p>{error}</p>
          <button onClick={onRefresh} style={primaryButtonStyle}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  const summary = sprintFilteredSummary();
  const aging = agingItems;
  const triage = triageItems;

  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1500, width: '100%' }}>
        <Filters
          settings={settings}
          sprints={sprints}
          pendingSpecificPerson={pendingSpecificPerson}
          setPendingSpecificPerson={setPendingSpecificPerson}
          knownResponsibles={knownResponsibles}
          lockedResponsible={lockedResponsible}
          pendingType={pendingType}
          setPendingType={setPendingType}
          pendingArea={pendingArea}
          setPendingArea={setPendingArea}
          knownAreas={knownAreas}
          areaLeaf={areaLeaf}
          pendingSprint={pendingSprint}
          setPendingSprint={setPendingSprint}
          sortMode={sortMode}
          setSortMode={setSortMode}
          onSearch={applyPendingFilters}
        />
        <div style={{ height: 20 }} />
        <HealthScoreBanner personName={selectedSpecificPerson} items={items} settings={settings} />
        <DetectedColumnsWarning settings={settings} detected={detectedBoardColumns} />
        <SummaryCards
          summary={summary}
          aging={aging}
          selectedCycleTimeCategories={selectedCycleTimeCategories}
          onToggleCycleTimeCategory={toggleCycleTimeCategory}
        />
        <div style={{ height: 20 }} />
        <ColumnAverageCard summary={last30DaysSummary()} personName={selectedSpecificPerson ?? 'responsável'} />
        <div style={{ height: 20 }} />
        <TaggedQueueSection selectedSpecificPerson={selectedSpecificPerson} settings={settings} groupSummary={groupSummary} />
        <ChartsRow summary={summary} onSeeDetails={() => completedSectionRef.current?.scrollIntoView({ behavior: 'smooth' })} />
        <div style={{ height: 20 }} />
        <BreakdownSection
          summary={summary}
          selectedBreakdown={selectedBreakdown}
          setSelectedBreakdown={setSelectedBreakdown}
          selectedCycleTimeCategories={selectedCycleTimeCategories}
        />
        <div style={{ height: 20 }} />
        <AgingSection
          aging={aging}
          applySort={applySort}
          showAllAging={showAllAging}
          setShowAllAging={setShowAllAging}
          categoryColorFor={categoryColorFor}
          onSelectItem={setDetailItem}
        />
        <div style={{ height: 20 }} />
        <TriageSection triage={triage} applySort={applySort} expanded={triageExpanded} setExpanded={setTriageExpanded} onSelectItem={setDetailItem} />
        <div style={{ height: 20 }} />
        <CompletedTable
          ref={completedSectionRef}
          summary={summary}
          applySort={applySort}
          categoryColorFor={categoryColorFor}
          onSelectItem={setDetailItem}
        />
        <div style={{ height: 16 }} />
        <Footer lastUpdated={lastUpdated} onRefresh={onRefresh} />
      </div>
      {detailItem && (
        <ItemDetailDialog
          metric={detailItem}
          columnColor={categoryColorFor(detailItem.item.currentBoardColumn)}
          openedSprintNumber={openedSprintNumber(detailItem.item)}
          timeInCurrentColumn={timeInCurrentColumnDays(detailItem.item)}
          onClose={() => setDetailItem(null)}
        />
      )}
    </div>
  );
}

const primaryButtonStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '10px 20px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: BrandColors.primary,
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
};

function cardStyle(): React.CSSProperties {
  return {
    backgroundColor: BrandColors.cardBg,
    border: `1px solid ${BrandColors.border}`,
    borderRadius: 12,
    padding: 16,
  };
}

function Footer({ lastUpdated, onRefresh }: { lastUpdated: Date | null; onRefresh: () => void }) {
  const formatted = lastUpdated == null ? '—' : formatDateTime(lastUpdated);
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, padding: '4px 0' }}>
      <span style={{ fontSize: 12, color: '#94A3B8' }}>Última atualização: {formatted}</span>
      <button onClick={onRefresh} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: '#94A3B8' }}>
        <RefreshCw size={14} strokeWidth={2} />
      </button>
    </div>
  );
}

function typeFilterLabel(t: TypeFilter): string {
  if (t === 'cards') return 'Cards (User Story)';
  if (t === 'features') return 'Features (projeto)';
  return 'Todos os tipos';
}

function selectStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    border: `1px solid ${BrandColors.border}`,
    backgroundColor: '#fff',
    fontSize: 13,
  };
}

function FieldWrap({ label, width, children }: { label: string; width: number; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: '#334155' }}>{label}</span>
      {children}
    </label>
  );
}

function Filters({
  settings,
  sprints,
  pendingSpecificPerson,
  setPendingSpecificPerson,
  knownResponsibles,
  lockedResponsible,
  pendingType,
  setPendingType,
  pendingArea,
  setPendingArea,
  knownAreas,
  areaLeaf,
  pendingSprint,
  setPendingSprint,
  sortMode,
  setSortMode,
  onSearch,
}: {
  settings: AppSettings;
  sprints: Sprint[];
  pendingSpecificPerson: string | null;
  setPendingSpecificPerson: (v: string | null) => void;
  knownResponsibles: string[];
  lockedResponsible?: string;
  pendingType: TypeFilter;
  setPendingType: (v: TypeFilter) => void;
  pendingArea: string | null;
  setPendingArea: (v: string | null) => void;
  knownAreas: string[];
  areaLeaf: (s: string) => string;
  pendingSprint: Sprint | null;
  setPendingSprint: (v: Sprint | null) => void;
  sortMode: SortMode;
  setSortMode: (v: SortMode) => void;
  onSearch: () => void;
}) {
  return (
    <div style={cardStyle()}>
      <span style={{ fontSize: 12, fontWeight: 'bold', color: '#64748B' }}>Filtros</span>
      <div style={{ height: 12 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        {lockedResponsible ? (
          <FieldWrap label="Responsável" width={260}>
            <div style={{ ...selectStyle(), display: 'flex', alignItems: 'center', backgroundColor: BrandColors.tableHeader, color: '#334155' }}>
              {lockedResponsible}
            </div>
          </FieldWrap>
        ) : (
          <FieldWrap label="Responsável" width={260}>
            <select
              style={selectStyle()}
              value={pendingSpecificPerson ?? ''}
              onChange={(e) => setPendingSpecificPerson(e.target.value || null)}
            >
              {knownResponsibles.map((n) => (
                <option key={n} value={n}>
                  {n.trim().toLowerCase() === settings.myDisplayName.trim().toLowerCase() ? `${n} (você + marcados "${settings.tagFilter}")` : n}
                </option>
              ))}
            </select>
          </FieldWrap>
        )}
        <FieldWrap label="Tipo" width={200}>
          <select style={selectStyle()} value={pendingType} onChange={(e) => setPendingType(e.target.value as TypeFilter)}>
            {(['cards', 'features', 'all'] as TypeFilter[]).map((t) => (
              <option key={t} value={t}>
                {typeFilterLabel(t)}
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label="Área" width={220}>
          <select
            style={selectStyle()}
            value={pendingArea ?? ''}
            onChange={(e) => setPendingArea(e.target.value || null)}
          >
            <option value="">Todas as áreas</option>
            {knownAreas.map((a) => (
              <option key={a} value={a}>
                {areaLeaf(a)}
              </option>
            ))}
          </select>
        </FieldWrap>
        <FieldWrap label="Sprint (busca + concluídos)" width={240}>
          <select
            style={selectStyle()}
            value={pendingSprint?.number ?? ''}
            onChange={(e) => {
              const n = e.target.value;
              setPendingSprint(n === '' ? null : sprints.find((s) => s.number === Number(n)) ?? null);
            }}
          >
            <option value="">Todas as sprints</option>
            {sprints.map((s) => (
              <option key={s.number} value={s.number}>
                {s.label}
              </option>
            ))}
          </select>
        </FieldWrap>
        <button onClick={onSearch} style={{ ...primaryButtonStyle, marginTop: 0, height: 42, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={16} strokeWidth={2} /> Pesquisar
        </button>
      </div>
      <div style={{ height: 8 }} />
      <FieldWrap label="Ordenar por" width={200}>
        <select style={selectStyle()} value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
          <option value="defaultOrder">Padrão (mais antigo)</option>
          <option value="responsible">Responsável (A-Z)</option>
        </select>
      </FieldWrap>
      <div style={{ height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        <span style={{ fontSize: 13, color: '#94A3B8' }}>ⓘ</span>
        <span style={{ fontSize: 12, color: '#64748B' }}>
          Carregado: itens em aberto + a sprint pesquisada. Trocar filtros só aplica ao clicar em "Pesquisar".
        </span>
      </div>
    </div>
  );
}

function DetectedColumnsWarning({ settings, detected }: { settings: AppSettings; detected: Set<string> }) {
  const configured = new Set<string>([
    ...settings.triageColumnSet,
    ...settings.queueColumnSet,
    ...settings.developerColumnSet,
    ...settings.userColumnSet,
    ...settings.vendorColumnSet,
    ...settings.generalColumnSet,
    settings.doneColumn,
  ]);
  const list = [...detected];
  const matchedAny = list.some((c) => boardColumnMatches(configured, c));
  if (matchedAny || list.length === 0) return null;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...cardStyle(), backgroundColor: BrandColors.warningBg, display: 'flex', gap: 8 }}>
        <span style={{ color: BrandColors.warning, display: 'flex' }}>
          <AlertTriangle size={16} strokeWidth={2} />
        </span>
        <span style={{ fontSize: 12, color: BrandColors.warning, fontWeight: 600 }}>
          Nenhuma coluna do seu quadro bate com o que está configurado no Agrupamento. Abra "Agrupamento" no menu para corrigir.
        </span>
      </div>
    </div>
  );
}

/** Surfaces where the person this screen is about stands in the whole
 * team's Health Score ranking (Visão do time) — without having to leave
 * this screen and go look it up there. */
function HealthScoreBanner({
  personName,
  items,
  settings,
}: {
  personName: string | null | undefined;
  items: WorkItem[];
  settings: AppSettings;
}) {
  const name = personName?.trim();
  if (!name) return null;
  const ranking = buildHealthScoreRanking({ items, settings });
  const index = ranking.findIndex((r) => r.name.trim().toLowerCase() === name.toLowerCase());
  if (index === -1) return null;
  const entry = ranking[index];
  const color = predictabilityColor(entry.score);
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...cardStyle(), display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: hexAlpha(color, 0.12),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
            flexShrink: 0,
          }}
        >
          <HeartPulse size={20} strokeWidth={1.75} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 'bold' }}>Health Score de {name}</div>
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Posição {index + 1} de {ranking.length} no time — veja o cruzamento completo em Visão do time.
          </div>
        </div>
        <span style={{ fontSize: 26, fontWeight: 'bold', color }}>{entry.score.toFixed(0)}</span>
      </div>
    </div>
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function StatCard({ title, subtitle, value, icon, color }: { title: string; subtitle: string; value: ReactNode; icon: ReactNode; color: string }) {
  return (
    <div style={{ ...cardStyle(), width: 210 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: hexAlpha(color, 0.12),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
        }}
      >
        {icon}
      </div>
      <div style={{ height: 12 }} />
      <div style={{ fontSize: 12, color: '#64748B' }}>{title}</div>
      <div style={{ height: 4 }} />
      <div style={{ fontSize: 20, fontWeight: 'bold', color }}>{value}</div>
      <div style={{ height: 2 }} />
      <div style={{ fontSize: 11, color: '#94A3B8' }}>{subtitle}</div>
    </div>
  );
}

/** A labeled cluster of StatCards — splits the old wall of 15 identical
 * tiles into named groups (Cycle Time / Volume / Qualidade) so the eye has
 * somewhere to land instead of scanning a flat grid. */
function StatGroup({ label, cards, header }: { label: string; cards: ReactNode[]; header?: ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 0.6, color: '#94A3B8' }}>
          {label.toUpperCase()}
        </span>
        {header && (
          <>
            <div style={{ width: 12 }} />
            <div style={{ flex: 1 }}>{header}</div>
          </>
        )}
      </div>
      <div style={{ height: 10 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{cards}</div>
    </div>
  );
}

function SummaryCards({
  summary,
  aging,
  selectedCycleTimeCategories,
  onToggleCycleTimeCategory,
}: {
  summary: MetricsSummary;
  aging: ItemMetric[];
  selectedCycleTimeCategories: Set<CycleTimeCategory>;
  onToggleCycleTimeCategory: (c: CycleTimeCategory) => void;
}) {
  const avgAging = aging.length === 0 ? null : aging.reduce((s, m) => s + m.totalDays, 0) / aging.length;
  const selector = (m: ItemMetric) => cycleTimeSelectMulti(selectedCycleTimeCategories, m);
  const avgCycleTime = summary.averageMetricDays(selector);
  const medianCycleTime = summary.medianMetricDays(selector);
  const p85CycleTime = summary.percentileMetricDays(selector, 85);

  const cycleTimeCards = [
    <StatCard
      key="avg"
      title={`Cycle Time médio (${cycleTimeCombinedLabel(selectedCycleTimeCategories)})`}
      subtitle="Média geral dos itens"
      value={avgCycleTime != null ? `${avgCycleTime.toFixed(1)} dias` : '—'}
      icon={<Clock size={18} strokeWidth={1.75} />}
      color={cycleTimeCombinedColor(selectedCycleTimeCategories)}
    />,
    <StatCard
      key="median"
      title="Cycle Time (mediana)"
      subtitle="Mediana geral dos itens"
      value={medianCycleTime != null ? `${medianCycleTime.toFixed(1)} dias` : '—'}
      icon={<TrendingUp size={18} strokeWidth={1.75} />}
      color={BrandColors.total}
    />,
    <StatCard key="p85" title="P85" subtitle="Percentil 85" value={`${p85CycleTime.toFixed(1)} dias`} icon={<BarChart3 size={18} strokeWidth={1.75} />} color={BrandColors.general} />,
  ];

  const volumeCards = [
    <StatCard key="open" title="Itens em aberto" subtitle="Qualquer coluna" value={`${aging.length}`} icon={<LayoutList size={18} strokeWidth={1.75} />} color={BrandColors.triage} />,
    <StatCard
      key="done"
      title="Concluídos na sprint"
      subtitle="Itens finalizados"
      value={`${summary.completed.length}`}
      icon={<CheckCircle2 size={18} strokeWidth={1.75} />}
      color={BrandColors.user}
    />,
    <StatCard
      key="avgOpen"
      title="Tempo total médio (aberto)"
      subtitle="Itens ainda em andamento"
      value={avgAging != null ? `${avgAging.toFixed(1)} dias` : '—'}
      icon={<Clock size={18} strokeWidth={1.75} />}
      color={BrandColors.total}
    />,
    <StatCard
      key="avgTotal"
      title="Total médio (Backlog → Concluído)"
      subtitle="Tempo total médio"
      value={summary.averageTotalDays != null ? `${summary.averageTotalDays.toFixed(1)} dias` : '—'}
      icon="∞"
      color={BrandColors.total}
    />,
    <StatCard
      key="triage"
      title="Triagem médio"
      subtitle="Tempo médio em triagem"
      value={summary.averageTriageDays != null ? `${summary.averageTriageDays.toFixed(1)} dias` : '—'}
      icon={<Search size={18} strokeWidth={1.75} />}
      color={BrandColors.triage}
    />,
    <StatCard
      key="queue"
      title="Fila (Liberado p/ Dev) médio"
      subtitle="Tempo médio na fila"
      value={summary.averageQueueDays != null ? `${summary.averageQueueDays.toFixed(1)} dias` : '—'}
      icon={<Inbox size={18} strokeWidth={1.75} />}
      color={BrandColors.queue}
    />,
    <StatCard
      key="user"
      title="Aguardando usuário (médio)"
      subtitle="Tempo médio aguardando"
      value={summary.averageUserDays != null ? `${summary.averageUserDays.toFixed(1)} dias` : '—'}
      icon={<UserRound size={18} strokeWidth={1.75} />}
      color={BrandColors.user}
    />,
    <StatCard
      key="vendor"
      title="Aguardando fornecedor (médio)"
      subtitle="Tempo médio aguardando"
      value={summary.averageVendorDays != null ? `${summary.averageVendorDays.toFixed(1)} dias` : '—'}
      icon={<Truck size={18} strokeWidth={1.75} />}
      color={BrandColors.vendor}
    />,
  ];

  const qualityCards = [
    <StatCard
      key="flow"
      title="Eficiência de fluxo"
      subtitle="Tempo ativo ÷ tempo total"
      value={summary.flowEfficiencyPercent != null ? `${summary.flowEfficiencyPercent.toFixed(1)}%` : '—'}
      icon={<Zap size={18} strokeWidth={1.75} />}
      color={flowEfficiencyColor(summary.flowEfficiencyPercent)}
    />,
    <StatCard
      key="predict"
      title="Previsibilidade de prazo"
      subtitle={
        summary.completedWithDeadline.length === 0
          ? 'Nenhum item com prazo definido'
          : `${summary.onTimeCount} de ${summary.completedWithDeadline.length} (vs. prazo original)`
      }
      value={summary.predictabilityPercent != null ? `${summary.predictabilityPercent.toFixed(0)}%` : '—'}
      icon={<Calendar size={18} strokeWidth={1.75} />}
      color={predictabilityColor(summary.predictabilityPercent)}
    />,
    <StatCard
      key="delay"
      title="Atraso: analista vs. terceiros"
      subtitle={summary.lateCount === 0 ? 'Nenhum item atrasado' : `Analista / Terceiros (de ${summary.lateCount} atrasados)`}
      value={summary.lateCount === 0 ? '—' : `${summary.lateDueToAnalystCount} / ${summary.lateDueToExternalWaitCount}`}
      icon={<ArrowLeftRight size={18} strokeWidth={1.75} />}
      color={summary.lateCount === 0 ? '#64748B' : BrandColors.warning}
    />,
    <StatCard
      key="suspicious"
      title="Itens suspeitos"
      subtitle="Resolvido rápido demais / sem rastro"
      value={`${summary.suspiciousItems.length}`}
      icon={<Eye size={18} strokeWidth={1.75} />}
      color={summary.suspiciousItems.length === 0 ? BrandColors.user : BrandColors.danger}
    />,
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <StatGroup
        label="Cycle Time"
        cards={cycleTimeCards}
        header={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CYCLE_TIME_CATEGORIES.map((c) => (
              <ToggleChip
                key={c}
                label={cycleTimeLabel(c)}
                selected={selectedCycleTimeCategories.has(c)}
                onSelected={() => onToggleCycleTimeCategory(c)}
              />
            ))}
          </div>
        }
      />
      <StatGroup label="Volume & tempo por etapa" cards={volumeCards} />
      <StatGroup label="Qualidade & prazo" cards={qualityCards} />
    </div>
  );
}

const BOARD_COLUMN_COLORS = [
  BrandColors.developer,
  BrandColors.queue,
  BrandColors.user,
  BrandColors.vendor,
  BrandColors.general,
  BrandColors.triage,
  BrandColors.total,
  BrandColors.primary,
];
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Average days spent in each *actual* Kanban board column (not the
 * Triagem/Fila/Desenvolvedor/... groupings those columns get bucketed into
 * elsewhere) — every distinct column name found across `completed`, each
 * averaged over all of them (an item that never passed through a column
 * counts as 0 for it, same convention every other average here uses).
 * Capped at each item's own endDate, not "now", so a completed item's
 * column time doesn't keep accruing after it closed. */
function boardColumnAverages(completed: ItemMetric[]): { column: string; avgDays: number }[] {
  const columns = new Set<string>();
  for (const m of completed) {
    for (const c of m.item.boardColumnHistory) columns.add(c.state);
    if (m.item.currentBoardColumn.trim() !== '') columns.add(m.item.currentBoardColumn);
  }
  const rows = [...columns].map((column) => {
    const totalMs = completed.reduce((s, m) => s + m.item.durationInColumnsMs(new Set([column]), { until: m.endDate ?? undefined }), 0);
    return { column, avgDays: completed.length === 0 ? 0 : totalMs / MS_PER_DAY / completed.length };
  });
  rows.sort((a, b) => b.avgDays - a.avgDays);
  return rows;
}

/** Every real board column side by side, for whoever this Dashboard is
 * currently scoped to — so they can see at a glance where their own time
 * actually goes, at the granularity the board itself uses (not the 6-group
 * abstraction "Cycle Time é...") works with) — plus a Total (average
 * Backlog → Concluído, i.e. averageMetricDays over totalDays) so the
 * per-column figures have something to be read against: the columns alone
 * don't add up to the same number (backlog time before the first tracked
 * column, and any column outside every group, aren't captured by any one
 * of them). Deliberately fed a rolling-30-day summary, not the sprint-scoped
 * one everything else on this screen uses — right after a new sprint
 * starts there's barely anything closed yet, which would make this read as
 * near-empty for no real reason. */
function ColumnAverageCard({ summary, personName }: { summary: MetricsSummary; personName: string }) {
  const rows = boardColumnAverages(summary.completed);
  const avgTotal = summary.averageMetricDays((m) => m.totalDays);
  return (
    <div style={cardStyle()}>
      <div style={{ fontSize: 16, fontWeight: 'bold' }}>Tempo médio por coluna</div>
      <div style={{ height: 4 }} />
      <div style={{ fontSize: 12, color: '#64748B' }}>
        Média de dias de {personName} em cada coluna do board, nos últimos 30 dias (não só a sprint selecionada, pra sempre ter uma amostra
        boa mesmo no início dela).
      </div>
      <div style={{ height: 16 }} />
      {rows.length === 0 ? (
        <span style={{ fontSize: 13, color: '#64748B' }}>Sem itens concluídos nesse período.</span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <div style={{ minWidth: 96 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: BrandColors.total, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Total (Backlog → Concluído)</span>
            </div>
            <div style={{ height: 4 }} />
            <div style={{ fontSize: 22, fontWeight: 'bold', color: BrandColors.total }}>{avgTotal != null ? `${avgTotal.toFixed(1)}d` : '—'}</div>
          </div>
          <div style={{ width: 1, alignSelf: 'stretch', backgroundColor: BrandColors.border }} />
          {rows.map((r, i) => (
            <div key={r.column} style={{ minWidth: 96 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: BOARD_COLUMN_COLORS[i % BOARD_COLUMN_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#64748B' }}>{r.column}</span>
              </div>
              <div style={{ height: 4 }} />
              <div style={{ fontSize: 20, fontWeight: 'bold' }}>{r.avgDays.toFixed(1)}d</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Quanto tempo ele demora pra agir": average/median days a tagged item
 * spent sitting in queue before it was moved elsewhere. Only shown when
 * looking at settings.myDisplayName — for anyone else there's no tag
 * mechanism in play, and there's no separate "which mode am I in" anymore. */
function TaggedQueueSection({
  selectedSpecificPerson,
  settings,
  groupSummary,
}: {
  selectedSpecificPerson: string | null;
  settings: AppSettings;
  groupSummary: MetricsSummary;
}) {
  if (selectedSpecificPerson?.trim().toLowerCase() !== settings.myDisplayName.trim().toLowerCase()) return null;
  // Items carrying tagFilter that have already left the queue columns —
  // moved somewhere else, whether or not they're done yet.
  const pickups = groupSummary.metrics
    .filter((m) => m.queueDurationMs > 0)
    .filter((m) => !boardColumnMatches(settings.queueColumnSet, m.item.currentBoardColumn));
  const days = pickups.map((m) => m.queueDays).sort((a, b) => a - b);

  let avg: number | null = null;
  let median: number | null = null;
  if (days.length > 0) {
    avg = days.reduce((a, b) => a + b, 0) / days.length;
    const mid = Math.floor(days.length / 2);
    median = days.length % 2 === 0 ? (days[mid - 1] + days[mid]) / 2 : days[mid];
  }

  const countLabel = `${pickups.length} ${pickups.length === 1 ? 'item saiu' : 'itens saíram'} da fila`;
  const cards = [
    <StatCard
      key="avg"
      title="Demora média p/ pegar"
      subtitle={countLabel}
      value={avg != null ? `${avg.toFixed(1)} dias` : '—'}
      icon={<PauseCircle size={18} strokeWidth={1.75} />}
      color={BrandColors.queue}
    />,
    <StatCard
      key="median"
      title="Mediana"
      subtitle="Menos sensível a itens fora da curva"
      value={median != null ? `${median.toFixed(1)} dias` : '—'}
      icon={<TrendingUp size={18} strokeWidth={1.75} />}
      color={BrandColors.queue}
    />,
  ];

  return (
    <div style={{ marginBottom: 20 }}>
      <StatGroup label={`Fila com a tag "${settings.tagFilter}" — tempo até ser pego`} cards={cards} />
    </div>
  );
}

function ChartCard({ title, footnote, trailing, children }: { title: string; footnote?: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <div style={cardStyle()}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 'bold' }}>{title}</div>
        {trailing}
      </div>
      <div style={{ height: 16 }} />
      {children}
      {footnote && (
        <>
          <div style={{ height: 8 }} />
          <div style={{ fontSize: 11, color: '#94A3B8' }}>{footnote}</div>
        </>
      )}
    </div>
  );
}

function ChartsRow({ summary, onSeeDetails }: { summary: MetricsSummary; onSeeDetails: () => void }) {
  const categories: { name: string; value: number; color: string }[] = [
    { name: 'Triagem', value: summary.averageTriageDays ?? 0, color: BrandColors.triage },
    { name: 'Fila', value: summary.averageQueueDays ?? 0, color: BrandColors.queue },
    { name: 'Desenvolvedor', value: summary.averageCycleTimeDays ?? 0, color: BrandColors.developer },
    { name: 'Usuário', value: summary.averageUserDays ?? 0, color: BrandColors.user },
    { name: 'Fornecedor', value: summary.averageVendorDays ?? 0, color: BrandColors.vendor },
    { name: 'Geral', value: summary.averageGeneralDays ?? 0, color: BrandColors.general },
  ];

  const totals = [
    { name: 'Desenvolvedor', value: summary.completed.reduce((s, m) => s + m.cycleTimeDays, 0), color: BrandColors.developer },
    { name: 'Triagem', value: summary.completed.reduce((s, m) => s + m.triageDays, 0), color: BrandColors.triage },
    { name: 'Fila', value: summary.completed.reduce((s, m) => s + m.queueDays, 0), color: BrandColors.queue },
    { name: 'Geral', value: summary.completed.reduce((s, m) => s + m.generalDays, 0), color: BrandColors.general },
    { name: 'Usuário', value: summary.completed.reduce((s, m) => s + m.userDays, 0), color: BrandColors.user },
    { name: 'Fornecedor', value: summary.completed.reduce((s, m) => s + m.vendorDays, 0), color: BrandColors.vendor },
  ].sort((a, b) => b.value - a.value);
  const grandTotal = totals.reduce((s, t) => s + t.value, 0);
  const nonZeroTotals = totals.filter((t) => t.value > 0);

  const barChart = (
    <ChartCard title="Tempo médio por agrupamento" footnote='* Considera apenas itens concluídos na sprint selecionada.'>
      {summary.completed.length === 0 ? (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Sem dados concluídos nesse filtro.
        </div>
      ) : (
        <div style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={categories}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {categories.map((c, i) => (
                  <Cell key={i} fill={c.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );

  const donutChart = (
    <ChartCard
      title="Distribuição do tempo (itens concluídos)"
      trailing={
        <button onClick={onSeeDetails} style={{ background: 'none', border: 'none', cursor: 'pointer', color: BrandColors.primary, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
          Ver detalhes <ArrowRight size={13} strokeWidth={2} />
        </button>
      }
    >
      {grandTotal <= 0 ? (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sem dados concluídos.</div>
      ) : (
        <div style={{ height: 220, display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 160, height: 160, position: 'relative' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={nonZeroTotals} dataKey="value" nameKey="name" innerRadius={44} outerRadius={78} paddingAngle={2}>
                  {nonZeroTotals.map((t, i) => (
                    <Cell key={i} fill={t.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <span style={{ fontWeight: 'bold', fontSize: 18 }}>100%</span>
              <span style={{ fontSize: 12, color: '#94A3B8' }}>Total</span>
            </div>
          </div>
          <div style={{ width: 16 }} />
          <div style={{ flex: 1 }}>
            {nonZeroTotals.map((t) => {
              const pct = (t.value / grandTotal) * 100;
              return (
                <div key={t.name} style={{ display: 'flex', alignItems: 'center', padding: '3px 0' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: t.color }} />
                  <div style={{ width: 8 }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{t.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </ChartCard>
  );

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 400px', minWidth: 320 }}>{barChart}</div>
      <div style={{ flex: '1 1 400px', minWidth: 320 }}>{donutChart}</div>
    </div>
  );
}

function PillGroup<T extends string>({
  options,
  selected,
  onChanged,
}: {
  options: { value: T; label: string; icon: ReactNode }[];
  selected: T;
  onChanged: (v: T) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const isSelected = o.value === selected;
        return (
          <button
            key={o.value}
            onClick={() => onChanged(o.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 14px',
              borderRadius: 999,
              border: `1px solid ${isSelected ? BrandColors.primary : BrandColors.border}`,
              backgroundColor: isSelected ? BrandColors.selectedBg : '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: isSelected ? 600 : 400,
              color: isSelected ? BrandColors.primaryDark : '#475569',
            }}
          >
            <span style={{ display: 'flex' }}>{o.icon}</span>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function BreakdownSection({
  summary,
  selectedBreakdown,
  setSelectedBreakdown,
  selectedCycleTimeCategories,
}: {
  summary: MetricsSummary;
  selectedBreakdown: BreakdownDimension;
  setSelectedBreakdown: (v: BreakdownDimension) => void;
  selectedCycleTimeCategories: Set<CycleTimeCategory>;
}) {
  let keyOf: (i: WorkItem) => string;
  let unitLabel: string;
  switch (selectedBreakdown) {
    case 'complexity':
      keyOf = (i) => i.complexity;
      unitLabel = 'Complexidade';
      break;
    case 'department':
      keyOf = (i) => i.department;
      unitLabel = 'Setor';
      break;
    case 'priority':
      keyOf = (i) => (i.priority != null ? `P${i.priority}` : '');
      unitLabel = 'Prioridade';
      break;
    case 'requestType':
      keyOf = (i) => i.requestType;
      unitLabel = 'Tipo de demanda';
      break;
  }
  const rows = groupBreakdown(summary.completed, keyOf, (m) => cycleTimeSelectMulti(selectedCycleTimeCategories, m));
  const metricLabel = `${cycleTimeCombinedLabel(selectedCycleTimeCategories)} médio`;

  return (
    <div style={cardStyle()}>
      <div style={{ fontSize: 16, fontWeight: 'bold', color: BrandColors.developer }}>
        Cruzamento por Complexidade / Setor / Prioridade / Tipo de demanda
      </div>
      <div style={{ height: 4 }} />
      <div style={{ fontSize: 12, color: '#64748B' }}>
        Itens concluídos na sprint selecionada, ordenados do maior "{metricLabel}" para o menor. Métrica de tempo controlada pelo seletor
        "Cycle Time é..." acima.
      </div>
      <div style={{ height: 12 }} />
      <PillGroup
        selected={selectedBreakdown}
        onChanged={setSelectedBreakdown}
        options={[
          { value: 'complexity', label: 'Complexidade', icon: <Zap size={14} strokeWidth={2} /> },
          { value: 'department', label: 'Setor', icon: <Building2 size={14} strokeWidth={2} /> },
          { value: 'priority', label: 'Prioridade', icon: <Flag size={14} strokeWidth={2} /> },
          { value: 'requestType', label: 'Tipo de demanda', icon: <TagIcon size={14} strokeWidth={2} /> },
        ]}
      />
      <div style={{ height: 12 }} />
      {rows.length === 0 ? (
        <span>Nenhum item concluído com "{unitLabel}" preenchido nesse filtro.</span>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle()}>
            <thead>
              <tr>
                <Th>{unitLabel}</Th>
                <Th numeric>Qtd</Th>
                <Th numeric>{metricLabel}</Th>
                <Th numeric>Total médio</Th>
                <Th numeric>% atrasado</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <Td>{r.label}</Td>
                  <Td numeric>{r.count}</Td>
                  <Td numeric>
                    <span style={{ fontWeight: 'bold', color: cycleTimeCombinedColor(selectedCycleTimeCategories) }}>
                      {r.avgMetricDays != null ? `${r.avgMetricDays.toFixed(1)} dias` : '—'}
                    </span>
                  </Td>
                  <Td numeric>
                    <span style={{ color: BrandColors.total }}>{r.avgTotalDays != null ? `${r.avgTotalDays.toFixed(1)} dias` : '—'}</span>
                  </Td>
                  <Td numeric>
                    <span style={{ color: predictabilityColor(r.latePercent == null ? null : 100 - r.latePercent) }}>
                      {r.latePercent != null ? `${r.latePercent.toFixed(0)}% (${r.lateCount}/${r.withDeadlineCount})` : '—'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function tableStyle(): React.CSSProperties {
  return { borderCollapse: 'collapse', width: '100%', fontSize: 13 };
}
function Th({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <th
      style={{
        textAlign: numeric ? 'right' : 'left',
        padding: '8px 12px',
        borderBottom: `1px solid ${BrandColors.border}`,
        backgroundColor: BrandColors.tableHeader,
        fontSize: 12,
        color: '#64748B',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}
function Td({ children, numeric }: { children: ReactNode; numeric?: boolean }) {
  return (
    <td style={{ textAlign: numeric ? 'right' : 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, whiteSpace: 'nowrap' }}>
      {children}
    </td>
  );
}

function ColoredTag({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        backgroundColor: hexAlpha(color, 0.12),
        border: `1px solid ${hexAlpha(color, 0.4)}`,
        fontSize: 11,
        fontWeight: 600,
        color,
      }}
    >
      {label === '' ? '—' : label}
    </span>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 1).toUpperCase();
  return (parts[0].substring(0, 1) + parts[parts.length - 1].substring(0, 1)).toUpperCase();
}

function ResponsibleTag({ name }: { name: string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          backgroundColor: BrandColors.primaryLightBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 'bold',
          color: BrandColors.primaryDark,
          flexShrink: 0,
        }}
      >
        {initialsOf(name)}
      </div>
      <span style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name === '' ? '—' : name}</span>
    </div>
  );
}

function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span>—</span>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            backgroundColor: BrandColors.primaryLightBg,
            border: `1px solid ${hexAlpha(BrandColors.primary, 0.3)}`,
            fontSize: 11,
            fontWeight: 600,
            color: BrandColors.primaryDark,
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function AgingSection({
  aging,
  applySort,
  showAllAging,
  setShowAllAging,
  categoryColorFor,
  onSelectItem,
}: {
  aging: ItemMetric[];
  applySort: (list: ItemMetric[]) => ItemMetric[];
  showAllAging: boolean;
  setShowAllAging: (v: boolean | ((v: boolean) => boolean)) => void;
  categoryColorFor: (col: string) => string;
  onSelectItem: (m: ItemMetric) => void;
}) {
  const sorted = applySort(aging);
  const visible = showAllAging ? sorted : sorted.slice(0, 5);
  return (
    <div style={cardStyle()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16, fontWeight: 'bold', color: BrandColors.developer }}>Itens em aberto</span>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            backgroundColor: BrandColors.primaryLightBg,
            fontSize: 12,
            fontWeight: 'bold',
            color: BrandColors.primaryDark,
          }}
        >
          {aging.length}
        </span>
        <div style={{ flex: 1 }} />
        {aging.length > 5 && (
          <button onClick={() => setShowAllAging((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: BrandColors.primary, fontWeight: 600 }}>
            {showAllAging ? 'Ver menos' : 'Ver todos'}
          </button>
        )}
      </div>
      <div style={{ height: 4 }} />
      <div style={{ fontSize: 12, color: '#64748B' }}>
        Fora da Triagem, em qualquer outra coluna, do mais antigo para o mais novo — mostrado sempre, independente da sprint selecionada. Itens
        em Triagem aparecem na seção própria abaixo. Clique num item para ver o tempo por agrupamento.
      </div>
      <div style={{ height: 12 }} />
      {aging.length === 0 ? <span>Nenhum item em aberto no momento.</span> : <SimpleTable items={visible} showFim={false} categoryColorFor={categoryColorFor} onSelectItem={onSelectItem} />}
    </div>
  );
}

function TriageSection({
  triage,
  applySort,
  expanded,
  setExpanded,
  onSelectItem,
}: {
  triage: ItemMetric[];
  applySort: (list: ItemMetric[]) => ItemMetric[];
  expanded: boolean;
  setExpanded: (v: boolean | ((v: boolean) => boolean)) => void;
  onSelectItem: (m: ItemMetric) => void;
}) {
  const sorted = applySort(triage);
  return (
    <div style={cardStyle()}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setExpanded((v) => !v)}>
        <span style={{ fontSize: 16, fontWeight: 'bold', color: BrandColors.triage }}>Em Triagem</span>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            backgroundColor: hexAlpha(BrandColors.triage, 0.12),
            fontSize: 12,
            fontWeight: 'bold',
            color: BrandColors.triage,
          }}
        >
          {triage.length}
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: '#64748B' }}>{expanded ? '▲' : '▼'}</span>
      </div>
      <div style={{ fontSize: 12, color: '#64748B' }}>Não contam em "Itens em aberto" — clique para expandir.</div>
      {expanded && (
        <>
          <div style={{ height: 12 }} />
          {triage.length === 0 ? (
            <span>Nenhum item em Triagem no momento.</span>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tableStyle()}>
                <thead>
                  <tr>
                    <Th>ID</Th>
                    <Th>Título</Th>
                    <Th>Responsável</Th>
                    <Th>Tags</Th>
                    <Th>Criado em</Th>
                    <Th numeric>Tempo em Triagem</Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((m) => (
                    <tr key={m.item.id} onClick={() => onSelectItem(m)} style={{ cursor: 'pointer' }}>
                      <Td>{m.item.id}</Td>
                      <Td>
                        <span style={{ display: 'inline-block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.item.title}
                        </span>
                      </Td>
                      <Td>
                        <ResponsibleTag name={m.item.assignedTo} />
                      </Td>
                      <Td>
                        <TagChips tags={m.item.tags} />
                      </Td>
                      <Td>{formatDate(m.item.createdDate)}</Td>
                      <Td numeric>
                        <span style={{ fontWeight: 'bold', color: BrandColors.triage }}>{m.triageDays.toFixed(1)} dias</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CompletedTable({
  summary,
  applySort,
  categoryColorFor,
  onSelectItem,
  ref,
}: {
  summary: MetricsSummary;
  applySort: (list: ItemMetric[]) => ItemMetric[];
  categoryColorFor: (col: string) => string;
  onSelectItem: (m: ItemMetric) => void;
  ref: React.Ref<HTMLDivElement>;
}) {
  const completed = [...summary.completed].sort((a, b) => (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0));
  if (completed.length === 0) return null;
  return (
    <div ref={ref} style={cardStyle()}>
      <div style={{ fontSize: 16, fontWeight: 'bold', color: BrandColors.developer }}>Itens concluídos</div>
      <div style={{ height: 4 }} />
      <div style={{ fontSize: 12, color: '#64748B' }}>Clique num item para ver o tempo por agrupamento.</div>
      <div style={{ height: 12 }} />
      <SimpleTable items={applySort(completed)} showFim categoryColorFor={categoryColorFor} onSelectItem={onSelectItem} />
    </div>
  );
}

/** Compact table shared by both sections: just enough to scan the list.
 * Click a row to see the full per-category breakdown in a dialog. */
function SimpleTable({
  items,
  showFim,
  categoryColorFor,
  onSelectItem,
}: {
  items: ItemMetric[];
  showFim: boolean;
  categoryColorFor: (col: string) => string;
  onSelectItem: (m: ItemMetric) => void;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Título</Th>
            <Th>Responsável</Th>
            <Th>Tags</Th>
            <Th>Criado em</Th>
            <Th>Início Dev</Th>
            {showFim && <Th>Fim</Th>}
            {showFim && <Th>Prazo</Th>}
            <Th>Coluna atual</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((m) => {
            const columnColor = categoryColorFor(m.item.currentBoardColumn);
            return (
              <tr key={m.item.id} onClick={() => onSelectItem(m)} style={{ cursor: 'pointer' }}>
                <Td>{m.item.id}</Td>
                <Td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, maxWidth: 260 }}>
                    {m.isSuspicious && (
                      <span title={m.isSuspiciouslyFast ? 'Resolvido em menos de 4h — pode ser legítimo (chamado simples) ou fechado sem trabalho real' : 'Boa parte do tempo desse item não está em nenhuma coluna rastreada'} style={{ color: BrandColors.danger, display: 'flex' }}>
                        <Eye size={13} strokeWidth={2} />
                      </span>
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.item.title}</span>
                  </div>
                </Td>
                <Td>
                  <ResponsibleTag name={m.item.assignedTo} />
                </Td>
                <Td>
                  <TagChips tags={m.item.tags} />
                </Td>
                <Td>{formatDate(m.item.createdDate)}</Td>
                <Td>{m.startDate != null ? formatDate(m.startDate) : '—'}</Td>
                {showFim && <Td>{m.endDate != null ? formatDate(m.endDate) : '—'}</Td>}
                {showFim && (
                  <Td>
                    {m.isOnTime == null ? (
                      '—'
                    ) : (
                      <ColoredTag label={m.isOnTime ? 'No prazo' : 'Atrasado'} color={m.isOnTime ? BrandColors.user : BrandColors.danger} />
                    )}
                  </Td>
                )}
                <Td>
                  <ColoredTag label={m.item.currentBoardColumn} color={columnColor} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InfoChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '6px 10px', borderRadius: 8, backgroundColor: hexAlpha(color ?? '#64748B', 0.08) }}>
      <div style={{ fontSize: 10, color: '#94A3B8' }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 'bold', color: color ?? '#334155' }}>{value}</div>
    </div>
  );
}

/** Full per-category breakdown for one item, shown when you click its row. */
function ItemDetailDialog({
  metric,
  columnColor,
  openedSprintNumber,
  timeInCurrentColumn,
  onClose,
}: {
  metric: ItemMetric;
  columnColor: string;
  openedSprintNumber: number;
  timeInCurrentColumn: number;
  onClose: () => void;
}) {
  const item = metric.item;
  const rows: { label: string; value: number; color: string }[] = [
    { label: 'Triagem', value: metric.triageDays, color: BrandColors.triage },
    { label: 'Fila', value: metric.queueDays, color: BrandColors.queue },
    { label: 'Desenvolvedor', value: metric.cycleTimeDays, color: BrandColors.developer },
    { label: 'Usuário', value: metric.userDays, color: BrandColors.user },
    { label: 'Fornecedor', value: metric.vendorDays, color: BrandColors.vendor },
    { label: 'Geral', value: metric.generalDays, color: BrandColors.general },
    { label: 'Total (backlog → concluído/agora)', value: metric.totalDays, color: BrandColors.total },
  ];

  const isLate = item.isLate(metric.endDate ?? new Date());
  const chips: ReactNode[] = [];
  if (item.department) chips.push(<InfoChip key="dept" label="Departamento" value={item.department} />);
  if (item.requestType) chips.push(<InfoChip key="req" label="Tipo de solicitação" value={item.requestType} />);
  if (item.complexity) chips.push(<InfoChip key="cx" label="Complexidade" value={item.complexity} />);
  if (item.priority != null) chips.push(<InfoChip key="pri" label="Prioridade" value={`P${item.priority}`} />);
  if (item.requesterName) chips.push(<InfoChip key="req2" label="Solicitante" value={item.requesterName} />);
  if (item.areaPath) chips.push(<InfoChip key="area" label="Área" value={item.areaPath.split('\\').pop() ?? item.areaPath} />);
  if (item.originalTargetDate) chips.push(<InfoChip key="orig" label="Prazo original" value={formatDate(item.originalTargetDate)} />);
  if (item.deadlineChangeCount > 0)
    chips.push(<InfoChip key="chg" label="Prazo alterado" value={`${item.deadlineChangeCount}x`} color={BrandColors.warning} />);
  if (item.targetDate != null && item.deadlineChangeCount > 0 && item.targetDate.getTime() !== item.originalTargetDate?.getTime())
    chips.push(<InfoChip key="revised" label="Prazo atual (revisado)" value={formatDate(item.targetDate)} />);
  if (isLate != null)
    chips.push(
      <InfoChip
        key="late"
        label="Prazo"
        value={isLate ? 'Atrasado (vs. original)' : 'No prazo (vs. original)'}
        color={isLate ? BrandColors.danger : BrandColors.user}
      />,
    );
  if (metric.isDelayAttributableToAnalyst != null)
    chips.push(
      <InfoChip
        key="cause"
        label="Causa do atraso"
        value={metric.isDelayAttributableToAnalyst ? 'Próprio fluxo (Geral)' : 'Espera por terceiros'}
        color={metric.isDelayAttributableToAnalyst ? BrandColors.danger : BrandColors.warning}
      />,
    );
  chips.push(
    <InfoChip key="flow" label="Eficiência de fluxo" value={`${metric.flowEfficiencyPercent.toFixed(1)}%`} color={flowEfficiencyColor(metric.flowEfficiencyPercent)} />,
  );
  if (metric.isSuspiciouslyFast) chips.push(<InfoChip key="fast" label="Atenção" value="Resolvido em <4h" color={BrandColors.danger} />);
  if (metric.hasUntrackedGap)
    chips.push(<InfoChip key="gap" label="Atenção" value={`${metric.untrackedGapPercent.toFixed(0)}% do tempo sem rastro`} color={BrandColors.danger} />);

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: '#fff', borderRadius: 12, maxWidth: 480, width: '90%', maxHeight: '85vh', overflowY: 'auto', padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, fontWeight: 'bold', fontSize: 16 }}>{item.title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#64748B' }}>
          #{item.id} • {item.type} • {item.assignedTo}
        </div>
        <div style={{ height: 4 }} />
        {item.tags.length > 0 && <TagChips tags={item.tags} />}
        <div style={{ height: 16 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ColoredTag label={item.currentBoardColumn} color={columnColor} />
          <span style={{ fontSize: 12, color: '#64748B' }}>{timeInCurrentColumn.toFixed(1)} dias na coluna atual</span>
        </div>
        <div style={{ height: 4 }} />
        <div style={{ fontSize: 12, color: '#64748B' }}>
          Criado em: {formatDate(item.createdDate)} • Aberto na sprint {openedSprintNumber} • Início dev:{' '}
          {metric.startDate != null ? formatDate(metric.startDate) : '—'} • Fim: {metric.endDate != null ? formatDate(metric.endDate) : 'em aberto'}
        </div>
        <div style={{ height: 16 }} />
        {chips.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{chips}</div>}
        <div style={{ height: 20 }} />
        <div style={{ fontWeight: 'bold', fontSize: 13 }}>Tempo por agrupamento</div>
        <div style={{ height: 8 }} />
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', padding: '5px 0' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: r.color }} />
            <div style={{ width: 10 }} />
            <span style={{ flex: 1, fontSize: 13 }}>{r.label}</span>
            <span style={{ fontWeight: 'bold', color: r.color, fontSize: 13 }}>{r.value.toFixed(1)} dias</span>
          </div>
        ))}
      </div>
    </div>
  );
}
