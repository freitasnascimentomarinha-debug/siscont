-- =====================================================================
-- SISCONT - 032: Regime de fim de exercício (OND) por serviço, com exceções por OM
-- ---------------------------------------------------------------------
-- Executar no SQL Editor (New query > colar > Run). Idempotente, sem DROP:
-- pode ser executado de novo sem duplicar nada. NÃO altera faturas, valores,
-- créditos nem exercícios anteriores: só cria o cadastro dos regimes.
--
--  Regime 1: estimativa de outubro (OUT-DEZ) + acerto em janeiro
--  Regime 2: faturamento mensal normal em out, nov e dez (sem estimativa)
--  Regime 3: não participa da estimativa nem do acerto
--
-- Duas camadas, ambas por exercício de início da vigência:
--   escopo SERVICO: regra geral do serviço (vale para todas as OMs que o têm)
--   escopo OM:      exceção de uma OM (regime nulo = volta a seguir a regra do serviço)
-- A tabela só recebe linhas novas (histórico): não há UPDATE nem DELETE.
-- Valor para um exercício = a linha mais recente cujo ano_inicio é <= ao exercício.
-- =====================================================================
create table if not exists public.regime_ond (
  id uuid primary key default gen_random_uuid(),
  escopo text not null check (escopo in ('SERVICO', 'OM')),
  sigla text not null,
  om_id uuid references public.oms (id) on delete restrict,
  ano_inicio integer not null check (ano_inicio between 2000 and 2100),
  regime integer check (regime in (1, 2, 3)),
  motivo text,
  origem text not null default 'USUARIO' check (origem in ('USUARIO', 'MIGRACAO')),
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  check ((escopo = 'SERVICO' and om_id is null and regime is not null) or (escopo = 'OM' and om_id is not null))
);
create index if not exists regime_ond_sigla_idx on public.regime_ond (sigla, ano_inicio);
create index if not exists regime_ond_om_idx on public.regime_ond (om_id);
-- a carga inicial não se repete (rodar o script de novo não duplica)
create unique index if not exists regime_ond_migracao_uk on public.regime_ond (escopo, sigla, coalesce(om_id, '00000000-0000-0000-0000-000000000000'::uuid), ano_inicio) where origem = 'MIGRACAO';

-- quem registrou (nome do perfil) e proteção contra alteração/exclusão do que já foi gravado
create or replace function public.regime_ond_preencher() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.criado_por is null then new.criado_por := auth.uid(); end if;
  if new.criado_por_nome is null and new.criado_por is not null then
    select coalesce(nullif(name, ''), email) into new.criado_por_nome from public.profiles where id = new.criado_por;
  end if;
  return new;
end $$;
drop trigger if exists regime_ond_preencher_trg on public.regime_ond;
create trigger regime_ond_preencher_trg before insert on public.regime_ond for each row execute function public.regime_ond_preencher();

create or replace function public.regime_ond_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'O histórico dos regimes não pode ser alterado nem apagado: registre uma nova linha com o novo regime.';
end $$;
drop trigger if exists regime_ond_imutavel_trg on public.regime_ond;
create trigger regime_ond_imutavel_trg before update or delete on public.regime_ond for each row execute function public.regime_ond_imutavel();

alter table public.regime_ond enable row level security;
drop policy if exists regime_ond_select on public.regime_ond;
create policy regime_ond_select on public.regime_ond for select to authenticated using (public.is_active_user());
drop policy if exists regime_ond_insert on public.regime_ond;
create policy regime_ond_insert on public.regime_ond for insert to authenticated with check (public.can_write());

-- trilha de auditoria
do $$
begin
  if to_regprocedure('public.registrar_auditoria()') is not null then
    drop trigger if exists regime_ond_auditoria on public.regime_ond;
    create trigger regime_ond_auditoria after insert on public.regime_ond for each row execute function public.registrar_auditoria();
  end if;
end $$;

-- =====================================================================
-- Configuração inicial (vigência 2026): reproduz o que foi faturado em 2025
-- =====================================================================
-- 1. Regra geral por serviço
insert into public.regime_ond (escopo, sigla, ano_inicio, regime, motivo, origem)
select 'SERVICO', v.sigla, 2026, v.regime, 'Configuração inicial: comportamento de 2025', 'MIGRACAO'
  from (values ('AE', 1), ('EL', 1), ('CR', 1), ('TC', 1), ('DA', 1), ('AL', 2), ('VT', 3), ('RB', 3)) as v (sigla, regime)
 where exists (select 1 from public.service_definitions s where upper(s.acronym) = v.sigla)
   and not exists (select 1 from public.regime_ond r where r.escopo = 'SERVICO' and r.sigla = v.sigla and r.ano_inicio = 2026 and r.origem = 'MIGRACAO');
-- TL, EX e demais serviços ficam sem regra: o faturamento segue como hoje até alguém definir.

-- 2. Exceções por OM: a OM que em 2025 teve o padrão diferente da regra do serviço
--    padrão 2025: R1 = fatura em outubro e nenhuma em nov/dez; R2 = out, nov e dez; R3 = nenhuma em out-dez (mas faturou jan-set)
with base as (
  select i.om_id, i.service_acronym as sigla,
         bool_or(i.month_competence = 10) as o, bool_or(i.month_competence = 11) as n, bool_or(i.month_competence = 12) as d,
         bool_or(i.month_competence between 1 and 9) as js
    from public.invoices i
   where not coalesce(i.is_canceled, false) and i.om_id is not null and i.acerto_de is null and i.year_competence = 2025
   group by 1, 2
), padrao as (
  select om_id, sigla,
         case when o and not n and not d then 1 when o and n and d then 2 when not o and not n and not d and js then 3 else null end as p
    from base
)
insert into public.regime_ond (escopo, sigla, om_id, ano_inicio, regime, motivo, origem)
select 'OM', p.sigla, p.om_id, 2026, p.p, 'Configuração inicial: em 2025 seguiu o regime ' || p.p || ' (diferente da regra do serviço)', 'MIGRACAO'
  from padrao p
  join public.regime_ond g on g.escopo = 'SERVICO' and g.sigla = p.sigla and g.ano_inicio = 2026 and g.origem = 'MIGRACAO'
 where p.p is not null and p.p <> g.regime
   and not (p.sigla = 'RB' and p.p = 1)        -- RB não participa: fatura em outubro é faturamento normal (fica "a conferir")
   and not exists (select 1 from public.regime_ond r where r.escopo = 'OM' and r.sigla = p.sigla and r.om_id = p.om_id and r.ano_inicio = 2026 and r.origem = 'MIGRACAO');

-- Conferência: quantas linhas por serviço e regime
select escopo, sigla, regime, count(*) as linhas from public.regime_ond where origem = 'MIGRACAO' group by 1, 2, 3 order by 1, 2, 3;
