-- 031 — Recalcula o vencimento das faturas com ponto de atenção de data (emissão antes de 2025 ou competência antes de 2025)
-- e marca esses pontos como resolvidos. Idempotente e sem DROP.
--  Regra atual: vencimento = emissão + 30 dias corridos, passando para o próximo dia útil;
--               data-limite de certificação = emissão + 10 dias úteis.
--  O vencimento anterior fica guardado em vencimentos_anteriores_011 (dá para desfazer).

create table if not exists public.vencimentos_anteriores_011 (
  invoice_id text, invoice_number text, due_date_anterior date, due_date_novo date, alterado_em timestamptz default now()
);

with alvo as (
  select i.id::text as id, i.invoice_number, i.due_date as antes,
         public.siscont_proximo_dia_util(i.issue_date + 30) as novo
    from public.invoices i
   where i.issue_date is not null
     and coalesce(i.is_canceled, false) = false
     and (i.issue_date < date '2025-01-01' or i.year_competence < 2025)
     and exists (select 1 from jsonb_array_elements(coalesce(i.pontos_atencao, '[]'::jsonb)) p
                  where p->>'tipo' in ('VENCIMENTO_CORRIGIDO', 'VENCIMENTO_INVALIDO', 'EMISSAO_CORRIGIDA')
                    and coalesce(p->>'resolvido', 'false') <> 'true')
), bkp as (
  insert into public.vencimentos_anteriores_011 (invoice_id, invoice_number, due_date_anterior, due_date_novo)
  select id, invoice_number, antes, novo from alvo where antes is distinct from novo
  returning invoice_id
)
update public.invoices i
   set due_date = a.novo,
       data_limite_certificacao = public.siscont_somar_dias_uteis(i.issue_date, 10)
  from alvo a
 where i.id::text = a.id and i.due_date is distinct from a.novo;

-- marca como resolvidos os pontos de data dessas faturas
update public.invoices i
   set pontos_atencao = (
     select jsonb_agg(
       case when p->>'tipo' in ('VENCIMENTO_CORRIGIDO', 'VENCIMENTO_INVALIDO', 'EMISSAO_CORRIGIDA') and coalesce(p->>'resolvido', 'false') <> 'true'
            then p || jsonb_build_object('resolvido', true, 'resolvidoEm', to_char(now(), 'YYYY-MM-DD'), 'resolvidoPor', 'Sistema (script 031)',
                   'justificativa', 'Vencimento recalculado pela regra atual (emissão + 30 dias corridos, próximo dia útil); o anterior ficou guardado em vencimentos_anteriores_011.')
            else p end)
       from jsonb_array_elements(i.pontos_atencao) p)
 where (i.issue_date < date '2025-01-01' or i.year_competence < 2025)
   and exists (select 1 from jsonb_array_elements(coalesce(i.pontos_atencao, '[]'::jsonb)) p
                where p->>'tipo' in ('VENCIMENTO_CORRIGIDO', 'VENCIMENTO_INVALIDO', 'EMISSAO_CORRIGIDA')
                  and coalesce(p->>'resolvido', 'false') <> 'true');
