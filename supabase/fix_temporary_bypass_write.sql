-- Roda isso no SQL Editor do Supabase. Corrige um problema real: no modo
-- "acesso provisório" (login anônimo, enquanto o Microsoft está desligado),
-- a sessão não tem e-mail, então is_admin() sempre dava falso e a RLS
-- bloqueava silenciosamente qualquer tentativa de salvar em app_config
-- (organização/projeto/PAT) — parecia salvar, mas nada era gravado.
--
-- Isso libera escrita também pra sessão anônima, coerente com o aviso já
-- mostrado na tela de login ("sem controle de acesso real nesse modo").
-- Quando o login Microsoft voltar (MICROSOFT_LOGIN_ENABLED = true) e o
-- acesso provisório for desativado, pode reverter isso rodando o DROP no
-- final e recriando só a policy original (is_admin()).

drop policy if exists "admin updates config" on app_config;

create policy "admin or temporary bypass updates config" on app_config
  for update using (
    is_admin()
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

-- Pra reverter mais tarde (quando tirar o acesso provisório de vez):
--   drop policy "admin or temporary bypass updates config" on app_config;
--   create policy "admin updates config" on app_config for update using (is_admin());
