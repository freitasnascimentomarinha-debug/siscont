import { Alerta, BaixaGer, ContestacaoGer, Criterios, FaturaGer, LinhaOM, Periodo, Recebimento } from '../../utils/painelGerencial';

export type AbaPainel = 'geral' | 'oms' | 'contestacoes' | 'equipe' | 'encerramento';
export interface ParadoPainel { id: string; numero: string; cliente: string; valor: number; dias: number; ultimo: string }
export interface AdiantamentoPainel { cliente: string; saldo: number }
export interface CobrancaPainel { comando: string; enviadaEm: string; faturas: string[]; valor: number; enviadaPor?: string | null }

/** Tudo o que as abas precisam (já com os filtros do cabeçalho aplicados). Somente leitura. */
export interface CtxPainel {
  hoje: string; criterios: Criterios; periodo: Periodo;
  fs: FaturaGer[]; bs: BaixaGer[]; idx: Map<string, BaixaGer[]>; recebimentos: Recebimento[];
  linhas: LinhaOM[]; contest: ContestacaoGer[]; alertas: Alerta[];
  parados: ParadoPainel[]; adiantamentos: AdiantamentoPainel[]; cobrancas: CobrancaPainel[];
  abrirLista: (titulo: string, faturas: FaturaGer[]) => void;
  irPara: (aba: AbaPainel) => void;
}
