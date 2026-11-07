-- =====================================================================
-- SISCONT - 005: Pontos de atenção em faturas e documentos
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 004 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
-- O sistema calcula sozinho as inconsistências (pago a maior, ALTCRED
-- estourada, vencimento antes da emissão...). Esta coluna guarda:
--   - os pontos que só a migração das planilhas conhece (vencimento
--     recalculado, valor diferente do livro de emissão, baixa para fatura
--     inexistente...);
--   - quem marcou um ponto como resolvido/ciente, quando e por quê.
-- Formato: lista JSON de {tipo, mensagem, origem, em, resolvido,
--          resolvidoEm, resolvidoPor, justificativa}.
-- =====================================================================

alter table public.invoices add column if not exists pontos_atencao jsonb not null default '[]'::jsonb;
alter table public.received_documents add column if not exists pontos_atencao jsonb not null default '[]'::jsonb;

-- Consulta rápida das faturas/documentos com pontos registrados ainda pendentes
create index if not exists invoices_pontos_idx on public.invoices using gin (pontos_atencao);
create index if not exists received_documents_pontos_idx on public.received_documents using gin (pontos_atencao);
