-- Testes do 016 (unificar sem guardar o nome duplicado). Rode com 001–015 aplicados.
\set ON_ERROR_STOP 1
create or replace function pg_temp.as_user(uid uuid) returns text language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;
-- situação deixada pelo 015: duplicado já excluído, nome antigo nos "outros nomes" e numa fatura
insert into oms (id, codigo, nome, tipo, ativo, nomes_alternativos) values
 ('00000000-0000-4000-8000-0000000016a1', '40030', 'Diretoria Teste 016', 'TERRA', true, '{}'),
 ('00000000-0000-4000-8000-0000000016b2', '40031', 'DIRET. TESTE 016', 'TERRA', true, '{}'),
 ('00000000-0000-4000-8000-0000000016e5', '40032', 'Outra Teste 016', 'TERRA', true, '{"Apelido manual 016"}');
insert into invoices (id, invoice_number, ug, client, value, om_id) values
 (gen_random_uuid(), '40031-TC-03-2025-016-0', '40031', 'DIRET. TESTE 016', 1, '00000000-0000-4000-8000-0000000016b2');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.siscont_unificar_om_exec('00000000-0000-4000-8000-0000000016a1', '00000000-0000-4000-8000-0000000016b2');   -- versão do 015
update invoices set client = 'DIRET. TESTE 016' where invoice_number = '40031-TC-03-2025-016-0';
-- unificado antigo (012) ainda desativado
insert into oms (id, codigo, nome, tipo, ativo, desativado_em, motivo_desativacao) values
 ('00000000-0000-4000-8000-0000000016c3', '91532', 'Sub Teste 016', 'NAVIO', true, null, null),
 ('00000000-0000-4000-8000-0000000016d4', '91500', 'SUB TESTE 016', 'NAVIO', false, '2026-11-07', 'Unificada com Sub Teste 016');
update oms set nomes_alternativos = '{"SUB TESTE 016"}' where id = '00000000-0000-4000-8000-0000000016c3';
\echo '--- antes: outros nomes da que ficou (espera {"DIRET. TESTE 016"})'
select nomes_alternativos from oms where id = '00000000-0000-4000-8000-0000000016a1';
\i supabase/migrations/016_unificar_sem_nome_antigo.sql
\i supabase/migrations/016_unificar_sem_nome_antigo.sql
\echo '--- depois: espera {} {} e o apelido manual mantido; fatura com o nome que ficou; SUB TESTE 016 excluído (0)'
select id, nomes_alternativos from oms where nome like '%Teste 016' order by codigo;
select client from invoices where invoice_number = '40031-TC-03-2025-016-0';
select count(*) from oms where id = '00000000-0000-4000-8000-0000000016d4';
\echo '--- nova unificação não guarda o nome (espera {})'
insert into oms (id, codigo, nome, tipo, ativo) values ('00000000-0000-4000-8000-0000000016f6', '40033', 'OUTRA TESTE 016 X', 'TERRA', true);
select public.siscont_unificar_om_exec('00000000-0000-4000-8000-0000000016e5', '00000000-0000-4000-8000-0000000016f6');
select nomes_alternativos from oms where id = '00000000-0000-4000-8000-0000000016e5';
-- limpeza
delete from invoices where invoice_number = '40031-TC-03-2025-016-0';
delete from oms where nome like '%Teste 016';
