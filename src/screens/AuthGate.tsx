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

  const checkingSession = session === undefined || (session != null && appUser === undefined);
  const [stuck, setStuck] = useState(false);

  // Known supabase-js issue: after the browser reloads a discarded tab
  // (Chrome's Memory Saver), the session check occasionally hangs forever
  // instead of just being slow — an internal lock never resolves. Rather
  // than leave the splash stuck permanently, force one real reload if it's
  // still checking after a few seconds; that reliably clears the stuck
  // state, whereas waiting never does. Guarded by a sessionStorage flag so
  // a genuinely broken session (network down, Supabase outage) reloads
  // once and then shows a manual retry instead of loop-reloading forever.
  useEffect(() => {
    if (!checkingSession) return;
    const timer = setTimeout(() => {
      const alreadyRetried = sessionStorage.getItem('authWatchdogRetried') === '1';
      if (alreadyRetried) {
        setStuck(true);
        return;
      }
      sessionStorage.setItem('authWatchdogRetried', '1');
      window.location.reload();
    }, 6000);
    return () => clearTimeout(timer);
  }, [checkingSession]);

  useEffect(() => {
    if (!checkingSession) sessionStorage.removeItem('authWatchdogRetried');
  }, [checkingSession]);

  if (checkingSession) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <img src={abapinhoLogo} alt="" style={{ height: 70, objectFit: 'contain' }} />
        <span style={{ color: '#64748B', fontSize: 13 }}>Carregando...</span>
        {stuck && (
          <>
            <span style={{ color: '#64748B', fontSize: 12.5, maxWidth: 280, textAlign: 'center' }}>
              Está demorando mais que o normal — pode ser uma instabilidade de rede ou do Supabase.
            </span>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '10px 16px', borderRadius: 8, border: `1px solid ${BrandColors.border}`, backgroundColor: '#fff', cursor: 'pointer', fontSize: 13 }}
            >
              Tentar de novo
            </button>
          </>
        )}
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
