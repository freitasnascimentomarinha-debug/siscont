-- =====================================================================
-- SISCONT - 003: OM sem código próprio e indicativo naval do comando
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 002 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. oms.codigo_proprio: false quando a OM/navio não tem código e usa o
--     código do seu comando, ou quando o cliente extra-MB usa o código da
--     BNIC (40015). O campo `codigo` continua guardando o código usado
--     no número da fatura.
--  2. comandos.indicativo_naval: endereço das mensagens de envio e de
--     cobrança das faturas (as mensagens vão para o comando).
--  3. Setores antigos que mudaram de sigla (CON → COMOPNAV;
--     CCSM / CCSM-RIO → CCEM-RIO), caso já tenham sido criados por uma
--     importação anterior: comandos e OM passam para o setor atual e o
--     setor antigo é removido.
-- =====================================================================

alter table public.oms add column if not exists codigo_proprio boolean not null default true;
alter table public.comandos add column if not exists indicativo_naval text;

-- Indicativo naval: letras e números, até 8 caracteres (ex.: COMEST, AMRJRJ)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'oms_indicativo_ck') then
    alter table public.oms add constraint oms_indicativo_ck
      check (indicativo_naval is null or indicativo_naval ~ '^[A-Z0-9]{2,8}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'comandos_indicativo_ck') then
    alter table public.comandos add constraint comandos_indicativo_ck
      check (indicativo_naval is null or indicativo_naval ~ '^[A-Z0-9]{2,8}$');
  end if;
end $$;

-- Setores renomeados
do $$
declare
  par record;
  novo uuid;
begin
  for par in select * from (values ('CON', 'COMOPNAV'), ('CCSM', 'CCEM-RIO'), ('CCSM-RIO', 'CCEM-RIO')) as v(antigo, atual) loop
    select id into novo from public.setores where upper(sigla) = par.atual;
    if novo is null then continue; end if;
    update public.comandos set setor_id = novo
     where setor_id in (select id from public.setores where upper(sigla) = par.antigo);
    update public.oms set setor_id = novo
     where setor_id in (select id from public.setores where upper(sigla) = par.antigo);
    delete from public.setores where upper(sigla) = par.antigo;
  end loop;
end $$;

-- "AMAZUL" não é setor (é o cliente Amazônia Azul, setor CM): desfaz se tiver sido criado
do $$
declare cm uuid;
begin
  select id into cm from public.setores where upper(sigla) = 'CM';
  if cm is not null then
    update public.comandos set setor_id = cm where setor_id in (select id from public.setores where upper(sigla) = 'AMAZUL');
    update public.oms set setor_id = cm where setor_id in (select id from public.setores where upper(sigla) = 'AMAZUL');
    delete from public.setores where upper(sigla) = 'AMAZUL';
  end if;
end $$;
