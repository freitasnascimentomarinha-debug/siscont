-- =====================================================================
-- SISCONT - 034: Meses sem movimento e apuração anual do OND (Fase D do faturamento de fim de exercício)
-- ---------------------------------------------------------------------
-- Executar no SQL Editor (New query > colar > Run). Idempotente, sem DROP e sem alterar faturas.
--
--  1. meses_sem_movimento: o mês JAN–AGO (média da estimativa) ou OUT–DEZ (acerto) em que a OM não teve consumo daquele serviço.
--     Só com essa marca o mês vale ZERO; ausência de fatura ou de subsídio sem marca é pendência (nunca se presume consumo zero).
--  2. apuracoes_ond: uma apuração por OM, serviço e exercício (índice único). Guarda o estimado, o real, a diferença, o resultado
--     (débito complementar, crédito ou sem diferença), a memória de cálculo, o responsável e a data. Não se apaga: cancela-se com motivo.
-- =====================================================================
create table if not exists public.meses_sem_movimento (
  id uuid primary key default gen_random_uuid(),
  om_id uuid not null references public.oms (id) on delete restrict,
  sigla text not null,
  ano integer not null check (ano between 2000 and 2100),
  mes integer not null check (mes between 1 and 12),
  motivo text,
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  unique (om_id, sigla, ano, mes)
);
create index if not exists meses_sem_movimento_ano_idx on public.meses_sem_movimento (ano, sigla);

create or replace function public.preencher_autor_034() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.criado_por is null then new.criado_por := auth.uid(); end if;
  if new.criado_por_nome is null and new.criado_por is not null then
    select coalesce(nullif(name, ''), email) into new.criado_por_nome from public.profiles where id = new.criado_por;
  end if;
  return new;
end $$;
drop trigger if exists meses_sem_movimento_autor_trg on public.meses_sem_movimento;
create trigger meses_sem_movimento_autor_trg before insert on public.meses_sem_movimento for each row execute function public.preencher_autor_034();

alter table public.meses_sem_movimento enable row level security;
drop policy if exists meses_sem_movimento_select on public.meses_sem_movimento;
create policy meses_sem_movimento_select on public.meses_sem_movimento for select to authenticated using (public.is_active_user());
drop policy if exists meses_sem_movimento_insert on public.meses_sem_movimento;
create policy meses_sem_movimento_insert on public.meses_sem_movimento for insert to authenticated with check (public.can_write());
drop policy if exists meses_sem_movimento_delete on public.meses_sem_movimento;
create policy meses_sem_movimento_delete on public.meses_sem_movimento for delete to authenticated using (public.can_write());

create table if not exists public.apuracoes_ond (
  id uuid primary key default gen_random_uuid(),
  om_id uuid not null references public.oms (id) on delete restrict,
  sigla text not null,
  exercicio integer not null check (exercicio between 2000 and 2100),
  estimada_numero text,
  estimado numeric(14, 2) not null,
  real numeric(14, 2) not null,
  diferenca numeric(14, 2) not null,
  resultado text not null check (resultado in ('DEBITO', 'CREDITO', 'SEM_DIFERENCA')),
  acerto_numero text,
  lote_id uuid,
  memoria jsonb,
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  cancelada_em timestamptz,
  cancelada_motivo text,
  cancelada_por_nome text,
  check (cancelada_em is null or cancelada_motivo is not null)
);
-- uma apuração válida por OM, serviço e exercício: impede processar o mesmo acerto duas vezes
create unique index if not exists apuracoes_ond_uk on public.apuracoes_ond (om_id, sigla, exercicio) where cancelada_em is null;
create index if not exists apuracoes_ond_lote_idx on public.apuracoes_ond (lote_id);

drop trigger if exists apuracoes_ond_autor_trg on public.apuracoes_ond;
create trigger apuracoes_ond_autor_trg before insert on public.apuracoes_ond for each row execute function public.preencher_autor_034();

-- só os campos de cancelamento podem mudar; apagar nunca
create or replace function public.apuracoes_ond_guarda() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'A apuração não pode ser apagada: cancele-a informando o motivo.'; end if;
  if (to_jsonb(new) - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por_nome') <> (to_jsonb(old) - 'cancelada_em' - 'cancelada_motivo' - 'cancelada_por_nome') then
    raise exception 'Só o cancelamento da apuração pode ser registrado; os valores apurados não mudam.';
  end if;
  if new.cancelada_em is not null and new.cancelada_por_nome is null then
    select coalesce(nullif(name, ''), email) into new.cancelada_por_nome from public.profiles where id = auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists apuracoes_ond_guarda_trg on public.apuracoes_ond;
create trigger apuracoes_ond_guarda_trg before update or delete on public.apuracoes_ond for each row execute function public.apuracoes_ond_guarda();

alter table public.apuracoes_ond enable row level security;
drop policy if exists apuracoes_ond_select on public.apuracoes_ond;
create policy apuracoes_ond_select on public.apuracoes_ond for select to authenticated using (public.is_active_user());
drop policy if exists apuracoes_ond_insert on public.apuracoes_ond;
create policy apuracoes_ond_insert on public.apuracoes_ond for insert to authenticated with check (public.can_write());
drop policy if exists apuracoes_ond_update on public.apuracoes_ond;
-- operador desfaz a apuração de um lote que falhou; o cancelamento por outro motivo é do administrador
create policy apuracoes_ond_update on public.apuracoes_ond for update to authenticated
  using (public.can_write() and cancelada_em is null)
  with check (cancelada_em is not null and (cancelada_motivo = 'Emissão do lote desfeita' or public.is_admin()));

do $$
begin
  if to_regprocedure('public.registrar_auditoria()') is not null then
    drop trigger if exists meses_sem_movimento_auditoria on public.meses_sem_movimento;
    create trigger meses_sem_movimento_auditoria after insert or delete on public.meses_sem_movimento for each row execute function public.registrar_auditoria();
    drop trigger if exists apuracoes_ond_auditoria on public.apuracoes_ond;
    create trigger apuracoes_ond_auditoria after insert or update on public.apuracoes_ond for each row execute function public.registrar_auditoria();
  end if;
end $$;

select (select count(*) from public.meses_sem_movimento) as meses_sem_movimento, (select count(*) from public.apuracoes_ond) as apuracoes;
