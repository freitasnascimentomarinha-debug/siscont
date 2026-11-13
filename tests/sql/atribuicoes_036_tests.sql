-- Testes do 036 (vários setores por usuário). Com 001–035 aplicados.
\set ON_ERROR_STOP 0
\pset footer off
\i supabase/migrations/035_perfis_consulta_gerencial_setor_funcao.sql
\i supabase/migrations/036_atribuicoes_usuario.sql
\i supabase/migrations/036_atribuicoes_usuario.sql
grant all on all tables in schema public to authenticated, service_role;
-- usuários de teste (como superusuário): um admin e um comum, este já com o par antigo setor/funcao do script 035
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000036a1', 'adm36@mb.br'), ('00000000-0000-0000-0000-0000000036b1', 'op36@mb.br') on conflict do nothing;
insert into profiles (id, name, email, role, active) values ('00000000-0000-0000-0000-0000000036a1', 'Adm36', 'adm36@mb.br', 'ADMIN', true), ('00000000-0000-0000-0000-0000000036b1', 'Op36', 'op36@mb.br', 'USER', true) on conflict (id) do update set role = excluded.role, active = true;
update profiles set setor = 'CUSTOS', funcao = 'AUXILIAR', atribuicoes = '[]' where id = '00000000-0000-0000-0000-0000000036b1';
\i supabase/migrations/036_atribuicoes_usuario.sql
\echo '--- 1. o par antigo vira o primeiro item da lista (espera [{"setor": "CUSTOS", "funcao": "AUXILIAR"}])'
select atribuicoes from profiles where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 2. admin grava dois setores com funções (espera 2)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000036a1","role":"authenticated"}', false);
update profiles set atribuicoes = '[{"setor":"FATURAMENTO","funcao":"ENCARREGADO_SETOR"},{"setor":"CUSTOS","funcao":"AUXILIAR"}]' where id = '00000000-0000-0000-0000-0000000036b1';
select jsonb_array_length(atribuicoes) from profiles where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 3. setor repetido recusado (erro)'
update profiles set atribuicoes = '[{"setor":"CUSTOS"},{"setor":"CUSTOS","funcao":"AUXILIAR"}]' where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 4. setor inexistente recusado (erro)'
update profiles set atribuicoes = '[{"setor":"COZINHA"}]' where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 5. função inexistente recusada (erro)'
update profiles set atribuicoes = '[{"setor":"CUSTOS","funcao":"REI"}]' where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 6. mais de 3 recusado (erro)'
update profiles set atribuicoes = '[{"setor":"CUSTOS"},{"setor":"FATURAMENTO"},{"setor":"ACOMPANHAMENTO_CONTABIL"},{"setor":"CUSTOS"}]' where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 7. não é lista (objeto) recusado (erro)'
update profiles set atribuicoes = '{"setor":"CUSTOS"}' where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 8. função é opcional (espera 1)'
update profiles set atribuicoes = '[{"setor":"CUSTOS"}]' where id = '00000000-0000-0000-0000-0000000036b1';
select jsonb_array_length(atribuicoes) from profiles where id = '00000000-0000-0000-0000-0000000036b1';
\echo '--- 9. usuário comum NÃO altera a própria lista (espera continuar com 1 item de CUSTOS)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000036b1","role":"authenticated"}', false);
update profiles set atribuicoes = '[{"setor":"FATURAMENTO","funcao":"ENCARREGADO_SETOR"}]', name = 'Op36 novo' where id = '00000000-0000-0000-0000-0000000036b1';
select atribuicoes, name from profiles where id = '00000000-0000-0000-0000-0000000036b1';
reset role;
