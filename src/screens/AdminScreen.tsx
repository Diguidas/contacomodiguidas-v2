import { useEffect, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { createAppUser, deleteAppUser, fetchAllAppUsers, updateAppUser } from '../services/authService';
import type { AppUser } from '../services/authService';
import { BrandColors } from '../theme';

function selectStyle(): React.CSSProperties {
  return { width: '100%', padding: '10px 12px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff', fontSize: 13 };
}

/** Admin-only: who can log into this app, with what role, and — for a
 * "responsável" — which Azure DevOps display name their Dashboard should
 * be locked to. This table (Supabase `app_users`, behind RLS) is the whole
 * access-control list; there's no self-signup. */
export function AdminScreen() {
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'responsavel'>('responsavel');
  const [newResponsavelName, setNewResponsavelName] = useState('');
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      setUsers(await fetchAllAppUsers());
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleAdd() {
    const email = newEmail.trim().toLowerCase();
    if (email === '') return;
    setSaving(true);
    setError(null);
    try {
      await createAppUser({ email, role: newRole, responsavelName: newRole === 'responsavel' ? newResponsavelName.trim() || null : null });
      setNewEmail('');
      setNewResponsavelName('');
      setNewRole('responsavel');
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(user: AppUser, patch: Partial<{ role: 'admin' | 'responsavel'; responsavelName: string | null }>) {
    try {
      await updateAppUser(user.id, {
        role: patch.role ?? user.role,
        responsavelName: patch.responsavelName !== undefined ? patch.responsavelName : user.responsavelName,
      });
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleDelete(user: AppUser) {
    if (!window.confirm(`Remover o acesso de ${user.email}?`)) return;
    try {
      await deleteAppUser(user.id);
      await reload();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ maxWidth: 900, width: '100%' }}>
        <div style={{ fontSize: 22, fontWeight: 'bold' }}>Administração</div>
        <div style={{ height: 4 }} />
        <div style={{ color: '#64748B' }}>
          Quem pode entrar no app, com que papel, e — pra um "responsável" — qual nome do Azure DevOps trava o Dashboard dela(e). Sem
          cadastro nesta tabela, o login com Microsoft funciona mas o app recusa o acesso.
        </div>
        <div style={{ height: 24 }} />

        {error != null && <div style={{ marginBottom: 16, color: BrandColors.danger }}>Erro: {error}</div>}

        <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Adicionar acesso</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 240 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#334155' }}>E-mail (Microsoft)</span>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="nome@pole.com.br"
                style={selectStyle()}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 160 }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#334155' }}>Papel</span>
              <select value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'responsavel')} style={selectStyle()}>
                <option value="responsavel">Responsável</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            {newRole === 'responsavel' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 240 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: '#334155' }}>Nome no Azure DevOps</span>
                <input
                  type="text"
                  value={newResponsavelName}
                  onChange={(e) => setNewResponsavelName(e.target.value)}
                  placeholder="Nome Completo"
                  style={selectStyle()}
                />
              </label>
            )}
            <button
              onClick={handleAdd}
              disabled={saving || newEmail.trim() === ''}
              style={{
                height: 38,
                padding: '0 16px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: BrandColors.primary,
                color: '#fff',
                fontWeight: 600,
                fontSize: 13,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <UserPlus size={15} strokeWidth={2} /> Adicionar
            </button>
          </div>
        </div>

        <div style={{ height: 20 }} />

        {users == null ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748B' }}>Carregando...</div>
        ) : users.length === 0 ? (
          <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, padding: 16 }}>
            <span style={{ color: '#64748B' }}>Ninguém cadastrado ainda.</span>
          </div>
        ) : (
          <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th>E-mail</Th>
                    <Th>Papel</Th>
                    <Th>Nome no Azure DevOps</Th>
                    <Th></Th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <Td>{u.email}</Td>
                      <Td>
                        <select value={u.role} onChange={(e) => handleUpdate(u, { role: e.target.value as 'admin' | 'responsavel' })} style={{ ...selectStyle(), width: 150 }}>
                          <option value="responsavel">Responsável</option>
                          <option value="admin">Admin</option>
                        </select>
                      </Td>
                      <Td>
                        {u.role === 'admin' ? (
                          <span style={{ color: '#94A3B8' }}>—</span>
                        ) : (
                          <input
                            type="text"
                            defaultValue={u.responsavelName ?? ''}
                            onBlur={(e) => handleUpdate(u, { responsavelName: e.target.value.trim() || null })}
                            style={{ ...selectStyle(), width: 220 }}
                          />
                        )}
                      </Td>
                      <Td>
                        <button
                          onClick={() => handleDelete(u)}
                          title="Remover acesso"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', color: BrandColors.danger }}
                        >
                          <Trash2 size={16} strokeWidth={2} />
                        </button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}`, backgroundColor: BrandColors.tableHeader, fontSize: 12, color: '#64748B', whiteSpace: 'nowrap' }}>
      {children}
    </th>
  );
}
function Td({ children }: { children: React.ReactNode }) {
  return <td style={{ textAlign: 'left', padding: '8px 12px', borderBottom: `1px solid ${BrandColors.border}` }}>{children}</td>;
}
