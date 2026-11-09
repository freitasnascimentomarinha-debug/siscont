/** Excel do Painel do Encarregado: indicadores, pontos de atenção, OM e uma aba de gráficos nativos (com os dados ao lado). */
import * as XLSX from 'xlsx';
import { EntradaPdf, linhasIndicadores } from './pdfPainel';
import { graficosDoPainel } from './graficosPainel';
import { injetarGraficos, GraficoXl } from './xlsxGraficos';
import { ROTULO_PRIORIDADE, ordenarOM } from './painelGerencial';

const col = (n: number) => { let s = ''; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const FMT_BRL = '#,##0.00', FMT_PCT = '0.0"%"';

export async function excelPainel(e: EntradaPdf): Promise<Uint8Array> {
  const wb = XLSX.utils.book_new();
  const fmtCol = (ws: XLSX.WorkSheet, c: number, de: number, ate: number, z: string) => { for (let r = de; r <= ate; r++) { const cell = ws[`${col(c)}${r + 1}`]; if (cell && cell.t === 'n') cell.z = z; } };

  // Indicadores
  const ind = linhasIndicadores(e);
  const cab = [['Painel do Encarregado — resumo'], [`Posição em ${e.hoje.split('-').reverse().join('/')} · período ${e.periodo.de.slice(5)}/${e.periodo.de.slice(0, 4)} a ${e.periodo.ate.slice(5)}/${e.periodo.ate.slice(0, 4)} · gerado em ${e.atualizadoEm}`], [`Recorte: ${e.filtros.length ? e.filtros.join('; ') : 'todos os setores, comandos e públicos'}`], []];
  const wsI = XLSX.utils.aoa_to_sheet([...cab, ['Indicador', 'Valor (R$)', '%', 'Detalhe'], ...ind.map(l => [l.rotulo, l.fmt === 'brl' ? l.valor : null, l.fmt === 'pct' ? l.valor : null, l.detalhe])]);
  fmtCol(wsI, 1, 5, 5 + ind.length, FMT_BRL); fmtCol(wsI, 2, 5, 5 + ind.length, FMT_PCT); wsI['!cols'] = [{ wch: 42 }, { wch: 18 }, { wch: 8 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsI, 'Indicadores');

  // Gráficos: tabelas à esquerda, gráfico ao lado de cada uma
  const gs = graficosDoPainel(e);
  const aoa: (string | number | null)[][] = [];
  const xl: GraficoXl[] = [];
  const BLOCO = 24;
  gs.forEach((g, k) => {
    const ini = k * BLOCO; // linha (0-based) do título da tabela
    while (aoa.length < ini) aoa.push([]);
    aoa.push([g.titulo]);
    aoa.push(['Período', ...g.series.map(s => s.nome)]);
    g.categorias.forEach((c, i) => aoa.push([c, ...g.series.map(s => s.valores[i])]));
    const a = ini + 3, z = ini + 2 + g.categorias.length; // linhas (1-based) dos dados
    const nome = `'Gráficos'`;
    xl.push({
      titulo: g.titulo, de: { col: 6, row: ini }, ate: { col: 15, row: ini + BLOCO - 2 }, formato: '#,##0', formatoSec: g.sufixoSec ? `0"${g.sufixoSec}"` : undefined,
      series: g.series.map((s, i) => ({ nome: s.nome, cat: `${nome}!$A$${a}:$A$${z}`, val: `${nome}!$${col(i + 1)}$${a}:$${col(i + 1)}$${z}`, cor: s.cor, tipo: s.tipo, secundario: s.secundario, coresPontos: g.coresPontos })),
    });
  });
  const wsG = XLSX.utils.aoa_to_sheet(aoa);
  gs.forEach((g, k) => g.series.forEach((s, i) => fmtCol(wsG, i + 1, k * BLOCO + 2, k * BLOCO + 2 + g.categorias.length, s.secundario ? FMT_PCT : FMT_BRL)));
  wsG['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 4 }, { wch: 4 }];
  XLSX.utils.book_append_sheet(wb, wsG, 'Gráficos');

  // Pontos de atenção
  const wsA = XLSX.utils.aoa_to_sheet([['Prioridade', 'Ocorrência', 'OM', 'Valor (R$)', 'Qtd'], ...e.alertas.map(a => [ROTULO_PRIORIDADE[a.prioridade], a.tipo, a.om, a.valor, a.qtd])]);
  fmtCol(wsA, 3, 1, e.alertas.length, FMT_BRL); wsA['!cols'] = [{ wch: 12 }, { wch: 52 }, { wch: 44 }, { wch: 16 }, { wch: 6 }];
  XLSX.utils.book_append_sheet(wb, wsA, 'Pontos de atenção');

  // OM com valor vencido
  const om = ordenarOM(e.linhas.filter(l => l.vencido > 0), 'vencido');
  const wsO = XLSX.utils.aoa_to_sheet([['OM', 'Vencido (R$)', '% inadimplência', `Vencido > ${e.criterios.diasAtencao} dias (R$)`, 'Contestado (R$)'], ...om.map(l => [l.cliente, l.vencido, l.pctInad, l.v90 || null, l.contestado || null])]);
  [1, 3, 4].forEach(c => fmtCol(wsO, c, 1, om.length, FMT_BRL)); fmtCol(wsO, 2, 1, om.length, FMT_PCT); wsO['!cols'] = [{ wch: 56 }, { wch: 16 }, { wch: 16 }, { wch: 24 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsO, 'OM com vencido');

  const bruto = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return injetarGraficos(bruto, 'Gráficos', xl);
}
