-- Testes do 009 (Fase 5). Rode com 001–008 aplicados.
\set ON_ERROR_STOP 1
create table if not exists public.cash_flow_exits (id uuid primary key default gen_random_uuid(), date date, document_number text, document_type text, client text, value numeric, rubric text, description text, observation text, is_canceled boolean default false);
insert into cash_flow_exits (id, document_number, value, rubric) values
  ('00000000-0000-4000-8000-0000000009e1', '740015000012026NE000123', 50400, '14'),
  ('00000000-0000-4000-8000-0000000009e2', '740015000012026NE000122', 94860, 'Água e Esgoto'),
  ('00000000-0000-4000-8000-0000000009e3', '740015000012026NE000124', 10, 'Diversos');
\i supabase/migrations/009_relatorios_fase5.sql
\i supabase/migrations/009_relatorios_fase5.sql
\set ON_ERROR_STOP 0
\echo '--- rubrica digitada vira rubrica/categoria: espera 14|CONDOMINIO, |AGUA, |OUTROS'
select rubrica_numero, categoria from cash_flow_exits where id::text like '%0009e_' order by id;
\echo '--- categoria inválida recusada: espera ERRO check'
update cash_flow_exits set categoria = 'XYZ' where id = '00000000-0000-4000-8000-0000000009e1';
\echo '--- rubrica: uma por ano/número; número fora de faixa recusado: espera 1 ERRO duplicate e 1 ERRO check'
insert into rubricas (ano, numero, descricao, valor_anual) values (2026, 1, 'Manutenção de Telhados', 146096.92);
insert into rubricas (ano, numero, descricao, valor_anual) values (2026, 1, 'Repetida', 1);
insert into rubricas (ano, numero, descricao, valor_anual) values (2026, 0, 'Zero', 1);
\echo '--- cobrança registrada: espera 1'
insert into cobrancas (comando, faturas, valor) values ('40030 - DIM', array['40030-TC-09-2025-014-0'], 19615.73);
select count(*) from cobrancas;
delete from cobrancas; delete from rubricas where ano = 2026; delete from cash_flow_exits where id::text like '%0009e_';
