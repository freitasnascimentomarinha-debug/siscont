\set ON_ERROR_STOP 0
\pset footer off
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;
\echo '--- 1. Admin cadastra comando e OMs (mesmo código, nomes diferentes)'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into comandos (codigo, nome, setor_id) select '40030','Diretoria Industrial da Marinha', id from setores where sigla='DGMM';
insert into oms (codigo, nome, tipo, comando_id) select '40030','Diretoria Industrial da Marinha','TERRA', id from comandos where codigo='40030';
insert into oms (codigo, nome, tipo, comando_id) select '40032','Navio-Patrulha Mangaratiba','NAVIO', id from comandos where codigo='40030';
insert into oms (codigo, nome) values ('41000','Arsenal de Marinha do Rio de Janeiro'),('41000','PRESTNAV');
select codigo, nome, tipo from oms order by codigo, nome;
\echo '--- 2. Duplicidade (mesmo código e mesmo nome, outra caixa) é recusada'
insert into oms (codigo, nome) values ('41000','prestnav');
\echo '--- 3. Código inválido é recusado'
insert into oms (codigo, nome) values ('ABC','X');
\echo '--- 4. Desativar sem data é recusado; com data funciona e mantém o registro'
update oms set ativo=false where nome='Navio-Patrulha Mangaratiba';
update oms set ativo=false, desativado_em='2026-10-31', motivo_desativacao='Baixa do serviço ativo' where nome='Navio-Patrulha Mangaratiba';
select nome, ativo, desativado_em from oms where codigo='40032';
\echo '--- 5. OM com faturas não pode ser excluída'
delete from oms where codigo='40030';
select count(*) as dim_continua from oms where codigo='40030';
\echo '--- 6. OM sem faturas pode ser excluída'
delete from oms where nome='PRESTNAV';
select count(*) as prestnav_restante from oms where nome='PRESTNAV';
\echo '--- 7. Operador (USER) lê, mas não altera cadastros'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select count(*) as oms_visiveis_operador from oms;
insert into oms (codigo, nome) values ('99999','Teste Operador');
update parametros set valor='20' where chave='dia_emissao';
reset role; select valor as dia_emissao_inalterado from parametros where chave='dia_emissao';
\echo '--- 8. Usuário bloqueado/pendente não lê cadastros'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select count(*) as oms_visiveis_pendente from oms;
reset role;
