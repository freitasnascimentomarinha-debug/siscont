-- =====================================================================
-- SISCONT - 041: finalidade da ALTCRED de "outros serviços" (recebida na R.901.16 sem pagar fatura)
-- ---------------------------------------------------------------------
-- Idempotente. Só acrescenta uma coluna opcional em received_documents; não apaga nem altera dados.
-- finalidade: ENERGIA, AGUA, TELEFONIA, CONDOMINIO, EXPEDIENTE ou nula (sem indicação). Usada no painel
-- "Disponível R.901.16 por categoria" do Fluxo de caixa: a entrada de uma ALTCRED "Outros" entra na categoria da finalidade.
-- =====================================================================
alter table public.received_documents add column if not exists finalidade text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'received_documents_finalidade_ck') then
    alter table public.received_documents add constraint received_documents_finalidade_ck
      check (finalidade is null or finalidade in ('ENERGIA', 'AGUA', 'TELEFONIA', 'CONDOMINIO', 'EXPEDIENTE'));
  end if;
end $$;
