-- 044 — ALTCRED com pendência (algo a verificar). Idempotente.
-- Enquanto received_documents.pendencia tiver texto, o crédito fica fora do saldo, das baixas e do fluxo de caixa; resolver = limpar o campo.
alter table public.received_documents add column if not exists pendencia text;
