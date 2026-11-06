# SISCONT — Configuração (Supabase + Vercel)

Três passos, feitos **uma única vez**. Sem eles o sistema funciona, mas a gestão de
usuários fica em "modo limitado" e o perfil Consulta não é bloqueado no banco.

## 1. Banco de dados (Supabase → SQL Editor)

1. Abra o projeto no Supabase → **SQL Editor** → **New query**.
2. Cole o conteúdo de [`supabase/migrations/001_usuarios_e_permissoes.sql`](../supabase/migrations/001_usuarios_e_permissoes.sql) e clique **Run**.
3. Confira se existe ao menos um administrador ativo:

   ```sql
   select name, email, role, active from public.profiles order by role, name;
   ```

   Se nenhum aparecer como `ADMIN` / `active = true`, promova o seu usuário:

   ```sql
   update public.profiles set role = 'ADMIN', active = true where email = 'seu.email@marinha.mil.br';
   ```

O script é idempotente (pode rodar de novo). Ele:

| Item | Efeito |
|---|---|
| Tabela `profiles` | garante as colunas `email`, `active`, `created_at`, `updated_at` e só aceita perfis `ADMIN`, `USER`, `READ_ONLY` |
| Gatilho `on_auth_user_created` | todo login novo ganha perfil automaticamente; **auto-cadastro entra como Consulta e Pendente** |
| Gatilho `profiles_protect_fields` | usuário comum não consegue mudar o próprio perfil/situação (só o nome) |
| RLS em `profiles` | cada um lê o próprio perfil; só ADMIN lê/edita/exclui os demais |
| RLS nas tabelas de dados | leitura para usuários ativos; **gravação só para Administrador e Operador** |

> Atenção: o script **substitui** as políticas RLS existentes das tabelas `clients`,
> `service_definitions`, `invoices`, `received_documents`, `payment_allocations`,
> `cash_flow_exits` e `profiles` pelas políticas acima.

## 2. Chave de servidor (Vercel → Settings → Environment Variables)

| Variável | Onde obter | Observação |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` | **Secreta.** Fica só no servidor (função `/api/admin-users`), nunca vai ao navegador. |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | provavelmente já existe |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → `anon` `public` | provavelmente já existe |

Depois de salvar, faça **Redeploy** do último deploy (as variáveis só valem em deploys novos).

Com a chave configurada, a aba **Administração → Usuários** passa a: criar login (já confirmado),
redefinir senha, bloquear/liberar, alterar e-mail e excluir usuários.

## 3. Recuperação de senha (Supabase → Authentication → URL Configuration)

- **Site URL**: o endereço do site na Vercel (ex.: `https://siscont.vercel.app`).
- **Redirect URLs**: adicione o mesmo endereço.

Assim o link de "Esqueci minha senha" volta para o SISCONT e abre a tela **Criar nova senha**.

Opcional: em **Authentication → Providers → Email**, se "Confirm email" estiver ligado, o
usuário que se auto-cadastra precisa confirmar o e-mail **e** ser liberado pelo administrador.

## Perfis de acesso

| Perfil | Pode |
|---|---|
| **Administrador** (`ADMIN`) | tudo, inclusive Administração (usuários, clientes, serviços, backup) |
| **Operador** (`USER`) | incluir, editar, cancelar e excluir faturas, documentos, pagamentos e saídas |
| **Consulta** (`READ_ONLY`) | apenas visualizar e exportar |

## Desenvolvimento local

```bash
npm install
cp .env.example .env.local   # preencha as variáveis
npm run dev                   # interface (sem /api)
npx vercel dev                # interface + /api/admin-users
npm test                      # testes automatizados (API de usuários)
npm run typecheck             # checagem de tipos
```
