/** Monta (sem desenhar) o conteúdo dos PDFs de Gastos da BNIC e da Taxa condominial. Funções puras, testáveis. */
import { RelatorioPdf } from './pdfRelatorio';
import { ResultadoGastos, Utilidade } from './gastosBNIC';

const brl = (n: number) => `${n < 0 ? '-' : ''}R$ ${Math.abs(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);
const mes = (ym: string) => `${ym.slice(5)}/${ym.slice(0, 4)}`;

export interface EntradaGastosPdf {
  ano: number; periodo: { de: string; ate: string }; hoje: string; statusProposta?: string; gastos: ResultadoGastos; utilidades: Utilidade[];
  tcRecebida: number; quota: { anual: number; mensal: number; percentual: number } | null; aRatear: number; nomeOM?: (id: string) => string; omEmissoraId?: string | null;
}
export function relatorioGastos(e: EntradaGastosPdf): RelatorioPdf {
  const g = e.gastos, t = g.totais;
  const rotulo = e.periodo.de === e.periodo.ate ? mes(e.periodo.de) : `${mes(e.periodo.de)} a ${mes(e.periodo.ate)}`;
  const consumo = e.utilidades.reduce((s, u) => s + u.valor, 0);
  // tabela por grupo, com as rubricas logo abaixo de cada grupo
  const corpo: (string | number)[][] = [], destaque: number[] = [];
  g.grupos.forEach(gr => {
    destaque.push(corpo.length);
    corpo.push([gr.rotulo, brl(gr.previsto), brl(gr.empenhado), pct(gr.execucao), brl(gr.recebido), brl(gr.saldoEmConta)]);
    gr.linhas.forEach(l => corpo.push([`   ${l.numero} · ${l.descricao}`, brl(l.previsto), l.empenhado ? brl(l.empenhado) : '-', pct(l.execucao), l.recebido ? brl(l.recebido) : '-', brl(l.saldoEmConta)]));
  });
  const tabelas: RelatorioPdf['tabelas'] = [{
    titulo: 'Previsto, empenhado e recebido por grupo', head: ['Grupo / rubrica', `Previsto ${e.ano}`, 'Empenhado', '% exec.', 'Recebido das OM', 'Saldo em conta'],
    body: corpo, destaque, direita: [1, 2, 3, 4, 5], larguras: [70, 28, 28, 14, 28, 28],
    total: ['Total das rubricas', brl(t.previsto), brl(t.empenhadoRubricas), pct(t.execucao), brl(t.recebido), brl(t.saldoEmConta)],
  }];
  if (g.semRubrica.length) tabelas.push({ titulo: 'Empenhos sem rubrica', head: ['Categoria', 'Empenhos', 'Valor empenhado'], body: g.semRubrica.map(x => [x.rotulo, x.qtd, brl(x.empenhado)]), direita: [1, 2], total: ['Total', g.semRubrica.reduce((s, x) => s + x.qtd, 0), brl(t.empenhadoSemRubrica)] });
  if (e.utilidades.length) tabelas.push({
    titulo: `Consumo da própria base (${rotulo})`, head: ['Serviço', 'Quantidade', 'Valor', '% do complexo', 'Posição'],
    body: e.utilidades.map(u => [u.nome, `${u.quantidade.toLocaleString('pt-BR')} ${u.unidade}`.trim(), brl(u.valor), pct(u.pct), u.posicao ? `${u.posicao}º de ${u.ranking.length}` : '-']), direita: [1, 2, 3, 4], total: ['Total medido da BNIC', '', brl(consumo), '', ''],
  });
  if (g.fornecedores.length) tabelas.push({
    titulo: `Empenhos por fornecedor — 15 maiores de ${g.fornecedores.length} (outro recorte do mesmo dinheiro)`, head: ['Fornecedor', 'Empenhos', 'Valor', 'Rubricas / categorias'],
    body: g.fornecedores.slice(0, 15).map(f => [f.nome, f.qtd, brl(f.valor), [...f.rubricas.map(r => `R${r}`), ...f.categorias].join(', ') || '-']), direita: [1, 2],
  });
  return {
    titulo: `Gastos da BNIC — exercício ${e.ano}`, arquivo: `gastos_bnic_${e.ano}_${e.periodo.de}_${e.periodo.ate}.pdf`, orientacao: 'p',
    linhas: [`Posição em ${br(e.hoje)} · período ${rotulo}${e.statusProposta ? ` · proposta ${e.statusProposta.toLowerCase()}` : ''}`,
      'O previsto é do exercício inteiro; o empenhado, o recebido e o consumo da base são do período.'],
    cartoes: [
      [`Previsto em ${e.ano}`, brl(t.previsto)], [`Empenhado (${rotulo})`, brl(t.empenhado)],
      ['Saldo do previsto', brl(t.saldo)], ['% executado (rubricas)', pct(t.execucao)],
      ['Recebido das OM (TC)', brl(e.tcRecebida)], ['Saldo em conta (recebido - empenhado)', brl(t.saldoEmConta)],
      ['Consumo medido da base', brl(consumo)], ['Parte da BNIC no rateio (ano)', e.quota ? brl(e.quota.anual) : '-'],
      ['Total rateado às OM', brl(e.aRatear)], [`Empenhos no período`, String(t.qtdEmpenhos)],
    ],
    tabelas,
    rodape: 'Previsto = valor vigente das rubricas (depois do desconto geral). Empenhado = notas de empenho do Fluxo de caixa no período, sem canceladas e anuladas; empenho sem rubrica fica à parte e não é somado duas vezes. '
      + 'Recebido das OM = taxa condominial recebida no período, dividida entre as rubricas na proporção de cada uma no valor cobrado das OM (rateio proporcional; estimativa por rubrica, total exato). A parte da BNIC no rateio é só controle, não é gasto a mais.',
  };
}

// ------------------------------------------------------------------ taxa condominial e diárias
export interface LinhaOMPdf { nome: string; lotacao: number; dias: number | null; anual: number; mensal: number; percentual: number; bruto: number; descontos: number; diaria?: number | null; semHistorico?: boolean; anteriorMensal?: number | null; variacao: number | null }
export interface EntradaTaxaPdf {
  ano: number; modo: 'TC' | 'DA'; status: string; hoje: string; cartoes: [string, string][]; oms: LinhaOMPdf[];
  rubricas: { numero: number; descricao: string; previsto: number; descontoGeral: number; vigente: number; justificativa?: string | null }[];
  descontos: { om: string; rubrica: string; tipo: string; valor: number; justificativa: string }[]; custoMilitarDia?: number;
}
export function relatorioTaxa(e: EntradaTaxaPdf): RelatorioPdf {
  const da = e.modo === 'DA';
  const tabelas: RelatorioPdf['tabelas'] = [];
  if (da) {
    tabelas.push({
      titulo: `Diária de atracação ${e.ano} por navio`, head: ['Navio', 'Lotação', 'Dias/mês', 'Valor anual estimado', 'Valor estimado mês', `Diária ${e.ano - 1}`, `Diária ${e.ano}`, 'Variação'],
      body: e.oms.map(o => [o.nome + (o.semHistorico ? ' *' : ''), o.lotacao, o.dias ?? '-', brl(o.anual), brl(o.mensal), o.anteriorMensal ? brl(o.anteriorMensal) : '-', o.diaria != null ? brl(o.diaria) : '-', o.variacao === null ? '-' : pct(o.variacao)]),
      direita: [1, 2, 3, 4, 5, 6, 7], total: ['Total', e.oms.reduce((s, o) => s + o.lotacao, 0), '', brl(e.oms.reduce((s, o) => s + o.anual, 0)), brl(e.oms.reduce((s, o) => s + o.mensal, 0)), '', '', ''],
    });
  } else {
    tabelas.push({
      titulo: `Anexo B — comparativo ${e.ano - 1} × ${e.ano} por OM`, head: ['OM', `Mensal ${e.ano - 1}`, `Proposta ${e.ano} (A)`, 'Descontos (ano)', 'Proposta atualizada', 'Mensal', '%', 'Variação'],
      body: e.oms.map(o => [o.nome, o.anteriorMensal ? brl(o.anteriorMensal) : '-', brl(o.bruto), o.descontos ? brl(o.descontos) : '-', brl(o.anual), brl(o.mensal), pct(o.percentual), o.variacao === null ? '-' : pct(o.variacao)]),
      direita: [1, 2, 3, 4, 5, 6, 7], total: ['Total', '', brl(e.oms.reduce((s, o) => s + o.bruto, 0)), brl(e.oms.reduce((s, o) => s + o.descontos, 0)), brl(e.oms.reduce((s, o) => s + o.anual, 0)), brl(e.oms.reduce((s, o) => s + o.mensal, 0)), '', ''],
    });
  }
  tabelas.push({
    titulo: da ? 'Linhas da taxa que formam o valor dos navios' : 'Rubricas da taxa condominial', head: ['Nº', 'Despesa', 'Previsto', 'Desconto geral', 'Vigente'],
    body: e.rubricas.map(r => [r.numero, r.descricao, brl(r.previsto), r.descontoGeral ? brl(r.descontoGeral) : '-', brl(r.vigente)]), direita: [2, 3, 4], larguras: [12, 140, 39, 39, 39],
    total: ['', 'Total', brl(e.rubricas.reduce((s, r) => s + r.previsto, 0)), brl(e.rubricas.reduce((s, r) => s + r.descontoGeral, 0)), brl(e.rubricas.reduce((s, r) => s + r.vigente, 0))],
  });
  if (!da && e.descontos.length) tabelas.push({ titulo: 'Descontos por OM', head: ['OM', 'Rubrica', 'Tipo', 'Valor', 'Justificativa'], body: e.descontos.map(d => [d.om, d.rubrica, d.tipo === 'PERCENTUAL' ? '%' : 'R$', d.tipo === 'PERCENTUAL' ? pct(d.valor) : brl(d.valor), d.justificativa]), direita: [3] });
  return {
    titulo: da ? `Diária de atracação ${e.ano}` : `Taxa condominial ${e.ano} — proposta e resultado`, arquivo: da ? `diarias_atracacao_${e.ano}.pdf` : `taxa_condominial_${e.ano}.pdf`, orientacao: 'l',
    linhas: [`Proposta ${e.ano}: ${e.status.toLowerCase()} · gerado em ${br(e.hoje)}`, ...(da && e.custoMilitarDia ? [`Custo por militar-dia: R$ ${e.custoMilitarDia.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}. * navio sem dias de atracação no histórico: diária pela lotação.`] : [])],
    cartoes: e.cartoes, tabelas,
    rodape: da ? 'Diária de cada navio = custo por militar-dia × lotação (rateio entre os navios pela lotação × dias atracados).' : 'Descontos por OM não são redistribuídos às demais OM. Variação em relação à taxa mensal publicada no ano anterior.',
  };
}
