import { useState, type ReactNode } from 'react';
import { Link2, FolderClock, ShieldCheck } from 'lucide-react';
import { WorkItem } from '../models/workItem';
import { AppSettings } from '../services/settingsService';
import { BrandColors } from '../theme';
import { SettingsScreen } from './SettingsScreen';
import { GroupingScreen } from './GroupingScreen';
import { AdminScreen } from './AdminScreen';

type SettingsTab = 'connection' | 'grouping' | 'admin';

/** "Configurações": Conexão, Agrupamento and Administração used to be three
 * separate sidebar items — merged into one screen with internal tabs since
 * none of them is something you check day to day, they're setup/maintenance
 * screens someone opens rarely, and having three slots for that crowded the
 * main nav next to the screens people actually live in daily. Each tab is
 * still the same component it always was, untouched — this is just the
 * shell around them. */
export function ConfiguracoesScreen({
  settings,
  items,
  onSaved,
}: {
  settings: AppSettings;
  items: WorkItem[];
  onSaved: (s: AppSettings) => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('connection');

  const tabs: { key: SettingsTab; icon: ReactNode; label: string }[] = [
    { key: 'connection', icon: <Link2 size={15} strokeWidth={2} />, label: 'Conexão' },
    { key: 'grouping', icon: <FolderClock size={15} strokeWidth={2} />, label: 'Agrupamento' },
    { key: 'admin', icon: <ShieldCheck size={15} strokeWidth={2} />, label: 'Administração' },
  ];

  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 900, width: '100%' }}>
        <div style={{ fontSize: 22, fontWeight: 'bold' }}>Configurações</div>
        <div style={{ height: 12 }} />
        <div style={{ display: 'flex', gap: 2, padding: 4, backgroundColor: BrandColors.tableHeader, borderRadius: 10 }}>
          {tabs.map((t) => {
            const selected = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  height: 40,
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  backgroundColor: selected ? '#fff' : 'transparent',
                  boxShadow: selected ? '0 2px 12px rgba(15,23,42,0.04)' : 'none',
                  color: selected ? BrandColors.primaryDark : '#64748B',
                  fontWeight: selected ? 'bold' : 'normal',
                  fontSize: 13,
                }}
              >
                <span style={{ display: 'flex' }}>{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
        <div style={{ height: 20 }} />
        {tab === 'connection' && <SettingsScreen initialSettings={settings} onSaved={onSaved} />}
        {tab === 'grouping' && <GroupingScreen settings={settings} items={items} onSaved={onSaved} />}
        {tab === 'admin' && <AdminScreen />}
      </div>
    </div>
  );
}
