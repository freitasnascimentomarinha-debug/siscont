-- 047 — Rubrica sem orçamento no ano (diferente de rubrica que ainda aguarda o subsídio). Idempotente.
alter table public.rubricas add column if not exists zero_confirmado boolean not null default false;
