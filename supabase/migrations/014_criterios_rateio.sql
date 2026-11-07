-- =====================================================================
-- SISCONT - 014: Critério de rateio por rubrica
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 013 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. Cada rubrica passa a ter:
--     - criterio: como a parte das OM é dividida — por pessoa (lotação
--       × dias), por área (m²), partes iguais ou peso informado
--     - percentual_om: % do valor dividido entre as OM (100 = integral)
--     - percentual_navios: % do valor cobrado do grupo NAVIOS
--     - modo_navios: SEPARADO (OM e navios pagam cada um a sua %, como
--       em 2026) ou CONJUNTO (um só valor dividido entre OM e navios)
--  2. Lotação do ano ganha área (m²) e peso informado de cada OM
--  3. "Navios" deixa de ser rubrica: o total do grupo na planilha fica
--     guardado na proposta, só para conferência
-- =====================================================================

-- 1. Rubricas ---------------------------------------------------------------
alter table public.rubricas add column if not exists criterio text not null default 'LOTACAO';
alter table public.rubricas add column if not exists percentual_om numeric not null default 100;
alter table public.rubricas add column if not exists percentual_navios numeric not null default 0;
alter table public.rubricas add column if not exists modo_navios text not null default 'SEPARADO';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rubricas_criterio_ck') then
    alter table public.rubricas add constraint rubricas_criterio_ck check (criterio in ('LOTACAO', 'AREA', 'IGUAL', 'PESO'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rubricas_percentuais_ck') then
    alter table public.rubricas add constraint rubricas_percentuais_ck check (percentual_om between 0 and 100 and percentual_navios between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rubricas_modo_navios_ck') then
    alter table public.rubricas add constraint rubricas_modo_navios_ck check (modo_navios in ('SEPARADO', 'CONJUNTO'));
  end if;
end $$;

-- parte dos navios já gravada em R$ (script 013) vira percentual do valor previsto
update public.rubricas
   set percentual_navios = least(100, round(parcela_navios / nullif(coalesce(valor_previsto, valor_anual), 0) * 100, 4))
 where coalesce(parcela_navios, 0) > 0 and percentual_navios = 0;
-- rubrica que as OM não pagavam (desconto geral = valor inteiro) e os navios pagam inteira: OM 0%, sem desconto
update public.rubricas
   set percentual_om = 0, desconto_geral = 0, justificativa_desconto = null
 where percentual_navios >= 99.99 and desconto_geral > 0 and abs(desconto_geral - coalesce(valor_previsto, valor_anual)) < 0.01;

-- 2. Área e peso na lotação do ano ---------------------------------------------
alter table public.lotacoes_tc add column if not exists area numeric check (area is null or area >= 0);
alter table public.lotacoes_tc add column if not exists peso numeric check (peso is null or peso >= 0);

-- 3. Grupo NAVIOS -----------------------------------------------------------
alter table public.propostas_tc add column if not exists navios_planilha numeric;
update public.propostas_tc p
   set navios_planilha = r.valor_previsto
  from public.rubricas r
 where r.ano = p.ano and r.destino = 'DA' and p.navios_planilha is null;
