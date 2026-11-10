/**
 * Mensagem de cobrança no padrão da Base Naval: as faturas em aberto vão no extrato (PDF) anexo; a mensagem pede a indicação do
 * recurso e informa o prazo. As duas datas — "dívidas em aberto até" e "prazo para indicar os créditos" — vêm da posição e do
 * prazo escolhidos na tela, e o texto inteiro continua editável.
 */
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

/** 2026-08-18 → "18AGO" (ou "18AGO2026" com o ano), como nas mensagens navais. */
export function dataMsg(iso: string, comAno = false): string {
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}${MESES[Number(m) - 1] || ''}${comAno ? a : ''}`;
}

/** Prazo padrão para indicar os créditos: posição + 30 dias corridos (a pessoa ajusta na tela). */
export const PRAZO_PADRAO_DIAS = 30;
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export interface DadosMensagem { indicativo?: string | null; nome: string; posicao: string; prazo: string }

export function mensagemCobrancaPadrao(d: DadosMensagem): string {
  return [
    `PARA: ${d.indicativo || `[indicativo de ${d.nome}]`}`,
    'DE: BNIC',
    'BT',
    'A fim de auxiliar no controle das faturas em aberto das OM apoiadas por esta Base Naval, PTC:',
    '',
    `ALFA) Enviado, anexo a esta mensagem, extrato das dívidas em aberto até ${dataMsg(d.posicao)}; e`,
    '',
    'BRAVO) Indicar recurso na AI R.901.16 / ND33.90.39 / AO 2000 (administração da unidade) ou 21A0 (aprestamento das forças), conforme observada a Circular nº 7/2026 da SGM.',
    '',
    `CHARLIE) A indicação dos respectivos créditos deverá ser realizada até ${dataMsg(d.prazo, true)}.`,
    '',
    'Eventuais esclarecimentos poderão ser obtidos junto à Divisão de Contabilidade desta Base Naval:',
    '',
    '- CC (IM) Caroline - Tel: 8110-4790;',
    '- 2º SG-AD Tamara / 3º SG-EN Marcele La Cerda - Tel: 8110-3764; ou',
    '- Encaminhar e-mail para caroline.sampaio@marinha.mil.br, com cópia para tamara.nascimento@marinha.mil.br e marcele.campello@marinha.mil.br',
    'BT',
  ].join('\n');
}

/**
 * Troca uma data da mensagem por outra sem perder o que a pessoa editou no resto do texto.
 * "18AGO" não pode casar com o começo de "18AGO2026" (por isso o `(?!\d)`).
 */
export function trocarDataNoTexto(texto: string, antiga: string, nova: string, comAno: boolean): string {
  const a = dataMsg(antiga, comAno), n = dataMsg(nova, comAno);
  if (a === n) return texto;
  return texto.replace(new RegExp(`(?<![0-9A-Z])${a}(?!\\d)`, 'g'), n);
}
