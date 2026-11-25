-- 046 — Responsável pela rubrica (quem envia o subsídio / atualização da taxa). Idempotente.
alter table public.rubricas add column if not exists responsavel text;
