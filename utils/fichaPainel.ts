/**
 * Extrato de situação de uma OM ou de um COMANDO (todas as OM dele): números, faixas de atraso, faturas com saldo,
 * contestações e cobranças. Funções puras, usadas pela ficha na tela e pelo PDF.
 */
import { ContestacaoGer, FaturaGer, LinhaOM, PontoFR, Recebimento, atrasoDe, chaveOM, faturadoRecebido, mesDe, somaMeses } from './painelGerencial';

const r2 = (n: number) => Math.round(n * 100) / 100;
export type ModoFicha = 'om' | 'comando';
export interface CobrancaFicha { comando: string; enviadaEm: string; faturas: string[]; valor: number; enviadaPor?: string | null }
export interface EntradaFicha { hoje: string; fs: FaturaGer[]; recebimentos: Recebimento[]; linhas: LinhaOM[]; contest: ContestacaoGer[]; cobrancas: CobrancaFicha[] }

export interface FaturaFicha { f: FaturaGer; om: string; atraso: number; situacao: 'vencida' | 'a vencer' | 'em contestação' }
export interface DadosFicha {
  modo: ModoFicha; titulo: string; comando: string; setor: string; hoje: string;
  kpis: { emAberto: number; qtdAberto: number; vencido: number; qtdVencidas: number; atrasoMedio: number; contestado: number; qtdContestadas: number; variacao: number; variacaoPct: number | null };
  porFaixa: Record<string, number>; ultimaMov: string | null; saldoParado: number;
  /** as OM do comando (só no modo comando), da maior dívida vencida para a menor */
  oms: LinhaOM[]; abertas: FaturaFicha[]; quitadas: FaturaGer[]; contest: ContestacaoGer[]; cobr: CobrancaFicha[]; hist: PontoFR[]; numeros: Set<string>;
}

/** Comandos que aparecem nas linhas (para escolher qual extrato abrir). */
export const comandosDasLinhas = (ls: LinhaOM[]) => [...new Set(ls.map(l => l.comando))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pt-BR'));
export const chavesDoComando = (ls: LinhaOM[], comando: string) => ls.filter(l => l.comando === comando).map(l => l.chave);

export function dadosFicha(e: EntradaFicha, chaves: string[], modo: ModoFicha, titulo: string): DadosFicha {
  const set = new Set(chaves);
  const ls = e.linhas.filter(l => set.has(l.chave));
  const fs = e.fs.filter(f => !f.cancelada && set.has(chaveOM(f)));
  const omIds = new Set(ls.map(l => l.omId).filter(Boolean) as string[]);
  const rec = e.recebimentos.filter(r => !!r.omId && omIds.has(r.omId));
  const numeros = new Set(fs.map(f => f.numero));
  const soma = (g: (l: LinhaOM) => number) => r2(ls.reduce((s, l) => s + g(l), 0));
  const vencido = soma(l => l.vencido), vencidoAntes = soma(l => l.vencidoAntes), variacao = soma(l => l.variacao);
  const porFaixa: Record<string, number> = {};
  ls.forEach(l => Object.entries(l.porFaixa).forEach(([k, v]) => { porFaixa[k] = r2((porFaixa[k] || 0) + v); }));
  let ultima: string | null = null; ls.forEach(l => { if (l.ultimaMov && (!ultima || l.ultimaMov > ultima)) ultima = l.ultimaMov; });
  const abertas = fs.filter(f => f.saldo > 0.009).map(f => { const atraso = atrasoDe(f, e.hoje); return { f, om: f.cliente, atraso, situacao: (f.contestada ? 'em contestação' : atraso ? 'vencida' : 'a vencer') as FaturaFicha['situacao'] }; })
    .sort((a, b) => (modo === 'comando' ? a.om.localeCompare(b.om, 'pt-BR') : 0) || (a.f.vencimento || '').localeCompare(b.f.vencimento || '') || a.f.numero.localeCompare(b.f.numero));
  const comandos = new Set(ls.map(l => l.comando));
  const ate = mesDe(e.hoje), de = somaMeses(ate, -11);
  return {
    modo, titulo, hoje: e.hoje, comando: [...comandos].join(' · '), setor: [...new Set(ls.map(l => l.setor))].join(' · '),
    kpis: {
      emAberto: soma(l => l.emAberto), qtdAberto: soma(l => l.qtdAberto), vencido, qtdVencidas: soma(l => l.qtdVencidas),
      atrasoMedio: vencido > 0 ? Math.round(ls.reduce((s, l) => s + l.atrasoMedio * l.vencido, 0) / vencido) : 0,
      contestado: soma(l => l.contestado), qtdContestadas: soma(l => l.qtdContestadas), variacao,
      variacaoPct: vencidoAntes > 0 ? Math.round((variacao / vencidoAntes) * 1000) / 10 : null,
    },
    porFaixa, ultimaMov: ultima, saldoParado: soma(l => l.saldoParado),
    oms: [...ls].sort((a, b) => b.vencido - a.vencido || b.emAberto - a.emAberto || a.cliente.localeCompare(b.cliente, 'pt-BR')),
    abertas, quitadas: fs.filter(f => f.saldo <= 0.009).sort((a, b) => (b.emissao || '').localeCompare(a.emissao || '')).slice(0, 10),
    contest: e.contest.filter(x => x.fatura && set.has(chaveOM(x.fatura))),
    cobr: e.cobrancas.filter(c => c.faturas.some(n => numeros.has(n)) || comandos.has(c.comando)),
    hist: faturadoRecebido(fs, rec, de, ate), numeros,
  };
}
