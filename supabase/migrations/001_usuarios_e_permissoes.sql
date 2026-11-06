-- =====================================================================
-- SISCONT - 001: Usuários, perfis e permissões (RLS)
-- ---------------------------------------------------------------------
-- Executar UMA VEZ no Supabase: Dashboard > SQL Editor > New query >
-- colar este arquivo inteiro > Run. O script é idempotente (pode ser
-- executado novamente sem perder dados).
--
-- O que ele faz:
--  1. Garante a tabela public.profiles com as colunas usadas pelo sistema
--     (name, email, role, active, created_at, updated_at).
--  2. Cria perfil automaticamente quando um usuário é criado no Auth
--     (gatilho on_auth_user_created). Auto-cadastro entra como
--     CONSULTA e PENDENTE (active = false) até o administrador liberar.
--  3. Copia o e-mail de auth.users para os perfis antigos sem e-mail.
--  4. Funções auxiliares is_admin() / can_write() / is_active_user().
--  5. Impede que um usuário comum altere o próprio perfil de acesso.
--  6. Políticas RLS:
--       - profiles: cada um lê o próprio; ADMIN lê/edita/exclui todos.
--       - tabelas de dados: leitura para usuários ativos; escrita apenas
--         para ADMIN e OPERADOR (USER). CONSULTA (READ_ONLY) só lê.
-- =====================================================================

-- 1. Tabela de perfis ---------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text,
  role text not null default 'READ_ONLY',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists active boolean not null default true;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Perfis inválidos/nulos viram CONSULTA antes de aplicar a restrição
update public.profiles set role = 'READ_ONLY'
 where role is null or role not in ('ADMIN', 'USER', 'READ_ONLY');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('ADMIN', 'USER', 'READ_ONLY'));
  end if;
end $$;

-- Perfis órfãos (sem usuário no Auth) são removidos; a FK passa a cascatear
delete from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id);

-- 2/3. Sincroniza e-mail e cria perfis que estejam faltando --------------
update public.profiles p set email = u.email
  from auth.users u
 where u.id = p.id and (p.email is null or p.email <> u.email);

insert into public.profiles (id, name, email, role, active)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1)),
       u.email, 'READ_ONLY', true
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id);

-- Gatilho: novo usuário no Auth => novo perfil
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email,
    'READ_ONLY',
    -- Criado pelo administrador (via API) já nasce ativo; auto-cadastro fica pendente
    coalesce((new.raw_app_meta_data ->> 'created_by_admin')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Mantém o e-mail do perfil igual ao do Auth
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- 4. Funções auxiliares (SECURITY DEFINER evita recursão nas políticas) ---
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'ADMIN' and active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
     where id = auth.uid() and role in ('ADMIN', 'USER') and active
  );
$$;

-- 5. Proteção de campos sensíveis do perfil -----------------------------
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  -- service_role (API do servidor) e administradores podem tudo
  if coalesce(auth.role(), '') = 'service_role' or public.is_admin() then
    return new;
  end if;
  -- Usuário comum: só pode alterar o próprio nome
  new.role := old.role;
  new.active := old.active;
  new.email := old.email;
  return new;
end;
$$;

drop trigger if exists profiles_protect_fields on public.profiles;
create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- 6. RLS ----------------------------------------------------------------
alter table public.profiles enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname = 'public' and tablename = 'profiles' loop
    execute format('drop policy if exists %I on public.profiles', pol.policyname);
  end loop;
end $$;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid() and role = 'READ_ONLY');

create policy profiles_admin_insert on public.profiles
  for insert to authenticated
  with check (public.is_admin());

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_admin() and id <> auth.uid());

-- Tabelas de dados: leitura para ativos, escrita para ADMIN/OPERADOR
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array[
    'clients', 'service_definitions', 'invoices',
    'received_documents', 'payment_allocations', 'cash_flow_exits'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabela public.% não existe - ignorada', t;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;

    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_write())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_write()) with check (public.can_write())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_write())', t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- PRIMEIRO ADMINISTRADOR: se ainda não houver nenhum ADMIN ativo,
-- descomente a linha abaixo, troque o e-mail e execute.
-- update public.profiles set role = 'ADMIN', active = true where email = 'seu.email@marinha.mil.br';
-- ---------------------------------------------------------------------
