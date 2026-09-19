import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { boardColumnMatches, WorkItem } from '../models/workItem';
import { ItemMetric, MetricsCalculator } from '../services/metricsService';
import { AppSettings } from '../services/settingsService';
import { Sprint } from '../services/sprintService';
import {
  attributedGroupBy,
  buildHealthScoreRanking,
  buildPerformanceRanking,
  defaultPerformanceGroupKeys,
  HealthScoreRanking,
  performanceGroups,
  ResponsiblePerformance,
  sprintCutoff,
} from '../services/sprintSnapshotService';
import { BrandColors } from '../theme';
import { FilterBox, ToggleChip } from '../components/ToggleChip';
import {
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  EyeOff,
  HeartPulse,
  Hourglass,
  Inbox,
  LayoutList,
  MousePointerClick,
  Trophy,
  Truck,
  UserRound,
  X,
  Zap,
} from 'lucide-react';

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Same 80/50 thresholds used elsewhere in the app for on-time delivery. */
function predictabilityColor(pct: number): string {
  if (pct >= 80) return BrandColors.user;
  if (pct >= 50) return BrandColors.queue;
  return BrandColors.danger;
}

/** Consistent soft-elevation look shared by every card on this screen — a
 * hairline border plus a barely-there shadow. */
function cardStyle(highlighted = false): React.CSSProperties {
  return {
    backgroundColor: highlighted ? BrandColors.primaryLightBg : '#fff',
    borderRadius: 14,
    border: `${highlighted ? 1.5 : 1}px solid ${highlighted ? BrandColors.primary : BrandColors.border}`,
    boxShadow: '0 2px 12px rgba(15,23,42,0.04)',
  };
}

function areaLeaf(areaPath: string): string {
  const trimmed = areaPath.trim();
  if (trimmed === '') return 'Sem área';
  return trimmed.split('\\').pop() ?? trimmed;
}

function hasUsableColumn(item: WorkItem): boolean {
  const c = item.currentBoardColumn.trim();
  return c !== '' && c !== '-';
}

function createdInSprintLocal(item: WorkItem, sprint: Sprint | null): boolean {
  if (sprint == null) return true;
  const d = item.createdDate;
  const rangeEnd = new Date(sprint.end.getTime() + 24 * 60 * 60 * 1000);
  return d.getTime() >= sprint.start.getTime() && d.getTime() <= rangeEnd.getTime();
}

function endedInSprintLocal(m: ItemMetric, sprint: Sprint | null): boolean {
  if (!m.done) return false;
  if (sprint == null) return true;
  const end = m.endDate;
  if (end == null) return false;
  const rangeEnd = new Date(sprint.end.getTime() + 24 * 60 * 60 * 1000);
  return end.getTime() >= sprint.start.getTime() && end.getTime() <= rangeEnd.getTime();
}

/** Whether `m` was already in flight when `sprint` began — created before
 * the sprint's start and not yet done by then. This is what makes "Entraram"
 * carry forward: a card left open at one sprint's "Saída" is exactly what
 * shows up here as carry-over on the next. */
function carriedIntoSprintLocal(m: ItemMetric, sprint: Sprint | null): boolean {
  if (sprint == null) return false;
  if (m.item.createdDate.getTime() >= sprint.start.getTime()) return false;
  if (!m.done) return true;
  const end = m.endDate;
  return end == null || end.getTime() >= sprint.start.getTime();
}

interface SuspiciousRanking {
  name: string;
  completed: number;
  suspicious: number;
  items: ItemMetric[];
}
interface PredictabilityRanking {
  name: string;
  withDeadline: number;
  onTime: number;
  totalClosed: number;
  items: ItemMetric[];
  allClosedItems: ItemMetric[];
}
interface CycleTimeRanking {
  name: string;
  median: number;
  average: number;
  p85: number;
  count: number;
  stageLabel?: string;
  items: ItemMetric[];
}
interface WaitRanking {
  name: string;
  count: number;
  totalDays: number;
  items: ItemMetric[];
}
interface TagRankingRow {
  name: string;
  entered: number;
  enteredItems: ItemMetric[];
  closed: number;
  closedItems: ItemMetric[];
  conversion: number | null;
  devAvg: number | null;
  devItems: ItemMetric[];
  devDaysOf: (m: ItemMetric) => number;
  queueAvg: number | null;
  queueItems: ItemMetric[];
}

/** Aging bucket definitions, aligned to the team's ~14-day sprint cycle
 * instead of a generic 7/30/90-day scale. */
interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
}
const AGING_BUCKETS: AgingBucket[] = [
  { label: '0-14 dias (< 1 sprint)', minDays: 0, maxDays: 14 },
  { label: '14-28 dias (1-2 sprints)', minDays: 14, maxDays: 28 },
  { label: '28-42 dias (2-3 sprints)', minDays: 28, maxDays: 42 },
  { label: '42+ dias (3+ sprints)', minDays: 42, maxDays: null },
];
function bucketMatches(bucket: AgingBucket, days: number): boolean {
  return days >= bucket.minDays && (bucket.maxDays == null || days < bucket.maxDays);
}

function groupBy<T>(list: T[], keyOf: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) {
    const k = keyOf(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(item);
  }
  return map;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function percentile85(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(Math.max(Math.round(0.85 * (sorted.length - 1)), 0), sorted.length - 1);
  return sorted[idx];
}

interface AreaStats {
  entered: number;
  closed: number;
  stillOpen: number;
  conversion: number | null;
  generalDays: number | null;
}

/** The 5 headline numbers behind every comparison tile (área/setor/tipo de
 * demanda) and the top KPI strip — computed once here so all of them stay
 * perfectly consistent instead of each widget recomputing its own version. */
function computeAreaStats(metrics: ItemMetric[], sprint: Sprint | null): AreaStats {
  const newThisSprint = metrics.filter((m) => createdInSprintLocal(m.item, sprint));
  const carriedOver = metrics.filter((m) => carriedIntoSprintLocal(m, sprint));
  const entered = [...newThisSprint, ...carriedOver];
  const closed = metrics.filter((m) => endedInSprintLocal(m, sprint));
  const stillOpen = entered.filter((m) => !m.done).length;
  const conversion = entered.length === 0 ? null : (closed.length / entered.length) * 100;
  const generalDays = closed.length === 0 ? null : closed.reduce((s, m) => s + m.generalDays, 0) / closed.length;
  return { entered: entered.length, closed: closed.length, stillOpen, conversion, generalDays };
}

/** Whole-team view: every responsible, every area, together — aggregated
 * and ranked, never a raw item-by-item list (that's what the per-person
 * Dashboard tab is for). Mirrors the shape of the sprint retrospective
 * deck: area comparison, rankings, aging distribution, and the handful of
 * "waiting on someone else" lists that are worth watching as a team. */
export function TeamDashboardScreen({
  settings,
  items,
  loading,
  error,
  selectedSprint,
  sprints,
  onSprintChanged,
  onTabChange,
}: {
  settings: AppSettings;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  selectedSprint: Sprint | null;
  sprints: Sprint[];
  onSprintChanged: (s: Sprint | null) => void;
  // Lets the shell scroll its content area back to the top — this screen's
  // own tabs (Ranking/WIP/Sofrimento) render into that same shared
  // scrollable div, so switching between them needs the same reset a full
  // screen change gets.
  onTabChange?: () => void;
}) {
  const preferredAreaOrder = ['Sustentação', 'Dados'];
  const [tab, setTab] = useState<0 | 1 | 2>(0);
  // This screen scrolls internally (its own `overflow: auto` body below the
  // fixed header/tab bar) rather than through the shell's shared content
  // div, so resetting the shell's scroll on tab change doesn't reach it —
  // it needs its own ref reset too.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo(0, 0);
    onTabChange?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set(defaultPerformanceGroupKeys));
  const [discountedRequestTypes, setDiscountedRequestTypes] = useState<Set<string>>(new Set());
  const [discountSuspicious, setDiscountSuspicious] = useState(false);
  const [breakdownDialog, setBreakdownDialog] = useState<{ label: string; metrics: ItemMetric[] } | null>(null);
  const [personDialog, setPersonDialog] = useState<{
    name: string;
    metrics: ItemMetric[];
    extraColumn?: { label: string; render: (m: ItemMetric) => ReactNode };
    sortMode?: 'doneFirst' | 'createdAsc';
    projectOf?: (m: ItemMetric) => WorkItem | null;
  } | null>(null);
  const [perfDialog, setPerfDialog] = useState<ResponsiblePerformance | null>(null);
  const [healthDetailRow, setHealthDetailRow] = useState<HealthScoreRanking | null>(null);
  const [tagDetailRow, setTagDetailRow] = useState<TagRankingRow | null>(null);

  const asOf = selectedSprint == null ? undefined : sprintCutoff(selectedSprint);

  const rawMetrics = (() => {
    const calculator = new MetricsCalculator({
      triageColumns: settings.triageColumnSet,
      queueColumns: settings.queueColumnSet,
      developerColumns: settings.developerColumnSet,
      userColumns: settings.userColumnSet,
      vendorColumns: settings.vendorColumnSet,
      generalColumns: settings.generalColumnSet,
      doneColumn: settings.doneColumn,
      doneStates: settings.doneStateSet,
    });
    // Only User Story cards — Bugs, Tasks and Features are other kinds of
    // work item, not the day-to-day demand this view is meant to track.
    const valid = items.filter((i) => !i.isCancelled).filter((i) => i.type.trim().toLowerCase() === 'user story');
    return calculator.calculate(valid, asOf).metrics;
  })();

  // Every ranking/table on this screen is scoped to this — an item only
  // belongs to the selected sprint if it entered during it (created then,
  // or already open and carried in from an earlier one) or closed during
  // it.
  const allMetrics =
    selectedSprint == null
      ? rawMetrics
      : rawMetrics.filter(
          (m) => createdInSprintLocal(m.item, selectedSprint) || carriedIntoSprintLocal(m, selectedSprint) || endedInSprintLocal(m, selectedSprint),
        );

  const sprintScopedItems = allMetrics.map((m) => m.item);

  // Open items, excluding Triagem (never counted as "aberto" per the
  // app-wide rule) and items sitting on an unusable/empty board column.
  const openNonTriageMetrics = allMetrics.filter(
    (m) => !m.done && hasUsableColumn(m.item) && !boardColumnMatches(settings.triageColumnSet, m.item.currentBoardColumn),
  );

  const areaCardMetrics = allMetrics.filter((m) => m.done || !boardColumnMatches(settings.triageColumnSet, m.item.currentBoardColumn));

  function groupByArea(metrics: ItemMetric[]) {
    return groupBy(metrics, (m) => areaLeaf(m.item.areaPath));
  }
  function groupByDepartment(metrics: ItemMetric[]) {
    return groupBy(metrics, (m) => (m.item.department.trim() === '' ? 'Sem setor' : m.item.department.trim()));
  }
  function groupByRequestType(metrics: ItemMetric[]) {
    return groupBy(metrics, (m) => (m.item.requestType.trim() === '' ? 'Sem tipo' : m.item.requestType.trim()));
  }
  function groupByComplexity(metrics: ItemMetric[]) {
    return groupBy(metrics, (m) => (m.item.complexity.trim() === '' ? 'Sem complexidade' : m.item.complexity.trim()));
  }
  function groupByPriority(metrics: ItemMetric[]) {
    return groupBy(metrics, (m) => (m.item.priority == null ? 'Sem prioridade' : `Prioridade ${m.item.priority}`));
  }
  function orderedAreas(areas: Iterable<string>): string[] {
    const list = [...areas];
    list.sort((a, b) => {
      const ia = preferredAreaOrder.indexOf(a);
      const ib = preferredAreaOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    return list;
  }

  const performanceRanking = (() => {
    const rows = buildPerformanceRanking({ items: sprintScopedItems, settings, selectedGroupKeys: selectedGroups, asOf });
    rows.sort((a, b) => (b.percent !== a.percent ? b.percent - a.percent : b.base - a.base));
    return rows;
  })();

  // Every Tipo de solicitação seen in this sprint's data — the checklist
  // used to decide which types don't count at full weight toward
  // "Concluídos líquidos".
  const requestTypes = [...new Set(allMetrics.map((m) => m.item.requestType.trim()).filter((t) => t))].sort();

  function isDiscounted(m: ItemMetric): boolean {
    return (discountSuspicious && m.isSuspicious) || discountedRequestTypes.has(m.item.requestType.trim());
  }
  function netClosed(p: ResponsiblePerformance): number {
    return p.items.filter((m) => m.done && !isDiscounted(m)).length;
  }

  // WIP: how many items each person currently has open, period — not scoped
  // to the selected sprint (a card sitting open for 3 sprints straight is
  // exactly the kind of thing WIP is meant to surface, and hiding it behind
  // the sprint filter would defeat the point). Built from rawMetrics, not
  // allMetrics.
  // attributedGroupBy: for Guilherme specifically, this also folds in open
  // items tagged for him but assigned elsewhere — as long as that card is
  // currently sitting in Desenvolvedor. A tagged card still stuck in
  // Triagem/Fila/Usuário/Fornecedor isn't his WIP yet, same rule as
  // everywhere else this merge applies.
  const wipRanking: WaitRanking[] = (() => {
    const byName = attributedGroupBy(
      rawMetrics.filter((m) => !m.done),
      settings,
    );
    const rows = [...byName.entries()].map(([name, list]) => ({ name, count: list.length, totalDays: list.reduce((s, m) => s + m.totalDays, 0), items: list }));
    rows.sort((a, b) => b.count - a.count);
    return rows;
  })();

  // Reverse of WorkItem.childIds — which Feature (if any) a given item is a
  // child of. Built from the full `items` fetch, not the User-Story-only
  // `valid` set above, since Features are exactly what's filtered out there.
  const featureOfChild = new Map<number, WorkItem>();
  for (const item of items) {
    if (item.type.trim().toLowerCase() !== 'feature') continue;
    for (const childId of item.childIds) featureOfChild.set(childId, item);
  }

  // Open items nobody is holding — orphaned work, invisible everywhere else
  // because every other ranking on this screen groups by assignedTo and
  // silently drops the empty-name bucket.
  const unassignedOpenItems = rawMetrics.filter((m) => !m.done && m.item.assignedTo.trim() === '').sort((a, b) => b.totalDays - a.totalDays);

  const suspiciousRanking: SuspiciousRanking[] = (() => {
    // Deliberately plain assignedTo, no tag-credit: a suspicious item is a
    // problem with whoever actually executed/closed it, not something that
    // should follow the tag to Guilherme.
    const byName = groupBy(
      allMetrics.filter((m) => m.done),
      (m) => m.item.assignedTo.trim(),
    );
    byName.delete('');
    const rows = [...byName.entries()]
      .map(([name, list]) => ({ name, completed: list.length, suspicious: list.filter((m) => m.isSuspicious).length, items: list }))
      .filter((r) => r.suspicious > 0);
    rows.sort((a, b) => {
      const pa = a.completed === 0 ? 0 : (a.suspicious / a.completed) * 100;
      const pb = b.completed === 0 ? 0 : (b.suspicious / b.completed) * 100;
      return pb !== pa ? pb - pa : b.suspicious - a.suspicious;
    });
    return rows;
  })();

  const predictabilityRanking: PredictabilityRanking[] = (() => {
    // Plain assignedTo — deadline accountability belongs to whoever is
    // literally holding the card, not to the tag.
    const byAllClosed = groupBy(
      allMetrics.filter((m) => m.done),
      (m) => m.item.assignedTo.trim(),
    );
    byAllClosed.delete('');
    const byWithDeadline = groupBy(
      allMetrics.filter((m) => m.done && m.isOnTime != null),
      (m) => m.item.assignedTo.trim(),
    );
    byWithDeadline.delete('');
    const rows = [...byAllClosed.entries()].map(([name, allClosedItems]) => {
      const list = byWithDeadline.get(name) ?? [];
      return {
        name,
        withDeadline: list.length,
        onTime: list.filter((m) => m.isOnTime === true).length,
        totalClosed: allClosedItems.length,
        items: list,
        allClosedItems,
      };
    });
    // Ranked by previsibilidade weighted by how much of the person's total
    // conclusões actually had a prazo to judge — 100% em 1 de 20 concluídos
    // não é o mesmo sinal que 90% em 18 de 20; a cobertura baixa pesa contra,
    // em vez de deixar uma amostra pequena inflar a posição de alguém.
    function weightedScore(r: { withDeadline: number; onTime: number; totalClosed: number }): number {
      if (r.withDeadline === 0 || r.totalClosed === 0) return 0;
      const onTimePercent = r.onTime / r.withDeadline;
      const coverage = r.withDeadline / r.totalClosed;
      return onTimePercent * coverage;
    }
    rows.sort((a, b) => weightedScore(b) - weightedScore(a));
    return rows;
  })();

  // Only items where the person actually has *measurable* time in that
  // stage count toward their median/average/P85 — an item that never
  // touched Triagem/Fila reads as "0 days" if included, which isn't "fast",
  // it's "not applicable". Mixing those zeros in with real durations
  // silently rewards whoever happens to have more cards that skipped the
  // stage entirely, instead of ranking who actually clears it quickest.
  function speedRanking(daysOf: (m: ItemMetric) => number, useTagCredit: boolean): CycleTimeRanking[] {
    // Plain assignedTo measures who physically moved the card out of the
    // stage. Fila is the one exception (useTagCredit=true): a card
    // "Liberado para Desenvolvimento" tagged for Guilherme genuinely is
    // something waiting on him specifically, so the tag-credit rule applies
    // there — Triagem doesn't get the same treatment, that's about who
    // triages, not who tagged.
    const byName = useTagCredit
      ? attributedGroupBy(
          allMetrics.filter((m) => m.done && daysOf(m) > 0),
          settings,
        )
      : (() => {
          const g = groupBy(
            allMetrics.filter((m) => m.done && daysOf(m) > 0),
            (m) => m.item.assignedTo.trim(),
          );
          g.delete('');
          return g;
        })();
    const rows = [...byName.entries()].map(([name, list]) => {
      const values = list.map(daysOf);
      return { name, median: median(values), average: values.reduce((a, b) => a + b, 0) / values.length, p85: percentile85(values), count: values.length, items: list };
    });
    rows.sort((a, b) => (a.median !== b.median ? a.median - b.median : a.average !== b.average ? a.average - b.average : a.p85 - b.p85));
    return rows;
  }
  const triageSpeedRanking = speedRanking((m) => m.triageDays, false);
  const queueSpeedRanking = speedRanking((m) => m.queueDays, true);

  // "Ranking de desenvolvimento": por grupo de tag — "Guilherme"
  // (settings.tagFilter) e "DH" (as tags "maria" e "dh" somadas numa linha
  // só) — quantos cards a tag teve nesta sprint (mesma definição de
  // "Entraram" usada em todo o resto da tela: novos + carregados), quantos
  // concluíram, a conversão entre os dois, e o Cycle Time médio em
  // Desenvolvimento e em Fila entre os concluídos (só quando o item de fato
  // teve tempo mensurável lá — a mesma regra usada nos outros rankings de
  // velocidade).
  const tagRanking: TagRankingRow[] = (() => {
    const tagOwner = settings.tagFilter.trim().toLowerCase();
    // DH's own "Desenvolvimento" work happens to run through the Fornecedor
    // column too (that's who's actually building it for that group), so its
    // dev-time selector folds vendorDays in — Guilherme's doesn't, his
    // Fornecedor time is genuinely someone else's work he's just waiting on.
    const groups: { label: string; matches: (tags: string[]) => boolean; devDaysOf: (m: ItemMetric) => number }[] = [
      { label: 'Guilherme', matches: (tags) => tagOwner !== '' && tags.some((t) => t.trim().toLowerCase() === tagOwner), devDaysOf: (m) => m.cycleTimeDays },
      {
        label: 'DH',
        matches: (tags) => tags.some((t) => ['maria', 'dh'].includes(t.trim().toLowerCase())),
        devDaysOf: (m) => m.cycleTimeDays + m.vendorDays,
      },
    ];
    return groups.map((g) => {
      const tagged = allMetrics.filter((m) => g.matches(m.item.tags));
      const stats = computeAreaStats(tagged, selectedSprint);
      const enteredItems = tagged.filter((m) => createdInSprintLocal(m.item, selectedSprint) || carriedIntoSprintLocal(m, selectedSprint));
      const closedItems = tagged.filter((m) => endedInSprintLocal(m, selectedSprint));
      const devItems = closedItems.filter((m) => g.devDaysOf(m) > 0);
      const queueItems = closedItems.filter((m) => m.queueDays > 0);
      return {
        name: g.label,
        entered: stats.entered,
        enteredItems,
        closed: stats.closed,
        closedItems,
        conversion: stats.conversion,
        devAvg: devItems.length === 0 ? null : devItems.reduce((s, m) => s + g.devDaysOf(m), 0) / devItems.length,
        devItems,
        devDaysOf: g.devDaysOf,
        queueAvg: queueItems.length === 0 ? null : queueItems.reduce((s, m) => s + m.queueDays, 0) / queueItems.length,
        queueItems,
      };
    });
  })();

  const healthScoreRanking: HealthScoreRanking[] = buildHealthScoreRanking({ items: sprintScopedItems, settings, asOf });

  function waitRanking(metrics: ItemMetric[], daysOf: (m: ItemMetric) => number): WaitRanking[] {
    const byName = groupBy(metrics, (m) => m.item.assignedTo.trim());
    byName.delete('');
    const rows = [...byName.entries()].map(([name, list]) => ({ name, count: list.length, totalDays: list.reduce((s, m) => s + daysOf(m), 0), items: list }));
    rows.sort((a, b) => b.totalDays - a.totalDays);
    return rows;
  }
  function openIn(columns: Set<string>): ItemMetric[] {
    return allMetrics.filter((m) => !m.done && boardColumnMatches(columns, m.item.currentBoardColumn));
  }
  const triageWaitRanking = waitRanking(openIn(settings.triageColumnSet), (m) => m.triageDays);
  const queueWaitRanking = waitRanking(openIn(settings.queueColumnSet), (m) => m.queueDays);
  const userWaitRankingByOwner = waitRanking(openIn(settings.userColumnSet), (m) => m.userDays);
  const vendorWaitRankingByOwner = waitRanking(openIn(settings.vendorColumnSet), (m) => m.vendorDays);

  if (!settings.isConfigured) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Configure a Conexão para começar.</span>
      </div>
    );
  }
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Carregando...</span>
      </div>
    );
  }
  if (error != null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Erro: {error}</span>
      </div>
    );
  }

  const openMetrics = openNonTriageMetrics;
  const byAreaOpen = groupByArea(openMetrics);
  const byAreaAll = groupByArea(areaCardMetrics);
  const areas = orderedAreas(new Set(byAreaAll.keys()));
  const byDepartmentAll = groupByDepartment(areaCardMetrics);
  const departments = [...byDepartmentAll.keys()].sort();
  const byRequestTypeAll = groupByRequestType(areaCardMetrics);
  const requestTypesAll = [...byRequestTypeAll.keys()].sort();
  const oldest = [...openMetrics].sort((a, b) => b.totalDays - a.totalDays);

  const vendorMetrics = allMetrics
    .filter((m) => !m.done && boardColumnMatches(settings.vendorColumnSet, m.item.currentBoardColumn))
    .sort((a, b) => b.vendorDays - a.vendorDays);
  const userWaitMetrics = allMetrics
    .filter((m) => !m.done && boardColumnMatches(settings.userColumnSet, m.item.currentBoardColumn))
    .sort((a, b) => b.userDays - a.userDays);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ backgroundColor: BrandColors.background, padding: '10px 16px 0' }}>
        <div style={{ maxWidth: 1500, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 20, fontWeight: 'bold' }}>Visão do time</span>
            <select
              style={{ width: 220, height: 38, padding: '4px 10px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff' }}
              value={selectedSprint?.number ?? ''}
              onChange={(e) => {
                const n = e.target.value;
                onSprintChanged(n === '' ? null : sprints.find((s) => s.number === Number(n)) ?? null);
              }}
            >
              {sprints.map((s) => (
                <option key={s.number} value={s.number}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ height: 10 }} />
          <TeamTabBar tab={tab} setTab={setTab} />
          <div style={{ height: 8 }} />
        </div>
      </div>
      <div style={{ height: 1, backgroundColor: BrandColors.border }} />
      <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        <div style={{ maxWidth: 1500, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {tab === 0 && (
            <>
              <ComparisonPanel
                title="Comparativo por área"
                allLabel="Todas as áreas"
                allMetrics={areaCardMetrics}
                groups={areas}
                byGroup={byAreaAll}
                sprint={selectedSprint}
                onTileClick={(label, metrics) => setBreakdownDialog({ label, metrics })}
              />
              <div style={{ height: 28 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 320px' }}>
                  <DistributionPieCard
                    title="Distribuição por complexidade"
                    byGroup={groupByComplexity(areaCardMetrics)}
                    onSelect={(label, metrics) => setBreakdownDialog({ label, metrics })}
                  />
                </div>
                <div style={{ flex: '1 1 320px' }}>
                  <DistributionPieCard
                    title="Distribuição por prioridade"
                    byGroup={groupByPriority(areaCardMetrics)}
                    onSelect={(label, metrics) => setBreakdownDialog({ label, metrics })}
                  />
                </div>
              </div>
              <div style={{ height: 28 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
                <div style={{ flex: '1 1 380px' }}>
                  <GroupCountTable
                    title="Por setor"
                    groups={departments}
                    byGroup={byDepartmentAll}
                    sprint={selectedSprint}
                    onRowClick={(label, metrics) => setBreakdownDialog({ label, metrics })}
                  />
                </div>
                <div style={{ flex: '1 1 380px' }}>
                  <GroupCountTable
                    title="Por tipo de demanda"
                    groups={requestTypesAll}
                    byGroup={byRequestTypeAll}
                    sprint={selectedSprint}
                    onRowClick={(label, metrics) => setBreakdownDialog({ label, metrics })}
                  />
                </div>
              </div>
              <div style={{ height: 36 }} />
              <SectionHeader
                icon={<BarChart3 size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.developer}
                title="Aging — distribuição por tempo na esteira"
                subtitle='Itens em aberto (Triagem e colunas inválidas excluídas), por faixa de dias desde a criação.'
              />
              <div style={{ height: 12 }} />
              <AgingBucketTable byArea={byAreaOpen} areas={areas} onCellClick={(label, metrics) => setBreakdownDialog({ label, metrics })} />
              <div style={{ height: 28 }} />
              <SectionHeader icon={<Clock size={17} strokeWidth={1.75} />} iconColor={BrandColors.queue} title="Cards mais antigos" />
              <div style={{ height: 12 }} />
              <ItemListTable metrics={oldest.slice(0, 10)} valueLabel="Dias aberto" valueSelector={(m) => m.totalDays} />
            </>
          )}
          {tab === 1 && (
            <>
              <SectionHeader
                icon={<LayoutList size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.developer}
                title="Carga de trabalho (WIP)"
                subtitle='Quantos itens cada responsável tem em aberto agora — sem olhar a sprint selecionada, é o "quanto de bola no ar" de cada um neste momento. Muita coisa em aberto ao mesmo tempo é sinal de troca de contexto, não de produtividade. O Guilherme também soma itens marcados com sua tag que estão parados agora em Desenvolvedor — clique na linha pra ver "Direto" vs "Tag" de cada item.'
              />
              <div style={{ height: 12 }} />
              <WipTable
                rows={wipRanking}
                onRowClick={(name, metrics) =>
                  setPersonDialog({
                    name,
                    metrics,
                    extraColumn: { label: 'Dias aberto', render: (m) => `${m.totalDays.toFixed(1)}d` },
                    sortMode: 'createdAsc',
                    projectOf: (m) => featureOfChild.get(m.item.id) ?? null,
                  })
                }
              />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<UserRound size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.warning}
                title="Cards sem responsável"
                subtitle="Itens em aberto que ninguém está segurando agora — trabalho órfão que some de todo o resto dessa tela, já que os outros rankings agrupam por responsável."
              />
              <div style={{ height: 12 }} />
              <ItemListTable metrics={unassignedOpenItems} valueLabel="Dias aberto" valueSelector={(m) => m.totalDays} />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<HeartPulse size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.danger}
                title="Health Score"
                subtitle='Um número só por responsável, pra saber rápido quem merece uma olhada mais de perto — média de Rastreabilidade (não suspeitos / concluídos), Previsibilidade (no prazo / concluídos) e Velocidade (rápidos, excluindo suspeitos / concluídos). Os 3 usam o mesmo denominador — total de concluídos — pra ficar comparável entre pessoas. Clique numa linha pra ver item a item. Não substitui os rankings abaixo, só resume.'
              />
              <div style={{ height: 12 }} />
              <HealthScoreTable rows={healthScoreRanking} onSelect={setHealthDetailRow} />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<Trophy size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.primary}
                title="Ranking de performance"
                subtitle='Base = itens atribuídos, em aberto numa das colunas marcadas abaixo (ou já concluídos, não importa a coluna) + itens de outra pessoa com sua tag que foram concluídos.'
              />
              <div style={{ height: 12 }} />
              <FilterBox message='Cada chip é uma coluna do board. Marcado = itens ainda abertos ali contam no Base de quem está com eles agora. Desmarcado = eles somem da conta enquanto ficarem nessa coluna (mas contam quando forem concluídos, seja qual for a coluna). Passe o mouse num chip pra ver o que ele representa.'>
                {performanceGroups.map((g) => (
                  <span key={g.key} title={g.description}>
                    <ToggleChip
                      label={g.label}
                      selected={selectedGroups.has(g.key)}
                      onSelected={(selected) => {
                        setSelectedGroups((prev) => {
                          const next = new Set(prev);
                          if (selected) next.add(g.key);
                          else next.delete(g.key);
                          return next;
                        });
                      }}
                    />
                  </span>
                ))}
              </FilterBox>
              <div style={{ height: 12 }} />
              <FilterBox message='Concluídos líquidos: desmarque um tipo de solicitação pra ele não contar como entrega de verdade (ex: chamados de Suporte simples), e/ou desconte os itens suspeitos — quem "infla" o número com entregas fracas perde posição no % líquido, sem sumir da Base.'>
                <ToggleChip label="Descontar suspeitos" selected={discountSuspicious} onSelected={setDiscountSuspicious} icon="⊘" />
                {requestTypes.map((type) => (
                  <ToggleChip
                    key={type}
                    label={type}
                    selected={!discountedRequestTypes.has(type)}
                    onSelected={(selected) => {
                      setDiscountedRequestTypes((prev) => {
                        const next = new Set(prev);
                        if (selected) next.delete(type);
                        else next.add(type);
                        return next;
                      });
                    }}
                  />
                ))}
              </FilterBox>
              <div style={{ height: 16 }} />
              <PerformanceTable
                rows={performanceRanking}
                netClosedOf={discountSuspicious || discountedRequestTypes.size > 0 ? netClosed : undefined}
                onRowClick={setPerfDialog}
              />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<EyeOff size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.danger}
                title="Ranking de itens suspeitos"
                subtitle='Concluídos rápido demais (< 4h) ou com boa parte do tempo sem passagem por nenhuma coluna rastreada.'
              />
              <div style={{ height: 12 }} />
              <SuspiciousTable
                rows={suspiciousRanking}
                onRowClick={(name, metrics) =>
                  setPersonDialog({
                    name,
                    metrics,
                    extraColumn: {
                      label: 'Suspeito?',
                      render: (m) =>
                        !m.isSuspicious ? (
                          '—'
                        ) : (
                          <span style={{ fontWeight: 'bold', color: BrandColors.danger }}>
                            {m.isSuspiciouslyFast && m.hasUntrackedGap
                              ? 'Rápido demais + gap'
                              : m.isSuspiciouslyFast
                                ? 'Rápido demais (<4h)'
                                : 'Gap sem rastro'}
                          </span>
                        ),
                    },
                  })
                }
              />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<Calendar size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.user}
                title="Ranking de previsibilidade de prazo"
                subtitle='% de itens concluídos, entre os que tinham prazo, entregues dentro do prazo original — mas o ranking pesa pela cobertura (quantos dos concluídos totais tinham prazo pra começo de conversa), pra 100% em 1 de 20 não subir mais que 90% em 18 de 20.'
              />
              <div style={{ height: 12 }} />
              <PredictabilityTable
                rows={predictabilityRanking}
                onRowClick={(name, metrics) =>
                  setPersonDialog({
                    name,
                    metrics,
                    extraColumn: {
                      label: 'Prazo',
                      render: (m) => {
                        if (m.isOnTime == null) return '—';
                        const target = m.item.originalTargetDate;
                        const targetLabel = target ? ` (${formatDate(target)})` : '';
                        return (
                          <span style={{ fontWeight: 'bold', color: m.isOnTime ? BrandColors.user : BrandColors.danger }}>
                            {m.isOnTime ? 'No prazo' : 'Atrasado'}
                            {targetLabel}
                          </span>
                        );
                      },
                    },
                  })
                }
              />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<Inbox size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.triage}
                title="Ranking de velocidade de Triagem"
                subtitle='Mediana, média e P85 do tempo em Triagem, só nos itens concluídos que de fato passaram um tempo mensurável lá (itens que nunca tocaram Triagem não entram na conta de ninguém) — do mais rápido para o mais lento a tirar um card de lá.'
              />
              <div style={{ height: 12 }} />
              <CycleTimeTable
                rows={triageSpeedRanking}
                onRowClick={(name, metrics) =>
                  setPersonDialog({ name, metrics, extraColumn: { label: 'Dias em Triagem', render: (m) => `${m.triageDays.toFixed(1)}d` } })
                }
              />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<CheckCircle2 size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.queue}
                title="Ranking de velocidade na fila"
                subtitle='Mediana, média e P85 do tempo em "Liberado para Desenvolvimento", só nos itens concluídos que de fato passaram um tempo mensurável lá — do mais rápido para o mais lento a pegar um card da fila.'
              />
              <div style={{ height: 12 }} />
              <CycleTimeTable
                rows={queueSpeedRanking}
                onRowClick={(name, metrics) =>
                  setPersonDialog({ name, metrics, extraColumn: { label: 'Dias na Fila', render: (m) => `${m.queueDays.toFixed(1)}d` } })
                }
              />
              <div style={{ height: 28 }} />
              <SectionHeader
                icon={<Zap size={17} strokeWidth={1.75} />}
                iconColor={BrandColors.developer}
                title="Ranking de desenvolvimento"
                subtitle='Por grupo de tag — "Guilherme" e "DH" (soma das tags "maria" e "dh") — quantos cards entraram na sprint, quantos concluíram, a conversão, e o Cycle Time médio em Desenvolvimento e Fila entre os concluídos.'
              />
              <div style={{ height: 12 }} />
              <TagRankingTable rows={tagRanking} onRowClick={setTagDetailRow} />
            </>
          )}
          {tab === 2 && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                <div style={{ flex: '1 1 260px', minWidth: 260 }}>
                  <SufferingCard
                    title="Triagem (gargalo)"
                    icon={<Inbox size={17} strokeWidth={1.75} />}
                    color={BrandColors.triage}
                    subtitle='Quem tem mais itens presos na Triagem agora, por dias acumulados de espera — indica gargalo de entrada, não culpa do responsável.'
                    rows={triageWaitRanking}
                    onRowClick={(name, metrics) =>
                      setPersonDialog({ name, metrics, extraColumn: { label: 'Dias em Triagem', render: (m) => `${m.triageDays.toFixed(1)}d` } })
                    }
                  />
                </div>
                <div style={{ flex: '1 1 260px', minWidth: 260 }}>
                  <SufferingCard
                    title="Liberado para Desenvolvimento"
                    icon={<CheckCircle2 size={17} strokeWidth={1.75} />}
                    color={BrandColors.queue}
                    subtitle='Quem tem mais itens já triados esperando um desenvolvedor pegar, por dias acumulados de espera na fila.'
                    rows={queueWaitRanking}
                    onRowClick={(name, metrics) =>
                      setPersonDialog({ name, metrics, extraColumn: { label: 'Dias na Fila', render: (m) => `${m.queueDays.toFixed(1)}d` } })
                    }
                  />
                </div>
                <div style={{ flex: '1 1 260px', minWidth: 260 }}>
                  <SufferingCard
                    title="Aguardando Usuário"
                    icon={<UserRound size={17} strokeWidth={1.75} />}
                    color={BrandColors.user}
                    subtitle='Quem tem mais itens travados esperando definição/validação do solicitante, por dias acumulados de espera.'
                    rows={userWaitRankingByOwner}
                    onRowClick={(name, metrics) =>
                      setPersonDialog({ name, metrics, extraColumn: { label: 'Dias aguardando Usuário', render: (m) => `${m.userDays.toFixed(1)}d` } })
                    }
                  />
                </div>
                <div style={{ flex: '1 1 260px', minWidth: 260 }}>
                  <SufferingCard
                    title="Aguardando Fornecedor"
                    icon={<Truck size={17} strokeWidth={1.75} />}
                    color={BrandColors.vendor}
                    subtitle='Quem tem mais itens travados esperando um fornecedor externo, por dias acumulados de espera.'
                    rows={vendorWaitRankingByOwner}
                    onRowClick={(name, metrics) =>
                      setPersonDialog({ name, metrics, extraColumn: { label: 'Dias aguardando Fornecedor', render: (m) => `${m.vendorDays.toFixed(1)}d` } })
                    }
                  />
                </div>
              </div>
              <div style={{ height: 28 }} />
              <SectionHeader icon={<Truck size={17} strokeWidth={1.75} />} iconColor={BrandColors.vendor} title="Aguardando Fornecedor" />
              <div style={{ height: 12 }} />
              <ItemListTable metrics={vendorMetrics} valueLabel="Dias aguardando" valueSelector={(m) => m.vendorDays} />
              <div style={{ height: 28 }} />
              <SectionHeader icon={<UserRound size={17} strokeWidth={1.75} />} iconColor={BrandColors.user} title="Aguardando Definição do Usuário" />
              <div style={{ height: 12 }} />
              <ItemListTable metrics={userWaitMetrics} valueLabel="Dias aguardando" valueSelector={(m) => m.userDays} />
            </>
          )}
        </div>
      </div>
      {breakdownDialog && (
        <ResponsibleBreakdownDialog
          label={breakdownDialog.label}
          metrics={breakdownDialog.metrics}
          onClose={() => setBreakdownDialog(null)}
          onSelectPerson={(name, metrics) => setPersonDialog({ name, metrics })}
        />
      )}
      {personDialog && (
        <PersonItemsDialog
          name={personDialog.name}
          metrics={personDialog.metrics}
          extraColumn={personDialog.extraColumn}
          sortMode={personDialog.sortMode}
          projectOf={personDialog.projectOf}
          onClose={() => setPersonDialog(null)}
        />
      )}
      {perfDialog && <PerformanceItemsDialog row={perfDialog} onClose={() => setPerfDialog(null)} />}
      {healthDetailRow && <HealthScoreDetailDialog row={healthDetailRow} onClose={() => setHealthDetailRow(null)} />}
      {tagDetailRow && <TagRaioXDialog row={tagDetailRow} onClose={() => setTagDetailRow(null)} />}
    </div>
  );
}

/** Sits under the KPI strip, switching between the three tabs. */
function TeamTabBar({ tab, setTab }: { tab: 0 | 1 | 2; setTab: (t: 0 | 1 | 2) => void }) {
  const tabs: { icon: ReactNode; label: string }[] = [
    { icon: <BarChart3 size={15} strokeWidth={2} />, label: 'Visão geral' },
    { icon: <Trophy size={15} strokeWidth={2} />, label: 'Performance' },
    { icon: <Hourglass size={15} strokeWidth={2} />, label: 'Sofrimento & filas' },
  ];
  return (
    <div style={{ display: 'flex', gap: 2, padding: 4, backgroundColor: BrandColors.tableHeader, borderRadius: 10 }}>
      {tabs.map((t, i) => {
        const selected = tab === i;
        return (
          <button
            key={i}
            onClick={() => setTab(i as 0 | 1 | 2)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              height: 40,
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              backgroundColor: selected ? '#fff' : 'transparent',
              boxShadow: selected ? '0 2px 12px rgba(15,23,42,0.04)' : 'none',
              color: selected ? BrandColors.primaryDark : '#64748B',
              fontWeight: selected ? 'bold' : 'normal',
              fontSize: 13,
            }}
          >
            <span style={{ display: 'flex' }}>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const PIE_COLORS = [BrandColors.developer, BrandColors.queue, BrandColors.user, BrandColors.vendor, BrandColors.general, BrandColors.triage, BrandColors.total];

/** A titled donut chart breaking [byGroup] down into slices, each labeled
 * with its share of the whole — used for complexidade/prioridade, dimensions
 * that are about composition rather than entrada/conclusão volume. Clicking
 * a legend row opens the matching cards, same as a comparison tile does. */
function DistributionPieCard({
  title,
  byGroup,
  onSelect,
}: {
  title: string;
  byGroup: Map<string, ItemMetric[]>;
  onSelect: (label: string, metrics: ItemMetric[]) => void;
}) {
  const data = [...byGroup.entries()]
    .map(([name, metrics], i) => ({ name, value: metrics.length, color: PIE_COLORS[i % PIE_COLORS.length] }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ ...cardStyle(), padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 6, height: 16, backgroundColor: BrandColors.primary, borderRadius: 3 }} />
        <div style={{ width: 8 }} />
        <span style={{ fontWeight: 'bold', fontSize: 15 }}>{title}</span>
      </div>
      <div style={{ height: 16 }} />
      {total === 0 ? (
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', fontSize: 13 }}>Sem dados nesta sprint.</div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: 140, height: 140, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={68} paddingAngle={2}>
                  {data.map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ width: 16 }} />
          <div style={{ flex: 1 }}>
            {data.map((d) => {
              const pct = (d.value / total) * 100;
              return (
                <button
                  key={d.name}
                  onClick={() => onSelect(d.name, byGroup.get(d.name) ?? [])}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '3px 0',
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: d.color, flexShrink: 0 }} />
                  <div style={{ width: 8 }} />
                  <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 8 }}>
                    {d.value} · {pct.toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, iconColor, title, subtitle }: { icon: ReactNode; iconColor: string; title: string; subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start' }}>
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          backgroundColor: hexAlpha(iconColor, 0.12),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: iconColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ width: 10 }} />
      <div>
        <div style={{ fontWeight: 'bold', fontSize: 16 }}>{title}</div>
        {subtitle && (
          <>
            <div style={{ height: 2 }} />
            <div style={{ fontSize: 12, color: '#64748B' }}>{subtitle}</div>
          </>
        )}
      </div>
    </div>
  );
}

function CompactStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 'bold' }}>{value}</div>
      <div style={{ fontSize: 9, color: '#64748B' }}>{label}</div>
    </div>
  );
}

function CompactAreaTile({
  label,
  stats,
  metrics: _metrics,
  highlighted,
  onClick,
}: {
  label: string;
  stats: AreaStats;
  metrics: ItemMetric[];
  highlighted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 168,
        padding: 14,
        borderRadius: 12,
        backgroundColor: highlighted ? BrandColors.primaryLightBg : BrandColors.tableHeader,
        border: highlighted ? `1px solid ${BrandColors.primary}` : 'none',
        textAlign: 'left',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: highlighted ? BrandColors.primaryDark : '#334155',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div style={{ height: 8 }} />
      <div style={{ fontSize: 18, fontWeight: 'bold' }}>{stats.entered}</div>
      <div style={{ fontSize: 10, color: '#64748B' }}>Entraram</div>
      <div style={{ height: 6 }} />
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <CompactStat value={`${stats.closed}`} label="Concluídos" />
        </div>
        <div style={{ flex: 1 }}>
          <CompactStat value={stats.conversion == null ? '—' : `${stats.conversion.toFixed(0)}%`} label="Conversão" />
        </div>
      </div>
      <div style={{ height: 6 }} />
      <div style={{ display: 'flex' }}>
        <div style={{ flex: 1 }}>
          <CompactStat value={`${stats.stillOpen}`} label="Saída" />
        </div>
        <div style={{ flex: 1 }}>
          <CompactStat value={stats.generalDays == null ? '—' : `${stats.generalDays.toFixed(1)}d`} label="Cycle Time" />
        </div>
      </div>
      <div style={{ height: 8 }} />
      <div style={{ fontSize: 9, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 3 }}>
        <MousePointerClick size={10} strokeWidth={2} /> Ver por responsável
      </div>
    </button>
  );
}

/** A whole "Comparativo por X" block: a titled panel holding one highlighted
 * a highlighted "Todos" tile followed by one compact tile per group, ranked
 * by volume. Starts collapsed to [initialCount] individual tiles with a "Ver
 * mais" toggle to reveal the rest, instead of silently folding the long tail
 * into an "Outros" bucket or piling every group on screen at once. */
function ComparisonPanel({
  title,
  allLabel,
  allMetrics,
  groups,
  byGroup,
  sprint,
  onTileClick,
  initialCount = 6,
}: {
  title: string;
  allLabel: string;
  allMetrics: ItemMetric[];
  groups: string[];
  byGroup: Map<string, ItemMetric[]>;
  sprint: Sprint | null;
  onTileClick: (label: string, metrics: ItemMetric[]) => void;
  initialCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const ranked = groups.map((g): [string, ItemMetric[]] => [g, byGroup.get(g) ?? []]).sort((a, b) => b[1].length - a[1].length);
  const shown = expanded ? ranked : ranked.slice(0, initialCount);
  const hiddenCount = ranked.length - shown.length;

  return (
    <div style={{ ...cardStyle(), padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 6, height: 16, backgroundColor: BrandColors.primary, borderRadius: 3 }} />
        <div style={{ width: 8 }} />
        <span style={{ fontWeight: 'bold', fontSize: 15 }}>{title}</span>
      </div>
      <div style={{ height: 16 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
        <CompactAreaTile label={allLabel} stats={computeAreaStats(allMetrics, sprint)} metrics={allMetrics} highlighted onClick={() => onTileClick(allLabel, allMetrics)} />
        {shown.map(([group, metrics]) => (
          <CompactAreaTile key={group} label={group} stats={computeAreaStats(metrics, sprint)} metrics={metrics} onClick={() => onTileClick(group, metrics)} />
        ))}
      </div>
      {(hiddenCount > 0 || expanded) && ranked.length > initialCount && (
        <>
          <div style={{ height: 14 }} />
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: BrandColors.primary, fontSize: 12.5, fontWeight: 600, padding: 0 }}
          >
            {expanded ? 'Ver menos' : `Ver mais (+${hiddenCount})`}
          </button>
        </>
      )}
    </div>
  );
}

/** A simpler "how many entered vs. closed" breakdown for a dimension that
 * doesn't need the full comparison-tile treatment (setor, tipo de demanda) —
 * one row per group, sorted by volume. Trades the tile grid's density for a
 * quieter, scannable table. */
function GroupCountTable({
  title,
  groups,
  byGroup,
  sprint,
  onRowClick,
}: {
  title: string;
  groups: string[];
  byGroup: Map<string, ItemMetric[]>;
  sprint: Sprint | null;
  onRowClick: (label: string, metrics: ItemMetric[]) => void;
}) {
  const ranked = groups.map((g): [string, ItemMetric[]] => [g, byGroup.get(g) ?? []]).sort((a, b) => b[1].length - a[1].length);

  const Row = ({ label, metrics }: { label: string; metrics: ItemMetric[] }) => {
    const stats = computeAreaStats(metrics, sprint);
    return (
      <tr onClick={() => onRowClick(label, metrics)} style={{ cursor: 'pointer' }}>
        <Td>
          <span style={{ fontWeight: 500 }}>{label}</span>
        </Td>
        <Td>{stats.entered}</Td>
        <Td>{stats.closed}</Td>
        <Td>{stats.conversion == null ? '—' : `${stats.conversion.toFixed(0)}%`}</Td>
        <Td>{stats.stillOpen}</Td>
      </tr>
    );
  };

  return (
    <div style={{ ...cardStyle(), padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: 6, height: 16, backgroundColor: BrandColors.primary, borderRadius: 3 }} />
        <div style={{ width: 8 }} />
        <span style={{ fontWeight: 'bold', fontSize: 15 }}>{title}</span>
      </div>
      <div style={{ height: 16 }} />
      {ranked.length === 0 ? (
        <span style={{ color: '#64748B', fontSize: 13 }}>Sem dados nesta sprint.</span>
      ) : (
        <table style={tableStyle()}>
          <thead>
            <tr>
              <Th>Grupo</Th>
              <Th>Entraram</Th>
              <Th>Concluídos</Th>
              <Th>Conversão</Th>
              <Th>Saída</Th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(([group, metrics]) => (
              <Row key={group} label={group} metrics={metrics} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function initialsOf(n: string): string {
  const parts = n.trim().split(/\s+/).filter((p) => p.length > 0);
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

function tableStyle(): React.CSSProperties {
  return { borderCollapse: 'collapse', width: '100%', fontSize: 13 };
}
function Th({ children }: { children: ReactNode }) {
  return (
    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, backgroundColor: BrandColors.tableHeader, fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}
function Td({ children }: { children: ReactNode }) {
  return <td style={{ textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, whiteSpace: 'nowrap' }}>{children}</td>;
}

function TableCard({ children, emptyMessage, isEmpty }: { children: ReactNode; emptyMessage: string; isEmpty: boolean }) {
  if (isEmpty) {
    return (
      <div style={{ ...cardStyle(), padding: 16 }}>
        <span style={{ color: '#64748B' }}>{emptyMessage}</span>
      </div>
    );
  }
  return (
    <div style={{ ...cardStyle(), overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}

function Modal({ title, width, onClose, children }: { title: string; width: number; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ backgroundColor: '#fff', borderRadius: 12, maxWidth: width, width: '90%', maxHeight: '85vh', overflowY: 'auto', padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1, fontWeight: 'bold', fontSize: 16 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div style={{ height: 12 }} />
        {children}
      </div>
    </div>
  );
}

/** Opens from a comparison tile to answer "who's behind this number". */
function ResponsibleBreakdownDialog({
  label,
  metrics,
  onClose,
  onSelectPerson,
}: {
  label: string;
  metrics: ItemMetric[];
  onClose: () => void;
  onSelectPerson: (name: string, metrics: ItemMetric[]) => void;
}) {
  const byName = groupBy(metrics, (m) => m.item.assignedTo.trim());
  byName.delete('');
  const rows = [...byName.entries()].sort((a, b) => b[1].length - a[1].length);
  return (
    <Modal title={label} width={360} onClose={onClose}>
      {rows.length === 0 ? (
        <span>Nenhum item atribuído nesse grupo.</span>
      ) : (
        rows.map(([name, list]) => (
          <div
            key={name}
            onClick={() => onSelectPerson(name, list)}
            style={{ display: 'flex', alignItems: 'center', padding: '6px 0', cursor: 'pointer' }}
          >
            <div style={{ flex: 1 }}>
              <ResponsibleTag name={name} />
            </div>
            <span style={{ fontWeight: 'bold' }}>
              {list.filter((m) => m.done).length}/{list.length}
            </span>
          </div>
        ))
      )}
    </Modal>
  );
}

/** Opens from a name in ResponsibleBreakdownDialog — the actual list of
 * demandas behind that person's count. */
/** Opens from any per-responsible row across the screen — shows exactly
 * which cards are behind that number. `extraColumn` lets the caller add
 * whatever made those items land in this particular ranking in the first
 * place (e.g. "Suspeito?" from the suspicious table, "Dias em Triagem" from
 * the Triagem speed ranking) instead of a generic list that doesn't explain
 * itself. */
function PersonItemsDialog({
  name,
  metrics,
  extraColumn,
  sortMode = 'doneFirst',
  projectOf,
  onClose,
}: {
  name: string;
  metrics: ItemMetric[];
  extraColumn?: { label: string; render: (m: ItemMetric) => ReactNode };
  // 'doneFirst' (default): open items first, matches every existing caller.
  // 'createdAsc': oldest-created first — what WIP wants, since "what's been
  // sitting the longest" matters more there than open/done grouping.
  sortMode?: 'doneFirst' | 'createdAsc';
  // Resolves an item to the Feature it's a child of, if any — only WIP
  // passes this today.
  projectOf?: (m: ItemMetric) => WorkItem | null;
  onClose: () => void;
}) {
  const rows = [...metrics].sort((a, b) =>
    sortMode === 'createdAsc' ? a.item.createdDate.getTime() - b.item.createdDate.getTime() : a.done === b.done ? 0 : a.done ? 1 : -1,
  );
  // Whether this item landed under `name` because it's literally assigned
  // to them, or via the tag-credit rule (assigned to someone else, counted
  // for `name` because it's tagged and either done or currently in
  // Desenvolvedor). Only meaningful when the dialog is about
  // settings.myDisplayName — for anyone else every row is a direct
  // assignment, so the column would just be noise.
  const taggedItems = rows.filter((m) => m.item.assignedTo.trim().toLowerCase() !== name.trim().toLowerCase());
  const showAttribution = taggedItems.length > 0;
  // Raw tags per item — shown independently of showAttribution, so a
  // ranking that deliberately does NOT merge by tag (itens suspeitos,
  // previsibilidade, Triagem, sofrimento) still lets you see whether a
  // pending item carries a tag at all (yours or someone else's), without
  // that tag having actually pulled the item into this list.
  const showTags = rows.some((m) => m.item.tags.length > 0);
  return (
    <Modal title={name} width={extraColumn || showAttribution || showTags ? 700 : 520} onClose={onClose}>
      {rows.length === 0 ? (
        <span>Nenhum item nesse grupo.</span>
      ) : (
        <table style={tableStyle()}>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Título</Th>
              <Th>Coluna</Th>
              <Th>Status</Th>
              <Th>Criado em</Th>
              {showTags && <Th>Tags</Th>}
              {showAttribution && <Th>Atribuição</Th>}
              {projectOf && <Th>Projeto</Th>}
              {extraColumn && <Th>{extraColumn.label}</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const isTagged = m.item.assignedTo.trim().toLowerCase() !== name.trim().toLowerCase();
              return (
                <tr key={m.item.id}>
                  <Td>{m.item.id}</Td>
                  <Td>
                    <span style={{ display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
                  </Td>
                  <Td>{m.item.currentBoardColumn === '' ? '—' : m.item.currentBoardColumn}</Td>
                  <Td>{m.done ? 'Concluído' : 'Aberto'}</Td>
                  <Td>{formatDate(m.item.createdDate)}</Td>
                  {showTags && (
                    <Td>
                      <TagChips tags={m.item.tags} />
                    </Td>
                  )}
                  {showAttribution && (
                    <Td>
                      {isTagged ? (
                        <span style={{ fontWeight: 600, color: BrandColors.primary }}>Tag (de {m.item.assignedTo || '—'})</span>
                      ) : (
                        <span style={{ color: '#94A3B8' }}>Direto</span>
                      )}
                    </Td>
                  )}
                  {projectOf &&
                    (() => {
                      const project = projectOf(m);
                      return (
                        <Td>
                          {project ? (
                            <span title={project.title} style={{ fontWeight: 600, color: BrandColors.primary }}>
                              #{project.id}
                            </span>
                          ) : (
                            <span style={{ color: '#94A3B8' }}>—</span>
                          )}
                        </Td>
                      );
                    })()}
                  {extraColumn && <Td>{extraColumn.render(m)}</Td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function PerformanceTable({
  rows,
  netClosedOf,
  onRowClick,
}: {
  rows: ResponsiblePerformance[];
  netClosedOf?: (p: ResponsiblePerformance) => number;
  onRowClick: (row: ResponsiblePerformance) => void;
}) {
  const ordered = [...rows];
  if (netClosedOf) {
    ordered.sort((a, b) => {
      const aPercent = a.base === 0 ? 0 : (netClosedOf(a) / a.base) * 100;
      const bPercent = b.base === 0 ? 0 : (netClosedOf(b) / b.base) * 100;
      return bPercent !== aPercent ? bPercent - aPercent : b.base - a.base;
    });
  }
  return (
    <TableCard isEmpty={ordered.length === 0} emptyMessage="Sem dados de responsáveis nesta sprint.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Responsável</Th>
            <Th>Base</Th>
            <Th>Concluídos</Th>
            {netClosedOf && <Th>Concluídos líquidos</Th>}
            <Th>% Concluído</Th>
            {netClosedOf && <Th>% líquido</Th>}
          </tr>
        </thead>
        <tbody>
          {ordered.map((r, i) => (
            <tr key={r.name} onClick={() => onRowClick(r)} style={{ cursor: 'pointer' }}>
              <Td>{i + 1}</Td>
              <Td>
                <ResponsibleTag name={r.name} />
              </Td>
              <Td>{r.base}</Td>
              <Td>{r.closed}</Td>
              {netClosedOf && <Td>{netClosedOf(r)}</Td>}
              <Td>{r.percent.toFixed(0)}%</Td>
              {netClosedOf && (
                <Td>
                  <span style={{ fontWeight: 'bold', color: BrandColors.primaryDark }}>
                    {(r.base === 0 ? 0 : (netClosedOf(r) / r.base) * 100).toFixed(0)}%
                  </span>
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/** Opens from a "Ranking de performance" row to answer "which cards are
 * these?". */
function PerformanceItemsDialog({ row, onClose }: { row: ResponsiblePerformance; onClose: () => void }) {
  const items = [...row.items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return b.item.id - a.item.id;
  });
  return (
    <Modal title={`${row.name} — itens da Base (${row.base})`} width={480} onClose={onClose}>
      {items.length === 0 ? (
        <span>Nenhum item nessa Base.</span>
      ) : (
        <table style={tableStyle()}>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Título</Th>
              <Th>Responsável</Th>
              <Th>Coluna atual</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.item.id}>
                <Td>{m.item.id}</Td>
                <Td>
                  <span style={{ display: 'inline-block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
                </Td>
                <Td>{m.item.assignedTo}</Td>
                <Td>
                  {m.item.currentBoardColumn}
                  {m.done && (
                    <span style={{ marginLeft: 4, color: BrandColors.primary, display: 'inline-flex', verticalAlign: 'middle' }}>
                      <Check size={13} strokeWidth={2.5} />
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/** WIP leaderboard — most itens em aberto first, since that's the actual
 * overload signal ("bolas no ar"), not accumulated days (a handful of very
 * old cards reads differently from a dozen fresh ones). Dias acumulados is
 * shown alongside for context, not as the sort key. */
function WipTable({ rows, onRowClick }: { rows: WaitRanking[]; onRowClick: (name: string, items: ItemMetric[]) => void }) {
  return (
    <TableCard isEmpty={rows.length === 0} emptyMessage="Ninguém com itens em aberto.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Responsável</Th>
            <Th>Itens em aberto</Th>
            <Th>Dias acumulados</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} onClick={() => onRowClick(r.name, r.items)} style={{ cursor: 'pointer' }}>
              <Td>{i + 1}</Td>
              <Td>
                <ResponsibleTag name={r.name} />
              </Td>
              <Td>
                <span style={{ fontWeight: 'bold' }}>{r.count}</span>
              </Td>
              <Td>{r.totalDays.toFixed(0)}d</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

function SuspiciousTable({ rows, onRowClick }: { rows: SuspiciousRanking[]; onRowClick: (name: string, items: ItemMetric[]) => void }) {
  return (
    <TableCard isEmpty={rows.length === 0} emptyMessage="Nenhum item suspeito encontrado nesta sprint.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Responsável</Th>
            <Th>Concluídos</Th>
            <Th>Suspeitos</Th>
            <Th>% Suspeitos</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} onClick={() => onRowClick(r.name, r.items)} style={{ cursor: 'pointer' }}>
              <Td>{i + 1}</Td>
              <Td>
                <ResponsibleTag name={r.name} />
              </Td>
              <Td>{r.completed}</Td>
              <Td>
                <span style={{ fontWeight: 'bold', color: BrandColors.danger }}>{r.suspicious}</span>
              </Td>
              <Td>{r.completed === 0 ? '0' : ((r.suspicious / r.completed) * 100).toFixed(0)}%</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

function PredictabilityTable({ rows, onRowClick }: { rows: PredictabilityRanking[]; onRowClick: (name: string, items: ItemMetric[]) => void }) {
  return (
    <TableCard isEmpty={rows.length === 0} emptyMessage="Nenhum item concluído com prazo nesta sprint.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Responsável</Th>
            <Th>Concluídos (total)</Th>
            <Th>Com prazo</Th>
            <Th>No prazo</Th>
            <Th>Previsibilidade</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pct = r.withDeadline === 0 ? 0 : (r.onTime / r.withDeadline) * 100;
            const coverage = r.totalClosed === 0 ? 0 : (r.withDeadline / r.totalClosed) * 100;
            return (
              <tr key={r.name} onClick={() => onRowClick(r.name, r.items)} style={{ cursor: 'pointer' }}>
                <Td>{i + 1}</Td>
                <Td>
                  <ResponsibleTag name={r.name} />
                </Td>
                <Td>{r.totalClosed}</Td>
                <Td>
                  {r.withDeadline} <span style={{ color: '#94A3B8', fontSize: 11 }}>({coverage.toFixed(0)}% do total)</span>
                </Td>
                <Td>{r.onTime}</Td>
                <Td>
                  <span style={{ fontWeight: 'bold', color: r.withDeadline === 0 ? '#94A3B8' : predictabilityColor(pct) }}>
                    {r.withDeadline === 0 ? '—' : `${pct.toFixed(0)}%`}
                  </span>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}

function StageDropdown({ value, detectedLabel, onChanged }: { value: string | undefined; detectedLabel: string; onChanged: (stage: string | null) => void }) {
  return (
    <select
      style={{ width: 190, fontSize: 12, padding: '6px 8px', borderRadius: 4, border: `1px solid ${BrandColors.border}` }}
      value={value ?? ''}
      onChange={(e) => onChanged(e.target.value === '' ? null : e.target.value)}
    >
      <option value="">Automático ({detectedLabel})</option>
      <option value="geral">Geral</option>
      <option value="desenvolvimento">Desenvolvimento</option>
    </select>
  );
}

function CycleTimeTable({
  rows,
  showStage = false,
  overrides,
  onStageChanged,
  onRowClick,
}: {
  rows: CycleTimeRanking[];
  showStage?: boolean;
  overrides?: Record<string, string>;
  onStageChanged?: (name: string, stage: string | null) => void;
  onRowClick: (name: string, items: ItemMetric[]) => void;
}) {
  return (
    <TableCard isEmpty={rows.length === 0} emptyMessage="Nenhum item concluído nesta sprint.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Responsável</Th>
            {showStage && <Th>Estágio</Th>}
            <Th>Mediana</Th>
            <Th>Média</Th>
            <Th>P85</Th>
            <Th>Itens</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} onClick={() => onRowClick(r.name, r.items)} style={{ cursor: 'pointer' }}>
              <Td>{i + 1}</Td>
              <Td>
                <ResponsibleTag name={r.name} />
              </Td>
              {showStage && (
                <Td>
                  {onStageChanged == null ? (
                    <span style={{ fontSize: 12, color: '#64748B' }}>{r.stageLabel ?? '—'}</span>
                  ) : (
                    <StageDropdown value={overrides?.[r.name]} detectedLabel={r.stageLabel ?? 'Geral'} onChanged={(stage) => onStageChanged(r.name, stage)} />
                  )}
                </Td>
              )}
              <Td>{r.median.toFixed(1)}d</Td>
              <Td>{r.average.toFixed(1)}d</Td>
              <Td>{r.p85.toFixed(1)}d</Td>
              <Td>{r.count}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/** One row per tag group — volume (entered/closed/conversão, same
 * definitions as the rest of the screen) plus average Cycle Time in
 * Desenvolvimento and Fila among the closed ones. The whole row is the
 * click target — opens TagRaioXDialog with everything behind these numbers
 * broken down, instead of a scatter of individually-underlined cells. */
function TagRankingTable({ rows, onRowClick }: { rows: TagRankingRow[]; onRowClick: (row: TagRankingRow) => void }) {
  return (
    <TableCard isEmpty={rows.length === 0} emptyMessage="Nenhuma tag configurada.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>Tag</Th>
            <Th>Entraram</Th>
            <Th>Concluídos</Th>
            <Th>Conversão</Th>
            <Th>Cycle Time Desenvolvimento</Th>
            <Th>Cycle Time Fila</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} onClick={() => onRowClick(r)} style={{ cursor: 'pointer' }}>
              <Td>
                <ResponsibleTag name={r.name} />
              </Td>
              <Td>{r.entered}</Td>
              <Td>{r.closed}</Td>
              <Td>{r.conversion == null ? '—' : `${r.conversion.toFixed(0)}%`}</Td>
              <Td>{r.devAvg == null ? '—' : `${r.devAvg.toFixed(1)}d`}</Td>
              <Td>{r.queueAvg == null ? '—' : `${r.queueAvg.toFixed(1)}d`}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/** Opens from a "Ranking de desenvolvimento" row — the raio-x behind every
 * number in it: which cards entered, which closed, and which counted
 * toward each Cycle Time average (with their individual days). For DH,
 * "Cycle Time Desenvolvimento" already folds Fornecedor time in
 * (devDaysOf), so its per-item day column reflects that combined value,
 * not just cycleTimeDays. */
function TagRaioXDialog({ row, onClose }: { row: TagRankingRow; onClose: () => void }) {
  const MiniTable = ({ items, note }: { items: ItemMetric[]; note?: (m: ItemMetric) => string }) => (
    <table style={tableStyle()}>
      <thead>
        <tr>
          <Th>ID</Th>
          <Th>Título</Th>
          <Th>Responsável</Th>
          <Th>{note ? 'Dias' : 'Status'}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((m) => (
          <tr key={m.item.id}>
            <Td>{m.item.id}</Td>
            <Td>
              <span style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
            </Td>
            <Td>{m.item.assignedTo || '—'}</Td>
            <Td>{note ? note(m) : m.done ? 'Concluído' : 'Aberto'}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Modal title={`Ranking de desenvolvimento — ${row.name}`} width={680} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 14 }}>Entraram — {row.entered}</div>
          <div style={{ height: 8 }} />
          {row.enteredItems.length === 0 ? <span style={{ fontSize: 13, color: '#64748B' }}>Nenhum.</span> : <MiniTable items={row.enteredItems} />}
        </div>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 14 }}>
            Concluídos — {row.closed} {row.conversion != null && `(${row.conversion.toFixed(0)}% de conversão)`}
          </div>
          <div style={{ height: 8 }} />
          {row.closedItems.length === 0 ? <span style={{ fontSize: 13, color: '#64748B' }}>Nenhum.</span> : <MiniTable items={row.closedItems} />}
        </div>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 14 }}>
            Cycle Time Desenvolvimento — {row.devAvg == null ? '—' : `${row.devAvg.toFixed(1)}d`}
            {row.name === 'DH' && <span style={{ fontWeight: 400, color: '#94A3B8' }}> (inclui tempo em Fornecedor)</span>}
          </div>
          <div style={{ height: 8 }} />
          {row.devItems.length === 0 ? (
            <span style={{ fontSize: 13, color: '#64748B' }}>Nenhum item com tempo mensurável.</span>
          ) : (
            <MiniTable items={row.devItems} note={(m) => `${row.devDaysOf(m).toFixed(1)}d`} />
          )}
        </div>
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 14 }}>Cycle Time Fila — {row.queueAvg == null ? '—' : `${row.queueAvg.toFixed(1)}d`}</div>
          <div style={{ height: 8 }} />
          {row.queueItems.length === 0 ? (
            <span style={{ fontSize: 13, color: '#64748B' }}>Nenhum item com tempo mensurável.</span>
          ) : (
            <MiniTable items={row.queueItems} note={(m) => `${m.queueDays.toFixed(1)}d`} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function HealthScoreBadge({ score }: { score: number }) {
  const color = predictabilityColor(score);
  return (
    <span style={{ display: 'inline-block', padding: '4px 10px', borderRadius: 999, backgroundColor: hexAlpha(color, 0.12), fontWeight: 'bold', color }}>
      {score.toFixed(0)}
    </span>
  );
}

function HealthScoreTable({ rows, onSelect }: { rows: HealthScoreRanking[]; onSelect: (row: HealthScoreRanking) => void }) {
  return (
    <TableCard isEmpty={rows.length === 0} emptyMessage="Nenhum item concluído nesta sprint.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>#</Th>
            <Th>Responsável</Th>
            <Th>Rastreabilidade</Th>
            <Th>Previsibilidade</Th>
            <Th>Velocidade</Th>
            <Th>Health Score</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} onClick={() => onSelect(r)} style={{ cursor: 'pointer' }}>
              <Td>{i + 1}</Td>
              <Td>
                <ResponsibleTag name={r.name} />
              </Td>
              <Td>
                {r.reliabilityScore.toFixed(0)}%{' '}
                <span style={{ color: '#94A3B8', fontSize: 11 }}>
                  ({r.completedItems.length - r.suspiciousItems.length}/{r.completedItems.length})
                </span>
              </Td>
              <Td>
                {r.predictabilityScore.toFixed(0)}%{' '}
                <span style={{ color: '#94A3B8', fontSize: 11 }}>
                  ({r.onTimeItems.length}/{r.completedItems.length})
                </span>
              </Td>
              <Td>
                {r.speedScore.toFixed(0)}%{' '}
                <span style={{ color: '#94A3B8', fontSize: 11 }}>
                  ({r.fastItems.length}/{r.completedItems.length})
                </span>
              </Td>
              <Td>
                <HealthScoreBadge score={r.score} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

function ScoreBadge({ label, tone }: { label: string; tone: 'good' | 'bad' | 'neutral' }) {
  const color = tone === 'good' ? BrandColors.user : tone === 'bad' ? BrandColors.danger : '#94A3B8';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color,
        backgroundColor: hexAlpha(color, 0.12),
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

/** Opens from a Health Score row — one table with every completed item and,
 * per item, exactly which components it counted toward ("conta para isso")
 * and which it didn't ("não por conta disso"), so every percentage in the
 * summary row can be checked against the same list everyone else's is. */
function HealthScoreDetailDialog({ row, onClose }: { row: HealthScoreRanking; onClose: () => void }) {
  const stageName = row.speedStage === 'desenvolvimento' ? 'Desenvolvimento' : row.speedStage === 'geral' ? 'Geral' : null;

  return (
    <Modal title={`Health Score — ${row.name}`} width={760} onClose={onClose}>
      <div style={{ fontSize: 12, color: '#64748B', marginBottom: 4 }}>
        Os 3 componentes são calculados sobre os mesmos {row.completedItems.length} itens concluídos — cada linha abaixo mostra se contou pra cada um deles.
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5 }}>
          <b>Rastreabilidade {row.reliabilityScore.toFixed(0)}%</b> — {row.completedItems.length - row.suspiciousItems.length}/{row.completedItems.length} não suspeitos
        </span>
        <span style={{ fontSize: 12.5 }}>
          <b>Previsibilidade {row.predictabilityScore.toFixed(0)}%</b> — {row.onTimeItems.length}/{row.completedItems.length} no prazo
        </span>
        <span style={{ fontSize: 12.5 }}>
          <b>Velocidade {row.speedScore.toFixed(0)}%</b> — {row.fastItems.length}/{row.completedItems.length} rápidos {stageName && `(mediana em ${stageName})`}
        </span>
      </div>
      {row.completedItems.length === 0 ? (
        <span style={{ fontSize: 13, color: '#64748B' }}>Nenhum item concluído nesta sprint.</span>
      ) : (
        <table style={tableStyle()}>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Título</Th>
              <Th>Rastreabilidade</Th>
              <Th>Previsibilidade</Th>
              <Th>Velocidade</Th>
            </tr>
          </thead>
          <tbody>
            {row.completedItems.map((m) => {
              const suspicious = row.suspiciousItems.includes(m);
              const onTime = row.onTimeItems.includes(m);
              const late = row.lateItems.includes(m);
              const fast = row.fastItems.includes(m);
              return (
                <tr key={m.item.id}>
                  <Td>{m.item.id}</Td>
                  <Td>
                    <span style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
                  </Td>
                  <Td>
                    <ScoreBadge label={suspicious ? 'Suspeito — não conta' : 'Conta'} tone={suspicious ? 'bad' : 'good'} />
                  </Td>
                  <Td>
                    {onTime && <ScoreBadge label="No prazo — conta" tone="good" />}
                    {late && <ScoreBadge label="Atrasado" tone="bad" />}
                    {!onTime && !late && <ScoreBadge label="Sem prazo" tone="neutral" />}
                  </Td>
                  <Td>
                    {suspicious ? (
                      <ScoreBadge label="Suspeito — não conta" tone="bad" />
                    ) : fast ? (
                      <ScoreBadge label={`Rápido (${(row.speedStage === 'desenvolvimento' ? m.cycleTimeDays : m.generalDays).toFixed(1)}d) — conta`} tone="good" />
                    ) : (
                      <ScoreBadge label={`Não rápido (${(row.speedStage === 'desenvolvimento' ? m.cycleTimeDays : m.generalDays).toFixed(1)}d)`} tone="neutral" />
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function AgingBucketTable({
  byArea,
  areas,
  onCellClick,
}: {
  byArea: Map<string, ItemMetric[]>;
  areas: string[];
  onCellClick: (label: string, items: ItemMetric[]) => void;
}) {
  const total = areas.reduce((s, a) => s + (byArea.get(a)?.length ?? 0), 0);
  return (
    <TableCard isEmpty={total === 0} emptyMessage="Nenhum item em aberto (fora Triagem) nesta sprint.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>Faixa</Th>
            {areas.map((a) => (
              <Th key={a}>{a}</Th>
            ))}
            <Th>Total</Th>
          </tr>
        </thead>
        <tbody>
          {AGING_BUCKETS.map((bucket) => {
            const totalItems = areas.flatMap((a) => (byArea.get(a) ?? []).filter((m) => bucketMatches(bucket, m.totalDays)));
            return (
              <tr key={bucket.label}>
                <Td>{bucket.label}</Td>
                {areas.map((a) => {
                  const items = (byArea.get(a) ?? []).filter((m) => bucketMatches(bucket, m.totalDays));
                  return (
                    <Td key={a}>
                      {items.length === 0 ? (
                        0
                      ) : (
                        <span onClick={() => onCellClick(`${bucket.label} — ${a}`, items)} style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}>
                          {items.length}
                        </span>
                      )}
                    </Td>
                  );
                })}
                <Td>
                  {totalItems.length === 0 ? (
                    <span style={{ fontWeight: 'bold' }}>0</span>
                  ) : (
                    <span onClick={() => onCellClick(bucket.label, totalItems)} style={{ fontWeight: 'bold', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                      {totalItems.length}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}

function SufferingCard({
  title,
  icon,
  color,
  subtitle,
  rows,
  onRowClick,
}: {
  title: string;
  icon: ReactNode;
  color: string;
  subtitle: string;
  rows: WaitRanking[];
  onRowClick: (name: string, items: ItemMetric[]) => void;
}) {
  return (
    <div style={{ ...cardStyle(), padding: 16 }}>
      <SectionHeader icon={icon} iconColor={color} title={title} subtitle={subtitle} />
      <div style={{ height: 14 }} />
      <CompactWaitList rows={rows} color={color} onRowClick={onRowClick} />
    </div>
  );
}

/** A dense leaderboard list — avatar, name, a proportional bar, and the day
 * count. Caps at 5 rows with a "+N mais" footer. */
function CompactWaitList({ rows, color, onRowClick }: { rows: WaitRanking[]; color: string; onRowClick: (name: string, items: ItemMetric[]) => void }) {
  const maxRows = 5;
  if (rows.length === 0) {
    return <span style={{ fontSize: 12, color: '#64748B' }}>Ninguém com itens parados aí agora.</span>;
  }
  const shown = rows.slice(0, maxRows);
  const maxDays = rows[0].totalDays <= 0 ? 1 : rows[0].totalDays;
  return (
    <div>
      {shown.map((r) => (
        <div key={r.name} onClick={() => onRowClick(r.name, r.items)} style={{ display: 'flex', alignItems: 'center', marginBottom: 10, cursor: 'pointer' }}>
          <div style={{ flex: 1 }}>
            <ResponsibleTag name={r.name} />
            <div style={{ height: 4 }} />
            <div style={{ height: 5, borderRadius: 3, backgroundColor: BrandColors.tableHeader, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(Math.max((r.totalDays / maxDays) * 100, 0), 100)}%`, backgroundColor: color }} />
            </div>
          </div>
          <div style={{ width: 10 }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 'bold', color }}>{r.totalDays.toFixed(0)}d</div>
            <div style={{ fontSize: 10, color: '#94A3B8' }}>
              {r.count} {r.count === 1 ? 'item' : 'itens'}
            </div>
          </div>
        </div>
      ))}
      {rows.length > maxRows && <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>+{rows.length - maxRows} mais</span>}
    </div>
  );
}

function ItemListTable({ metrics, valueLabel, valueSelector }: { metrics: ItemMetric[]; valueLabel: string; valueSelector: (m: ItemMetric) => number }) {
  return (
    <TableCard isEmpty={metrics.length === 0} emptyMessage="Nenhum item nesta lista.">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Título</Th>
            <Th>Responsável</Th>
            <Th>Área</Th>
            <Th>Tags</Th>
            <Th>Criado em</Th>
            <Th>{valueLabel}</Th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.item.id}>
              <Td>{m.item.id}</Td>
              <Td>
                <span style={{ display: 'inline-block', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
              </Td>
              <Td>
                <ResponsibleTag name={m.item.assignedTo} />
              </Td>
              <Td>{areaLeaf(m.item.areaPath)}</Td>
              <Td>
                <TagChips tags={m.item.tags} />
              </Td>
              <Td>{formatDate(m.item.createdDate)}</Td>
              <Td>{valueSelector(m).toFixed(1)} dias</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}
