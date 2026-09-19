-- Roda isso no SQL Editor do Supabase — mesmo problema do app_config, agora
-- em app_users: a sessão anônima (acesso provisório) não tem e-mail, então
-- is_admin() dá falso e a RLS bloqueia silenciosamente leitura/escrita —
-- por isso a tela de Administração aparecia vazia mesmo com gente
-- cadastrada.

drop policy if exists "self reads own row" on app_users;
drop policy if exists "admin reads all" on app_users;
drop policy if exists "admin inserts" on app_users;
drop policy if exists "admin updates" on app_users;
drop policy if exists "admin deletes" on app_users;

create policy "self or admin or temporary bypass reads" on app_users
  for select using (
    email = auth.jwt() ->> 'email'
    or is_admin()
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );
create policy "admin or temporary bypass inserts" on app_users
  for insert with check (
    is_admin()
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );
create policy "admin or temporary bypass updates" on app_users
  for update using (
    is_admin()
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );
create policy "admin or temporary bypass deletes" on app_users
  for delete using (
    is_admin()
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

-- Pra reverter mais tarde (quando tirar o acesso provisório de vez), roda
-- os DROP POLICY acima de novo e recria as 5 originais (sem o
-- "or coalesce(...is_anonymous...)"), exatamente como estavam em
-- supabase/schema.sql.
