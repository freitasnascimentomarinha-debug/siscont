-- Testes do 030 (perfil Treinamento). Com 001 aplicado (e 018 se existir).
\set ON_ERROR_STOP 0
\pset footer off
\i supabase/migrations/030_perfil_treinamento.sql
\i supabase/migrations/030_perfil_treinamento.sql
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000f1','treino@mb.br','{"name":"Treino"}');
update profiles set role='TREINAMENTO', active=true where id='00000000-0000-0000-0000-0000000000f1';
\echo '--- 1. perfil TREINAMENTO aceito (espera TREINAMENTO) e valor inválido recusado (espera erro)'
select role from profiles where id='00000000-0000-0000-0000-0000000000f1';
update profiles set role='QUALQUER' where id='00000000-0000-0000-0000-0000000000f1';
\echo '--- 2. TREINAMENTO lê mas NÃO grava (espera: can_write f, is_admin f, is_active_user t)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', false);
select can_write(), is_admin(), is_active_user();
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', false);
\echo '--- 3. escrever em fatura (espera 0 linhas alteradas) e ler (espera 1)'
update invoices set value = 999;
select count(*) from invoices where value = 999;
select count(*) > 0 as le_faturas from invoices;
reset role;
delete from auth.users where id='00000000-0000-0000-0000-0000000000f1';
