-- =====================================================================
-- SISCONT - 012: Clientes e taxas
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 011 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. Rubricas: destino (TC = taxa condominial; DA = valor das diárias
--     de atracação, ex.: rubrica "Navios") e a coluna DESCONTOS da
--     planilha importada (conferência)
--  2. Nomes da planilha sem correspondente no cadastro ("decidir depois")
--  3. OM fora da Ilha das Cobras e nomes alternativos (abreviações)
--  4. Duplicidades: pares marcados como "não são a mesma OM" e a função
--     de unificação (transfere todas as referências e desativa a outra)
--  5. Operador (não só o administrador) pode incluir cliente novo pelas
--     telas da taxa condominial e das diárias
--  6. Grupo de setores da Cobrança com nome editável
--  7. Auditoria também no cadastro de OM
-- =====================================================================

-- 1. Rubricas --------------------------------------------------------------
alter table public.rubricas add column if not exists destino text;
alter table public.rubricas add column if not exists desconto_planilha numeric;
update public.rubricas set destino = case when descricao ~* '\mnavios?\M' then 'DA' else 'TC' end where destino is null;
alter table public.rubricas alter column destino set default 'TC';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rubricas_destino_ck') then
    alter table public.rubricas add constraint rubricas_destino_ck check (destino in ('TC', 'DA'));
  end if;
end $$;

-- 2. Pendências da importação ----------------------------------------------
create table if not exists public.pendentes_tc (
  id uuid primary key default gen_random_uuid(),
  ano integer not null,
  nome text not null,
  tipo text not null default 'TERRA' check (tipo in ('TERRA', 'NAVIO')),
  lotacao numeric,
  lotacao_anterior numeric,
  dias numeric,
  rubricas integer[] not null default '{}',
  descontos jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists pendentes_tc_ano_idx on public.pendentes_tc (ano);

-- 3. OM fora da Ilha e nomes alternativos ----------------------------------
alter table public.oms add column if not exists fora_da_ilha boolean not null default false;
alter table public.oms add column if not exists nomes_alternativos text[] not null default '{}';

-- 4. Duplicidades -----------------------------------------------------------
create table if not exists public.oms_nao_duplicadas (
  par text primary key,                       -- "id1|id2" (ordem alfabética)
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid()
);

-- Unifica p_remover em p_manter: todas as colunas que apontam para public.oms passam a apontar para p_manter
-- (linha que ficaria repetida numa chave única é descartada), o nome antigo vira nome alternativo e a OM
-- removida é desativada (nada é apagado). Devolve quantas referências foram transferidas.
create or replace function public.unificar_om(p_manter uuid, p_remover uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  fk record; r record; n integer := 0; v_nome text; v_alt text[]; v_manter text;
begin
  if not public.is_admin() then raise exception 'Somente o administrador unifica cadastros.'; end if;
  if p_manter = p_remover then raise exception 'Escolha duas OM diferentes.'; end if;
  select nome into v_manter from public.oms where id = p_manter;
  select nome, coalesce(nomes_alternativos, '{}') into v_nome, v_alt from public.oms where id = p_remover;
  if v_manter is null or v_nome is null then raise exception 'OM não encontrada.'; end if;

  for fk in
    select cl.relname as tabela, a.attname as coluna
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.oms'::regclass and ns.nspname = 'public'
       and array_length(c.conkey, 1) = 1
  loop
    for r in execute format('select ctid from public.%I where %I = $1', fk.tabela, fk.coluna) using p_remover loop
      begin
        execute format('update public.%I set %I = $1 where ctid = $2', fk.tabela, fk.coluna) using p_manter, r.ctid;
        n := n + 1;
      exception when unique_violation then
        execute format('delete from public.%I where ctid = $1', fk.tabela) using r.ctid;
      end;
    end loop;
  end loop;

  update public.oms
     set nomes_alternativos = (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(nomes_alternativos, '{}') || v_alt || array[v_nome]) x
                                where x is not null and x <> v_manter)
   where id = p_manter;
  update public.oms
     set ativo = false, desativado_em = coalesce(desativado_em, current_date),
         motivo_desativacao = 'Unificada com ' || v_manter
   where id = p_remover;
  return n;
end $$;

-- Nome alternativo (nome da planilha ligado a uma OM): permitido a quem grava, sem liberar a edição do cadastro
create or replace function public.om_adicionar_nome_alternativo(p_om uuid, p_nome text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write() then raise exception 'Sem permissão.'; end if;
  update public.oms set nomes_alternativos = array_append(nomes_alternativos, p_nome)
   where id = p_om and trim(coalesce(p_nome, '')) <> '' and not (p_nome = any (nomes_alternativos)) and nome <> p_nome;
end $$;

-- 5. RLS --------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pendentes_tc', 'oms_nao_duplicadas'] loop
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
-- incluir cliente novo (não altera nem exclui os existentes: isso continua só com o administrador)
drop policy if exists oms_insert on public.oms;
create policy oms_insert on public.oms for insert to authenticated with check (public.can_write());

-- 6. Grupo de setores da Cobrança -------------------------------------------
insert into public.parametros (chave, valor, descricao) values
  ('nome_grupo_setores', 'Setor do Material', 'Nome do grupo de setores destacado na Cobrança'),
  ('setores_material', 'DGMM', 'Setores do grupo destacado na Cobrança (separados por vírgula)')
on conflict (chave) do nothing;

-- 7. Auditoria do cadastro de OM --------------------------------------------
do $$
begin
  if to_regprocedure('public.registrar_auditoria()') is not null then
    drop trigger if exists oms_auditoria on public.oms;
    create trigger oms_auditoria after insert or update or delete on public.oms for each row execute function public.registrar_auditoria();
  end if;
end $$;
