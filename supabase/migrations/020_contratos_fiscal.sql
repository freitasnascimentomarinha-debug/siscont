-- =====================================================================
-- SISCONT - 020: Fiscal responsável pelo contrato Extra-MB
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 019 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
-- =====================================================================
alter table public.contratos add column if not exists fiscal_nome text;
alter table public.contratos add column if not exists fiscal_setor text;
alter table public.contratos add column if not exists fiscal_email text;
alter table public.contratos add column if not exists fiscal_telefone text;
