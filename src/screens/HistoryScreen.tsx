import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus, RefreshCw } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ItemMetric } from '../services/metricsService';
import { WorkItem } from '../models/workItem';
import { AppSettings } from '../services/settingsService';
import { Sprint, SprintService } from '../services/sprintService';
import { buildSprintSnapshot, defaultPerformanceGroupKeys, isAttributedTo, performanceGroups, sprintScope, SprintSnapshot } from '../services/sprintSnapshotService';
import { BrandColors } from '../theme';
import { ToggleChip } from '../components/ToggleChip';

const sprintService = new SprintService();

function areaLeaf(areaPath: string): string {
  const trimmed = areaPath.trim();
  if (trimmed === '') return 'Sem área';
  return trimmed.split('\\').pop() ?? trimmed;
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

/** One sprint's entered/closed items — the shared raw material every
 * breakdown below (cycle time por área/estágio/responsável, conversão por
 * responsável) slices differently, so it's computed once per sprint. */
interface SprintClosed {
  sprint: Sprint;
  entered: ItemMetric[];
  closed: ItemMetric[];
}

const SERIES_COLORS = [BrandColors.developer, BrandColors.queue, BrandColors.user, BrandColors.vendor, BrandColors.general, BrandColors.triage, BrandColors.total];

/** Consolidates every cycle-time view the app has (previously scattered
 * across Dashboard's "Cycle Time é..." selector and Visão do time's
 * per-stage rankings) into one place, sprint-over-sprint: overall, by área,
 * by estágio (Triagem/Desenvolvimento/Usuário/Fornecedor), and by
 * responsável — plus the entradas/concluídos/conversão history this screen
 * already had. `items` is ONE broad batch (covering the whole date range
 * being compared), fetched and cached by AppShell — not by this screen —
 * so switching tabs away and back never silently re-fetches; only
 * `onRefresh` or a wider `sprintCount` does. Reconstructs every past
 * sprint's numbers from each item's own history. */
export function HistoryScreen({
  settings,
  items,
  loading,
  error,
  sprintCount,
  onSprintCountChanged,
  onRefresh,
}: {
  settings: AppSettings;
  items: WorkItem[] | null;
  loading: boolean;
  error: string | null;
  sprintCount: number;
  onSprintCountChanged: (n: number) => void;
  onRefresh: () => void;
}) {
  if (!settings.isConfigured) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Configure a Conexão para começar.</span>
      </div>
    );
  }

  const current = sprintService.sprintNumberContaining(new Date());
  const sprints: Sprint[] = [];
  for (let n = current - sprintCount + 1; n <= current; n++) sprints.push(sprintService.sprintFor(n));

  const rows: [Sprint, SprintSnapshot][] =
    items != null ? sprints.map((s) => [s, buildSprintSnapshot({ items, settings, sprint: s })]) : [];

  const closedBySprint: SprintClosed[] =
    items != null ? sprints.map((s) => ({ sprint: s, ...sprintScope({ items, settings, sprint: s }) })) : [];

  const currentSnapshot = rows.length > 0 ? rows[rows.length - 1][1] : null;

  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 1200, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 'bold' }}>Cycle Time & Histórico</div>
            <div style={{ height: 4 }} />
            <div style={{ color: '#64748B' }}>
              Tudo que é Cycle Time num lugar só — geral, por área, por estágio e por responsável — junto com o histórico de
              entradas/conclusões/conversão, reconstruído sprint a sprint a partir do histórico completo de cada card.
            </div>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 160 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#334155' }}>Quantas sprints</span>
            <select
              value={sprintCount}
              disabled={loading}
              onChange={(e) => onSprintCountChanged(Number(e.target.value))}
              style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff', fontSize: 13 }}
            >
              {[4, 6, 8, 12].map((n) => (
                <option key={n} value={n}>
                  Últimas {n}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={onRefresh}
            disabled={loading}
            style={{
              marginTop: 20,
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
        {loading && rows.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>Carregando...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>Sem dados ainda.</div>
        ) : (
          <>
            {currentSnapshot && (
              <>
                <CurrentSprintStrip sprint={sprints[sprints.length - 1]} snapshot={currentSnapshot} />
                <div style={{ height: 20 }} />
              </>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
              <div style={{ flex: '1 1 380px' }}>
                <ChartCard title="Conversão por sprint (Concluídos ÷ Entraram)" footnote={loading ? 'Atualizando…' : undefined}>
                  <ConversionChart rows={rows} />
                </ChartCard>
              </div>
              <div style={{ flex: '1 1 380px' }}>
                <ChartCard title="Cycle Time (Geral) por sprint">
                  <CycleTimeChart rows={rows} />
                </ChartCard>
              </div>
            </div>

            <div style={{ height: 28 }} />
            <SectionTitle title="Cycle Time por área" subtitle="Cycle Time (Geral) médio dos itens concluídos em cada sprint, uma linha por área." />
            <div style={{ height: 12 }} />
            <ChartCard title="Evolução por área" tall>
              <CategoryCycleTimeChart closedBySprint={closedBySprint} groupOf={(m) => areaLeaf(m.item.areaPath)} valueOf={(m) => m.generalDays} />
            </ChartCard>

            <div style={{ height: 28 }} />
            <SectionTitle
              title="Cycle Time por estágio"
              subtitle="Tempo médio (dias) que os itens concluídos em cada sprint passaram em cada um dos agrupamentos — Triagem, Fila, Desenvolvedor, Usuário, Fornecedor, Geral."
            />
            <div style={{ height: 12 }} />
            <ChartCard title="Evolução por estágio" tall>
              <StageCycleTimeChart closedBySprint={closedBySprint} />
            </ChartCard>

            <div style={{ height: 28 }} />
            <SectionTitle
              title="Cycle Time por responsável"
              subtitle="Um card por responsável — marque os grupos (Triagem, Fila, Desenvolvedor, Usuário, Fornecedor, Geral) pra ver a evolução do tempo médio dela(e) naquele estágio, nas últimas sprints."
            />
            <div style={{ height: 12 }} />
            <ResponsibleCycleTimeCards closedBySprint={closedBySprint} settings={settings} />

            <div style={{ height: 28 }} />
            <SectionTitle
              title="Conversão por responsável"
              subtitle="Evolução da conversão (Concluídos ÷ Entraram) de cada responsável nas últimas sprints — mesma lógica de 'Entraram/Concluídos' do topo, por pessoa. Passe o mouse num ponto pra ver o raio-x (entraram X, concluíram Y)."
            />
            <div style={{ height: 12 }} />
            <ResponsibleConversionCards closedBySprint={closedBySprint} settings={settings} />

            <div style={{ height: 28 }} />
            <div style={{ fontSize: 16, fontWeight: 'bold' }}>Sprint a sprint</div>
            <div style={{ height: 12 }} />
            <HistoryTable rows={rows} />
          </>
        )}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 'bold' }}>{title}</div>
      <div style={{ height: 2 }} />
      <div style={{ fontSize: 12.5, color: '#64748B' }}>{subtitle}</div>
    </div>
  );
}

/** The current sprint's headline numbers, highlighted above the trend
 * charts — priority read before diving into "how did we get here". */
function CurrentSprintStrip({ sprint, snapshot }: { sprint: Sprint; snapshot: SprintSnapshot }) {
  const values: [string, string][] = [
    [`Sprint ${sprint.number}`, 'Sprint atual'],
    [`${snapshot.entered}`, 'Entraram'],
    [`${snapshot.closed}`, 'Concluídos'],
    [`${snapshot.stillOpen}`, 'Saída'],
    [snapshot.conversionPercent == null ? '—' : `${snapshot.conversionPercent.toFixed(0)}%`, 'Conversão'],
    [snapshot.generalDaysAvg == null ? '—' : `${snapshot.generalDaysAvg.toFixed(1)} dias`, 'Cycle Time (Geral)'],
  ];
  return (
    <div style={{ backgroundColor: '#fff', border: `1.5px solid ${BrandColors.primary}`, borderRadius: 14, padding: '18px 22px', display: 'flex', boxShadow: '0 2px 12px rgba(15,23,42,0.04)' }}>
      {values.map(([value, label], i) => (
        <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {i > 0 && <div style={{ width: 1, height: 34, backgroundColor: BrandColors.border, marginRight: 18 }} />}
          <div>
            <div style={{ fontSize: i === 0 ? 16 : 20, fontWeight: 'bold', color: i === 0 ? BrandColors.primaryDark : undefined }}>{value}</div>
            <div style={{ fontSize: 11.5, color: '#64748B' }}>{label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ title, footnote, tall, children }: { title: string; footnote?: string; tall?: boolean; children: ReactNode }) {
  // No `height: '100%'` here on purpose: a couple of these cards sit alone
  // (not inside a flex row), where a percentage height with no ancestor
  // that has a definite height resolves unpredictably and can send
  // recharts' ResponsiveContainer into a measure/grow feedback loop —
  // this is what caused the "several-thousand-pixel-tall blank div" bug.
  // The side-by-side pair (Conversão + Cycle Time Geral) still matches
  // height fine on its own: flexbox's default `align-items: stretch`
  // handles that without any of these cards needing an explicit height.
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16, boxSizing: 'border-box' }}>
      <div style={{ fontSize: 15, fontWeight: 'bold' }}>{title}</div>
      <div style={{ height: 16 }} />
      <div style={{ height: tall ? 280 : 220 }}>{children}</div>
      {footnote && (
        <>
          <div style={{ height: 8 }} />
          <div style={{ fontSize: 12, color: '#64748B' }}>{footnote}</div>
        </>
      )}
    </div>
  );
}

function ConversionChart({ rows }: { rows: [Sprint, SprintSnapshot][] }) {
  const data = rows.map(([sprint, snap]) => ({ label: `S${sprint.number}`, value: snap.conversionPercent })).filter((d) => d.value != null);
  if (data.length === 0) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sem sprints com dados suficientes ainda.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v) => `${Number(v).toFixed(0)}%`} />
        <Line type="linear" dataKey="value" stroke={BrandColors.primary} strokeWidth={3} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}

function CycleTimeChart({ rows }: { rows: [Sprint, SprintSnapshot][] }) {
  const data = rows.map(([sprint, snap]) => ({ label: `S${sprint.number}`, value: snap.generalDaysAvg })).filter((d) => d.value != null);
  if (data.length === 0) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sem itens concluídos nessas sprints ainda.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v) => `${Number(v).toFixed(1)}d`} />
        <Line type="linear" dataKey="value" stroke={BrandColors.developer} strokeWidth={3} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Multi-line chart, one line per category (área, tipo, etc.) — [groupOf]
 * buckets each closed item into a category, [valueOf] picks which duration
 * to average within that bucket. Caps at the top 6 categories by total
 * volume across the range so the legend doesn't overflow. */
function CategoryCycleTimeChart({
  closedBySprint,
  groupOf,
  valueOf,
}: {
  closedBySprint: SprintClosed[];
  groupOf: (m: ItemMetric) => string;
  valueOf: (m: ItemMetric) => number;
}) {
  const totalByGroup = new Map<string, number>();
  for (const { closed } of closedBySprint) {
    for (const m of closed) {
      const g = groupOf(m);
      totalByGroup.set(g, (totalByGroup.get(g) ?? 0) + 1);
    }
  }
  const groups = [...totalByGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([g]) => g);

  if (groups.length === 0) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sem itens concluídos nessas sprints ainda.</div>;
  }

  const data = closedBySprint.map(({ sprint, closed }) => {
    const row: Record<string, string | number | null> = { label: `S${sprint.number}` };
    for (const g of groups) {
      const inGroup = closed.filter((m) => groupOf(m) === g);
      row[g] = average(inGroup.map(valueOf));
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v) => `${Number(v).toFixed(1)}d`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {groups.map((g, i) => (
          <Line key={g} type="linear" dataKey={g} name={g} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={2.5} dot connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// Maps each performanceGroup's key to the ItemMetric duration it corresponds
// to for a CLOSED item — the groups themselves are defined in terms of board
// columns (for classifying still-open items in "Ranking de performance"),
// but a finished item's time-in-stage is already tracked directly.
const GROUP_VALUE_OF: Record<string, (m: ItemMetric) => number> = {
  triagem: (m) => m.triageDays,
  fila: (m) => m.queueDays,
  desenvolvedor: (m) => m.cycleTimeDays,
  usuario: (m) => m.userDays,
  fornecedor: (m) => m.vendorDays,
  geral: (m) => m.generalDays,
};
// A deliberately high-contrast, spread-out palette — 6 lines on the same
// chart need to stay tellable apart at a glance, more than they need to
// match some other screen's color for the same concept.
const GROUP_COLOR: Record<string, string> = {
  triagem: '#6366F1', // indigo
  fila: '#F59E0B', // amber
  desenvolvedor: '#2563EB', // blue
  usuario: '#16A34A', // green
  fornecedor: '#D946EF', // magenta
  geral: '#06B6D4', // cyan
};

/** One fixed line per estágio (Triagem/Fila/Desenvolvedor/Usuário/
 * Fornecedor/Geral — the same performanceGroups used everywhere else) —
 * unlike área, every closed item contributes a value to all 6 series at
 * once (they're durations within the same card, not mutually exclusive
 * categories), so this doesn't need the top-N grouping CategoryCycleTimeChart
 * does. */
function StageCycleTimeChart({ closedBySprint }: { closedBySprint: SprintClosed[] }) {
  const hasAnyData = closedBySprint.some((s) => s.closed.length > 0);
  if (!hasAnyData) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Sem itens concluídos nessas sprints ainda.</div>;
  }
  const data = closedBySprint.map(({ sprint, closed }) => {
    const row: Record<string, string | number | null> = { label: `S${sprint.number}` };
    for (const g of performanceGroups) {
      row[g.key] = average(closed.map(GROUP_VALUE_OF[g.key]));
    }
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v) => `${Number(v).toFixed(1)}d`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {performanceGroups.map((g) => (
          <Line key={g.key} type="linear" dataKey={g.key} name={g.label} stroke={GROUP_COLOR[g.key]} strokeWidth={2.5} dot connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
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

function TableCard({ children, isEmpty, emptyMessage }: { children: ReactNode; isEmpty: boolean; emptyMessage: string }) {
  if (isEmpty) {
    return (
      <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
        <span style={{ color: '#64748B' }}>{emptyMessage}</span>
      </div>
    );
  }
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}

/** Hovering the single summed line shows the "raio-x": how much of that
 * sprint's total came from each selected group. Reads every group's value
 * off the hovered point's own data row (not off `payload`, which only ever
 * carries the one `total` series actually plotted) so the breakdown always
 * matches whichever line is currently drawn. */
function CycleTimeBreakdownTooltip({
  active,
  payload,
  selected,
}: {
  active?: boolean;
  payload?: { payload: Record<string, string | number | null> }[];
  selected: Set<string>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const total = row.total;
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 16px rgba(15,23,42,0.1)' }}>
      <div style={{ fontWeight: 'bold', marginBottom: 6 }}>
        {row.label} — {typeof total === 'number' ? `${total.toFixed(1)}d total` : '—'}
      </div>
      {performanceGroups
        .filter((g) => selected.has(g.key))
        .map((g) => {
          const value = row[g.key];
          return (
            <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '1px 0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: GROUP_COLOR[g.key], flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{g.label}</span>
              <span style={{ fontWeight: 600 }}>{typeof value === 'number' ? `${value.toFixed(1)}d` : '—'}</span>
            </div>
          );
        })}
    </div>
  );
}

/** Hovering a responsible's conversion line shows the raio-x behind that
 * percentage: how many entraram and how many concluíram that sprint —
 * a "62%" reads very differently as 5/8 versus 62/100. */
function ConversionBreakdownTooltip({ active, payload }: { active?: boolean; payload?: { payload: { label: string; conversion: number | null; entered: number; closed: number } }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, boxShadow: '0 4px 16px rgba(15,23,42,0.1)' }}>
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
        {row.label} — {row.conversion == null ? '—' : `${row.conversion.toFixed(0)}%`}
      </div>
      <div>
        Entraram <b>{row.entered}</b> · Concluíram <b>{row.closed}</b>
      </div>
    </div>
  );
}

/** One card per responsible with at least one item entered or closed
 * somewhere in the range — conversão (Concluídos ÷ Entraram) evolution
 * across the sprint range, mirroring the "Ranking de performance" concept
 * from Visão do time but as a per-person trend instead of a single-sprint
 * ranking. Hover shows the raio-x behind each point. */
function ResponsibleConversionCards({ closedBySprint, settings }: { closedBySprint: SprintClosed[]; settings: AppSettings }) {
  const names = new Set<string>();
  for (const { entered, closed } of closedBySprint) {
    for (const m of [...entered, ...closed]) {
      const name = m.item.assignedTo.trim();
      if (name !== '') names.add(name);
      if (isAttributedTo(m, settings.myDisplayName, settings)) names.add(settings.myDisplayName.trim());
    }
  }
  const sortedNames = [...names].sort((a, b) => a.localeCompare(b));

  if (sortedNames.length === 0) {
    return (
      <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
        <span style={{ color: '#64748B' }}>Sem dados ainda.</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      {sortedNames.map((name) => {
        const data = closedBySprint.map(({ sprint, entered, closed }) => {
          const mineEntered = entered.filter((m) => isAttributedTo(m, name, settings)).length;
          const mineClosed = closed.filter((m) => isAttributedTo(m, name, settings)).length;
          return {
            label: `S${sprint.number}`,
            entered: mineEntered,
            closed: mineClosed,
            conversion: mineEntered === 0 ? null : (mineClosed / mineEntered) * 100,
          };
        });
        const totalEntered = data.reduce((s, d) => s + d.entered, 0);

        return (
          <div key={name} style={{ flex: '1 1 420px', backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: 'bold', fontSize: 14 }}>{name}</span>
              <span style={{ fontSize: 11.5, color: '#94A3B8' }}>
                {totalEntered} {totalEntered === 1 ? 'item entrou' : 'itens entraram'} no período
              </span>
            </div>
            <div style={{ height: 12 }} />
            <div style={{ height: 180 }}>
              {totalEntered === 0 ? (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>Sem itens entrados nesse período.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={30} domain={[0, 100]} />
                    <Tooltip content={<ConversionBreakdownTooltip />} />
                    <Line type="linear" dataKey="conversion" name="Conversão" stroke={BrandColors.primary} strokeWidth={2.5} dot connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** One card per responsible with at least one item closed somewhere in the
 * range — a single line (the sum of whichever groups are checked in the
 * shared chip row above the grid) per sprint, with a hover tooltip that
 * breaks that total back down per group ("raio-x"), instead of one line per
 * group cluttering the chart. */
function ResponsibleCycleTimeCards({ closedBySprint, settings }: { closedBySprint: SprintClosed[]; settings: AppSettings }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultPerformanceGroupKeys));

  const names = new Set<string>();
  for (const { closed } of closedBySprint) {
    for (const m of closed) {
      const name = m.item.assignedTo.trim();
      if (name !== '') names.add(name);
      if (isAttributedTo(m, settings.myDisplayName, settings)) names.add(settings.myDisplayName.trim());
    }
  }
  const sortedNames = [...names].sort((a, b) => a.localeCompare(b));

  if (sortedNames.length === 0) {
    return (
      <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
        <span style={{ color: '#64748B' }}>Nenhum item concluído nesse período.</span>
      </div>
    );
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {performanceGroups.map((g) => (
          <ToggleChip key={g.key} label={g.label} selected={selected.has(g.key)} onSelected={() => toggle(g.key)} />
        ))}
      </div>
      <div style={{ height: 16 }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {sortedNames.map((name) => {
          const mine = closedBySprint.map(({ sprint, closed }) => ({
            sprint,
            closed: closed.filter((m) => isAttributedTo(m, name, settings)),
          }));
          const data = mine.map(({ sprint, closed }) => {
            const row: Record<string, string | number | null> = { label: `S${sprint.number}` };
            let total = 0;
            let anyValue = false;
            for (const g of performanceGroups) {
              if (!selected.has(g.key)) continue;
              const value = average(closed.map(GROUP_VALUE_OF[g.key]));
              row[g.key] = value;
              if (value != null) {
                total += value;
                anyValue = true;
              }
            }
            row.total = anyValue ? total : null;
            return row;
          });
          const totalClosed = mine.reduce((s, m) => s + m.closed.length, 0);

          return (
            <div key={name} style={{ flex: '1 1 420px', backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 'bold', fontSize: 14 }}>{name}</span>
                <span style={{ fontSize: 11.5, color: '#94A3B8' }}>
                  {totalClosed} {totalClosed === 1 ? 'item concluído' : 'itens concluídos'} no período
                </span>
              </div>
              <div style={{ height: 12 }} />
              <div style={{ height: 180 }}>
                {selected.size === 0 ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>Marque ao menos um grupo.</div>
                ) : totalClosed === 0 ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>Sem itens concluídos nesse período.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip content={<CycleTimeBreakdownTooltip selected={selected} />} />
                      <Line type="linear" dataKey="total" name="Cycle Time" stroke={BrandColors.developer} strokeWidth={2.5} dot connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HistoryTable({ rows }: { rows: [Sprint, SprintSnapshot][] }) {
  return (
    <TableCard isEmpty={false} emptyMessage="">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>Sprint</Th>
            <Th>Entraram</Th>
            <Th>Concluídos</Th>
            <Th>Saída</Th>
            <Th>Conversão</Th>
            <Th>Cycle Time (Geral)</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([sprint, snap], i) => (
            <tr key={sprint.number}>
              <Td>Sprint {sprint.number}</Td>
              <Td>{snap.entered}</Td>
              <Td>{snap.closed}</Td>
              <Td>{snap.stillOpen}</Td>
              <Td>
                <TrendCell value={snap.conversionPercent} previous={i > 0 ? rows[i - 1][1].conversionPercent : null} format={(v) => `${v.toFixed(0)}%`} />
              </Td>
              <Td>
                <TrendCell value={snap.generalDaysAvg} previous={i > 0 ? rows[i - 1][1].generalDaysAvg : null} format={(v) => `${v.toFixed(1)}d`} lowerIsBetter />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

/** Shows a value plus an arrow comparing it to the previous sprint —
 * not just "what is it" but "did it get better or worse". `lowerIsBetter`
 * flips the color (e.g. Cycle Time dropping is good, Conversão dropping is
 * bad). */
function TrendCell({
  value,
  previous,
  format,
  lowerIsBetter = false,
}: {
  value: number | null;
  previous: number | null;
  format: (v: number) => string;
  lowerIsBetter?: boolean;
}) {
  if (value == null) return <span>—</span>;
  if (previous == null) return <span>{format(value)}</span>;

  const delta = value - previous;
  const epsilon = 0.05;
  let arrow: ReactNode;
  let color: string;
  if (Math.abs(delta) < epsilon) {
    arrow = <Minus size={12} strokeWidth={2} />;
    color = '#64748B';
  } else {
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    arrow = delta > 0 ? <ArrowUp size={12} strokeWidth={2} /> : <ArrowDown size={12} strokeWidth={2} />;
    color = improved ? BrandColors.user : BrandColors.danger;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {format(value)}
      <span style={{ color, display: 'flex' }}>{arrow}</span>
    </span>
  );
}
