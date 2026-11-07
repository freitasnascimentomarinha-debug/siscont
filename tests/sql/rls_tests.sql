\set ON_ERROR_STOP 0
\pset footer off
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false) $$;

\echo '--- 1. Novo auto-cadastro entra PENDENTE (active=false) como Consulta'
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000000e','novo@mb.br','{"name":"Novo"}');
select name, role, active from profiles where email='novo@mb.br';

\echo '--- 2. Criado pelo admin (API) entra ATIVO'
insert into auth.users (id,email,raw_user_meta_data,raw_app_meta_data) values ('00000000-0000-0000-0000-00000000000f','api@mb.br','{"name":"Via API"}','{"created_by_admin":true}');
select name, role, active from profiles where email='api@mb.br';

set role authenticated;
\echo '--- 3. Consulta (Leitor): LÊ faturas, NÃO grava'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select count(*) as faturas_visiveis from invoices;
insert into invoices values (gen_random_uuid(), 5);
update invoices set value = 1;
select value as valor_inalterado from invoices;

\echo '--- 4. Consulta tenta se promover a ADMIN (deve continuar READ_ONLY)'
update profiles set role='ADMIN', name='Leitor Renomeado' where id = auth.uid();
select name, role from profiles where id = auth.uid();
\echo '    e só enxerga o próprio perfil:'
select count(*) as perfis_visiveis from profiles;

\echo '--- 5. Operador grava faturas, mas não vê/edita outros perfis'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into invoices values ('22222222-0000-0000-0000-000000000002', 50);
select count(*) as faturas from invoices;
update profiles set role='READ_ONLY' where email='admin@mb.br';
reset role; select role as role_admin_intacto from profiles where email='admin@mb.br'; set role authenticated;

\echo '--- 6. Pendente (Novo) não lê nada'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select count(*) as faturas_visiveis_pendente from invoices;

\echo '--- 7. Admin vê todos, edita perfil alheio, mas não exclui a si mesmo'
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select count(*) as perfis_visiveis_admin from profiles;
update profiles set active = true, role='USER' where email='novo@mb.br';
delete from profiles where id = auth.uid();
reset role;
select name, role, active from profiles where email in ('novo@mb.br','admin@mb.br') order by email;

\echo '--- 8. Admin bloqueado perde acesso de admin'
update profiles set active=false where email='oper@mb.br';
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select count(*) as faturas_visiveis_bloqueado from invoices;
insert into invoices values (gen_random_uuid(), 7);
reset role;

\echo '--- 9. Excluir login apaga o perfil (cascata)'
delete from auth.users where email='api@mb.br';
select count(*) as perfil_restante from profiles where email='api@mb.br';

\echo '--- 10. Troca de e-mail no Auth reflete no perfil'
update auth.users set email='admin2@mb.br' where email='admin@mb.br';
select email from profiles where name='Admin';
