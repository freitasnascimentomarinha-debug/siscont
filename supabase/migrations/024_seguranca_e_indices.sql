-- =====================================================================
-- SISCONT - 024: correções de segurança e desempenho (análise geral)
-- ---------------------------------------------------------------------
-- Idempotente: pode ser executado novamente.
--  1. A função interna de unificação de OM (siscont_unificar_om_exec) não
--     verifica permissão e podia ser chamada por qualquer um (até sem login).
--     Só a função unificar_om (que exige administrador) pode chamá-la.
--  2. Tabelas antigas, vazias e sem uso pelo sistema estavam sem RLS
--     (qualquer um com a chave pública lia/gravava): RLS ligado, sem
--     políticas = ninguém acessa pela API.
--  3. search_path fixo nas funções auxiliares (recomendação do Supabase).
--  4. Índice duplicado em invoices removido; índices nas chaves de OM das
--     tabelas da taxa condominial e de preços.
-- =====================================================================

-- 1. unificação de OM só pelo administrador
revoke execute on function public.siscont_unificar_om_exec(uuid, uuid) from public, anon, authenticated;

-- 2. tabelas legadas (versão antiga do sistema) sem acesso pela API
do $$
declare t text;
begin
  foreach t in array array['users', 'commands', 'sectors', 'rubrics', 'invoice_payments', 'advances', 'advance_usages'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;

-- 3. search_path fixo
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('touch_updated_at', 'oms_bloqueia_exclusao', 'siscont_proximo_dia_util', 'siscont_somar_dias_uteis')
  loop
    execute format('alter function %s set search_path = public', f.assinatura);
  end loop;
end $$;

-- 4. índices
drop index if exists public.idx_invoices_competence;   -- idêntico a invoices_competencia_idx
create index if not exists matriz_tc_om_idx on public.matriz_tc (om_id);
create index if not exists lotacoes_tc_om_idx on public.lotacoes_tc (om_id);
create index if not exists descontos_tc_om_idx on public.descontos_tc (om_id);
create index if not exists precos_om_idx on public.precos (om_id);
