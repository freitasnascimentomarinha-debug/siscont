-- =====================================================================
-- SISCONT - 002: Cadastros da Fase 1
-- ---------------------------------------------------------------------
-- Executar UMA VEZ no Supabase (SQL Editor > New query > colar > Run),
-- DEPOIS do 001. Idempotente: pode ser executado novamente sem perder dados.
--
--  1. Hierarquia de clientes: setores -> comandos -> oms
--  2. Classes de navio
--  3. Desativação sem exclusão (ativo + datas + motivo) em comandos,
--     classes e OM; exclusão física só para cadastro sem movimento
--  4. Catálogo de serviços conforme a OI 40-04 (colunas novas em
--     service_definitions + os 11 serviços)
--  5. Parâmetros do exercício e calendário de feriados
--  6. RLS: leitura para usuários ativos; alteração só ADMIN
-- =====================================================================

create extension if not exists pgcrypto;

-- Mantém updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 1. Setores -------------------------------------------------------------
create table if not exists public.setores (
  id uuid primary key default gen_random_uuid(),
  sigla text not null,
  nome text,
  ordem int not null default 100,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists setores_sigla_uk on public.setores (upper(sigla));

-- Comandos / ComImSup ------------------------------------------------------
create table if not exists public.comandos (
  id uuid primary key default gen_random_uuid(),
  codigo text check (codigo is null or codigo ~ '^\d{4,6}$'),
  nome text not null,
  sigla text,
  setor_id uuid references public.setores (id) on delete restrict,
  ativo boolean not null default true,
  desativado_em date,
  motivo_desativacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists comandos_codigo_uk on public.comandos (codigo) where codigo is not null;
create unique index if not exists comandos_nome_sem_codigo_uk on public.comandos (lower(nome)) where codigo is null;

-- 2. Classes de navio ------------------------------------------------------
create table if not exists public.classes_navio (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ativo boolean not null default true,
  desativado_em date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists classes_navio_nome_uk on public.classes_navio (lower(nome));

-- OM clientes (terra, navio e extra-MB) -----------------------------------
create table if not exists public.oms (
  id uuid primary key default gen_random_uuid(),
  codigo text not null check (codigo ~ '^\d{4,6}$'),
  nome text not null,
  sigla text,
  indicativo_naval text,
  tipo text not null default 'TERRA' check (tipo in ('TERRA', 'NAVIO', 'EXTRA_MB')),
  comando_id uuid references public.comandos (id) on delete restrict,
  setor_id uuid references public.setores (id) on delete restrict,
  area_cnic smallint check (area_cnic between 1 and 5),
  lotacao int check (lotacao is null or lotacao >= 0),
  classe_id uuid references public.classes_navio (id) on delete restrict,
  cnpj text,
  endereco text,
  emails text,
  telefone text,
  observacao text,
  ativo boolean not null default true,
  ativado_em date,
  desativado_em date,
  motivo_desativacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint oms_desativacao_ck check (ativo or desativado_em is not null)
);
-- Um mesmo código pode ter mais de um cliente (ex.: 41000 - AMRJ, PRESTNAV, Skm)
create unique index if not exists oms_codigo_nome_uk on public.oms (codigo, lower(nome));
create index if not exists oms_comando_idx on public.oms (comando_id);

do $$
declare t text;
begin
  foreach t in array array['setores', 'comandos', 'classes_navio', 'oms'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- Setores conhecidos (planilha de pagamento e validações de dados)
insert into public.setores (sigla, nome, ordem) values
  ('COMOPNAV', 'Comando de Operações Navais', 10),
  ('DGMM', 'Diretoria-Geral do Material da Marinha', 20),
  ('SGM', 'Secretaria-Geral da Marinha', 30),
  ('DGPM', 'Diretoria-Geral do Pessoal da Marinha', 40),
  ('DGN', 'Diretoria-Geral de Navegação', 50),
  ('DGDNTM', 'Diretoria-Geral de Desenvolvimento Nuclear e Tecnológico da Marinha', 60),
  ('CGCFN', 'Comando-Geral do Corpo de Fuzileiros Navais', 70),
  ('SecNSNQ', 'Secretaria Naval de Segurança Nuclear e Qualidade', 80),
  ('CCEM-RIO', 'Centro de Comunicação Estratégica da Marinha', 90),
  ('CM', 'Comandante da Marinha', 100),
  ('EXTRA-MB', 'Clientes extra-Marinha (pagamento por GRU)', 900)
on conflict do nothing;

-- 4. Catálogo de serviços -------------------------------------------------
-- A tabela service_definitions já existe (criada pela versão anterior)
create table if not exists public.service_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit_measure text,
  acronym text
);
alter table public.service_definitions add column if not exists nome_oficial text;
alter table public.service_definitions add column if not exists emitida_de_acordo_com text;
alter table public.service_definitions add column if not exists setor_responsavel text;
alter table public.service_definitions add column if not exists telefone_setor text;
alter table public.service_definitions add column if not exists prazo_envio text;
alter table public.service_definitions add column if not exists anexo_oi text;
alter table public.service_definitions add column if not exists criterio text;
alter table public.service_definitions add column if not exists ordem int default 100;
alter table public.service_definitions add column if not exists ativo boolean not null default true;

do $$
declare
  s record;
begin
  for s in
    select * from (values
      ('TC', 'Taxa Condominial', 'TAXA CONDOMINIAL MENSAL', 'TAXA ESTABELECIDA', '-', 'Divisão de Contabilidade', null, 'Tabela anual', 'Anexo B', 'Anexo K: rateio por lotação × dias', 10),
      ('AE', 'Água e Esgoto', 'FORNECIMENTO DE ÁGUA POTÁVEL E COLETA DE ESGOTO', 'O DETALHAMENTO NO CAMPO OBSERVAÇÃO', 'M³', 'Divisão de Serviços Auxiliares', '8110-3376 (RETELMA)', 'Até o dia 10', 'Anexo C', 'Anexo J 1.1–1.2: hidrômetro ou média das 3 últimas', 20),
      ('EL', 'Eletricidade', 'FORNECIMENTO DE ENERGIA ELÉTRICA', 'O DETALHAMENTO NO CAMPO OBSERVAÇÃO', 'KWH', 'Divisão de Eletricidade', '8110-3765 (RETELMA)', 'Até o dia 10', 'Anexo D', 'Anexo J 1.3–1.4: medidor ou média das 3 últimas', 30),
      ('DA', 'Diária de Atracação', 'DIÁRIA DE ATRACAÇÃO', 'DIÁRIA ESTABELECIDA', 'DIA', 'Agente de Manobras (BNIC-35)', '8126-3621 (RETELMA)', 'Até o dia 10', 'Anexo F', 'Anexo L: diária × dias atracados (docado não paga)', 40),
      ('RB', 'Rebocador', 'SERVIÇO DE REBOCADOR', 'O DETALHAMENTO', 'MANOBRA', 'Divisão Marítima (BNIC-35)', '8126-5362 (RETELMA)', 'Até os dias 08 e 24', 'Anexo G', 'Anexo J 1.9: tabela da licitação', 50),
      ('VT', 'Viatura', 'ALUGUEL DE VIATURAS', 'O DETALHAMENTO NO CAMPO OBSERVAÇÃO', 'H/KM', 'Divisão de Transportes (BNIC-34)', '8126-5366 (RETELMA)', 'Até o dia 10', 'Anexo H', 'Anexo J 1.7: horas e quilometragem', 60),
      ('TL', 'Telefonia', 'TELEFONIA', 'O CONSUMO APURADO', 'MIN', 'Seção de Infraestrutura de TIC (BNIC-52.2)', '8126-5099 (RETELMA)', 'Dia 1º (Info 360)', 'Anexo A', 'Anexo J 1.6: minutos por ramal', 70),
      ('CR', 'Cópia Reprográfica', 'CÓPIA REPROGRÁFICA', 'O DETALHAMENTO', 'UN', null, null, null, null, null, 80),
      ('RI', 'Resíduos Industriais', 'REMOÇÃO RESÍDUO INDUSTRIAL', 'O DETALHAMENTO EM ANEXO', 'UN', null, null, null, 'Anexo E', null, 90),
      ('AL', 'Aluguel', 'ALUGUEL DE ESPAÇO FÍSICO', 'O DETALHAMENTO NO CAMPO OBSERVAÇÃO', 'MÊS', 'Divisão de Contabilidade', null, 'Contrato', 'Anexo I', null, 100),
      ('GS', 'Gás', 'FORNECIMENTO DE GÁS', 'O CONSUMO APURADO', 'M³', null, null, null, null, 'Anexo J 1.5: consumo medido', 110)
    ) as v(sigla, nome, oficial, de_acordo, unidade, setor, fone, prazo, anexo, criterio, ordem)
  loop
    if exists (select 1 from public.service_definitions where upper(trim(acronym)) = s.sigla) then
      -- completa apenas o que estiver vazio (não sobrescreve ajustes feitos no sistema)
      update public.service_definitions set
        nome_oficial = coalesce(nome_oficial, s.oficial),
        emitida_de_acordo_com = coalesce(emitida_de_acordo_com, s.de_acordo),
        setor_responsavel = coalesce(setor_responsavel, s.setor),
        telefone_setor = coalesce(telefone_setor, s.fone),
        prazo_envio = coalesce(prazo_envio, s.prazo),
        anexo_oi = coalesce(anexo_oi, s.anexo),
        criterio = coalesce(criterio, s.criterio),
        ordem = case when ordem is null or ordem = 100 then s.ordem else ordem end
      where upper(trim(acronym)) = s.sigla;
    else
      insert into public.service_definitions
        (id, name, unit_measure, acronym, nome_oficial, emitida_de_acordo_com, setor_responsavel,
         telefone_setor, prazo_envio, anexo_oi, criterio, ordem)
      values
        (gen_random_uuid(), s.nome, s.unidade, s.sigla, s.oficial, s.de_acordo, s.setor,
         s.fone, s.prazo, s.anexo, s.criterio, s.ordem);
    end if;
  end loop;
end $$;

-- 5. Parâmetros e feriados -----------------------------------------------
create table if not exists public.parametros (
  chave text primary key,
  valor text,
  descricao text,
  updated_at timestamptz not null default now()
);
drop trigger if exists parametros_touch on public.parametros;
create trigger parametros_touch before update on public.parametros
  for each row execute function public.touch_updated_at();

insert into public.parametros (chave, valor, descricao) values
  ('codigo_omps', '40015', 'Código OMPS-E da BNIC'),
  ('cnpj', '00.394.502/0555-50', 'CNPJ da BNIC (faturas extra-MB)'),
  ('dia_emissao', '15', 'Dia padrão de emissão das faturas'),
  ('prazo_certificacao_dias_uteis', '10', 'Data-limite de certificação no SIPLAD (OI 40-04, item 6.1)'),
  ('encarregado_nome', '', 'Encarregado da Divisão de Contabilidade (assinatura das faturas)'),
  ('encarregado_posto', '', 'Posto/graduação do Encarregado'),
  ('telefone_contabilidade', 'TEL: 2197-3763 / SISTELMA: 8110-3763', 'Telefone impresso nas faturas'),
  ('instrucao_uno', 'Indicar recurso na AI R.901.16 / ND33.90.39', 'Instrução de pagamento UNO'),
  ('instrucao_dois', 'Indicar ALTCRED tipo "Indenização de Serviços Prestados", ACD item 2.2 da Circular n°7/2026, da SGM.', 'Instrução de pagamento DOIS (atualizar a cada exercício)')
on conflict (chave) do nothing;

create table if not exists public.feriados (
  data date primary key,
  descricao text not null,
  tipo text not null default 'NACIONAL' check (tipo in ('NACIONAL', 'ESTADUAL', 'MUNICIPAL', 'PONTO_FACULTATIVO'))
);

insert into public.feriados (data, descricao, tipo) values
  ('2026-01-01', 'Confraternização Universal', 'NACIONAL'),
  ('2026-01-20', 'São Sebastião (Rio de Janeiro)', 'MUNICIPAL'),
  ('2026-02-16', 'Carnaval', 'PONTO_FACULTATIVO'),
  ('2026-02-17', 'Carnaval', 'PONTO_FACULTATIVO'),
  ('2026-04-03', 'Paixão de Cristo', 'NACIONAL'),
  ('2026-04-21', 'Tiradentes', 'NACIONAL'),
  ('2026-04-23', 'São Jorge (RJ)', 'ESTADUAL'),
  ('2026-05-01', 'Dia do Trabalho', 'NACIONAL'),
  ('2026-06-04', 'Corpus Christi', 'PONTO_FACULTATIVO'),
  ('2026-09-07', 'Independência do Brasil', 'NACIONAL'),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'NACIONAL'),
  ('2026-11-02', 'Finados', 'NACIONAL'),
  ('2026-11-15', 'Proclamação da República', 'NACIONAL'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'NACIONAL'),
  ('2026-12-25', 'Natal', 'NACIONAL'),
  ('2027-01-01', 'Confraternização Universal', 'NACIONAL'),
  ('2027-01-20', 'São Sebastião (Rio de Janeiro)', 'MUNICIPAL'),
  ('2027-02-08', 'Carnaval', 'PONTO_FACULTATIVO'),
  ('2027-02-09', 'Carnaval', 'PONTO_FACULTATIVO'),
  ('2027-03-26', 'Paixão de Cristo', 'NACIONAL'),
  ('2027-04-21', 'Tiradentes', 'NACIONAL'),
  ('2027-04-23', 'São Jorge (RJ)', 'ESTADUAL'),
  ('2027-05-01', 'Dia do Trabalho', 'NACIONAL'),
  ('2027-05-27', 'Corpus Christi', 'PONTO_FACULTATIVO'),
  ('2027-09-07', 'Independência do Brasil', 'NACIONAL'),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'NACIONAL'),
  ('2027-11-02', 'Finados', 'NACIONAL'),
  ('2027-11-15', 'Proclamação da República', 'NACIONAL'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra', 'NACIONAL'),
  ('2027-12-25', 'Natal', 'NACIONAL')
on conflict (data) do nothing;

-- 6. RLS ------------------------------------------------------------------
do $$
declare
  t text;
  pol record;
begin
  foreach t in array array['setores', 'comandos', 'classes_navio', 'oms', 'parametros', 'feriados'] loop
    execute format('alter table public.%I enable row level security', t);
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, t);
    end loop;
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end $$;

-- 7. Exclusão física só para OM sem movimento -----------------------------
-- As faturas ainda guardam o cliente como texto (ug + client); a verificação
-- compara código e nome. Na Fase 1-B as faturas passam a apontar para oms.id.
create or replace function public.om_tem_movimento(p_om_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.oms o
      join public.invoices i
        on trim(coalesce(i.ug, '')) = o.codigo
       and lower(trim(i.client)) = lower(trim(o.nome))
     where o.id = p_om_id
  );
$$;

create or replace function public.oms_bloqueia_exclusao()
returns trigger
language plpgsql
as $$
begin
  if public.om_tem_movimento(old.id) then
    raise exception 'A OM % - % possui faturas e não pode ser excluída. Use a desativação.', old.codigo, old.nome
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists oms_bloqueia_exclusao on public.oms;
create trigger oms_bloqueia_exclusao before delete on public.oms
  for each row execute function public.oms_bloqueia_exclusao();
