-- =====================================================================
-- SISCONT - 026: Dívida de cada fim de mês (gráfico CONGEST, do Conselho de Gestão)
-- ---------------------------------------------------------------------
-- Idempotente: pode ser executado novamente.
-- Guarda o valor que fechou a dívida vencida de cada mês, para o quadro
-- comparativo "Dívida Geral" da planilha mensal. O sistema grava o mês
-- ao gerar a planilha; DEZ/2024 a AGO/2026 vêm das planilhas mensais já fechadas.
-- Leitura: usuários ativos. Escrita: administrador e operador.
-- =====================================================================
create table if not exists public.divida_mensal (
  mes text primary key check (mes ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),  -- AAAA-MM
  valor numeric not null check (valor >= 0),
  origem text not null default 'sistema',                             -- sistema | planilha
  registrado_em timestamptz not null default now(),
  registrado_por text
);

alter table public.divida_mensal enable row level security;
drop policy if exists divida_mensal_select on public.divida_mensal;
create policy divida_mensal_select on public.divida_mensal for select to authenticated using (public.is_active_user());
drop policy if exists divida_mensal_insert on public.divida_mensal;
create policy divida_mensal_insert on public.divida_mensal for insert to authenticated with check (public.can_write());
drop policy if exists divida_mensal_update on public.divida_mensal;
create policy divida_mensal_update on public.divida_mensal for update to authenticated using (public.can_write()) with check (public.can_write());
drop policy if exists divida_mensal_delete on public.divida_mensal;
create policy divida_mensal_delete on public.divida_mensal for delete to authenticated using (public.can_write());

drop trigger if exists divida_mensal_auditoria on public.divida_mensal;
create trigger divida_mensal_auditoria after insert or update or delete on public.divida_mensal for each row execute function public.registrar_auditoria();

insert into public.divida_mensal (mes, valor, origem) values
  ('2024-12', 953363.15, 'planilha'), ('2025-01', 733855.69, 'planilha'), ('2025-02', 1079140.21, 'planilha'), ('2025-03', 1383386.16, 'planilha'),
  ('2025-04', 805536.41, 'planilha'), ('2025-05', 1553811.30, 'planilha'), ('2025-06', 1693119.13, 'planilha'), ('2025-07', 1344256.39, 'planilha'),
  ('2025-08', 1235746.75, 'planilha'),
  ('2025-09', 1586387.13, 'planilha'), ('2025-10', 5964259.41, 'planilha'), ('2025-11', 5232648.77, 'planilha'),
  ('2025-12', 4913448.37, 'planilha'), ('2026-01', 4752682.35, 'planilha'), ('2026-02', 5879994.90, 'planilha'),
  ('2026-03', 4571575.42, 'planilha'), ('2026-04', 4399074.47, 'planilha'), ('2026-05', 5103676.82, 'planilha'),
  ('2026-06', 6594741.84, 'planilha'), ('2026-07', 5399182.02, 'planilha'), ('2026-08', 3503293.31, 'planilha')
on conflict (mes) do nothing;
