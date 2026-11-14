-- =====================================================================
-- SISCONT - 037: registro de erros do sistema (para a aba "Erros" em Administração)
-- ---------------------------------------------------------------------
-- Idempotente. Não altera nenhuma tabela existente.
--  - Qualquer usuário logado pode GRAVAR um erro (somente em seu próprio nome).
--  - Somente o administrador pode LER, marcar como resolvido e apagar.
-- =====================================================================

create table if not exists public.erros_sistema (
  id          uuid primary key default gen_random_uuid(),
  criado_em   timestamptz not null default now(),
  user_id     uuid default auth.uid(),
  email       text,
  pagina      text,
  mensagem    text not null check (char_length(mensagem) <= 1000),
  detalhe     text check (detalhe is null or char_length(detalhe) <= 4000),
  versao      text,
  resolvido   boolean not null default false
);

create index if not exists erros_sistema_criado_em_idx on public.erros_sistema (criado_em desc);

alter table public.erros_sistema enable row level security;

drop policy if exists erros_sistema_insert on public.erros_sistema;
create policy erros_sistema_insert on public.erros_sistema
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists erros_sistema_select on public.erros_sistema;
create policy erros_sistema_select on public.erros_sistema
  for select to authenticated
  using (public.is_admin());

drop policy if exists erros_sistema_update on public.erros_sistema;
create policy erros_sistema_update on public.erros_sistema
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists erros_sistema_delete on public.erros_sistema;
create policy erros_sistema_delete on public.erros_sistema
  for delete to authenticated
  using (public.is_admin());
