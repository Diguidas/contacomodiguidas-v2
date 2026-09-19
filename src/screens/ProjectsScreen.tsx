import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { WorkItem } from '../models/workItem';
import { ItemMetric, MetricsCalculator } from '../services/metricsService';
import { AppSettings } from '../services/settingsService';
import { AzureDevOpsService } from '../services/azureDevOpsService';
import type { ChildSummary } from '../services/azureDevOpsService';
import { Sprint } from '../services/sprintService';
import { BrandColors } from '../theme';

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function endedInSprintLocal(m: ItemMetric, sprint: Sprint | null): boolean {
  if (!m.done) return false;
  if (sprint == null) return true;
  const end = m.endDate;
  if (end == null) return false;
  const rangeEnd = new Date(sprint.end.getTime() + 24 * 60 * 60 * 1000);
  return end.getTime() >= sprint.start.getTime() && end.getTime() <= rangeEnd.getTime();
}

function areaLeaf(areaPath: string): string {
  const trimmed = areaPath.trim();
  if (trimmed === '') return 'Sem área';
  return trimmed.split('\\').pop() ?? trimmed;
}

/** Whether child `id` counts as done — resolved from `itemsById` (its full
 * WorkItem, when it was part of this session's main fetch) or from
 * `remoteChildren` (the on-demand summary fetched for children outside that
 * window). Returns null while still unknown (summary not fetched yet). */
function isChildDone(
  id: number,
  itemsById: Map<number, WorkItem>,
  remoteChildren: Map<number, ChildSummary>,
  settings: AppSettings,
): boolean | null {
  const local = itemsById.get(id);
  if (local != null) return local.isDone(settings.doneStateSet, settings.doneColumn);
  const remote = remoteChildren.get(id);
  if (remote == null) return null;
  if (settings.doneStateSet.has(remote.state)) return true;
  const doneColumn = settings.doneColumn.trim();
  if (doneColumn === '') return false;
  return remote.boardColumn.trim().toLowerCase() === doneColumn.toLowerCase();
}

// No granular board columns to read "stuck in a stage" from — Features here
// only really move through New/Active/Closed — so staleness comes from
// `changedDate` (nobody touched it at all, in any way) instead of "days in
// this column", and pace comes from child completion against the Feature's
// own age instead of a stage-by-stage breakdown.
const STALE_DAYS = 14; // one sprint's length — the same yardstick the rest of the app uses
const SLOW_PACE_AGE_DAYS = 30;
const SLOW_PACE_MAX_DONE_RATIO = 0.3;

type ProjectSignal = { label: string; color: string; description: string };

function projectSignals(m: ItemMetric, doneCount: number, childCount: number): ProjectSignal[] {
  if (m.done) return [];
  const signals: ProjectSignal[] = [];
  const daysSinceChange = (Date.now() - m.item.changedDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceChange >= STALE_DAYS) {
    signals.push({
      label: 'Parada',
      color: BrandColors.danger,
      description: `Nenhuma atualização há ${Math.floor(daysSinceChange)} dias.`,
    });
  }
  if (childCount === 0) {
    signals.push({ label: 'Sem breakdown', color: BrandColors.warning, description: 'Ainda não tem nenhuma child cadastrada.' });
  } else if (m.totalDays >= SLOW_PACE_AGE_DAYS && doneCount / childCount < SLOW_PACE_MAX_DONE_RATIO) {
    signals.push({
      label: 'Ritmo baixo',
      color: BrandColors.warning,
      description: `${m.totalDays.toFixed(0)} dias aberta e só ${doneCount}/${childCount} childs concluídas.`,
    });
  }
  return signals;
}

/** Projetos (Features): the one place that tracks Feature-type work items —
 * every other screen in the app deliberately scopes to User Story only
 * (Features are a different kind of demand, tracked at a coarser grain).
 * Grouped by current board column (not open/closed) so it reads like a
 * lightweight kanban of Features rather than two flat lists — each row also
 * shows how many childs it has and how many of those are done, the two
 * numbers that actually say how close a Feature is to shipping.
 *
 * Uses `items` (the same sprint-scoped-plus-always-open batch Dashboard and
 * Visão do time use) for the Feature rows themselves; a Feature's children
 * are very often outside that window (already closed long ago, untouched
 * recently), so every child missing from that batch is looked up once, in
 * one batched call, as soon as the screen has its list of Features —
 * needed up front now since Childs/Concluídos has to show a real number in
 * the table itself, not just inside a per-Feature dialog. */
export function ProjectsScreen({
  settings,
  items,
  loading,
  error,
  selectedSprint,
  onRefresh,
}: {
  settings: AppSettings;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  selectedSprint: Sprint | null;
  onRefresh: () => void;
}) {
  const [dialogFeature, setDialogFeature] = useState<ItemMetric | null>(null);
  const [remoteChildren, setRemoteChildren] = useState<Map<number, ChildSummary>>(new Map());
  const [childrenLoading, setChildrenLoading] = useState(false);
  const [childrenError, setChildrenError] = useState<string | null>(null);

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
  const valid = items.filter((i) => !i.isCancelled).filter((i) => i.type.trim().toLowerCase() === 'feature');
  const allMetrics = calculator.calculate(valid).metrics;

  // Same scope as before, just no longer split into two lists by it: every
  // Feature that's currently open (any age), plus any closed specifically
  // in the selected sprint.
  const relevant = allMetrics.filter((m) => !m.done || endedInSprintLocal(m, selectedSprint));

  const itemsById = new Map<number, WorkItem>(items.map((i) => [i.id, i]));

  const missingChildIds = [...new Set(relevant.flatMap((m) => m.item.childIds))].filter((id) => !itemsById.has(id));

  useEffect(() => {
    let cancelled = false;
    if (missingChildIds.length === 0) return;
    setChildrenLoading(true);
    setChildrenError(null);
    (async () => {
      try {
        const service = new AzureDevOpsService(settings);
        const result = await service.fetchChildSummaries(missingChildIds);
        if (!cancelled) setRemoteChildren((prev) => new Map([...prev, ...result]));
      } catch (e) {
        if (!cancelled) setChildrenError(String(e));
      } finally {
        if (!cancelled) setChildrenLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-fetch only when the actual set of ids to look up changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingChildIds.join(',')]);

  if (!settings.isConfigured) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Configure a Conexão para começar.</span>
      </div>
    );
  }

  const byColumn = new Map<string, ItemMetric[]>();
  for (const m of relevant) {
    const col = m.item.currentBoardColumn.trim() === '' ? 'Sem coluna' : m.item.currentBoardColumn;
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(m);
  }
  const columns = [...byColumn.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1300, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 'bold' }}>Projetos</div>
            <div style={{ height: 4 }} />
            <div style={{ color: '#64748B' }}>
              Features em aberto (qualquer idade) e as que foram encerradas na sprint selecionada, separadas por coluna do board — cada
              linha mostra quantas childs tem e quantas já foram concluídas. Clique numa linha pra ver a lista.
            </div>
          </div>
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              marginTop: 4,
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
        <div style={{ height: 24 }} />
        {error != null && <div style={{ marginBottom: 16, color: BrandColors.danger }}>Erro: {error}</div>}
        {childrenError != null && <div style={{ marginBottom: 16, color: BrandColors.danger }}>Erro ao buscar childs: {childrenError}</div>}
        {loading && allMetrics.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>Carregando...</div>
        ) : columns.length === 0 ? (
          <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
            <span style={{ color: '#64748B' }}>Nenhuma Feature em aberto ou encerrada nesta sprint.</span>
          </div>
        ) : (
          columns.map(([column, metrics], i) => (
            <div key={column} style={{ marginTop: i === 0 ? 0 : 28 }}>
              <SectionTitle title={`${column} (${metrics.length})`} subtitle="" />
              <div style={{ height: 12 }} />
              <ProjectsTable
                metrics={metrics}
                itemsById={itemsById}
                remoteChildren={remoteChildren}
                childrenLoading={childrenLoading}
                settings={settings}
                onRowClick={setDialogFeature}
              />
            </div>
          ))
        )}
      </div>
      {dialogFeature && (
        <ChildrenDialog
          feature={dialogFeature}
          settings={settings}
          itemsById={itemsById}
          remoteChildren={remoteChildren}
          onClose={() => setDialogFeature(null)}
        />
      )}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 'bold' }}>{title}</div>
      {subtitle !== '' && (
        <>
          <div style={{ height: 2 }} />
          <div style={{ fontSize: 12.5, color: '#64748B' }}>{subtitle}</div>
        </>
      )}
    </div>
  );
}

function tableStyle(): React.CSSProperties {
  return { borderCollapse: 'collapse', width: '100%', fontSize: 13 };
}
function Th({ children }: { children?: ReactNode }) {
  return (
    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, backgroundColor: BrandColors.tableHeader, fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}
function Td({ children, colSpan }: { children: ReactNode; colSpan?: number }) {
  return (
    <td colSpan={colSpan} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, whiteSpace: 'nowrap' }}>
      {children}
    </td>
  );
}

function ProjectsTable({
  metrics,
  itemsById,
  remoteChildren,
  childrenLoading,
  settings,
  onRowClick,
}: {
  metrics: ItemMetric[];
  itemsById: Map<number, WorkItem>;
  remoteChildren: Map<number, ChildSummary>;
  childrenLoading: boolean;
  settings: AppSettings;
  onRowClick: (m: ItemMetric) => void;
}) {
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle()}>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Título</Th>
              <Th>Responsável</Th>
              <Th>Área</Th>
              <Th>Childs</Th>
              <Th>Concluídos</Th>
              <Th>Criado em</Th>
              <Th>Dias em aberto</Th>
              <Th>Sinais</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const childIds = m.item.childIds;
              const doneFlags = childIds.map((id) => isChildDone(id, itemsById, remoteChildren, settings));
              const doneCount = doneFlags.filter((d) => d === true).length;
              const stillUnknown = doneFlags.some((d) => d == null);
              const signals = projectSignals(m, doneCount, childIds.length);
              return (
                <tr key={m.item.id} onClick={() => onRowClick(m)} style={{ cursor: 'pointer' }}>
                  <Td>{m.item.id}</Td>
                  <Td>
                    <span style={{ display: 'inline-block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
                  </Td>
                  <Td>{m.item.assignedTo || '—'}</Td>
                  <Td>{areaLeaf(m.item.areaPath)}</Td>
                  <Td>{childIds.length}</Td>
                  <Td>
                    {childIds.length === 0 ? '—' : `${doneCount}/${childIds.length}`}
                    {stillUnknown && childrenLoading && <span style={{ color: '#94A3B8', fontSize: 11 }}> (carregando...)</span>}
                  </Td>
                  <Td>{formatDate(m.item.createdDate)}</Td>
                  <Td>{m.totalDays.toFixed(0)}d</Td>
                  <Td>
                    {signals.length === 0 ? (
                      '—'
                    ) : (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {signals.map((s) => (
                          <span
                            key={s.label}
                            title={s.description}
                            style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 600,
                              color: s.color,
                              backgroundColor: `${s.color}20`,
                            }}
                          >
                            {s.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ backgroundColor: '#fff', borderRadius: 12, maxWidth: 760, width: '90%', maxHeight: '85vh', overflowY: 'auto', padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 'bold', fontSize: 16 }}>{title}</div>
            {subtitle && (
              <>
                <div style={{ height: 2 }} />
                <div style={{ fontSize: 12, color: '#64748B' }}>{subtitle}</div>
              </>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div style={{ height: 14 }} />
        {children}
      </div>
    </div>
  );
}

/** Opens from a Feature row with the full children list — each child
 * resolved either from `itemsById` (already fetched in this session) or
 * from `remoteChildren` (fetched once up front for every Feature on
 * screen, not just this one). */
function ChildrenDialog({
  feature,
  settings,
  itemsById,
  remoteChildren,
  onClose,
}: {
  feature: ItemMetric;
  settings: AppSettings;
  itemsById: Map<number, WorkItem>;
  remoteChildren: Map<number, ChildSummary>;
  onClose: () => void;
}) {
  const childIds = feature.item.childIds;
  const doneCount = childIds.filter((id) => isChildDone(id, itemsById, remoteChildren, settings) === true).length;

  return (
    <Modal
      title={`#${feature.item.id} — ${feature.item.title}`}
      subtitle={`${childIds.length} ${childIds.length === 1 ? 'child' : 'childs'} · ${doneCount} concluído${doneCount === 1 ? '' : 's'}`}
      onClose={onClose}
    >
      {childIds.length === 0 ? (
        <span style={{ fontSize: 13, color: '#64748B' }}>Essa Feature não tem childs.</span>
      ) : (
        <table style={tableStyle()}>
          <thead>
            <tr>
              <Th>ID</Th>
              <Th>Título</Th>
              <Th>Tipo</Th>
              <Th>Responsável</Th>
              <Th>Status</Th>
              <Th>Coluna</Th>
            </tr>
          </thead>
          <tbody>
            {childIds.map((id) => {
              const local = itemsById.get(id);
              if (local != null) {
                return (
                  <tr key={id}>
                    <Td>{local.id}</Td>
                    <Td>
                      <span style={{ display: 'inline-block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{local.title}</span>
                    </Td>
                    <Td>{local.type}</Td>
                    <Td>{local.assignedTo || '—'}</Td>
                    <Td>{local.currentState || '—'}</Td>
                    <Td>{local.currentBoardColumn === '' ? '—' : local.currentBoardColumn}</Td>
                  </tr>
                );
              }
              const remote = remoteChildren.get(id);
              if (remote == null) {
                return (
                  <tr key={id}>
                    <Td>{id}</Td>
                    <Td colSpan={5}>
                      <span style={{ color: '#94A3B8', fontStyle: 'italic' }}>Carregando...</span>
                    </Td>
                  </tr>
                );
              }
              return (
                <tr key={id}>
                  <Td>{remote.id}</Td>
                  <Td>
                    <span style={{ display: 'inline-block', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }}>{remote.title}</span>
                  </Td>
                  <Td>{remote.type}</Td>
                  <Td>{remote.assignedTo || '—'}</Td>
                  <Td>{remote.state || '—'}</Td>
                  <Td>{remote.boardColumn === '' ? '—' : remote.boardColumn}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
