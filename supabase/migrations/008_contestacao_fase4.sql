-- =====================================================================
-- SISCONT - 008: Fase 4 - Contestação, cancelamento e correção por atraso
-- ---------------------------------------------------------------------
-- Executar DEPOIS do 007 (SQL Editor > New query > colar > Run).
-- Idempotente: pode ser executado novamente.
--
--  1. Cancelamento com motivo, data e responsável; "cancela e substitui"
--     (a fatura original aponta para a nova versão)
--  2. Contestações: abertura, encaminhamento ao setor medidor com prazo,
--     resposta, decisão (RATIFICADA / RETIFICADA / CANCELADA), histórico
--     e anexos (referências). As faturas já marcadas como contestadas
--     ganham uma contestação ABERTA.
--  3. Taxas mensais da poupança (OI 40-04, 6.2) para a correção de faturas
--     pagas com atraso, e lote do tipo CORRECAO
-- =====================================================================

alter table public.invoices add column if not exists cancelamento_motivo text;
alter table public.invoices add column if not exists cancelada_em date;
alter table public.invoices add column if not exists cancelada_por text;
alter table public.invoices add column if not exists substituida_por text;

create table if not exists public.contestacoes (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  numero_fatura text not null,
  aberta_em date not null default current_date,
  origem text not null default 'SIPLAD' check (origem in ('SIPLAD', 'EMAIL', 'MENSAGEM', 'OFICIO', 'TELEFONE', 'MIGRACAO', 'OUTRO')),
  justificativa text not null,
  setor_medidor text,
  encaminhada_em date,
  prazo date,
  resposta text,
  respondida_em date,
  decisao text check (decisao is null or decisao in ('RATIFICADA', 'RETIFICADA', 'CANCELADA')),
  decidida_em date,
  nova_fatura text,
  status text not null default 'ABERTA' check (status in ('ABERTA', 'ENCAMINHADA', 'RESPONDIDA', 'ENCERRADA')),
  anexos jsonb not null default '[]'::jsonb,   -- [{nome, referencia}] ex.: OMS nº 02126, e-mail de 21/09
  historico jsonb not null default '[]'::jsonb, -- [{em, por, acao, texto}]
  aberta_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contestacoes_invoice_idx on public.contestacoes (invoice_id);
create index if not exists contestacoes_status_idx on public.contestacoes (status);

create table if not exists public.taxas_poupanca (
  mes text primary key check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  taxa numeric not null check (taxa >= 0 and taxa < 10), -- % ao mês (rendimento do 1º dia do mês)
  fonte text,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['contestacoes', 'taxas_poupanca'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_write())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_write()) with check (public.can_write())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_write())', t || '_delete', t);
  end loop;
end $$;

drop trigger if exists contestacoes_touch on public.contestacoes;
create trigger contestacoes_touch before update on public.contestacoes for each row execute function public.touch_updated_at();
drop trigger if exists taxas_poupanca_touch on public.taxas_poupanca;
create trigger taxas_poupanca_touch before update on public.taxas_poupanca for each row execute function public.touch_updated_at();

-- Lote de correção por atraso
alter table public.lotes_faturamento drop constraint if exists lotes_faturamento_tipo_check;
alter table public.lotes_faturamento add constraint lotes_faturamento_tipo_check check (tipo in ('MENSAL', 'OND', 'ACERTO', 'CORRECAO'));

insert into public.parametros (chave, valor, descricao) values
  ('prazo_contestacao_dias_uteis', '10', 'Prazo (dias úteis) para o setor medidor responder uma contestação'),
  ('correcao_base_dias', '30', 'Dias do mês na conversão da taxa mensal da poupança em taxa diária (OI 6.2)')
on conflict (chave) do nothing;

-- Faturas já marcadas como contestadas (migração das planilhas) ganham uma contestação aberta
insert into public.contestacoes (invoice_id, numero_fatura, aberta_em, origem, justificativa, status, historico)
select i.id, i.invoice_number, coalesce(i.issue_date, current_date), 'MIGRACAO',
       coalesce(nullif(trim(i.observation), ''), 'Contestação registrada na planilha (aba FATURAS CONTESTADAS).'), 'ABERTA',
       jsonb_build_array(jsonb_build_object('em', current_date, 'por', 'migração', 'acao', 'ABERTA', 'texto', 'Importada da planilha de pagamento.'))
  from public.invoices i
 where i.contestada and not coalesce(i.is_canceled, false)
   and not exists (select 1 from public.contestacoes c where c.invoice_id = i.id);
