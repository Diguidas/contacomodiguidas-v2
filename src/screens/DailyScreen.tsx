import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  PlusCircle,
  Sunrise,
  Truck,
  UserRound,
  Zap,
} from 'lucide-react';
import { boardColumnMatches, WorkItem } from '../models/workItem';
import { AppSettings } from '../services/settingsService';
import { BrandColors } from '../theme';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function sameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** The last working day before `from` — skips back over Saturday/Sunday, so
 * a Monday daily looks at Friday instead of the (empty) weekend. */
function previousBusinessDay(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

/** First moment this item entered any doneState or the doneColumn, ever —
 * used here just to say "did it close, and when", not to compute cycle
 * time, so it isn't anchored to a start date like MetricsCalculator's is. */
function closedDate(item: WorkItem, doneStates: Set<string>, doneColumn: string): Date | null {
  return item.firstDoneAfter(doneStates, null) ?? item.firstColumnAfter(new Set([doneColumn]), null);
}

function daysInCurrentColumn(item: WorkItem): number {
  const history = item.boardColumnHistory;
  const since = history.length > 0 ? history[history.length - 1].date : item.changedDate;
  return (Date.now() - since.getTime()) / MS_PER_DAY;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

type Bucket = { key: string; label: string; icon: ReactNode; color: string; columns: Set<string> };

/** How many days out a still-open deadline starts showing up as a warning —
 * an already-passed deadline (negative days left) always shows regardless. */
const DEADLINE_WARNING_DAYS = 5;

function daysUntil(target: Date): number {
  return (target.getTime() - Date.now()) / MS_PER_DAY;
}

export function DailyScreen({ settings, items: rawItems, loading, error }: { settings: AppSettings; items: WorkItem[]; loading: boolean; error: string | null }) {
  const [selectedName, setSelectedName] = useState<string>('');

  // Removed / abandoned items (see WorkItem.isCancelled) never got delivered
  // and are excluded everywhere else in the app — without this they'd sit
  // in "Em aberto" forever, since isDone() has no idea they're cancelled.
  const items = useMemo(() => rawItems.filter((i) => !i.isCancelled), [rawItems]);

  // Every other screen in the app scopes its "cards" view to User Story —
  // Features are a coarser-grained container tracked separately
  // (ProjectsScreen), never a piece of work someone actually does day to
  // day. Without this, a Feature directly assigned/tagged to the
  // responsible would show up as a stray "card" (often in a column that
  // isn't even mapped in Agrupamento, since that mapping is for the User
  // Story workflow) instead of as the project header it actually is.
  const cardItems = useMemo(() => items.filter((i) => i.type.trim().toLowerCase() === 'user story'), [items]);

  const responsibleNames = useMemo(() => {
    const names = new Set<string>();
    for (const item of cardItems) {
      const name = item.assignedTo.trim();
      if (name.length > 0) names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [cardItems]);

  const referenceDay = useMemo(() => previousBusinessDay(new Date()), []);

  const doneStates = settings.doneStateSet;
  const doneColumn = settings.doneColumn;

  // For settings.myDisplayName specifically, "his" work also includes items
  // assigned to someone else but tagged with settings.tagFilter — same
  // relationship DashboardScreen tracks, but unlike Dashboard's scoring
  // (which only counts a tagged item once it's done or in Desenvolvimento,
  // so it doesn't inflate his metrics before he actually touched it), the
  // daily is just "what's happening, and where" — so every tagged item
  // shows up here regardless of stage, precisely so the daily can surface
  // one still stuck in Triagem/Fila/Usuário/Fornecedor. For any other
  // responsible it's a plain assignedTo match — the tag models one specific
  // relationship, not a personal tag per person.
  const isTagOwner = selectedName.trim().toLowerCase() === settings.myDisplayName.trim().toLowerCase();
  const taggedIds = useMemo(() => {
    const ids = new Set<number>();
    if (!isTagOwner) return ids;
    const tag = settings.tagFilter.trim().toLowerCase();
    for (const item of cardItems) {
      if (item.assignedTo.trim().toLowerCase() === selectedName.trim().toLowerCase()) continue;
      const hasTag = item.tags.some((t) => t.trim().toLowerCase() === tag);
      if (hasTag) ids.add(item.id);
    }
    return ids;
  }, [cardItems, isTagOwner, selectedName, settings.tagFilter]);

  const mine = useMemo(
    () =>
      cardItems.filter(
        (i) => i.assignedTo.trim().toLowerCase() === selectedName.trim().toLowerCase() || taggedIds.has(i.id),
      ),
    [cardItems, selectedName, taggedIds],
  );

  const closedYesterday = useMemo(() => {
    return mine
      .map((item) => ({ item, closed: closedDate(item, doneStates, doneColumn) }))
      .filter((x): x is { item: WorkItem; closed: Date } => x.closed != null && sameCalendarDay(x.closed, referenceDay));
  }, [mine, doneStates, doneColumn, referenceDay]);

  const createdYesterday = useMemo(
    () => mine.filter((item) => sameCalendarDay(item.createdDate, referenceDay)),
    [mine, referenceDay],
  );

  // Flags a closed-yesterday card that was also *created* the same day —
  // worth calling out in the daily since it went from open to done without
  // spending a single full day anywhere, whatever the reason (genuinely
  // trivial, or someone closing it without doing the tracked work).
  const suspiciousReasons = useMemo(() => {
    const reasons = new Map<number, string>();
    for (const { item, closed } of closedYesterday) {
      if (sameCalendarDay(item.createdDate, closed)) reasons.set(item.id, 'criado e encerrado no mesmo dia');
    }
    return reasons;
  }, [closedYesterday]);

  const notDone = useMemo(() => mine.filter((item) => !item.isDone(doneStates, doneColumn)), [mine, doneStates, doneColumn]);

  const triageItems = useMemo(
    () => notDone.filter((item) => boardColumnMatches(settings.triageColumnSet, item.currentBoardColumn)),
    [notDone, settings],
  );

  // "Em aberto" means picked up already — backlog onward. Triagem is its
  // own alert banner below, not folded into this count: every card lands
  // there automatically, so it shouldn't inflate what reads as "work in
  // hand" before anyone actually triaged it.
  const openItems = useMemo(
    () => notDone.filter((item) => !boardColumnMatches(settings.triageColumnSet, item.currentBoardColumn)),
    [notDone, settings],
  );

  const nearDeadlineItems = useMemo(() => {
    return openItems
      .filter((item) => item.targetDate != null)
      .map((item) => ({ item, daysLeft: daysUntil(item.targetDate as Date) }))
      .filter((x) => x.daysLeft <= DEADLINE_WARNING_DAYS)
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [openItems]);

  const buckets: Bucket[] = [
    { key: 'general', label: 'Backlog / Em andamento', icon: <Inbox size={15} strokeWidth={2} />, color: BrandColors.general, columns: settings.generalColumnSet },
    { key: 'queue', label: 'Fila (liberado p/ dev.)', icon: <Clock size={15} strokeWidth={2} />, color: BrandColors.queue, columns: settings.queueColumnSet },
    { key: 'developer', label: 'Em desenvolvimento', icon: <Zap size={15} strokeWidth={2} />, color: BrandColors.developer, columns: settings.developerColumnSet },
    { key: 'user', label: 'Aguardando usuário', icon: <UserRound size={15} strokeWidth={2} />, color: BrandColors.user, columns: settings.userColumnSet },
    { key: 'vendor', label: 'Aguardando fornecedor', icon: <Truck size={15} strokeWidth={2} />, color: BrandColors.vendor, columns: settings.vendorColumnSet },
  ];

  const itemsByBucket = buckets.map((bucket) => ({
    bucket,
    items: openItems.filter((item) => boardColumnMatches(bucket.columns, item.currentBoardColumn)),
  }));

  // Cards whose current board column isn't mapped into any bucket above nor
  // into Triagem — an unconfigured column in Agrupamento (or a board column
  // renamed since it was set up) would otherwise silently vanish from the
  // per-column view while still counting in "Em aberto".
  const unmappedItems = openItems.filter(
    (item) =>
      !boardColumnMatches(settings.triageColumnSet, item.currentBoardColumn) &&
      !itemsByBucket.some((b) => boardColumnMatches(b.bucket.columns, item.currentBoardColumn)),
  );

  // "Projeto" here means the same thing ProjectsScreen tracks: a Feature-type
  // work item. A project shows up here either because one of the
  // responsible's open cards is a child of it (via childIds — Features
  // don't carry the reverse link, so this is rebuilt from their own list),
  // or because the Feature itself is directly assigned/tagged to the
  // responsible — that second case has no child cards to show yet, but the
  // project itself is still "theirs" and shouldn't disappear just because
  // Features are excluded from the regular card flow above.
  const projectGroups = useMemo(() => {
    const features = items.filter((i) => i.type.trim().toLowerCase() === 'feature');
    const featureByChildId = new Map<number, WorkItem>();
    for (const feature of features) {
      for (const childId of feature.childIds) featureByChildId.set(childId, feature);
    }
    const byFeature = new Map<WorkItem, WorkItem[]>();
    for (const item of openItems) {
      const feature = featureByChildId.get(item.id);
      if (feature == null) continue;
      if (!byFeature.has(feature)) byFeature.set(feature, []);
      byFeature.get(feature)!.push(item);
    }
    const name = selectedName.trim().toLowerCase();
    const tag = settings.tagFilter.trim().toLowerCase();
    const directTagFeatures = new Set<WorkItem>();
    for (const feature of features) {
      const assignedDirectly = feature.assignedTo.trim().toLowerCase() === name;
      const taggedDirectly = isTagOwner && !assignedDirectly && feature.tags.some((t) => t.trim().toLowerCase() === tag);
      if (taggedDirectly) directTagFeatures.add(feature);
      if (byFeature.has(feature)) continue;
      if (assignedDirectly || taggedDirectly) byFeature.set(feature, []);
    }
    return [...byFeature.entries()]
      .map(([feature, cards]) => ({ feature, cards, directTag: directTagFeatures.has(feature) }))
      .sort((a, b) => b.cards.length - a.cards.length);
  }, [items, openItems, selectedName, isTagOwner, settings.tagFilter]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Sunrise size={22} strokeWidth={2} color={BrandColors.primary} />
        <h2 style={{ margin: 0, fontSize: 20, color: '#1E293B' }}>Daily</h2>
      </div>
      <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
        Referência: dia útil anterior ({formatDate(referenceDay)}).
      </div>

      <div style={{ height: 16 }} />
      <select
        value={selectedName}
        onChange={(e) => setSelectedName(e.target.value)}
        style={{
          padding: '10px 14px',
          borderRadius: 8,
          border: `1px solid ${BrandColors.border}`,
          backgroundColor: '#fff',
          fontSize: 14,
          minWidth: 260,
        }}
      >
        <option value="">Selecione um responsável...</option>
        {responsibleNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>

      {loading && <div style={{ marginTop: 16, color: '#64748B', fontSize: 13 }}>Carregando itens...</div>}
      {error && <div style={{ marginTop: 16, color: BrandColors.danger, fontSize: 13 }}>{error}</div>}

      {selectedName === '' && !loading && (
        <div style={{ marginTop: 24, color: '#94A3B8', fontSize: 13 }}>Escolha um responsável para ver os dados dele.</div>
      )}

      {selectedName !== '' && (
        <>
          <div style={{ height: 24 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <StatCard icon={<CheckCircle2 size={16} strokeWidth={2} />} color={BrandColors.user} label="Encerrados (dia anterior)" value={closedYesterday.length} />
            <StatCard icon={<PlusCircle size={16} strokeWidth={2} />} color={BrandColors.developer} label="Criados (dia anterior)" value={createdYesterday.length} />
            <StatCard icon={<Zap size={16} strokeWidth={2} />} color={BrandColors.primary} label="Em aberto" value={openItems.length} />
            <StatCard
              icon={<Truck size={16} strokeWidth={2} />}
              color={BrandColors.vendor}
              label="Esperando terceiros"
              value={itemsByBucket.find((b) => b.bucket.key === 'user')!.items.length + itemsByBucket.find((b) => b.bucket.key === 'vendor')!.items.length}
            />
            <StatCard icon={<CalendarClock size={16} strokeWidth={2} />} color={BrandColors.danger} label="Prazo acabando/vencido" value={nearDeadlineItems.length} />
          </div>

          {triageItems.length > 0 && (
            <>
              <div style={{ height: 16 }} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '12px 16px',
                  borderRadius: 10,
                  backgroundColor: BrandColors.warningBg,
                  border: `1px solid ${BrandColors.warning}`,
                  color: '#92400E',
                  fontSize: 13,
                }}
              >
                <AlertTriangle size={16} strokeWidth={2} color={BrandColors.warning} />
                {triageItems.length} {triageItems.length === 1 ? 'card ainda esperando' : 'cards ainda esperando'} Triagem.
              </div>
            </>
          )}

          {nearDeadlineItems.length > 0 && (
            <>
              <div style={{ height: 28 }} />
              <SectionTitle icon={<CalendarClock size={17} strokeWidth={1.75} />} color={BrandColors.danger} title="Prazos acabando ou vencidos" />
              <div style={{ height: 12 }} />
              <div style={cardStyle()}>
                {nearDeadlineItems.map(({ item, daysLeft }, idx) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderTop: idx === 0 ? 'none' : `1px solid ${BrandColors.border}`,
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: '#94A3B8', width: 60, flexShrink: 0 }}>#{item.id}</span>
                    <span style={{ flex: 1, fontSize: 13, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </span>
                    {taggedIds.has(item.id) && <TagBadge label={`tag: ${item.assignedTo.trim()}`} />}
                    <span style={{ fontSize: 11.5, color: '#64748B', flexShrink: 0 }}>{formatDate(item.targetDate as Date)}</span>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: daysLeft < 0 ? BrandColors.danger : BrandColors.warning,
                        width: 90,
                        textAlign: 'right',
                        flexShrink: 0,
                      }}
                    >
                      {daysLeft < 0 ? `atrasado ${Math.abs(daysLeft).toFixed(0)}d` : `vence em ${daysLeft.toFixed(0)}d`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ height: 28 }} />
          <SectionTitle icon={<CheckCircle2 size={17} strokeWidth={1.75} />} color={BrandColors.user} title="Encerrados no dia útil anterior" />
          <ItemList
            items={closedYesterday.map((x) => x.item)}
            emptyMessage="Nenhum card encerrado nesse dia."
            taggedIds={taggedIds}
            suspiciousReasons={suspiciousReasons}
          />

          <div style={{ height: 28 }} />
          <SectionTitle icon={<PlusCircle size={17} strokeWidth={1.75} />} color={BrandColors.developer} title="Criados no dia útil anterior" />
          <ItemList items={createdYesterday} emptyMessage="Nenhum card criado nesse dia." taggedIds={taggedIds} />

          <div style={{ height: 28 }} />
          <SectionTitle icon={<Zap size={17} strokeWidth={1.75} />} color={BrandColors.primary} title="Cards em andamento, por coluna" />
          <div style={{ height: 12 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {itemsByBucket.map(({ bucket, items: bucketItems }) => (
              <div key={bucket.key} style={cardStyle()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ color: bucket.color, display: 'flex' }}>{bucket.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1E293B' }}>{bucket.label}</span>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>({bucketItems.length})</span>
                </div>
                <ItemList items={bucketItems} emptyMessage="Nada aqui." showColumnAge taggedIds={taggedIds} />
              </div>
            ))}
            {unmappedItems.length > 0 && (
              <div style={cardStyle()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ color: BrandColors.danger, display: 'flex' }}>
                    <AlertTriangle size={15} strokeWidth={2} />
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1E293B' }}>Outras colunas (sem grupo no Agrupamento)</span>
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>({unmappedItems.length})</span>
                </div>
                <ItemList items={unmappedItems} emptyMessage="Nada aqui." showColumnAge taggedIds={taggedIds} />
              </div>
            )}
          </div>

          <div style={{ height: 28 }} />
          <SectionTitle icon={<Briefcase size={17} strokeWidth={1.75} />} color={BrandColors.primary} title="Projetos em que está atuando" />
          <div style={{ height: 12 }} />
          {projectGroups.length === 0 && (
            <div style={{ ...cardStyle(), color: '#94A3B8', fontSize: 12.5 }}>Nenhum card vinculado a um projeto.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {projectGroups.map(({ feature, cards, directTag }) => (
              <div key={feature.id} style={cardStyle()}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ color: BrandColors.primary, display: 'flex' }}>
                    <Briefcase size={15} strokeWidth={2} />
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 13.5, color: '#1E293B' }}>{feature.title}</span>
                  {directTag && <TagBadge label={`tag: ${feature.assignedTo.trim()}`} />}
                  <span style={{ fontSize: 12, color: '#94A3B8' }}>
                    #{feature.id} · {feature.currentBoardColumn} · {cards.length} {cards.length === 1 ? 'card dele' : 'cards dele'}
                  </span>
                </div>
                <ItemList
                  items={cards}
                  emptyMessage={directTag ? 'Marcado no projeto direto, sem card individual ainda.' : 'Nada aqui.'}
                  showColumnAge
                  taggedIds={taggedIds}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ icon, color, label, value }: { icon: ReactNode; color: string; label: string; value: number }) {
  return (
    <div style={{ ...cardStyle(), flex: '1 1 220px', minWidth: 200, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: `${color}1A`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1E293B', lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 11.5, color: '#64748B' }}>{label}</div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, color, title }: { icon: ReactNode; color: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ color, display: 'flex' }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 14.5, color: '#1E293B' }}>{title}</span>
    </div>
  );
}

function TagBadge({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: BrandColors.primaryDark,
        backgroundColor: BrandColors.primaryLightBg,
        borderRadius: 5,
        padding: '2px 6px',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

function SuspiciousBadge({ reason }: { reason: string | null }) {
  const suspicious = reason != null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color: suspicious ? '#92400E' : '#166534',
        backgroundColor: suspicious ? BrandColors.warningBg : '#F0FDF4',
        border: `1px solid ${suspicious ? BrandColors.warning : '#BBF7D0'}`,
        borderRadius: 5,
        padding: '2px 6px',
        flexShrink: 0,
      }}
      title={reason ?? 'Criado e encerrado em dias diferentes.'}
    >
      {suspicious ? 'mesmo dia' : 'ok'}
    </span>
  );
}

function ItemList({
  items,
  emptyMessage,
  showColumnAge,
  taggedIds,
  suspiciousReasons,
}: {
  items: WorkItem[];
  emptyMessage: string;
  showColumnAge?: boolean;
  taggedIds?: Set<number>;
  suspiciousReasons?: Map<number, string>;
}) {
  if (items.length === 0) {
    return <div style={{ ...cardStyle(), color: '#94A3B8', fontSize: 12.5 }}>{emptyMessage}</div>;
  }
  return (
    <div style={cardStyle()}>
      {items.map((item, idx) => (
        <div
          key={item.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 0',
            borderTop: idx === 0 ? 'none' : `1px solid ${BrandColors.border}`,
          }}
        >
          <span style={{ fontSize: 11.5, color: '#94A3B8', width: 60, flexShrink: 0 }}>#{item.id}</span>
          <span style={{ flex: 1, fontSize: 13, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title}
          </span>
          {taggedIds?.has(item.id) && <TagBadge label={`tag: ${item.assignedTo.trim()}`} />}
          {suspiciousReasons != null && <SuspiciousBadge reason={suspiciousReasons.get(item.id) ?? null} />}
          <span style={{ fontSize: 11.5, color: '#64748B', flexShrink: 0 }}>{item.currentBoardColumn}</span>
          {showColumnAge && (
            <span style={{ fontSize: 11.5, color: '#94A3B8', width: 50, textAlign: 'right', flexShrink: 0 }}>
              {daysInCurrentColumn(item).toFixed(0)}d
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function cardStyle(): React.CSSProperties {
  return {
    backgroundColor: BrandColors.cardBg,
    border: `1px solid ${BrandColors.border}`,
    borderRadius: 12,
    padding: 14,
  };
}
