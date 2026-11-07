-- Testes do 015 (unificar exclui o duplicado). Rode com 001–014 aplicados.
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(uid uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;
-- já unificado antes (desativado), com faturas já passadas e uma antiga sem ligação
insert into oms (id, codigo, nome, tipo, ativo, desativado_em, motivo_desativacao) values
 ('00000000-0000-4000-8000-0000000015a1', '91532', 'Submarino Timbira 015', 'NAVIO', true, null, null),
 ('00000000-0000-4000-8000-0000000015b2', '91500', 'Submarino Timbira 015', 'NAVIO', false, '2026-11-07', 'Unificada com Submarino Timbira 015');
insert into invoices (id, invoice_number, ug, client, value, om_id) values
 (gen_random_uuid(), '91500-TC-01-2025-001-0', '91500', 'Submarino Timbira 015', 1, '00000000-0000-4000-8000-0000000015a1'),
 (gen_random_uuid(), '91500-TC-02-2025-001-0', '91500', 'SUBMARINO TIMBIRA 015', 1, null);
-- par novo para unificar pela tela
insert into oms (id, codigo, nome, tipo, ativo) values
 ('00000000-0000-4000-8000-0000000015c3', '40030', 'Diretoria Teste 015', 'TERRA', true),
 ('00000000-0000-4000-8000-0000000015d4', '40031', 'DIRETORIA TESTE 015', 'TERRA', true);
insert into invoices (id, invoice_number, ug, client, value, om_id) values
 (gen_random_uuid(), '40031-TC-03-2025-001-0', '40031', 'DIRETORIA TESTE 015', 1, '00000000-0000-4000-8000-0000000015d4');
\i supabase/migrations/015_unificar_exclui.sql
\i supabase/migrations/015_unificar_exclui.sql
grant all on all tables in schema public to authenticated;
\echo '--- limpeza: Timbira 91500 excluído (espera 0) e as 2 faturas na OM que fica (espera 2)'
select count(*) from oms where id = '00000000-0000-4000-8000-0000000015b2';
select count(*) from invoices where invoice_number like '91500-TC-0%-2025-001-0' and om_id = '00000000-0000-4000-8000-0000000015a1';
\set ON_ERROR_STOP 0
\echo '--- Operador não unifica (espera ERRO) nem chama a rotina interna (espera ERRO permissão)'
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.unificar_om('00000000-0000-4000-8000-0000000015c3', '00000000-0000-4000-8000-0000000015d4');
select public.siscont_unificar_om_exec('00000000-0000-4000-8000-0000000015c3', '00000000-0000-4000-8000-0000000015d4');
\echo '--- Admin unifica: espera 1 registro movido; duplicado excluído (0); fatura com o nome da que fica; nome antigo alternativo'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.unificar_om('00000000-0000-4000-8000-0000000015c3', '00000000-0000-4000-8000-0000000015d4');
reset role;
select count(*) from oms where id = '00000000-0000-4000-8000-0000000015d4';
select client, ug, om_id = '00000000-0000-4000-8000-0000000015c3' as ligada from invoices where invoice_number = '40031-TC-03-2025-001-0';
select nomes_alternativos from oms where id = '00000000-0000-4000-8000-0000000015c3';
\echo '--- OM com fatura continua sem poder ser excluída (espera ERRO possui faturas)'
delete from oms where id = '00000000-0000-4000-8000-0000000015c3';
-- limpeza
delete from invoices where invoice_number like '%-2025-001-0' and client ilike '%015%';
delete from oms where nome ilike '%015' and codigo in ('91532', '40030');
