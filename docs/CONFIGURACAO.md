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

### 1-B. Cadastros da Fase 1 (script 002)

Depois do 001, execute também [`supabase/migrations/002_cadastros_fase1.sql`](../supabase/migrations/002_cadastros_fase1.sql)
(SQL Editor → New query → colar → Run). Ele cria:

| Tabela | Conteúdo |
|---|---|
| `setores`, `comandos`, `oms` | hierarquia Setor → Comando (ComImSup) → OM/cliente; OM com tipo (terra, navio, extra-MB), área do CNIC, lotação, classe, CNPJ |
| `classes_navio` | classes de navio (base da média trienal) |
| `parametros` | código OMPS-E, CNPJ, dia de emissão, prazo de certificação (10 dias úteis), Encarregado, instruções de pagamento |
| `feriados` | feriados nacionais, estaduais (RJ), municipais (Rio) e pontos facultativos de 2026 e 2027 |
| `service_definitions` (ampliada) | os 11 serviços da OI com texto oficial, setor responsável, prazo e anexo |

Regras garantidas pelo banco: só ADMIN altera cadastros; desativar exige data; OM com faturas não pode ser
excluída (só desativada). Depois de executar, use **Cadastros → Importar planilhas** para trazer o cadastro das
planilhas atuais.

### 1-C. Código próprio e indicativo naval (script 003)

Depois do 002, execute [`supabase/migrations/003_codigo_proprio_indicativo.sql`](../supabase/migrations/003_codigo_proprio_indicativo.sql):
marca as OM/navios **sem código próprio** (usam o código do comando; extra-MB usa o da BNIC, 40015), inclui o
**indicativo naval** no comando e funde setores antigos que tenham sido criados (CON → COMOPNAV; CCSM e
CCSM-RIO → CCEM-RIO; AMAZUL → CM).

### 1-D. Migração de faturas, ALTCRED e baixas (script 004)

Depois do 003 e **depois de importar o cadastro**, execute
[`supabase/migrations/004_migracao_faturas.sql`](../supabase/migrations/004_migracao_faturas.sql): liga a fatura à
OM (`om_id`), registra a origem de cada registro migrado, a quitação feita fora do sistema (histórico pago) e a
marcação de contestada, liga a ALTCRED ao comando, torna o número da fatura único (se ainda não houver
repetidos) e remove o "setor" TM (Tribunal Marítimo é cliente).

Em seguida: **Cadastros → Migrar faturas → Selecionar planilhas** (Pagamento 2026 e, opcionalmente, o
Faturamento). Confira o quadro *Conferência com a planilha* e os pontos de atenção e clique em **Gravar
migração**. Uma nova leitura só acrescenta o que ainda não existe; **Desfazer migração** remove tudo o que a
migração gravou (recusa se já houver baixa lançada à mão sobre esses registros).

### 1-E. Pontos de atenção (script 005)

Execute [`supabase/migrations/005_pontos_atencao.sql`](../supabase/migrations/005_pontos_atencao.sql) **antes de
gravar a migração** (ela grava em cada fatura/ALTCRED os problemas que encontrou). O sistema mostra um ícone ⚠ ao
lado do número da fatura (Faturas) e do documento (Saldos Recebidos), e a tela **Pontos de Atenção** reúne todos,
com filtros, exportação em CSV e o botão para marcar como resolvido/ciente com justificativa.

- **Automáticos** (recalculados a cada leitura; somem quando o dado é corrigido): pago a maior, adiantamento maior
  que o serviço, fatura cancelada com baixa, vencimento ausente ou anterior à emissão, número repetido, número fora
  do padrão, competência ou serviço diferentes do número, fatura sem OM do cadastro, valor negativo, ALTCRED/GRU com
  baixas acima do valor, documento repetido ou sem valor.
- **Anotados pela migração** (ficam até alguém resolver): vencimento recalculado, emissão presumida, valor
  diferente do livro de emissão, fatura só no livro de emissão, situação diferente da planilha, fatura repetida
  nas abas, baixa para fatura inexistente, ALTCRED criada pelas baixas, utilizado diferente da planilha.

Se a migração já tinha sido gravada antes do 005: em **Migrar faturas**, selecione de novo as planilhas e clique
em **Gravar pontos nos já migrados**.

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
