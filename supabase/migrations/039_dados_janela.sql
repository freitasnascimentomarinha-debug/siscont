-- =====================================================================
-- SISCONT - 039: janela de exercícios (carregar só os anos recentes + o que ainda importa)
-- ---------------------------------------------------------------------
-- Idempotente. Só LÊ: não altera nem apaga nada. Roda com as permissões de quem chama (RLS vale).
-- dados_janela(p_desde) devolve, em UM valor JSON, {invoices, documents, allocations} com:
--   • faturas: competência >= p_desde, OU com saldo em aberto, OU em contestação;
--   • documentos (ALTCRED/GRU): data >= p_desde, OU com saldo ainda disponível;
--   • baixas: todas as que tocam um desses documentos OU uma dessas faturas;
--   • FECHAMENTO: se uma baixa entra, entram também a fatura e o documento dela (repete até estabilizar).
--     Assim nenhuma baixa fica sem fatura ou sem documento, e o saldo de cada documento sai igual ao de "todos os anos".
-- Saldo da fatura = mesma regra do painel_resumo (cancelada, quitada antes do SISCONT ou paga = 0).
-- =====================================================================
create or replace function public.dados_janela(p_desde int)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  ids_f uuid[];
  ids_d uuid[];
  antes int;
  depois int;
begin
  -- faturas que continuam importando: do período, com saldo ou contestadas
  with al as (
    select a.invoice_id,
      sum(case when coalesce(a.tipo_baixa, d.operation) = 'ADIANTAMENTO' then a.amount else 0 end) adiant,
      sum(case when coalesce(a.tipo_baixa, d.operation) = 'ADIANTAMENTO' then 0 else a.amount end) pg
    from payment_allocations a join received_documents d on d.id = a.document_id
    group by a.invoice_id
  ), f as (
    select i.id, i.year_competence, i.contestada, i.is_canceled, i.quitacao_externa,
           (i.value + coalesce(i.adjustment_addition, 0) - coalesce(i.adjustment_deduction, 0)) base,
           coalesce(al.adiant, 0) adiant, coalesce(al.pg, 0) pg
    from invoices i left join al on al.invoice_id = i.id
  )
  select array_agg(id) into ids_f from f
  where year_competence >= p_desde
     or coalesce(contestada, false)
     or (not coalesce(is_canceled, false) and coalesce(quitacao_externa, '') = ''
         and pg < greatest(0, base - adiant) - 0.01);

  -- documentos que continuam importando: do período ou com saldo disponível (valor − baixas em faturas não canceladas)
  select array_agg(d.id) into ids_d from received_documents d
  where extract(year from d.date) >= p_desde
     or d.total_value - coalesce((select sum(a.amount) from payment_allocations a join invoices i on i.id = a.invoice_id
                                  where a.document_id = d.id and not coalesce(i.is_canceled, false)), 0) > 0.005;

  ids_f := coalesce(ids_f, '{}'); ids_d := coalesce(ids_d, '{}');
  -- fechamento: repete até nenhuma baixa ficar com uma ponta de fora
  for k in 1..20 loop
    antes := cardinality(ids_f) + cardinality(ids_d);
    select coalesce(array_agg(distinct x), '{}') into ids_f from unnest(ids_f || coalesce((select array_agg(a.invoice_id) from payment_allocations a where a.document_id = any(ids_d) or a.invoice_id = any(ids_f)), '{}')) x;
    select coalesce(array_agg(distinct x), '{}') into ids_d from unnest(ids_d || coalesce((select array_agg(a.document_id) from payment_allocations a where a.document_id = any(ids_d) or a.invoice_id = any(ids_f)), '{}')) x;
    depois := cardinality(ids_f) + cardinality(ids_d);
    exit when depois = antes;
  end loop;

  return jsonb_build_object(
    'invoices', (select coalesce(jsonb_agg(to_jsonb(i) order by i.id), '[]'::jsonb) from invoices i where i.id = any(ids_f)),
    'documents', (select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]'::jsonb) from received_documents d where d.id = any(ids_d)),
    'allocations', (select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb) from payment_allocations a where a.document_id = any(ids_d) or a.invoice_id = any(ids_f)),
    'total_faturas', (select count(*) from invoices),
    'total_documentos', (select count(*) from received_documents)
  );
end;
$$;

grant execute on function public.dados_janela(int) to authenticated;
