import { useState, type ReactNode } from 'react';
import { boardColumnMatches, WorkItem } from '../models/workItem';
import { AppSettings } from '../services/settingsService';
import type { AppSettingsInit } from '../services/settingsService';
import { BrandColors } from '../theme';
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Laptop,
  Ruler,
  Save,
  Search,
  Truck,
  UserRound,
  LayoutList,
} from 'lucide-react';

interface CategoryDef {
  key: string;
  title: string;
  description: string;
  color: string;
  icon: ReactNode;
  getValue: (s: AppSettings) => string;
  patchKey: keyof AppSettingsInit;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: 'triage',
    title: 'Triagem',
    description: 'Tempo aguardando alguém pegar a demanda.',
    color: BrandColors.triage,
    icon: <Search size={18} strokeWidth={1.75} />,
    getValue: (s) => s.triageColumns,
    patchKey: 'triageColumns',
  },
  {
    key: 'queue',
    title: 'Fila',
    description: 'Liberado, aguardando um desenvolvedor pegar.',
    color: BrandColors.queue,
    icon: <Inbox size={18} strokeWidth={1.75} />,
    getValue: (s) => s.queueColumns,
    patchKey: 'queueColumns',
  },
  {
    key: 'developer',
    title: 'Desenvolvedor',
    description: 'Categoria principal — é o "cycle time" mostrado no dashboard.',
    color: BrandColors.developer,
    icon: <Laptop size={18} strokeWidth={1.75} />,
    getValue: (s) => s.developerColumns,
    patchKey: 'developerColumns',
  },
  {
    key: 'user',
    title: 'Usuário',
    description: 'Tempo aguardando definição/validação do usuário solicitante.',
    color: BrandColors.user,
    icon: <UserRound size={18} strokeWidth={1.75} />,
    getValue: (s) => s.userColumns,
    patchKey: 'userColumns',
  },
  {
    key: 'vendor',
    title: 'Fornecedor',
    description: 'Tempo aguardando um fornecedor externo.',
    color: BrandColors.vendor,
    icon: <Truck size={18} strokeWidth={1.75} />,
    getValue: (s) => s.vendorColumns,
    patchKey: 'vendorColumns',
  },
  {
    key: 'general',
    title: 'Geral',
    description: 'Colunas de fluxo normal — contam para o tempo geral.',
    color: BrandColors.general,
    icon: <LayoutList size={18} strokeWidth={1.75} />,
    getValue: (s) => s.generalColumns,
    patchKey: 'generalColumns',
  },
  {
    key: 'done',
    title: 'Conclusão',
    description: 'Quando o card cai nessa coluna, ele é considerado concluído.',
    color: BrandColors.total,
    icon: <CheckCircle2 size={18} strokeWidth={1.75} />,
    getValue: (s) => s.doneColumn,
    patchKey: 'doneColumn',
  },
];

function columnsFrom(raw: string): Set<string> {
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

/** Lets you see exactly which board columns feed each time category, and
 * which real columns from your board (if any data has been fetched) are
 * still unmapped — then edit and save the mapping. */
export function GroupingScreen({
  settings,
  items,
  onSaved,
}: {
  settings: AppSettings;
  items: WorkItem[];
  onSaved: (s: AppSettings) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of CATEGORIES) init[c.key] = c.getValue(settings);
    return init;
  });
  const [doneStates, setDoneStates] = useState(settings.doneStates);
  const [savedMessage, setSavedMessage] = useState(false);

  const detected = new Set<string>();
  for (const item of items) {
    if (item.currentBoardColumn) detected.add(item.currentBoardColumn);
    for (const change of item.boardColumnHistory) detected.add(change.state);
  }

  function columnsFor(key: string): Set<string> {
    return columnsFrom(values[key] ?? '');
  }

  const allConfiguredColumns = new Set<string>();
  for (const c of CATEGORIES) for (const col of columnsFor(c.key)) allConfiguredColumns.add(col);

  const unmapped = [...detected].filter((c) => !boardColumnMatches(allConfiguredColumns, c)).sort();

  function save() {
    let next = settings;
    for (const c of CATEGORIES) {
      next = next.copyWith({ [c.patchKey]: values[c.key].trim() } as AppSettingsInit);
    }
    next = next.copyWith({ doneStates: doneStates.trim() });
    onSaved(next);
    setSavedMessage(true);
    setTimeout(() => setSavedMessage(false), 3000);
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 900, width: '100%', padding: 24 }}>
        <div style={{ fontSize: 20, fontWeight: 'bold', color: BrandColors.developer }}>Agrupamento</div>
        <div style={{ height: 6 }} />
        <div style={{ fontSize: 12, color: '#64748B' }}>
          Cada categoria abaixo soma o tempo que o card passou nas colunas do quadro Kanban listadas nela. Ajuste e salve para recalcular o
          dashboard.
        </div>
        <div style={{ height: 20 }} />
        {detected.size === 0 ? (
          <div style={{ backgroundColor: BrandColors.warningBg, borderRadius: 12, padding: 16 }}>
            Nenhum dado carregado ainda. Abra o Dashboard e atualize pelo menos uma vez para ver aqui quais colunas o seu quadro realmente usa.
          </div>
        ) : unmapped.length > 0 ? (
          <div style={{ backgroundColor: BrandColors.warningBg, borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: BrandColors.warning, display: 'flex' }}>
                <AlertTriangle size={16} strokeWidth={2} />
              </span>
              <span style={{ fontWeight: 'bold', color: BrandColors.warning, fontSize: 14 }}>Colunas do seu quadro sem categoria</span>
            </div>
            <div style={{ height: 8 }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {unmapped.map((c) => (
                <span
                  key={c}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    backgroundColor: '#fff',
                    border: `1px solid ${hexAlpha(BrandColors.warning, 0.5)}`,
                    fontSize: 12,
                  }}
                >
                  {c}
                </span>
              ))}
            </div>
            <div style={{ height: 6 }} />
            <div style={{ fontSize: 12, color: '#64748B' }}>
              O tempo que os cards passam nessas colunas não entra em nenhuma contagem. Adicione o nome exato numa das categorias abaixo.
            </div>
          </div>
        ) : (
          <div style={{ backgroundColor: BrandColors.primaryLightBg, borderRadius: 12, padding: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: BrandColors.developer, display: 'flex' }}>
              <CheckCircle2 size={16} strokeWidth={2} />
            </span>
            <span>Toda coluna do seu quadro está mapeada em alguma categoria.</span>
          </div>
        )}
        <div style={{ height: 20 }} />
        {CATEGORIES.map((c) => (
          <CategoryCard
            key={c.key}
            category={c}
            value={values[c.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [c.key]: v }))}
            detected={detected}
            columnsFor={columnsFor(c.key)}
          />
        ))}
        <div style={{ height: 8 }} />
        <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: BrandColors.total, display: 'flex' }}>
              <Ruler size={16} strokeWidth={1.75} />
            </span>
            <span style={{ fontWeight: 'bold', fontSize: 15 }}>Estados alternativos de conclusão</span>
          </div>
          <div style={{ height: 4 }} />
          <div style={{ fontSize: 12, color: '#64748B' }}>
            Usado como reforço (System.State), caso o item seja fechado sem passar pela coluna de conclusão.
          </div>
          <div style={{ height: 12 }} />
          <input
            value={doneStates}
            onChange={(e) => setDoneStates(e.target.value)}
            placeholder="Done,Closed,Resolved,Concluído"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, fontSize: 14, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ height: 24 }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
          {savedMessage && <span style={{ fontSize: 13, color: BrandColors.developer }}>Agrupamento salvo.</span>}
          <button
            onClick={save}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              backgroundColor: BrandColors.primary,
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Save size={16} strokeWidth={2} /> Salvar agrupamento
          </button>
        </div>
      </div>
    </div>
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function CategoryCard({
  category,
  value,
  onChange,
  detected,
  columnsFor,
}: {
  category: CategoryDef;
  value: string;
  onChange: (v: string) => void;
  detected: Set<string>;
  columnsFor: Set<string>;
}) {
  return (
    <div style={{ marginBottom: 16, backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            backgroundColor: hexAlpha(category.color, 0.12),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: category.color,
            flexShrink: 0,
          }}
        >
          {category.icon}
        </div>
        <div style={{ width: 12 }} />
        <div>
          <div style={{ fontWeight: 'bold', fontSize: 15 }}>{category.title}</div>
          <div style={{ fontSize: 12, color: '#64748B' }}>{category.description}</div>
        </div>
      </div>
      <div style={{ height: 12 }} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: '#334155' }}>Colunas do quadro (separadas por vírgula)</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ padding: '10px 12px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, fontSize: 14, boxSizing: 'border-box' }}
        />
      </label>
      {detected.size > 0 && (
        <>
          <div style={{ height: 10 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {[...columnsFor].map((configured) => {
              const exists = [...detected].some((d) => d.trim().toLowerCase() === configured.trim().toLowerCase());
              return (
                <span
                  key={configured}
                  title={exists ? undefined : 'Não encontrada nos dados carregados — confira a grafia'}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 999,
                    backgroundColor: exists ? hexAlpha(category.color, 0.12) : 'transparent',
                    border: `1px solid ${exists ? hexAlpha(category.color, 0.5) : hexAlpha(BrandColors.warning, 0.6)}`,
                    fontSize: 12,
                    fontWeight: 600,
                    color: exists ? category.color : BrandColors.warning,
                  }}
                >
                  {configured}
                  {!exists && (
                    <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginLeft: 4 }}>
                      <AlertTriangle size={11} strokeWidth={2} />
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
