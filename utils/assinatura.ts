/**
 * Assinatura dos PDFs (faturas e relatórios): a mesma regra para os dois.
 *   NOME DO ENCARREGADO (maiúsculas) · posto/graduação · cargo (padrão "Encarregado da Divisão de Contabilidade") · ASSINADO DIGITALMENTE
 * Os três textos vêm dos parâmetros (Cadastros › Parâmetros e feriados › Assinatura dos PDFs) e podem ser alterados.
 */
export const PARAM_ASSINATURA = { nome: 'encarregado_nome', posto: 'encarregado_posto', cargo: 'encarregado_cargo' } as const;
export const CARGO_PADRAO = 'Encarregado da Divisão de Contabilidade';
export interface Assinatura { nome: string; posto: string; cargo: string }

export function assinaturaDe(parametros: { chave: string; valor: string }[] | Record<string, string | undefined>): Assinatura {
  const v = (k: string) => String(Array.isArray(parametros) ? parametros.find(p => p.chave === k)?.valor ?? '' : parametros[k] ?? '').trim();
  return { nome: v(PARAM_ASSINATURA.nome), posto: v(PARAM_ASSINATURA.posto), cargo: v(PARAM_ASSINATURA.cargo) || CARGO_PADRAO };
}

let atual: Assinatura = { nome: '', posto: '', cargo: CARGO_PADRAO };
export const definirAssinatura = (a: Assinatura) => { atual = { ...a, cargo: a.cargo.trim() || CARGO_PADRAO }; };
export const obterAssinatura = (): Assinatura => atual;
