-- 042 — Anexos (arquivos) das contestações de fatura. Idempotente.
-- Os arquivos ficam num bucket privado; a lista (nome, caminho, tamanho) fica em contestacoes.anexos (jsonb), que já existe.
insert into storage.buckets (id, name, public, file_size_limit)
values ('anexos-contestacao', 'anexos-contestacao', false, 20971520)   -- 20 MB por arquivo
on conflict (id) do nothing;

drop policy if exists anexos_contestacao_select on storage.objects;
drop policy if exists anexos_contestacao_insert on storage.objects;
drop policy if exists anexos_contestacao_delete on storage.objects;
create policy anexos_contestacao_select on storage.objects for select to authenticated
  using (bucket_id = 'anexos-contestacao' and public.is_active_user());
create policy anexos_contestacao_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos-contestacao' and public.can_write());
create policy anexos_contestacao_delete on storage.objects for delete to authenticated
  using (bucket_id = 'anexos-contestacao' and public.can_write());
