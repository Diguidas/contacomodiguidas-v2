import { AuthGate } from './screens/AuthGate';

/** Root of "Conta com o Diguidas" — everything starts behind AuthGate now
 * (Microsoft login via Supabase). Once authorized, the app itself is still
 * a single persistent shell (sidebar + content) that switches between
 * Dashboard / Visão do time / Histórico / SLA / Agrupamento / Conexão /
 * Administração internally — no separate routes/URLs to keep in sync. */
function App() {
  return <AuthGate />;
}

export default App;
