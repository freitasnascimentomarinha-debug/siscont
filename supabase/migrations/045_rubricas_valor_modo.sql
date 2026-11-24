-- 045 — Valor da rubrica: digitado OU pela soma dos subsídios (idempotente)
-- DIGITADO  = o valor previsto é o que a pessoa digita (os subsídios ficam só como justificativa).
-- SUBSIDIOS = o valor previsto passa a ser a soma dos subsídios da rubrica e acompanha qualquer inclusão, troca ou exclusão.
alter table public.rubricas add column if not exists valor_modo text not null default 'DIGITADO';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rubricas_valor_modo_ck') then
    alter table public.rubricas add constraint rubricas_valor_modo_ck check (valor_modo in ('DIGITADO', 'SUBSIDIOS'));
  end if;
end $$;
