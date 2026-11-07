-- Testes do 012 (clientes e taxas). Rode com 001–011 aplicados.
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(uid uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;
insert into rubricas (ano, numero, descricao, valor_anual) values (2031, 1, 'Telhados', 10), (2031, 38, 'Navios', 5) on conflict do nothing;
\i supabase/migrations/012_clientes_taxas.sql
\i supabase/migrations/012_clientes_taxas.sql
grant all on all tables in schema public to authenticated;
revoke insert, update, delete on public.auditoria from authenticated;
\set ON_ERROR_STOP 0
\echo '--- destino pela descrição: espera 1|TC e 38|DA'
select numero, destino from rubricas where ano = 2031 order by numero;
\echo '--- destino inválido: espera ERRO check'
update rubricas set destino = 'XX' where ano = 2031 and numero = 1;
-- dados para unificar
insert into setores (id, sigla) values ('00000000-0000-4000-8000-0000000012f0', 'T012') on conflict do nothing;
insert into oms (id, codigo, nome, tipo, ativo, setor_id) values
 ('00000000-0000-4000-8000-0000000012a1', '40030', 'Diretoria Industrial da Marinha 012', 'TERRA', true, '00000000-0000-4000-8000-0000000012f0'),
 ('00000000-0000-4000-8000-0000000012b2', '40031', 'DIRETORIA INDUSTRIAL DA MARINHA 012', 'TERRA', true, '00000000-0000-4000-8000-0000000012f0');
insert into lotacoes_tc (ano, om_id, lotacao) values (2031, '00000000-0000-4000-8000-0000000012a1', 10), (2031, '00000000-0000-4000-8000-0000000012b2', 20);
insert into precos (ano, sigla, om_id, valor) values (2031, 'TC', '00000000-0000-4000-8000-0000000012b2', 99);
\echo '--- Operador inclui cliente novo (espera INSERT 0 1) mas não altera nem unifica (espera UPDATE 0 e ERRO)'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into oms (codigo, nome, tipo, ativo, fora_da_ilha) values ('40015', 'Cliente Novo 012', 'EXTRA_MB', true, true);
update oms set nome = 'X' where id = '00000000-0000-4000-8000-0000000012a1';
select public.unificar_om('00000000-0000-4000-8000-0000000012a1', '00000000-0000-4000-8000-0000000012b2');
\echo '--- Operador grava nome alternativo pela função: espera {Dir. Ind.}'
select public.om_adicionar_nome_alternativo('00000000-0000-4000-8000-0000000012a1', 'Dir. Ind.');
reset role; select nomes_alternativos from oms where id = '00000000-0000-4000-8000-0000000012a1';
\echo '--- Consulta não inclui cliente: espera ERRO row-level security'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into oms (codigo, nome, tipo, ativo) values ('40015', 'Não pode', 'EXTRA_MB', true);
\echo '--- Admin unifica: preço e lotação passam (lotação repetida na chave é descartada); espera 1 (o preço; a lotação repetida é descartada)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.unificar_om('00000000-0000-4000-8000-0000000012a1', '00000000-0000-4000-8000-0000000012b2');
reset role;
\echo '--- espera: preço na que fica; uma lotação (10); duplicada desativada com motivo; nomes alternativos com o antigo'
select om_id = '00000000-0000-4000-8000-0000000012a1' as preco_transferido from precos where ano = 2031 and sigla = 'TC';
select count(*), min(lotacao) from lotacoes_tc where ano = 2031;
select ativo, desativado_em is not null, motivo_desativacao from oms where id = '00000000-0000-4000-8000-0000000012b2';
select nomes_alternativos from oms where id = '00000000-0000-4000-8000-0000000012a1';
\echo '--- unificar a mesma OM consigo: espera ERRO'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.unificar_om('00000000-0000-4000-8000-0000000012a1', '00000000-0000-4000-8000-0000000012a1');
\echo '--- pendência e par "não são a mesma" gravam: espera 1|1'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into pendentes_tc (ano, nome, lotacao, rubricas, descontos) values (2031, 'OM X', 5, '{1}', '[{"rubrica":1,"valor":10}]');
insert into oms_nao_duplicadas (par) values ('a|b');
reset role;
select (select count(*) from pendentes_tc where ano = 2031), (select count(*) from oms_nao_duplicadas where par = 'a|b');
\echo '--- auditoria registrou a unificação no cadastro de OM: espera t'
select count(*) > 0 from auditoria where tabela = 'oms' and registro_id = '00000000-0000-4000-8000-0000000012b2';
-- limpeza
delete from pendentes_tc where ano = 2031; delete from oms_nao_duplicadas where par = 'a|b';
delete from precos where ano = 2031; delete from lotacoes_tc where ano = 2031; delete from rubricas where ano = 2031;
delete from oms where id in ('00000000-0000-4000-8000-0000000012a1', '00000000-0000-4000-8000-0000000012b2') or nome = 'Cliente Novo 012';
delete from setores where id = '00000000-0000-4000-8000-0000000012f0';
