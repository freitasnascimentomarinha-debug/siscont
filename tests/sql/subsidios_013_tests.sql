-- Testes do 013 (subsídios, contratos e conferência). Rode com 001–012 aplicados.
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(uid uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;
-- o Supabase já tem o esquema storage; no teste local ele é simulado
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant all on storage.objects, storage.buckets to authenticated;
insert into rubricas (ano, numero, descricao, valor_anual) values (2032, 1, 'Telhados', 10), (2032, 35, 'Material Permanente', 5) on conflict do nothing;
\i supabase/migrations/013_subsidios_conferencia.sql
\i supabase/migrations/013_subsidios_conferencia.sql
grant all on all tables in schema public to authenticated;
revoke insert, update, delete on public.auditoria from authenticated;
\set ON_ERROR_STOP 0
\echo '--- destino PAR aceito, parcela dos navios e justificativa do valor gravam: espera UPDATE 1 e UPDATE 1'
update rubricas set destino = 'PAR' where ano = 2032 and numero = 35;
update rubricas set parcela_navios = 520800, justificativa_valor = 'Contrato 12/2032' where ano = 2032 and numero = 1;
\echo '--- parcela negativa: espera ERRO check'
update rubricas set parcela_navios = -1 where ano = 2032 and numero = 1;
\echo '--- bucket privado de contratos criado: espera contratos-tc|f'
select id, public from storage.buckets where id = 'contratos-tc';
\echo '--- Operador: inclui subsídio, anexo e arquivo; espera INSERT 0 1 (3x)'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into subsidios_tc (ano, rubrica, descricao, documento, valor) values (2032, 1, 'Contrato de telhados', 'Contrato 12/2032', 10);
insert into anexos_tc (ano, rubrica, nome_arquivo, caminho) values (2032, 1, 'contrato.pdf', '2032/1/x-contrato.pdf');
insert into storage.objects (bucket_id, name) values ('contratos-tc', '2032/1/x-contrato.pdf');
\echo '--- subsídio sem descrição: espera ERRO check'
insert into subsidios_tc (ano, rubrica, descricao, valor) values (2032, 1, '  ', 1);
\echo '--- Consulta lê (espera 1|1) mas não inclui (espera ERRO row-level security 2x)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select (select count(*) from subsidios_tc where ano = 2032), (select count(*) from storage.objects where bucket_id = 'contratos-tc');
insert into subsidios_tc (ano, rubrica, descricao, valor) values (2032, 1, 'Não pode', 1);
insert into storage.objects (bucket_id, name) values ('contratos-tc', '2032/1/nao.pdf');
reset role;
\echo '--- conferência: valor fechado (OM e navio) e extrato gravam: espera 2|1'
insert into fechados_tc (ano, nome, tipo, mensal) values (2032, 'SecNSNQ (Ed.23)', 'TC', 10057.36), (2032, 'CORVETA CLASSE BARROSO', 'DA', 403.86);
insert into extratos_tc (ano, nome, rubrica, bruto, desconto, liquido) values (2032, 'SecNSNQ', 1, 4712.22, 1107.37, 3604.85);
select (select count(*) from fechados_tc where ano = 2032), (select count(*) from extratos_tc where ano = 2032);
\echo '--- inclusão de subsídio fica na auditoria: espera t'
select count(*) > 0 from auditoria where tabela = 'subsidios_tc';
-- limpeza
delete from subsidios_tc where ano = 2032; delete from anexos_tc where ano = 2032; delete from storage.objects where name like '2032/%';
delete from fechados_tc where ano = 2032; delete from extratos_tc where ano = 2032; delete from rubricas where ano = 2032;
