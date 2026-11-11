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

## Script 004 (migração de faturas)

Com 001–003 aplicados: `psql -d sb -f tests/sql/fase1b_004_tests.sql` (o arquivo prepara o banco, aplica o 004
duas vezes e verifica). Esperado: setor TM removido e o Tribunal Marítimo mantido como OM sem setor; as cinco
colunas novas em `invoices`; número de fatura repetido (mesmo com espaços) recusado; `om_tem_movimento` = t para
OM com fatura ligada por `om_id` (mesmo com nome diferente) e exclusão dessa OM recusada.

## Script 005 (pontos de atenção)

Com 001–004 aplicados: `psql -d sb -f tests/sql/fase1b_005_tests.sql`. Esperado: coluna `pontos_atencao` (padrão
`[]`) em `invoices` e `received_documents`; consulta por tipo com `@>` retorna 1; nulo recusado.

## Script 006 (Fase 2 - recebimentos)

Com 001–005 aplicados: `psql -d sb -f tests/sql/fase2_006_tests.sql`. Esperado: exercício 2026 tirado do número da
ALTCRED, autenticação da GRU tirada de "GRU ABC123", sobra da ALTCRED marcada como adiantamento, baixas classificadas
(LANÇAMENTOS = PAGAMENTO; RESUMO ADIANTAMENTO e documento de adiantamento = ADIANTAMENTO) e tipo inválido recusado.

## Script 007 (Fase 3 - faturamento)

Com 001–006 aplicados: `psql -d sb -f tests/sql/fase3_007_tests.sql`. Esperado: um preço por ano/serviço/OM (e um
geral por serviço), competência inválida recusada, realizado e previsão de atracação no mesmo mês, tipo de lote
inválido recusado, fatura mantida ao excluir o lote, e preços/atracações removidos junto com a OM.

## Script 008 (Fase 4 - contestação, cancelamento e correção)

Com 001–007 aplicados: `psql -d sb -f tests/sql/fase4_008_tests.sql`. Esperado: uma contestação ABERTA (origem
MIGRACAO) para a fatura já contestada, mesmo rodando o script duas vezes; decisão inválida, mês inválido e taxa absurda
recusados; lote CORRECAO aceito; contestação removida junto com a fatura.

## Script 009 (Fase 5 - cobrança, relatórios e fluxo de caixa)

Com 001–008 aplicados: `psql -d sb -f tests/sql/fase5_009_tests.sql`. Esperado: saídas antigas classificadas pela rubrica
digitada ("14" → rubrica 14/CONDOMINIO; "Água e Esgoto" → AGUA; outro texto → OUTROS); categoria inválida recusada; uma
rubrica por ano/número e número fora da faixa recusado; cobrança registrada.

## Script 010 (Fases 6 e 7 - rotinas anuais, auditoria e backup)

Com 001–009 aplicados: `psql -d sb -f tests/sql/fase6_7_010_tests.sql` (aplica o 010 duas vezes). Esperado: rubrica
antiga com previsto = vigente; desconto geral maior que o previsto, status inválido, desconto sem justificativa e
percentual acima de 100 recusados; lotação, matriz, desconto e dias por classe gravados; auditoria registra inclusão e
alteração com o e-mail do usuário, só os campos alterados (alteração sem mudança não registra) e a linha inteira na
exclusão; a trilha não pode ser alterada nem apagada; Consulta lê a trilha das faturas mas não a de usuários; Admin
lê a de usuários e registra o backup; Consulta não grava lotação.

## Script 011 (certificação × vencimento)

Com 001–010 aplicados: `psql -d sb -f tests/sql/vencimento_011_tests.sql` (aplica o 011 duas vezes). Esperado: fatura
em aberto vence em emissão + 30 corridos no próximo dia útil (02/10 → 03/11, pulando domingo e Finados); paga,
cancelada, quitada fora e OND (estimado ou "OND" na observação) não mudam; pagamento parcial muda; certificação =
emissão + 10 dias úteis; vencimento anterior guardado para desfazer.

## Script 012 (clientes e taxas)

Com 001–011 aplicados: `psql -d sb -f tests/sql/clientes_012_tests.sql` (aplica o 012 duas vezes). Esperado: destino da
rubrica pela descrição ("Navios" → DA) e destino inválido recusado; Operador inclui cliente novo mas não altera nem
unifica; Operador grava nome alternativo pela função; Consulta não inclui cliente; Administrador unifica (preço passa
para a OM que fica, lotação repetida é descartada, duplicada desativada com motivo e nome guardado como alternativo);
unificar a OM com ela mesma recusado; pendência e par "não são a mesma" gravados; unificação registrada na auditoria.

## Script 013 (subsídios, contratos e conferência)

Com 001–012 aplicados: `psql -d sb -f tests/sql/subsidios_013_tests.sql` (simula o esquema `storage` do Supabase e aplica o
013 duas vezes). Esperado: destino PAR aceito; parte dos navios e justificativa do valor gravadas; parte negativa recusada;
bucket privado `contratos-tc`; Operador inclui subsídio, anexo e arquivo; subsídio sem descrição recusado; Consulta lê mas
não inclui; valores fechados (OM e navio) e extrato gravados; subsídio registrado na auditoria.

## Script 014 (critério de rateio)

Com 001–013 aplicados: `psql -d sb -f tests/sql/criterios_014_tests.sql` (aplica o 014 duas vezes). Esperado: parte dos
navios em R$ vira percentual (Defensas 56%); rubrica paga só pelos navios fica OM 0% / navios 100% sem desconto; total
do grupo Navios guardado na proposta; critério, percentuais e modo inválidos recusados; área e peso na lotação; área
negativa recusada.


## Script 015 (unificar exclui o duplicado)

Com 001–014 aplicados: `psql -d sb -f tests/sql/unificar_015_tests.sql` (aplica o 015 duas vezes). Esperado: o já
unificado ("Unificada com ...") é excluído e as faturas, inclusive as antigas sem ligação, ficam na OM que ficou;
Operador não unifica nem chama a rotina interna; Admin unifica e o duplicado some, com o nome corrigido na fatura e
guardado como alternativo; OM com fatura continua sem poder ser excluída.

## Script 016 (unificar sem guardar o nome duplicado)

Com 001–015 aplicados: `psql -d sb -f tests/sql/unificar_016_tests.sql`. Esperado: nomes vindos de unificações saem dos
"outros nomes" (o apelido manual fica), a fatura passa a ter o nome da OM que ficou, o unificado antigo é excluído e uma
unificação nova não guarda o nome.

## Script 027 (unificações em cadeia)

Com 001–016 aplicados: `psql -d sb -f tests/sql/unificadas_027_tests.sql`. Esperado: a OM unificada numa outra que depois
foi unificada (cadeia) é concluída na OM ativa do fim da cadeia, com a fatura passada e renomeada; a unificada sem destino e
sem dados é excluída; a sem destino com fatura fica, com o motivo "Unificação incompleta" (aparece em Duplicidades).

## Script 028 (créditos de acerto)

Com 001–016 aplicados: `psql -d sb -f tests/sql/creditos_028_tests.sql` (aplica o 028 duas vezes). Esperado: Operador registra uso;
valor zero e tipo inválido recusados; Consulta lê mas não grava; a auditoria registra a inclusão.

## Script 029 (histórico da OM com vigência)

Com 001–003 aplicados: `psql -d sb -f tests/sql/om_historico_029_tests.sql` (aplica o 029 duas vezes). Esperado: documentos ligados à OM pelo nome (inclusive com caixa/espaço diferentes); o operador muda nome, UG e comando (3 campos) e o nome/UG antigos ficam em `nomes_alternativos`/`codigos_anteriores`; histórico com rótulos legíveis; recusados: vigência futura, sem data, sem mudança, UG inválida e comando inexistente; leitor não altera; o administrador também altera.

## Script 030 (perfil Treinamento)

Com 001 (e 018) aplicados: `psql -d sb -f tests/sql/treinamento_030_tests.sql` (aplica o 030 duas vezes). Esperado: o perfil TREINAMENTO é aceito e um valor inválido é recusado; `can_write()` e `is_admin()` falsos e `is_active_user()` verdadeiro; o usuário lê as faturas mas não consegue alterá-las (0 linhas).

## Script 032 (regime de fim de exercício por serviço, com exceções por OM)

Com 001–003 aplicados: `psql -d sb -f tests/sql/regime_ond_032_tests.sql` (aplica o 032 duas vezes). Esperado: regra por serviço (AE, EL, CR, TC, DA = 1; AL = 2; VT, RB = 3); exceções só para as OMs com padrão de 2025 diferente da regra (RB com fatura só em outubro não vira exceção); nenhuma linha duplicada na segunda execução; faturas intactas; o operador registra e o nome dele fica gravado; UPDATE e DELETE são recusados (até pelo administrador do banco); regime inválido ou escopo errado recusados; leitor lê mas não grava.

## Script 033 (livro de créditos por OM)

Com 001–003 aplicados: `psql -d sb -f tests/sql/creditos_om_033_tests.sql` (aplica o 033 duas vezes). Esperado: livro zerado; dois créditos da OM A (serviços e exercícios diferentes); acerto repetido recusado; crédito de um serviço usado por fatura de outro; mesma fatura usando o mesmo crédito duas vezes recusada; uso acima do que resta do crédito recusado; crédito de outra OM e saldo negativo recusados; devolução; estorno devolvendo o crédito (e estorno repetido ou de valor errado recusados); saldo de abertura recusado para o operador e aceito para o administrador; leitor só lê; nem o dono do banco altera ou apaga.

**Duas emissões ao mesmo tempo (cenário 18):** com a OM B com saldo 1.000 e o id do crédito de abertura em `$ENT`, abra duas sessões `psql`. Sessão 1: `begin; insert ... UTILIZACAO -800 ... 'FATURA-1'; select pg_sleep(4); commit;`. Um segundo depois, sessão 2: `insert ... UTILIZACAO -800 ... 'FATURA-2';`. Esperado: a sessão 2 espera a sessão 1 terminar e então falha com "Saldo de crédito insuficiente (saldo R$ 200.00...)"; o saldo final é 200.
