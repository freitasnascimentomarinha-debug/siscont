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
em **Atualizar os já migrados** (grava os pontos de atenção e marca as ALTCRED cuja sobra foi para adiantamento).

### 1-F. Recebimentos e conciliação — Fase 2 (script 006)

Execute [`supabase/migrations/006_recebimentos_fase2.sql`](../supabase/migrations/006_recebimentos_fase2.sql). Ele
acrescenta à ALTCRED os dados da Solicitação de Alteração de Crédito do SIPLAD (exercício, criação, tipo, situação, UG
cliente, ALTCRED de origem, observação do solicitante, células de débito/crédito com PTRES, FR, ND, PI, UGR e UGE,
valor original × estornado), a **destinação** indicada pelo cliente, "aguardando destinação", a **sobra enviada para
adiantamento**, os dados da **GRU** (autenticação e data de pagamento) e o **tipo de cada baixa** (pagamento ou
adiantamento). Os dados já migrados são completados: exercício, autenticação das GRU, tipo das baixas (RESUMO
ADIANTAMENTO = adiantamento) e as ALTCRED cuja sobra já foi usada como adiantamento.

No sistema:
- **Saldos Recebidos → PDF do SIPLAD**: lê o relatório "Solicitações de Alteração de Crédito" (uma por página) e
  cadastra as ALTCRED novas, **completa** as que já existem (ex.: migradas) e trata estornos pela ALTCRED de origem.
- **Baixa assistida** (no detalhe do documento): propõe as baixas — faturas indicadas pelo cliente primeiro, depois
  as do comando, mais antigas primeiro —, não deixa passar do saldo da ALTCRED nem da fatura e envia a sobra para
  adiantamento.
- **Extrato de Conciliação** (menu): por comando ou OM, os 4 quadros — Saldo ALTCRED, Adiantamentos utilizados,
  Faturas pagas (por data de situação) e Faturas em aberto — com PDF e Excel.
- **Pontos de Atenção**: passa a acusar baixa fora da destinação e baixa sem documento.
- **Saldos Recebidos → Adiantamentos**: *Resumo de adiantamentos por cliente* (equivalente às abas ADIANTAMENTOS e
  RESUMO ADIANTAMENTO): por comando → cliente → ALTCRED, o valor enviado para adiantamento (a ALTCRED inteira ou a
  sobra de um pagamento), o utilizado e o saldo disponível, com as faturas que usaram cada saldo; exporta em Excel.

**Se você já migrou antes desta versão**: em **Cadastros → Migrar faturas**, selecione de novo a Pagamento 2026 e o
Faturamento. A leitura passa a usar também a aba **ADIANTAMENTOS** e o consolidado **FATURAMENTO AAAA**; grave a
migração (acrescenta só o que faltava, ligando as baixas novas às ALTCRED já gravadas) e clique em **Atualizar os já
migrados**.

### 1-G. Faturamento mensal — Fase 3 (script 007)

Execute [`supabase/migrations/007_faturamento_fase3.sql`](../supabase/migrations/007_faturamento_fase3.sql): cria
**preços** do ano (TC mensal por OM, diária de atracação por navio, valores unitários), **medições** do mês, mapa de
**atracação** (BNIC-35, realizado e previsão), **lotes** de faturamento e, na fatura, lote, memória de cálculo,
estimado (OND), acerto de, "cancela e substitui" e as marcas de envio/SIPLAD/SIAFI.

Menu **Faturamento**:
1. **Preços do ano** — TC mensal (pode importar a aba TAXA CONDOMINIAL da proposta), diária de cada navio, valores
   unitários; "Copiar do ano anterior" com reajuste.
2. **Medições do mês** — por serviço; **Importar rateio da divisão** (formato "DADOS BNIC-41": código, consumo,
   demanda, R$; prédios da mesma OM são somados), conferência com a conta da concessionária, OM sem leitura com
   "estimar" (média das 3 últimas, Anexo J).
3. **Atracação (BNIC-35)** — grade dia a dia (A atracado, D docado: não paga) ou **Importar mapas (G1…G6)**;
   "Previsão" para o lote OND (OUT–DEZ).
4. **Lote de faturas** — Mensal, **Estimado OND** (3 × média JAN–AGO ÷ 8; TC = 3 × tabela; DA = diária × dias
   previstos; extra-MB mensal) ou **Acerto do OND** (real OUT–DEZ − estimado → acréscimo/débito). Prévia com
   pendências, base de cálculo e valor editável; numeração automática OM-SIGLA-MM-AAAA-SEQ-V (sequência por serviço,
   sem lacunas, continuando das avulsas); emissão no dia 15 e data-limite em dias úteis; **abatimento automático do
   adiantamento** ("Baixa na ALTCRED ..."). Lotes emitidos: **PDF FR-172 em ZIP por comando**, mensagem de envio
   por comando (com o indicativo naval) e marcação de enviadas, certificadas no SIPLAD e registradas no SIAFI.

Preencha em **Cadastros → Parâmetros** o nome e o posto do Encarregado (impressos na fatura) e, em **Cadastros →
Serviços**, o setor e o telefone de cada divisão (texto de dúvidas da fatura).

### 1-H. Contestação, cancelamento e correção — Fase 4 (script 008)

Execute [`supabase/migrations/008_contestacao_fase4.sql`](../supabase/migrations/008_contestacao_fase4.sql): cancelamento
com motivo/data/responsável, "cancela e substitui", **contestações** (as faturas já marcadas como contestadas na planilha
ganham uma contestação ABERTA), **taxas mensais da poupança** e o lote de correção.

- **Faturas** (ações na linha): **Retificar** cria a versão seguinte (…-1), transfere as baixas e deixa a original
  "Substituída" (o PDF da nova traz "Esta fatura cancela e substitui a de nº ..."); **Contestar** abre a contestação;
  **Cancelar** exige o motivo e, se houver baixas, oferece devolvê-las às ALTCRED.
- **Contestações** (menu): painel com as em andamento, valor contestado, prazo do setor vencido e paradas há mais de 30
  dias; em cada uma, encaminhar ao setor medidor com prazo (padrão: 10 dias úteis), registrar a resposta e decidir:
  **ratificar** (mantém), **retificar** (nova versão) ou **cancelar** — tudo no histórico, com referências a documentos
  (OMS, e-mails).
- **Faturamento → Correção por atraso (OI 6.2)**: cadastre a taxa mensal da poupança de cada mês; o sistema lista as
  faturas com pagamento feito depois da data-limite (dentro dos 10 dias úteis não há correção, OI 6.1), calcula a
  correção dia a dia pela taxa diária equivalente e emite as faturas de correção (linha 03, acréscimo).

### 1-I. Cobrança, relatórios e fluxo de caixa — Fase 5 (script 009)

Execute [`supabase/migrations/009_relatorios_fase5.sql`](../supabase/migrations/009_relatorios_fase5.sql): rubricas da taxa
condominial por exercício, classificação das notas de empenho (rubrica 1–33 ou categoria energia/água/telefonia/
condomínio-diária-viatura/outros — as saídas antigas são classificadas pela rubrica digitada) e registro das cobranças.

- **Cobrança** (menu):
  - *Faturas em aberto*: quadro como o "Quadro Resumo" da planilha — vencidas por exercício, vencidas total, a vencer e
    total, por setor/comando/OM × tipo; filtro "Setor do Material" × demais (parâmetro `setores_material`); por padrão
    sem extra-MB e sem contestadas (como na planilha); Excel e PDF com "Atualizado em".
  - *Mensagens de cobrança*: por comando, com o indicativo naval, as faturas vencidas e os dias de atraso; texto pronto
    para o SIGAD e registro da cobrança enviada.
  - *Painel do Encarregado*: em aberto, vencido, em contestação, dívida por condômino por idade (a vencer, 1–30, 31–90,
    91–180, 181–365, mais de 1 ano), ALTCRED com saldo parado (parâmetro `dias_saldo_parado`) e adiantamentos disponíveis.
- **Fluxo de Caixa** (abas):
  - *Lançamentos*: entradas automáticas (ALTCRED/GRU) e saídas = notas de empenho, com rubrica/categoria e o número
    validado (UG + gestão + ano + NE + nº); **Importar NE (planilha)** no formato das abas mensais do fluxo de caixa.
  - *Saldo mensal*: saldo anterior, entradas, saídas e saldo de cada mês, com transporte entre meses e exercícios.
  - *Condomínio por rubrica*: valor vigente, %RUB, taxa condominial recebida distribuída (receita por rubrica),
    empenhado, % executado, saldo em conta e a receber.
  - *Disponível R.901.16*: entradas, saídas e saldo por categoria (energia, água, telefonia, condomínio/diária/viatura,
    sem indicação).
  - *Rubricas*: catálogo do exercício; **Importar proposta (Despesas)** lê a aba Despesas_NOVO da proposta anual.

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
