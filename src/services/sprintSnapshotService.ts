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

// "Atrasados da sprint": cards whose *original* deadline fell inside
// `sprint` and that missed it — either concluded after the deadline
// (`doneLate`) or still open with the deadline already passed as of `now`
// (`stillOpen`). A card belongs to the sprint it promised to deliver in, so
// a past sprint's number only moves when one of its still-open cards
// finally closes (it just changes bucket). Cards with no original deadline
// can't be late and are ignored, as is anything cancelled.
export function overdueForSprint(
  metrics: ItemMetric[],
  sprint: Sprint,
  now: Date = new Date(),
): { doneLate: ItemMetric[]; stillOpen: ItemMetric[] } {
  const start = sprint.start.getTime();
  const end = sprintCutoff(sprint).getTime();
  const doneLate: ItemMetric[] = [];
  const stillOpen: ItemMetric[] = [];
  for (const m of metrics) {
    if (m.item.isCancelled) continue;
    const target = m.item.originalTargetDate;
    if (target == null || target.getTime() < start || target.getTime() >= end) continue;
    if (m.done) {
      if (m.endDate != null && m.item.isLate(m.endDate) === true) doneLate.push(m);
    } else if (m.item.isLate(now) === true) {
      stillOpen.push(m);
    }
  }
  return { doneLate, stillOpen };
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
  /** Média de "Cycle Time do time" (total − Triagem − Backlog) dos fechados. */
  readonly cycleDaysAvg: number | null;
  /** Atrasados da sprint (prazo original na sprint): concluídos com atraso. */
  readonly overdueDone: number;
  /** Atrasados da sprint: ainda abertos com o prazo vencido. */
  readonly overdueOpen: number;

  constructor(init: {
    sprintNumber: number;
    entered: number;
    closed: number;
    stillOpen: number;
    cycleDaysAvg: number | null;
    overdueDone: number;
    overdueOpen: number;
  }) {
    this.sprintNumber = init.sprintNumber;
    this.entered = init.entered;
    this.closed = init.closed;
    this.stillOpen = init.stillOpen;
    this.cycleDaysAvg = init.cycleDaysAvg;
    this.overdueDone = init.overdueDone;
    this.overdueOpen = init.overdueOpen;
  }

  get overdueTotal(): number {
    return this.overdueDone + this.overdueOpen;
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
      cycleDaysAvg: this.cycleDaysAvg,
      overdueDone: this.overdueDone,
      overdueOpen: this.overdueOpen,
    };
  }

  static fromJSON(json: Record<string, unknown>): SprintSnapshot {
    return new SprintSnapshot({
      sprintNumber: json.sprintNumber as number,
      entered: json.entered as number,
      closed: json.closed as number,
      stillOpen: json.stillOpen as number,
      cycleDaysAvg: json.cycleDaysAvg == null ? null : Number(json.cycleDaysAvg),
      overdueDone: Number(json.overdueDone ?? 0),
      overdueOpen: Number(json.overdueOpen ?? 0),
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
  const overdue = overdueForSprint(scoped, sprint);
  const cycleDaysAvg =
    closed.length === 0 ? null : closed.reduce((s, m) => s + m.teamCycleDays, 0) / closed.length;

  return new SprintSnapshot({
    sprintNumber: sprint.number,
    entered: entered.length,
    closed: closed.length,
    stillOpen,
    cycleDaysAvg,
    overdueDone: overdue.doneLate.length,
    overdueOpen: overdue.stillOpen.length,
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
// rules as Visão do time: every non-cancelled item counts except open ones
// in Aguardando Fornecedor (finished items always count), plus
// isAttributedTo's extra credit for AppSettings.myDisplayName on
// tag-only items (see isAttributedTo for the exact rule).
export function buildPerformanceRanking(params: {
  items: WorkItem[];
  settings: AppSettings;
  asOf?: Date | null;
}): ResponsiblePerformance[] {
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

  // Fixed Base: everything not cancelled (Removed / Sem retorno do usuário
  // are already dropped via isCancelled above) except open items parked in
  // Aguardando Fornecedor — out of the responsible's hands.
  function countsInBase(m: ItemMetric): boolean {
    if (m.done) return true;
    return !boardColumnMatches(settings.vendorColumnSet, m.item.currentBoardColumn);
  }

  const byName = new Map<string, ItemMetric[]>();
  for (const m of allMetrics.filter(countsInBase)) {
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
