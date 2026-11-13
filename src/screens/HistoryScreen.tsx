import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Minus, RefreshCw, X } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ItemMetric } from '../services/metricsService';
import { WorkItem } from '../models/workItem';
import { AppSettings } from '../services/settingsService';
import { Sprint, SprintService } from '../services/sprintService';
import { buildSprintSnapshot, isAttributedTo, personCycleDays, performanceGroups, sprintScope, SprintSnapshot } from '../services/sprintSnapshotService';
import { BrandColors } from '../theme';

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
                <ChartCard title="Cycle Time do time por sprint">
                  <CycleTimeChart rows={rows} />
                </ChartCard>
              </div>
              <div style={{ flex: '1 1 380px' }}>
                <ChartCard
                  title="Atrasados por sprint (prazo original na sprint)"
                  footnote="Concluídos com atraso + ainda abertos com prazo vencido. Cards sem prazo original ficam de fora."
                >
                  <OverdueChart rows={rows} />
                </ChartCard>
              </div>
            </div>

            <div style={{ height: 28 }} />
            <SectionTitle title="Cycle Time por área" subtitle="Cycle Time do time médio (sem Triagem e Backlog) dos itens concluídos em cada sprint, uma linha por área." />
            <div style={{ height: 12 }} />
            <ChartCard title="Evolução por área" tall>
              <CategoryCycleTimeChart closedBySprint={closedBySprint} groupOf={(m) => areaLeaf(m.item.areaPath)} valueOf={(m) => m.teamCycleDays} />
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
              title="Velocidade × entrega por responsável"
              subtitle="Cycle Time, volume de concluídos e conversão lado a lado, com uma leitura que cruza os três — Cycle Time caindo só é boa notícia se a pessoa continua entregando."
            />
            <div style={{ height: 12 }} />
            <ResponsibleOverviewTable closedBySprint={closedBySprint} settings={settings} />

            <div style={{ height: 28 }} />
            <SectionTitle
              title="Cycle Time por responsável"
              subtitle="Um card por responsável com a evolução do Cycle Time médio dos itens concluídos, sprint a sprint."
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
    [snapshot.cycleDaysAvg == null ? '—' : `${snapshot.cycleDaysAvg.toFixed(1)} dias`, 'Cycle Time do time'],
    [`${snapshot.overdueTotal}`, 'Atrasados'],
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
  const data = rows.map(([sprint, snap]) => ({ label: `S${sprint.number}`, value: snap.cycleDaysAvg })).filter((d) => d.value != null);
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

/** Stacked bars per sprint: cards whose original deadline fell in that
 * sprint and that missed it — already concluded late vs. still open. */
function OverdueChart({ rows }: { rows: [Sprint, SprintSnapshot][] }) {
  const data = rows.map(([sprint, snap]) => ({ label: `S${sprint.number}`, done: snap.overdueDone, open: snap.overdueOpen }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="done" name="Concluídos com atraso" stackId="overdue" fill={BrandColors.warning} />
        <Bar dataKey="open" name="Ainda abertos" stackId="overdue" fill={BrandColors.danger} />
      </BarChart>
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
            {(() => {
              const trend = conversionTrend(data.map((d) => ({ label: d.label, value: d.conversion })));
              if (trend == null) return null;
              return (
                <div style={{ marginTop: 8, fontSize: 12, color: '#475569', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, color: trend.color, whiteSpace: 'nowrap' }}>
                    {trend.arrow} {trend.title}
                  </span>
                  <span>{trend.detail}</span>
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

type TrendDir = 'up' | 'down' | 'stable';
type TrendInfo = { dir: TrendDir; arrow: string; title: string; color: string; detail: string };

const TREND_STABLE_PCT = 15;

/** Reads a Cycle Time series (lower is better) as "caindo / subindo /
 * estável": compares the average of the first half of the sprints that have
 * data against the second half, plus the latest sprint against the one
 * before it. Needs at least 3 sprints with data to say anything. */
function cycleTrend(points: { label: string; value: number | null }[]): TrendInfo | null {
  const withData = points.filter((p): p is { label: string; value: number } => p.value != null);
  if (withData.length < 3) return null;
  const half = Math.floor(withData.length / 2);
  const first = withData.slice(0, half).reduce((s, p) => s + p.value, 0) / half;
  const secondPoints = withData.slice(withData.length - half);
  const second = secondPoints.reduce((s, p) => s + p.value, 0) / half;
  const pct = first === 0 ? 0 : ((second - first) / first) * 100;
  const last = withData[withData.length - 1];
  const prev = withData[withData.length - 2];
  const lastStep = `${prev.label} → ${last.label}: ${prev.value.toFixed(1)}d → ${last.value.toFixed(1)}d`;
  const range = `Média de ${first.toFixed(1)}d no início para ${second.toFixed(1)}d agora (${pct > 0 ? '+' : ''}${pct.toFixed(0)}%). ${lastStep}.`;
  if (pct <= -TREND_STABLE_PCT) return { dir: 'down', arrow: '↓', title: 'Caindo (melhorando)', color: '#16A34A', detail: range };
  if (pct >= TREND_STABLE_PCT) return { dir: 'up', arrow: '↑', title: 'Subindo (piorando)', color: BrandColors.danger, detail: range };
  return { dir: 'stable', arrow: '→', title: 'Estável', color: '#64748B', detail: range };
}

/** Days a card sat waiting on the user or the vendor — time that isn't the
 * responsible's to own. Capped at the Cycle Time shown for that person, and
 * zero for tag-credited cards (those already count only dev time). */
function externalWaitDays(m: ItemMetric, name: string, settings: AppSettings): number {
  const cycle = personCycleDays(m, name, settings);
  if (cycle === m.cycleTimeDays && cycle !== m.inProgressCycleDays) return 0;
  return Math.min(m.userDays + m.vendorDays, cycle);
}

/** Volume trend: average concluídos per sprint, first half vs second half,
 * counting sprints with zero deliveries (that's the whole point). */
function volumeTrend(counts: number[]): TrendInfo | null {
  if (counts.length < 3) return null;
  const half = Math.floor(counts.length / 2);
  const first = counts.slice(0, half).reduce((s, c) => s + c, 0) / half;
  const second = counts.slice(counts.length - half).reduce((s, c) => s + c, 0) / half;
  const diff = second - first;
  const limit = Math.max(1, first * 0.25);
  const detail = `${first.toFixed(1)} → ${second.toFixed(1)} concluídos por sprint`;
  if (diff >= limit) return { dir: 'up', arrow: '↑', title: 'Entregando mais', color: '#16A34A', detail };
  if (diff <= -limit) return { dir: 'down', arrow: '↓', title: 'Entregando menos', color: BrandColors.danger, detail };
  return { dir: 'stable', arrow: '→', title: 'Volume estável', color: '#64748B', detail };
}

/** Crosses speed (Cycle Time) with delivery (volume + conversão) — a falling
 * Cycle Time only counts as good news if the person is still delivering. */
function readingFor(cycle: TrendInfo | null, own: TrendInfo | null, volume: TrendInfo | null, conversion: TrendInfo | null): { text: string; color: string } {
  if (cycle == null || volume == null) return { text: 'Poucas sprints com dados pra avaliar.', color: '#94A3B8' };
  const delivery: TrendDir = volume.dir !== 'stable' ? volume.dir : conversion?.dir ?? 'stable';
  // Cycle Time up, but the person's own time (without waiting on user/vendor)
  // isn't: the slowdown isn't theirs.
  if (cycle.dir === 'up' && own != null && own.dir !== 'up') {
    return { text: 'Cycle Time sobe por espera de usuário/fornecedor — o tempo da própria pessoa não piorou.', color: '#2563EB' };
  }
  if (cycle.dir === 'down' && delivery === 'down') return { text: 'Atenção: Cycle Time melhora, mas entrega menos.', color: '#B45309' };
  if (cycle.dir === 'down') return { text: 'Melhorando de verdade: mais rápido e entregando igual ou mais.', color: '#16A34A' };
  if (cycle.dir === 'up' && delivery === 'down') return { text: 'Piorando nos dois: mais lento e entregando menos.', color: BrandColors.danger };
  if (cycle.dir === 'up') return { text: 'Mais lento, mas entregando igual ou mais — vale olhar os cards pesados.', color: '#B45309' };
  if (delivery === 'down') return { text: 'Velocidade estável, mas entrega caindo.', color: '#B45309' };
  if (delivery === 'up') return { text: 'Velocidade estável e entregando mais.', color: '#16A34A' };
  return { text: 'Tudo estável.', color: '#64748B' };
}

/** One row per responsible: Cycle Time, volume and conversion trends side by
 * side, plus a reading that crosses them. */
function ResponsibleOverviewTable({ closedBySprint, settings }: { closedBySprint: SprintClosed[]; settings: AppSettings }) {
  const names = new Set<string>();
  for (const { entered, closed } of closedBySprint) {
    for (const m of [...entered, ...closed]) {
      const name = m.item.assignedTo.trim();
      if (name !== '') names.add(name);
      if (isAttributedTo(m, settings.myDisplayName, settings)) names.add(settings.myDisplayName.trim());
    }
  }
  const rows = [...names].sort((a, b) => a.localeCompare(b)).map((name) => {
    const perSprint = closedBySprint.map(({ sprint, entered, closed }) => {
      const mineEntered = entered.filter((m) => isAttributedTo(m, name, settings));
      const mineClosed = closed.filter((m) => isAttributedTo(m, name, settings));
      return {
        label: `S${sprint.number}`,
        entered: mineEntered.length,
        closed: mineClosed.length,
        cycle: average(mineClosed.map((m) => personCycleDays(m, name, settings))),
        own: average(mineClosed.map((m) => personCycleDays(m, name, settings) - externalWaitDays(m, name, settings))),
        externalSum: mineClosed.reduce((s, m) => s + externalWaitDays(m, name, settings), 0),
        cycleSum: mineClosed.reduce((s, m) => s + personCycleDays(m, name, settings), 0),
        conversion: mineEntered.length === 0 ? null : (mineClosed.length / mineEntered.length) * 100,
      };
    });
    const totalClosed = perSprint.reduce((s, p) => s + p.closed, 0);
    const cycleSum = perSprint.reduce((s, p) => s + p.cycleSum, 0);
    const externalSum = perSprint.reduce((s, p) => s + p.externalSum, 0);
    return {
      name,
      totalClosed,
      externalPct: cycleSum > 0 ? (externalSum / cycleSum) * 100 : null,
      own: cycleTrend(perSprint.map((p) => ({ label: p.label, value: p.own }))),
      cycle: cycleTrend(perSprint.map((p) => ({ label: p.label, value: p.cycle }))),
      volume: volumeTrend(perSprint.map((p) => p.closed)),
      conversion: conversionTrend(perSprint.map((p) => ({ label: p.label, value: p.conversion }))),
    };
  }).filter((r) => r.totalClosed > 0);

  if (rows.length === 0) {
    return (
      <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
        <span style={{ color: '#64748B' }}>Sem dados ainda.</span>
      </div>
    );
  }

  const cell = (t: TrendInfo | null) =>
    t == null ? (
      <span style={{ color: '#94A3B8' }}>—</span>
    ) : (
      <div title={t.detail}>
        <span style={{ fontWeight: 700, color: t.color }}>
          {t.arrow} {t.title}
        </span>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>{t.detail}</div>
      </div>
    );

  return (
    <TableCard isEmpty={false} emptyMessage="">
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>Responsável</Th>
            <Th>Concluídos no período</Th>
            <Th>Cycle Time</Th>
            <Th>Sem espera de usuário/fornecedor</Th>
            <Th>Volume</Th>
            <Th>Conversão</Th>
            <Th>Leitura</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const reading = readingFor(r.cycle, r.own, r.volume, r.conversion);
            return (
              <tr key={r.name}>
                <Td>
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                </Td>
                <Td>{r.totalClosed}</Td>
                <td style={{ padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, verticalAlign: 'top' }}>
                  {cell(r.cycle)}
                  {r.externalPct != null && (
                    <div style={{ fontSize: 11, color: '#2563EB', marginTop: 2 }}>{r.externalPct.toFixed(0)}% do tempo foi espera de usuário/fornecedor</div>
                  )}
                </td>
                <td style={{ padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, verticalAlign: 'top' }}>{cell(r.own)}</td>
                <td style={{ padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, verticalAlign: 'top' }}>{cell(r.volume)}</td>
                <td style={{ padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, verticalAlign: 'top' }}>{cell(r.conversion)}</td>
                <td style={{ padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, verticalAlign: 'top', fontWeight: 600, color: reading.color }}>{reading.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}

const CONVERSION_STABLE_PP = 10;

/** Same idea as cycleTrend, for the conversion % series (higher is better):
 * first half vs second half of the sprints that had items entering, judged in
 * percentage points. */
function conversionTrend(points: { label: string; value: number | null }[]): TrendInfo | null {
  const withData = points.filter((p): p is { label: string; value: number } => p.value != null);
  if (withData.length < 3) return null;
  const half = Math.floor(withData.length / 2);
  const first = withData.slice(0, half).reduce((s, p) => s + p.value, 0) / half;
  const second = withData.slice(withData.length - half).reduce((s, p) => s + p.value, 0) / half;
  const diff = second - first;
  const last = withData[withData.length - 1];
  const prev = withData[withData.length - 2];
  const detail = `Média de ${first.toFixed(0)}% no início para ${second.toFixed(0)}% agora (${diff > 0 ? '+' : ''}${diff.toFixed(0)} p.p.). ${prev.label} → ${last.label}: ${prev.value.toFixed(0)}% → ${last.value.toFixed(0)}%.`;
  if (diff >= CONVERSION_STABLE_PP) return { dir: 'up', arrow: '↑', title: 'Subindo (melhorando)', color: '#16A34A', detail };
  if (diff <= -CONVERSION_STABLE_PP) return { dir: 'down', arrow: '↓', title: 'Caindo (piorando)', color: BrandColors.danger, detail };
  return { dir: 'stable', arrow: '→', title: 'Estável', color: '#64748B', detail };
}

/** One card per responsible with at least one item closed somewhere in the
 * range — a single line (the sum of whichever groups are checked in the
 * shared chip row above the grid) per sprint, with a hover tooltip that
 * breaks that total back down per group ("raio-x"), instead of one line per
 * group cluttering the chart. */
function ResponsibleCycleTimeCards({ closedBySprint, settings }: { closedBySprint: SprintClosed[]; settings: AppSettings }) {
  const [drilldown, setDrilldown] = useState<{ name: string; label: string; metrics: ItemMetric[] } | null>(null);

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

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {sortedNames.map((name) => {
          const mine = closedBySprint.map(({ sprint, closed }) => ({
            sprint,
            closed: closed.filter((m) => isAttributedTo(m, name, settings)),
          }));
          const data = mine.map(({ sprint, closed }) => ({
            label: `S${sprint.number}`,
            total: average(closed.map((m) => personCycleDays(m, name, settings))),
            count: closed.length,
          }));
          const totalClosed = mine.reduce((s, m) => s + m.closed.length, 0);
          const closedByLabel = new Map(mine.map(({ sprint, closed }) => [`S${sprint.number}`, closed]));

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
                {totalClosed === 0 ? (
                  <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 12 }}>Sem itens concluídos nesse período.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data}
                      style={{ cursor: 'pointer' }}
                      onClick={(state) => {
                        const label = typeof state?.activeLabel === 'string' ? state.activeLabel : undefined;
                        if (!label) return;
                        const metrics = closedByLabel.get(label);
                        if (!metrics || metrics.length === 0) return;
                        setDrilldown({ name, label, metrics });
                      }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip formatter={(v) => `${Number(v).toFixed(1)}d`} />
                      <Line type="linear" dataKey="total" name="Cycle Time" stroke={BrandColors.developer} strokeWidth={2.5} dot connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
              {(() => {
                const trend = cycleTrend(data.map((d) => ({ label: d.label, value: d.total })));
                if (trend == null) return null;
                return (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#475569', display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 700, color: trend.color, whiteSpace: 'nowrap' }}>
                      {trend.arrow} {trend.title}
                    </span>
                    <span>{trend.detail}</span>
                  </div>
                );
              })()}
              {totalClosed > 0 && (
                <div style={{ fontSize: 11, color: '#B0B9C6', textAlign: 'center', marginTop: 2 }}>Clique num ponto pra ver os itens por trás do número</div>
              )}
            </div>
          );
        })}
      </div>
      {drilldown && (
        <CycleTimeDrilldownDialog
          name={drilldown.name}
          settings={settings}
          label={drilldown.label}
          metrics={drilldown.metrics}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  );
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
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

/** Opens when a point on a ResponsibleCycleTimeCards line is clicked — the
 * exact items behind that sprint's total, one column per selected group and
 * a Total column, sorted worst-first so an outlier that dragged the average
 * up (small-N sprints are very sensitive to this) jumps out immediately. */
function CycleTimeDrilldownDialog({
  name,
  settings,
  label,
  metrics,
  onClose,
}: {
  name: string;
  settings: AppSettings;
  label: string;
  metrics: ItemMetric[];
  onClose: () => void;
}) {
  const rows = [...metrics].map((m) => ({ m, total: personCycleDays(m, name, settings) })).sort((a, b) => b.total - a.total);
  const totalDays = rows.reduce((s, r) => s + r.total, 0);
  const avgDays = rows.length === 0 ? 0 : totalDays / rows.length;

  return (
    <Modal title={`${name} — ${label}`} width={760} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 10 }}>
        {rows.length} {rows.length === 1 ? 'item concluído' : 'itens concluídos'} — Cycle Time médio de {avgDays.toFixed(1)}d.
      </div>
      <table style={tableStyle()}>
        <thead>
          <tr>
            <Th>ID</Th>
            <Th>Título</Th>
            <Th>Criado em</Th>
            <Th>Cycle Time</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ m, total }) => (
            <tr key={m.item.id}>
              <Td>{m.item.id}</Td>
              <Td>
                <span style={{ display: 'inline-block', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.item.title}</span>
              </Td>
              <Td>{formatDate(m.item.createdDate)}</Td>
              <Td>
                <span style={{ fontWeight: 700 }}>{total.toFixed(1)}d</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
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
            <Th>Cycle Time do time</Th>
            <Th>Atrasados</Th>
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
                <TrendCell value={snap.cycleDaysAvg} previous={i > 0 ? rows[i - 1][1].cycleDaysAvg : null} format={(v) => `${v.toFixed(1)}d`} lowerIsBetter />
              </Td>
              <Td>
                <span title={`${snap.overdueDone} concluídos com atraso + ${snap.overdueOpen} ainda abertos`}>
                  <TrendCell value={snap.overdueTotal} previous={i > 0 ? rows[i - 1][1].overdueTotal : null} format={(v) => `${v}`} lowerIsBetter />
                </span>
                <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 6 }}>
                  ({snap.overdueDone} conc. / {snap.overdueOpen} abertos)
                </span>
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
