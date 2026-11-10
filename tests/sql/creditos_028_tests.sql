-- Testes do 028 (créditos de acerto). Rode com 001–016 aplicados.
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(uid uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;
\i supabase/migrations/028_creditos_acerto.sql
\i supabase/migrations/028_creditos_acerto.sql
grant all on all tables in schema public to authenticated;
\set ON_ERROR_STOP 0
\echo '--- Operador registra devolução (espera INSERT 0 1)'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into creditos_acerto_uso (chave, tipo, valor, documento) values ('40030-AE-10-2026-001', 'DEVOLUCAO', 20000, 'G424.2026.AC.00999');
\echo '--- valor zero e tipo inválido são recusados (espera 2 ERROS check)'
insert into creditos_acerto_uso (chave, tipo, valor) values ('x', 'DEVOLUCAO', 0);
insert into creditos_acerto_uso (chave, tipo, valor) values ('x', 'OUTRO', 10);
\echo '--- Consulta lê (espera 1) mas não grava (espera ERRO row-level security)'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select count(*) from creditos_acerto_uso;
insert into creditos_acerto_uso (chave, tipo, valor) values ('x', 'DEVOLUCAO', 10);
reset role;
\echo '--- auditoria registrou a inclusão (espera 1)'
select count(*) from auditoria where tabela = 'creditos_acerto_uso' and acao = 'INSERT';
delete from creditos_acerto_uso where chave = '40030-AE-10-2026-001';
