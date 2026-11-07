-- =====================================================================
-- SISCONT - 015: Unificar duplicidades EXCLUI o cadastro duplicado
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 014 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. Unificar passa tudo do cadastro duplicado para o que fica
--     (faturas, ALTCRED, preços, medições, lotação...), corrige o nome
--     do cliente nas faturas, guarda o nome antigo como nome
--     alternativo e EXCLUI o duplicado (antes ele ficava desativado).
--  2. Limpa os que já foram unificados antes ("Unificada com ...").
--  3. A trava de exclusão passa a olhar só as faturas ligadas à OM
--     (as sem ligação continuam valendo pelo código + nome).
-- A exclusão fica registrada na trilha de auditoria.
-- =====================================================================

-- 3. Trava de exclusão: fatura ligada pelo om_id; sem ligação, pelo código + nome
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

-- 1. Rotina da unificação (sem checagem de perfil; usada pela função pública e pela limpeza)
create or replace function public.siscont_unificar_om_exec(p_manter uuid, p_remover uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  fk record; r record; n integer := 0; v_nome text; v_codigo text; v_alt text[]; v_manter text;
begin
  if p_manter = p_remover then raise exception 'Escolha duas OM diferentes.'; end if;
  select nome into v_manter from public.oms where id = p_manter;
  select nome, codigo, coalesce(nomes_alternativos, '{}') into v_nome, v_codigo, v_alt from public.oms where id = p_remover;
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

  update public.oms
     set nomes_alternativos = (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(nomes_alternativos, '{}') || v_alt || array[v_nome]) x
                                where x is not null and x <> v_manter)
   where id = p_manter;

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

-- 2. Limpeza dos já unificados: acha a OM que ficou pelo nome gravado no motivo
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

-- Resultado: unificados que ainda sobraram (deve vir vazio)
select codigo, nome, motivo_desativacao from public.oms where ativo = false and motivo_desativacao ~* '^unificada com ' order by nome;
