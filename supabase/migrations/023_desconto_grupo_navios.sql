-- =====================================================================
-- SISCONT - 023: desconto para o GRUPO NAVIOS (aba Descontos por OM)
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 022. Idempotente.
-- O desconto pode ser de uma OM (om_id) ou do grupo dos navios (grupo = 'NAVIOS'), numa linha
-- (rubrica) ou no total. No grupo NAVIOS ele reduz o valor destinado aos navios (diárias).
-- =====================================================================
alter table public.descontos_tc alter column om_id drop not null;
alter table public.descontos_tc add column if not exists grupo text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'descontos_tc_grupo_ck') then
    alter table public.descontos_tc add constraint descontos_tc_grupo_ck check (grupo is null or grupo = 'NAVIOS');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'descontos_tc_alvo_ck') then
    alter table public.descontos_tc add constraint descontos_tc_alvo_ck check (om_id is not null or grupo = 'NAVIOS');
  end if;
end $$;
