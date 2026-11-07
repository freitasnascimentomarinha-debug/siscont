insert into setores (sigla, ordem) values ('CON', 500), ('CCSM-RIO', 500), ('AMAZUL', 500);
insert into comandos (codigo, nome, setor_id) select '91600', 'Comando da Força de Superfície', id from setores where sigla='CON';
insert into oms (codigo, nome, tipo, setor_id) select '10300', 'Amazônia Azul', 'TERRA', id from setores where sigla='AMAZUL';
insert into oms (codigo, nome, tipo, setor_id) select '11101', 'CCEM-Rio', 'TERRA', id from setores where sigla='CCSM-RIO';
-- Rode o 003 entre o bloco acima e as verificações abaixo.
\set ON_ERROR_STOP 0
\echo '--- setores antigos (CON, CCSM-RIO, AMAZUL) não devem existir mais'
select string_agg(sigla, ', ' order by sigla) as setores from setores;
\echo '--- comando que estava em CON agora é COMOPNAV; Amazônia Azul em CM'
select c.nome, s.sigla from comandos c join setores s on s.id = c.setor_id where c.codigo = '91600';
select o.nome, s.sigla from oms o join setores s on s.id = o.setor_id where o.codigo = '10300';
\echo '--- indicativo inválido é recusado (espaço/minúsculas; mais de 8 caracteres)'
update oms set indicativo_naval = 'com est' where codigo = '10300';
update comandos set indicativo_naval = 'COMFORSUP' where codigo = '91600';
