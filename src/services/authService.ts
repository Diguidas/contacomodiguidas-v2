import { supabase } from './supabaseClient';

export interface AppUser {
  id: string;
  email: string;
  role: 'admin' | 'responsavel';
  responsavelName: string | null;
}

function rowToAppUser(row: { id: string; email: string; role: string; responsavel_name: string | null }): AppUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'responsavel',
    responsavelName: row.responsavel_name,
  };
}

export async function signInWithMicrosoft(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: { scopes: 'email', redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Looks up the app_users row for `email` — null means the email logged in
 * successfully with Microsoft but was never granted access to this app
 * (not a login failure, an authorization one). */
export async function fetchAppUser(email: string): Promise<AppUser | null> {
  const { data, error } = await supabase.from('app_users').select('*').eq('email', email).maybeSingle();
  if (error) throw error;
  if (data == null) return null;
  return rowToAppUser(data);
}

export async function fetchAllAppUsers(): Promise<AppUser[]> {
  const { data, error } = await supabase.from('app_users').select('*').order('email');
  if (error) throw error;
  return (data ?? []).map(rowToAppUser);
}

export async function createAppUser(params: { email: string; role: 'admin' | 'responsavel'; responsavelName: string | null }): Promise<void> {
  const { error } = await supabase.from('app_users').insert({
    email: params.email.trim().toLowerCase(),
    role: params.role,
    responsavel_name: params.role === 'responsavel' ? params.responsavelName : null,
  });
  if (error) throw error;
}

export async function updateAppUser(
  id: string,
  params: { role: 'admin' | 'responsavel'; responsavelName: string | null },
): Promise<void> {
  const { error } = await supabase
    .from('app_users')
    .update({ role: params.role, responsavel_name: params.role === 'responsavel' ? params.responsavelName : null })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteAppUser(id: string): Promise<void> {
  const { error } = await supabase.from('app_users').delete().eq('id', id);
  if (error) throw error;
}
