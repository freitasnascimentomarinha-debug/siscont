-- Testes do 029 (histórico da OM com vigência). Com 001 e 002 aplicados (o resto da cadeia não é necessário).
\set ON_ERROR_STOP 0
\pset footer off
create table if not exists public.received_documents (id uuid primary key default gen_random_uuid(), client text, document_number text);
grant all on public.received_documents to authenticated, service_role;
insert into setores (id, sigla, ordem) values ('00000000-0000-4000-8000-00000000a001', 'S29A', 1), ('00000000-0000-4000-8000-00000000a002', 'S29B', 2) on conflict do nothing;
insert into comandos (id, codigo, nome, setor_id) values ('00000000-0000-4000-8000-00000000c001', '90001', 'Comando Velho 029', '00000000-0000-4000-8000-00000000a001'),
 ('00000000-0000-4000-8000-00000000c002', '90002', 'Comando Novo 029', '00000000-0000-4000-8000-00000000a002') on conflict do nothing;
insert into oms (id, codigo, nome, sigla, tipo, comando_id, setor_id) values
 ('00000000-0000-4000-8000-0000000029a1', '90010', 'Centro Antigo 029', 'CA29', 'TERRA', '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000a001'),
 ('00000000-0000-4000-8000-0000000029a2', '90011', 'Outra OM 029', null, 'TERRA', null, null);
insert into received_documents (id, client, document_number) values
 ('00000000-0000-4000-8000-0000000029d1', 'Centro Antigo 029', 'G1.2026.AC.29001'),   -- liga pelo nome
 ('00000000-0000-4000-8000-0000000029d2', 'centro antigo 029 ', 'G1.2026.AC.29002'),  -- liga mesmo com caixa e espaço
 ('00000000-0000-4000-8000-0000000029d3', 'Ninguém 029', 'G1.2026.AC.29003');         -- sem OM
\i supabase/migrations/029_om_historico_vigencia.sql
\i supabase/migrations/029_om_historico_vigencia.sql
\echo '--- 1. documentos ligados à OM pelo nome (espera t, t, null)'
select document_number, om_id = '00000000-0000-4000-8000-0000000029a1' as ligada from received_documents where document_number like 'G1.2026.AC.290%' order by 1;

grant select on all tables in schema public to authenticated;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
\echo '--- 2. OPERADOR muda nome, UG e comando com vigência no passado (espera 3 campos)'
select om_alterar_dados('00000000-0000-4000-8000-0000000029a1', 'Centro Novo 029', '90020', '00000000-0000-4000-8000-00000000c002', null, null, '2026-09-15', 'Reestruturação', 'Port. 29/2026');
reset role;
\echo '--- 3. nome antigo em nomes alternativos, UG antiga em codigos_anteriores, comando novo (espera Centro Novo 029 | {Centro Antigo 029} | {90010} | 90020 | c002)'
select nome, nomes_alternativos, codigos_anteriores, codigo, comando_id = '00000000-0000-4000-8000-00000000c002' as comando_novo from oms where id = '00000000-0000-4000-8000-0000000029a1';
\echo '--- 4. histórico: 3 linhas com rótulos legíveis'
select campo, rotulo_anterior, rotulo_novo, vigente_desde, motivo, ato from om_historico where om_id = '00000000-0000-4000-8000-0000000029a1' order by campo;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
\echo '--- 5. recusas (espera 5 erros): futura, sem data, nada mudou, UG inválida, comando inexistente'
select om_alterar_dados('00000000-0000-4000-8000-0000000029a1', 'X', null, null, null, null, current_date + 1, null, null);
select om_alterar_dados('00000000-0000-4000-8000-0000000029a1', 'X', null, null, null, null, null, null, null);
select om_alterar_dados('00000000-0000-4000-8000-0000000029a1', 'Centro Novo 029', null, null, null, null, '2026-09-16', null, null);
select om_alterar_dados('00000000-0000-4000-8000-0000000029a1', null, '12', null, null, null, '2026-09-16', null, null);
select om_alterar_dados('00000000-0000-4000-8000-0000000029a1', null, null, gen_random_uuid(), null, null, '2026-09-16', null, null);
\echo '--- 6. LEITOR não altera (espera erro) e lê o histórico (espera 3)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
select om_alterar_dados('00000000-0000-4000-8000-0000000029a2', 'Tentativa', null, null, null, null, '2026-09-16', null, null);
select count(*) from om_historico where om_id = '00000000-0000-4000-8000-0000000029a1';
\echo '--- 7. mudar o nome de novo guarda os dois nomes antigos e não repete o atual (espera {Centro Antigo 029,Centro Novo 029})'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', false);
select om_alterar_dados('00000000-0000-4000-8000-0000000029a1', 'Centro Final 029', null, null, null, null, '2026-10-01', null, null);
reset role;
select nome, nomes_alternativos from oms where id = '00000000-0000-4000-8000-0000000029a1';
-- limpeza
delete from received_documents where document_number like 'G1.2026.AC.290%';
delete from oms where nome like '%029';
delete from comandos where nome like '%029'; delete from setores where sigla like 'S29%';
