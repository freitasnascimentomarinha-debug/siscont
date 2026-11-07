# SISCONT — instruções para o Claude

- **Publicação automática:** ao terminar qualquer alteração (depois de typecheck e testes passarem), faça commit e push para a branch de trabalho **e também para a `main`** (`git push origin HEAD:main`), sem perguntar. O site publicado (Vercel) usa a `main`; alteração só na branch de trabalho não aparece para o usuário.
- Depois do push, confirme com `git fetch` que `origin/main` está no commit novo e avise o usuário que o deploy da Vercel leva 1–2 minutos (Ctrl+F5 para recarregar).
- Antes de enviar: `npm run typecheck` e `npm test`; para telas, os testes ponta-a-ponta descritos no README.
- Mudanças no banco: o usuário roda scripts em `supabase/migrations/` no SQL Editor (ou o Claude executa pelo conector do Supabase quando autorizado); script novo = número seguinte, idempotente.
