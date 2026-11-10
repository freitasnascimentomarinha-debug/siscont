-- Testes do 027 (unificação em cadeia). Rode com 001–016 aplicados.
\set ON_ERROR_STOP 1
-- DGDNTM foi unificada em "Dir Nuclear 027"; depois "Dir Nuclear 027" foi unificada em "Diretoria-Geral Nuclear 027" (012)
insert into oms (id, codigo, nome, tipo, ativo, desativado_em, motivo_desativacao) values
 ('00000000-0000-4000-8000-0000000027c3', '20300', 'Diretoria-Geral Nuclear 027', 'TERRA', true, null, null),
 ('00000000-0000-4000-8000-0000000027b2', '20300', 'Dir Nuclear 027', 'TERRA', false, '2026-11-07', 'Unificada com Diretoria-Geral Nuclear 027'),
 ('00000000-0000-4000-8000-0000000027a1', '20300', 'DGDNTM 027', 'TERRA', false, '2026-11-07', 'Unificada com Dir Nuclear 027'),
 -- unificada sem destino e sem dados → excluída; com dados → fica
 ('00000000-0000-4000-8000-0000000027d4', '99990', 'Fantasma 027', 'TERRA', false, '2026-11-07', 'Unificada com Não Existe 027'),
 ('00000000-0000-4000-8000-0000000027e5', '99991', 'Com Fatura 027', 'TERRA', false, '2026-11-07', 'Unificada com Também Não 027');
insert into invoices (id, invoice_number, ug, client, value, om_id) values
 (gen_random_uuid(), '20300-TC-01-2025-027-0', '20300', 'DGDNTM 027', 1, '00000000-0000-4000-8000-0000000027a1'),
 (gen_random_uuid(), '99991-TC-01-2025-027-0', '99991', 'Com Fatura 027', 1, '00000000-0000-4000-8000-0000000027e5');
-- o 016 conclui "Dir Nuclear" mas não acha o destino da DGDNTM (nome excluído)
\i supabase/migrations/016_unificar_sem_nome_antigo.sql
\echo '--- depois do 016: DGDNTM 027 continua desativada (espera 1)'
select count(*) from oms where id = '00000000-0000-4000-8000-0000000027a1';
\i supabase/migrations/027_unificadas_em_cadeia.sql
\i supabase/migrations/027_unificadas_em_cadeia.sql
\echo '--- depois do 027: DGDNTM excluída (0), fatura na Diretoria-Geral com o nome dela; Fantasma excluída (0); Com Fatura fica (1) com motivo de unificação incompleta'
select count(*) from oms where id = '00000000-0000-4000-8000-0000000027a1';
select client, om_id = '00000000-0000-4000-8000-0000000027c3' as ligada from invoices where invoice_number = '20300-TC-01-2025-027-0';
select count(*) from oms where id = '00000000-0000-4000-8000-0000000027d4';
select count(*), min(motivo_desativacao) from oms where id = '00000000-0000-4000-8000-0000000027e5';
-- limpeza
delete from invoices where invoice_number like '%-2025-027-0';
update oms set ativo = true, desativado_em = null, motivo_desativacao = null where nome like '%027';
delete from oms where nome like '%027';
