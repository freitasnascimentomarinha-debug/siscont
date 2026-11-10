-- 029 — Histórico da OM com data de vigência (mudança de nome, UG, comando ou setor)
-- Idempotente e sem DROP (pode rodar mais de uma vez). Rode no SQL Editor do Supabase.
--
--  1. oms.codigos_anteriores: UGs que a OM já teve (a importação do SIPLAD e das planilhas continua achando a OM);
--  2. om_historico: uma linha por campo alterado, com a data em que a mudança passou a valer, o ato e o motivo;
--  3. received_documents.om_id: a ALTCRED/GRU passa a apontar para a OM (não só para o nome em texto);
--  4. om_alterar_dados(): grava a mudança, guarda o nome/UG antigos e registra o histórico — permitido a quem grava
--     (operador e administrador). Fatura emitida NÃO é reescrita: o número e o texto da época ficam como saíram.

-- 1 e 3. colunas ----------------------------------------------------------------
alter table public.oms add column if not exists nomes_alternativos text[] not null default '{}';   -- já criada pelo 012
alter table public.oms add column if not exists codigos_anteriores text[] not null default '{}';
alter table public.received_documents add column if not exists om_id uuid references public.oms (id) on delete set null;
create index if not exists received_documents_om_idx on public.received_documents (om_id);

-- documentos já cadastrados: liga à OM quando o nome (ou um nome alternativo) aponta para UMA só OM
update public.received_documents d
   set om_id = x.om
  from (
    select d2.id as doc, (array_agg(o.id order by o.ativo desc))[1] as om, count(distinct o.id) as n
      from public.received_documents d2
      join public.oms o
        on lower(trim(o.nome)) = lower(trim(d2.client))
        or lower(trim(d2.client)) in (select lower(trim(a)) from unnest(coalesce(o.nomes_alternativos, '{}')) a)
     where d2.om_id is null
     group by d2.id
  ) x
 where d.id = x.doc and x.n = 1;

-- 2. histórico ---------------------------------------------------------------------
create table if not exists public.om_historico (
  id uuid primary key default gen_random_uuid(),
  om_id uuid not null references public.oms (id) on delete cascade,
  campo text not null check (campo in ('nome', 'codigo', 'comando_id', 'setor_id', 'sigla')),
  valor_anterior text,
  valor_novo text,
  rotulo_anterior text,
  rotulo_novo text,
  vigente_desde date not null,
  motivo text,
  ato text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists om_historico_om_idx on public.om_historico (om_id, vigente_desde);

alter table public.om_historico enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'om_historico' and policyname = 'om_historico_select') then
    create policy om_historico_select on public.om_historico for select to authenticated using (public.is_active_user());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'om_historico' and policyname = 'om_historico_insert') then
    create policy om_historico_insert on public.om_historico for insert to authenticated with check (public.can_write());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'om_historico' and policyname = 'om_historico_update') then
    create policy om_historico_update on public.om_historico for update to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'om_historico' and policyname = 'om_historico_delete') then
    create policy om_historico_delete on public.om_historico for delete to authenticated using (public.is_admin());
  end if;
end $$;

-- 4. alterar os dados da OM com vigência ------------------------------------------------
-- p_* nulo = não muda. Devolve quantos campos mudaram. Vigência: hoje ou no passado (mudança que já entrou em vigor).
create or replace function public.om_alterar_dados(
  p_om uuid, p_nome text, p_codigo text, p_comando uuid, p_setor uuid, p_sigla text,
  p_vigencia date, p_motivo text, p_ato text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  o record; n integer := 0;
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
  v_codigo text := nullif(trim(coalesce(p_codigo, '')), '');
  v_sigla text := nullif(trim(coalesce(p_sigla, '')), '');
  v_rot_ant text; v_rot_novo text;
begin
  if not public.can_write() then raise exception 'Sem permissão para alterar dados de OM.'; end if;
  if p_vigencia is null then raise exception 'Informe a data em que a mudança passou a valer.'; end if;
  if p_vigencia > current_date then raise exception 'A vigência não pode ser futura: registre quando a mudança entrar em vigor.'; end if;
  select * into o from public.oms where id = p_om;
  if not found then raise exception 'OM não encontrada.'; end if;

  if v_nome is not null and v_nome <> o.nome then
    insert into public.om_historico (om_id, campo, valor_anterior, valor_novo, rotulo_anterior, rotulo_novo, vigente_desde, motivo, ato)
    values (p_om, 'nome', o.nome, v_nome, o.nome, v_nome, p_vigencia, p_motivo, p_ato);
    update public.oms
       set nome = v_nome,
           nomes_alternativos = (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(nomes_alternativos, '{}') || array[o.nome]) x where x is not null and x <> v_nome)
     where id = p_om;
    n := n + 1;
  end if;

  if v_codigo is not null and v_codigo <> o.codigo then
    if v_codigo !~ '^\d{4,6}$' then raise exception 'A UG deve ter de 4 a 6 dígitos.'; end if;
    insert into public.om_historico (om_id, campo, valor_anterior, valor_novo, rotulo_anterior, rotulo_novo, vigente_desde, motivo, ato)
    values (p_om, 'codigo', o.codigo, v_codigo, o.codigo, v_codigo, p_vigencia, p_motivo, p_ato);
    update public.oms
       set codigo = v_codigo, codigo_proprio = true,
           codigos_anteriores = (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(codigos_anteriores, '{}') || array[o.codigo]) x where x is not null and x <> v_codigo)
     where id = p_om;
    n := n + 1;
  end if;

  if p_comando is not null and p_comando is distinct from o.comando_id then
    select coalesce(codigo || ' - ', '') || nome into v_rot_ant from public.comandos where id = o.comando_id;
    select coalesce(codigo || ' - ', '') || nome into v_rot_novo from public.comandos where id = p_comando;
    if v_rot_novo is null then raise exception 'Comando não encontrado.'; end if;
    insert into public.om_historico (om_id, campo, valor_anterior, valor_novo, rotulo_anterior, rotulo_novo, vigente_desde, motivo, ato)
    values (p_om, 'comando_id', o.comando_id::text, p_comando::text, v_rot_ant, v_rot_novo, p_vigencia, p_motivo, p_ato);
    update public.oms set comando_id = p_comando where id = p_om;
    n := n + 1;
  end if;

  if p_setor is not null and p_setor is distinct from o.setor_id then
    select sigla into v_rot_ant from public.setores where id = o.setor_id;
    select sigla into v_rot_novo from public.setores where id = p_setor;
    if v_rot_novo is null then raise exception 'Setor não encontrado.'; end if;
    insert into public.om_historico (om_id, campo, valor_anterior, valor_novo, rotulo_anterior, rotulo_novo, vigente_desde, motivo, ato)
    values (p_om, 'setor_id', o.setor_id::text, p_setor::text, v_rot_ant, v_rot_novo, p_vigencia, p_motivo, p_ato);
    update public.oms set setor_id = p_setor where id = p_om;
    n := n + 1;
  end if;

  if v_sigla is not null and v_sigla is distinct from o.sigla then
    insert into public.om_historico (om_id, campo, valor_anterior, valor_novo, rotulo_anterior, rotulo_novo, vigente_desde, motivo, ato)
    values (p_om, 'sigla', o.sigla, v_sigla, o.sigla, v_sigla, p_vigencia, p_motivo, p_ato);
    update public.oms set sigla = v_sigla where id = p_om;
    n := n + 1;
  end if;

  if n = 0 then raise exception 'Nada mudou: informe o novo nome, UG, comando, setor ou sigla.'; end if;
  return n;
end $$;
