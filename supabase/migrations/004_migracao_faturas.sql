-- =====================================================================
-- SISCONT - 004: Fase 1-B - migração de faturas, ALTCRED e baixas
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 003 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. Faturas ligadas ao cadastro (om_id) e com origem registrada
--  2. Quitação registrada fora do sistema: faturas pagas antes do SISCONT
--     (histórico 2023–2025 da planilha, sem o detalhe da ALTCRED)
--  3. Marcação de fatura contestada (o fluxo completo vem na Fase 4)
--  4. Documentos (ALTCRED/GRU) ligados ao comando pagador
--  5. Número de fatura único (se ainda não houver duplicidades)
--  6. "TM" (Tribunal Marítimo) não é setor: removido
-- =====================================================================

alter table public.invoices add column if not exists om_id uuid references public.oms (id) on delete set null;
alter table public.invoices add column if not exists origem text;
alter table public.invoices add column if not exists quitacao_externa text;
alter table public.invoices add column if not exists quitada_em date;
alter table public.invoices add column if not exists contestada boolean not null default false;
create index if not exists invoices_om_idx on public.invoices (om_id);

alter table public.received_documents add column if not exists comando_id uuid references public.comandos (id) on delete set null;
alter table public.received_documents add column if not exists origem text;

alter table public.payment_allocations add column if not exists origem text;

-- Número da fatura único (ignorando espaços). Só cria se não houver duplicidade.
do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invoices_numero_uk') then
    if exists (
      select 1 from public.invoices group by trim(invoice_number) having count(*) > 1
    ) then
      raise notice 'Há números de fatura repetidos; o índice único não foi criado. Corrija as duplicidades e rode de novo.';
    else
      create unique index invoices_numero_uk on public.invoices (trim(invoice_number));
    end if;
  end if;
end $$;

-- Exclusão de OM: também bloqueia quando houver fatura ligada pelo om_id
create or replace function public.om_tem_movimento(p_om_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.invoices i where i.om_id = p_om_id)
      or exists (
        select 1
          from public.oms o
          join public.invoices i
            on trim(coalesce(i.ug, '')) = o.codigo
           and lower(trim(i.client)) = lower(trim(o.nome))
         where o.id = p_om_id
      );
$$;

-- TM não é setor
update public.comandos set setor_id = null where setor_id in (select id from public.setores where upper(sigla) = 'TM');
update public.oms set setor_id = null where setor_id in (select id from public.setores where upper(sigla) = 'TM');
delete from public.setores where upper(sigla) = 'TM';
