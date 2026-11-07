-- Testes do 006 (Fase 2 - recebimentos). Rode com 001–005 aplicados (veja fase1b_004_tests.sql).
\set ON_ERROR_STOP 1
alter table received_documents add column if not exists document_type text;
alter table received_documents add column if not exists total_value numeric;
alter table received_documents add column if not exists date date;
alter table received_documents add column if not exists operation text;
alter table received_documents add column if not exists observation text;
insert into received_documents (id, document_number, document_type, total_value, date, operation, observation) values
  ('00000000-0000-4000-8000-0000000006d1', 'G424.2026.AC.00343', 'ALTCRED', 44000, '2026-08-19', 'PAGAMENTO', ''),
  ('00000000-0000-4000-8000-0000000006d2', 'GRU ABC123', 'GRU', 1149.08, '2026-09-10', 'PAGAMENTO', ''),
  ('00000000-0000-4000-8000-0000000006d3', 'G424.2026.AC.00016', 'ALTCRED', 37090, '2026-02-10', 'ADIANTAMENTO', '');
insert into payment_allocations (id, document_id, invoice_id, amount, origem) values
  ('00000000-0000-4000-8000-0000000006a1', '00000000-0000-4000-8000-0000000006d1', null, 100, 'Migração › LANÇAMENTOS (pagamento)'),
  ('00000000-0000-4000-8000-0000000006a2', '00000000-0000-4000-8000-0000000006d1', null, 50, 'Migração › RESUMO ADIANTAMENTO (uso de adiantamento)'),
  ('00000000-0000-4000-8000-0000000006a3', '00000000-0000-4000-8000-0000000006d3', null, 70, null);
\i supabase/migrations/006_recebimentos_fase2.sql
\i supabase/migrations/006_recebimentos_fase2.sql
\set ON_ERROR_STOP 0
\echo '--- exercício pelo número; GRU com autenticação; sobra da 00343 em adiantamento: espera 2026|ABC123|t'
select exercicio, (select gru_autenticacao from received_documents where document_number = 'GRU ABC123') aut, sobra_adiantamento
  from received_documents where document_number = 'G424.2026.AC.00343';
\echo '--- tipo das baixas: espera a1 PAGAMENTO, a2 ADIANTAMENTO, a3 ADIANTAMENTO'
select right(id::text, 2) id, tipo_baixa from payment_allocations where id::text like '%0006a_' order by 1;
\echo '--- tipo inválido recusado: espera ERRO check'
update payment_allocations set tipo_baixa = 'OUTRO' where id = '00000000-0000-4000-8000-0000000006a1';
delete from payment_allocations where id::text like '%0006a_';
delete from received_documents where id::text like '%0006d_';
