-- =====================================================================
-- SISCONT - 016: Unificar sem guardar o nome duplicado
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 014 (SQL Editor > New query > colar > Run).
-- Substitui o 015: quem ainda não rodou o 015 pode rodar só este.
-- Idempotente: pode ser executado novamente.
--
--  1/2. Unificar passa tudo do duplicado para a OM que fica, corrige o
--       nome do cliente nas faturas para o nome da OM que fica e EXCLUI
--       o duplicado. O nome duplicado NÃO é mais guardado como nome
--       alternativo.
--  3.   Conclui os unificados antigos ("Unificada com ...") do mesmo jeito.
--  4.   Tira dos "outros nomes" das OM os nomes que vieram de
--       unificações anteriores e corrige o nome nas faturas.
-- A exclusão fica registrada na trilha de auditoria.
-- =====================================================================

-- 1. Trava de exclusão: fatura ligada pelo om_id; sem ligação, pelo código + nome
create or replace function public.om_tem_movimento(p_om_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invoices i where i.om_id = p_om_id)
      or exists (
        select 1
          from public.oms o
          join public.invoices i
            on i.om_id is null
           and trim(coalesce(i.ug, '')) = o.codigo
           and lower(trim(i.client)) = lower(trim(o.nome))
         where o.id = p_om_id);
$$;

-- 2. Rotina da unificação (sem checagem de perfil; usada pela função pública e pela limpeza)
create or replace function public.siscont_unificar_om_exec(p_manter uuid, p_remover uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  fk record; r record; n integer := 0; v_nome text; v_codigo text; v_manter text;
begin
  if p_manter = p_remover then raise exception 'Escolha duas OM diferentes.'; end if;
  select nome into v_manter from public.oms where id = p_manter;
  select nome, codigo into v_nome, v_codigo from public.oms where id = p_remover;
  if v_manter is null or v_nome is null then raise exception 'OM não encontrada.'; end if;

  -- faturas antigas sem ligação, do duplicado (pelo código + nome): passam a ser da OM que fica
  update public.invoices i set om_id = p_manter
   where i.om_id is null and trim(coalesce(i.ug, '')) = v_codigo and lower(trim(i.client)) = lower(trim(v_nome));

  -- todas as tabelas que apontam para a OM
  for fk in
    select cl.relname as tabela, a.attname as coluna
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.oms'::regclass and ns.nspname = 'public'
       and array_length(c.conkey, 1) = 1
  loop
    for r in execute format('select ctid from public.%I where %I = $1', fk.tabela, fk.coluna) using p_remover loop
      begin
        execute format('update public.%I set %I = $1 where ctid = $2', fk.tabela, fk.coluna) using p_manter, r.ctid;
        n := n + 1;
      exception when unique_violation then
        execute format('delete from public.%I where ctid = $1', fk.tabela) using r.ctid;
      end;
    end loop;
  end loop;

  -- nome do cliente nas faturas: o da OM que fica (o número da fatura e a UG continuam os emitidos)
  update public.invoices set client = v_manter
   where om_id = p_manter and lower(trim(client)) = lower(trim(v_nome)) and client is distinct from v_manter;

  -- o nome duplicado NÃO fica guardado: os dados passam a usar só o nome da OM que fica

  -- exclui o duplicado; se algo ainda o prender, fica desativado (como antes)
  begin
    delete from public.oms where id = p_remover;
  exception when others then
    update public.oms set ativo = false, desativado_em = coalesce(desativado_em, current_date), motivo_desativacao = 'Unificada com ' || v_manter
     where id = p_remover;
  end;
  return n;
end $$;
revoke all on function public.siscont_unificar_om_exec(uuid, uuid) from public;
revoke all on function public.siscont_unificar_om_exec(uuid, uuid) from authenticated;

create or replace function public.unificar_om(p_manter uuid, p_remover uuid) returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Somente o administrador unifica cadastros.'; end if;
  return public.siscont_unificar_om_exec(p_manter, p_remover);
end $$;

-- 3. Limpeza dos já unificados: acha a OM que ficou pelo nome gravado no motivo
do $$
declare d record; v_manter uuid; total integer := 0;
begin
  for d in
    select id, nome, codigo, trim(substring(motivo_desativacao from '(?i)^unificada com (.*)$')) as alvo
      from public.oms
     where ativo = false and motivo_desativacao ~* '^unificada com '
  loop
    select id into v_manter from public.oms
     where ativo and nome = d.alvo and id <> d.id
     order by (codigo = d.codigo) desc limit 1;
    if v_manter is null then
      select id into v_manter from public.oms where ativo and lower(nome) = lower(d.alvo) and id <> d.id limit 1;
    end if;
    if v_manter is not null then
      perform public.siscont_unificar_om_exec(v_manter, d.id);
      total := total + 1;
    else
      raise notice 'Não achei a OM ativa "%" para concluir a unificação de % - % (ficou desativada).', d.alvo, d.codigo, d.nome;
    end if;
  end loop;
  raise notice 'Cadastros unificados excluídos: %', total;
end $$;

-- 4. Nomes que vieram de unificações (cadastros excluídos ou "Unificada com ..."):
--    saem dos "outros nomes" e as faturas passam a usar o nome da OM que ficou
do $$
declare n_alt integer; n_fat integer;
begin
  create temp table if not exists _nomes_unificados (nome text primary key) on commit drop;
  insert into _nomes_unificados
  select distinct lower(trim(a.antes ->> 'nome'))
    from public.auditoria a
   where a.tabela = 'oms' and a.acao = 'DELETE' and coalesce(a.antes ->> 'nome', '') <> ''
     and not exists (select 1 from public.oms o where lower(trim(o.nome)) = lower(trim(a.antes ->> 'nome')))
  on conflict do nothing;

  update public.invoices i set client = o.nome
    from public.oms o
   where i.om_id = o.id and i.client is distinct from o.nome
     and (lower(trim(i.client)) in (select nome from _nomes_unificados) or lower(trim(i.client)) = lower(trim(o.nome)));
  get diagnostics n_fat = row_count;

  update public.oms o
     set nomes_alternativos = coalesce((select array_agg(x) from unnest(o.nomes_alternativos) x
                                         where lower(trim(x)) not in (select nome from _nomes_unificados)
                                           and lower(trim(x)) <> lower(trim(o.nome))), '{}')
   where exists (select 1 from unnest(coalesce(o.nomes_alternativos, '{}')) x
                  where lower(trim(x)) in (select nome from _nomes_unificados) or lower(trim(x)) = lower(trim(o.nome)));
  get diagnostics n_alt = row_count;
  raise notice 'Faturas com o nome corrigido: % · OM com "outros nomes" limpos: %', n_fat, n_alt;
end $$;

-- Resultado: desativados que sobraram (devem ser só os desativados de verdade, como navios)
select tipo, codigo, nome, desativado_em, motivo_desativacao from public.oms where ativo = false order by tipo, nome;
