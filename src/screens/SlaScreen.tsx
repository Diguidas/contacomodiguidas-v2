import { useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw, X, Zap } from 'lucide-react';
import { WorkItem } from '../models/workItem';
import { ItemMetric, MetricsCalculator } from '../services/metricsService';
import { AppSettings } from '../services/settingsService';
import { Sprint, SprintService } from '../services/sprintService';
import { BrandColors } from '../theme';
import { FilterBox, ToggleChip } from '../components/ToggleChip';

type PeriodType = 'last30Days' | 'sprint';

const sprintService = new SprintService();

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Per-column timing during the selected window: how long, on average,
 * cards actually sat in this column — the raw material for spotting
 * gargalos and, eventually, defining an SLA target per column. */
interface ColumnStat {
  label: string;
  group: string;
  daysPerItem: number[]; // one entry per item that spent >0 time here
}
function itemCount(s: ColumnStat): number {
  return s.daysPerItem.length;
}
function averageDays(s: ColumnStat): number | null {
  if (s.daysPerItem.length === 0) return null;
  return s.daysPerItem.reduce((a, b) => a + b, 0) / s.daysPerItem.length;
}
function medianDays(s: ColumnStat): number | null {
  if (s.daysPerItem.length === 0) return null;
  const sorted = [...s.daysPerItem].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function maxDays(s: ColumnStat): number | null {
  if (s.daysPerItem.length === 0) return null;
  return Math.max(...s.daysPerItem);
}

/** Tempo por coluna: shows how long cards are sitting in each Kanban column
 * during a chosen window (last 30 days, or one sprint), optionally scoped
 * to a single person — the basis for spotting bottlenecks and, from there,
 * defining an SLA target per column.
 *
 * `items` is the same broad, multi-sprint batch HistoryScreen uses (cached
 * at the AppShell level), not the sprint-scoped items — a 30-day window
 * needs history reaching back further than "current sprint". */
export function SlaScreen({
  settings,
  items,
  loading,
  error,
  onRefresh,
}: {
  settings: AppSettings;
  items: WorkItem[] | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [periodType, setPeriodType] = useState<PeriodType>('last30Days');
  const [selectedSprint, setSelectedSprint] = useState<Sprint>(() => sprintService.sprintFor(sprintService.sprintNumberContaining(new Date())));
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null); // null = equipe toda
  const [selectedTypes, setSelectedTypes] = useState<Set<string> | null>(null); // null = todos os tipos
  const [cycleTimeDialogOpen, setCycleTimeDialogOpen] = useState(false);

  function types(list: WorkItem[]): string[] {
    return [...new Set(list.map((i) => i.requestType.trim()).filter((t) => t))].sort();
  }
  function typeSelected(type: string): boolean {
    return selectedTypes == null || selectedTypes.has(type);
  }

  function window(): [Date, Date] {
    if (periodType === 'sprint') {
      return [selectedSprint.start, new Date(selectedSprint.end.getTime() + 24 * 60 * 60 * 1000)];
    }
    const now = new Date();
    return [new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), now];
  }

  function assignees(list: WorkItem[]): string[] {
    return [...new Set(list.map((i) => i.assignedTo.trim()).filter((n) => n))].sort();
  }

  function computeStats(list: WorkItem[]): ColumnStat[] {
    const [start, end] = window();
    const groups: [string, Set<string>][] = [
      ['Triagem', settings.triageColumnSet],
      ['Fila', settings.queueColumnSet],
      ['Desenvolvedor', settings.developerColumnSet],
      ['Usuário', settings.userColumnSet],
      ['Fornecedor', settings.vendorColumnSet],
      ['Geral', settings.generalColumnSet],
    ];
    // Flatten the groups into their individual board columns — a column
    // appearing in more than one group keeps the label of the first group
    // it's found in.
    const columnToGroup = new Map<string, string>();
    for (const [groupLabel, columns] of groups) {
      for (const column of columns) {
        if (!columnToGroup.has(column)) columnToGroup.set(column, groupLabel);
      }
    }

    const scoped = list.filter((item) => {
      if (selectedAssignee != null && item.assignedTo.trim().toLowerCase() !== selectedAssignee.trim().toLowerCase()) return false;
      if (!typeSelected(item.requestType.trim())) return false;
      // Only cards whose column history actually reaches into the window.
      if (item.boardColumnHistory.length === 0) return false;
      const lastChange = item.boardColumnHistory[item.boardColumnHistory.length - 1].date;
      return lastChange.getTime() >= start.getTime() && item.createdDate.getTime() < end.getTime();
    });

    const stats: ColumnStat[] = [...columnToGroup.entries()].map(([columnName, group]) => {
      const daysPerItem: number[] = [];
      for (const item of scoped) {
        const durationMs = item.durationInColumnsMs(new Set([columnName]), { since: start, until: end });
        if (durationMs / 60000 > 0) daysPerItem.push(durationMs / (1000 * 60 * 60 * 24));
      }
      return { label: columnName, group, daysPerItem };
    });
    stats.sort((a, b) => (averageDays(b) ?? 0) - (averageDays(a) ?? 0));
    return stats;
  }

  /** Cycle time geral: full lead time (criação -> conclusão) for items
   * finished within the selected window, scoped to the chosen responsible
   * (or the whole team when none is picked). */
  function computeCycleTime(list: WorkItem[]): [number | null, ItemMetric[]] {
    const [start, end] = window();
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
    const scoped = list.filter((item) => {
      if (selectedAssignee != null && item.assignedTo.trim().toLowerCase() !== selectedAssignee.trim().toLowerCase()) return false;
      if (!typeSelected(item.requestType.trim())) return false;
      return !item.isCancelled && item.type.trim().toLowerCase() === 'user story';
    });
    const metrics = calculator.calculate(scoped).metrics;
    const closedInWindow = metrics.filter((m) => {
      const endDate = m.endDate;
      if (!m.done || endDate == null) return false;
      return endDate.getTime() >= start.getTime() && endDate.getTime() < end.getTime();
    });
    if (closedInWindow.length === 0) return [null, closedInWindow];
    const avg = closedInWindow.reduce((s, m) => s + m.totalDays, 0) / closedInWindow.length;
    return [avg, closedInWindow];
  }

  if (!settings.isConfigured) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Configure a Conexão para começar.</span>
      </div>
    );
  }

  const stats = items != null ? computeStats(items) : [];
  const maxAvg = stats.reduce((m, s) => {
    const a = averageDays(s);
    return a != null && a > m ? a : m;
  }, 0);
  const [avgDays, closedInWindow] = items != null ? computeCycleTime(items) : [null, []];

  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1100, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 'bold' }}>Tempo por coluna (SLA)</div>
            <div style={{ height: 4 }} />
            <div style={{ color: '#64748B' }}>
              Quanto tempo os cards estão passando em cada coluna no período escolhido — a base pra enxergar gargalos e definir uma meta de SLA por
              coluna.
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${BrandColors.border}`,
              backgroundColor: '#fff',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1,
              fontSize: 13,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RefreshCw size={14} strokeWidth={2} /> Atualizar
          </button>
        </div>
        <div style={{ height: 20 }} />
        <FiltersRow
          periodType={periodType}
          onPeriodTypeChanged={setPeriodType}
          selectedSprint={selectedSprint}
          sprints={sprintService.recentSprints()}
          onSprintChanged={setSelectedSprint}
          assignees={items != null ? assignees(items) : []}
          selectedAssignee={selectedAssignee}
          onAssigneeChanged={setSelectedAssignee}
          types={items != null ? types(items) : []}
          selectedTypes={selectedTypes}
          onTypeToggled={(type, selected) => {
            const all = items != null ? types(items) : [];
            const current = selectedTypes ?? new Set(all);
            const updated = new Set(current);
            if (selected) updated.add(type);
            else updated.delete(type);
            setSelectedTypes(updated.size === all.length ? null : updated);
          }}
        />
        <div style={{ height: 20 }} />
        {items != null && (
          <>
            <CycleTimeCard
              avgDays={avgDays}
              metrics={closedInWindow}
              assignee={selectedAssignee}
              periodType={periodType}
              sprint={selectedSprint}
              onOpen={() => setCycleTimeDialogOpen(true)}
            />
            <div style={{ height: 24 }} />
          </>
        )}
        {error != null && <div style={{ marginBottom: 16, color: BrandColors.danger }}>Erro: {error}</div>}
        {loading && items == null ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>Carregando...</div>
        ) : items == null || stats.every((s) => itemCount(s) === 0) ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>Sem cards passando por nenhuma coluna nesse período/filtro.</div>
        ) : (
          <>
            <ColumnBars stats={stats} maxAvg={maxAvg} />
            <div style={{ height: 24 }} />
            <ColumnTable stats={stats} />
          </>
        )}
        <div style={{ height: 16 }} />
      </div>
      {cycleTimeDialogOpen && <CycleTimeItemsDialog metrics={closedInWindow} onClose={() => setCycleTimeDialogOpen(false)} />}
    </div>
  );
}

function FiltersRow({
  periodType,
  onPeriodTypeChanged,
  selectedSprint,
  sprints,
  onSprintChanged,
  assignees,
  selectedAssignee,
  onAssigneeChanged,
  types,
  selectedTypes,
  onTypeToggled,
}: {
  periodType: PeriodType;
  onPeriodTypeChanged: (t: PeriodType) => void;
  selectedSprint: Sprint;
  sprints: Sprint[];
  onSprintChanged: (s: Sprint) => void;
  assignees: string[];
  selectedAssignee: string | null;
  onAssigneeChanged: (a: string | null) => void;
  types: string[];
  selectedTypes: Set<string> | null;
  onTypeToggled: (type: string, selected: boolean) => void;
}) {
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        <div style={{ display: 'flex', width: 260, borderRadius: 8, border: `1px solid ${BrandColors.border}`, overflow: 'hidden' }}>
          {(['last30Days', 'sprint'] as PeriodType[]).map((t) => {
            const selected = periodType === t;
            return (
              <button
                key={t}
                onClick={() => onPeriodTypeChanged(t)}
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: 'none',
                  cursor: 'pointer',
                  backgroundColor: selected ? BrandColors.primary : '#fff',
                  color: selected ? '#fff' : '#334155',
                  fontSize: 13,
                  fontWeight: selected ? 600 : 400,
                }}
              >
                {t === 'last30Days' ? 'Últimos 30 dias' : 'Sprint'}
              </button>
            );
          })}
        </div>
        {periodType === 'sprint' && (
          <select
            style={{ width: 260, padding: '10px 12px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff', fontSize: 13 }}
            value={selectedSprint.number}
            onChange={(e) => {
              const s = sprints.find((s) => s.number === Number(e.target.value));
              if (s) onSprintChanged(s);
            }}
          >
            {sprints.map((s) => (
              <option key={s.number} value={s.number}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <select
          style={{ width: 260, padding: '10px 12px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff', fontSize: 13 }}
          value={selectedAssignee ?? ''}
          onChange={(e) => onAssigneeChanged(e.target.value || null)}
        >
          <option value="">Equipe toda</option>
          {assignees.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      {types.length > 0 && (
        <>
          <div style={{ height: 12 }} />
          <FilterBox message='Tipos de demanda: desmarque um tipo pra ele sair da conta de tempo por coluna e do Cycle Time (ex: ignore Incidente pra olhar só o SLA de Projeto).'>
            {types.map((type) => (
              <ToggleChip key={type} label={type} selected={selectedTypes == null || selectedTypes.has(type)} onSelected={(selected) => onTypeToggled(type, selected)} />
            ))}
          </FilterBox>
        </>
      )}
    </div>
  );
}

/** Headline Cycle Time (Geral) for the chosen window and scope — full lead
 * time from creation to conclusion, averaged over items finished inside the
 * window. */
function CycleTimeCard({
  avgDays,
  metrics,
  assignee,
  periodType,
  sprint,
  onOpen,
}: {
  avgDays: number | null;
  metrics: ItemMetric[];
  assignee: string | null;
  periodType: PeriodType;
  sprint: Sprint;
  onOpen: () => void;
}) {
  const count = metrics.length;
  const scopeLabel = assignee ?? 'Equipe toda';
  const periodLabel = periodType === 'sprint' ? sprint.label : 'Últimos 30 dias';
  return (
    <button
      onClick={count === 0 ? undefined : onOpen}
      disabled={count === 0}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: 20,
        borderRadius: 14,
        backgroundColor: BrandColors.primaryLightBg,
        border: `1.5px solid ${BrandColors.primary}`,
        cursor: count === 0 ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <span style={{ display: 'flex', color: BrandColors.primary }}>
        <Zap size={28} strokeWidth={1.75} />
      </span>
      <div style={{ width: 16 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 'bold', fontSize: 16, color: BrandColors.primaryDark }}>Cycle Time (Geral)</div>
        <div style={{ height: 2 }} />
        <div style={{ fontSize: 12, color: '#64748B' }}>
          {scopeLabel} · {periodLabel}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 28, fontWeight: 'bold', color: BrandColors.primaryDark }}>{avgDays != null ? `${avgDays.toFixed(1)}d` : '—'}</div>
        <div style={{ fontSize: 12, color: '#64748B' }}>
          {count} card{count === 1 ? '' : 's'} concluído{count === 1 ? '' : 's'}
        </div>
      </div>
    </button>
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

/** Opens from tapping CycleTimeCard — the actual cards behind the average,
 * with full lead time (criação -> conclusão) so it's clear which ones are
 * dragging the number up. */
function CycleTimeItemsDialog({ metrics, onClose }: { metrics: ItemMetric[]; onClose: () => void }) {
  const rows = [...metrics].sort((a, b) => b.totalDays - a.totalDays);
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ backgroundColor: '#fff', borderRadius: 12, maxWidth: 560, width: '90%', maxHeight: '85vh', overflowY: 'auto', padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1, fontWeight: 'bold', fontSize: 16 }}>Cards no Cycle Time (Geral)</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div style={{ height: 12 }} />
        <div style={{ overflowX: 'auto' }}>
          <table style={tableStyle()}>
            <thead>
              <tr>
                <Th>ID</Th>
                <Th>Título</Th>
                <Th>Responsável</Th>
                <Th>Criado em</Th>
                <Th>Concluído em</Th>
                <Th>Lead time</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.item.id}>
                  <Td>{m.item.id}</Td>
                  <Td>
                    <span style={{ display: 'inline-block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
                  </Td>
                  <Td>{m.item.assignedTo === '' ? '—' : m.item.assignedTo}</Td>
                  <Td>{formatDate(m.item.createdDate)}</Td>
                  <Td>{m.endDate == null ? '—' : formatDate(m.endDate)}</Td>
                  <Td>{m.totalDays.toFixed(1)}d</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Horizontal bar per column, longest (biggest gargalo) at the top. */
function ColumnBars({ stats, maxAvg }: { stats: ColumnStat[]; maxAvg: number }) {
  function barColor(fraction: number): string {
    if (fraction >= 0.85) return BrandColors.danger;
    if (fraction >= 0.5) return '#F59E0B';
    return BrandColors.primary;
  }
  const visible = stats.filter((s) => itemCount(s) > 0);
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 'bold' }}>Tempo médio por coluna</div>
      <div style={{ height: 4 }} />
      <div style={{ fontSize: 12, color: '#64748B' }}>Maior barra = maior gargalo no período selecionado.</div>
      <div style={{ height: 16 }} />
      {visible.map((s) => {
        const avg = averageDays(s)!;
        const fraction = maxAvg <= 0 ? 0 : Math.min(Math.max(avg / maxAvg, 0.02), 1);
        return (
          <div key={s.label} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
                <GroupTag label={s.group} />
              </div>
              <span style={{ fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>
                {avg.toFixed(1)}d médio · {itemCount(s)} cards
              </span>
            </div>
            <div style={{ height: 6 }} />
            <div style={{ height: 10, borderRadius: 6, backgroundColor: '#F1F5F9', position: 'relative' }}>
              <div style={{ height: 10, borderRadius: 6, width: `${fraction * 100}%`, backgroundColor: barColor(fraction) }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ColumnTable({ stats }: { stats: ColumnStat[] }) {
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle()}>
          <thead>
            <tr>
              <Th>Coluna</Th>
              <Th>Grupo</Th>
              <Th>Cards</Th>
              <Th>Médio</Th>
              <Th>Mediana</Th>
              <Th>Pior caso</Th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.label}>
                <Td>{s.label}</Td>
                <Td>
                  <GroupTag label={s.group} />
                </Td>
                <Td>{itemCount(s)}</Td>
                <Td>{averageDays(s) != null ? `${averageDays(s)!.toFixed(1)}d` : '—'}</Td>
                <Td>{medianDays(s) != null ? `${medianDays(s)!.toFixed(1)}d` : '—'}</Td>
                <Td>{maxDays(s) != null ? `${maxDays(s)!.toFixed(1)}d` : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupTag({ label }: { label: string }) {
  return (
    <span style={{ padding: '3px 8px', borderRadius: 6, backgroundColor: BrandColors.primaryLightBg, fontSize: 11, color: BrandColors.primaryDark, fontWeight: 600 }}>
      {label}
    </span>
  );
}
