-- =====================================================================
-- SISCONT - 010: Fase 6 (rotinas anuais) + Fase 7 (auditoria e backup)
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 009 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
-- FASE 6 - Taxa condominial e diária de atracação
--  1. Proposta anual (PROPOSTA -> APROVADA -> DIVULGADA)
--  2. Rubricas: valor previsto, desconto geral (com justificativa) e
--     gasto do ano anterior (o valor vigente continua em valor_anual)
--  3. Lotação de cada OM no ano (+ lotação anterior e dias do navio)
--  4. Matriz OM x rubrica (de quais despesas a OM participa)
--  5. Descontos por OM (% ou R$, numa rubrica ou no total)
--  6. Dias atracados por classe de navio e ano (média trienal)
-- FASE 7 - Conformidade
--  7. Trilha de auditoria gravada por gatilhos (quem, quando, antes e
--     depois) em faturas, baixas, ALTCRED/GRU, saídas, contestações,
--     lotes, preços, parâmetros, taxa condominial e usuários
--  8. Parâmetro "ultimo_backup" para o lembrete de backup
-- =====================================================================

-- 1. Proposta ----------------------------------------------------------
create table if not exists public.propostas_tc (
  ano integer primary key,
  status text not null default 'PROPOSTA' check (status in ('PROPOSTA', 'APROVADA', 'DIVULGADA')),
  aprovada_em date,
  divulgada_em date,
  observacao text,
  updated_at timestamptz not null default now()
);

-- 2. Rubricas (complemento da 009) ---------------------------------------
alter table public.rubricas add column if not exists valor_previsto numeric;
alter table public.rubricas add column if not exists desconto_geral numeric not null default 0;
alter table public.rubricas add column if not exists gasto_anterior numeric;
alter table public.rubricas add column if not exists justificativa_desconto text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rubricas_desconto_ck') then
    alter table public.rubricas add constraint rubricas_desconto_ck
      check (desconto_geral >= 0 and (valor_previsto is null or desconto_geral <= valor_previsto));
  end if;
end $$;
-- rubricas já cadastradas: o vigente vira o previsto
update public.rubricas set valor_previsto = valor_anual where valor_previsto is null;

-- 3. Lotação -------------------------------------------------------------
create table if not exists public.lotacoes_tc (
  ano integer not null,
  om_id uuid not null references public.oms (id) on delete cascade,
  lotacao numeric not null check (lotacao >= 0),
  lotacao_anterior numeric,
  dias numeric check (dias is null or (dias >= 0 and dias <= 31)),  -- navio: vazio = média trienal da classe
  updated_at timestamptz not null default now(),
  primary key (ano, om_id)
);

-- 4. Matriz OM x rubrica -------------------------------------------------
create table if not exists public.matriz_tc (
  ano integer not null,
  rubrica integer not null,
  om_id uuid not null references public.oms (id) on delete cascade,
  primary key (ano, rubrica, om_id)
);

-- 5. Descontos por OM ----------------------------------------------------
create table if not exists public.descontos_tc (
  id uuid primary key default gen_random_uuid(),
  ano integer not null,
  om_id uuid not null references public.oms (id) on delete cascade,
  rubrica integer,                                        -- vazio = sobre o total da taxa da OM
  tipo text not null check (tipo in ('PERCENTUAL', 'VALOR')),
  valor numeric not null check (valor > 0),
  justificativa text not null check (length(trim(justificativa)) > 0),
  created_at timestamptz not null default now(),
  check (tipo <> 'PERCENTUAL' or valor <= 100)
);
create index if not exists descontos_tc_ano_idx on public.descontos_tc (ano);

-- 6. Dias atracados por classe e ano (média trienal) ---------------------
create table if not exists public.atracacao_anual (
  ano integer not null,
  classe_id uuid not null references public.classes_navio (id) on delete cascade,
  dias numeric not null default 0 check (dias >= 0),
  navios integer not null default 0 check (navios >= 0),
  origem text,                                            -- tela / histórico / BNIC-35
  updated_at timestamptz not null default now(),
  primary key (ano, classe_id)
);

do $$
declare t text;
begin
  foreach t in array array['propostas_tc', 'lotacoes_tc', 'matriz_tc', 'descontos_tc', 'atracacao_anual'] loop
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

drop trigger if exists propostas_tc_touch on public.propostas_tc;
create trigger propostas_tc_touch before update on public.propostas_tc for each row execute function public.touch_updated_at();
drop trigger if exists lotacoes_tc_touch on public.lotacoes_tc;
create trigger lotacoes_tc_touch before update on public.lotacoes_tc for each row execute function public.touch_updated_at();
drop trigger if exists atracacao_anual_touch on public.atracacao_anual;
create trigger atracacao_anual_touch before update on public.atracacao_anual for each row execute function public.touch_updated_at();

-- 7. Trilha de auditoria -------------------------------------------------
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text not null,
  acao text not null check (acao in ('INSERT', 'UPDATE', 'DELETE')),
  em timestamptz not null default now(),
  usuario_id uuid,
  usuario_email text,
  antes jsonb,
  depois jsonb
);
create index if not exists auditoria_registro_idx on public.auditoria (tabela, registro_id, em desc);
create index if not exists auditoria_em_idx on public.auditoria (em desc);

-- Grava só os campos que mudaram (UPDATE); a linha inteira na inclusão/exclusão.
-- SECURITY DEFINER: grava mesmo sem política de INSERT (a aplicação não escreve nesta tabela).
create or replace function public.registrar_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_antes jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_depois jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_reg jsonb := coalesce(v_depois, v_antes);
  v_id text;
  v_email text;
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_depois) loop
      if k in ('updated_at') or (v_antes -> k) is not distinct from (v_depois -> k) then
        v_antes := v_antes - k; v_depois := v_depois - k;
      end if;
    end loop;
    if v_depois = '{}'::jsonb then return new; end if;   -- nada mudou de fato
  end if;
  v_id := coalesce(v_reg ->> 'id', v_reg ->> 'chave', v_reg ->> 'ano', '?');
  begin
    select email into v_email from public.profiles where id = auth.uid();
  exception when others then v_email := null;
  end;
  insert into public.auditoria (tabela, registro_id, acao, usuario_id, usuario_email, antes, depois)
  values (tg_table_name, v_id, tg_op, auth.uid(), coalesce(v_email, auth.jwt() ->> 'email'), v_antes, v_depois);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['invoices', 'payment_allocations', 'received_documents', 'cash_flow_exits', 'contestacoes',
                           'lotes_faturamento', 'precos', 'parametros', 'propostas_tc', 'descontos_tc', 'profiles'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %I on public.%I', t || '_auditoria', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.registrar_auditoria()', t || '_auditoria', t);
    end if;
  end loop;
end $$;

-- Leitura: usuários ativos (histórico das faturas); alterações de usuários só o administrador.
-- Sem políticas de INSERT/UPDATE/DELETE: a trilha não pode ser alterada pela aplicação.
alter table public.auditoria enable row level security;
drop policy if exists auditoria_select on public.auditoria;
create policy auditoria_select on public.auditoria for select to authenticated
  using (public.is_active_user() and (tabela <> 'profiles' or public.is_admin()));
revoke insert, update, delete on public.auditoria from anon, authenticated;

-- 8. Backup assistido ----------------------------------------------------
insert into public.parametros (chave, valor, descricao) values
  ('ultimo_backup', null, 'Data/hora do último backup completo (gravada pela Administração ao baixar o backup)')
on conflict (chave) do nothing;
