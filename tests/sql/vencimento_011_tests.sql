-- Testes do 011 (certificação × vencimento). Rode com 001–010 aplicados.
\set ON_ERROR_STOP 1
alter table invoices add column if not exists invoice_number text;
alter table invoices add column if not exists due_date date;
alter table invoices add column if not exists adjustment_addition numeric;
alter table invoices add column if not exists adjustment_deduction numeric;
insert into feriados (data, descricao, tipo) values ('2026-11-02', 'Finados', 'NACIONAL') on conflict do nothing;
delete from invoices where id::text like '00000000-0000-4000-8000-0000000011%';
insert into invoices (id, ug, client, invoice_number, value, issue_date, due_date, is_canceled, estimado, observation, quitacao_externa) values
 ('00000000-0000-4000-8000-000000001101', '1', 'A', 'A-ABERTA', 100, '2026-10-02', '2026-10-16', false, false, '', null),      -- +30 = 01/11 (dom) → 03/11 (02 é feriado)
 ('00000000-0000-4000-8000-000000001102', '1', 'A', 'B-PAGA', 100, '2026-10-02', '2026-10-16', false, false, '', null),
 ('00000000-0000-4000-8000-000000001103', '1', 'A', 'C-OND', 100, '2026-11-15', '2026-11-30', false, true, '', null),
 ('00000000-0000-4000-8000-000000001104', '1', 'A', 'D-CANCELADA', 100, '2026-10-02', '2026-10-16', true, false, '', null),
 ('00000000-0000-4000-8000-000000001105', '1', 'A', 'E-QUITADA-FORA', 100, '2026-10-02', '2026-10-16', false, false, '', 'SIPLAD'),
 ('00000000-0000-4000-8000-000000001106', '1', 'A', 'F-OND-OBS', 100, '2026-11-15', '2026-11-30', false, false, 'Faturamento estimado OND', null),
 ('00000000-0000-4000-8000-000000001107', '1', 'A', 'G-PARCIAL', 100, '2026-09-15', '2026-09-29', false, false, '', null);    -- +30 = 15/10 (qui)
insert into payment_allocations (id, invoice_id, amount) values
 (gen_random_uuid(), '00000000-0000-4000-8000-000000001102', 100),
 (gen_random_uuid(), '00000000-0000-4000-8000-000000001107', 40);
create table if not exists public.vencimentos_anteriores_011 (invoice_id text primary key, invoice_number text, due_date_anterior date, due_date_novo date, alterado_em timestamptz not null default now());
delete from public.vencimentos_anteriores_011 where invoice_id like '00000000-0000-4000-8000-0000000011%';
\i supabase/migrations/011_vencimento_30_dias.sql
\i supabase/migrations/011_vencimento_30_dias.sql
\set ON_ERROR_STOP 0
\echo '--- espera: A 2026-11-03 | B 2026-10-16 | C 2026-11-30 | D 2026-10-16 | E 2026-10-16 | F 2026-11-30 | G 2026-10-15'
select invoice_number, due_date from invoices where id::text like '00000000-0000-4000-8000-0000000011%' order by invoice_number;
\echo '--- certificação = emissão + 10 dias úteis: espera A 2026-10-19 (12/10 feriado) | C 2026-11-30 (15/11 e 20/11 feriados)'
select invoice_number, data_limite_certificacao from invoices where invoice_number in ('A-ABERTA', 'C-OND') order by 1;
\echo '--- anterior guardado para desfazer: espera A 2026-10-16 e G 2026-09-29 (2 linhas)'
select invoice_number, due_date_anterior from vencimentos_anteriores_011 where invoice_id like '00000000-0000-4000-8000-0000000011%' order by 1;
delete from payment_allocations where invoice_id::text like '00000000-0000-4000-8000-0000000011%';
delete from vencimentos_anteriores_011 where invoice_id like '00000000-0000-4000-8000-0000000011%';
delete from invoices where id::text like '00000000-0000-4000-8000-0000000011%';
