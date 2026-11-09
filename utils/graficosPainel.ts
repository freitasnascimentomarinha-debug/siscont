/** Gráficos do Painel do Encarregado como dados (os mesmos da tela), para o PDF e para o Excel. */
import {
  BaixaGer, FaturaGer, Periodo, Recebimento, agruparFR, faturadoRecebido, indicadores, mesDe, recuperacaoMensal, serieInadimplencia, Criterios,
} from './painelGerencial';

export interface SerieG { nome: string; valores: number[]; cor: string; tipo: 'bar' | 'line'; secundario?: boolean }
export interface GraficoPainel { id: string; titulo: string; categorias: string[]; series: SerieG[]; coresPontos?: string[]; sufixoSec?: string }

export const COR_G = { faturado: '#2a78d6', recebido: '#eb6834', vencido: '#d03b3b', aberto: '#94a3b8', diferenca: '#475569', pct: '#0f766e' };
const COR_FAIXA: Record<string, string> = { 'A vencer': '#16a34a', '1–30 dias': '#93c5fd', '31–90 dias': '#3b82f6', '91–180 dias': '#f59e0b', '181–365 dias': '#dc2626', 'Mais de 365 dias': '#7f1d1d' };
const mesCurto = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? `${ym.slice(5)}/${ym.slice(2, 4)}` : ym);

export interface EntradaGraficos { fs: FaturaGer[]; bs: BaixaGer[]; idx: Map<string, BaixaGer[]>; hoje: string; periodo: Periodo; recebimentos: Recebimento[]; criterios: Criterios }

export function graficosDoPainel(e: EntradaGraficos): GraficoPainel[] {
  const fr = agruparFR(faturadoRecebido(e.fs, e.recebimentos, e.periodo.de, e.periodo.ate), 'mensal');
  const ateSerie = e.periodo.ate > mesDe(e.hoje) ? mesDe(e.hoje) : e.periodo.ate;
  const serie = serieInadimplencia(e.fs, e.idx, e.hoje, ateSerie, 12);
  const rec = recuperacaoMensal(e.fs, e.bs, e.idx, e.periodo.de, ateSerie, e.hoje);
  const faixas = indicadores(e.fs, e.bs, e.idx, e.periodo, e.hoje, e.criterios, e.recebimentos).cobranca.faixas;
  return [
    { id: 'fr', titulo: 'Faturamento × recebimentos', categorias: fr.map(p => mesCurto(p.mes)), series: [
      { nome: 'Faturado', valores: fr.map(p => p.faturado), cor: COR_G.faturado, tipo: 'bar' },
      { nome: 'Recebido', valores: fr.map(p => p.recebido), cor: COR_G.recebido, tipo: 'bar' },
      { nome: 'Diferença (faturado − recebido)', valores: fr.map(p => p.diferenca), cor: COR_G.diferenca, tipo: 'line' }] },
    { id: 'inad', titulo: 'Evolução da inadimplência (fim de cada mês)', categorias: serie.map(p => mesCurto(p.mes)), series: [
      { nome: 'Em aberto', valores: serie.map(p => p.emAberto), cor: COR_G.aberto, tipo: 'line' },
      { nome: 'Vencido', valores: serie.map(p => p.vencido), cor: COR_G.vencido, tipo: 'line' }] },
    { id: 'idade', titulo: 'Idade da dívida (em aberto por tempo de atraso)', categorias: faixas.map(f => f.faixa), coresPontos: faixas.map(f => COR_FAIXA[f.faixa] || '#64748b'),
      series: [{ nome: 'Em aberto', valores: faixas.map(f => f.valor), cor: COR_G.faturado, tipo: 'bar' }] },
    { id: 'rec', titulo: 'Recuperação de crédito', categorias: rec.map(p => mesCurto(p.mes)), sufixoSec: '%', series: [
      { nome: 'Recuperado', valores: rec.map(p => p.recuperado), cor: COR_G.recebido, tipo: 'bar' },
      { nome: '% recuperado', valores: rec.map(p => p.pct ?? 0), cor: COR_G.pct, tipo: 'line', secundario: true }] },
  ];
}
