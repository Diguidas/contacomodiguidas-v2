import { useEffect, useState } from 'react';
import { Eye, EyeOff, Save } from 'lucide-react';
import { AppSettings } from '../services/settingsService';
import { BrandColors } from '../theme';

/** "Conexão" page — everything needed to reach the Azure Boards API and
 * decide which items belong to you. Column/grouping rules live in
 * GroupingScreen instead. */
export function SettingsScreen({
  initialSettings,
  onSaved,
}: {
  initialSettings: AppSettings;
  onSaved: (settings: AppSettings) => void;
}) {
  const [organization, setOrganization] = useState(initialSettings.organization);
  const [project, setProject] = useState(initialSettings.project);
  const [personalAccessToken, setPersonalAccessToken] = useState(
    initialSettings.personalAccessToken,
  );
  const [myDisplayName, setMyDisplayName] = useState(initialSettings.myDisplayName);
  const [tagFilter, setTagFilter] = useState(initialSettings.tagFilter);
  const [obscurePat, setObscurePat] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedMessage, setSavedMessage] = useState(false);

  useEffect(() => {
    setOrganization(initialSettings.organization);
    setProject(initialSettings.project);
    setPersonalAccessToken(initialSettings.personalAccessToken);
    setMyDisplayName(initialSettings.myDisplayName);
    setTagFilter(initialSettings.tagFilter);
  }, [initialSettings]);

  useEffect(() => {
    if (!savedMessage) return;
    const t = setTimeout(() => setSavedMessage(false), 3000);
    return () => clearTimeout(t);
  }, [savedMessage]);

  function required(value: string): string | undefined {
    return value.trim() === '' ? 'Obrigatório' : undefined;
  }

  function save() {
    const nextErrors: Record<string, string> = {};
    const check = (key: string, value: string) => {
      const err = required(value);
      if (err) nextErrors[key] = err;
    };
    check('organization', organization);
    check('project', project);
    check('personalAccessToken', personalAccessToken);
    check('myDisplayName', myDisplayName);
    check('tagFilter', tagFilter);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    onSaved(
      initialSettings.copyWith({
        organization: organization.trim(),
        project: project.trim(),
        personalAccessToken: personalAccessToken.trim(),
        myDisplayName: myDisplayName.trim(),
        tagFilter: tagFilter.trim(),
      }),
    );
    setSavedMessage(true);
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 640, width: '100%', padding: 24 }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <SectionTitle text="Conexão com o Azure Boards" />
          <Field
            label="Organização"
            placeholder="ex: ti-pole"
            value={organization}
            onChange={setOrganization}
            error={errors.organization}
          />
          <Field
            label="Projeto"
            placeholder="ex: TI Pole"
            value={project}
            onChange={setProject}
            error={errors.project}
          />
          <Field
            label="Personal Access Token (PAT)"
            value={personalAccessToken}
            onChange={setPersonalAccessToken}
            error={errors.personalAccessToken}
            type={obscurePat ? 'password' : 'text'}
            suffix={
              <button
                type="button"
                onClick={() => setObscurePat((v) => !v)}
                aria-label={obscurePat ? 'Mostrar token' : 'Ocultar token'}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#64748B',
                  display: 'flex',
                  padding: 4,
                }}
              >
                {obscurePat ? <Eye size={16} strokeWidth={1.75} /> : <EyeOff size={16} strokeWidth={1.75} />}
              </button>
            }
          />
          <p style={{ margin: '-6px 0 0', fontSize: 12, color: '#64748B' }}>
            O token fica salvo de forma centralizada (todo mundo com acesso ao app usa o mesmo). Crie um PAT com escopo
            de leitura em "Work Items" no Azure DevOps.
          </p>

          <div style={{ height: 12 }} />
          <SectionTitle text="Dono da tag de mesclagem" />
          <p style={{ margin: '0 0 4px', fontSize: 12, color: '#64748B' }}>
            Não é "quem está logado" — é a pessoa cuja regra "meus itens + marcados com a tag" (usada no Dashboard, Ranking de
            performance, Health Score, Cycle Time por responsável e WIP) está configurada pra todo o app.
          </p>
          <Field
            label="Nome de exibição no Azure DevOps"
            placeholder="Guilherme Silva Franklin"
            value={myDisplayName}
            onChange={setMyDisplayName}
            error={errors.myDisplayName}
          />
          <Field
            label="Tag usada para marcar itens dela(e)"
            placeholder="Guilherme"
            value={tagFilter}
            onChange={setTagFilter}
            error={errors.tagFilter}
          />
          <p style={{ margin: '-6px 0 0', fontSize: 12, color: '#64748B' }}>
            O app busca itens atribuídos a essa pessoa (independente de tag) e itens com essa tag atribuídos a outra pessoa — a
            regra decide sozinha quando cada um conta (concluído, ou em aberto e parado em Desenvolvedor).
          </p>

          <div style={{ height: 12, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            {savedMessage && (
              <span style={{ alignSelf: 'center', fontSize: 13, color: BrandColors.developer }}>
                Conexão salva.
              </span>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: BrandColors.primary,
                color: '#FFFFFF',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Save size={16} strokeWidth={2} /> Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SectionTitle({ text }: { text: string }) {
  return (
    <h2
      style={{
        margin: 0,
        fontSize: 17,
        fontWeight: 700,
        color: BrandColors.developer,
      }}
    >
      {text}
    </h2>
  );
}

function Field({
  label,
  placeholder,
  value,
  onChange,
  error,
  type = 'text',
  suffix,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: string;
  suffix?: React.ReactNode;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#334155' }}>{label}</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: `1px solid ${error ? BrandColors.danger : BrandColors.border}`,
          borderRadius: 8,
          backgroundColor: '#FFFFFF',
        }}
      >
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            padding: '10px 12px',
            fontSize: 14,
            borderRadius: 8,
            backgroundColor: 'transparent',
          }}
        />
        {suffix}
      </div>
      {error && <span style={{ fontSize: 11.5, color: BrandColors.danger }}>{error}</span>}
    </label>
  );
}
