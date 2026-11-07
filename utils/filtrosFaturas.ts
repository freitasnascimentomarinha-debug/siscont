/**
 * Faturas emitidas: filtros extras (setor, comando, cliente, cadastro) e contagem do cabeçalho.
 * Funções puras; a tela só guarda as escolhas.
 */
import { Invoice } from '../types';

export interface FiltrosExtras {
  /** valores EXCLUÍDOS (padrão do MultiFiltro): vazio = todos */
  setoresExcluidos: Set<string>;
  comandosExcluidos: Set<string>;
  clientesExcluidos: Set<string>;
  /** 'sem' = só faturas sem OM ligada ao cadastro */
  cadastro: '' | 'sem';
  /** acompanhamento da fatura emitida */
  andamento: '' | 'naoEnviada' | 'naoCertificada' | 'semSiafi';
}
export const SEM_FILTROS: FiltrosExtras = { setoresExcluidos: new Set(), comandosExcluidos: new Set(), clientesExcluidos: new Set(), cadastro: '', andamento: '' };
export const SEM_VALOR = '(sem)';

export const setorDe = (i: Pick<Invoice, 'sector'>) => (i.sector || '').trim() || SEM_VALOR;
export const comandoDe = (i: Pick<Invoice, 'command'>) => (i.command || '').trim() || SEM_VALOR;
export const clienteDe = (i: Pick<Invoice, 'client'>) => (i.client || '').trim() || SEM_VALOR;

export function passaFiltrosExtras(i: Invoice, f: FiltrosExtras): boolean {
  if (f.setoresExcluidos.has(setorDe(i)) || f.comandosExcluidos.has(comandoDe(i)) || f.clientesExcluidos.has(clienteDe(i))) return false;
  if (f.cadastro === 'sem' && i.omId) return false;
  if (f.andamento && i.isCanceled) return false;
  if (f.andamento === 'naoEnviada' && i.enviadaEm) return false;
  if (f.andamento === 'naoCertificada' && i.certificadaEm) return false;
  if (f.andamento === 'semSiafi' && i.siafiEm) return false;
  return true;
}
export const temFiltroExtra = (f: FiltrosExtras) => !!(f.setoresExcluidos.size || f.comandosExcluidos.size || f.clientesExcluidos.size || f.cadastro || f.andamento);

/** Cabeçalho: quantas faturas na lista, quantas canceladas e o serviço prestado SEM as canceladas. */
export function resumoCabecalho(lista: Pick<Invoice, 'isCanceled' | 'value'>[]) {
  const canceladas = lista.filter(i => i.isCanceled).length;
  const ativas = lista.length - canceladas;
  const servico = Math.round(lista.filter(i => !i.isCanceled).reduce((s, i) => s + (i.value || 0), 0) * 100) / 100;
  return { total: lista.length, ativas, canceladas, servico };
}
