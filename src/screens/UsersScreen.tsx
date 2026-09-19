import type { ReactNode } from 'react';
import { AlertTriangle, Star, UserRound } from 'lucide-react';
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

interface DepartmentRow {
  department: string;
  waitingCount: number;
  waitingDays: number;
  weAvg: number | null;
  weCount: number;
  waitingItems: ItemMetric[];
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

  const byDept = new Map<string, ItemMetric[]>();
  for (const m of waitingOnUser) {
    const dept = departmentOf(m);
    if (!byDept.has(dept)) byDept.set(dept, []);
    byDept.get(dept)!.push(m);
  }

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

  const allDepartments = new Set<string>([...byDept.keys(), ...ratingsByDept.keys()]);
  const rows: DepartmentRow[] = [...allDepartments].map((department) => {
    const waitingItems = byDept.get(department) ?? [];
    const departmentRatings = ratingsByDept.get(department) ?? [];
    return {
      department,
      waitingCount: waitingItems.length,
      waitingDays: waitingItems.reduce((s, m) => s + m.userDays, 0),
      weAvg: departmentRatings.length === 0 ? null : departmentRatings.reduce((s, r) => s + r.stars, 0) / departmentRatings.length,
      weCount: departmentRatings.length,
      waitingItems,
    };
  });
  rows.sort((a, b) => b.waitingDays - a.waitingDays);

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

        {rows.length === 0 && !loading ? (
          <div style={cardStyle()}>
            <span style={{ color: '#64748B', fontSize: 13 }}>Nenhum setor com dado ainda.</span>
          </div>
        ) : (
          <TableCard>
            <table style={tableStyle()}>
              <thead>
                <tr>
                  <Th>Setor</Th>
                  <Th>Cards esperando usuário</Th>
                  <Th>Dias acumulados de espera</Th>
                  <Th>Avaliação que demos</Th>
                  <Th>Avaliação recebida</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.department}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <UserRound size={14} strokeWidth={2} color="#94A3B8" />
                        <span style={{ fontWeight: 600 }}>{r.department}</span>
                      </div>
                    </Td>
                    <Td>{r.waitingCount}</Td>
                    <Td>
                      {r.waitingCount === 0 ? (
                        <span style={{ color: '#CBD5E1' }}>—</span>
                      ) : (
                        <span
                          style={{
                            fontWeight: 700,
                            color: r.waitingDays >= 30 ? BrandColors.danger : r.waitingDays >= 10 ? BrandColors.warning : '#334155',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          {r.waitingDays >= 30 && <AlertTriangle size={13} strokeWidth={2} />}
                          {r.waitingDays.toFixed(0)}d
                        </span>
                      )}
                    </Td>
                    <Td>
                      {r.weAvg == null ? (
                        <span style={{ color: '#CBD5E1' }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <StarsInline stars={Math.round(r.weAvg)} />
                          <span style={{ fontSize: 12, color: '#64748B' }}>
                            {r.weAvg.toFixed(1)} ({r.weCount})
                          </span>
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span style={{ color: '#CBD5E1' }}>{ratingsLoading ? '...' : '— (sem dado ainda)'}</span>
                    </Td>
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
