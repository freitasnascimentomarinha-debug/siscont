-- Testes do 010 (Fases 6 e 7). Rode com 001–009 aplicados.
\set ON_ERROR_STOP 1
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb $$;
create or replace function pg_temp.as_user(uid uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;
insert into rubricas (ano, numero, descricao, valor_anual) values (2025, 1, 'Manutenção de Telhados', 200000) on conflict do nothing;
grant all on all tables in schema public to authenticated, service_role;
\i supabase/migrations/010_rotinas_anuais_auditoria.sql
\i supabase/migrations/010_rotinas_anuais_auditoria.sql
grant all on lotacoes_tc, matriz_tc, descontos_tc, atracacao_anual, propostas_tc to authenticated;
\set ON_ERROR_STOP 0
\echo '--- rubrica antiga: previsto = vigente; espera 200000|0'
select valor_previsto, desconto_geral from rubricas where ano = 2025 and numero = 1;
\echo '--- desconto geral maior que o previsto: espera ERRO check'
update rubricas set desconto_geral = 300000 where ano = 2025 and numero = 1;
\echo '--- status inválido: espera ERRO check'
insert into propostas_tc (ano, status) values (2026, 'XYZ');
\echo '--- desconto sem justificativa e % acima de 100: espera 2 ERRO check'
insert into descontos_tc (ano, om_id, tipo, valor, justificativa) select 2026, id, 'PERCENTUAL', 23.5, ' ' from oms limit 1;
insert into descontos_tc (ano, om_id, tipo, valor, justificativa) select 2026, id, 'PERCENTUAL', 120, 'x' from oms limit 1;
\echo '--- lotação, matriz, desconto e atracação anual gravam: espera 1|1|1|1'
insert into lotacoes_tc (ano, om_id, lotacao, lotacao_anterior) select 2026, id, 140, 76 from oms limit 1;
insert into matriz_tc (ano, rubrica, om_id) select 2026, 1, id from oms limit 1;
insert into descontos_tc (ano, om_id, tipo, valor, justificativa) select 2026, id, 'PERCENTUAL', 23.5, 'Edifício mantido pela própria OM' from oms limit 1;
insert into classes_navio (nome) select 'Classe Teste 010' where not exists (select 1 from classes_navio where nome = 'Classe Teste 010');
insert into atracacao_anual (ano, classe_id, dias, navios, origem) select 2025, id, 327, 1, 'teste' from classes_navio where nome = 'Classe Teste 010';
select (select count(*) from lotacoes_tc where ano = 2026), (select count(*) from matriz_tc where ano = 2026), (select count(*) from descontos_tc where ano = 2026), (select count(*) from atracacao_anual where origem = 'teste');

\echo '--- AUDITORIA: Operador altera um preço e o parâmetro de backup não; espera INSERT e UPDATE com usuário oper@mb.br'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into precos (id, ano, sigla, om_id, valor, unidade) values ('00000000-0000-4000-8000-000000010a01', 2026, 'TC', null, 100, 'MÊS');
update precos set valor = 120 where id = '00000000-0000-4000-8000-000000010a01';
update precos set valor = 120 where id = '00000000-0000-4000-8000-000000010a01';  -- sem mudança: não registra
reset role;
select acao, usuario_email from auditoria where registro_id = '00000000-0000-4000-8000-000000010a01' order by id desc limit 2;
\echo '--- só os campos alterados no UPDATE: espera {"valor": 100}|{"valor": 120}'
select antes, depois from auditoria where registro_id = '00000000-0000-4000-8000-000000010a01' and acao = 'UPDATE' order by id desc limit 1;
\echo '--- trilha não pode ser alterada nem apagada pelo usuário: espera 2 ERRO permission denied'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update auditoria set usuario_email = 'x' where registro_id = '00000000-0000-4000-8000-000000010a01';
delete from auditoria where registro_id = '00000000-0000-4000-8000-000000010a01';
\echo '--- Consulta lê a trilha das faturas/preços (espera t), mas não a de usuários (espera 0)'
reset role; update profiles set name = 'Operador 010' where id = '00000000-0000-0000-0000-00000000000b';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select count(*) >= 2 from auditoria where registro_id = '00000000-0000-4000-8000-000000010a01';
select count(*) from auditoria where tabela = 'profiles';
\echo '--- Admin lê a de usuários: espera >= 1'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select count(*) >= 1 from auditoria where tabela = 'profiles';
\echo '--- Consulta (READ_ONLY) não grava lotação: espera ERRO row-level security'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into lotacoes_tc (ano, om_id, lotacao) select 2027, id, 1 from oms limit 1;
\echo '--- Admin registra o backup: espera 1'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into parametros (chave, valor) values ('ultimo_backup', now()::text) on conflict (chave) do update set valor = excluded.valor;
select count(*) from parametros where chave = 'ultimo_backup' and valor is not null;
\echo '--- exclusão registra a linha inteira: espera DELETE|120'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from precos where id = '00000000-0000-4000-8000-000000010a01';
reset role;
select acao, antes ->> 'valor' from auditoria where registro_id = '00000000-0000-4000-8000-000000010a01' and acao = 'DELETE' order by id desc limit 1;
-- limpeza
delete from descontos_tc where ano = 2026; delete from matriz_tc where ano = 2026; delete from lotacoes_tc where ano in (2026, 2027);
delete from atracacao_anual where origem = 'teste'; delete from classes_navio where nome = 'Classe Teste 010';
update profiles set name = 'Operador' where id = '00000000-0000-0000-0000-00000000000b';
delete from rubricas where ano = 2025;
