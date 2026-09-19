import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY não configurados (.env.local).');
}

// The anon/public key is safe to ship to the client by design — every
// table it can touch is locked down by Postgres Row Level Security
// policies (see supabase/schema.sql), not by keeping this key secret.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
