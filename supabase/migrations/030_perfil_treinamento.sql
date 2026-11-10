-- 030: perfil TREINAMENTO (vê todas as páginas, menos a Administração, e pode lançar, mas só em dados de TESTE).
-- No banco ele tem as mesmas permissões da Consulta (só leitura): as políticas de escrita continuam liberadas apenas para
-- ADMIN e USER (can_write() / is_admin()). Os lançamentos de teste ficam só no navegador do usuário (o sistema não os envia ao
-- banco), e se algum caminho tentasse gravar, o banco recusaria. Idempotente.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('ADMIN', 'USER', 'READ_ONLY', 'ENCARREGADO', 'TREINAMENTO'));
