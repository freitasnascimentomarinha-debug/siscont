-- =====================================================================
-- SISCONT - 011: Certificação × vencimento
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 010 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
-- Certificação e vencimento são datas diferentes:
--  - data-limite de CERTIFICAÇÃO no SIPLAD = emissão + 10 dias úteis
--    (OI 40-04, 6.1), para todas as faturas  -> nova coluna
--    invoices.data_limite_certificacao
--  - VENCIMENTO (pagamento) = emissão + 30 dias corridos; se cair em fim
--    de semana ou feriado, vai para o próximo dia útil -> invoices.due_date
--    Exceção: faturas OND (estimado de fim de exercício) vencem na data de
--    certificação.
--
-- Recalcula o vencimento das faturas EM ABERTO (não canceladas, não
-- quitadas, saldo > 0), exceto OND. Pagas e canceladas não mudam.
-- O vencimento anterior de cada fatura alterada fica guardado em
-- public.vencimentos_anteriores_011 (permite desfazer).
-- =====================================================================

alter table public.invoices add column if not exists data_limite_certificacao date;

insert into public.parametros (chave, valor, descricao) values
  ('prazo_vencimento_dias_corridos', '30', 'Vencimento da fatura: dias corridos após a emissão (próximo dia útil). Faturas OND vencem na data de certificação')
on conflict (chave) do nothing;
update public.parametros set descricao = 'Data-limite de certificação no SIPLAD: dias úteis após a emissão (OI 40-04, 6.1). Não é o vencimento'
 where chave = 'prazo_certificacao_dias_uteis';

-- Funções de data (feriados da tabela public.feriados) ----------------------
create or replace function public.siscont_proximo_dia_util(d date) returns date
language plpgsql stable as $$
declare r date := d;
begin
  while extract(isodow from r) in (6, 7) or exists (select 1 from public.feriados f where f.data = r) loop
    r := r + 1;
  end loop;
  return r;
end $$;

create or replace function public.siscont_somar_dias_uteis(d date, n integer) returns date
language plpgsql stable as $$
declare r date := d; faltam integer := n;
begin
  while faltam > 0 loop
    r := r + 1;
    if extract(isodow from r) not in (6, 7) and not exists (select 1 from public.feriados f where f.data = r) then
      faltam := faltam - 1;
    end if;
  end loop;
  return r;
end $$;

-- 1. Data-limite de certificação de todas as faturas ------------------------
-- faturas emitidas em lote: a data-limite do lote; demais: emissão + prazo
update public.invoices i
   set data_limite_certificacao = l.data_limite
  from public.lotes_faturamento l
 where i.lote_id = l.id and i.data_limite_certificacao is null and l.data_limite is not null;

update public.invoices
   set data_limite_certificacao = public.siscont_somar_dias_uteis(issue_date::date,
         coalesce((select nullif(valor, '')::int from public.parametros where chave = 'prazo_certificacao_dias_uteis'), 10))
 where data_limite_certificacao is null and issue_date is not null;

-- 2. Vencimento das faturas em aberto (exceto OND) --------------------------
create table if not exists public.vencimentos_anteriores_011 (
  invoice_id text primary key,
  invoice_number text,
  due_date_anterior date,
  due_date_novo date,
  alterado_em timestamptz not null default now()
);
alter table public.vencimentos_anteriores_011 enable row level security;
drop policy if exists vencimentos_anteriores_011_select on public.vencimentos_anteriores_011;
create policy vencimentos_anteriores_011_select on public.vencimentos_anteriores_011 for select to authenticated using (public.is_active_user());

with pagos as (
  select invoice_id::text as id, sum(amount) as pago from public.payment_allocations group by invoice_id
), alvo as (
  select i.id::text as id, i.invoice_number, i.due_date::date as anterior,
         public.siscont_proximo_dia_util(i.issue_date::date
           + coalesce((select nullif(valor, '')::int from public.parametros where chave = 'prazo_vencimento_dias_corridos'), 30)) as novo
    from public.invoices i
    left join pagos p on p.id = i.id::text
    left join public.lotes_faturamento l on l.id = i.lote_id
   where coalesce(i.is_canceled, false) = false
     and nullif(trim(coalesce(i.quitacao_externa::text, '')), '') is null   -- quitada fora do sistema
     and i.issue_date is not null
     -- saldo em aberto
     and coalesce(i.value, 0) + coalesce(i.adjustment_addition, 0) - coalesce(i.adjustment_deduction, 0) - coalesce(p.pago, 0) > 0.009
     -- exceto OND (estimado de fim de exercício)
     and coalesce(i.estimado, false) = false
     and coalesce(l.tipo, '') <> 'OND'
     and coalesce(i.observation, '') !~* '\mOND\M'
), gravados as (
  insert into public.vencimentos_anteriores_011 (invoice_id, invoice_number, due_date_anterior, due_date_novo)
  select id, invoice_number, anterior, novo from alvo where anterior is distinct from novo
  on conflict (invoice_id) do nothing
  returning invoice_id, due_date_novo
)
update public.invoices i set due_date = g.due_date_novo
  from gravados g
 where i.id::text = g.invoice_id;

-- Resumo
select count(*) as faturas_com_vencimento_recalculado from public.vencimentos_anteriores_011;

-- Para desfazer (se precisar):
-- update public.invoices i set due_date = v.due_date_anterior
--   from public.vencimentos_anteriores_011 v where i.id::text = v.invoice_id;
