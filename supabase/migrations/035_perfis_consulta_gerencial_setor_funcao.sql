-- =====================================================================
-- SISCONT - 035: perfil CONSULTA_GERENCIAL + setor e função do usuário
-- ---------------------------------------------------------------------
-- Idempotente: pode ser executado novamente.
--  1. Novo perfil CONSULTA_GERENCIAL ("Consulta Gerencial"): Painel inicial e
--     Painel do Encarregado, só para ver. No banco ele é só leitura, como
--     CONSULTA e ENCARREGADO: as políticas de escrita continuam liberadas
--     apenas para ADMIN e USER (can_write() / is_admin()), então nada muda nelas.
--  2. O perfil ENCARREGADO (rótulo "Encarregado da Divisão") passa a ver todas as
--     páginas, menos a Administração - isso é só tela; no banco continua só leitura.
--  3. Colunas informativas setor e funcao no perfil do usuário. Por enquanto NÃO
--     restringem nada: a divisão é pequena e todos cobrem todos os setores. Ficam
--     prontas para quando houver mais pessoal por setor.
--  4. O gatilho de proteção do perfil passa a proteger também setor e funcao:
--     o usuário comum não pode alterar os próprios (só o administrador / servidor).
-- =====================================================================

-- 1. Perfis aceitos -----------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('ADMIN', 'USER', 'READ_ONLY', 'ENCARREGADO', 'TREINAMENTO', 'CONSULTA_GERENCIAL'));

-- 3. Setor e função (informativos) --------------------------------------
alter table public.profiles add column if not exists setor text;
alter table public.profiles add column if not exists funcao text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_setor_check') then
    alter table public.profiles
      add constraint profiles_setor_check
      check (setor is null or setor in ('FATURAMENTO', 'ACOMPANHAMENTO_CONTABIL', 'CUSTOS'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_funcao_check') then
    alter table public.profiles
      add constraint profiles_funcao_check
      check (funcao is null or funcao in ('ENCARREGADO_SETOR', 'AUXILIAR'));
  end if;
end $$;

-- 4. Proteção dos campos sensíveis do perfil (inclui setor e funcao) -----
-- SECURITY INVOKER de propósito (igual ao script 001): current_user precisa refletir quem executa.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- Servidor (service_role), Auth, gatilhos internos e administradores podem tudo
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;
  -- Usuário comum: só pode alterar o próprio nome
  new.role := old.role;
  new.active := old.active;
  new.email := old.email;
  new.setor := old.setor;
  new.funcao := old.funcao;
  return new;
end;
$$;
