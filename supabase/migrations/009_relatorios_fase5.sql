-- =====================================================================
-- SISCONT - 009: Fase 5 - Cobrança, relatórios e fluxo de caixa
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 008 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. Rubricas da taxa condominial por exercício (Anexo K / proposta
--     anual): nº de ordem, descrição, conta contábil, valor vigente e
--     %RUB (participação no total)
--  2. Notas de empenho (saídas do fluxo de caixa) classificadas por
--     rubrica ou por categoria (energia, água, telefonia, condomínio/
--     diária/viatura, outros), com anulação
--  3. Registro das mensagens de cobrança enviadas
-- =====================================================================

create table if not exists public.rubricas (
  ano integer not null,
  numero integer not null check (numero between 1 and 99),
  descricao text not null,
  conta_contabil text,
  valor_anual numeric not null default 0 check (valor_anual >= 0),
  percentual numeric,               -- %RUB; vazio = calculado pela participação no total do ano
  updated_at timestamptz not null default now(),
  primary key (ano, numero)
);

alter table public.cash_flow_exits add column if not exists rubrica_numero integer;
alter table public.cash_flow_exits add column if not exists categoria text;
alter table public.cash_flow_exits add column if not exists anulada_em date;
alter table public.cash_flow_exits add column if not exists motivo_anulacao text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cash_flow_exits_categoria_ck') then
    alter table public.cash_flow_exits add constraint cash_flow_exits_categoria_ck
      check (categoria is null or categoria in ('ENERGIA', 'AGUA', 'TELEFONIA', 'CONDOMINIO', 'OUTROS'));
  end if;
end $$;

-- Saídas antigas com a rubrica digitada como número ("14") ou texto ("Água e Esgoto")
update public.cash_flow_exits
   set rubrica_numero = nullif(regexp_replace(rubric, '\D', '', 'g'), '')::int, categoria = 'CONDOMINIO'
 where rubrica_numero is null and categoria is null and rubric ~ '^\s*\d{1,2}\s*$';
update public.cash_flow_exits
   set categoria = case
     when rubric ~* '(água|agua|esgoto)' then 'AGUA'
     when rubric ~* '(energia|eletric)' then 'ENERGIA'
     when rubric ~* 'telef' then 'TELEFONIA'
     when rubric ~* '(condom|diária|diaria|viatura|rebocador)' then 'CONDOMINIO'
     else 'OUTROS' end
 where categoria is null and coalesce(trim(rubric), '') <> '';

create table if not exists public.cobrancas (
  id uuid primary key default gen_random_uuid(),
  enviada_em date not null default current_date,
  comando text not null,
  indicativo text,
  faturas text[] not null default '{}',
  valor numeric not null default 0,
  texto text,
  enviada_por text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['rubricas', 'cobrancas'] loop
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

drop trigger if exists rubricas_touch on public.rubricas;
create trigger rubricas_touch before update on public.rubricas for each row execute function public.touch_updated_at();

insert into public.parametros (chave, valor, descricao) values
  ('dias_saldo_parado', '60', 'ALTCRED com saldo sem movimento há mais de N dias aparece no painel do Encarregado'),
  ('setores_material', 'DGMM', 'Setores somados como "Setor do Material" no quadro de faturas em aberto (separados por vírgula)')
on conflict (chave) do nothing;
