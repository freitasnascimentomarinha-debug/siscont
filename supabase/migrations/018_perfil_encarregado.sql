-- 018: perfil ENCARREGADO (vê o Painel inicial e o Painel do Encarregado; só visualiza e exporta).
-- Páginas por perfil (aplicado no sistema): Administrador = todas; Operador = todas exceto Administração;
-- Consulta = só Painel inicial; Encarregado = Painel inicial e Painel do Encarregado.
-- No banco, o Encarregado tem as mesmas permissões da Consulta (só leitura): as políticas de escrita
-- continuam liberadas apenas para ADMIN e USER. Idempotente.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('ADMIN', 'USER', 'READ_ONLY', 'ENCARREGADO'));
