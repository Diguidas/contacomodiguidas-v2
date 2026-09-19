import { boardColumnMatches, WorkItem } from '../models/workItem';
import { AppSettings } from './settingsService';
import { ItemMetric, MetricsCalculator } from './metricsService';
import { Sprint } from './sprintService';

// Sprint.end is a bare date (midnight) while ItemMetric.endDate carries a
// real time-of-day — comparing them directly would misread anything closed
// during the daytime of the sprint's last day (a common pattern: people
// rush to close tickets right before a sprint ends) as having finished
// "after" the sprint. This is the inclusive end-of-day cutoff every "as of
// this sprint's end" check below needs to use instead.
export function sprintCutoff(sprint: Sprint): Date {
  return new Date(sprint.end.getTime() + 24 * 60 * 60 * 1000);
}

// Whether `item` was created within `sprint`'s date window.
export function createdInSprint(item: WorkItem, sprint: Sprint): boolean {
  const d = item.createdDate;
  return d.getTime() >= sprint.start.getTime() && d.getTime() <= sprintCutoff(sprint).getTime();
}

// Whether `m` finished within `sprint`'s date window.
export function endedInSprint(m: ItemMetric, sprint: Sprint): boolean {
  if (!m.done) return false;
  const end = m.endDate;
  if (end == null) return false;
  return end.getTime() >= sprint.start.getTime() && end.getTime() <= sprintCutoff(sprint).getTime();
}

// Whether `m` was already in flight when `sprint` began — created before
// its start and not yet done by then. This is what makes a sprint's
// "entered" count carry forward: a card left open at one sprint's "saída"
// is exactly what shows up here as carry-over on the next.
//
// This only needs `m.endDate` (the item's *real* completion date, worked
// out from its full history regardless of what "now" is) and never
// `m.done` as a live/current flag — so it's already safe to use for a past
// sprint, as long as `m` itself was actually fetched. That fetch is the
// part that needs care: an item finished in a *later* sprint has a
// WorkItem.changedDate stamped with that later date, so a query scoped
// narrowly to just this sprint's window would miss it entirely — which is
// exactly the bug that made every past sprint look artificially like 100%
// done. The fix lives in the caller: fetch one broad set of items (any
// window covering every sprint being compared) and reuse it for all of
// them, instead of one narrow query per sprint.
export function carriedIntoSprint(m: ItemMetric, sprint: Sprint): boolean {
  if (!(m.item.createdDate.getTime() < sprint.start.getTime())) return false;
  if (!m.done) return true;
  const end = m.endDate;
  return end == null || !(end.getTime() < sprint.start.getTime());
}

// Whether `m` had already finished by `asOf` — using its real, history-
// derived ItemMetric.endDate rather than ItemMetric.done, which only ever
// reflects the item's status *now*. An item currently done but whose real
// endDate falls after `asOf` hadn't finished yet as of that moment.
export function doneAsOf(m: ItemMetric, asOf: Date): boolean {
  return m.done && m.endDate != null && !(m.endDate.getTime() > asOf.getTime());
}

// Whether `m` should be attributed to `name` for any "por responsável"
// grouping/filter across the app — not just literal WorkItem.assignedTo.
// `settings.myDisplayName` and `settings.tagFilter` model one specific
// relationship: `tagFilter` (e.g. "Guilherme") marks a card someone else
// owns as also needing myDisplayName's work at some point — including
// myDisplayName's own cards, which carry the tag too by habit, so this is
// naturally idempotent for those (already true via the assignedTo check).
// For a card actually assigned to someone else: it only becomes "his" once
// there's something concrete to credit — it's done (the tagged work got
// delivered, whichever column it happened to finish in), or it's sitting in
// Desenvolvedor *right now* (someone is actively working it on his behalf
// this moment). Still open in Triagem/Fila/Usuário/Fornecedor/Geral isn't
// "his" yet — nobody has picked it up as dev work for him, so counting it
// early would attribute demand he has no actual claim on yet. This is
// additive, not a reassignment: the card still also counts for whoever it's
// literally assigned to wherever that grouping happens independently.
export function isAttributedTo(m: ItemMetric, name: string, settings: AppSettings): boolean {
  const trimmedName = name.trim();
  if (m.item.assignedTo.trim().toLowerCase() === trimmedName.toLowerCase()) return true;
  if (trimmedName.toLowerCase() !== settings.myDisplayName.trim().toLowerCase()) return false;
  const tag = settings.tagFilter.trim().toLowerCase();
  if (tag === '') return false;
  const hasTag = m.item.tags.some((t) => t.trim().toLowerCase() === tag);
  if (!hasTag) return false;
  if (m.done) return true;
  return boardColumnMatches(settings.developerColumnSet, m.item.currentBoardColumn);
}

// Groups `metrics` by assignedTo, then additionally credits
// settings.myDisplayName with every item isAttributedTo says belongs to him
// via the tag but is literally assigned elsewhere. Additive: those items
// stay in their literal assignee's bucket too.
export function attributedGroupBy(metrics: ItemMetric[], settings: AppSettings): Map<string, ItemMetric[]> {
  const byName = new Map<string, ItemMetric[]>();
  for (const m of metrics) {
    const name = m.item.assignedTo.trim();
    if (name === '') continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(m);
  }
  const tagOwner = settings.myDisplayName.trim();
  if (tagOwner !== '') {
    for (const m of metrics) {
      if (m.item.assignedTo.trim().toLowerCase() === tagOwner.toLowerCase()) continue;
      if (!isAttributedTo(m, tagOwner, settings)) continue;
      if (!byName.has(tagOwner)) byName.set(tagOwner, []);
      byName.get(tagOwner)!.push(m);
    }
  }
  return byName;
}

// `entered` (newThisSprint + carriedOver) and `closed` items for `sprint`,
// with the same only-User-Story + Triagem-as-of-cutoff scope
// buildSprintSnapshot uses — so any per-responsible/per-área/per-estágio
// breakdown built from this matches that same snapshot's headline numbers.
// Shared by every "how did X evolve sprint over sprint" view (cycle time by
// área/estágio/responsável, conversão por responsável) so each one doesn't
// recompute the same metrics pass.
export function sprintScope(params: {
  items: WorkItem[];
  settings: AppSettings;
  sprint: Sprint;
}): { entered: ItemMetric[]; closed: ItemMetric[] } {
  const { items, settings, sprint } = params;
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
  const valid = items.filter((i) => !i.isCancelled).filter((i) => i.type.trim().toLowerCase() === 'user story');
  const allMetrics = calculator.calculate(valid).metrics;
  const cutoff = sprintCutoff(sprint);
  const scoped = allMetrics.filter((m) => {
    if (doneAsOf(m, cutoff)) return true;
    const column = m.item.boardColumnAsOf(cutoff);
    return !boardColumnMatches(settings.triageColumnSet, column);
  });
  const newThisSprint = scoped.filter((m) => createdInSprint(m.item, sprint));
  const carriedOver = scoped.filter((m) => carriedIntoSprint(m, sprint));
  return {
    entered: [...newThisSprint, ...carriedOver],
    closed: scoped.filter((m) => endedInSprint(m, sprint)),
  };
}

// One sprint's headline numbers — the same figures shown on the "Todas as
// áreas" card in Visão do time, snapshotted so they can be compared across
// sprints instead of only ever seen one at a time.
export class SprintSnapshot {
  readonly sprintNumber: number;
  readonly entered: number;
  readonly closed: number;
  readonly stillOpen: number;
  readonly generalDaysAvg: number | null;

  constructor(init: {
    sprintNumber: number;
    entered: number;
    closed: number;
    stillOpen: number;
    generalDaysAvg: number | null;
  }) {
    this.sprintNumber = init.sprintNumber;
    this.entered = init.entered;
    this.closed = init.closed;
    this.stillOpen = init.stillOpen;
    this.generalDaysAvg = init.generalDaysAvg;
  }

  get conversionPercent(): number | null {
    return this.entered === 0 ? null : (this.closed / this.entered) * 100;
  }

  toJSON(): Record<string, unknown> {
    return {
      sprintNumber: this.sprintNumber,
      entered: this.entered,
      closed: this.closed,
      stillOpen: this.stillOpen,
      generalDaysAvg: this.generalDaysAvg,
    };
  }

  static fromJSON(json: Record<string, unknown>): SprintSnapshot {
    return new SprintSnapshot({
      sprintNumber: json.sprintNumber as number,
      entered: json.entered as number,
      closed: json.closed as number,
      stillOpen: json.stillOpen as number,
      generalDaysAvg: json.generalDaysAvg == null ? null : Number(json.generalDaysAvg),
    });
  }
}

// Computes a SprintSnapshot from raw `items` fetched for that sprint's
// window, using the exact same scope as the team dashboard's area cards:
// Non-User-Story items dropped, and items still open in Triagem excluded
// (Triagem is a queue nobody chooses to sit in, not real demand).
export function buildSprintSnapshot(params: {
  items: WorkItem[];
  settings: AppSettings;
  sprint: Sprint;
}): SprintSnapshot {
  const { items, settings, sprint } = params;
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
  const valid = items
    .filter((i) => !i.isCancelled)
    .filter((i) => i.type.trim().toLowerCase() === 'user story');
  const allMetrics = calculator.calculate(valid).metrics;
  // "Scoped" here means "as this sprint would have seen it" — a card
  // finished in a later sprint but still open in Triagem *as of this
  // sprint's end* must still be excluded, even though it reads as done and
  // sitting in the Concluído column today.
  const cutoff = sprintCutoff(sprint);
  const scoped = allMetrics.filter((m) => {
    if (doneAsOf(m, cutoff)) return true;
    const column = m.item.boardColumnAsOf(cutoff);
    return !boardColumnMatches(settings.triageColumnSet, column);
  });

  const newThisSprint = scoped.filter((m) => createdInSprint(m.item, sprint));
  const carriedOver = scoped.filter((m) => carriedIntoSprint(m, sprint));
  const entered = [...newThisSprint, ...carriedOver];
  const closed = scoped.filter((m) => endedInSprint(m, sprint));
  const stillOpen = entered.filter((m) => !doneAsOf(m, cutoff)).length;
  const generalDaysAvg =
    closed.length === 0 ? null : closed.reduce((s, m) => s + m.generalDays, 0) / closed.length;

  return new SprintSnapshot({
    sprintNumber: sprint.number,
    entered: entered.length,
    closed: closed.length,
    stillOpen,
    generalDaysAvg,
  });
}

// One toggleable bucket in the "Ranking de performance" chip row (Visão do
// time) and its history-screen counterpart. Each checks board-column
// membership against the matching AppSettings set, so renaming columns on
// the Agrupamento screen keeps working here for free.
export interface PerformanceGroup {
  key: string;
  label: string;
  description: string;
  columnsOf: (s: AppSettings) => Set<string>;
}

export const performanceGroups: PerformanceGroup[] = [
  {
    key: 'triagem',
    label: 'Triagem',
    description:
      'Item acabou de entrar, ainda ninguém pegou pra analisar — fila automática, ' +
      'não é escolha de ninguém. Marcado = itens abertos aqui contam contra quem está com ' +
      'eles. Recomendado: desmarcado.',
    columnsOf: (s) => s.triageColumnSet,
  },
  {
    key: 'fila',
    label: 'Fila',
    description:
      'Já triado e liberado pro desenvolvedor, mas ainda esperando alguém pegar. ' +
      'Marcado = itens abertos aqui contam contra o responsável atual.',
    columnsOf: (s) => s.queueColumnSet,
  },
  {
    key: 'desenvolvedor',
    label: 'Desenvolvedor',
    description:
      'Em desenvolvimento ou em correção agora — trabalho realmente em andamento. ' +
      'Marcado = itens abertos aqui contam contra o responsável atual.',
    columnsOf: (s) => s.developerColumnSet,
  },
  {
    key: 'usuario',
    label: 'Usuário',
    description:
      'Esperando o solicitante definir algo ou validar o que foi entregue — depende de ' +
      'terceiro, não do responsável. Marcado = itens abertos aqui contam contra ele mesmo assim.',
    columnsOf: (s) => s.userColumnSet,
  },
  {
    key: 'fornecedor',
    label: 'Fornecedor',
    description:
      'Esperando um fornecedor/terceiro externo responder ou entregar algo — fora do ' +
      'controle do responsável. Marcado = itens abertos aqui contam contra ele mesmo assim.',
    columnsOf: (s) => s.vendorColumnSet,
  },
  {
    key: 'geral',
    label: 'Geral',
    description:
      'Fluxo normal do card (Backlog, Em Andamento, Validação Funcional etc.) — o ' +
      'estágio mais "neutro", sem espera clara de terceiro. Marcado = itens abertos aqui ' +
      'contam contra o responsável.',
    columnsOf: (s) => s.generalColumnSet,
  },
];

// Every group except Triagem — the default scope used both by the Visão do
// time chips and the history screen.
export const defaultPerformanceGroupKeys: Set<string> = new Set(
  performanceGroups.filter((g) => g.key !== 'triagem').map((g) => g.key),
);

// One responsible's Base/Concluídos for a given sprint under a given chip
// selection — the same figures shown in "Ranking de performance". Carries
// the underlying `items` too, so the screen can compute a quality-adjusted
// "Concluídos líquidos" (discounting suspicious items or low-value request
// types) without a second full pass over the raw data.
export class ResponsiblePerformance {
  readonly name: string;
  readonly base: number;
  readonly closed: number;
  readonly items: ItemMetric[];

  constructor(init: { name: string; base: number; closed: number; items: ItemMetric[] }) {
    this.name = init.name;
    this.base = init.base;
    this.closed = init.closed;
    this.items = init.items;
  }

  get percent(): number {
    return this.base === 0 ? 0 : (this.closed / this.base) * 100;
  }
}

// Builds the per-responsible performance ranking for `items` — the same
// rules as Visão do time: a chip must be checked for an *open* item's stage
// to count against its holder (finished items always count), plus
// isAttributedTo's extra credit for AppSettings.myDisplayName on
// tag-only items (see isAttributedTo for the exact rule).
export function buildPerformanceRanking(params: {
  items: WorkItem[];
  settings: AppSettings;
  selectedGroupKeys: Set<string>;
  asOf?: Date | null;
}): ResponsiblePerformance[] {
  const { items, settings, selectedGroupKeys, asOf } = params;
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
  const valid = items
    .filter((i) => !i.isCancelled)
    .filter((i) => i.type.trim().toLowerCase() === 'user story');
  const allMetrics = calculator.calculate(valid, asOf ?? undefined).metrics;

  function matchesSelectedGroups(m: ItemMetric): boolean {
    if (m.done) return true;
    const column = m.item.currentBoardColumn;
    return performanceGroups.some(
      (g) => selectedGroupKeys.has(g.key) && boardColumnMatches(g.columnsOf(settings), column),
    );
  }

  const byName = new Map<string, ItemMetric[]>();
  for (const m of allMetrics.filter(matchesSelectedGroups)) {
    const name = m.item.assignedTo.trim();
    if (name === '') continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(m);
  }

  const tagOwner = settings.myDisplayName.trim();
  if (tagOwner !== '') {
    for (const m of allMetrics) {
      if (m.item.assignedTo.trim().toLowerCase() === tagOwner.toLowerCase()) continue; // already counted above
      if (!isAttributedTo(m, tagOwner, settings)) continue;
      if (!byName.has(tagOwner)) byName.set(tagOwner, []);
      byName.get(tagOwner)!.push(m);
    }
  }

  return [...byName.entries()].map(
    ([name, value]) =>
      new ResponsiblePerformance({
        name,
        base: value.length,
        closed: value.filter((m) => m.done).length,
        items: value,
      }),
  );
}

// A single at-a-glance number per responsible, combining three signals
// that each already have their own full ranking in Visão do time — meant
// for "who needs a closer look", not to replace those rankings. Every
// component is deliberately measured against the SAME denominator —
// this person's total completed items — instead of each picking its own
// applicable subset. That's what keeps everyone "on the same page": a
// component computed over just 1 of 20 items (small, cherry-picked base)
// reads very differently from one computed over 1 of 1, but a ratio alone
// can't tell them apart. Each component is scored 0-100 (higher always
// better) and always divided by all 3 to get `score` — an item that
// doesn't qualify for a component (no deadline, marked suspicious) simply
// doesn't add to that component's numerator, same as it would for anyone
// else missing that signal:
// - Rastreabilidade: (concluídos − suspeitos) / concluídos. Suspicious items
//   (untracked gap or suspiciously fast) don't count as reliably tracked.
// - Previsibilidade: (concluídos no prazo) / concluídos. An item with no
//   deadline recorded simply isn't "no prazo" — it doesn't inflate the
//   score the way dividing only by "items that had a deadline" would for
//   someone with just one (already on-time) deadline ever set.
// - Velocidade: (concluídos rápidos, excluindo suspeitos) / concluídos.
//   "Rápido" means the item's relevant duration (Geral or Desenvolvimento,
//   whichever stage this person actually works in) falls at or below the
//   team-wide median duration for that same signal this sprint — one
//   shared yardstick for everyone, rather than each person's score being
//   relative to their own single fastest item.
export class HealthScoreRanking {
  readonly name: string;
  readonly score: number;
  readonly reliabilityScore: number;
  readonly predictabilityScore: number;
  readonly speedScore: number;
  // Every completed item, plus which components each one counted toward —
  // so the UI can show "conta para isso, não por conta daquilo" per item
  // instead of just the final percentages.
  readonly completedItems: ItemMetric[];
  readonly suspiciousItems: ItemMetric[];
  readonly onTimeItems: ItemMetric[];
  readonly lateItems: ItemMetric[];
  readonly noDeadlineItems: ItemMetric[];
  readonly fastItems: ItemMetric[];
  readonly notFastItems: ItemMetric[];
  readonly speedStage: 'geral' | 'desenvolvimento' | null;

  constructor(init: {
    name: string;
    score: number;
    reliabilityScore: number;
    predictabilityScore: number;
    speedScore: number;
    completedItems: ItemMetric[];
    suspiciousItems: ItemMetric[];
    onTimeItems: ItemMetric[];
    lateItems: ItemMetric[];
    noDeadlineItems: ItemMetric[];
    fastItems: ItemMetric[];
    notFastItems: ItemMetric[];
    speedStage: 'geral' | 'desenvolvimento' | null;
  }) {
    this.name = init.name;
    this.score = init.score;
    this.reliabilityScore = init.reliabilityScore;
    this.predictabilityScore = init.predictabilityScore;
    this.speedScore = init.speedScore;
    this.completedItems = init.completedItems;
    this.suspiciousItems = init.suspiciousItems;
    this.onTimeItems = init.onTimeItems;
    this.lateItems = init.lateItems;
    this.noDeadlineItems = init.noDeadlineItems;
    this.fastItems = init.fastItems;
    this.notFastItems = init.notFastItems;
    this.speedStage = init.speedStage;
  }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Builds HealthScoreRankings for every responsible with at least one
// completed item among `items` — same scope (User Story only) as
// every other ranking in this file.
export function buildHealthScoreRanking(params: {
  items: WorkItem[];
  settings: AppSettings;
  asOf?: Date | null;
}): HealthScoreRanking[] {
  const { items, settings, asOf } = params;
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
  const valid = items
    .filter((i) => !i.isCancelled)
    .filter((i) => i.type.trim().toLowerCase() === 'user story');
  const allMetrics = calculator.calculate(valid, asOf ?? undefined).metrics;

  const byName = new Map<string, ItemMetric[]>();
  for (const m of allMetrics.filter((m) => m.done)) {
    const name = m.item.assignedTo.trim();
    if (name === '') continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(m);
  }
  // isAttributedTo's tag-credit: a done item assigned elsewhere but tagged
  // for settings.myDisplayName counts toward their Health Score too, same
  // as every other "por responsável" view in the app.
  const tagOwner = settings.myDisplayName.trim();
  if (tagOwner !== '') {
    for (const m of allMetrics.filter((m) => m.done)) {
      if (m.item.assignedTo.trim().toLowerCase() === tagOwner.toLowerCase()) continue;
      if (!isAttributedTo(m, tagOwner, settings)) continue;
      if (!byName.has(tagOwner)) byName.set(tagOwner, []);
      byName.get(tagOwner)!.push(m);
    }
  }
  if (byName.size === 0) return [];

  // Each person is measured on the stage where they actually work — Geral
  // or Desenvolvimento. Respects the manual override set in Visão do time
  // (settings.personStageOverrides) so this stays consistent with the
  // "Ranking de execução própria" table; falls back to auto-detecting
  // whichever stage they accumulated more time in from their own
  // non-suspicious completed items. Otherwise someone who works in
  // Desenvolvimento reads as if they never touched Geral, which would
  // misclassify every one of their items.
  const stageByName = new Map<string, 'geral' | 'desenvolvimento' | null>();
  for (const [name, value] of byName.entries()) {
    const reliable = value.filter((m) => !m.isSuspicious);
    if (reliable.length === 0) {
      stageByName.set(name, null);
      continue;
    }
    const override = settings.personStageOverrides[name];
    let useDeveloper: boolean;
    if (override === 'desenvolvimento') {
      useDeveloper = true;
    } else if (override === 'geral') {
      useDeveloper = false;
    } else {
      const totalDeveloper = reliable.reduce((s, m) => s + m.cycleTimeDays, 0);
      const totalGeneral = reliable.reduce((s, m) => s + m.generalDays, 0);
      useDeveloper = totalDeveloper > totalGeneral;
    }
    stageByName.set(name, useDeveloper ? 'desenvolvimento' : 'geral');
  }

  // One shared "fast" cutoff for the whole team this sprint — the median
  // duration (in each person's own stage) across everyone's non-suspicious
  // completed items — so "rápido" means the same thing for everyone being
  // compared, instead of each person being judged against their own best.
  const allDurations: number[] = [];
  for (const [name, value] of byName.entries()) {
    const stage = stageByName.get(name);
    if (stage == null) continue;
    for (const m of value) {
      if (m.isSuspicious) continue;
      allDurations.push(stage === 'desenvolvimento' ? m.cycleTimeDays : m.generalDays);
    }
  }
  const teamMedianDuration = allDurations.length === 0 ? null : medianOf(allDurations);

  const rows = [...byName.entries()].map(([name, completed]) => {
    const suspiciousItems = completed.filter((m) => m.isSuspicious);
    const reliabilityScore = ((completed.length - suspiciousItems.length) / completed.length) * 100;

    const onTimeItems = completed.filter((m) => m.isOnTime === true);
    const lateItems = completed.filter((m) => m.isOnTime === false);
    const noDeadlineItems = completed.filter((m) => m.isOnTime == null);
    const predictabilityScore = (onTimeItems.length / completed.length) * 100;

    const stage = stageByName.get(name) ?? null;
    const durationOf = (m: ItemMetric) => (stage === 'desenvolvimento' ? m.cycleTimeDays : m.generalDays);
    const fastItems =
      teamMedianDuration == null
        ? []
        : completed.filter((m) => !m.isSuspicious && durationOf(m) <= teamMedianDuration);
    const notFastItems = completed.filter((m) => !fastItems.includes(m));
    const speedScore = (fastItems.length / completed.length) * 100;

    // Every component shares the same denominator (concluídos), so nothing
    // here is ever "missing data" the way a with-deadline-only or
    // attributable-only base could be — always a plain average of the 3.
    const score = (reliabilityScore + predictabilityScore + speedScore) / 3;

    return new HealthScoreRanking({
      name,
      score,
      reliabilityScore,
      predictabilityScore,
      speedScore,
      completedItems: completed,
      suspiciousItems,
      onTimeItems,
      lateItems,
      noDeadlineItems,
      fastItems,
      notFastItems,
      speedStage: stage,
    });
  });
  rows.sort((a, b) => b.score - a.score);
  return rows;
}
