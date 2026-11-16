-- 043 — Arquivos anexados direto à fatura (além dos da contestação). Idempotente.
-- A lista (nome, caminho, tamanho) fica em invoices.anexos (jsonb); os arquivos usam o mesmo espaço privado do script 042 (anexos-contestacao).
alter table public.invoices add column if not exists anexos jsonb not null default '[]'::jsonb;
