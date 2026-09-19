import { useState, type ReactNode } from 'react';
import { AlertTriangle, Star, UserRound, X } from 'lucide-react';
import { boardColumnMatches, WorkItem } from '../models/workItem';
import { ItemMetric, MetricsCalculator } from '../services/metricsService';
import { AppSettings } from '../services/settingsService';
import { Sprint } from '../services/sprintService';
import { doneAsOf, sprintCutoff } from '../services/sprintSnapshotService';
import { CardRating } from '../services/cardRatingService';
import { BrandColors } from '../theme';

function departmentOf(m: ItemMetric): string {
  return m.item.department.trim() === '' ? 'Sem setor' : m.item.department.trim();
}

// Same "entrou, foi carregado, ou fechou dentro da janela" scope every other
// sprint-filtered screen in the app uses — duplicated locally rather than
// imported since these three aren't exported from sprintSnapshotService
// (TeamDashboardScreen keeps its own copy too).
function createdInSprintLocal(item: WorkItem, sprint: Sprint | null): boolean {
  if (sprint == null) return true;
  const d = item.createdDate;
  return d.getTime() >= sprint.start.getTime() && d.getTime() <= sprintCutoff(sprint).getTime();
}
function endedInSprintLocal(m: ItemMetric, sprint: Sprint | null): boolean {
  if (!m.done) return false;
  if (sprint == null) return true;
  const end = m.endDate;
  if (end == null) return false;
  return end.getTime() >= sprint.start.getTime() && end.getTime() <= sprintCutoff(sprint).getTime();
}
function carriedIntoSprintLocal(m: ItemMetric, sprint: Sprint | null): boolean {
  if (sprint == null) return false;
  if (m.item.createdDate.getTime() >= sprint.start.getTime()) return false;
  if (!m.done) return true;
  const end = m.endDate;
  return end == null || end.getTime() >= sprint.start.getTime();
}

/** First moment this item closed, ever — used only to decide which sprint a
 * rating's card belongs to (card_ratings has no closed-date of its own). */
function closedDateOf(item: WorkItem, doneStates: Set<string>, doneColumn: string): Date | null {
  return item.firstDoneAfter(doneStates, null) ?? item.firstColumnAfter(new Set([doneColumn]), null);
}

interface DeptGroup {
  department: string;
  count: number;
  days: number;
  avgDays: number;
  oldest: ItemMetric | null;
  oldestSince: Date | null;
  items: ItemMetric[];
}

/** Agrupa métricas por setor do solicitante, somando os dias de espera por
 * usuário (m.userDays) de cada card — usado tanto para "concluídos" quanto
 * para "aguardando", pior primeiro. O card mais antigo é o de maior
 * userDays do grupo; "desde" é a primeira vez que ele entrou na coluna de
 * usuário (pode ter reentrado depois, mas serve como referência). */
function buildDeptGroups(userColumns: Set<string>, metrics: ItemMetric[]): DeptGroup[] {
  const byDept = new Map<string, ItemMetric[]>();
  for (const m of metrics) {
    const dept = departmentOf(m);
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept)!.push(m);
  }
  return [...byDept.entries()]
    .map(([department, rawItems]) => {
      const items = [...rawItems].sort((a, b) => b.userDays - a.userDays);
      const days = items.reduce((s, m) => s + m.userDays, 0);
      const oldest = items[0] ?? null;
      return {
        department,
        count: items.length,
        days,
        avgDays: items.length === 0 ? 0 : days / items.length,
        oldest,
        oldestSince: oldest == null ? null : oldest.item.firstEnteredColumn(userColumns),
        items,
      };
    })
    .sort((a, b) => b.days - a.days);
}

/** Por setor do solicitante (WorkItem.department), na sprint selecionada:
 * quanta "dor de cabeça" — dias acumulados de cards que, até o fim daquela
 * sprint, estavam parados em Aguardando Usuário — cada setor gerou pro
 * time, lado a lado com a nota que demos aos cards daquele setor fechados
 * naquela sprint e a nota que estamos recebendo de volta (ainda sem fonte
 * de dado — ver RatingsTab em TeamDashboardScreen, mesma pendência).
 * "Tudo" no seletor lê tudo em tempo real (sem recorte). Isso não é sobre o
 * desempenho do time, é sobre qual setor está trazendo mais chamados
 * difíceis/lentos de fechar. */
export function UsersScreen({
  settings,
  items,
  loading,
  error,
  selectedSprint,
  sprints,
  onSprintChanged,
  ratings,
  ratingsLoading,
}: {
  settings: AppSettings;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  selectedSprint: Sprint | null;
  sprints: Sprint[];
  onSprintChanged: (sprint: Sprint | null) => void;
  ratings: CardRating[];
  ratingsLoading: boolean;
}) {
  const [modalGroup, setModalGroup] = useState<{ title: string; group: DeptGroup } | null>(null);

  if (!settings.isConfigured) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Configure a Conexão para começar.</span>
      </div>
    );
  }

  // sprintCutoff can land in the future for the current/ongoing sprint —
  // doneAsOf/boardColumnAsOf both fall back to "whatever's true right now"
  // when asked about a moment with no history past it yet, so this doesn't
  // need a separate "is this the live sprint" branch.
  const cutoff = selectedSprint == null ? new Date() : sprintCutoff(selectedSprint);

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
  const allMetrics = calculator.calculate(valid, selectedSprint == null ? undefined : cutoff).metrics;
  const metrics =
    selectedSprint == null
      ? allMetrics
      : allMetrics.filter(
          (m) => createdInSprintLocal(m.item, selectedSprint) || carriedIntoSprintLocal(m, selectedSprint) || endedInSprintLocal(m, selectedSprint),
        );

  // Sitting in a board column mapped to "Usuário" as of the sprint's end
  // (or now, for "Tudo"/the live sprint) and not yet done by then — exactly
  // the same definition Sofrimento & filas uses for "Aguardando Usuário",
  // just read at a past point in time and grouped by department instead of
  // by responsible.
  const waitingOnUser = metrics.filter(
    (m) => !doneAsOf(m, cutoff) && boardColumnMatches(settings.userColumnSet, m.item.boardColumnAsOf(cutoff)),
  );

  // Concluídos dentro da janela e que passaram pela coluna de usuário em
  // algum momento (m.userDays > 0) — cards fechados sem nunca esperar
  // usuário não interessam aqui. No "Tudo" olha tudo que já fechou; numa
  // sprint específica, só o que fechou dentro dela (endedInSprintLocal já
  // exige m.done).
  const doneMetrics = metrics.filter((m) => (selectedSprint == null ? m.done : endedInSprintLocal(m, selectedSprint)) && m.userDays > 0);

  const doneGroups = buildDeptGroups(settings.userColumnSet, doneMetrics);
  const waitingGroups = buildDeptGroups(settings.userColumnSet, waitingOnUser);

  // A rating only belongs to a sprint via its card's actual closed date —
  // card_ratings itself carries no date for that. If the rated card isn't
  // in `items` (outside the cached window), it's left out of a sprint-
  // scoped view rather than guessed into one.
  const itemById = new Map(items.map((i) => [i.id, i]));
  const scopedRatings =
    selectedSprint == null
      ? ratings
      : ratings.filter((r) => {
          const item = itemById.get(r.workItemId);
          if (item == null) return false;
          const closed = closedDateOf(item, settings.doneStateSet, settings.doneColumn);
          return closed != null && closed.getTime() >= selectedSprint.start.getTime() && closed.getTime() <= sprintCutoff(selectedSprint).getTime();
        });

  const ratingsByDept = new Map<string, CardRating[]>();
  for (const r of scopedRatings) {
    const dept = r.department.trim() === '' ? 'Sem setor' : r.department.trim();
    if (!ratingsByDept.has(dept)) ratingsByDept.set(dept, []);
    ratingsByDept.get(dept)!.push(r);
  }

  const ratingRows = [...ratingsByDept.entries()]
    .map(([department, departmentRatings]) => ({
      department,
      weAvg: departmentRatings.reduce((s, r) => s + r.stars, 0) / departmentRatings.length,
      weCount: departmentRatings.length,
    }))
    .sort((a, b) => b.weCount - a.weCount);

  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1300, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 'bold' }}>Usuários</div>
            <div style={{ height: 4 }} />
            <div style={{ color: '#64748B' }}>
              Por setor do solicitante, na sprint selecionada: quanta dor de cabeça ficou parada esperando definição do usuário até o fim dela,
              e as avaliações daquela sprint — as que demos e as que estamos recebendo de volta.
            </div>
          </div>
          <select
            style={{ width: 220, height: 38, padding: '4px 10px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff' }}
            value={selectedSprint?.number ?? ''}
            onChange={(e) => {
              const n = e.target.value;
              onSprintChanged(n === '' ? null : sprints.find((s) => s.number === Number(n)) ?? null);
            }}
          >
            <option value="">Tudo (sem recorte)</option>
            {sprints.map((s) => (
              <option key={s.number} value={s.number}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ height: 20 }} />

        {loading && <div style={{ color: '#64748B', fontSize: 13 }}>Carregando itens...</div>}
        {error && <div style={{ color: BrandColors.danger, fontSize: 13 }}>{error}</div>}

        <SectionTitle>Concluídos na sprint</SectionTitle>
        <DeptGroupTable
          groups={doneGroups}
          countLabel="Cards concluídos"
          daysLabel="Dias que esperaram o usuário"
          emptyLabel="Nenhum card concluído nessa janela."
          onSelect={(group) => setModalGroup({ title: `Concluídos — ${group.department}`, group })}
        />

        <div style={{ height: 28 }} />

        <SectionTitle>Aguardando usuário</SectionTitle>
        <DeptGroupTable
          groups={waitingGroups}
          countLabel="Cards esperando usuário"
          daysLabel="Dias acumulados de espera"
          emptyLabel="Nenhum setor com card esperando usuário."
          onSelect={(group) => setModalGroup({ title: `Aguardando usuário — ${group.department}`, group })}
        />

        <div style={{ height: 28 }} />

        <SectionTitle>Avaliações que demos, por setor</SectionTitle>
        {ratingRows.length === 0 ? (
          <div style={cardStyle()}>
            <span style={{ color: '#64748B', fontSize: 13 }}>{ratingsLoading ? 'Carregando avaliações...' : 'Nenhuma avaliação nessa janela.'}</span>
          </div>
        ) : (
          <TableCard>
            <table style={tableStyle()}>
              <thead>
                <tr>
                  <Th>Setor</Th>
                  <Th>Avaliação que demos</Th>
                </tr>
              </thead>
              <tbody>
                {ratingRows.map((r) => (
                  <tr key={r.department}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <UserRound size={14} strokeWidth={2} color="#94A3B8" />
                        <span style={{ fontWeight: 600 }}>{r.department}</span>
                      </div>
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <StarsInline stars={Math.round(r.weAvg)} />
                        <span style={{ fontSize: 12, color: '#64748B' }}>
                          {r.weAvg.toFixed(1)} ({r.weCount})
                        </span>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </div>

      {modalGroup && <DeptGroupModal title={modalGroup.title} group={modalGroup.group} onClose={() => setModalGroup(null)} />}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 8 }}>{children}</div>;
}

function formatDate(d: Date | null): string {
  if (d == null) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Tabela por setor com uma linha-resumo clicável; o clique abre o modal
 * com a lista de cards daquele setor (DeptGroupModal). */
function DeptGroupTable({
  groups,
  countLabel,
  daysLabel,
  emptyLabel,
  onSelect,
}: {
  groups: DeptGroup[];
  countLabel: string;
  daysLabel: string;
  emptyLabel: string;
  onSelect: (group: DeptGroup) => void;
}) {
  if (groups.length === 0) {
    return (
      <div style={cardStyle()}>
        <span style={{ color: '#64748B', fontSize: 13 }}>{emptyLabel}</span>
      </div>
    );
  }
  return (
    <TableCard>
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>Setor</Th>
            <Th>{countLabel}</Th>
            <Th>{daysLabel}</Th>
            <Th>Média por card</Th>
            <Th>Mais antigo esperando</Th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.department} onClick={() => onSelect(g)} style={{ cursor: 'pointer' }}>
              <Td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <UserRound size={14} strokeWidth={2} color="#94A3B8" />
                  <span style={{ fontWeight: 600 }}>{g.department}</span>
                </div>
              </Td>
              <Td>{g.count}</Td>
              <Td>
                {g.count === 0 ? (
                  <span style={{ color: '#CBD5E1' }}>—</span>
                ) : (
                  <span
                    style={{
                      fontWeight: 700,
                      color: g.days >= 30 ? BrandColors.danger : g.days >= 10 ? BrandColors.warning : '#334155',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {g.days >= 30 && <AlertTriangle size={13} strokeWidth={2} />}
                    {g.days.toFixed(0)}d
                  </span>
                )}
              </Td>
              <Td>{g.count === 0 ? <span style={{ color: '#CBD5E1' }}>—</span> : `${g.avgDays.toFixed(1)}d`}</Td>
              <Td>
                {g.oldest == null ? (
                  <span style={{ color: '#CBD5E1' }}>—</span>
                ) : (
                  <span>
                    #{g.oldest.item.id} · {g.oldest.userDays.toFixed(0)}d{g.oldestSince != null && ` (desde ${formatDate(g.oldestSince)})`}
                  </span>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/** Modal com a lista de cards de um setor — responsável e dias que cada
 * card esperou usuário, pior primeiro (mesma ordenação do grupo). */
function DeptGroupModal({ title, group, onClose }: { title: string; group: DeptGroup; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        style={{ backgroundColor: '#fff', borderRadius: 12, maxWidth: 760, width: '90%', maxHeight: '85vh', overflowY: 'auto', padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1, fontWeight: 'bold', fontSize: 16 }}>{title}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div style={{ height: 12 }} />
        {group.items.length === 0 ? (
          <span style={{ color: '#64748B', fontSize: 13 }}>Nenhum card.</span>
        ) : (
          <TableCard>
            <table style={tableStyle()}>
              <thead>
                <tr>
                  <Th>Card</Th>
                  <Th>Responsável</Th>
                  <Th>Dias esperando usuário</Th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((m) => (
                  <tr key={m.item.id}>
                    <Td>
                      <span style={{ fontWeight: 500 }}>#{m.item.id}</span> {m.item.title}
                    </Td>
                    <Td>{m.item.assignedTo.trim() === '' ? 'Sem responsável' : m.item.assignedTo}</Td>
                    <Td>{m.userDays.toFixed(0)}d</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableCard>
        )}
      </div>
    </div>
  );
}

function StarsInline({ stars }: { stars: number }) {
  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={13} strokeWidth={1.75} fill={n <= stars ? '#F59E0B' : 'none'} color={n <= stars ? '#F59E0B' : '#CBD5E1'} />
      ))}
    </div>
  );
}

function cardStyle(): React.CSSProperties {
  return { backgroundColor: BrandColors.cardBg, border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 };
}
function tableStyle(): React.CSSProperties {
  return { borderCollapse: 'collapse', width: '100%', fontSize: 13 };
}
function Th({ children }: { children?: ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
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
function Td({ children }: { children: ReactNode }) {
  return (
    <td style={{ textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, whiteSpace: 'nowrap' }}>{children}</td>
  );
}
function TableCard({ children }: { children: ReactNode }) {
  return (
    <div style={{ ...cardStyle(), padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}
