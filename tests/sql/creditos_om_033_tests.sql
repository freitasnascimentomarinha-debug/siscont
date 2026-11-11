-- Testes do 033 (livro de créditos por OM). Com 001–003 aplicados (profiles, oms, can_write/is_admin).
\set ON_ERROR_STOP 0
\pset footer off
insert into oms (id, codigo, nome, tipo) values
 ('00000000-0000-4000-8000-000000033a01', '90401', 'OM 33 A', 'TERRA'), ('00000000-0000-4000-8000-000000033a02', '90402', 'OM 33 B', 'TERRA') on conflict do nothing;
\i supabase/migrations/033_creditos_om.sql
\i supabase/migrations/033_creditos_om.sql
grant all on all tables in schema public to authenticated, service_role;
\echo '--- 1. livro nasce zerado e rodar 2 vezes não cria nada (espera 0, 0)'
select count(*), coalesce(sum(valor), 0) from creditos_om;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);   -- OPERADOR
\echo '--- 2. dois acertos geram dois créditos da OM A (serviços diferentes, exercícios diferentes): 300 (AE/2025) e 200 (EL/2026) (espera saldo_posterior 300, 500)'
insert into creditos_om (id, om_id, data, tipo, valor, servico_origem, exercicio_origem, origem_numero, origem_chave) values
 ('00000000-0000-4000-8000-0000000033e1', '00000000-0000-4000-8000-000000033a01', '2026-01-10', 'ENTRADA_ACERTO', 300, 'AE', 2025, '90401-AE-01-2026-001-0', '90401-AE-01-2026-001');
insert into creditos_om (id, om_id, data, tipo, valor, servico_origem, exercicio_origem, origem_numero, origem_chave) values
 ('00000000-0000-4000-8000-0000000033e2', '00000000-0000-4000-8000-000000033a01', '2026-02-10', 'ENTRADA_ACERTO', 200, 'EL', 2026, '90401-EL-02-2026-001-0', '90401-EL-02-2026-001');
select tipo, valor, saldo_anterior, saldo_posterior, criado_por_nome is not null as tem_nome from creditos_om order by criado_em;
\echo '--- 3. acerto repetido (mesma chave) recusado (espera erro de duplicidade)'
insert into creditos_om (om_id, tipo, valor, origem_numero, origem_chave) values ('00000000-0000-4000-8000-000000033a01', 'ENTRADA_ACERTO', 300, '90401-AE-01-2026-001-1', '90401-AE-01-2026-001');
\echo '--- 4. fatura de OUTRO serviço usa o crédito do AE: 250 do crédito mais antigo (espera saldo 250)'
insert into creditos_om (om_id, data, tipo, valor, credito_ref, destino_numero) values ('00000000-0000-4000-8000-000000033a01', '2026-03-01', 'UTILIZACAO', -250, '00000000-0000-4000-8000-0000000033e1', '90401-TL-03-2026-001-0');
select sum(valor) as saldo_da_om from creditos_om where om_id = '00000000-0000-4000-8000-000000033a01';
\echo '--- 5. a mesma fatura não usa o mesmo crédito duas vezes (espera erro)'
insert into creditos_om (om_id, tipo, valor, credito_ref, destino_numero) values ('00000000-0000-4000-8000-000000033a01', 'UTILIZACAO', -10, '00000000-0000-4000-8000-0000000033e1', '90401-TL-03-2026-001-0');
\echo '--- 6. usar mais do que resta do crédito de origem é recusado (restam 50 no e1; espera erro) mas o e2 (200) segue disponível'
insert into creditos_om (om_id, tipo, valor, credito_ref, destino_numero) values ('00000000-0000-4000-8000-000000033a01', 'UTILIZACAO', -80, '00000000-0000-4000-8000-0000000033e1', '90401-AE-04-2026-001-0');
\echo '--- 7. crédito de OUTRA OM não pode ser usado (espera erro) e saldo negativo é impossível (espera erro)'
insert into creditos_om (om_id, tipo, valor, credito_ref, destino_numero) values ('00000000-0000-4000-8000-000000033a02', 'UTILIZACAO', -10, '00000000-0000-4000-8000-0000000033e1', '90402-AE-04-2026-001-0');
insert into creditos_om (om_id, tipo, valor, credito_ref, destino_numero) values ('00000000-0000-4000-8000-000000033a01', 'DEVOLUCAO', -900, '00000000-0000-4000-8000-0000000033e2', 'x');
\echo '--- 8. DEVOLUÇÃO de 120 do crédito e2 (espera saldo 130: 250 restantes − 120)'
insert into creditos_om (om_id, tipo, valor, credito_ref, documento) values ('00000000-0000-4000-8000-000000033a01', 'DEVOLUCAO', -120, '00000000-0000-4000-8000-0000000033e2', 'G424.2026.AC.00999');
select sum(valor) as saldo_da_om from creditos_om where om_id = '00000000-0000-4000-8000-000000033a01';
\echo '--- 9. cancelar a fatura que usou crédito: ESTORNO devolve 250 ao crédito e1 (espera saldo 380); estornar de novo é recusado (espera erro)'
insert into creditos_om (om_id, tipo, valor, credito_ref, estorno_de) select om_id, 'ESTORNO', 250, credito_ref, id from creditos_om where destino_numero = '90401-TL-03-2026-001-0' and tipo = 'UTILIZACAO';
select sum(valor) as saldo_da_om from creditos_om where om_id = '00000000-0000-4000-8000-000000033a01';
insert into creditos_om (om_id, tipo, valor, credito_ref, estorno_de) select om_id, 'ESTORNO', 250, credito_ref, id from creditos_om where destino_numero = '90401-TL-03-2026-001-0' and tipo = 'UTILIZACAO';
\echo '--- 10. estorno com valor errado é recusado (espera erro)'
insert into creditos_om (om_id, tipo, valor, credito_ref, estorno_de) select om_id, 'ESTORNO', 100, credito_ref, id from creditos_om where tipo = 'DEVOLUCAO';
\echo '--- 11. o acerto que gerou o crédito já utilizado não pode ser estornado (e2 teve devolução de 120: estornar 200 recusado), mas o e1 inteiro também não (tem saldo usado?)'
insert into creditos_om (om_id, tipo, valor, credito_ref, estorno_de) values ('00000000-0000-4000-8000-000000033a01', 'ESTORNO', -200, '00000000-0000-4000-8000-0000000033e2', '00000000-0000-4000-8000-0000000033e2');
\echo '--- 12. SALDO DE ABERTURA: operador recusado (espera erro); administrador aceito'
insert into creditos_om (om_id, tipo, valor, documento, observacao) values ('00000000-0000-4000-8000-000000033a02', 'ABERTURA', 1000, 'ALTCRED G1', 'saldo anterior');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);   -- ADMIN
insert into creditos_om (om_id, tipo, valor, documento, observacao) values ('00000000-0000-4000-8000-000000033a02', 'ABERTURA', 1000, 'ALTCRED G1', 'saldo anterior');
select tipo, valor, saldo_posterior from creditos_om where om_id = '00000000-0000-4000-8000-000000033a02';
\echo '--- 13. histórico imutável: sem política de UPDATE/DELETE, nenhuma linha é alterada (espera UPDATE 0 / DELETE 0) e nem o dono do banco consegue (teste 15)'
update creditos_om set valor = 1 where tipo = 'ABERTURA';
delete from creditos_om where tipo = 'ABERTURA';
\echo '--- 14. LEITOR lê e não grava (espera erro e count > 0)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
insert into creditos_om (om_id, tipo, valor, documento) values ('00000000-0000-4000-8000-000000033a02', 'ABERTURA', 5, 'x');
select count(*) > 0 as le from creditos_om;
reset role;
\echo '--- 15. nem o dono do banco altera ou apaga (espera 2 erros)'
update creditos_om set valor = 1 where tipo = 'ABERTURA';
delete from creditos_om where tipo = 'ABERTURA';
\echo '--- 15. nem o dono do banco altera ou apaga (espera 2 erros)'
update creditos_om set valor = 1 where tipo = 'ABERTURA';
delete from creditos_om where tipo = 'ABERTURA';
