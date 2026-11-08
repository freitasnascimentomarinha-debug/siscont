-- =====================================================================
-- SISCONT - 019: Contratos dos clientes Extra-Marinha (Etapa 3)
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 018 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
-- Um cliente Extra-MB pode ter vários contratos (ex.: Itaú com três
-- aluguéis). Cada contrato guarda número, objeto, serviço (sigla da
-- fatura, ex.: AL), vigência, valor mensal e o reajuste (índice e mês),
-- para conferir o valor faturado e avisar vencimento e reajuste.
-- Leitura: usuários ativos. Escrita: administrador e operador.
-- =====================================================================
create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  om_id uuid not null references public.oms(id) on delete cascade,
  numero text not null,
  objeto text,
  servico text,                -- sigla do serviço na fatura (AL, PU, EL...); vazio = qualquer
  inicio date,
  fim date,
  valor_mensal numeric check (valor_mensal is null or valor_mensal >= 0),
  indice_reajuste text,        -- IPCA, IGP-M...
  mes_reajuste int check (mes_reajuste is null or mes_reajuste between 1 and 12),
  observacao text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contratos_om_idx on public.contratos(om_id);

alter table public.contratos enable row level security;
drop policy if exists contratos_select on public.contratos;
create policy contratos_select on public.contratos for select to authenticated using (public.is_active_user());
drop policy if exists contratos_insert on public.contratos;
create policy contratos_insert on public.contratos for insert to authenticated with check (public.can_write());
drop policy if exists contratos_update on public.contratos;
create policy contratos_update on public.contratos for update to authenticated using (public.can_write()) with check (public.can_write());
drop policy if exists contratos_delete on public.contratos;
create policy contratos_delete on public.contratos for delete to authenticated using (public.can_write());

drop trigger if exists contratos_touch on public.contratos;
create trigger contratos_touch before update on public.contratos for each row execute function public.touch_updated_at();
drop trigger if exists contratos_auditoria on public.contratos;
create trigger contratos_auditoria after insert or update or delete on public.contratos for each row execute function public.registrar_auditoria();
