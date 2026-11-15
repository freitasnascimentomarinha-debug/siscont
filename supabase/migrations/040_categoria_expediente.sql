-- =====================================================================
-- SISCONT - 040: nova categoria de saída (NE) "Material de expediente e limpeza" (código EXPEDIENTE)
-- ---------------------------------------------------------------------
-- Idempotente. Só amplia a lista de categorias aceitas em cash_flow_exits.categoria; não apaga nem altera dados.
-- Saídas antigas cuja rubrica digitada fala em "expediente" passam para a nova categoria (hoje, nenhuma).
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'cash_flow_exits_categoria_ck') then
    alter table public.cash_flow_exits drop constraint cash_flow_exits_categoria_ck;
  end if;
  alter table public.cash_flow_exits add constraint cash_flow_exits_categoria_ck
    check (categoria is null or categoria in ('ENERGIA', 'AGUA', 'TELEFONIA', 'CONDOMINIO', 'EXPEDIENTE', 'OUTROS'));
end $$;

update public.cash_flow_exits
   set categoria = 'EXPEDIENTE'
 where rubrica_numero is null and coalesce(categoria, 'OUTROS') = 'OUTROS'
   and (rubric ~* 'expediente' or rubric ~* 'material de limpeza');
