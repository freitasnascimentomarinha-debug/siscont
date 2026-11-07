-- Testes do 007 (Fase 3 - faturamento). Rode com 001–006 aplicados.
\set ON_ERROR_STOP 1
-- complementa o banco simulado
alter table invoices add column if not exists year_competence int;
alter table invoices add column if not exists month_competence int;
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
\i supabase/migrations/007_faturamento_fase3.sql
\i supabase/migrations/007_faturamento_fase3.sql
\set ON_ERROR_STOP 0
insert into oms (id, codigo, nome, tipo) values ('00000000-0000-4000-8000-0000000007a1', '40032', 'Navio teste 007', 'NAVIO');
\echo '--- preço: um por ano/serviço/OM (e um geral por serviço): espera 2 OK e 2 ERROS duplicate'
insert into precos (ano, sigla, om_id, valor) values (2026, 'DA', '00000000-0000-4000-8000-0000000007a1', 95.51);
insert into precos (ano, sigla, om_id, valor) values (2026, 'RB', null, 1000);
insert into precos (ano, sigla, om_id, valor) values (2026, 'DA', '00000000-0000-4000-8000-0000000007a1', 99);
insert into precos (ano, sigla, om_id, valor) values (2026, 'RB', null, 1);
\echo '--- competência inválida recusada: espera ERRO check'
insert into medicoes (competencia, sigla, om_id, quantidade) values ('2026-13', 'EL', '00000000-0000-4000-8000-0000000007a1', 1);
\echo '--- atracação: realizado e previsão no mesmo mês convivem: espera 2'
insert into atracacoes (competencia, om_id, previsao, dias, dias_atracado) values ('2026-10', '00000000-0000-4000-8000-0000000007a1', false, '["A"]', 1), ('2026-10', '00000000-0000-4000-8000-0000000007a1', true, '["A"]', 1);
select count(*) from atracacoes where om_id = '00000000-0000-4000-8000-0000000007a1';
\echo '--- lote: tipo inválido recusado: espera ERRO check'
insert into lotes_faturamento (competencia, tipo, data_emissao, data_limite) values ('2026-08', 'OUTRO', '2026-09-15', '2026-09-29');
\echo '--- fatura ligada ao lote; excluir o lote mantém a fatura (lote_id nulo): espera t'
insert into lotes_faturamento (id, competencia, tipo, data_emissao, data_limite) values ('00000000-0000-4000-8000-0000000007b1', '2026-08', 'MENSAL', '2026-09-15', '2026-09-29');
insert into invoices (id, invoice_number, value, lote_id, estimado) values ('00000000-0000-4000-8000-0000000007c1', '40032-DA-08-2026-001-0', 1, '00000000-0000-4000-8000-0000000007b1', false);
delete from lotes_faturamento where id = '00000000-0000-4000-8000-0000000007b1';
select lote_id is null from invoices where id = '00000000-0000-4000-8000-0000000007c1';
delete from invoices where id = '00000000-0000-4000-8000-0000000007c1';
delete from oms where id = '00000000-0000-4000-8000-0000000007a1';
\echo '--- excluir a OM leva preços, medições e atracações dela: espera 0'
select (select count(*) from precos where om_id = '00000000-0000-4000-8000-0000000007a1') + (select count(*) from atracacoes where om_id = '00000000-0000-4000-8000-0000000007a1');
delete from precos where sigla = 'RB' and om_id is null;
