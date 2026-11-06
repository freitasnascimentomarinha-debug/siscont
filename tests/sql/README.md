# Teste do script SQL em PostgreSQL local

Simula o esquema `auth` do Supabase (papéis `authenticated`/`service_role`, `auth.uid()`)
com um banco no formato antigo, aplica a migração **duas vezes** e verifica as permissões.

```bash
createdb sb
psql -d sb -f tests/sql/supabase_mock.sql
psql -d sb -f supabase/migrations/001_usuarios_e_permissoes.sql
psql -d sb -f supabase/migrations/001_usuarios_e_permissoes.sql   # idempotência
psql -d sb -c 'grant all on all tables in schema public to authenticated, service_role'
psql -d sb -f tests/sql/rls_tests.sql
```

Resultado esperado: novo cadastro pendente; Consulta lê mas não grava nem se promove;
Operador grava; pendente/bloqueado não lê; Admin gerencia perfis e não se exclui;
excluir login apaga o perfil; troca de e-mail no Auth é refletida no perfil.
