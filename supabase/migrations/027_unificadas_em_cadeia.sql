-- =====================================================================
-- SISCONT - 027: Concluir unificações que o 016 não conseguiu (ex.: DGDNTM)
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 016 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
-- Por que sobrou OM de terra desativada: o 016 procura a OM que ficou
-- pelo nome gravado no motivo ("Unificada com <nome>"). Se essa OM foi
-- depois unificada em outra, renomeada ou excluída, o nome não existe
-- mais como OM ativa e o cadastro ficava desativado.
--
-- Este script segue a cadeia até achar a OM ativa:
--   1. nome do motivo → OM ativa com esse nome (ignorando maiúsculas);
--   2. se ela também foi unificada, segue o motivo dela;
--   3. se foi excluída, procura na auditoria para onde ela foi;
--   4. senão, OM ativa com o mesmo código e o nome mais parecido.
-- Achou: conclui a unificação (passa tudo e exclui o duplicado).
-- Não achou e o cadastro não tem nenhum dado ligado: exclui (vazio).
-- Não achou e tem dados: fica desativado e aparece no resultado.
-- =====================================================================

create or replace function public.siscont_alvo_unificacao(p_id uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_nome text; v_codigo text; v_motivo text; v_alvo text; v_id uuid; v_ativo boolean; passos integer := 0;
begin
  select nome, codigo, motivo_desativacao into v_nome, v_codigo, v_motivo from public.oms where id = p_id;
  v_alvo := trim(substring(v_motivo from '(?i)^unificada com (.*)$'));
  while v_alvo is not null and passos < 10 loop
    passos := passos + 1;
    -- OM com esse nome (prefere a ativa e o mesmo código)
    select id, ativo, motivo_desativacao into v_id, v_ativo, v_motivo from public.oms
     where lower(trim(nome)) = lower(v_alvo) and id <> p_id
     order by ativo desc, (codigo = v_codigo) desc limit 1;
    if v_id is not null and v_ativo then return v_id; end if;
    if v_id is not null then
      v_alvo := trim(substring(v_motivo from '(?i)^unificada com (.*)$'));   -- também unificada: segue a cadeia
      continue;
    end if;
    -- foi excluída: o motivo dela (se havia) está na auditoria
    select trim(substring(a.antes ->> 'motivo_desativacao' from '(?i)^unificada com (.*)$')) into v_alvo
      from public.auditoria a
     where a.tabela = 'oms' and a.acao in ('DELETE', 'UPDATE') and lower(trim(a.antes ->> 'nome')) = lower(v_alvo)
       and a.antes ->> 'motivo_desativacao' ~* '^unificada com '
     order by a.em desc limit 1;
  end loop;
  -- último recurso: OM ativa com o mesmo código e nome parecido (mesmas iniciais / um contém o outro)
  select id into v_id from public.oms o
   where o.ativo and o.codigo = v_codigo and o.id <> p_id
     and (lower(o.nome) like '%' || lower(v_nome) || '%' or lower(v_nome) like '%' || lower(o.nome) || '%'
          or upper(regexp_replace(v_nome, '[^A-Za-z]', '', 'g')) = upper(coalesce(o.sigla, '')))
   order by length(o.nome) desc limit 1;
  return v_id;
end $$;
revoke all on function public.siscont_alvo_unificacao(uuid) from public;
revoke all on function public.siscont_alvo_unificacao(uuid) from authenticated;

-- quantos registros ainda apontam para a OM (faturas, ALTCRED, preços, lotação...)
create or replace function public.siscont_refs_om(p_id uuid) returns integer
language plpgsql stable security definer set search_path = public as $$
declare fk record; n integer := 0; c integer;
begin
  for fk in
    select cl.relname as tabela, a.attname as coluna
      from pg_constraint k
      join pg_class cl on cl.oid = k.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'public.oms'::regclass and ns.nspname = 'public' and array_length(k.conkey, 1) = 1
  loop
    execute format('select count(*) from public.%I where %I = $1', fk.tabela, fk.coluna) into c using p_id;
    n := n + c;
  end loop;
  return n + case when public.om_tem_movimento(p_id) then 1 else 0 end;
end $$;
revoke all on function public.siscont_refs_om(uuid) from public;
revoke all on function public.siscont_refs_om(uuid) from authenticated;

create temp table if not exists _resultado_027 (codigo text, nome text, situacao text);
truncate _resultado_027;

do $$
declare d record; v_alvo uuid; v_nome_alvo text;
begin
  for d in select id, codigo, nome, tipo from public.oms where ativo = false and motivo_desativacao ~* '^unificada com ' loop
    v_alvo := public.siscont_alvo_unificacao(d.id);
    if v_alvo is not null then
      select nome into v_nome_alvo from public.oms where id = v_alvo;
      perform public.siscont_unificar_om_exec(v_alvo, d.id);
      insert into _resultado_027 values (d.codigo, d.nome, 'unificada em ' || v_nome_alvo || ' e excluída');
    elsif public.siscont_refs_om(d.id) = 0 then
      delete from public.oms where id = d.id;
      insert into _resultado_027 values (d.codigo, d.nome, 'sem nenhum dado ligado: excluída');
    else
      -- motivo trocado para aparecer na página Duplicidades (lá dá para escolher a OM que fica)
      update public.oms set motivo_desativacao = 'Unificação incompleta: OM de destino não encontrada' where id = d.id;
      insert into _resultado_027 values (d.codigo, d.nome, 'NÃO resolvida: tem dados e a OM de destino não foi achada — unifique pela página Duplicidades');
    end if;
  end loop;
end $$;

-- Resultado: o que este script fez e as OM de terra / extra-MB que continuam desativadas (com o motivo)
select 'feito por este script' as grupo, codigo, nome, situacao as detalhe from _resultado_027
union all
select 'continua desativada', codigo, nome, coalesce(motivo_desativacao, 'sem motivo') || coalesce(' (desde ' || to_char(desativado_em, 'DD/MM/YYYY') || ')', '')
  from public.oms where ativo = false and tipo <> 'NAVIO'
order by 1, 3;
