-- Testes do 008 (Fase 4). Rode com 001–007 aplicados.
\set ON_ERROR_STOP 1
alter table invoices add column if not exists issue_date date;
alter table invoices add column if not exists observation text;
alter table invoices add column if not exists is_canceled boolean default false;
insert into invoices (id, invoice_number, value, contestada, observation, issue_date) values
  ('00000000-0000-4000-8000-0000000008a1', '91630-AE-04-2026-001-0', 10, true, 'Contestação: navio docado', '2026-05-15'),
  ('00000000-0000-4000-8000-0000000008a2', '91630-AE-05-2026-001-0', 10, false, null, '2026-06-15');
\i supabase/migrations/008_contestacao_fase4.sql
\i supabase/migrations/008_contestacao_fase4.sql
\set ON_ERROR_STOP 0
\echo '--- fatura contestada da planilha ganha UMA contestação ABERTA (mesmo rodando 2x): espera 1 | MIGRACAO | Contestação: navio docado'
select count(*), min(origem), min(justificativa) from contestacoes where invoice_id = '00000000-0000-4000-8000-0000000008a1';
\echo '--- decisão inválida recusada: espera ERRO check'
update contestacoes set decisao = 'TALVEZ' where invoice_id = '00000000-0000-4000-8000-0000000008a1';
\echo '--- taxa da poupança: mês inválido e taxa absurda recusados: espera 2 ERROS'
insert into taxas_poupanca (mes, taxa) values ('2026-13', 0.5);
insert into taxas_poupanca (mes, taxa) values ('2026-10', 50);
\echo '--- lote CORRECAO aceito: espera INSERT ok (sem erro)'
insert into lotes_faturamento (id, competencia, tipo, data_emissao, data_limite) values ('00000000-0000-4000-8000-0000000008b1', '2026-10', 'CORRECAO', '2026-11-16', '2026-11-30');
\echo '--- excluir a fatura leva a contestação: espera 0'
delete from invoices where id::text like '%0008a_';
select count(*) from contestacoes where numero_fatura like '91630-%';
delete from lotes_faturamento where id = '00000000-0000-4000-8000-0000000008b1';
