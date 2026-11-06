# SISCONT — Análise técnica e plano de ação

_Análise feita em 06/11/2026 sobre o commit `4065e57` ("carregamento eterno na tela de login")._

## 1. Arquitetura encontrada

- **Front-end**: React 19 + Vite + Tailwind, publicado na Vercel (SPA).
- **Banco/autenticação**: Supabase (Auth + Postgres via PostgREST), acessado direto do navegador com a chave `anon`.
- **Módulos**: Dashboard, Faturas, Saldos Recebidos (pagamentos/adiantamentos), Fluxo de Caixa, Administração.
- **Sem back-end próprio** e **sem nenhum script de banco versionado** (`*.sql` estava no `.gitignore`).

## 2. Problemas encontrados — Usuários (prioridade máxima)

| # | Problema | Causa | Impacto |
|---|---|---|---|
| U1 | "Incluir Usuário" não criava login | gravava só uma linha em `profiles` com ID aleatório; a senha era descartada | usuário nunca conseguia entrar |
| U2 | "Trocar Senha" não fazia nada | só exibia um `alert` | admin sem como redefinir senha |
| U3 | "Excluir usuário" não excluía | apagava só o perfil; no próximo login o sistema **recriava** o perfil | usuário excluído continuava entrando |
| U4 | Usuário se rebaixava sozinho a Consulta | `register()` fazia `upsert` com `READ_ONLY` quando o e-mail já existia | um ADMIN que tentasse "cadastrar-se" de novo perdia o perfil |
| U5 | Qualquer pessoa na internet acessava os dados | auto-cadastro entrava direto como Consulta, sem aprovação | vazamento de dados financeiros |
| U6 | Perfil Consulta só era bloqueado na tela | não havia política RLS no banco (ou não estava versionada) | gravação possível via API |
| U7 | Carregamento eterno / sessão instável | chamadas ao Supabase **dentro** do `onAuthStateChange` (trava o lock interno do supabase-js) | tela presa em "Iniciando SISCONT..." |
| U8 | Sem bloqueio/desbloqueio, sem "esqueci minha senha", sem troca da própria senha | não implementado | dependência do painel do Supabase |
| U9 | Perfis exibidos como `ADMIN`/`USER`/`READ_ONLY` | sem rótulos | interface confusa |
| U10 | Usuário podia rebaixar/excluir a si mesmo ou o último admin | sem validação | risco de ficar sem administrador |

## 3. Problemas encontrados — Demais módulos

| # | Problema | Impacto |
|---|---|---|
| G1 | **Backup gerava planilha vazia**: lia `localStorage`, mas os dados estão no Supabase | falsa sensação de segurança |
| G2 | **Restaurar backup não restaurava**: gravava no `localStorage` | backup inútil |
| G3 | Erros de gravação silenciosos em Fluxo de Caixa, Saldos, Faturas (sem `try/catch`) | usuário acha que salvou e não salvou |
| G4 | Editar uma saída ALTCRED a transformava em EMPENHO | dado corrompido ao editar |
| G5 | Excluir fatura/documento deixava alocações órfãs | saldos inconsistentes |
| G6 | Sem `@types/react`: o TypeScript não verificava nenhum componente | erros só apareciam em produção |
| G7 | Sem variáveis do Supabase o site ficava em **tela branca** | difícil diagnosticar deploy |
| G8 | Rótulos de formulário não associados aos campos | falha de acessibilidade (e-MAG) |
| G9 | Página `OutgoingBalances.tsx` órfã e quebrada | código morto |
| G10 | Rewrite da Vercel capturava `/api/*` | impedia qualquer função de servidor |

## 4. Plano e situação

### Fase 1 — Usuários ✅ concluída
- [x] Script SQL versionado: `profiles` completa, gatilho de criação automática, RLS por perfil, proteção de campos (U3–U6, U10)
- [x] Função de servidor `/api/admin-users` com chave `service_role`: criar login, redefinir senha, bloquear/liberar, alterar e-mail, excluir (U1–U3, U8, U10)
- [x] `AuthContext` reescrito: sem chamadas dentro do `onAuthStateChange`, sem rebaixamento, bloqueio de inativos, mensagens em português (U4, U7)
- [x] Tela de login: "Esqueci minha senha", confirmação de senha, cadastro sujeito a liberação (U5, U8)
- [x] "Minha Conta": o próprio usuário troca nome e senha (U8)
- [x] Painel de usuários: busca, filtros, pendentes, situação, último acesso, modo limitado sem a chave (U9)

### Fase 2 — Robustez geral ✅ concluída
- [x] Backup/restauração lendo e gravando no Supabase (G1, G2)
- [x] Avisos (toast) e mensagens de erro claras em todas as gravações e carregamentos (G3)
- [x] Correções de dados: tipo de documento na edição de saídas, exclusão em cascata de alocações (G4, G5)
- [x] Tipagem completa, tela de configuração pendente, acessibilidade dos formulários, limpeza (G6–G10)

### Fase 3 — Testes ✅ concluída
- [x] 29 testes automatizados da API de usuários e mensagens (`npm test`)
- [x] 7 cenários ponta-a-ponta no navegador com Supabase simulado (`tests/e2e/ui.e2e.cjs`)

### Fase 4 — Próximas melhorias sugeridas
- [ ] **Trilha de auditoria** (quem incluiu/alterou/excluiu cada lançamento e quando) — exigência da DCTIMARINST 33-06B para homologação
- [ ] Validações de regra de negócio no banco (ex.: alocação não pode exceder saldo do documento)
- [ ] Paginação/filtros no servidor (hoje todas as tabelas são baixadas inteiras)
- [ ] Divisão do pacote JS (1,7 MB) em partes carregadas sob demanda
- [ ] Expiração de sessão por inatividade

## 5. Ações que dependem do responsável pelo sistema

Ver [`CONFIGURACAO.md`](CONFIGURACAO.md): (1) rodar o SQL no Supabase, (2) cadastrar `SUPABASE_SERVICE_ROLE_KEY` na Vercel e fazer redeploy, (3) configurar a URL do site no Supabase Auth.
