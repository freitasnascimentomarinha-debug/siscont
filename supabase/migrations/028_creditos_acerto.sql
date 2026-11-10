-- =====================================================================
-- SISCONT - 028: Controle dos créditos de acerto do OND
-- ---------------------------------------------------------------------
-- Executar no SQL Editor (New query > colar > Run).
-- Idempotente: pode ser executado novamente. Não altera nada existente.
--
-- A fatura de acerto traz o CONSUMO REAL e abate o estimado já faturado
-- (linha 04). Se o real for menor, sobra um CRÉDITO da OM. O crédito é
-- calculado pelo sistema a partir das próprias faturas de acerto (inclusive
-- as já emitidas); esta tabela guarda só o que foi USADO dele:
--   COMPENSACAO: abatido numa fatura seguinte da mesma OM e serviço
--   DEVOLUCAO:   devolvido à OM (ALTCRED/GRU)
-- chave = número da fatura de acerto sem a versão final (-0 / -1).
-- =====================================================================
create table if not exists public.creditos_acerto_uso (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  tipo text not null check (tipo in ('COMPENSACAO', 'DEVOLUCAO')),
  valor numeric not null check (valor > 0),
  data date not null default current_date,
  fatura_id uuid,                       -- fatura em que foi compensado (sem vínculo: a fatura pode ser retificada)
  fatura_numero text,
  documento text,                       -- ALTCRED/GRU da devolução
  observacao text,
  lote_id uuid,                         -- lote que fez a compensação automática
  criado_por text,
  created_at timestamptz not null default now()
);
create index if not exists creditos_acerto_uso_chave_idx on public.creditos_acerto_uso (chave);
create index if not exists creditos_acerto_uso_lote_idx on public.creditos_acerto_uso (lote_id);

alter table public.creditos_acerto_uso enable row level security;
drop policy if exists creditos_acerto_uso_select on public.creditos_acerto_uso;
create policy creditos_acerto_uso_select on public.creditos_acerto_uso for select to authenticated using (public.is_active_user());
drop policy if exists creditos_acerto_uso_insert on public.creditos_acerto_uso;
create policy creditos_acerto_uso_insert on public.creditos_acerto_uso for insert to authenticated with check (public.can_write());
drop policy if exists creditos_acerto_uso_update on public.creditos_acerto_uso;
create policy creditos_acerto_uso_update on public.creditos_acerto_uso for update to authenticated using (public.can_write()) with check (public.can_write());
drop policy if exists creditos_acerto_uso_delete on public.creditos_acerto_uso;
create policy creditos_acerto_uso_delete on public.creditos_acerto_uso for delete to authenticated using (public.can_write());

-- trilha de auditoria (quem registrou, alterou ou desfez um uso)
do $$
begin
  if to_regprocedure('public.registrar_auditoria()') is not null then
    drop trigger if exists creditos_acerto_uso_auditoria on public.creditos_acerto_uso;
    create trigger creditos_acerto_uso_auditoria after insert or update or delete on public.creditos_acerto_uso
      for each row execute function public.registrar_auditoria();
  end if;
end $$;

-- Resultado: acertos já emitidos que viram crédito (total negativo) — conferência
select i.invoice_number as fatura_acerto, i.acerto_de as fatura_estimada, i.client as cliente,
       round((i.value + coalesce(i.adjustment_addition, 0) - coalesce(i.adjustment_deduction, 0))::numeric, 2) as total_da_fatura,
       round((-(i.value + coalesce(i.adjustment_addition, 0) - coalesce(i.adjustment_deduction, 0)))::numeric, 2) as credito_da_om
  from public.invoices i
 where i.acerto_de is not null and coalesce(i.base_calculo ->> 'tipo', '') <> 'CORRECAO' and not coalesce(i.is_canceled, false)
   and (i.value + coalesce(i.adjustment_addition, 0) - coalesce(i.adjustment_deduction, 0)) < -0.005
 order by i.issue_date, i.invoice_number;
