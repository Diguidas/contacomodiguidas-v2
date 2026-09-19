import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';
import { fetchAppUser, signOut } from '../services/authService';
import type { AppUser } from '../services/authService';
import { LoginScreen } from './LoginScreen';
import { AppShell } from './AppShell';
import { BrandColors } from '../theme';
import abapinhoLogo from '../assets/abapinho.png';

/** Root gate: nothing in the app renders before this resolves who's asking.
 * Three states — signed out (LoginScreen), signed in but not in app_users
 * (access denied), signed in and authorized (AppShell, told who's driving
 * via `appUser`). */
export function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = not checked yet
  const [appUser, setAppUser] = useState<AppUser | null | undefined>(undefined);
  const [lookupError, setLookupError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return; // still checking
    if (session == null) {
      setAppUser(null);
      return;
    }
    // TEMPORÁRIO: sessão anônima (botão "acesso provisório" na LoginScreen,
    // enquanto o Azure AD não libera) — não existe e-mail pra consultar
    // app_users, então libera direto como admin fictício. Remover isso
    // junto com signInTemporaryBypass quando o login Microsoft voltar.
    if (session.user.is_anonymous) {
      setAppUser({ id: session.user.id, email: '(acesso provisório)', role: 'admin', responsavelName: null });
      return;
    }
    const email = session.user.email;
    if (!email) {
      setLookupError('Sua conta Microsoft não retornou um e-mail — não é possível verificar o acesso.');
      setAppUser(null);
      return;
    }
    setAppUser(undefined);
    fetchAppUser(email)
      .then(setAppUser)
      .catch((e) => {
        setLookupError(String(e));
        setAppUser(null);
      });
  }, [session]);

  if (session === undefined || (session != null && appUser === undefined)) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <img src={abapinhoLogo} alt="" style={{ height: 70, objectFit: 'contain' }} />
        <span style={{ color: '#64748B', fontSize: 13 }}>Carregando...</span>
      </div>
    );
  }

  if (session == null) {
    return <LoginScreen error={lookupError} />;
  }

  if (appUser == null) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: BrandColors.background }}>
        <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 16, padding: '40px 36px', width: 380, textAlign: 'center' }}>
          <div style={{ fontSize: 16, fontWeight: 'bold' }}>Acesso não liberado</div>
          <div style={{ height: 8 }} />
          <div style={{ fontSize: 13, color: '#64748B' }}>
            Sua conta ({session.user.email}) fez login com sucesso, mas ainda não tem acesso liberado a este app. Peça pra um admin te
            cadastrar.
          </div>
          <div style={{ height: 20 }} />
          <button
            onClick={() => signOut()}
            style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}
          >
            Sair
          </button>
        </div>
      </div>
    );
  }

  return <AppShell appUser={appUser} onSignOut={signOut} />;
}
