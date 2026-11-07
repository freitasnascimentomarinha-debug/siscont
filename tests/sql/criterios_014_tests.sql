-- Testes do 014 (critério de rateio). Rode com 001–013 aplicados.
\set ON_ERROR_STOP 1
insert into rubricas (ano, numero, descricao, valor_anual, valor_previsto, desconto_geral, parcela_navios, destino) values
 (2033, 5, 'Coleta de Resíduos Industriais', 0, 180000, 180000, 180000, 'TC'),
 (2033, 16, 'Defensas', 930000, 930000, 0, 520800, 'TC'),
 (2033, 38, 'Navios', 1236100, 1236100, 0, null, 'DA')
on conflict do nothing;
insert into propostas_tc (ano, status) values (2033, 'PROPOSTA') on conflict do nothing;
\i supabase/migrations/014_criterios_rateio.sql
\i supabase/migrations/014_criterios_rateio.sql
\set ON_ERROR_STOP 0
\echo '--- parte dos navios em R$ vira %: espera 5|0|100|0 e 16|100|56|0 (critério LOTACAO, SEPARADO)'
select numero, percentual_om, percentual_navios, desconto_geral, criterio, modo_navios from rubricas where ano = 2033 and numero in (5, 16) order by numero;
\echo '--- total do grupo Navios guardado na proposta: espera 1236100'
select navios_planilha from propostas_tc where ano = 2033;
\echo '--- critério e percentuais inválidos: espera 3 ERRO check'
update rubricas set criterio = 'XX' where ano = 2033 and numero = 16;
update rubricas set percentual_om = 120 where ano = 2033 and numero = 16;
update rubricas set modo_navios = 'X' where ano = 2033 and numero = 16;
\echo '--- área e peso na lotação: espera INSERT 0 1'
insert into lotacoes_tc (ano, om_id, lotacao, area, peso) select 2033, id, 10, 1500.5, 3 from oms limit 1;
\echo '--- área negativa: espera ERRO check'
insert into lotacoes_tc (ano, om_id, lotacao, area) select 2033, id, 10, -1 from oms offset 1 limit 1;
delete from lotacoes_tc where ano = 2033; delete from rubricas where ano = 2033; delete from propostas_tc where ano = 2033;
