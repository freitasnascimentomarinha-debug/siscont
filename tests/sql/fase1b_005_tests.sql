-- Testes do 005 (pontos de atenção). Rode com 001–004 aplicados (veja fase1b_004_tests.sql).
\set ON_ERROR_STOP 1
\i supabase/migrations/005_pontos_atencao.sql
\i supabase/migrations/005_pontos_atencao.sql
\set ON_ERROR_STOP 0
\echo '--- coluna com padrão lista vazia nas duas tabelas: espera 2 linhas com []'
select table_name, column_default from information_schema.columns where column_name = 'pontos_atencao' order by 1;
\echo '--- grava e consulta pontos pendentes por tipo: espera 1'
insert into invoices (id, invoice_number, value, pontos_atencao)
values ('00000000-0000-4000-8000-0000000005a1', 'T-005', 1, '[{"tipo":"VENCIMENTO_CORRIGIDO","mensagem":"x","origem":"migracao","em":"2026-11-07"}]');
select count(*) from invoices where pontos_atencao @> '[{"tipo":"VENCIMENTO_CORRIGIDO"}]';
\echo '--- valor nulo é recusado: espera ERRO not-null'
update invoices set pontos_atencao = null where id = '00000000-0000-4000-8000-0000000005a1';
delete from invoices where id = '00000000-0000-4000-8000-0000000005a1';
