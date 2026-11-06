# SISCONT — Regras de negócio e plano para concluir o sistema

_Elaborado em 06/11/2026 a partir da OI nº 40-04 (Contabilidade de OMPS-E) e anexos A–L, da planilha
`Pagamento 2026` (32 abas), das faturas emitidas (AGO26), da ALTCRED G471.2026.AC.00846, da OMS 021/26
e das trocas de e-mail com DIM, ComGptPatNavS e AviPa Marlim._
_Revisão 2 (06/11/2026): incorporadas as planilhas Faturamento (livro de emissão 2022–2026), Fluxo de caixa,
Proposta 4 – Atualização da Taxa Condominial 2026, Rateio de energia ABR26 e Faturas em Aberto OUT26, e as
respostas do usuário (rateio vem das divisões; sequencial é por ordem de emissão; fluxo de caixa é da Seção de
Custos)._

---

## 1. Como o trabalho funciona hoje (entendimento)

### 1.1 Quem faz o quê (OI 40-04, item 4)

| Seção | Atribuições que o sistema precisa apoiar |
|---|---|
| **Faturamento** | extrair telefonia do Info 360 (dia 1º); receber medições das divisões; **processar e emitir as faturas mensais** (TC, aluguel de espaço, DA, RB, AE, EL, TL, gás, VT); relatório e controle das faturas; **controle dos adiantamentos**; mensagem de envio das faturas às OM |
| **Contabilidade de Custos** | **atualizar anualmente a taxa condominial e a diária de atracação**; apurar custos; estimativa de despesas do ano seguinte (PAR); **controlar o fluxo de caixa** (ALTCRED recebidas × notas de empenho por rubrica) — atribuição exercida na prática e ainda **ausente da OI** |
| **Acompanhamento Contábil** | **conciliar créditos (ALTCRED no SIPLAD) com as faturas**; registrar faturas e pagamentos no SIAFI; controlar saldos devedores; GRU dos clientes extra-MB (Fundo Naval); inserir faturas no SIPLAD e quitá-las; informar ao Faturamento os saldos de adiantamento |
| **Encarregado da Divisão** | mensagens de **faturas em atraso**; controle das dívidas dos condôminos |

### 1.2 Ciclo mensal (observado nos documentos)

```
Dia 1º      Telefonia: extração Info 360 (mês anterior)
Até dia 08  Rebocadores (1ª quinzena)       ┐
Até dia 10  Água (Div. Serv. Auxiliares)    │  dados enviados
            Energia (Div. Eletricidade)     │  à Seção de
            Diárias de atracação (Manobras) │  Faturamento
            Viaturas (Div. Transportes)     │
Até dia 24  Rebocadores (2ª quinzena)       ┘
Dia 15      EMISSÃO (1.304 das 1.415 faturas de 2026 foram emitidas no dia 15)
            Referência = mês anterior (ex.: emitida 15/09/26, REFERÊNCIA AGO26)
            Abatimento do adiantamento disponível (linha 02) — "Baixa na ALTCRED ..."
            Envio por mensagem + inserção no SIPLAD
+10 dias úteis  Prazo de certificação/liquidação pela OM (OI 6.1) — valor congelado
Contínuo    ALTCRED recebida → baixa nas faturas → sobra vira ADIANTAMENTO
            Contestações → verificação com o setor medidor → ratifica ou cancela/substitui
            Cobrança de vencidas; correção por atraso (OI 6.2)
```

### 1.3 Ciclo anual
- **2º semestre**: revisão da **taxa condominial** — TMFT de cada condômino, estimativa das rubricas
  (33 rubricas do Anexo K), rubricas efetivamente usadas, inclusão/exclusão; reuniões; aprovação do
  ComImSup; **divulgação até novembro** (OI 5).
- **Diária de atracação** por navio: lotação × média histórica de dias atracados (ou da classe) nos últimos
  3 anos, compondo as 9 facilidades do Anexo L.

### 1.4 Estrutura dos dados

**Hierarquia de clientes** (abas FATURAS e relatórios enviados à DIM):
`SETOR` (COMOPNAV, DGMM, SGM, DGPM, DGN, DGDNTM, CGCFN, SecNSNQ, CCEM-RIO, CM, Extra-MB)
→ `COMANDO / ComImSup` (ex.: 91610 – Com. do 1º Esquadrão de Escolta)
→ `OM cliente` (ex.: 91645 – Corveta Barroso).
Códigos de OM têm **5 dígitos**. A aba CLIENTES guarda o **indicativo naval** (COMEST, PRESID, SBKUNA...) usado nas mensagens.

**Número da fatura**: `91645-DA-08-2026-011-0`

| Parte | Significado |
|---|---|
| `91645` | código da OM usuária |
| `DA` | sigla do serviço |
| `08-2026` | mês/ano de **competência** (referência) |
| `011` | sequencial **por ordem de emissão** dentro do serviço e da competência: vai de 001 a N, sem lacunas nem repetições (conferido em JUL, AGO e SET26 — ex.: SET26 teve 40 faturas EL numeradas 001–040). Parece fixo para a DIM só porque a ordem dos clientes no lote se mantém |
| `0` | **versão** — `-1` "cancela e substitui" a `-0` |

**Siglas em uso** (fórmula SWITCH da planilha + faturas extra-MB):

| Sigla | Serviço | "Emitida de acordo com" | Anexo / critério | Fonte dos dados |
|---|---|---|---|---|
| TC | Taxa condominial mensal | taxa estabelecida | B / K | tabela anual |
| AE | Água potável e coleta de esgoto | detalhamento (m³) | C / J 1.1–1.2 | Div. Serviços Auxiliares, até dia 10 — **já rateado (R$ por OM)** |
| EL | Energia elétrica | detalhamento (kWh e kW demanda) | D / J 1.3–1.4 | Div. Eletricidade, até dia 10 — **já rateado** (aba "DADOS BNIC-41": OM, código, dias, kWh, kW, R$, centro de custo) |
| DA | Diária de atracação | diária estabelecida (R$ × dias) | F / L | Div. Manobras/Marítima, até dia 10 |
| RB | Rebocador | detalhamento | G / J 1.9 | Div. Manobras, dias 08 e 24 |
| VT | Aluguel de viaturas | detalhamento (horas + km) | H / J 1.7 | Div. Transportes, até dia 10 |
| TL | Telefonia (fixa e móvel) | consumo apurado (minutos) | A / J 1.6 | Info 360, dia 1º |
| CR | Cópia reprográfica | — | (sem anexo) | — |
| RI | Resíduos industriais | detalhamento em anexo | E | — |
| AL | Aluguel de espaço (extra-MB) | — | I | contrato |
| GS | Gás (citado na OI, Anexo E na lista) | consumo medido | J 1.5 | — |

**Composição da fatura (modelo FR-172)**:
`01 (+) total serviço prestado − 02 (−) adiantamento + 03 (+) acerto acréscimo − 04 (−) acerto débito = 05 total a pagar`.
Extra-MB não tem a linha de adiantamento e é paga por **GRU** (com CNPJ e endereço do cliente).

**Crédito (ALTCRED, SIPLAD)**: nº `G471.2026.AC.00846` (prefixo = setor emitente; **um mesmo prefixo
atende várias OM** — G471 pagou faturas de 8 clientes diferentes), tipo "Indenização de Serviços
Prestados", UG cliente, valor, PI/ND/PTRES, observação do solicitante (diz **para quais faturas/OM** o
crédito se destina), situação. Classificação interna: **PAGAMENTO** ou **ADIANTAMENTO** (ou aguardando
processamento). Uma ALTCRED quita várias faturas de várias OM subordinadas; a sobra é enviada para
adiantamento e abatida nas faturas seguintes.

### 1.5 Planilhas complementares (revisão 2)

**Faturamento (livro de emissão)** — uma aba por mês (2022–2026) e uma consolidação anual. Colunas: setor,
comando, cliente, fatura, consumo, unidade, valor do serviço, adiantamento, acréscimo, débito, valor final,
datas, competência, tipo. Em 2026: R$ 28,3 milhões faturados (R$ 22,6 milhões líquidos de adiantamento).

**Rateio de energia (Div. Eletricidade)** — leituras por medidor → consumo por OM; dados da conta Light
(consumo fora de ponta/ponta, demanda contratada 7.000 kW, encargos, iluminação pública, energia comprada da
Matrix); participação de cada OM = kWh da OM ÷ kWh do CNIC, aplicada a consumo, demanda e encargos; **AMRJ
recebe o resíduo** (total do CNIC − demais OM). Resultado enviado à Contabilidade na aba "DADOS BNIC-41".

**Fluxo de caixa (Seção de Custos)** — por mês: entradas = ALTCRED recebidas (nº, cliente, valor); saídas =
**notas de empenho** (`740015000012026NE000099`: UG 740015, gestão 00001, ano, nº) com favorecido, valor,
**rubrica da taxa condominial** (12, 14, 26, 32…) ou categoria (ENERGIA, AGUADA, TELEFONIA, REBOCADOR, OUTROS)
e descrição; saldo acumulado que passa de um mês para o outro. Abas de apoio: **CONDOMÍNIO** (por rubrica:
valor vigente × taxa condominial recebida × empenhado × saldo em conta × a receber) e **DISPONÍVEL R.901.16**
(entradas, saídas e saldo por energia, água, telefonia, condomínio/diária/viatura e "sem indicação").

**Proposta da taxa condominial 2026** — o modelo completo de cálculo:
1. *Despesas*: 33 rubricas (+34 "outros gastos") com conta contábil, valor previsto 2026, gasto 2025, variação e descontos;
2. *Matriz OM × rubrica*: quais clientes participam de cada rubrica, agrupados pelas 5 áreas do CNIC;
3. *Rateio por rubrica*: peso = **lotação × dias** (OM de terra = 30; navio = média de dias atracados no mês,
   ex.: 9; 21,44; 0,74); parcela = peso ÷ soma dos pesos das beneficiárias × valor da rubrica;
4. *Descontos negociados* (ex.: 23,5% SecNSNQ; servidor civil AMRJ; rubrica 20 do Batalhão Naval);
5. *Extrato demonstrativo por OM* (valor anual, mensal e %RUB por rubrica) e *quadro comparativo* taxa 2025 × proposta 2026;
6. *Navios*: diária = **custo por militar-dia × lotação** (ex.: Mearim, lotação 35 → R$ 95,51/dia).

**Faturamento estimado de fim de exercício (OND)** — em 23/10/26 foi emitido o lote "OND26" (competência
OUT, vencimento 31/10), e há o precedente "Estimado (OND) 2025". Nele a **taxa condominial é cobrada em
triplo** (OUT+NOV+DEZ — AMAZUL: 819,76 → 2.459,28) e os **consumos repetem os de SET** (ex.: Santander EL
1.654 kWh / R$ 1.284,73; EMGEPRON EL 52.500 kWh), para que as OM paguem antes do encerramento do exercício.
O sistema precisa de um **lote "estimado"** e do **acerto** posterior contra o consumo real (regra a confirmar).

**Faturas em aberto por comando** — extrato mensal por comando (comando, cliente, fatura, valor, total,
instruções de pagamento, assinatura do Encarregado) enviado para cobrança.

---

## 2. Problemas reais encontrados nos dados e nos e-mails

| # | Evidência | Regra que o sistema deve garantir |
|---|---|---|
| D1 | ALTCRED **X488.2026.AC.00268** usada em dobro (recebido 148.953,43; baixado 297.906,86) | soma das baixas ≤ valor da ALTCRED (bloqueio) |
| D2 | **135 vencimentos inválidos** ("31/11/26", "15/11/02") e 11 com ano 2005 | datas sempre válidas, calculadas pelo sistema |
| D3 | Mesmo cliente com grafias diferentes ("62200 – CIAW" × "62200 - CIAW"; "GNHo" × "GNHO") | cliente escolhido de cadastro, nunca digitado |
| D4 | 9 lançamentos com ALTCRED de 2025 não cadastrada | ALTCRED de exercício anterior cadastrável; saldo "vira o ano" |
| D5 | DIM: ALTCRED do Mangaratiba (G424.2026.AC.00370) baixada em fatura de outro setor da DIM | registrar a **destinação** da ALTCRED e alertar baixa fora dela |
| D6 | DIM precisou montar planilha própria para conferir saldo (R$ 366.315,15 transferidos) | **extrato de conciliação por cliente** em 1 clique |
| D7 | NApOc Mearim: contestação de abril sem resposta até setembro (5 meses) | **fluxo de contestação com prazo e alerta** |
| D8 | AviPa Marlim: fatura AE contestada (navio docado em Niterói) | contestação vinculada ao setor medidor e à OMS |
| D9 | Faturas canceladas/contestadas controladas em abas separadas e no campo observação | status próprios + histórico |
| D10 | Modelos F e G (Anexos) trazem "05 TOTAL FATURA (01 – 02 – 03)" | usar a fórmula correta (06 = 01 − 02 + 03 − 04) e sugerir correção dos anexos |
| D11 | Relatórios (vencidas 2025/2026, a vencer, por setor) montados com tabelas dinâmicas manuais | relatórios prontos e sempre atualizados |
| D12 | Extrato "Faturas em Aberto OUT26" da DIM cobra 3 faturas do Mangaratiba (R$ 41.660,42) que a planilha de controle mostra **pagas** pela ALTCRED G424.2026.AC.00370 em 25/08 | extrato gerado da mesma base do controle — nunca montado à mão |
| D13 | Fluxo de caixa com valores digitados como texto ("R$ 26.307,29") → saldo `#VALUE!`; entradas faltando → saldo de DEZ25 em −R$ 12,5 milhões | entradas vindas automaticamente das ALTCRED cadastradas; valores sempre numéricos |
| D14 | Rateio de energia: linha "PAPEM (Ed. 23)" com código 49001 (que é do CTIM); BNIC-RANCHO com 40015 numa aba e 40016 na outra | importação valida o código contra o cadastro de OM |
| D15 | Livro de emissão com números como texto e "Valor Final" ora número, ora "R$ 0,00" | valores numéricos e calculados (05 = 01 − 02 + 03 − 04) |
| D16 | A planilha de rateio de energia guarda uma senha de proteção e endereços de rede em texto aberto | não manter credenciais em planilhas; o sistema não armazena esse tipo de dado |

Situação atual da planilha: **1.415 faturas em 2026** (1.110 pagas, 171 vencidas, 121 a vencer, 6
contestadas, 6 canceladas), **R$ 8,08 milhões em aberto** (R$ 289,8 mil de competência 2025),
**290 ALTCRED** (245 pagamento, 45 adiantamento), **22 com saldo disponível (R$ 1,72 milhão)**,
867 lançamentos de baixa, 4.706 faturas pagas no histórico 2023–2025 e 435 extra-MB pagas.

---

## 3. O que o SISCONT já tem × o que falta

| Área | Já existe | Falta |
|---|---|---|
| Usuários e permissões | completo (sessão anterior) | perfis por **seção** (Faturamento, Custos, Acompanhamento) — opcional |
| Cadastro de clientes | lista plana: código, setor, comando, nome | hierarquia Setor → Comando → OM; tipo (terra/navio/extra-MB); área do CNIC; indicativo naval; lotação/TMFT; CNPJ/endereço (extra-MB); classe do navio; contatos |
| Tipos de serviço | nome, unidade, sigla | texto oficial, "emitida de acordo com", setor responsável e telefone, prazo de envio, anexo/modelo, campos de detalhamento |
| Faturas | cadastro manual, acertos, adiantamento, cancelar, SIPLAD, PDF simples, CSV | **número automático**; **vencimento calculado**; **versões (cancela e substitui)**; status CONTESTADA/SUBSTITUÍDA/PAGO A MAIOR; **PDF no modelo FR-172**; emissão **em lote**; detalhamento por serviço (m³, kWh/kW, diária × dias, fixa/móvel) |
| Medições do mês | — | entrada/importação por serviço e **painel de pendências por divisão** |
| Cálculo | — | TC por tabela; DA = diária × dias; rateio AE/EL; média de 3 meses para não mensuráveis |
| ALTCRED / GRU | cadastro e alocação manual | dados SIPLAD completos; **destinação**; estorno; **importar PDF da ALTCRED**; ler nº de faturas da observação e **propor baixa automática**; sobra → adiantamento automático; GRU com autenticação bancária |
| Contestação | — | fluxo completo com prazo e alertas |
| Correção por atraso (OI 6.2) | — | cálculo pela poupança e fatura de acerto |
| Relatórios | dashboard, PDF de listas | **extrato de conciliação por cliente**; quadro de vencidas/a vencer por setor e tipo; mensagem de cobrança; auditoria automática |
| Anual | — | cálculo da **taxa condominial** (33 rubricas) e da **diária de atracação** |
| Migração | — | importar a planilha `Pagamento 2026` com relatório de saneamento |
| Fluxo de Caixa | entradas (documentos) e saídas (empenhos) com rubrica em texto livre | rubrica ligada ao catálogo das 33 rubricas; categoria por serviço; nº da NE validado; saldo mensal automático; painel **Condomínio por rubrica** e **Disponível R.901.16** (Fase 5-A) |

---

## 4. Plano de implementação

Cada fase entrega algo utilizável e é publicada no site ao final. Critérios de aceite entre colchetes.

### Fase 1 — Fundação de dados (pré-requisito de todo o resto)

1.1 **Cadastro hierárquico de clientes**
- Tabelas `setores`, `comandos` (código, nome, sigla, setor), `oms` (código 5 dígitos, nome, sigla,
  indicativo naval, tipo TERRA/NAVIO/EXTRA_MB, comando, área CNIC 1–5, lotação/TMFT, classe do navio,
  CNPJ, endereço, e-mails, ativo).
- Faturas e ALTCRED passam a apontar para `om_id`/`comando_id` (sem texto livre).
- [Não é possível lançar fatura para cliente fora do cadastro; nomes únicos por código.]

1.2 **Catálogo de serviços conforme a OI**
- Sigla, nome oficial ("SERVIÇO PRESTADO"), "EMITIDA DE ACORDO COM", unidade(s) de medida, campos de
  detalhamento, setor responsável + telefone RETELMA, prazo de envio dos dados, anexo/modelo, critério.
- Já vem preenchido com os 11 serviços da tabela 1.4.

1.3 **Parâmetros do exercício**
- Código OMPS-E (40015), CNPJ da BNIC, Encarregado da Divisão (nome/posto) para assinatura,
  texto das instruções (AI R.901.16 / ND 33.90.39 e "DOIS) ... Circular nº 7/2026 da SGM"),
  dia padrão de emissão (15), prazo de certificação (10 dias úteis), **calendário de feriados**.

1.4 **Migração da planilha `Pagamento 2026`**
- Importa CLIENTES, FATURAS, Faturas Pagas (2023–2025), Extra-MB, ALTCRED, LANÇAMENTOS,
  RESUMO ADIANTAMENTO, CANCELADAS, CONTESTADAS.
- Gera **relatório de saneamento** (datas inválidas, grafias divergentes, ALTCRED estourada,
  ALTCRED 2025 ausentes) para correção antes de confirmar.
- [Saldos por cliente e por ALTCRED batem com as abas ALTCRED/ADIANTAMENTOS.]

### Fase 2 — Recebimentos e conciliação (maior ganho imediato)

2.1 **ALTCRED completa**: nº, datas (criação/situação), tipo SIPLAD, classificação
(PAGAMENTO/ADIANTAMENTO/AGUARDANDO), UG cliente, comando pagador, valor, PI, ND, PTRES, FR,
**observação do solicitante**, **destinação** (OM e/ou faturas), estornos (valor original × estornado),
exercício. Aceita ALTCRED de exercício anterior.

2.2 **Importar o PDF "Solicitações de Alteração de Crédito"** do SIPLAD e preencher o cadastro.

2.3 **Baixa assistida**: o sistema lê os números de fatura citados na observação, propõe a baixa
(mais antigas primeiro), impede ultrapassar o saldo da ALTCRED e o saldo da fatura, e envia a sobra
para **adiantamento** ("SALDO ENVIADO PARA ADIANTAMENTO"). Alerta quando a baixa sai da destinação (D5).

2.4 **GRU (extra-MB)**: data de pagamento e autenticação bancária.

2.5 **Extrato de conciliação por cliente/comando** — exatamente os 4 quadros enviados à DIM:
Saldo ALTCRED · Adiantamentos utilizados · Faturas pagas (por data de situação) · Faturas em aberto.
PDF e Excel em 1 clique. [Reproduz os PDFs anexados ao e-mail de 21/09/26.]

2.6 **Auditoria automática** (substitui a aba AUDITORIA): fatura × soma das baixas (PAGO / FALTA
PAGAR / PAGO A MAIOR), ALTCRED com saldo negativo, baixas sem ALTCRED, datas inválidas.

### Fase 3 — Ciclo de faturamento mensal

3.1 **Medições do mês**: tela por serviço/competência para lançar ou **importar planilha** das divisões
(m³; kWh + kW; dias atracados; horas + km; minutos fixa/móvel; manobras). **Painel de pendências**: quais
divisões ainda não enviaram, com o prazo da OI.

3.2 **Cálculo**
- TC: valor mensal da tabela anual vigente da OM.
- DA: diária vigente do navio × dias atracados (conferência com OMS opcional).
- AE/EL: **importa o rateio enviado pelas divisões** (formato "DADOS BNIC-41": código, kWh/m³, kW, R$).
  O sistema **confere** — soma do rateio = valor da conta da concessionária; códigos existentes no cadastro;
  OM sem leitura no mês → alerta (não mensurável = média das 3 últimas, Anexo J 1.2/1.4).
- RB/VT/TL/CR: valor por tabela ou informado.

3.3 **Emissão em lote**: gera todas as faturas da competência com **número automático**
(OM-SIGLA-MM-AAAA-SEQ-V; **SEQ = 001…N por serviço e competência, na ordem do lote**, sem lacunas; fatura
avulsa recebe o próximo número livre), emissão no dia 15, **data-limite = +10 dias úteis**, e **abatimento
automático do adiantamento** disponível (linha 02 + texto "Baixa na ALTCRED ...").
O lote substitui o livro de emissão (planilha Faturamento) e registra consumo e unidade de cada fatura.
Tipo de lote **"Estimado de fim de exercício (OND)"**: TC multiplicada pelos meses cobertos, consumo estimado
(último mês ou média) e marcação para **acerto** posterior com o consumo real.

3.4 **PDF fiel ao modelo FR-172** (Anexos A–I), com o bloco de detalhamento de cada serviço, contato do
setor, instruções de pagamento, Encarregado e — nas versões — "Esta fatura cancela e substitui a de nº ...".
Download individual ou **ZIP por comando**.

3.5 **Envio**: texto da mensagem de envio por comando (com indicativos), lista das faturas; marcação
"enviada", "inserida no SIPLAD", "certificada", "quitada no SIPLAD", "registrada no SIAFI".

### Fase 4 — Contestação, cancelamento e acertos

4.1 **Contestação**: abertura (data, origem SIPLAD/e-mail, justificativa da OM), encaminhamento ao
setor medidor com **prazo**, resposta, decisão **RATIFICADA** (mantém) ou **RETIFICADA** (gera nova
versão) ou **CANCELADA**; histórico e anexos (ex.: OMS). Painel de contestações paradas (D7).

4.2 **Cancela e substitui**: cria a versão `-1` a partir da `-0`, transfere as baixas, a original fica
SUBSTITUÍDA. Cancelamento simples com motivo obrigatório.

4.3 **Correção por atraso (OI 6.2)**: calcula a diferença pela taxa diária equivalente à poupança
(tabela mensal de taxas) e emite fatura de acerto. Bloqueia correção dentro dos 10 dias úteis (OI 6.1).

### Fase 5 — Cobrança e relatórios gerenciais

5.1 **Quadro de faturas em aberto**: vencidas por exercício (2025, 2026), a vencer, total — por setor
("Setor Material" × demais), comando e tipo; "Atualizado em".
5.2 **Mensagem de cobrança de faturas em atraso** por comando (texto pronto para o SIGAD).
5.3 **Painel do Encarregado**: dívida por condômino, idade da dívida, contestações abertas, ALTCRED
com saldo parado, adiantamentos disponíveis.
5.4 **Receita por rubrica** (aba TAXA CONDOMINIAL: % da rubrica × total arrecadado) para a Seção de Custos.

### Fase 5-A — Fluxo de caixa (Seção de Contabilidade de Custos)

5A.1 **Entradas automáticas**: cada ALTCRED/GRU cadastrada na Fase 2 já entra no fluxo (sem redigitação).
5A.2 **Saídas = notas de empenho**: nº da NE (validado), data, favorecido, valor, **rubrica** (das 33 do
Anexo K) ou **categoria** (energia, água, telefonia, rebocador, outros), descrição; anulação/cancelamento.
Importação da lista de NE (planilha/relatório) em vez de digitação.
5A.3 **Saldo mensal automático** com transporte de saldo e fechamento do exercício.
5A.4 **Painel Condomínio por rubrica**: valor vigente (da Fase 6) × taxa condominial recebida (receita
distribuída pelo %RUB) × empenhado × saldo em conta × a receber.
5A.5 **Disponível R.901.16** por categoria (energia, água, telefonia, condomínio/diária/viatura, sem
indicação): entradas, saídas e saldo.

### Fase 6 — Rotinas anuais

6.1 **Taxa condominial** (reproduz a "Proposta 4"): despesas por rubrica com conta contábil, previsto ×
gasto no ano anterior; **matriz OM × rubrica**; lotação atual e anterior de cada OM; dias (30 para terra,
média de dias atracados para navio); rateio peso = lotação × dias; **descontos** por OM/rubrica com
justificativa; extrato demonstrativo por OM (anual, mensal, %RUB); quadro comparativo ano anterior × proposta
(o "Anexo B" da divulgação); versão por exercício com status (proposta → aprovada ComImSup → divulgada) e
publicação da tabela vigente para a emissão mensal (Fase 3).
6.2 **Diária de atracação**: custo por militar-dia (do modelo da taxa condominial, grupo NAVIOS) × lotação
do navio; média de dias atracados calculada a partir do histórico de faturas DA dos últimos 3 anos.

### Fase 7 — Qualidade e conformidade
- Trilha de auditoria (quem criou/alterou/cancelou cada fatura e baixa).
- Backup automático; documentação DCTIM para homologação.

---

## 5. Decisões

**Respondidas (06/11/2026)**
- Rateio de água e energia: **as divisões enviam pronto** → o sistema importa e confere (Fase 3.2).
- Sequencial: **por ordem de emissão**, 001…N por serviço e competência (Fase 3.3).
- Fluxo de caixa: **atribuição da Seção de Contabilidade de Custos**; a OI precisa ser atualizada (Fase 5-A e item 6).

**Pendentes**
1. **Vencimento**: no livro de emissão de 2026 o vencimento foi o dia 15 do mês seguinte à emissão até a competência JUL; a partir da competência AGO (emitida 15/09) passou a ser o último dia do mês da emissão (30/09, 31/10). Essa é a regra a adotar daqui em diante?
2. **Faturamento estimado OND**: a regra é "taxa condominial × 3 + consumo de setembro"? Como é feito o acerto com o consumo real de OUT, NOV e DEZ (fatura de acerto no ano seguinte, acréscimo/débito)?
3. **Acesso das OM clientes** (consulta do próprio extrato) — desejado no futuro?
4. **Ordem das fases**: sugestão 1 → 2 → 3 → 4 → 5 → 5-A → 6 → 7.

## 6. Pontos para a atualização da Ordem Interna 40-04

| Item | Situação atual | Sugestão |
|---|---|---|
| 4.4 (Seção de Custos) | não cita o fluxo de caixa | incluir: "f) controlar o fluxo de caixa, registrando os créditos recebidos (ALTCRED/GRU) e as notas de empenho por rubrica da taxa condominial e por serviço, e acompanhar o saldo disponível na AI R.901.16" |
| Lista de anexos | "E) Modelo de Fatura de Fornecimento de **Gás**" | o arquivo do Anexo E é "Modelo de Fatura de **Descarte de Resíduo Industrial**": ajustar o título ou incluir os dois modelos |
| Anexos F e G | "05 TOTAL FATURA (01 – 02 – 03)" | "06 TOTAL FATURA (01 – 02 + 03 – 04)", como nos demais |
| Numeração da fatura | não definida na OI | incluir a regra: `código da OM – sigla – mês – ano – sequencial por serviço e competência – versão`, e que a versão "-1" cancela e substitui a anterior |
| Data-limite / vencimento | OI 6.1 fala em 10 dias úteis; prática varia | fixar a regra adotada |
| Contatos dos setores | modelos citam BNIC-32/33; faturas emitidas citam BNIC-34/35 e Agente de Manobras | atualizar os modelos com o setor e telefone vigentes |
| Serviços sem modelo | CR (cópia reprográfica) e AL (aluguel) são faturados sem anexo próprio | incluir modelos ou citar o modelo genérico |
| Taxa condominial (item 5) | descreve o rito, não o cálculo | anexar o critério de rateio adotado: peso = lotação × dias (terra 30; navio = média de dias atracados) e a regra dos descontos |
