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

## Fase 1 (002_cadastros_fase1.sql)

Depois do 001, crie no banco de teste uma tabela `invoices` com `ug` e `client` (formato atual), aplique o 002
duas vezes e rode:

```bash
psql -d sb -f supabase/migrations/002_cadastros_fase1.sql
psql -d sb -f supabase/migrations/002_cadastros_fase1.sql   # idempotência
psql -d sb -f tests/sql/fase1_cadastros_tests.sql
```

Esperado: mesmo código com nomes diferentes aceito; duplicidade e código inválido recusados; desativação exige
data; OM com faturas não pode ser excluída; Operador só lê; usuário pendente não lê.

## Script 003 (código próprio e indicativo)

Com o 002 aplicado: rode as 4 inserções do início de `tests/sql/fase1_003_tests.sql`, aplique o
`003_codigo_proprio_indicativo.sql` (duas vezes) e rode o restante do arquivo. Esperado: setores CON, CCSM-RIO e
AMAZUL fundidos e removidos; indicativos inválidos recusados.
