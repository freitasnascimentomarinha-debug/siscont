-- =====================================================================
-- SISCONT - 025: Painel do Encarregado (critérios configuráveis + atividade por usuário)
-- ---------------------------------------------------------------------
-- Idempotente: pode ser executado novamente.
--  1. Critérios do painel (a administração altera em Cadastros › Parâmetros):
--     faixas de alerta de atraso, contestação parada/longa, crescimento da dívida.
--  2. Função atividade_usuarios(de, ate): quantos registros cada usuário fez
--     no período, lido da trilha de auditoria (SECURITY INVOKER: vale a
--     mesma regra de leitura da auditoria; o Encarregado só consulta).
-- =====================================================================

insert into public.parametros (chave, valor, descricao) values
  ('painel_dias_atencao', '90', 'Painel do Encarregado: fatura vencida há mais de N dias entra em "Atenção"'),
  ('painel_dias_critico', '365', 'Painel do Encarregado: fatura vencida há mais de N dias entra em "Crítico"'),
  ('painel_dias_contestacao_parada', '15', 'Painel do Encarregado: contestação sem movimentação há mais de N dias gera alerta'),
  ('painel_dias_contestacao_longa', '60', 'Painel do Encarregado: contestação aberta há mais de N dias é "Crítico"'),
  ('painel_crescimento_pct', '50', 'Painel do Encarregado: alerta se o vencido da OM cresceu mais de N% em 30 dias'),
  ('painel_crescimento_minimo', '10000', 'Painel do Encarregado: ...e o aumento foi de pelo menos R$ N')
on conflict (chave) do nothing;

create or replace function public.atividade_usuarios(p_de date, p_ate date)
returns table (usuario text, tabela text, acao text, qtd bigint, ultima timestamptz)
language sql stable security invoker set search_path = public as $$
  select coalesce(a.usuario_email, 'sem usuário (importação/script)') as usuario, a.tabela, a.acao, count(*) as qtd, max(a.em) as ultima
  from public.auditoria a
  where a.em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
    and a.em <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
    and a.tabela in ('invoices', 'payment_allocations', 'received_documents', 'contestacoes', 'lotes_faturamento', 'cash_flow_exits')
  group by 1, 2, 3
$$;

revoke execute on function public.atividade_usuarios(date, date) from public, anon;
grant execute on function public.atividade_usuarios(date, date) to authenticated;
