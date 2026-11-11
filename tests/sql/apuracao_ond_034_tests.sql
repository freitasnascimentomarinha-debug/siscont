-- Testes do 034 (meses sem movimento e apuração anual do OND). Com 001–003 aplicados.
\set ON_ERROR_STOP 0
\pset footer off
insert into oms (id, codigo, nome, tipo) values ('00000000-0000-4000-8000-000000034a01', '90501', 'OM 34 A', 'TERRA') on conflict do nothing;
\i supabase/migrations/034_apuracao_ond.sql
\i supabase/migrations/034_apuracao_ond.sql
grant all on all tables in schema public to authenticated, service_role;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);   -- OPERADOR
\echo '--- 1. operador marca o mês 3/2026 de AE como sem movimento (espera 1) e a mesma marca de novo é recusada (erro)'
insert into meses_sem_movimento (om_id, sigla, ano, mes, motivo) values ('00000000-0000-4000-8000-000000034a01', 'AE', 2026, 3, 'OM sem consumo');
insert into meses_sem_movimento (om_id, sigla, ano, mes) values ('00000000-0000-4000-8000-000000034a01', 'AE', 2026, 3);
select mes, motivo, criado_por_nome is not null as tem_nome from meses_sem_movimento;
\echo '--- 2. mês 13 recusado (erro)'
insert into meses_sem_movimento (om_id, sigla, ano, mes) values ('00000000-0000-4000-8000-000000034a01', 'AE', 2026, 13);
\echo '--- 3. apuração: débito complementar de 300 (estimado 3.000, real 3.300)'
insert into apuracoes_ond (id, om_id, sigla, exercicio, estimada_numero, estimado, real, diferenca, resultado, acerto_numero, memoria)
 values ('00000000-0000-4000-8000-0000000034e1', '00000000-0000-4000-8000-000000034a01', 'AE', 2026, '90501-AE-10-2026-001-0', 3000, 3300, 300, 'DEBITO', '90501-AE-01-2027-001-0', '{"porMes":{"2026-10":1200,"2026-11":1100,"2026-12":1000}}');
\echo '--- 4. a MESMA apuração (OM, serviço, exercício) de novo é recusada (espera erro de duplicidade)'
insert into apuracoes_ond (om_id, sigla, exercicio, estimado, real, diferenca, resultado) values ('00000000-0000-4000-8000-000000034a01', 'AE', 2026, 3000, 2800, -200, 'CREDITO');
\echo '--- 5. resultado inválido recusado (erro)'
insert into apuracoes_ond (om_id, sigla, exercicio, estimado, real, diferenca, resultado) values ('00000000-0000-4000-8000-000000034a01', 'EL', 2026, 1, 1, 0, 'OUTRO');
\echo '--- 6. valores apurados não mudam (espera erro) e apagar é recusado (erro)'
update apuracoes_ond set real = 1 where id = '00000000-0000-4000-8000-0000000034e1';
delete from apuracoes_ond where id = '00000000-0000-4000-8000-0000000034e1';
\echo '--- 7. operador NÃO cancela por motivo próprio (espera erro), mas desfaz a apuração de um lote que falhou (espera UPDATE 1)'
update apuracoes_ond set cancelada_em = now(), cancelada_motivo = 'achei errado' where id = '00000000-0000-4000-8000-0000000034e1';
update apuracoes_ond set cancelada_em = now(), cancelada_motivo = 'Emissão do lote desfeita' where id = '00000000-0000-4000-8000-0000000034e1';
\echo '--- 8. com a apuração cancelada, uma nova (sem diferença) pode ser registrada (espera 1 e saldo de 2 linhas)'
insert into apuracoes_ond (om_id, sigla, exercicio, estimado, real, diferenca, resultado) values ('00000000-0000-4000-8000-000000034a01', 'AE', 2026, 3000, 3000, 0, 'SEM_DIFERENCA');
select resultado, cancelada_em is not null as cancelada from apuracoes_ond order by criado_em;
\echo '--- 9. ADMIN cancela por motivo próprio (espera UPDATE 1) e o nome fica gravado'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
update apuracoes_ond set cancelada_em = now(), cancelada_motivo = 'Subsídio corrigido' where resultado = 'SEM_DIFERENCA';
select cancelada_motivo, cancelada_por_nome is not null as tem_nome from apuracoes_ond where resultado = 'SEM_DIFERENCA';
\echo '--- 10. LEITOR lê e não grava (espera erro e le = t)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
insert into meses_sem_movimento (om_id, sigla, ano, mes) values ('00000000-0000-4000-8000-000000034a01', 'AE', 2026, 4);
select count(*) > 0 as le from apuracoes_ond;
reset role;
alter table apuracoes_ond disable trigger apuracoes_ond_guarda_trg;
delete from apuracoes_ond; delete from meses_sem_movimento; delete from oms where nome like 'OM 34%';
alter table apuracoes_ond enable trigger apuracoes_ond_guarda_trg;
