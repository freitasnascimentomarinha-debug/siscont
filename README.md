# SISCONT — Sistema de Controle de Faturas

Controle de faturas, saldos recebidos (ALTCRED/GRU), pagamentos, adiantamentos e fluxo de caixa — Base Naval da Ilha das Cobras.

- **Configuração (Supabase + Vercel):** [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md)
- **Análise técnica e plano:** [docs/ANALISE_E_PLANO.md](docs/ANALISE_E_PLANO.md)

## Rodar localmente

```bash
npm install
cp .env.example .env.local   # preencha as variáveis do Supabase
npm run dev
```

## Verificações

```bash
npm run typecheck   # tipos
npm test            # testes automatizados
npm run build       # build de produção
```

Testes ponta-a-ponta (interface com Supabase simulado):

```bash
VITE_SUPABASE_URL=http://supabase.mock VITE_SUPABASE_ANON_KEY=anon npx vite --port 5179 &
BASE_URL=http://localhost:5179 node tests/e2e/ui.e2e.cjs          # usuários e login
BASE_URL=http://localhost:5179 node tests/e2e/cadastros.e2e.cjs   # cadastros e importação
```

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `pages/` | telas (Dashboard, Faturas, Saldos, Fluxo de Caixa, Cadastros, Administração, Login) |
| `components/cadastros/` | abas da tela Cadastros (OM, comandos, setores, classes, serviços, parâmetros, importação) |
| `utils/cadastroImport.ts` | leitura das planilhas e relatório de saneamento do cadastro |
| `components/` | layout, componentes de UI, painel de usuários |
| `context/AuthContext.tsx` | sessão, login, cadastro, senha |
| `services/` | acesso ao Supabase (`supabaseService`, `db` com cache, `adminApi`) |
| `api/admin-users.ts` | função de servidor (Vercel) para gestão de usuários |
| `supabase/migrations/` | scripts SQL do banco |
| `tests/` | testes automatizados |
