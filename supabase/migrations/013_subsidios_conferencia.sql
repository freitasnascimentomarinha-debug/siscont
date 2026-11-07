-- =====================================================================
-- SISCONT - 013: Rubricas (PAR e parcela dos navios), subsídios,
--                contratos e conferência com a planilha
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 012 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. Rubricas: destino PAR (fora da taxa, só para o cálculo do PAR),
--     parcela de cada rubrica paga pelos navios (soma = linha "Navios")
--     e justificativa do valor previsto
--  2. Subsídios: composição do valor de cada rubrica (contrato,
--     processo, estimativa...) — digitados ou importados
--  3. Contratos e documentos anexados a cada rubrica (Storage privado)
--  4. Conferência: valor fechado de cada OM (aba PROPOSTA CONDOMINIO) e
--     extratos por cliente da planilha importada
-- =====================================================================

-- 1. Rubricas ---------------------------------------------------------------
alter table public.rubricas drop constraint if exists rubricas_destino_ck;
alter table public.rubricas add constraint rubricas_destino_ck check (destino in ('TC', 'DA', 'PAR'));
alter table public.rubricas add column if not exists parcela_navios numeric check (parcela_navios is null or parcela_navios >= 0);
alter table public.rubricas add column if not exists justificativa_valor text;

-- 2. Subsídios (composição do valor) -------------------------------------
create table if not exists public.subsidios_tc (
  id uuid primary key default gen_random_uuid(),
  ano integer not null,
  rubrica integer not null,
  descricao text not null check (length(trim(descricao)) > 0),
  documento text,                              -- nº do contrato, processo, NE, pesquisa de preços...
  valor numeric not null default 0,
  observacao text,
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists subsidios_tc_rubrica_idx on public.subsidios_tc (ano, rubrica);

-- 3. Contratos e documentos -------------------------------------------------
create table if not exists public.anexos_tc (
  id uuid primary key default gen_random_uuid(),
  ano integer not null,
  rubrica integer not null,
  nome_arquivo text not null,
  caminho text not null unique,                -- caminho no bucket "contratos-tc"
  tamanho bigint,
  tipo text,
  descricao text,
  enviado_por text,
  created_at timestamptz not null default now()
);
create index if not exists anexos_tc_rubrica_idx on public.anexos_tc (ano, rubrica);

insert into storage.buckets (id, name, public, file_size_limit)
values ('contratos-tc', 'contratos-tc', false, 52428800)   -- 50 MB por arquivo
on conflict (id) do nothing;

drop policy if exists contratos_tc_select on storage.objects;
drop policy if exists contratos_tc_insert on storage.objects;
drop policy if exists contratos_tc_delete on storage.objects;
create policy contratos_tc_select on storage.objects for select to authenticated
  using (bucket_id = 'contratos-tc' and public.is_active_user());
create policy contratos_tc_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'contratos-tc' and public.can_write());
create policy contratos_tc_delete on storage.objects for delete to authenticated
  using (bucket_id = 'contratos-tc' and public.can_write());

-- 4. Conferência com a planilha ---------------------------------------------
create table if not exists public.fechados_tc (
  ano integer not null,
  nome text not null,                          -- nome como está na planilha
  om_id uuid references public.oms (id) on delete set null,
  anterior_anual numeric, anterior_mensal numeric, proposta numeric, descontos numeric, atualizada numeric, mensal numeric,
  primary key (ano, nome)
);
alter table public.fechados_tc add column if not exists tipo text not null default 'TC' check (tipo in ('TC', 'DA'));   -- DA: diária de navio
create table if not exists public.extratos_tc (
  ano integer not null,
  nome text not null,                          -- nome da aba do extrato
  om_id uuid references public.oms (id) on delete set null,
  rubrica integer not null,
  bruto numeric, desconto numeric, liquido numeric,
  primary key (ano, nome, rubrica)
);

do $$
declare t text;
begin
  foreach t in array array['subsidios_tc', 'anexos_tc', 'fechados_tc', 'extratos_tc'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_write())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_write()) with check (public.can_write())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_write())', t || '_delete', t);
  end loop;
end $$;

-- auditoria dos subsídios e anexos (quem incluiu ou excluiu)
do $$
declare t text;
begin
  if to_regprocedure('public.registrar_auditoria()') is not null then
    foreach t in array array['subsidios_tc', 'anexos_tc', 'rubricas'] loop
      execute format('drop trigger if exists %I on public.%I', t || '_auditoria', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t || '_auditoria', t);
    end loop;
  end if;
end $$;
