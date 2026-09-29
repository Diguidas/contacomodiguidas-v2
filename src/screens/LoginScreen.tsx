import { useState } from 'react';
import { signInWithMicrosoft } from '../services/authService';
import { BrandColors } from '../theme';
import abapinhoLogo from '../assets/abapinho.png';

/** The door into the app — Microsoft (Azure AD) via Supabase; AuthGate
 * decides afterward whether that email actually has access (see
 * fetchAppUser). */
export function LoginScreen({ error }: { error?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSignIn() {
    setLoading(true);
    setLocalError(null);
    try {
      await signInWithMicrosoft();
      // Browser redirects to Microsoft here — nothing else to do; if it
      // fails without redirecting, we land back below with an error.
    } catch (e) {
      setLocalError(String(e));
      setLoading(false);
    }
  }

  return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: BrandColors.background }}>
      <div style={{ backgroundColor: '#fff', border: `1px solid ${BrandColors.border}`, borderRadius: 16, padding: '40px 36px', width: 380, textAlign: 'center' }}>
        <img src={abapinhoLogo} alt="" style={{ height: 90, objectFit: 'contain', margin: '0 auto' }} />
        <div style={{ height: 28 }} />

        <div style={{ fontSize: 14, color: '#64748B' }}>Entre com sua conta Microsoft do Pole pra continuar.</div>
        <div style={{ height: 20 }} />
        <button
          onClick={handleSignIn}
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: 10,
            border: `1px solid ${BrandColors.border}`,
            backgroundColor: '#fff',
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1,
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          <MicrosoftLogo />
          {loading ? 'Redirecionando...' : 'Entrar com Microsoft'}
        </button>

        {(error || localError) && <div style={{ marginTop: 16, fontSize: 12.5, color: BrandColors.danger }}>{error ?? localError}</div>}
      </div>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <rect x="1" y="1" width="7.5" height="7.5" fill="#F25022" />
      <rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00" />
      <rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF" />
      <rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900" />
    </svg>
  );
}
