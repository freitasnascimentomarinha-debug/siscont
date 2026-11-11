-- Testes do 032 (regime de fim de exercício por serviço, com exceções por OM). Com 001–003 aplicados e a tabela invoices com
-- as colunas om_id, service_acronym, month_competence, year_competence, is_canceled, acerto_de e value.
\set ON_ERROR_STOP 0
\pset footer off
alter table public.invoices add column if not exists ug text, add column if not exists client text, add column if not exists om_id uuid, add column if not exists service_acronym text, add column if not exists month_competence int,
  add column if not exists year_competence int, add column if not exists is_canceled boolean default false, add column if not exists acerto_de text, add column if not exists value numeric;
delete from public.invoices where ug = 'T32';
insert into oms (id, codigo, nome, tipo) values
 ('00000000-0000-4000-8000-000000032a01', '90301', 'OM 32 A (estima)', 'TERRA'),
 ('00000000-0000-4000-8000-000000032a02', '90302', 'OM 32 B (sem out-dez)', 'TERRA'),
 ('00000000-0000-4000-8000-000000032a03', '90303', 'OM 32 C (mensal)', 'TERRA'),
 ('00000000-0000-4000-8000-000000032a04', '90304', 'OM 32 D (RB com outubro)', 'TERRA') on conflict do nothing;
-- 2025: AE — A estima (out sem nov/dez), B não tem out-dez, C fatura mensal out/nov/dez; RB — D só outubro
insert into invoices (id, ug, client, om_id, service_acronym, year_competence, month_competence, value, is_canceled)
select gen_random_uuid(), 'T32', 'x', o.om, o.sg, 2025, m, 100, false
  from (values ('00000000-0000-4000-8000-000000032a01'::uuid, 'AE', array[1,2,3,4,5,6,7,8,9,10]),
               ('00000000-0000-4000-8000-000000032a02'::uuid, 'AE', array[1,2,3,4,5,6,7,8,9]),
               ('00000000-0000-4000-8000-000000032a03'::uuid, 'AE', array[1,2,3,4,5,6,7,8,9,10,11,12]),
               ('00000000-0000-4000-8000-000000032a04'::uuid, 'RB', array[1,2,3,4,5,6,7,8,9,10])) as o (om, sg, ms), unnest(o.ms) m;
-- uma fatura cancelada de nov/2025 da OM A não pode mudar o padrão dela
insert into invoices (id, ug, client, om_id, service_acronym, year_competence, month_competence, value, is_canceled)
values (gen_random_uuid(), 'T32', 'x', '00000000-0000-4000-8000-000000032a01', 'AE', 2025, 11, 100, true);

\i supabase/migrations/032_regime_ond.sql
\i supabase/migrations/032_regime_ond.sql
grant all on all tables in schema public to authenticated, service_role;
\echo '--- 1. regra por serviço (espera AE=1 e RB=3 com 2026; TL, EX sem regra)'
select sigla, regime, ano_inicio from regime_ond where escopo = 'SERVICO' order by sigla;
\echo '--- 2. exceções criadas só para as OMs deste teste: B (sem out-dez → 3) e C (mensal → 2); A segue a regra; D (RB com outubro) NÃO vira exceção'
select o.nome, r.sigla, r.regime from regime_ond r join oms o on o.id = r.om_id where r.escopo = 'OM' and o.nome like 'OM 32%' order by o.nome;
\echo '--- 3. idempotência: rodou 2 vezes e não duplicou (espera 0 duplicadas)'
select count(*) as duplicadas from (select escopo, sigla, om_id, ano_inicio, count(*) from regime_ond where origem = 'MIGRACAO' group by 1, 2, 3, 4 having count(*) > 1) x;
\echo '--- 4. nenhuma fatura foi alterada (espera 42 linhas, soma 4200, a cancelada inclusa)'
select count(*), sum(value) from invoices where ug = 'T32';

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', false);
\echo '--- 5. OPERADOR registra uma nova regra e uma exceção (espera 2 inserts) e o nome dele fica gravado'
insert into regime_ond (escopo, sigla, ano_inicio, regime, motivo) values ('SERVICO', 'TL', 2026, 3, 'teste');
insert into regime_ond (escopo, sigla, om_id, ano_inicio, regime, motivo) values ('OM', 'AE', '00000000-0000-4000-8000-000000032a01', 2027, null, 'volta a seguir a regra');
select escopo, sigla, regime, origem, criado_por is not null as tem_usuario from regime_ond where motivo in ('teste', 'volta a seguir a regra') order by escopo;
\echo '--- 6. histórico imutável: UPDATE e DELETE recusados (espera 2 erros) e nada muda'
update regime_ond set regime = 2 where sigla = 'TL' and motivo = 'teste';
delete from regime_ond where sigla = 'TL' and motivo = 'teste';
select regime from regime_ond where sigla = 'TL' and motivo = 'teste';
\echo '--- 7. regras inválidas recusadas (espera 3 erros): regime 4, serviço sem escopo certo, OM sem om_id'
insert into regime_ond (escopo, sigla, ano_inicio, regime) values ('SERVICO', 'XX', 2026, 4);
insert into regime_ond (escopo, sigla, om_id, ano_inicio, regime) values ('SERVICO', 'XX', '00000000-0000-4000-8000-000000032a01', 2026, 1);
insert into regime_ond (escopo, sigla, ano_inicio, regime) values ('OM', 'XX', 2026, 1);
\echo '--- 8. LEITOR lê mas não grava (espera erro no insert e count > 0)'
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', false);
insert into regime_ond (escopo, sigla, ano_inicio, regime) values ('SERVICO', 'EX', 2026, 1);
select count(*) > 0 as le from regime_ond;
reset role;
\echo '--- 9. nem o administrador do banco apaga (espera erro)'
delete from regime_ond where sigla = 'TL';
-- limpeza: o histórico é imutável de propósito; no banco de teste desliga o gatilho só para limpar
alter table regime_ond disable trigger regime_ond_imutavel_trg;
delete from regime_ond; delete from invoices where ug = 'T32'; delete from oms where nome like 'OM 32%';
alter table regime_ond enable trigger regime_ond_imutavel_trg;
