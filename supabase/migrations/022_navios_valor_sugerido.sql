-- =====================================================================
-- SISCONT - 022: parte dos navios sobre o VALOR SUGERIDO (previsto) da linha
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 021. Idempotente.
-- O valor destinado aos navios é o valor sugerido da rubrica (coluna "VALOR PARA <ano>" da proposta),
-- antes do desconto geral e sem os descontos das OM. A opção "sugerido − desconto geral" continua
-- disponível na tela (base_navios = 'VIGENTE').
-- =====================================================================
alter table public.propostas_tc alter column base_navios set default 'PREVISTO';
update public.propostas_tc set base_navios = 'PREVISTO' where base_navios = 'VIGENTE';
