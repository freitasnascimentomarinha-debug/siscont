-- =====================================================================
-- SISCONT - 033: Livro de créditos por OM (Fase B do faturamento de fim de exercício)
-- ---------------------------------------------------------------------
-- Executar no SQL Editor (New query > colar > Run). Idempotente, sem DROP e sem alterar faturas:
-- pode ser executado de novo. O livro nasce ZERADO (hoje não há acerto emitido nem crédito usado).
--
-- O crédito pertence à OM (qualquer serviço dela pode usá-lo). Cada movimento é uma linha que NUNCA é alterada nem apagada:
--   ENTRADA_ACERTO  (+) crédito gerado por uma fatura de acerto (real menor que o estimado)
--   ABERTURA        (+) saldo de abertura lançado pelo administrador (crédito de acertos anteriores ao SISCONT)
--   UTILIZACAO      (−) crédito abatido numa fatura (linha 04), do mais antigo para o mais novo (FIFO)
--   DEVOLUCAO       (−) crédito devolvido à OM (ALTCRED/GRU)
--   ESTORNO         linha de sinal contrário que desfaz um movimento (fatura cancelada, lançamento errado)
-- Toda saída aponta para o crédito de origem (credito_ref): a origem de cada pedaço fica identificada.
-- =====================================================================
create table if not exists public.creditos_om (
  id uuid primary key default gen_random_uuid(),
  om_id uuid not null references public.oms (id) on delete restrict,
  data date not null default current_date,
  tipo text not null check (tipo in ('ENTRADA_ACERTO', 'ABERTURA', 'UTILIZACAO', 'DEVOLUCAO', 'ESTORNO')),
  valor numeric(14, 2) not null check (valor <> 0),
  servico_origem text,
  exercicio_origem integer,
  origem_numero text,            -- fatura de acerto que gerou o crédito
  origem_chave text,             -- o mesmo número sem a versão final (-0 / -1)
  destino_numero text,           -- fatura em que o crédito foi usado
  destino_id uuid,
  credito_ref uuid references public.creditos_om (id),
  estorno_de uuid references public.creditos_om (id),
  documento text,                -- ALTCRED/GRU da devolução ou documento do saldo de abertura
  observacao text,
  lote_id uuid,
  saldo_anterior numeric(14, 2),
  saldo_posterior numeric(14, 2),
  criado_por uuid default auth.uid(),
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  check ((tipo in ('ENTRADA_ACERTO', 'ABERTURA') and valor > 0 and credito_ref is null and estorno_de is null)
      or (tipo in ('UTILIZACAO', 'DEVOLUCAO') and valor < 0 and credito_ref is not null and estorno_de is null)
      or (tipo = 'ESTORNO' and credito_ref is not null and estorno_de is not null)),
  check (tipo <> 'UTILIZACAO' or destino_numero is not null),
  check (tipo <> 'ENTRADA_ACERTO' or origem_chave is not null)
);
create index if not exists creditos_om_om_idx on public.creditos_om (om_id, criado_em);
create index if not exists creditos_om_ref_idx on public.creditos_om (credito_ref);
create index if not exists creditos_om_destino_idx on public.creditos_om (destino_numero);
-- um acerto gera um crédito só; um movimento só é estornado uma vez; a mesma fatura não usa o mesmo crédito duas vezes
create unique index if not exists creditos_om_entrada_uk on public.creditos_om (origem_chave) where tipo = 'ENTRADA_ACERTO';
create unique index if not exists creditos_om_estorno_uk on public.creditos_om (estorno_de) where tipo = 'ESTORNO';
create unique index if not exists creditos_om_uso_uk on public.creditos_om (credito_ref, destino_numero) where tipo = 'UTILIZACAO';

-- Validação de cada movimento. A linha da OM é travada enquanto o movimento é gravado: duas emissões ao mesmo tempo
-- não usam o mesmo saldo (a segunda espera e, se o saldo acabou, é recusada).
create or replace function public.creditos_om_validar() returns trigger language plpgsql security definer set search_path = public as $$
declare ent record; ref record; saldo numeric; resta numeric;
begin
  perform 1 from public.oms where id = new.om_id for update;
  if new.tipo in ('UTILIZACAO', 'DEVOLUCAO', 'ESTORNO') then
    select * into ent from public.creditos_om where id = new.credito_ref;
    if not found or ent.tipo not in ('ENTRADA_ACERTO', 'ABERTURA') then raise exception 'Crédito de origem inválido.'; end if;
    if ent.om_id <> new.om_id then raise exception 'O crédito pertence a outra OM: não é possível transferir crédito entre OMs.'; end if;
  end if;
  if new.tipo = 'ESTORNO' then
    select * into ref from public.creditos_om where id = new.estorno_de;
    if not found or ref.tipo = 'ESTORNO' or ref.om_id <> new.om_id then raise exception 'Estorno inválido: só se estorna um movimento da mesma OM, e uma vez.'; end if;
    if new.valor <> -ref.valor then raise exception 'O estorno deve ter o mesmo valor do movimento estornado, com o sinal contrário.'; end if;
    if new.credito_ref <> (case when ref.tipo in ('ENTRADA_ACERTO', 'ABERTURA') then ref.id else ref.credito_ref end) then raise exception 'Estorno ligado a outro crédito.'; end if;
    if new.destino_numero is null then new.destino_numero := ref.destino_numero; end if;
  end if;
  select coalesce(sum(valor), 0) into saldo from public.creditos_om where om_id = new.om_id;
  new.saldo_anterior := saldo; new.saldo_posterior := saldo + new.valor;
  if new.saldo_posterior < 0 then raise exception 'Saldo de crédito insuficiente (saldo R$ %, movimento R$ %).', saldo, new.valor; end if;
  if new.credito_ref is not null then
    select e.valor + coalesce((select sum(m.valor) from public.creditos_om m where m.credito_ref = e.id), 0) into resta from public.creditos_om e where e.id = new.credito_ref;
    if resta + new.valor < 0 then raise exception 'O crédito de origem não tem saldo suficiente (já utilizado ou devolvido).'; end if;
  end if;
  if new.criado_por is null then new.criado_por := auth.uid(); end if;
  if new.criado_por_nome is null and new.criado_por is not null then
    select coalesce(nullif(name, ''), email) into new.criado_por_nome from public.profiles where id = new.criado_por;
  end if;
  return new;
end $$;
drop trigger if exists creditos_om_validar_trg on public.creditos_om;
create trigger creditos_om_validar_trg before insert on public.creditos_om for each row execute function public.creditos_om_validar();

create or replace function public.creditos_om_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'O livro de créditos não pode ser alterado nem apagado: registre um estorno.';
end $$;
drop trigger if exists creditos_om_imutavel_trg on public.creditos_om;
create trigger creditos_om_imutavel_trg before update or delete on public.creditos_om for each row execute function public.creditos_om_imutavel();

alter table public.creditos_om enable row level security;
drop policy if exists creditos_om_select on public.creditos_om;
create policy creditos_om_select on public.creditos_om for select to authenticated using (public.is_active_user());
drop policy if exists creditos_om_insert on public.creditos_om;
-- operador e administrador lançam; o saldo de abertura é só do administrador
create policy creditos_om_insert on public.creditos_om for insert to authenticated with check (public.can_write() and (tipo <> 'ABERTURA' or public.is_admin()));

do $$
begin
  if to_regprocedure('public.registrar_auditoria()') is not null then
    drop trigger if exists creditos_om_auditoria on public.creditos_om;
    create trigger creditos_om_auditoria after insert on public.creditos_om for each row execute function public.registrar_auditoria();
  end if;
end $$;

-- Conferência: o livro começa zerado
select count(*) as movimentos, coalesce(sum(valor), 0) as saldo_total from public.creditos_om;
