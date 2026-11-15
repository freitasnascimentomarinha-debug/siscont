-- =====================================================================
-- SISCONT - 038: função painel_resumo (totais do Painel inicial calculados no banco)
-- ---------------------------------------------------------------------
-- Idempotente. Só LÊ: não altera nenhuma tabela. Roda com as permissões de quem chama (RLS vale).
-- Devolve as faturas JÁ AGRUPADAS (cliente, serviço, competência, situação), com valor total, pago e saldo,
-- usando a mesma regra da tela:
--   saldo = 0 se cancelada, quitada antes do SISCONT ou paga; senão (valor + acréscimo − dedução − adiantamentos) − pagamentos.
--   vencida = com saldo, não contestada e vencimento anterior a p_hoje.
--   Adiantamento = baixa do tipo ADIANTAMENTO (ou, sem tipo, de documento ADIANTAMENTO).
-- =====================================================================
drop function if exists public.painel_resumo(date);

create or replace function public.painel_resumo(p_hoje date default current_date)
returns table (
  om_id uuid, setor text, comando text, cliente text, tipo text,
  ano int, mes int, contestada boolean, vencida boolean, faixa text, eh_tc boolean,
  qtd bigint, total numeric, pago numeric, saldo numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with al as (
    select a.invoice_id,
      sum(case when coalesce(a.tipo_baixa, d.operation) = 'ADIANTAMENTO' then a.amount else 0 end) adiant,
      sum(case when coalesce(a.tipo_baixa, d.operation) = 'ADIANTAMENTO' then 0 else a.amount end) pg
    from payment_allocations a join received_documents d on d.id = a.document_id
    group by a.invoice_id
  ), f as (
    select i.*, (i.value + coalesce(i.adjustment_addition, 0) - coalesce(i.adjustment_deduction, 0)) base,
           coalesce(al.adiant, 0) adiant, coalesce(al.pg, 0) pg
    from invoices i left join al on al.invoice_id = i.id
    where not coalesce(i.is_canceled, false)
  ), g as (
    select f.*, greatest(0, base - adiant) a_pagar,
      case when coalesce(quitacao_externa, '') <> '' then 0
           when pg >= greatest(0, base - adiant) - 0.01 then 0
           else greatest(0, round((greatest(0, base - adiant) - pg)::numeric, 2)) end sal
    from f
  ), h as (
    select g.*, (sal > 0.009 and not coalesce(contestada, false) and due_date is not null and due_date < p_hoje) venc
    from g
  )
  -- setor/comando/cliente em texto só vão quando a fatura NÃO está ligada a uma OM do cadastro (o resto a tela resolve pelo cadastro: resposta bem menor)
  select h.om_id, case when o.id is null then h.sector end, case when o.id is null then h.command end, case when o.id is null then h.client end,
    coalesce(nullif(type, ''), nullif(service_acronym, ''), '—'),
    year_competence, month_competence, coalesce(contestada, false), venc,
    case when not venc then 'A vencer'
         when p_hoje - due_date <= 30 then '1 a 30 dias'
         when p_hoje - due_date <= 90 then '31 a 90 dias'
         when p_hoje - due_date <= 180 then '91 a 180 dias'
         when p_hoje - due_date <= 365 then '181 a 365 dias'
         else 'Mais de 1 ano' end,
    coalesce(invoice_number ~ '-TC-', false),
    count(*), round(sum(base)::numeric, 2),
    round(sum(case when coalesce(quitacao_externa, '') <> '' then greatest(pg, a_pagar) else pg end)::numeric, 2),
    round(sum(sal)::numeric, 2)
  from h left join public.oms o on o.id = h.om_id
  group by 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
$$;

grant execute on function public.painel_resumo(date) to authenticated;

-- Mesma coisa em UMA resposta só (lista em JSON): o servidor limita a 1000 linhas por chamada, mas não limita um valor único.
create or replace function public.painel_resumo_json(p_hoje date default current_date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.painel_resumo(p_hoje) r
$$;

grant execute on function public.painel_resumo_json(date) to authenticated;
