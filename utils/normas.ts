/**
 * Norma (OI) em que o faturamento se apoia. Muda de tempos em tempos, por isso não fica escrita no código:
 * o nome da norma e os itens citados nos textos vêm dos parâmetros (Cadastros › Parâmetros e feriados).
 * O módulo guarda o valor carregado para os textos das faturas, do PDF e das telas usarem o mesmo.
 */
export interface Normas { nome: string; itemPrazo: string; itemCorrecao: string }
export const PARAM_NORMAS = { nome: 'norma_nome', itemPrazo: 'norma_item_prazo', itemCorrecao: 'norma_item_correcao' } as const;
export const NORMAS_PADRAO: Normas = { nome: 'OI 40-04', itemPrazo: '6.1', itemCorrecao: '6.2' };

export function normasDe(parametros: { chave: string; valor: string }[]): Normas {
  const v = (k: string, d: string) => parametros.find(p => p.chave === k)?.valor?.trim() || d;
  return { nome: v(PARAM_NORMAS.nome, NORMAS_PADRAO.nome), itemPrazo: v(PARAM_NORMAS.itemPrazo, NORMAS_PADRAO.itemPrazo), itemCorrecao: v(PARAM_NORMAS.itemCorrecao, NORMAS_PADRAO.itemCorrecao) };
}

let atual: Normas = { ...NORMAS_PADRAO };
export const definirNormas = (n: Normas) => { atual = { ...n }; };
export const obterNormas = (): Normas => atual;

/** "OI 40-04, item 6.2" */
export const citarCorrecao = (n: Normas = atual) => `${n.nome}, item ${n.itemCorrecao}`;
/** "OI 40-04, item 6.1" */
export const citarPrazo = (n: Normas = atual) => `${n.nome}, item ${n.itemPrazo}`;
