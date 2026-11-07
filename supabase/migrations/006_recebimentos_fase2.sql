-- =====================================================================
-- SISCONT - 006: Fase 2 - Recebimentos e conciliação
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 005 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. ALTCRED completa (dados da Solicitação de Alteração de Crédito do
--     SIPLAD): exercício, criação, tipo, situação, UG cliente, ALTCRED de
--     origem, observação do solicitante, células de débito/crédito (PTRES,
--     UO, FR, ND, PI, UGR, UGE), valor original × estornado
--  2. Destinação (faturas e/ou OM indicadas pelo cliente) e "aguardando
--     destinação"
--  3. Sobra da ALTCRED enviada para adiantamento
--  4. GRU (extra-MB): autenticação bancária e data de pagamento
--  5. Tipo de cada baixa (PAGAMENTO ou ADIANTAMENTO): uma mesma ALTCRED
--     paga faturas e, com a sobra, vira adiantamento
-- =====================================================================

alter table public.received_documents add column if not exists exercicio integer;
alter table public.received_documents add column if not exists data_criacao date;
alter table public.received_documents add column if not exists tipo_alteracao text;
alter table public.received_documents add column if not exists situacao_siplad text;
alter table public.received_documents add column if not exists ug_cliente text;
alter table public.received_documents add column if not exists altcred_origem text;
alter table public.received_documents add column if not exists observacao_solicitante text;
alter table public.received_documents add column if not exists celulas jsonb not null default '[]'::jsonb;
alter table public.received_documents add column if not exists valor_original numeric;
alter table public.received_documents add column if not exists valor_estornado numeric not null default 0;
alter table public.received_documents add column if not exists destinacao jsonb not null default '[]'::jsonb;
alter table public.received_documents add column if not exists aguardando boolean not null default false;
alter table public.received_documents add column if not exists sobra_adiantamento boolean not null default false;
alter table public.received_documents add column if not exists gru_autenticacao text;
alter table public.received_documents add column if not exists gru_data_pagamento date;

alter table public.payment_allocations add column if not exists tipo_baixa text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_allocations_tipo_baixa_ck') then
    alter table public.payment_allocations add constraint payment_allocations_tipo_baixa_ck
      check (tipo_baixa is null or tipo_baixa in ('PAGAMENTO', 'ADIANTAMENTO'));
  end if;
end $$;

-- ---------------------------------------------------------------- dados existentes
-- Exercício pelo número (X488.2026.AC.00268 → 2026) ou pela data
update public.received_documents
   set exercicio = coalesce(nullif(substring(document_number from '^[A-Z]\d{3}\.(\d{4})\.AC\.')::int, 0), extract(year from date)::int)
 where exercicio is null and date is not null;

-- GRU migradas: "GRU <autenticação>"
update public.received_documents
   set gru_autenticacao = trim(substring(document_number from 5)),
       gru_data_pagamento = coalesce(gru_data_pagamento, date)
 where document_type = 'GRU' and gru_autenticacao is null and document_number like 'GRU %';

-- Tipo das baixas: uso de adiantamento (RESUMO ADIANTAMENTO ou documento de adiantamento) × pagamento
update public.payment_allocations a
   set tipo_baixa = case
         when a.origem like 'Migração › RESUMO ADIANTAMENTO%' then 'ADIANTAMENTO'
         when d.operation = 'ADIANTAMENTO' then 'ADIANTAMENTO'
         else 'PAGAMENTO' end
  from public.received_documents d
 where d.id = a.document_id and a.tipo_baixa is null;

-- ALTCRED de pagamento cuja sobra já foi usada como adiantamento
update public.received_documents d
   set sobra_adiantamento = true
 where d.operation <> 'ADIANTAMENTO' and not d.sobra_adiantamento
   and (d.observation ilike '%enviad% para adiantamento%'
        or exists (select 1 from public.payment_allocations a where a.document_id = d.id and a.tipo_baixa = 'ADIANTAMENTO'));

create index if not exists received_documents_ug_cliente_idx on public.received_documents (ug_cliente);
create index if not exists received_documents_exercicio_idx on public.received_documents (exercicio);
