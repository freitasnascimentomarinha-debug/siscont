-- =====================================================================
-- SISCONT - 036: vários setores, cada um com a sua função, por usuário
-- ---------------------------------------------------------------------
-- Idempotente: pode ser executado novamente. Não apaga nem altera dados existentes.
--  1. profiles.atribuicoes (jsonb): lista de pares {setor, funcao}, por exemplo
--     [{"setor":"FATURAMENTO","funcao":"ENCARREGADO_SETOR"},{"setor":"CUSTOS","funcao":"AUXILIAR"}].
--     Máximo 3 itens, sem setor repetido, setores e funções só os aceitos (iguais ao script 035).
--  2. O que já estava em setor/funcao (script 035) vira o primeiro par da lista.
--     As colunas setor e funcao continuam existindo e guardam o primeiro par ("principal").
--  3. O gatilho de proteção passa a proteger também atribuicoes: só o administrador / servidor altera.
--  Continua só informativo: não restringe o acesso a nada.
-- =====================================================================

alter table public.profiles add column if not exists atribuicoes jsonb not null default '[]'::jsonb;

-- validação da lista (função imutável para poder ser usada em CHECK)
create or replace function public.atribuicoes_validas(a jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(a) = 'array'
    and jsonb_array_length(a) <= 3
    and not exists (
      select 1 from jsonb_array_elements(a) e
      where jsonb_typeof(e) <> 'object'
         or (e->>'setor') is null
         or (e->>'setor') not in ('FATURAMENTO', 'ACOMPANHAMENTO_CONTABIL', 'CUSTOS')
         or ((e->>'funcao') is not null and (e->>'funcao') not in ('ENCARREGADO_SETOR', 'AUXILIAR'))
    )
    and (select count(distinct e->>'setor') from jsonb_array_elements(a) e) = jsonb_array_length(a)
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_atribuicoes_check') then
    alter table public.profiles
      add constraint profiles_atribuicoes_check check (public.atribuicoes_validas(atribuicoes));
  end if;
end $$;

-- o que já estava preenchido vira o primeiro par (só onde a lista ainda está vazia)
update public.profiles
   set atribuicoes = jsonb_build_array(jsonb_build_object('setor', setor, 'funcao', funcao))
 where setor is not null and atribuicoes = '[]'::jsonb;

-- proteção dos campos sensíveis do perfil (inclui atribuicoes)
-- SECURITY INVOKER de propósito (igual aos scripts 001 e 035): current_user precisa refletir quem executa.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if current_user not in ('authenticated', 'anon') or public.is_admin() then
    return new;
  end if;
  new.role := old.role;
  new.active := old.active;
  new.email := old.email;
  new.setor := old.setor;
  new.funcao := old.funcao;
  new.atribuicoes := old.atribuicoes;
  return new;
end;
$$;
