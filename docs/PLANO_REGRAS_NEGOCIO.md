# SISCONT — Regras de negócio e plano para concluir o sistema

_Elaborado em 06/11/2026 a partir da OI nº 40-04 (Contabilidade de OMPS-E) e anexos A–L, da planilha
`Pagamento 2026` (32 abas), das faturas emitidas (AGO26), da ALTCRED G471.2026.AC.00846, da OMS 021/26
e das trocas de e-mail com DIM, ComGptPatNavS e AviPa Marlim._

---

## 1. Como o trabalho funciona hoje (entendimento)

### 1.1 Quem faz o quê (OI 40-04, item 4)

| Seção | Atribuições que o sistema precisa apoiar |
|---|---|
| **Faturamento** | extrair telefonia do Info 360 (dia 1º); receber medições das divisões; **processar e emitir as faturas mensais** (TC, aluguel de espaço, DA, RB, AE, EL, TL, gás, VT); relatório e controle das faturas; **controle dos adiantamentos**; mensagem de envio das faturas às OM |
| **Contabilidade de Custos** | **atualizar anualmente a taxa condominial e a diária de atracação**; apurar custos; estimativa de despesas do ano seguinte (PAR) |
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
| `011` | sequencial — **observação**: é o mesmo todo mês para a mesma OM e serviço (DIM: TC sempre 014, AE sempre 004, EL sempre 010), ou seja, parece ser o nº de ordem do cliente no rol daquele serviço (**confirmar**) |
| `0` | **versão** — `-1` "cancela e substitui" a `-0` |

**Siglas em uso** (fórmula SWITCH da planilha + faturas extra-MB):

| Sigla | Serviço | "Emitida de acordo com" | Anexo / critério | Fonte dos dados |
|---|---|---|---|---|
| TC | Taxa condominial mensal | taxa estabelecida | B / K | tabela anual |
| AE | Água potável e coleta de esgoto | detalhamento (m³) | C / J 1.1–1.2 | Div. Serviços Auxiliares, até dia 10 |
| EL | Energia elétrica | detalhamento (kWh e kW demanda) | D / J 1.3–1.4 | Div. Eletricidade, até dia 10 |
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
| Fluxo de Caixa | entradas (documentos) e saídas (empenhos) | **não aparece na OI** — confirmar finalidade (ver decisões) |

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
- AE/EL: valor informado ou **rateio** do custo total da concessionária pelo consumo; não mensurável =
  **média das 3 últimas** (Anexo J 1.2/1.4).
- RB/VT/TL/CR: valor por tabela ou informado.

3.3 **Emissão em lote**: gera todas as faturas da competência com **número automático**
(OM-SIGLA-MM-AAAA-SEQ-V), emissão no dia 15, **data-limite = +10 dias úteis**, e **abatimento automático
do adiantamento** disponível (linha 02 + texto "Baixa na ALTCRED ...").

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

### Fase 6 — Rotinas anuais

6.1 **Taxa condominial**: rubricas do Anexo K com custo estimado e critério de rateio (lotação, nº de
subestações, nº de ramais, estações + impressoras, OM beneficiárias de cada serviço) → valor mensal por
OM e % por rubrica; versão por exercício com status (proposta/aprovada ComImSup/divulgada).
6.2 **Diária de atracação**: lotação do navio e **média de dias atracados nos últimos 3 anos** calculada
a partir do histórico de faturas DA (ou da classe) → diária do exercício.

### Fase 7 — Qualidade e conformidade
- Trilha de auditoria (quem criou/alterou/cancelou cada fatura e baixa).
- Backup automático; documentação DCTIM para homologação.

---

## 5. Decisões que dependem de você

1. **Sequencial do número da fatura** (`-011-`): é o nº de ordem fixo do cliente naquele serviço? Onde fica esse rol?
2. **Vencimento**: usar sempre "+10 dias úteis" ou manter a data-limite fixa (ex.: dia 30)? Hoje a planilha tem 28, 30 e 31 dias.
3. **Água e energia**: a Contabilidade calcula o rateio a partir da conta da concessionária, ou as divisões já mandam o valor em R$?
4. **Fluxo de Caixa (empenhos)**: qual a finalidade? Não aparece na OI; manter, renomear ou remover?
5. **Acesso das OM clientes** (consulta do próprio extrato) — desejado no futuro?
6. **Ordem das fases**: sugestão 1 → 2 → 3 → 4 → 5 → 6 (conciliação primeiro porque é onde estão os erros de valor).
