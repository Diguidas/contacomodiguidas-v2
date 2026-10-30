import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, CircleCheck } from 'lucide-react';
import { boardColumnMatches, WorkItem } from '../models/workItem';
import { formatDuration, ItemMetric, MetricsCalculator } from '../services/metricsService';
import { AppSettings } from '../services/settingsService';
import { Sprint } from '../services/sprintService';
import { attributedGroupBy, sprintCutoff } from '../services/sprintSnapshotService';
import { BrandColors } from '../theme';

// Every limit that decides whether someone gets flagged lives here, so the
// rules can be read (and argued about) in one place. They are deliberately
// relative to the team — "normal" is whatever the team did in this sprint.
const FAST_MIN_CLOSED = 5; // concluídos mínimos pra julgar "rápido demais"
const FAST_RATIO = 0.3; // mediana dela ≤ 30% da mediana do time
const SLOW_MIN_CLOSED = 3;
const SLOW_RATIO = 1.5; // mediana dela > 1,5× a do time
const LOAD_MIN_OPEN = 4;
const LOAD_RATIO = 2; // WIP ≥ 2× a mediana do time
const STUCK_DAYS = 7; // dias sem mudar de coluna
const SUSPECT_MIN = 2;
const MAX_CARDS_PER_FLAG = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type FlagKind = 'fast' | 'slow' | 'load' | 'stuck' | 'suspect';

interface FlagCard {
  m: ItemMetric;
  note: string;
}

interface Flag {
  kind: FlagKind;
  title: string;
  detail: string;
  cards: FlagCard[];
}

interface PersonAttention {
  name: string;
  closedCount: number;
  openCount: number;
  flags: Flag[];
}

const FLAG_COLORS: Record<FlagKind, string> = {
  fast: BrandColors.danger,
  suspect: BrandColors.danger,
  load: BrandColors.warning,
  stuck: BrandColors.warning,
  slow: BrandColors.warning,
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function endedInSprint(m: ItemMetric, sprint: Sprint | null): boolean {
  if (!m.done) return false;
  if (sprint == null) return true;
  const end = m.endDate;
  if (end == null) return false;
  const rangeEnd = new Date(sprint.end.getTime() + MS_PER_DAY);
  return end.getTime() >= sprint.start.getTime() && end.getTime() <= rangeEnd.getTime();
}

function hasUsableColumn(m: ItemMetric): boolean {
  const c = m.item.currentBoardColumn.trim();
  return c !== '' && c !== '-';
}

/** Days since the card last changed column — the "parado" clock. */
function daysSinceLastMove(m: ItemMetric, now: Date): number {
  const history = m.item.boardColumnHistory;
  const since = history.length > 0 ? history[history.length - 1].date : m.item.createdDate;
  return Math.max(0, now.getTime() - since.getTime()) / MS_PER_DAY;
}

function analyze(items: WorkItem[], settings: AppSettings, sprint: Sprint | null) {
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
  const asOf = sprint == null ? undefined : sprintCutoff(sprint);
  const closed = calculator.calculate(valid, asOf).metrics.filter((m) => endedInSprint(m, sprint));
  // Open work is always the live picture (same rule as WIP on Visão do time):
  // a card open since three sprints ago must show its real age.
  const open = calculator
    .calculate(valid)
    .metrics.filter(
      (m) => !m.done && hasUsableColumn(m) && !boardColumnMatches(settings.triageColumnSet, m.item.currentBoardColumn),
    );

  const closedBy = attributedGroupBy(closed, settings);
  const openBy = attributedGroupBy(open, settings);
  const names = [...new Set([...closedBy.keys(), ...openBy.keys()])];

  const teamMedianCycle = median(closed.map((m) => m.inProgressCycleDays));
  const teamMedianWorked = median(closed.map((m) => m.workedDays));
  const teamMedianClosedCount = median([...closedBy.values()].map((l) => l.length));
  const teamMedianOpenCount = median([...openBy.values()].map((l) => l.length));
  const now = new Date();

  const people: PersonAttention[] = names.map((name) => {
    const done = closedBy.get(name) ?? [];
    const wip = openBy.get(name) ?? [];
    const flags: Flag[] = [];

    // Muito card, saindo rápido demais.
    if (done.length >= FAST_MIN_CLOSED && done.length >= teamMedianClosedCount && teamMedianCycle > 0) {
      const own = median(done.map((m) => m.inProgressCycleDays));
      if (own <= teamMedianCycle * FAST_RATIO) {
        flags.push({
          kind: 'fast',
          title: 'Entrega rápida demais',
          detail:
            `${done.length} concluídos (mediana do time: ${teamMedianClosedCount.toFixed(0)}) com Cycle Time mediano de ` +
            `${formatDuration(own)} (time: ${formatDuration(teamMedianCycle)}). Vale entender se os cards eram mesmo simples ` +
            `ou se estão sendo fechados sem o trabalho acontecer no board.`,
          cards: [...done]
            .sort((a, b) => a.inProgressCycleDays - b.inProgressCycleDays)
            .slice(0, MAX_CARDS_PER_FLAG)
            .map((m) => ({ m, note: formatDuration(m.inProgressCycleDays) })),
        });
      }
    }

    // Itens fechados sem rastro ou em menos de 1h.
    const suspicious = done.filter((m) => m.isSuspicious);
    if (suspicious.length >= SUSPECT_MIN) {
      flags.push({
        kind: 'suspect',
        title: 'Itens suspeitos',
        detail: `${suspicious.length} de ${done.length} concluídos foram fechados em menos de 1h ou quase sem rastro nas colunas.`,
        cards: suspicious.slice(0, MAX_CARDS_PER_FLAG).map((m) => ({
          m,
          note: m.isSuspiciouslyFast ? 'Fechado em menos de 1h' : 'Sem rastro nas colunas',
        })),
      });
    }

    // Cards demais abertos ao mesmo tempo.
    if (wip.length >= LOAD_MIN_OPEN && wip.length >= teamMedianOpenCount * LOAD_RATIO) {
      flags.push({
        kind: 'load',
        title: 'Muitos cards abertos',
        detail: `${wip.length} cards abertos agora (mediana do time: ${teamMedianOpenCount.toFixed(0)}).`,
        cards: [...wip]
          .sort((a, b) => b.totalDays - a.totalDays)
          .slice(0, MAX_CARDS_PER_FLAG)
          .map((m) => ({ m, note: `${formatDuration(m.totalDays)} aberto` })),
      });
    }

    // Cards parados numa coluna que depende dela (esperar usuário/fornecedor
    // não conta contra a pessoa).
    const stuck = wip
      .filter(
        (m) =>
          !boardColumnMatches(settings.userColumnSet, m.item.currentBoardColumn) &&
          !boardColumnMatches(settings.vendorColumnSet, m.item.currentBoardColumn),
      )
      .map((m) => ({ m, idle: daysSinceLastMove(m, now) }))
      .filter((x) => x.idle > STUCK_DAYS)
      .sort((a, b) => b.idle - a.idle);
    if (stuck.length > 0) {
      flags.push({
        kind: 'stuck',
        title: 'Cards parados',
        detail: `${stuck.length} card(s) sem mudar de coluna há mais de ${STUCK_DAYS} dias (esperando usuário ou fornecedor não conta).`,
        cards: stuck.slice(0, MAX_CARDS_PER_FLAG).map((x) => ({
          m: x.m,
          note: `${formatDuration(x.idle)} em ${x.m.item.currentBoardColumn}`,
        })),
      });
    }

    // Lento mesmo descontando o tempo esperando outras pessoas.
    if (done.length >= SLOW_MIN_CLOSED && teamMedianWorked > 0) {
      const own = median(done.map((m) => m.workedDays));
      if (own > teamMedianWorked * SLOW_RATIO) {
        flags.push({
          kind: 'slow',
          title: 'Demora acima do time',
          detail:
            `Tempo trabalhado mediano de ${formatDuration(own)} (time: ${formatDuration(teamMedianWorked)}), ` +
            `já descontando o tempo esperando fila, usuário e fornecedor.`,
          cards: [...done]
            .sort((a, b) => b.workedDays - a.workedDays)
            .slice(0, MAX_CARDS_PER_FLAG)
            .map((m) => ({ m, note: formatDuration(m.workedDays) })),
        });
      }
    }

    return { name, closedCount: done.length, openCount: wip.length, flags };
  });

  return people;
}

export function AttentionScreen({
  settings,
  items,
  loading,
  error,
  selectedSprint,
  sprints,
  onSprintChanged,
}: {
  settings: AppSettings;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  selectedSprint: Sprint | null;
  sprints: Sprint[];
  onSprintChanged: (s: Sprint | null) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Carregando...</span>
      </div>
    );
  }
  if (error != null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <span>Erro: {error}</span>
      </div>
    );
  }

  const people = analyze(items, settings, selectedSprint);
  const flagged = people
    .filter((p) => p.flags.length > 0)
    .sort((a, b) => b.flags.length - a.flags.length || b.closedCount - a.closedCount);
  const clean = people.filter((p) => p.flags.length === 0).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ padding: 16 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{ flex: 1, fontSize: 20, fontWeight: 'bold' }}>Atenção</span>
          <select
            style={{ width: 220, height: 38, padding: '4px 10px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff' }}
            value={selectedSprint?.number ?? ''}
            onChange={(e) => {
              const n = e.target.value;
              onSprintChanged(n === '' ? null : sprints.find((s) => s.number === Number(n)) ?? null);
            }}
          >
            {sprints.map((s) => (
              <option key={s.number} value={s.number}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ height: 6 }} />
        <div style={{ fontSize: 13, color: '#64748B' }}>
          Quem vale uma conversa com o coordenador. Cada alerta mostra o número que o disparou e os cards envolvidos —
          é um ponto de partida pra conversar, não um veredito. Tudo é comparado com o próprio time na sprint selecionada.
        </div>
        <div style={{ height: 16 }} />

        <RulesLegend />
        <div style={{ height: 20 }} />

        {flagged.length === 0 ? (
          <div style={{ ...cardStyle(), display: 'flex', alignItems: 'center', gap: 10, color: '#64748B', fontSize: 14 }}>
            <CircleCheck size={18} strokeWidth={1.75} color={BrandColors.user} />
            Ninguém com alerta nesta sprint.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {flagged.map((p) => (
              <PersonCard key={p.name} person={p} open={expanded.has(p.name)} onToggle={() => toggle(p.name)} />
            ))}
          </div>
        )}

        {clean.length > 0 && (
          <div style={{ marginTop: 20, fontSize: 12, color: '#94A3B8' }}>
            <b>Sem alertas ({clean.length}):</b> {clean.map((p) => p.name).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

function RulesLegend() {
  const rules: { color: string; text: string }[] = [
    {
      color: FLAG_COLORS.fast,
      text: `Entrega rápida demais — ${FAST_MIN_CLOSED}+ concluídos, pelo menos a mediana do time em quantidade, e Cycle Time mediano ≤ ${Math.round(FAST_RATIO * 100)}% do time.`,
    },
    { color: FLAG_COLORS.suspect, text: `Itens suspeitos — ${SUSPECT_MIN}+ concluídos em menos de 1h ou quase sem rastro nas colunas.` },
    { color: FLAG_COLORS.load, text: `Muitos cards abertos — ${LOAD_MIN_OPEN}+ abertos e pelo menos ${LOAD_RATIO}× a mediana do time.` },
    { color: FLAG_COLORS.stuck, text: `Cards parados — sem mudar de coluna há mais de ${STUCK_DAYS} dias (fora Usuário e Fornecedor).` },
    { color: FLAG_COLORS.slow, text: `Demora acima do time — ${SLOW_MIN_CLOSED}+ concluídos e tempo trabalhado mediano > ${SLOW_RATIO}× o do time.` },
  ];
  return (
    <div style={{ ...cardStyle(), padding: '12px 16px' }}>
      <div style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 0.6, color: '#94A3B8', marginBottom: 8 }}>COMO CADA ALERTA É DECIDIDO</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rules.map((r) => (
          <div key={r.text} style={{ display: 'flex', gap: 8, fontSize: 12, color: '#475569' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: r.color, marginTop: 5, flexShrink: 0 }} />
            <span>{r.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PersonCard({ person, open, onToggle }: { person: PersonAttention; open: boolean; onToggle: () => void }) {
  return (
    <div style={{ ...cardStyle(), overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', cursor: 'pointer', flexWrap: 'wrap' }}
      >
        {open ? <ChevronDown size={16} strokeWidth={2} color="#64748B" /> : <ChevronRight size={16} strokeWidth={2} color="#64748B" />}
        <span style={{ fontWeight: 'bold', fontSize: 15 }}>{person.name}</span>
        <span style={{ fontSize: 12, color: '#94A3B8' }}>
          {person.closedCount} concluídos · {person.openCount} abertos
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {person.flags.map((f) => (
            <span
              key={f.kind}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 600,
                color: FLAG_COLORS[f.kind],
                backgroundColor: `${FLAG_COLORS[f.kind]}1A`,
              }}
            >
              <AlertTriangle size={12} strokeWidth={2} />
              {f.title}
            </span>
          ))}
        </div>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${BrandColors.border}`, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {person.flags.map((f) => (
            <div key={f.kind}>
              <div style={{ fontWeight: 600, fontSize: 13, color: FLAG_COLORS[f.kind] }}>{f.title}</div>
              <div style={{ fontSize: 12.5, color: '#475569', margin: '2px 0 8px' }}>{f.detail}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {f.cards.map(({ m, note }) => (
                    <tr key={m.item.id} style={{ borderTop: `1px solid ${BrandColors.border}` }}>
                      <td style={{ padding: '5px 8px 5px 0', color: '#64748B', whiteSpace: 'nowrap' }}>#{m.item.id}</td>
                      <td style={{ padding: '5px 8px', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.item.title}
                      </td>
                      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                        <StatusBadge m={m} />
                      </td>
                      <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Whether the card is already concluded — matters when deciding what to
 * bring to a conversation (a stuck card can still be unblocked, a closed one
 * can only be explained). Open cards show where they are sitting. */
function StatusBadge({ m }: { m: ItemMetric }) {
  const color = m.done ? BrandColors.user : '#64748B';
  const label = m.done ? 'Concluído' : `Em aberto · ${m.item.currentBoardColumn.trim() || '—'}`;
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color,
        backgroundColor: `${color}1A`,
      }}
    >
      {label}
    </span>
  );
}

function cardStyle(): React.CSSProperties {
  return {
    backgroundColor: '#fff',
    borderRadius: 14,
    border: `1px solid ${BrandColors.border}`,
    boxShadow: '0 2px 12px rgba(15,23,42,0.04)',
    padding: 16,
  };
}
