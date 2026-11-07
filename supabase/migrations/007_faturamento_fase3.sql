-- =====================================================================
-- SISCONT - 007: Fase 3 - Ciclo de faturamento mensal
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 006 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. precos: tabela anual de valores (TC mensal por OM, diária de
--     atracação por navio, valores unitários de RB, VT, CR, TL...)
--  2. medicoes: o que as divisões enviam no mês (m³, kWh + kW, horas,
--     km, minutos, manobras, cópias) e/ou o valor em R$ do rateio
--  3. atracacoes: mapa BNIC-35 (dia a dia A = atracado, D = docado) e a
--     previsão de OUT–DEZ para o lote OND
--  4. lotes_faturamento: cada emissão (mensal, OND estimado, acerto OND)
--  5. Faturas: lote, memória de cálculo, estimado (OND), acerto de,
--     "cancela e substitui", e as marcas de envio/SIPLAD/SIAFI
-- =====================================================================

create table if not exists public.precos (
  id uuid primary key default gen_random_uuid(),
  ano integer not null,
  sigla text not null,
  om_id uuid references public.oms (id) on delete cascade,
  valor numeric not null check (valor >= 0),
  unidade text,
  descricao text,
  updated_at timestamptz not null default now()
);
-- um valor por ano/serviço/OM (OM nula = valor geral do serviço)
create unique index if not exists precos_uk on public.precos (ano, sigla, coalesce(om_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.medicoes (
  id uuid primary key default gen_random_uuid(),
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  sigla text not null,
  om_id uuid not null references public.oms (id) on delete cascade,
  quantidade numeric,        -- m³, kWh, horas, minutos fixa, manobras, cópias, dias
  quantidade2 numeric,       -- kW (demanda), km, minutos móvel
  valor numeric,             -- R$ informado (rateio da divisão); se vazio, quantidade × preço
  detalhe jsonb not null default '[]'::jsonb, -- linhas de origem (ex.: CMS Prédio CETM, CAM, Ed. 08)
  estimada boolean not null default false,    -- não mensurável: média das 3 últimas (Anexo J 1.2/1.4)
  origem text,
  updated_at timestamptz not null default now(),
  unique (competencia, sigla, om_id)
);

create table if not exists public.atracacoes (
  id uuid primary key default gen_random_uuid(),
  competencia text not null check (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  om_id uuid not null references public.oms (id) on delete cascade,
  previsao boolean not null default false,
  dias jsonb not null default '[]'::jsonb,   -- ["A","A","D","",...] um por dia do mês
  dias_atracado integer not null default 0,
  dias_docado integer not null default 0,
  gerencia text,
  updated_at timestamptz not null default now(),
  unique (competencia, om_id, previsao)
);

create table if not exists public.lotes_faturamento (
  id uuid primary key default gen_random_uuid(),
  competencia text not null,
  tipo text not null check (tipo in ('MENSAL', 'OND', 'ACERTO')),
  data_emissao date not null,
  data_limite date not null,
  qtd integer not null default 0,
  total numeric not null default 0,
  criado_por text,
  observacao text,
  created_at timestamptz not null default now()
);

alter table public.invoices add column if not exists lote_id uuid references public.lotes_faturamento (id) on delete set null;
alter table public.invoices add column if not exists base_calculo jsonb;
alter table public.invoices add column if not exists estimado boolean not null default false;
alter table public.invoices add column if not exists acerto_de text;
alter table public.invoices add column if not exists substitui text;
alter table public.invoices add column if not exists enviada_em date;
alter table public.invoices add column if not exists certificada_em date;
alter table public.invoices add column if not exists siafi_em date;
create index if not exists invoices_lote_idx on public.invoices (lote_id);
create index if not exists invoices_competencia_idx on public.invoices (year_competence, month_competence);

-- Leitura para usuários ativos; gravação para quem pode escrever (Operador/Admin)
do $$
declare t text;
begin
  foreach t in array array['precos', 'medicoes', 'atracacoes', 'lotes_faturamento'] loop
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

drop trigger if exists precos_touch on public.precos;
create trigger precos_touch before update on public.precos for each row execute function public.touch_updated_at();
drop trigger if exists medicoes_touch on public.medicoes;
create trigger medicoes_touch before update on public.medicoes for each row execute function public.touch_updated_at();
drop trigger if exists atracacoes_touch on public.atracacoes;
create trigger atracacoes_touch before update on public.atracacoes for each row execute function public.touch_updated_at();

insert into public.parametros (chave, valor, descricao) values
  ('meses_media_ond', '1-8', 'Meses usados na média do lote OND (JAN a AGO)'),
  ('texto_obs_adiantamento', 'Baixa na ALTCRED {altcred}.', 'Texto na fatura quando há abatimento de adiantamento')
on conflict (chave) do nothing;
