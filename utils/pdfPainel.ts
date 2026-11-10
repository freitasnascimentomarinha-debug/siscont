/** PDF "resumo do Painel do Encarregado": uma visão executiva do recorte consultado (somente leitura). */
import jsPDF from 'jspdf';
import { TEMA, cabecalhoCompacto, salvarPdf, tabelaPdf, tituloRelatorio } from './pdfCabecalho';
import { graficosDoPainel } from './graficosPainel';
import { desenharGrafico } from './pdfGraficos';
import {
  Alerta, BaixaGer, ContestacaoGer, Criterios, FaturaGer, LinhaOM, Periodo, ROTULO_PRIORIDADE, Recebimento, indicadores, ordenarOM, resumoContestacoes,
} from './painelGerencial';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const mes = (ym: string) => `${ym.slice(5)}/${ym.slice(0, 4)}`;
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);

export interface EntradaPdf {
  hoje: string; periodo: Periodo; fs: FaturaGer[]; bs: BaixaGer[]; idx: Map<string, BaixaGer[]>; recebimentos: Recebimento[]; linhas: LinhaOM[]; alertas: Alerta[]; contest: ContestacaoGer[];
  criterios: Criterios; parados: { valor: number }[]; adiantamentos: { saldo: number }[]; filtros: string[]; atualizadoEm: string;
}

export interface LinhaIndicador { rotulo: string; valor: number | null; fmt: 'brl' | 'pct'; detalhe: string }
/** Indicadores do painel como dados (o PDF formata em texto; o Excel grava números). */
export function linhasIndicadores(e: EntradaPdf): LinhaIndicador[] {
  const ind = indicadores(e.fs, e.bs, e.idx, e.periodo, e.hoje, e.criterios, e.recebimentos);
  const ctn = resumoContestacoes(e.contest, e.periodo, e.criterios);
  return [
    { rotulo: 'Total faturado no período', valor: ind.faturamento.faturado.valor, fmt: 'brl', detalhe: `${ind.faturamento.faturado.qtd} fatura(s)` },
    { rotulo: 'Em aberto', valor: ind.faturamento.emAberto.valor, fmt: 'brl', detalhe: `${ind.faturamento.emAberto.qtd} fatura(s)` },
    { rotulo: 'Canceladas no período', valor: ind.faturamento.canceladas.valor, fmt: 'brl', detalhe: `${ind.faturamento.canceladas.qtd} fatura(s)` },
    { rotulo: 'Total vencido', valor: ind.cobranca.vencido.valor, fmt: 'brl', detalhe: `${ind.cobranca.vencido.qtd} fatura(s) · ${ind.cobranca.omInadimplentes} OM` },
    { rotulo: 'Inadimplência (vencido ÷ em aberto)', valor: ind.cobranca.pctInadimplencia, fmt: 'pct', detalhe: `prazo médio de atraso ${ind.cobranca.prazoMedio} dias` },
    { rotulo: `Vencido há mais de ${e.criterios.diasAtencao} dias`, valor: ind.cobranca.mais90.valor, fmt: 'brl', detalhe: `${ind.cobranca.mais90.qtd} fatura(s)` },
    { rotulo: `Vencido há mais de ${e.criterios.diasCritico} dias`, valor: ind.cobranca.mais365.valor, fmt: 'brl', detalhe: `${ind.cobranca.mais365.qtd} fatura(s)` },
    { rotulo: 'Recebido no período (ALTCRED/GRU)', valor: ind.recebimentos.recebido.valor, fmt: 'brl', detalhe: `${ind.recebimentos.recebido.qtd} ALTCRED/GRU · ${pct(ind.recebimentos.pctDoFaturado)} do faturado já quitado` },
    { rotulo: 'Vencido recuperado', valor: ind.recebimentos.recuperacao.recuperado, fmt: 'brl', detalhe: `${pct(ind.recebimentos.recuperacao.pct)} do vencido no início do período` },
    { rotulo: 'Adiantamentos disponíveis', valor: e.adiantamentos.reduce((s, a) => s + a.saldo, 0), fmt: 'brl', detalhe: `${e.adiantamentos.length} lançamento(s)` },
    { rotulo: 'Em contestação', valor: ind.contestadas.valor, fmt: 'brl', detalhe: `${ctn.abertas.length} contestação(ões) aberta(s) · ${ctn.semMovimento.length} sem movimentação` },
    { rotulo: 'ALTCRED/GRU com saldo parado', valor: e.parados.reduce((s, p) => s + p.valor, 0), fmt: 'brl', detalhe: `${e.parados.length} documento(s) há mais de ${e.criterios.diasSaldoParado} dias` },
  ];
}

export function pdfPainel(e: EntradaPdf): jsPDF {
  const doc = new jsPDF('p');
  const ind = indicadores(e.fs, e.bs, e.idx, e.periodo, e.hoje, e.criterios, e.recebimentos);
  cabecalhoCompacto(doc);
  let y = tituloRelatorio(doc, 'Painel do Encarregado — resumo', `Posição em ${br(e.hoje)}`, 26) - 2;

  const tabela = (titulo: string, head: string[], body: (string | number)[][], opts: { largura?: number[] } = {}) => {
    tabelaPdf(doc, { startY: y + 1, head: [[{ content: titulo, colSpan: head.length, styles: { fillColor: TEMA.faixa, halign: 'left' } }], head], body,
      headStyles: { fillColor: TEMA.cab },
      columnStyles: Object.fromEntries((opts.largura || []).map((w, i) => [i, { cellWidth: w }])) });
    y = (doc as any).lastAutoTable.finalY + 5;
  };

  /** Página só de gráficos (2 × 2), logo depois dos indicadores. */
  const pgGraficos = () => {
    const gs = graficosDoPainel(e);
    doc.addPage(); doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...TEMA.faixa); doc.text('Gráficos', 14, 16);
    gs.forEach((g, i) => desenharGrafico(doc, g, 14 + (i % 2) * 93, 22 + Math.floor(i / 2) * 82, 89, 78));
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(70);
    doc.text('Faturado pela competência; recebido = ALTCRED/GRU pela data do documento. O passado da inadimplência é reconstruído pelas datas das baixas.', 14, 188, { maxWidth: 182 });
    doc.setTextColor(0); doc.addPage(); y = 16;
  };

  tabela('Indicadores', ['Indicador', 'Valor', 'Detalhe'], linhasIndicadores(e).map(l => [l.rotulo, l.fmt === 'brl' ? brl(l.valor ?? 0) : pct(l.valor), l.detalhe]), { largura: [80, 38, 64] });
  pgGraficos();

  tabela('Idade da dívida', ['Faixa', 'Valor', 'Faturas'], ind.cobranca.faixas.map(f => [f.faixa, brl(f.valor), f.qtd]), { largura: [80, 50, 52] });
  if (e.alertas.length) tabela('Pontos que exigem atenção', ['Prioridade', 'Ocorrência', 'OM', 'Valor', 'Qtd'], e.alertas.slice(0, 12).map(a => [ROTULO_PRIORIDADE[a.prioridade], a.tipo, a.om, a.valor === null ? '—' : brl(a.valor), a.qtd]), { largura: [22, 66, 48, 32, 14] });
  const top = ordenarOM(e.linhas.filter(l => l.vencido > 0), 'vencido').slice(0, 10);
  if (top.length) tabela('10 OM com maior valor vencido', ['OM', 'Vencido', '% inad.', `> ${e.criterios.diasAtencao} d`, 'Contestado'], top.map(l => [l.cliente, brl(l.vencido), pct(l.pctInad), l.v90 ? brl(l.v90) : '', l.contestado ? brl(l.contestado) : '']), { largura: [78, 32, 18, 28, 26] });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(70);
  doc.text('Em aberto exclui faturas contestadas (mostradas à parte). Recebido = ALTCRED/GRU pela data do documento. Definições completas na tela, em "Como cada indicador é calculado".', 14, Math.min(y + 2, 285), { maxWidth: 182 });
  doc.setTextColor(0);
  salvarPdf(doc, `painel_encarregado_${e.hoje}.pdf`, { yFim: Math.min(y + 2, 285) + 4 });
  return doc;
}
