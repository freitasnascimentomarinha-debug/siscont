/**
 * Planilhas modelo de cada importação do SISCONT (mesmos cabeçalhos que os importadores reconhecem).
 * Cada modelo traz uma aba "INSTRUÇÕES". Funções puras: devolvem as abas como matrizes; quem baixa é o componente.
 */
export interface Aba { nome: string; linhas: (string | number | null)[][]; larguras?: number[] }
export interface Modelo { arquivo: string; titulo: string; instrucoes: string[]; abas: Aba[] }

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MESES_EXT = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const diasNoMes = (comp: string) => new Date(Date.UTC(Number(comp.slice(0, 4)), Number(comp.slice(5, 7)), 0)).getUTCDate();

export function modeloProposta(ano: number): Modelo {
  return {
    arquivo: `MODELO_proposta_taxa_condominial_${ano}.xlsx`, titulo: `Proposta da taxa condominial ${ano}`,
    instrucoes: [
      'Preencha as abas sem mudar os títulos das colunas. Linhas de EXEMPLO podem ser apagadas.',
      'Despesas_NOVO: uma linha por rubrica (Nº DE ORDEM 1, 2, 3...). DESCONTOS = descontos por OM + desconto geral; o sistema separa os dois sozinho.',
      'Rubrica cuja despesa se chama "Navios" é o valor que custeia as diárias de atracação (não entra na taxa das OM).',
      'Matriz_NOVO: na linha de numeração, as rubricas 1, 2, 3...; marque X nas despesas de que cada OM participa.',
      'RATEIO MODELO TÉCNICO: lotação (TLA + DLA), lotação anterior e dias (30 para OM de terra). Depois da linha NAVIOS, os navios com o nº médio de dias atracados por mês.',
      'PROPOSTA CONDOMINIO: desconto anual em R$ de cada OM em cada rubrica (colunas 1, 2, 3...). Termina na linha SUB-TOTAL.',
      'Use os nomes como estão no cadastro (ou a sigla). Nome não reconhecido fica "para decidir depois" na importação.',
    ],
    abas: [
      { nome: 'Despesas_NOVO', larguras: [12, 18, 30, 40, 18, 8, 16, 14, 14, 18], linhas: [
        ['Nº DE ORDEM', 'Conta Contábil', 'DESCRIÇÃO CONTAS CONTÁBEIS', 'DESPESAS', `VALOR PARA ${ano} (R$)`, '%RUB', `VALOR ${ano - 1}( R$)`, `VARIAÇÃO % (${ano}/${ano - 1})`, 'DESCONTOS', 'VALOR RUBRICA ATUALIZADO'],
        [1, '8.9.9.1.1.08.02', 'DEMAIS CONTROLES - EXECUCAO FISICA DE PROJETOS', 'EXEMPLO — Manutenção de Telhados', 200000, null, 391421.64, null, 0, 200000],
        [2, '', '', 'EXEMPLO — Navios', 1236100, null, 1151786.23, null, 0, 1236100],
      ] },
      { nome: 'Matriz_NOVO', larguras: [4, 40, 4, 4, 4], linhas: [
        ['', 'CLIENTES', 'GRUPO DE DESPESAS'], ['', '', 1, 2, 3], ['', 'EXEMPLO — SecNSNQ', 'X', '', 'X'], ['', 'EXEMPLO — AMRJ', 'X', '', ''],
      ] },
      { nome: 'RATEIO MODELO TÉCNICO', larguras: [45, 12, 16, 12], linhas: [
        ['CLIENTES', 'CRITÉRIO - TABELA DE LOTAÇÃO'], ['OM DE TERRA', '(A)', 'Lotação Anterior', '(B)'], ['', 'LOTAÇÃO', '', 'DIAS'],
        ['EXEMPLO — SecNSNQ', 140, 76, 30], ['EXEMPLO — AMRJ', 1010, 1422, 30], ['SUB TOTAL'],
        ['NAVIOS', '(A)', 'Lotação Anterior', '(B)'], ['', 'LOTAÇÃO', '', 'Nº MÉDIO DIAS'],
        ['EXEMPLO — CORVETA CLASSE BARROSO – CORVETA BARROSO', 148, 125, 28], ['TOTAL GERAL'],
      ] },
      { nome: 'PROPOSTA CONDOMINIO', larguras: [40, 12, 12, 12], linhas: [
        ['OM', 'OBSERVAÇÃO', '', 1, 2, 3], ['EXEMPLO — SecNSNQ', 'desconto por rubrica (R$/ano)', '', 1107.37, 0, 553.69], ['SUB-TOTAL'],
      ] },
    ],
  };
}

export function modeloHistorico(exercicio: number, classes: string[] = []): Modelo {
  const anos = [exercicio - 3, exercicio - 2, exercicio - 1];
  const cab = ['CLASSE NAVIO', 'NAVIO', ...MESES, 'TOTAL'];
  const linhasClasses = classes.length ? classes.map(c => [c, '', ...MESES.map(() => null), null]) : [['EXEMPLO — Corvetas Classe Barroso', 'Barroso', ...MESES.map(() => 0), null]];
  return {
    arquivo: `MODELO_historico_trienal_${exercicio}.xlsx`, titulo: `Histórico trienal de atracação (${anos[0]}–${anos[2]})`,
    instrucoes: [
      'Uma aba por ano (o nome da aba começa pelo ano).', 'CLASSE NAVIO só na primeira linha de cada classe; uma linha por navio com os dias atracados ("A") em cada mês.',
      'Dias docados ("D") não contam.', 'Alternativa: a média trienal também pode ser calculada pelos mapas BNIC-35 gravados no Faturamento.',
    ],
    abas: anos.map(a => ({ nome: String(a), larguras: [40, 30, ...MESES.map(() => 6), 8], linhas: [[`NÚMERO DE DIAS DOS NAVIOS ATRACADOS — ${a}`], cab, ...linhasClasses] })),
  };
}

/** Rateio da divisão responsável (BNIC-41): já vem com as OM a medir; a divisão preenche consumo/valor. */
export function modeloRateio(sigla: string, competencia: string, oms: { codigo: string; nome: string; sigla?: string | null }[], responsavel?: string | null): Modelo {
  const [y, m] = [Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7))];
  return {
    arquivo: `MODELO_rateio_${sigla}_${competencia}.xlsx`, titulo: `Rateio ${sigla} — ${MESES[m - 1]}/${y}`,
    instrucoes: [
      `Preencher pela divisão responsável${responsavel ? ` (${responsavel})` : ''} e devolver para importação em Faturamento › Medições do mês.`,
      'Não altere CÓDIGO nem SIGLA. Preencha CONSUMO (e DEMANDA, para energia) ou o VALOR TOTAL (R$). Linha sem consumo e sem valor é ignorada.',
      'OM nova: acrescente uma linha com o código (5 dígitos) da OM.',
    ],
    abas: [{ nome: 'DADOS', larguras: [8, 10, 45, 8, 14, 12, 18], linhas: [
      [`RATEIO ${sigla} — COMPETÊNCIA ${MESES_EXT[m - 1]} DE ${y}`],
      ['SIGLA', 'CÓDIGO', 'OM', 'DIAS', 'CONSUMO', 'DEMANDA', 'VALOR TOTAL (R$)'],
      ...oms.map(o => [sigla, o.codigo, o.nome, null, null, null, null]),
    ] }],
  };
}

/** Mapa de atracação (BNIC-35) do mês, com os navios: "A" atracado, "D" docado. */
export function modeloMapaAtracacao(competencia: string, navios: string[], gerencia = 'G1'): Modelo {
  const [y, m] = [Number(competencia.slice(0, 4)), Number(competencia.slice(5, 7))];
  const n = diasNoMes(competencia);
  return {
    arquivo: `MODELO_mapa_atracacao_${gerencia}_${competencia}.xlsx`, titulo: `Mapa de atracação ${MESES[m - 1]}/${y}`,
    instrucoes: ['Marque A (atracado: paga diária) ou D (docado: não paga) em cada dia. Vazio = fora do cais.', 'Uma planilha por gerência (G1…G6). Não altere a linha "MÊS DE ... DE ...".'],
    abas: [{ nome: 'MAPA', larguras: [40, ...Array(n).fill(4)], linhas: [
      [`MAPA DE ATRACAÇÃO — MÊS DE ${MESES_EXT[m - 1]} DE ${y}`], [`GERÊNCIA: ${gerencia}`],
      ['NAVIOS', ...Array.from({ length: n }, (_, i) => i + 1)],
      ...(navios.length ? navios : ['EXEMPLO — Corveta Barroso']).map(nv => [nv, ...Array(n).fill('')]),
      ['LEGENDA: A = NAVIO ATRACADO · D = NAVIO DOCADO'],
    ] }],
  };
}

export function modeloTabelaTC(ano: number, oms: string[] = []): Modelo {
  return {
    arquivo: `MODELO_tabela_taxa_condominial_${ano}.xlsx`, titulo: `Tabela da taxa condominial ${ano}`,
    instrucoes: ['Uma linha por OM com o valor MENSAL (ANUAL é opcional).', 'Normalmente essa tabela é gerada pela tela Taxa condominial e diárias › Publicar.'],
    abas: [{ nome: 'TAXA CONDOMINIAL', larguras: [45, 16, 16], linhas: [['OM', 'ANUAL', 'MENSAL'], ...(oms.length ? oms.map(o => [o, null, null]) : [['EXEMPLO — SecNSNQ', 120688.36, 10057.36]])] }],
  };
}

export function modeloNotasEmpenho(competencia: string): Modelo {
  const m = Number(competencia.slice(5, 7)), y = Number(competencia.slice(0, 4));
  return {
    arquivo: `MODELO_notas_de_empenho_${competencia}.xlsx`, titulo: 'Notas de empenho (saídas do fluxo de caixa)',
    instrucoes: [
      'Uma linha por NE. Nº completo: UG (6) + gestão (5) + ano + NE + número (6), ex.: 740015000012026NE000123.',
      'RUBRICA: o nº da rubrica da taxa condominial (1 a 33) ou o texto "Água e Esgoto", "Energia", "Telefonia", "Condomínio/diária/viatura".',
      'Linhas de entrada (ALTCRED) são ignoradas: as entradas vêm automaticamente dos recebimentos.',
    ],
    abas: [{ nome: `${MESES[m - 1]}${y}`, larguras: [12, 26, 40, 14, 14, 14, 22, 40], linhas: [
      ['DATA', 'ALTCRED/NE', 'CLIENTE', 'ENTRADA', 'SAÍDA', 'SALDO', 'RUBRICA', 'DESCRIÇÃO'],
      ['10/10/2026', '740015000012026NE000122', 'EXEMPLO — AGUAS DO RIO 4 SPE S.A', null, 94860, null, 'Água e Esgoto', 'CONTRATACAO DOS SERVICOS'],
    ] }],
  };
}

export function modeloCadastroFaturas(): Modelo {
  return {
    arquivo: 'MODELO_cadastro_pela_planilha_de_faturas.xlsx', titulo: 'Cadastro de setores, comandos e OM (a partir das faturas)',
    instrucoes: [
      'Aba FATURAS: uma linha por fatura com Setor, Comando ("código - nome"), Cliente e Fatura (OM-SIGLA-MM-AAAA-SEQ-V). O cadastro é montado a partir delas.',
      'Abas com o ano (ex.: 2025) no formato do histórico de atracação ligam navios às classes.',
      'Cliente fora da Ilha das Cobras pode ser marcado depois em Cadastros › OM / Clientes.',
    ],
    abas: [
      { nome: 'FATURAS', larguras: [14, 45, 45, 26, 12], linhas: [['Setor', 'Comando', 'Cliente', 'Fatura', 'Valor'], ['DGMM', '40030 - Diretoria Industrial da Marinha', 'EXEMPLO — Diretoria Industrial da Marinha', '40030-TC-08-2026-014-0', 19615.73]] },
      { nome: '2025', larguras: [40, 30, 6], linhas: [['CLASSE NAVIO', 'NAVIO', 'JAN'], ['EXEMPLO — Corvetas Classe Barroso', 'Barroso', 0]] },
    ],
  };
}

export function modeloPlanilhaPagamento(): Modelo {
  const cab = ['SETOR', 'COMANDO', 'Cliente', 'Fatura', 'Valor', 'Data Emis.', 'Data Venc.', 'Mês', 'Ano', 'Competência', 'TIPO', 'VALOR PAGO', 'SALDO', 'STATUS', 'QUITADA SIPLAD?', 'OBSERVAÇÕES'];
  return {
    arquivo: 'MODELO_planilha_de_pagamento.xlsx', titulo: 'Migração de faturas, ALTCRED, baixas e adiantamentos',
    instrucoes: [
      'FATURAS: faturas do ano; Faturas Pagas: as já quitadas; ALTCRED: créditos recebidos; LANÇAMENTOS: baixas (ALTCRED × fatura); ADIANTAMENTOS: ALTCRED (ou sobras) encaminhadas para adiantamento.',
      'Datas podem ser dd/mm/aaaa. Valores em reais.',
    ],
    abas: [
      { nome: 'FATURAS', linhas: [cab, ['DGMM', '40030 - Diretoria Industrial da Marinha', 'EXEMPLO — Diretoria Industrial da Marinha', '40030-EL-08-2026-010-0', 10134.19, '15/09/2026', '15/10/2026', '', '', '', '', 0, 10134.19, 'A VENCER', 'NÃO', '']] },
      { nome: 'Faturas Pagas', linhas: [cab.slice(0, 11)] },
      { nome: 'ALTCRED', linhas: [['Data de situação', 'COMANDO', 'Cliente', 'NºALTCRED', 'TIPO', 'Valor ALTCRED', 'VALOR UTILIZADO', 'SALDO', 'OBSERVAÇÃO']] },
      { nome: 'LANÇAMENTOS', linhas: [['Data de situação', 'COMANDO', 'CLIENTE', 'NºALTCRED', 'NºFATURA', 'VALOR UTILIZADO', 'TIPO']] },
      { nome: 'ADIANTAMENTOS', linhas: [['Data de situação', 'COMANDO', 'Cliente', 'NºALTCRED', 'TIPO', 'Valor ALTCRED', 'VALOR UTILIZADO', 'SALDO', 'OBSERVAÇÃO']] },
    ],
  };
}
