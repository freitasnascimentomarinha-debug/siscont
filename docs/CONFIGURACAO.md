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
   - **Planilha de água e esgoto da divisão** (aba do mês, seções OM apoiadas / Extra-Marinha / Cais / Diques /
     ARES-MAS): o mesmo botão reconhece o formato e abre a **conferência** antes de lançar — totais × contas da
     concessionária (matrículas, R$ e m³), conta "fora do rateio" (ARES-MAS) somada à OM indicada, regras do rodapé
     (ex.: "Consumo do HCM = H67 – H66 – H68 – H69 – H70") conferidas com as leituras e, se marcado, aplicadas (a
     diferença volta para os não hidrometrados AMRJ/BNIC na mesma proporção; o total continua igual à conta), pontos
     de atenção (consumo digitado sem leitura, valor "SEM CONEXÃO" sem dono, código fora do padrão, mesmo código
     para clientes diferentes) e a OM do cadastro de cada linha (pelo código com zeros à esquerda, pelo nome ou nome
     alternativo; navio sem código pelo nome). Ligações feitas à mão podem ficar guardadas como nome alternativo.
     Ao lançar, a tela vai para a competência da planilha e o serviço AE; confira e clique em **Gravar**.
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

### 1-J. Rotinas anuais, auditoria e backup — Fases 6 e 7 (script 010)

Execute [`supabase/migrations/010_rotinas_anuais_auditoria.sql`](../supabase/migrations/010_rotinas_anuais_auditoria.sql)
(idempotente; pode rodar de novo). Cria a proposta anual da taxa condominial (status PROPOSTA → APROVADA → DIVULGADA),
completa as rubricas (previsto, desconto geral com justificativa, gasto do ano anterior), lotação por OM e ano, matriz
OM × rubrica, descontos por OM, dias atracados por classe e ano (média trienal), a **trilha de auditoria** e o parâmetro
`ultimo_backup`.

- **Taxa condominial e diárias** (menu *Contabilidade de custos*), na ordem das abas:
  1. *Rubricas*: valor previsto do ano, desconto geral (exige justificativa), gasto do ano anterior e variação.
  2. *Lotação e matriz*: lotação, lotação anterior e de quais despesas cada OM participa (X). Navio participa só da
     rubrica **"Navios"** (valor destinado às diárias); os dias do navio vêm da média trienal da classe ou podem ser
     informados.
  3. *Média trienal*: dias "A" por classe nos 3 anos anteriores ÷ navios ativos; **Importar histórico trienal** (planilha
     com uma aba por ano) ou **Calcular pelos mapas BNIC-35** gravados no Faturamento.
  4. *Descontos por OM*: % ou R$, numa rubrica ou no total, com justificativa (não é redistribuído às outras OM).
  5. *Resultado*: taxa anual/mensal e % de cada OM, diária de cada navio (custo por militar-dia × lotação), extrato da OM
     rubrica a rubrica, comparativo com o ano anterior (Anexo B) e **Exportar Excel**.
  - **Importar proposta (planilha)** lê de uma vez as abas *Despesas_NOVO*, *Matriz_NOVO* e *RATEIO MODELO TÉCNICO*
    (ou *(1)*); nomes não encontrados no cadastro aparecem para escolher a OM. Descontos não são importados.
  - **Aprovar proposta** e depois **Publicar tabela vigente**: grava a TC mensal de cada OM e a diária DA de cada navio
    nos *Preços do ano* usados pela emissão mensal. Faturas já emitidas não mudam.
- **Auditoria** (menu *Configuração*): toda inclusão, alteração e exclusão em faturas, baixas, ALTCRED/GRU, saídas,
  contestações, lotes, preços, parâmetros, taxa condominial e usuários, com usuário, data/hora e valor anterior → novo.
  É gravada por gatilhos do banco e não pode ser alterada pela aplicação. Em **Faturas emitidas**, o ícone de relógio
  mostra o histórico da fatura. Alterações de usuários só o Administrador vê. O registro começa quando o 010 é executado.
- **Backup assistido**: o backup da Administração passa a incluir as tabelas das Fases 2 a 6 e grava a data em
  `ultimo_backup`; o Administrador vê um lembrete quando não há backup há mais de 7 dias.
- **Menu por função**: *Visão geral* (Painel inicial, Painel do Encarregado, Pontos de Atenção) → *Faturamento*
  (Emitir faturas do mês, Faturas emitidas, Contestações) → *Acompanhamento contábil* (Recebimentos ALTCRED/GRU, Extrato
  de conciliação, Cobrança) → *Contabilidade de custos* (Fluxo de caixa, Taxa condominial e diárias) → *Configuração*
  (Cadastros, Auditoria, Administração). Cada item mostra o que faz ao passar o mouse.

### 1-K. Certificação × vencimento (script 011)

Execute [`supabase/migrations/011_vencimento_30_dias.sql`](../supabase/migrations/011_vencimento_30_dias.sql) depois do 010
(idempotente). São duas datas diferentes:

| Data | Regra | Onde aparece |
|---|---|---|
| **Data-limite de certificação** no SIPLAD | emissão + 10 dias úteis (OI 40-04, 6.1; parâmetro `prazo_certificacao_dias_uteis`) | FR-172, mensagem de envio, nova coluna `data_limite_certificacao` |
| **Vencimento** (pagamento) | emissão + 30 dias corridos, levado ao próximo dia útil (parâmetro `prazo_vencimento_dias_corridos`) | coluna *Vencimento* das faturas, situação vencida/a vencer, cobrança, correção por atraso |

- Exceção: faturas **OND** (estimado de fim de exercício) vencem na data de certificação.
- O script grava a data de certificação de todas as faturas e **recalcula o vencimento das faturas em aberto** (não
  canceladas, não quitadas, com saldo), exceto OND. Pagas e canceladas não mudam. O vencimento anterior de cada fatura
  alterada fica em `vencimentos_anteriores_011`; o fim do script traz o comando para desfazer.
- A calculadora em *Cadastros → Parâmetros* mostra as duas datas.

### 1-L. Clientes e taxas (script 012)

Execute [`supabase/migrations/012_clientes_taxas.sql`](../supabase/migrations/012_clientes_taxas.sql) depois do 011
(idempotente).

- **Taxa condominial × diária de atracação separadas** (tela *Taxa condominial e diárias*): grupo *Taxa condominial*
  (1. Rubricas, 2. Clientes e matriz, 3. Descontos por OM, 4. Resultado da taxa) e grupo *Diária de atracação*
  (5. Navios, 6. Média trienal, 7. Resultado das diárias), cada um com o seu botão de publicar. Cada rubrica tem um
  **destino**: taxa condominial ou diária de atracação (a rubrica "Navios" vai para as diárias).
- **Rubricas com as colunas da Despesas_NOVO**: valor do ano, %RUB, valor do ano anterior, variação %, descontos
  (geral + por OM), valor rubrica atualizado e conferência ✓/⚠ com a coluna DESCONTOS da planilha.
- **Importação da proposta**: lê também a aba *PROPOSTA CONDOMINIO* (desconto de cada OM em cada rubrica); a diferença
  para a coluna DESCONTOS vira desconto geral da rubrica. Nome sem correspondente no cadastro fica **para decidir
  depois** (não se perde): aparece nas abas Clientes/Navios para escolher o cliente ou **criar um novo** — a lotação, as
  rubricas e os descontos daquela linha entram automaticamente e o nome da planilha passa a ser reconhecido.
- **Incluir cliente / Incluir navio** nas duas taxas: busca no cadastro (inclusive desativados e fora da Ilha) ou cria
  um novo. O Operador pode incluir cliente novo; alterar e excluir cadastros continua só com o Administrador.
- **Cadastros › OM / Clientes**: marcação **OM fora da Ilha das Cobras** (com filtro) e **outros nomes / abreviações**.
- **Cadastros › Duplicidades** (Administrador): grupos de clientes que parecem o mesmo (mesmo nome com diferença de
  acento/edifício, mesma sigla, sigla × nome por extenso, nome cortado, códigos diferentes). **Unificar** transfere
  faturas, ALTCRED, preços, medições, lotação etc. para o cadastro que fica, corrige o nome do cliente nas faturas para o
  dele e **exclui** os duplicados (script 016, que substitui o 015; fica na auditoria). O nome duplicado não é guardado.
  O 016 também conclui os unificados antigos ("Unificada com ...") e tira dos "outros nomes" os que vieram de
  unificações. **Não são a mesma OM** tira o grupo da lista.
  Não são duplicidade: nome com complemento depois de " - " (ex.: *Arsenal de Marinha do Rio de Janeiro - BGL1*,
  *Diretoria de Patrimônio Histórico… - ILHA FISCAL*: a fatura é de quem está no complemento e o comando responsável é
  o da primeira parte) e nomes com **Ed.XX** em edifícios diferentes. A mesma página sugere ligar esses clientes ao
  comando do responsável (*Ligar todos ao comando do responsável*). Mesmo nome com e sem edifício aparece como
  "confira".
- **OM emissora** (*Cadastros › Parâmetros*, quadro *OM responsável pela emissão das faturas*): por padrão a BNIC
  (achada pela sigla/nome; grave para confirmar). Pode ser trocada. Ela **nunca recebe fatura** — o lote a deixa de
  fora e mostra o valor dela só como controle e contabilidade de custos — e pode **participar ou não dos rateios**:
  participando, entra na taxa condominial como as demais (a TC dela não é publicada nos Preços); não participando, a
  parte dela é dividida entre as outras OM. Parâmetros `om_emissora_id` e `om_emissora_rateio` (SIM/NAO).
- **Baixa assistida com número citado errado**: quando a ALTCRED cita uma fatura que não existe em aberto (ex.: *71000-TC-08-2026-008-0*
  e a de taxa condominial é a *-010-0*, porque o 008 é a sequência da água), a proposta reconhece a fatura do **mesmo cliente, serviço e
  mês** se for uma só, marca como "citada como ..." e sugere o valor. Havendo mais de uma, não adivinha.
- **Fatura de viatura (VT) no PDF**: sai com a tabela *Mês | Valor* dos meses cobrados (como a oficial), a partir da planilha importada.
  O *Resumo do mês* mostra o total de créditos de acerto a compensar.
- **Planilha de faturas de viatura (VT)** — *Medições do mês › Importar rateio da divisão*: reconhece o arquivo da divisão de
  transportes (uma aba por OM, aba MODELO ignorada) e abre a conferência. O valor de cada OM é o *TOTAL SERVIÇO PRESTADO* da aba;
  a viatura é cobrada com atraso, então o valor pode juntar vários meses (a tabela Mês | Valor aparece como detalhe). A OM é ligada
  pelo código do número da fatura e pelo nome; abas sem valor (sem fatura no mês) são listadas. Avisos: REFERÊNCIA da aba
  desatualizada, total diferente da soma da tabela e fatura que cobra meses muito atrasados (pode ser sobra do mês anterior). Ao
  lançar, a tela vai para a competência da planilha e o serviço VT; confira e clique em **Gravar**.
- **Importar ALTCRED do SIPLAD (PDF)**: lê todas as páginas do relatório "Solicitações de Alteração de Crédito" e traz só o que a
  BNIC **recebeu** (crédito na UGR da BNIC, ou na UGE da BNIC em indenização de serviços/estorno). O resto (compras no exterior,
  ALT de ND, repatriação, pagamentos da BNIC a outras UG) aparece numa nota "não creditam a BNIC" e é ignorado. Reconhece os números
  com letras e dígitos no prefixo (B4D0, P3MA, P3X3...). Solicitação que continua na página seguinte avisa que o total pode estar
  incompleto (conferir no SIPLAD).
- **Perfil Treinamento** (script 030): para quem está aprendendo o sistema. Vê **todas as páginas** (menos Administração) e usa todos
  os botões, mas **tudo o que lança é de teste**: fica guardado só no navegador da pessoa e **nada é gravado no banco**. Os dados
  reais aparecem normalmente, misturados com o que a pessoa lançou de teste; uma faixa roxa fixa avisa "Modo treinamento" e mostra
  quantos lançamentos de teste existem, com o botão **Zerar meus testes**. Ações que mexeriam em muitos dados de uma vez
  (unificar OM, assistente de vigência da OM, anexos, administração de usuários) não são simuladas: avisam e não gravam. No banco o
  perfil só tem leitura (como a Consulta), então mesmo que alguma coisa tentasse gravar, o banco recusaria. Para criar: rode o script
  `030_perfil_treinamento.sql` e, em Administração › Usuários, escolha o perfil **Treinamento**. Os testes ficam por usuário e por
  navegador (outro computador começa limpo).
  **O operador também pode ligar e desligar o modo treinamento sozinho**, sem trocar de perfil: botão "Entrar no modo treinamento"
  no menu (rodapé) e "Sair do treinamento" na faixa roxa. Ele continua com as páginas e permissões de operador; só o administrador
  e os demais perfis não têm esse botão. O estado fica guardado por usuário neste navegador.
- **OM que muda de nome, UG ou comando** (script 029): em Cadastros › OM / Clientes, o botão do relógio ("Mudou de nome, UG ou
  comando?") abre o assistente. Informe o novo nome, UG, comando, setor ou sigla, a **data de vigência** (hoje ou no passado), o ato
  (portaria/BONO) e o motivo; o sistema mostra o que muda e o impacto antes de gravar. **Operador e administrador** podem usar o
  assistente e cadastrar clientes novos; editar, desativar e excluir continuam só do administrador. Faturas já emitidas **não mudam**
  (número e texto da época ficam como saíram). O nome antigo vai para os "outros nomes" e a UG antiga para os "códigos anteriores":
  ALTCRED/GRU com o nome antigo, planilhas e PDF do SIPLAD com a UG antiga continuam achando a OM (o PDF avisa "UG antiga"). O lote
  usa os dados da OM **na data da emissão** (antes da vigência, os antigos; depois, os novos) e a **sequência das faturas continua**
  (é por serviço e mês, não por UG). A ALTCRED/GRU agora também guarda a OM (`om_id`), escolhida no formulário ou ligada pelo nome.
  A linha do tempo de cada OM mostra todas as mudanças.
- **Situação da ALTCRED no SIPLAD** (importação do PDF): cada solicitação é classificada em *Processada* (crédito já entrou),
  *Aguardando processamento*, *Em análise / tramitação*, *Devolvida à origem*, *Cancelada / rejeitada* ou *Não processada*. A tela
  da importação mostra a etiqueta colorida e um resumo ("1 aguardando · 1 devolvida · 1 processada"); devolvida, cancelada e não
  processada já vêm como "Não importar" (dá para trocar). Na lista de Recebimentos toda ALTCRED traz a etiqueta "SIPLAD: ..." e há o
  filtro **Situação no SIPLAD**. **A baixa fica bloqueada** (Baixa assistida, Pagar Faturas, pagar ao incluir o documento e o abatimento de adiantamento no lote) enquanto a ALTCRED não estiver *Processada*; as migradas da planilha (sem situação) contam como processadas. Importar o PDF de novo atualiza
  a situação, e quando passa de "aguardando" para "processada" a data do documento vira a data do processamento.
- **Reimpressão da FR-172 depois do pagamento**: a fatura que já recebeu baixa sai com o quadro "PAGAMENTO(S) REGISTRADO(S)" —
  **data do documento de pagamento** (ALTCRED ou GRU), número do documento e valor — e a situação (**fatura paga** ou **pagamento parcial, com o saldo em aberto**).
  Baixas de adiantamento seguem como "Baixa na ALTCRED ...". Fatura em aberto sai sem esse quadro.
- **Acerto do OND e créditos da OM** (script 028): a fatura de acerto traz o **consumo real** de OUT–DEZ como valor do
  serviço (com a quantidade) e abate, na linha 04 (débito), o **estimado já faturado**. O débito vai só **até o valor do consumo real**: estimado
  100.000 e real 80.000 → serviço 80.000, débito 80.000, **total a pagar 0,00**, e a diferença de 20.000 é o **crédito da OM**
  (gravado na base da fatura e escrito no quadro e na observação; real 120.000 → débito 100.000 e 20.000 a pagar). A fatura estimada
  continua como foi emitida. A aba **Créditos de acerto** (Emitir faturas do mês) lista o crédito de cada OM (os acertos
  antigos, de valor 0 e débito, entram sozinhos), o que já foi compensado ou devolvido e o saldo. **Compensação**: na prévia
  do **lote mensal** o crédito abate as faturas da **mesma OM e do mesmo serviço** (a água estimada compensa água), do crédito
  mais antigo para o mais novo, na linha 04, com a observação "Compensação do crédito do acerto nº ..." (caixa *Compensar
  créditos de acerto*; não vale para o lote OND). **Devolução** (ALTCRED/GRU) ou compensação fora do lote: botão *Registrar
  uso*, que pode ser desfeito. Aviso no acerto quando a fatura estimada ainda não foi paga. A compensação não reduz a média
  do OND nem o estimado do acerto (usa-se o valor bruto da fatura).
- **Painel inicial › Excel completo / PDF completo (com gráficos)**: o Excel traz Resumo, aba Gráficos (7 gráficos nativos
  e editáveis, com a tabela de dados ao lado: faturado por mês, idade da dívida, composição do em aberto, maiores
  devedores, em aberto por serviço, por setor e taxa condominial por OM), tabelas completas (devedores, serviço, setor,
  idade, taxa condominial) e a lista de todas as faturas em aberto e em contestação, com filtro. O PDF tem indicadores,
  os gráficos e as tabelas. Os dois respeitam o ano de referência e os filtros ativos (o recorte aparece no cabeçalho).
- **Painel inicial**: filtros de múltipla escolha (setor, comando, cliente, serviço — ex.: todos os setores exceto
  EXTRA-MB), lembrados no navegador; lista das faturas ordenada por vencimento e ordenável por coluna.
- **Cobrança**: setores em múltipla escolha e o grupo destacado (antes fixo "Setor do Material = DGMM") com nome e
  setores editáveis (*definir grupo…*, parâmetros `nome_grupo_setores` e `setores_material`).
- **Planilhas modelo**: botão *Planilha modelo* ao lado de cada importação (proposta, histórico trienal, rateio da
  divisão, mapa de atracação, tabela da TC, notas de empenho, cadastro, planilha de pagamento), com aba de instruções.
  Os de rateio e de mapa já vêm com as OM e os navios; em Medições aparece a divisão responsável pelo serviço (editável
  em *Cadastros › Serviços*).
- **Pontos de Atenção** reúne as inconsistências e o **histórico de alterações** (auditoria) — um só item no menu.

### 1-M. Rubricas, subsídios, contratos e conferência (script 013)

Execute [`supabase/migrations/013_subsidios_conferencia.sql`](../supabase/migrations/013_subsidios_conferencia.sql) depois
do 012 (idempotente). Cria o armazenamento privado **contratos-tc** (Storage) para os arquivos.

- **Rubricas em três blocos**: *Taxa condominial* (rubricas 1 a 33, com a **soma das rubricas da taxa**), *Navios — diárias
  de atracação* e *Fora da taxa — só para o cálculo do PAR* (34 a 37). Na importação, as rubricas depois da última
  marcada na matriz ficam como "só PAR".
- **Navios pagam**: parte de cada rubrica cobrada dos navios (aba NAVIOS da planilha). A soma é o valor rateado entre os
  navios (linha 38 "Navios"); ⚠ indica rubrica em que OM + navios pagam mais do que o valor previsto.
- **Ficha da rubrica** (botão *Ficha*), em 4 passos: (1) valor previsto e **por que** esse valor; (2) **composição do
  valor** (subsídios: contrato, aditivo, pesquisa de preços...), com a soma comparada ao valor previsto; (3) **contratos
  e documentos** anexados (PDF, imagem, Excel, Word; até 50 MB); (4) onde entra, desconto geral e parte dos navios.
  A coluna *Situação* mostra ✍ justificativa, Σ subsídios e 📎 documentos de cada rubrica.
- **Importar subsídios** (planilha modelo com as abas SUBSÍDIOS e JUSTIFICATIVAS) e **Pacote de subsídios (ZIP)**:
  planilha com rubricas, justificativas, composição e lista de documentos + os arquivos anexados, por rubrica.
- **Conferência com a planilha importada**: valor fechado de cada OM e diária de cada navio (aba PROPOSTA CONDOMINIO) e
  extrato de cada cliente (abas por OM), com ✓/⚠ no *Resultado da taxa*, no extrato da OM e no *Resultado das diárias*.

### 1-N. Critério de rateio, grupo NAVIOS, cadastro interligado e lista de navios (script 014)

Execute [`supabase/migrations/014_criterios_rateio.sql`](../supabase/migrations/014_criterios_rateio.sql) depois do 013
(idempotente). A parte dos navios já gravada em R$ vira percentual; a rubrica que só os navios pagavam (desconto geral =
valor inteiro) passa a "OM 0% · navios 100%", sem o desconto.

- **Critério por rubrica** (tabela de Rubricas ou Ficha › passo 4): *por pessoa* (lotação × dias, padrão), *por área*
  (m²), *partes iguais* ou *peso informado* (qualquer outro critério). Área e peso de cada OM entram na aba Clientes e
  matriz (as colunas aparecem quando alguma rubrica usa o critério).
- **% OM**: parte do valor dividida entre as OM (100 = integral; menos = parcial). **Navios %**: parte cobrada do grupo
  NAVIOS. **Os navios pagam**: *à parte* (padrão 2026 — não diminui o que as OM pagam, garantindo o contrato mesmo se os
  navios não atracarem) ou *junto com as OM* (um só valor dividido pela lotação; a parte dos navios reduz a das OM).
- **Grupo NAVIOS** não é rubrica: é a soma do que os navios pagam nas rubricas de que participam (linha ⚓ NAVIOS na
  matriz), dividida entre os navios pela lotação × dias. O total "Navios" da planilha fica só para conferência.
- **Justificativas, subsídios e documentos são opcionais** (para qualquer ano).
- **Faturas e Recebimentos (ALTCRED/GRU)**: o campo *Cliente* busca no Cadastro de OM (nome, sigla, código, nome
  alternativo ou comando), preenche UG, setor e comando e liga o registro à OM; dá para cadastrar cliente novo na hora.
  (No Fluxo de caixa o "cliente" é o favorecido da nota de empenho, não uma OM.)
- **Cadastros › Lista de navios** (Administrador): confere a aba LISTA DE NAVIOS (e DIARIAS) do Histórico Trienal com o
  cadastro — classes a criar, navios fora do cadastro (incluir ou ligar a um existente), navios com classe diferente
  (corrigir) e navios ativos fora da lista. A aba Navios da taxa mostra a classe de cada navio e avisa quem está sem
  classe (sem média trienal, a diária sai pela lotação).

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

## Script 031 — vencimentos anteriores a 2025
Recalcula o vencimento (emissão + 30 dias corridos → próximo dia útil) e a data-limite (emissão + 10 dias úteis) das faturas com ponto de atenção de data cuja emissão ou competência é anterior a 2025, e marca esses pontos como resolvidos. O vencimento antigo fica em `vencimentos_anteriores_011` (para desfazer: `update invoices set due_date = due_date_anterior from vencimentos_anteriores_011 ...`).

## Script 032 — Regime de fim de exercício (OND) por serviço, com exceções por OM (Fase A)

**Para que serve:** definir, para cada serviço, como ele é tratado no fim do exercício, sem mexer em nenhuma fatura.
- **Regime 1 – Estimativa e acerto:** uma fatura estimada em outubro (OUT–DEZ) e acerto com o consumo real em janeiro.
- **Regime 2 – Mensal normal:** continua faturando em out, nov e dez (sem estimativa e sem acerto).
- **Regime 3 – Não participa:** fora da estimativa e do acerto.
- **Sem regra:** o faturamento segue exatamente como era antes.

**Como funciona:** a regra do serviço vale para todas as OMs que o têm; a **exceção por OM** vale só para ela. Para uma OM e um serviço em um exercício, vale: 1) a exceção da OM mais recente com vigência até o exercício; 2) senão, a regra do serviço mais recente; 3) senão, "sem regra". A mudança vale **a partir do exercício informado** (o atual ou um futuro) e nunca recalcula exercícios anteriores.

**Onde:** Cadastros › **Regimes OND** (operador e administrador alteram; o histórico mostra quem, quando, o regime e o motivo). Antes de confirmar, a tela mostra quantas OMs mudam e **bloqueia** o que levaria a duplicidade (passar para o regime 1 com faturamento mensal de nov/dez já emitido) ou a estimativa sem acerto (sair do regime 1 com estimativa já emitida no exercício).

**O que o script faz (idempotente, sem DROP):** cria a tabela `regime_ond` (só recebe linhas novas; UPDATE e DELETE são recusados), com permissões (todos leem; operador e administrador gravam) e trilha de auditoria; e grava a configuração inicial de 2026 (`origem = MIGRACAO`), que reproduz o que foi faturado em 2025:
- regra do serviço: AE, EL, CR, TC e DA = 1; AL = 2; VT e RB = 3. TL e demais ficam **sem regra**;
- exceção para a OM cujo padrão de 2025 foi diferente da regra do serviço (R1 = fatura em outubro e nenhuma em nov/dez; R2 = out, nov e dez; R3 = nenhuma em out–dez, mas faturou jan–set). RB com fatura só em outubro **não** vira exceção.

**Efeito no faturamento:** só o lote **OND** (estimativa de outubro) consulta a regra: OMs em regime 2 ou 3 não entram, e a prévia avisa "Fora da estimativa pelo regime…". A média continua **3 × média JAN–AGO com divisor 8**. O **acerto** continua partindo das faturas estimadas já emitidas (uma estimativa emitida sempre tem acerto). O PDF e a estrutura da fatura **não mudam**: 01 serviço, 02 adiantamento, 03 acerto acréscimo, 04 acerto débito, 05 total a pagar (= máx(0, 01 − 02 + 03 − 04)) e 06 total da fatura.

Testes: `tests/regimeOnd.test.ts` (regra, vigência, impacto, lote OND e fórmula do total a pagar), `tests/sql/regime_ond_032_tests.sql` (idempotência, imutabilidade, permissões) e o cenário "Regimes OND" do e2e.

## Script 033 — Livro de créditos por OM (Fase B)

**Regra central:** o crédito pertence à **OM**, não ao serviço. O crédito que sobra do acerto de um serviço (real menor que o estimado) abate a fatura de **qualquer serviço da mesma OM**. Não há transferência entre OMs.

**O livro (`creditos_om`)** só recebe linhas novas; alterar ou apagar é recusado pelo banco. Cada linha tem OM, data, valor, saldo anterior e posterior, serviço e exercício de origem, fatura de origem, fatura em que foi usado, documento (ALTCRED/GRU) e quem lançou:
- **Crédito de acerto** (+): gerado pela fatura de acerto; um acerto gera um crédito só.
- **Saldo de abertura** (+): lançado só pelo **administrador**, para o crédito de acertos anteriores ao SISCONT (exige documento e a origem).
- **Utilizado em fatura** (−): abatido na prévia do Lote mensal, na **linha 04** da fatura, do crédito **mais antigo** para o mais novo (FIFO); cada pedaço aponta para o crédito de origem.
- **Devolvido (ALTCRED/GRU)** (−): sai do crédito mais antigo.
- **Estorno**: linha de sinal contrário que desfaz um movimento (uma vez só). Fatura cancelada → o crédito que ela usou volta à OM; acerto cancelado → o crédito que ele gerou é estornado (**recusado se já foi usado ou devolvido**; nesse caso a fatura não é cancelada).

**Garantias no banco:** saldo nunca negativo; crédito de uma OM não é usado por outra; um crédito não tem mais saída do que o valor dele; a mesma fatura não usa o mesmo crédito duas vezes; **duas emissões ao mesmo tempo para a mesma OM não usam o mesmo saldo** (a linha da OM é travada: a segunda espera e, se o saldo acabou, é recusada, e o lote não é emitido).

**O que NÃO muda:** o PDF e as 5 linhas da fatura. O crédito aplicado entra na linha 04 (acerto débito), o valor do serviço (linha 01) fica preservado e o acerto continua comparando o estimado bruto com o real. O crédito aplicado não é "faturar a menos" para a média do OND.

**Onde:** Faturamento › **Créditos da OM** (saldo por OM, créditos em aberto, extrato, registrar devolução; o administrador lança saldo de abertura e estorna lançamentos manuais). O livro **começa zerado** (hoje não há acerto emitido nem crédito usado). Retificar (-1) uma fatura de acerto não altera o crédito já registrado; para mudar o valor do crédito, cancele o acerto (se o crédito não foi usado) e emita de novo.

Testes: `tests/creditosOm.test.ts`, `tests/sql/creditos_om_033_tests.sql` (incluindo a emissão simultânea, descrita no README dos testes SQL) e os cenários "Acerto do OND" e "Créditos da OM (Fase B)" do e2e.

## Script 034 — Meses sem movimento e apuração anual do OND (Fase D) · Painel e relatórios (Fase E)

**Regra da média:** a estimativa de outubro é **3 × a média de janeiro a agosto, dividida sempre por 8**. Um mês sem fatura só vale **zero** se estiver marcado como **sem movimento**; sem a marca é **pendência**: a fatura estimada sai **bloqueada** na prévia do lote ("Faltam as faturas de JUL, AGO"), com o botão **Marcar meses sem movimento** (pede confirmação) ou a opção de tirá-la do lote. Nunca se presume consumo zero.

**Estimativa sem duplicidade:** quem já tem fatura de outubro do exercício (para a OM e o serviço) **não entra de novo** no lote OND; a prévia avisa quantos ficaram de fora.

**Apuração em janeiro (acerto):** compara o estimado emitido com o real de **OUT, NOV e DEZ**, e exige os três meses (subsídio lançado ou "sem movimento"). Real maior → fatura de acerto a pagar (débito complementar); real menor → fatura de acerto e **crédito da OM** (entra no livro da Fase B); real igual → **sem fatura e sem crédito**, e a apuração é registrada como "sem diferença" (botão "Registrar apuração sem diferença"). A estimativa importada de uma OM no regime 1 e sem fatura mensal em nov/dez também é reconhecida como estimativa.

**Uma apuração por OM, serviço e exercício** (`apuracoes_ond`, índice único): guarda o estimado, o real, a diferença, o resultado, a **memória de cálculo**, quem apurou e quando. Não se apaga nem se altera: o administrador **cancela** com motivo (só se o acerto estiver cancelado ou sem fatura), e então o acerto pode ser apurado de novo. Repetir a rotina não apura de novo.

**Correção de subsídio depois de lançado:** os subsídios continuam editáveis (com trilha de auditoria); a apuração sempre usa o valor vigente no momento em que é feita.

**Painel — Faturamento › Encerramento do exercício** (e no **Painel do Encarregado**, só consulta): indicadores (OMs participantes, serviços estimados, estimativas emitidas, valor estimado, subsídios pendentes, apurações concluídas, créditos gerados, débitos complementares, saldo de créditos), filtros (exercício, OM, serviço, regime, situação, subsídios, acerto), a situação de cada OM e serviço (não configurado, pendente de estimativa, aguardando subsídios, parcialmente lançados, pronto para apuração, fatura complementar gerada, crédito registrado, sem diferença, apuração cancelada) e o **detalhe** (jan–ago, memória de cálculo, fatura estimativa, reais de out–dez, total real, diferença e resultado).

**Relatórios (Excel e PDF):** 1 participantes da estimativa · 2 estimativas emitidas · 3 subsídios reais pendentes · 4 estimativa × real · 5 créditos por OM · 6 extrato de utilização de créditos · 7 débitos complementares · 8 consolidado.

## Fase F — mapa dos 18 cenários de teste da especificação

| # | Cenário | Onde está testado |
|---|---|---|
| 1–4 | OM só no regime 1, só no 2, mista, sem participação | `tests/encerramento.test.ts`, `tests/regimeOnd.test.ts` |
| 5 | Sem histórico suficiente | `tests/encerramento.test.ts` (bloqueio, não presume zero) |
| 6–8 | Real maior, menor e igual ao estimado | `tests/encerramento.test.ts` |
| 9–12 | Crédito suficiente, parcial, maior que a fatura, vários créditos | `tests/creditosOm.test.ts` |
| 13 | Crédito de outra OM | `tests/creditosOm.test.ts`, `tests/sql/creditos_om_033_tests.sql` |
| 14 | Estimativa duplicada | `tests/encerramento.test.ts` |
| 15 | Mesmo acerto de novo | `tests/encerramento.test.ts`, `tests/sql/apuracao_ond_034_tests.sql`, e2e |
| 16 | Correção de subsídio | `tests/encerramento.test.ts` |
| 17 | Cancelar fatura com crédito aplicado | e2e "Créditos da OM", `tests/sql/creditos_om_033_tests.sql` |
| 18 | Duas faturas ao mesmo tempo | emissão simultânea descrita em `tests/sql/README.md` (script 033) |

## Assinatura dos PDFs (faturas e relatórios)
A assinatura é a mesma nas faturas e em todos os relatórios em PDF: **NOME** (maiúsculas), **posto/graduação**, **cargo** (padrão "Encarregado da Divisão de Contabilidade") e "ASSINADO DIGITALMENTE". Os três textos são editáveis em **Cadastros › Parâmetros e feriados › Assinatura dos PDFs** (parâmetros `encarregado_nome`, `encarregado_posto` e `encarregado_cargo`; o cargo vazio volta ao padrão). Sem nome cadastrado, a linha fica em branco, como nas faturas. O layout da fatura não mudou: só o texto do cargo passou a vir do parâmetro (o padrão é idêntico ao de antes).

## Lote de faturas: ordem por tipo e numeração; ZIP único no OND
- **Ordem:** a prévia e a emissão do lote saem organizadas por **tipo** (sigla do serviço: AE, DA, EL, ...) e, dentro de cada tipo, em ordem de **numeração** (extra-MB primeiro, depois setor, comando e cliente, como no livro de emissão). A numeração continua sequencial por serviço e **não mudou**: só a ordem da lista. Nos Lotes emitidos, as faturas também aparecem por tipo e número.
- **ZIP do lote OND:** um **ZIP único**, sem pastas por comando, com os PDF nomeados `AE-001_40030-AE-10-2026-001-0.pdf` (tipo e sequência na frente, para ficarem em ordem em qualquer lista). Os lotes mensal e de acerto continuam com o ZIP em pastas por comando; o botão "PDF" de cada comando segue disponível.

## PDF do Mapa Analítico: vencimento e atraso em colunas próprias
Na árvore do mapa (e no PDF), cada fatura mostra o **nome e número** na primeira coluna e, em colunas separadas, o **Vencimento** e o **Atraso** (dias). A cobrança por OM já tinha o vencimento em coluna própria.
