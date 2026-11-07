-- Testes do 004 (migração de faturas). Rode depois do 001–003 e do supabase_mock.sql:
-- Aqui tudo é feito num só arquivo: prepara, aplica o 004 duas vezes (idempotente) e verifica.
\set ON_ERROR_STOP 1
-- complementa o banco simulado com as colunas/tabelas que o 004 usa (no Supabase elas já existem)
alter table invoices add column if not exists invoice_number text;
create table if not exists received_documents (id uuid primary key, document_number text);
create table if not exists payment_allocations (id uuid primary key, document_id uuid, invoice_id uuid, amount numeric);
insert into setores (sigla, ordem) values ('TM', 900) on conflict do nothing;
insert into comandos (codigo, nome, setor_id) select '99990', 'Comando teste TM', id from setores where sigla='TM';
insert into oms (codigo, nome, tipo, setor_id) select '99991', 'Tribunal Marítimo', 'TERRA', id from setores where sigla='TM';
insert into oms (codigo, nome, tipo) values ('40030', 'Diretoria Industrial da Marinha', 'TERRA') on conflict do nothing;
insert into invoices (id, ug, client, invoice_number, value) values ('00000000-0000-4000-8000-0000000004a1', '40030', 'Diretoria Industrial da Marinha', '40030-EL-08-2026-010-0', 10);
\i supabase/migrations/004_migracao_faturas.sql
\i supabase/migrations/004_migracao_faturas.sql
\set ON_ERROR_STOP 0
\echo '--- TM não existe mais como setor; OM Tribunal Marítimo continua, sem setor'
select count(*) as setores_tm from setores where sigla = 'TM';
select nome, setor_id is null as sem_setor from oms where codigo = '99991';
\echo '--- colunas novas'
select column_name from information_schema.columns where table_name = 'invoices' and column_name in ('om_id','origem','quitacao_externa','quitada_em','contestada') order by 1;
\echo '--- número de fatura repetido (com espaço) é recusado: espera ERRO duplicate key'
insert into invoices (id, ug, client, invoice_number, value) values ('00000000-0000-4000-8000-0000000004a2', '40030', 'DIM', ' 40030-EL-08-2026-010-0 ', 10);
\echo '--- fatura ligada pelo om_id bloqueia a exclusão da OM: espera t'
update invoices set om_id = (select id from oms where codigo = '40030'), client = 'nome antigo' where id = '00000000-0000-4000-8000-0000000004a1';
select om_tem_movimento((select id from oms where codigo = '40030')) as tem_movimento;
\echo '--- excluir a OM com fatura: espera ERRO'
delete from oms where codigo = '40030';
\echo '--- limpeza'
delete from invoices where id::text like '00000000-0000-4000-8000-0000000004a%';
delete from oms where codigo in ('40030', '99991');
delete from comandos where codigo = '99990';
