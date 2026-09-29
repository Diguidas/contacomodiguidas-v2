import { ItemMetric } from './metricsService';
import { AppSettings } from './settingsService';
import { isAttributedTo } from './sprintSnapshotService';

export function complexityLabelOf(m: ItemMetric): string {
  return m.item.complexity.trim() === '' ? 'Sem complexidade' : m.item.complexity.trim();
}
export function priorityLabelOf(m: ItemMetric): string {
  return m.item.priority == null ? 'Sem prioridade' : `Prioridade ${m.item.priority}`;
}

/** Every non-Triagem column, across all buckets — the boundary "Backlog"
 * starts at, used to measure Backlog-to-Concluído without Triagem time
 * baked in. */
export function nonTriageColumnsOf(settings: AppSettings): Set<string> {
  return new Set([
    ...settings.queueColumnSet,
    ...settings.developerColumnSet,
    ...settings.userColumnSet,
    ...settings.vendorColumnSet,
    ...settings.generalColumnSet,
  ]);
}
export function backlogToDoneDays(m: ItemMetric, nonTriageColumns: Set<string>): number {
  const start = m.item.firstEnteredColumn(nonTriageColumns) ?? m.item.createdDate;
  const end = m.endDate ?? new Date();
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
}

export type LabelDimension = 'complexity' | 'priority';

export interface LabelDeviationRow {
  name: string;
  label: string;
  count: number;
  personAvgDays: number;
  teamAvgDays: number;
  deviationDays: number;
  metrics: ItemMetric[];
}

/** For each responsible + label (complexidade or prioridade) with enough
 * completed items of their own, compares their average Backlog-to-Concluído
 * time against the team's average for that same label — a big deviation
 * means that person's cards under that label aren't behaving like the rest
 * of the team's cards under it, which is what "etiquetando errado" would
 * look like in the data. Requires `minSample` items *for that person, in
 * that label* before producing a row at all — below that, the number is
 * closer to noise than signal, and flagging someone off of 1-2 cards isn't
 * fair. `metrics` should already be scoped to whatever the caller
 * considers "the team" (e.g. one sprint's completed User Story cards) —
 * this function doesn't do any sprint/type filtering itself. */
export function computeLabelConsistency(metrics: ItemMetric[], settings: AppSettings, dimension: LabelDimension, minSample: number): LabelDeviationRow[] {
  const nonTriageColumns = nonTriageColumnsOf(settings);
  const labelOf = dimension === 'complexity' ? complexityLabelOf : priorityLabelOf;
  const days = (m: ItemMetric) => backlogToDoneDays(m, nonTriageColumns);

  const byLabel = new Map<string, ItemMetric[]>();
  for (const m of metrics) {
    const label = labelOf(m);
    if (label.startsWith('Sem ')) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label)!.push(m);
  }
  const teamAvgByLabel = new Map<string, number>();
  for (const [label, list] of byLabel.entries()) {
    teamAvgByLabel.set(label, list.reduce((s, m) => s + days(m), 0) / list.length);
  }

  // Additive, same rule as the rest of the app (isAttributedTo): a card
  // always counts for whoever it's literally assigned to, and *also* counts
  // for settings.myDisplayName when it's tagged for him but assigned to
  // someone else — once it's done, or currently in Desenvolvedor. But the
  // *time* counted differs by how it's attributed: for a card literally
  // assigned to them, the full Backlog-to-Concluído span is theirs. For a
  // card only tag-attributed, they were never on the hook for
  // Triagem/Fila/Usuário/Fornecedor on someone else's card — only for the
  // Desenvolvimento stretch, whatever the tag actually credits — so it's
  // cycleTimeDays instead, or the whole span would inflate their number
  // with time they had no part in.
  const tagOwner = settings.myDisplayName.trim();
  const byPersonLabel = new Map<string, { metric: ItemMetric; viaTag: boolean }[]>();
  for (const m of metrics) {
    const label = labelOf(m);
    if (label.startsWith('Sem ')) continue;
    const name = m.item.assignedTo.trim();
    if (name === '') continue;
    const key = `${name}|${label}`;
    if (!byPersonLabel.has(key)) byPersonLabel.set(key, []);
    byPersonLabel.get(key)!.push({ metric: m, viaTag: false });
    if (tagOwner !== '' && name.toLowerCase() !== tagOwner.toLowerCase() && isAttributedTo(m, tagOwner, settings)) {
      const tagKey = `${tagOwner}|${label}`;
      if (!byPersonLabel.has(tagKey)) byPersonLabel.set(tagKey, []);
      byPersonLabel.get(tagKey)!.push({ metric: m, viaTag: true });
    }
  }

  const rows: LabelDeviationRow[] = [];
  for (const [key, entries] of byPersonLabel.entries()) {
    if (entries.length < minSample) continue;
    const [name, label] = key.split('|');
    const teamAvg = teamAvgByLabel.get(label);
    if (teamAvg == null) continue;
    const personAvg = entries.reduce((s, e) => s + (e.viaTag ? e.metric.cycleTimeDays : days(e.metric)), 0) / entries.length;
    rows.push({
      name,
      label,
      count: entries.length,
      personAvgDays: personAvg,
      teamAvgDays: teamAvg,
      deviationDays: personAvg - teamAvg,
      metrics: entries.map((e) => e.metric),
    });
  }
  // Grouped by person first (ranked by that person's worst deviation, so
  // whoever's most off the team's pace still floats to the top) rather than
  // sorted purely by deviation size — otherwise the same person's rows for
  // complexidade/prioridade scatter, which reads as more people having an
  // issue than actually do.
  const worstDeviationByName = new Map<string, number>();
  for (const r of rows) {
    const current = worstDeviationByName.get(r.name) ?? 0;
    if (Math.abs(r.deviationDays) > Math.abs(current)) worstDeviationByName.set(r.name, r.deviationDays);
  }
  rows.sort((a, b) => {
    if (a.name !== b.name) return Math.abs(worstDeviationByName.get(b.name)!) - Math.abs(worstDeviationByName.get(a.name)!);
    return Math.abs(b.deviationDays) - Math.abs(a.deviationDays);
  });
  return rows;
}
