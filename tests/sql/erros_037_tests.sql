-- Testes do 037 (registro de erros). Com 001–036 aplicados.
\set ON_ERROR_STOP 0
\pset footer off
\i supabase/migrations/037_registro_de_erros.sql
\i supabase/migrations/037_registro_de_erros.sql
grant all on all tables in schema public to authenticated, service_role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000037a1', 'adm37@mb.br'), ('00000000-0000-0000-0000-0000000037b1', 'op37@mb.br') on conflict do nothing;
insert into profiles (id, name, email, role, active) values ('00000000-0000-0000-0000-0000000037a1', 'Adm37', 'adm37@mb.br', 'ADMIN', true), ('00000000-0000-0000-0000-0000000037b1', 'Op37', 'op37@mb.br', 'USER', true) on conflict (id) do update set role = excluded.role, active = true;
delete from erros_sistema;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037b1","role":"authenticated"}', false);
\echo '--- 1. usuário comum grava erro em seu nome (ok)'
insert into erros_sistema (user_id, email, pagina, mensagem) values ('00000000-0000-0000-0000-0000000037b1', 'op37@mb.br', 'invoices', 'teste de erro');
\echo '--- 2. usuário comum NÃO grava em nome de outro (erro)'
insert into erros_sistema (user_id, mensagem) values ('00000000-0000-0000-0000-0000000037a1', 'falso');
\echo '--- 3. usuário comum não lê (espera 0)'
select count(*) from erros_sistema;
\echo '--- 4. usuário comum não apaga nem marca (espera 0 e 0)'
update erros_sistema set resolvido = true; delete from erros_sistema;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000037a1","role":"authenticated"}', false);
\echo '--- 5. admin lê (espera 1)'
select count(*) from erros_sistema;
\echo '--- 6. admin marca como resolvido (espera t)'
update erros_sistema set resolvido = true; select resolvido from erros_sistema;
\echo '--- 7. mensagem enorme recusada (erro)'
insert into erros_sistema (mensagem) values (repeat('x', 1001));
\echo '--- 8. admin apaga (espera 0)'
delete from erros_sistema; select count(*) from erros_sistema;
