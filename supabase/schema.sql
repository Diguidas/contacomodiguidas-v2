-- Roda isso inteiro no Supabase: SQL Editor > New query > cola > Run.
--
-- Cria duas tabelas:
--   app_users  -> quem pode logar (email), com que papel (admin/responsável)
--                 e, se for responsável, qual nome dela na Azure DevOps
--                 (pra travar o Dashboard nesse nome).
--   app_config -> UMA linha só, com a conexão do Azure DevOps (organização/
--                 projeto/PAT) e as colunas do board — substitui o que hoje
--                 fica salvo no localStorage de cada pessoa, agora
--                 compartilhado por todo mundo.

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null check (role in ('admin', 'responsavel')),
  responsavel_name text,
  created_at timestamptz not null default now()
);

create table if not exists app_config (
  id int primary key default 1,
  organization text not null default '',
  project text not null default '',
  personal_access_token text not null default '',
  triage_columns text not null default 'Triagem,New',
  queue_columns text not null default 'Liberado para Desenvolvimento',
  developer_columns text not null default 'Desenvolvimento,Em Correção',
  user_columns text not null default 'Aguard. Def. Usuário,Validação de Usuário',
  vendor_columns text not null default 'Aguardando Fornecedor',
  general_columns text not null default 'Backlog,Em Andamento,Validação Funcional,Request',
  done_column text not null default 'Concluído',
  done_states text not null default 'Done,Closed,Resolved,Concluído',
  my_display_name text not null default 'Guilherme Silva Franklin',
  tag_filter text not null default 'Guilherme',
  person_stage_overrides jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint app_config_single_row check (id = 1)
);

insert into app_config (id) values (1) on conflict (id) do nothing;

alter table app_users enable row level security;
alter table app_config enable row level security;

-- Função auxiliar: o usuário logado agora é admin? (security definer pra
-- não entrar em loop de RLS ao consultar a própria app_users dentro da
-- policy da app_users).
create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from app_users
    where email = auth.jwt() ->> 'email'
    and role = 'admin'
  );
$$;

-- app_users: cada um só lê a própria linha (pra descobrir seu papel);
-- admin lê/escreve tudo.
create policy "self reads own row" on app_users
  for select using (email = auth.jwt() ->> 'email');
create policy "admin reads all" on app_users
  for select using (is_admin());
create policy "admin inserts" on app_users
  for insert with check (is_admin());
create policy "admin updates" on app_users
  for update using (is_admin());
create policy "admin deletes" on app_users
  for delete using (is_admin());

-- app_config: qualquer usuário autenticado (logado) pode ler — precisa do
-- PAT pra consultar a API do Azure DevOps direto do navegador dele. Só
-- admin escreve.
create policy "any authenticated user reads config" on app_config
  for select using (auth.role() = 'authenticated');
create policy "admin updates config" on app_config
  for update using (is_admin());

-- ⚠️ IMPORTANTE: troque o e-mail abaixo pelo seu e rode esta linha por
-- último — sem isso, ninguém consegue logar como admin (a tela de Admin só
-- é visível pra quem já está cadastrado como admin, e não existe nenhum
-- ainda). Use o mesmo e-mail que você usa pra entrar com a Microsoft.
insert into app_users (email, role, responsavel_name)
values ('seu-email@pole.com.br', 'admin', null)
on conflict (email) do update set role = 'admin';
