-- =====================================================================
-- SISCONT - 021: Taxa condominial — outros gastos, parte dos navios e edifício da OM
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 020 (SQL Editor > New query > colar > Run). Idempotente.
--
--  1. Destino 'OG' (outros gastos, ex.: linhas 34 a 37): não são rubricas, mas entram no total
--     rateado entre as OM da taxa. Cada linha pode entrar ou não na taxa (TC/OG × PAR).
--  2. rateio_todas: a linha é rateada entre TODAS as OM da taxa (true) ou só entre as marcadas
--     na matriz (false).
--  3. Parte dos navios (diária de atracação) por linha: navios_modo = NAO | INTEGRAL | PERCENTUAL
--     | FIXO, sobre o valor da linha (previsto − desconto geral, ou só o previsto: base_navios da
--     proposta), SEM descontar a parte das OM. valor_navios = valor fixo.
--  4. Edifício onde a OM está (cadastro).
-- =====================================================================
alter table public.rubricas drop constraint if exists rubricas_destino_ck;
alter table public.rubricas add constraint rubricas_destino_ck check (destino in ('TC', 'DA', 'PAR', 'OG'));

alter table public.rubricas add column if not exists rateio_todas boolean not null default false;
alter table public.rubricas add column if not exists navios_modo text not null default 'NAO';
alter table public.rubricas add column if not exists valor_navios numeric check (valor_navios is null or valor_navios >= 0);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rubricas_navios_modo_ck') then
    alter table public.rubricas add constraint rubricas_navios_modo_ck check (navios_modo in ('NAO', 'INTEGRAL', 'PERCENTUAL', 'FIXO'));
  end if;
end $$;

alter table public.propostas_tc add column if not exists base_navios text not null default 'VIGENTE';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'propostas_tc_base_navios_ck') then
    alter table public.propostas_tc add constraint propostas_tc_base_navios_ck check (base_navios in ('VIGENTE', 'PREVISTO'));
  end if;
end $$;

-- dados existentes: % dos navios vira o modo PERCENTUAL; linhas 34 a 37 viram "outros gastos" rateados entre todas
update public.rubricas set navios_modo = 'PERCENTUAL' where coalesce(percentual_navios, 0) > 0 and navios_modo = 'NAO';
update public.rubricas set destino = 'OG', rateio_todas = true where numero between 34 and 37 and destino in ('TC', 'PAR');

alter table public.oms add column if not exists edificio text;
