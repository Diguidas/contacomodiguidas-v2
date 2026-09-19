import { WorkItem } from '../models/workItem';

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * A work item's computed timing, broken down by who/what the wait time is
 * attributed to. Every `*Days` getter reflects only the wall-clock time the
 * item's Kanban board column actually sat inside that bucket's columns, up
 * to `endDate` if done, or up to now if still open — never total elapsed
 * time. `totalDays` is the one exception: full time from creation to
 * conclusion, regardless of column.
 */
export class ItemMetric {
  readonly item: WorkItem;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly done: boolean;
  readonly triageDurationMs: number;
  readonly queueDurationMs: number;
  readonly developerDurationMs: number;
  readonly userDurationMs: number;
  readonly vendorDurationMs: number;
  readonly generalDurationMs: number;
  readonly totalDurationMs: number;

  constructor(init: {
    item: WorkItem;
    startDate: Date | null;
    endDate: Date | null;
    done: boolean;
    triageDurationMs: number;
    queueDurationMs: number;
    developerDurationMs: number;
    userDurationMs: number;
    vendorDurationMs: number;
    generalDurationMs: number;
    totalDurationMs: number;
  }) {
    this.item = init.item;
    this.startDate = init.startDate;
    this.endDate = init.endDate;
    this.done = init.done;
    this.triageDurationMs = init.triageDurationMs;
    this.queueDurationMs = init.queueDurationMs;
    this.developerDurationMs = init.developerDurationMs;
    this.userDurationMs = init.userDurationMs;
    this.vendorDurationMs = init.vendorDurationMs;
    this.generalDurationMs = init.generalDurationMs;
    this.totalDurationMs = init.totalDurationMs;
  }

  get triageDays(): number {
    return this.triageDurationMs / MS_PER_HOUR / 24.0;
  }
  get queueDays(): number {
    return this.queueDurationMs / MS_PER_HOUR / 24.0;
  }
  get userDays(): number {
    return this.userDurationMs / MS_PER_HOUR / 24.0;
  }
  get vendorDays(): number {
    return this.vendorDurationMs / MS_PER_HOUR / 24.0;
  }
  get generalDays(): number {
    return this.generalDurationMs / MS_PER_HOUR / 24.0;
  }

  /** "Cycle time" in this app always means developer-attributed time
   * (Desenvolvimento / Em Correção) — the one the user is measured on. */
  get cycleTimeDays(): number {
    return this.developerDurationMs / MS_PER_HOUR / 24.0;
  }

  /** Full elapsed time from creation to conclusion (or now, if still open) —
   * counts every column the card passed through, backlog included. */
  get totalDays(): number {
    return this.totalDurationMs / MS_PER_HOUR / 24.0;
  }

  /** Flow efficiency: the fraction of the item's total elapsed time that was
   * actually spent being worked on (developer time) rather than waiting.
   * 100% would mean it was in Desenvolvimento/Em Correção the whole time;
   * most real flows sit well below that. */
  get flowEfficiencyPercent(): number {
    return this.totalDays > 0 ? (this.cycleTimeDays / this.totalDays) * 100 : 0;
  }

  /** Whether this item was delivered on time — null if it has no promised
   * deadline (targetDate), or isn't done yet. */
  get isOnTime(): boolean | null {
    if (!this.done || this.endDate == null) return null;
    const late = this.item.isLate(this.endDate);
    if (late == null) return null;
    return !late;
  }

  /** Time spent waiting on people/teams outside the analyst's control:
   * developer, vendor, requesting user, the dev queue (waiting for a
   * developer to become available), and Triagem — every card lands in
   * Triagem automatically and how fast it moves out depends on the
   * analyst's overall workload/backlog, not a choice they make on that
   * one card, so it's not held against them individually either. */
  get externalWaitDurationMs(): number {
    return (
      this.triageDurationMs +
      this.queueDurationMs +
      this.developerDurationMs +
      this.userDurationMs +
      this.vendorDurationMs
    );
  }

  get externalWaitDays(): number {
    return this.externalWaitDurationMs / MS_PER_HOUR / 24.0;
  }

  /** Time spent in the one stage that's genuinely the analyst's own
   * judgment call on this specific card (Geral). */
  get analystControlledDays(): number {
    return this.generalDays;
  }

  /** For a late item: would it *still* have missed the original deadline
   * if all external waiting (dev/vendor/user/queue) is subtracted from the
   * timeline? true = the analyst's own flow is why it's late; false = the
   * delay is attributable to waiting on someone else; null = not late, or
   * missing the data needed to judge (no deadline, not done yet). */
  get isDelayAttributableToAnalyst(): boolean | null {
    if (this.isOnTime !== false) return null;
    const target = this.item.originalTargetDate;
    const end = this.endDate;
    if (target == null || end == null) return null;
    const hypotheticalEnd = new Date(end.getTime() - this.externalWaitDurationMs);
    return hypotheticalEnd.getTime() > target.getTime();
  }

  /** Sum of every tracked category — should roughly equal totalDurationMs.
   * When it's much smaller, the card spent real time somewhere that never
   * shows up as a column change (e.g. it sat untouched, or moved through
   * columns too fast for the updates feed to catch cleanly). */
  get categorizedDurationMs(): number {
    return (
      this.triageDurationMs +
      this.queueDurationMs +
      this.developerDurationMs +
      this.userDurationMs +
      this.vendorDurationMs +
      this.generalDurationMs
    );
  }

  /** % of the item's total time that ISN'T accounted for by any tracked
   * column. Only meaningful once it's done and took at least some time. */
  get untrackedGapPercent(): number {
    const totalMinutes = this.totalDurationMs / 60000;
    if (totalMinutes <= 0) return 0;
    const categorizedMinutes = this.categorizedDurationMs / 60000;
    const pct = ((totalMinutes - categorizedMinutes) / totalMinutes) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  /** Flags a completed item whose column history barely explains where the
   * time went — a big chunk of its life is untracked. */
  get hasUntrackedGap(): boolean {
    return this.done && this.totalDurationMs / MS_PER_HOUR >= 4 && this.untrackedGapPercent >= 60;
  }

  /** Flags a completed item resolved suspiciously fast — created and closed
   * within a few hours, which either means a genuinely trivial request or
   * someone closing it without doing the tracked work. */
  get isSuspiciouslyFast(): boolean {
    return this.done && this.totalDurationMs / MS_PER_HOUR < 4;
  }

  get isSuspicious(): boolean {
    return this.hasUntrackedGap || this.isSuspiciouslyFast;
  }
}

export class MetricsSummary {
  readonly metrics: ItemMetric[];

  constructor(metrics: ItemMetric[]) {
    this.metrics = metrics;
  }

  get completed(): ItemMetric[] {
    return this.metrics.filter((m) => m.done);
  }

  get inProgress(): ItemMetric[] {
    return this.metrics.filter((m) => !m.done);
  }

  private average(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  get averageCycleTimeDays(): number | null {
    return this.averageMetricDays((m) => m.cycleTimeDays);
  }

  get medianCycleTimeDays(): number | null {
    return this.medianMetricDays((m) => m.cycleTimeDays);
  }

  percentile(p: number): number {
    return this.percentileMetricDays((m) => m.cycleTimeDays, p);
  }

  /** Generic versions of the three above, parameterized by which per-item
   * value to use — lets the dashboard treat any category (Triagem, Fila,
   * Desenvolvedor, Usuário, Fornecedor, Geral) as "the" cycle time. */
  averageMetricDays(selector: (m: ItemMetric) => number): number | null {
    return this.average(this.completed.map(selector));
  }

  medianMetricDays(selector: (m: ItemMetric) => number): number | null {
    const values = this.completed.map(selector).sort((a, b) => a - b);
    if (values.length === 0) return null;
    const mid = Math.floor(values.length / 2);
    if (values.length % 2 === 0) {
      return (values[mid - 1] + values[mid]) / 2;
    }
    return values[mid];
  }

  percentileMetricDays(selector: (m: ItemMetric) => number, p: number): number {
    const values = this.completed.map(selector).sort((a, b) => a - b);
    if (values.length === 0) return 0;
    const index = Math.round((p / 100) * (values.length - 1));
    return values[Math.min(Math.max(index, 0), values.length - 1)];
  }

  get averageAgingDays(): number | null {
    return this.average(this.inProgress.map((m) => m.cycleTimeDays));
  }
  get averageQueueDays(): number | null {
    return this.average(this.metrics.map((m) => m.queueDays));
  }
  get averageTriageDays(): number | null {
    return this.average(this.metrics.map((m) => m.triageDays));
  }
  get averageUserDays(): number | null {
    return this.average(this.metrics.map((m) => m.userDays));
  }
  get averageVendorDays(): number | null {
    return this.average(this.metrics.map((m) => m.vendorDays));
  }
  get averageGeneralDays(): number | null {
    return this.average(this.metrics.map((m) => m.generalDays));
  }
  get averageTotalDays(): number | null {
    return this.average(this.completed.map((m) => m.totalDays));
  }

  /** Aggregate flow efficiency across completed items: total developer time
   * divided by total elapsed time (not an average of per-item ratios) —
   * this is the standard way to compute it, since it weighs bigger items
   * proportionally instead of letting a single tiny item skew the number. */
  get flowEfficiencyPercent(): number | null {
    const list = this.completed;
    if (list.length === 0) return null;
    const totalActive = list.reduce((sum, m) => sum + m.cycleTimeDays, 0);
    const totalElapsed = list.reduce((sum, m) => sum + m.totalDays, 0);
    if (totalElapsed <= 0) return null;
    return (totalActive / totalElapsed) * 100;
  }

  /** Completed items that have a promised deadline (targetDate) set — the
   * only ones predictability can be judged against. */
  get completedWithDeadline(): ItemMetric[] {
    return this.completed.filter((m) => m.isOnTime != null);
  }

  get onTimeCount(): number {
    return this.completedWithDeadline.filter((m) => m.isOnTime === true).length;
  }

  get lateCount(): number {
    return this.completedWithDeadline.filter((m) => m.isOnTime === false).length;
  }

  /** % of completed items (with a deadline) delivered on or before it. */
  get predictabilityPercent(): number | null {
    const list = this.completedWithDeadline;
    if (list.length === 0) return null;
    return (this.onTimeCount / list.length) * 100;
  }

  private get lateItems(): ItemMetric[] {
    return this.completedWithDeadline.filter((m) => m.isOnTime === false);
  }

  /** Among late items, how many were late because of the analyst's own
   * stages (Triagem/Geral) vs. because of waiting on dev/vendor/user/queue. */
  get lateDueToAnalystCount(): number {
    return this.lateItems.filter((m) => m.isDelayAttributableToAnalyst === true).length;
  }

  get lateDueToExternalWaitCount(): number {
    return this.lateItems.filter((m) => m.isDelayAttributableToAnalyst === false).length;
  }

  /** Completed items worth a second look: resolved suspiciously fast, or
   * with a big chunk of their timeline untracked by any column. */
  get suspiciousItems(): ItemMetric[] {
    return this.completed.filter((m) => m.isSuspicious);
  }
}

/** Aggregated stats for one group (e.g. one complexity level, one
 * department, one priority) — used to rank groups against each other. */
export class GroupBreakdown {
  readonly label: string;
  readonly count: number;
  readonly avgMetricDays: number | null;
  readonly avgTotalDays: number | null;
  readonly lateCount: number;
  readonly withDeadlineCount: number;

  constructor(init: {
    label: string;
    count: number;
    avgMetricDays: number | null;
    avgTotalDays: number | null;
    lateCount: number;
    withDeadlineCount: number;
  }) {
    this.label = init.label;
    this.count = init.count;
    this.avgMetricDays = init.avgMetricDays;
    this.avgTotalDays = init.avgTotalDays;
    this.lateCount = init.lateCount;
    this.withDeadlineCount = init.withDeadlineCount;
  }

  get latePercent(): number | null {
    return this.withDeadlineCount === 0 ? null : (this.lateCount / this.withDeadlineCount) * 100;
  }
}

/** Groups completed items by `keyOf` (skipping items where it returns an
 * empty string) and computes per-group average of `metricSelector` / total
 * time / lateness, sorted worst-metric-first so the biggest offenders show
 * up on top. `metricSelector` defaults to cycle time (developer time) but
 * can be any per-item day value — e.g. Triagem, Fila, Total. */
export function groupBreakdown(
  completedItems: ItemMetric[],
  keyOf: (item: WorkItem) => string,
  metricSelector?: (m: ItemMetric) => number,
): GroupBreakdown[] {
  const selector = metricSelector ?? ((m: ItemMetric) => m.cycleTimeDays);
  const byKey = new Map<string, ItemMetric[]>();
  for (const m of completedItems) {
    const key = keyOf(m.item).trim();
    if (key === '') continue;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(m);
  }
  const result: GroupBreakdown[] = [];
  for (const [label, items] of byKey.entries()) {
    const withDeadline = items.filter((m) => m.isOnTime != null);
    const late = withDeadline.filter((m) => m.isOnTime === false).length;
    result.push(
      new GroupBreakdown({
        label,
        count: items.length,
        avgMetricDays:
          items.length === 0 ? null : items.reduce((s, m) => s + selector(m), 0) / items.length,
        avgTotalDays:
          items.length === 0 ? null : items.reduce((s, m) => s + m.totalDays, 0) / items.length,
        lateCount: late,
        withDeadlineCount: withDeadline.length,
      }),
    );
  }
  result.sort((a, b) => (b.avgMetricDays ?? 0) - (a.avgMetricDays ?? 0));
  return result;
}

export class MetricsCalculator {
  readonly triageColumns: Set<string>;
  readonly queueColumns: Set<string>;
  readonly developerColumns: Set<string>;
  readonly userColumns: Set<string>;
  readonly vendorColumns: Set<string>;
  readonly generalColumns: Set<string>;
  readonly doneColumn: string;
  readonly doneStates: Set<string>;

  constructor(init: {
    triageColumns: Set<string>;
    queueColumns: Set<string>;
    developerColumns: Set<string>;
    userColumns: Set<string>;
    vendorColumns: Set<string>;
    generalColumns: Set<string>;
    doneColumn: string;
    doneStates: Set<string>;
  }) {
    this.triageColumns = init.triageColumns;
    this.queueColumns = init.queueColumns;
    this.developerColumns = init.developerColumns;
    this.userColumns = init.userColumns;
    this.vendorColumns = init.vendorColumns;
    this.generalColumns = init.generalColumns;
    this.doneColumn = init.doneColumn;
    this.doneStates = init.doneStates;
  }

  /** `asOf` caps how far an open item's duration is counted — pass a past
   * sprint's cutoff date so its still-open items read "as of that sprint's
   * end" instead of accumulating real, live wait time up to today. Ignored
   * (falls back to now) when it's in the future, e.g. the current sprint. */
  calculate(items: WorkItem[], asOf?: Date | null): MetricsSummary {
    const now = new Date();
    const cutoff = asOf != null && asOf.getTime() < now.getTime() ? asOf : now;
    const metrics = items.map((item) => {
      const done = item.isDone(this.doneStates, this.doneColumn);
      const start = item.firstEnteredColumn(this.developerColumns) ?? item.createdDate;
      let end: Date | null = null;
      if (done) {
        end =
          item.firstDoneAfter(this.doneStates, start) ??
          item.firstColumnAfter(new Set([this.doneColumn]), start) ??
          item.changedDate;
      }
      const until = end ?? cutoff;
      return new ItemMetric({
        item,
        startDate: start,
        endDate: end,
        done,
        triageDurationMs: item.durationInColumnsMs(this.triageColumns, { until }),
        queueDurationMs: item.durationInColumnsMs(this.queueColumns, { until }),
        developerDurationMs: item.durationInColumnsMs(this.developerColumns, { until }),
        userDurationMs: item.durationInColumnsMs(this.userColumns, { until }),
        vendorDurationMs: item.durationInColumnsMs(this.vendorColumns, { until }),
        generalDurationMs: item.durationInColumnsMs(this.generalColumns, { until }),
        totalDurationMs: until.getTime() - item.createdDate.getTime(),
      });
    });
    return new MetricsSummary(metrics);
  }
}
