import { AnaliseOM, Causa, NOME_CAUSA } from './analiseVariacao';
import type { RelatorioPdf, TabelaPdf } from './pdfRelatorio';

const r2 = (n: number) => Math.round(n * 100) / 100;
export const brlV = (n: number) => `R$ ${Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const sinalV = (n: number) => (Math.abs(n) < 0.005 ? '—' : `${n < 0 ? '−' : '+'}${brlV(n)}`);
const pctV = (n: number | null) => (n === null ? '' : ` (${n > 0 ? '+' : ''}${n.toLocaleString('pt-BR')}%)`);

/** O PDF usa a fonte padrão (sem "−" nem "→"): troca por caracteres que ela desenha. */
const seguro = (v: string | number): string | number => (typeof v === 'string' ? v.replace(/−/g, '-').replace(/ ?→ ?/g, ' para ').replace(/•/g, '-') : v);
const seguroTabela = (t: TabelaPdf): TabelaPdf => ({ ...t, titulo: String(seguro(t.titulo)), head: t.head.map(h => String(seguro(h))), body: t.body.map(l => l.map(seguro)), total: t.total?.map(seguro) });

/** Indicadores do conjunto de OM analisadas. */
export function totaisVariacao(analise: AnaliseOM[]) {
  const anterior = r2(analise.reduce((s, o) => s + o.anualAnterior, 0)), atual = r2(analise.reduce((s, o) => s + o.anualAtual, 0));
  const porCausa = new Map<Causa, { valor: number; oms: Set<string> }>();
  analise.forEach(o => (Object.entries(o.porCausa) as [Causa, number][]).forEach(([c, v]) => {
    if (Math.abs(v) < 0.005) return;
    const x = porCausa.get(c) || { valor: 0, oms: new Set<string>() };
    x.valor = r2(x.valor + v); x.oms.add(o.omId); porCausa.set(c, x);
  }));
  return {
    anterior, atual, diferenca: r2(atual - anterior), percentual: anterior ? Math.round(((atual - anterior) / anterior) * 10000) / 100 : null,
    aumentaram: analise.filter(o => o.situacao === 'MANTIDA' && o.diferenca > 0.005).length,
    diminuiram: analise.filter(o => o.situacao === 'MANTIDA' && o.diferenca < -0.005).length,
    iguais: analise.filter(o => o.situacao === 'MANTIDA' && Math.abs(o.diferenca) <= 0.005).length,
    novas: analise.filter(o => o.situacao === 'NOVA').length, saíram: analise.filter(o => o.situacao === 'SAIU').length,
    causas: [...porCausa.entries()].map(([causa, x]) => ({ causa, nome: NOME_CAUSA[causa], valor: x.valor, oms: x.oms.size })).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
  };
}

/** Tabelas da justificativa (usadas no PDF próprio e anexadas ao PDF da proposta e resultado). */
export function tabelasJustificativa(analise: AnaliseOM[], ano: number): TabelaPdf[] {
  return montarTabelas(analise, ano).map(seguroTabela);
}
function montarTabelas(analise: AnaliseOM[], ano: number): TabelaPdf[] {
  const mostrar = analise.filter(o => o.situacao !== 'MANTIDA' || Math.abs(o.diferenca) >= 0.005);
  const t = totaisVariacao(analise);
  const out: TabelaPdf[] = [];
  if (t.causas.length) out.push({
    titulo: `O que mais explica as variações (todas as OM, ${ano} × ${ano - 1})`, head: ['Causa', 'OM atingidas', 'Efeito no total (R$)'],
    body: t.causas.map(c => [c.nome, c.oms, sinalV(c.valor)]), direita: [1, 2], larguras: [150, 40, 60],
    total: ['Variação total das OM', '', `${sinalV(t.diferenca)}${pctV(t.percentual)}`],
  });
  out.push({
    titulo: `Resumo por OM — ${ano - 1} × ${ano}`, head: ['OM', 'Lotação', `Anual ${ano - 1}`, `Anual ${ano}`, 'Variação', 'Por quê (principais causas)'],
    body: mostrar.map(o => {
      const principais = (Object.entries(o.porCausa) as [Causa, number][]).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4)
        .map(([c, v]) => `${NOME_CAUSA[c]} ${sinalV(v)}`);
      return [o.nome + (o.situacao === 'NOVA' ? ' (nova)' : o.situacao === 'SAIU' ? ' (saiu)' : ''), `${o.lotacaoAnterior ?? '-'} → ${o.lotacaoAtual ?? '-'}`, o.situacao === 'NOVA' ? 'sem dados' : brlV(o.anualAnterior), brlV(o.anualAtual), `${sinalV(o.diferenca)}${pctV(o.percentual)}`, principais.join('\n') || '—'];
    }),
    direita: [2, 3, 4], larguras: [58, 24, 28, 28, 34, 100],
    total: ['Total', '', brlV(t.anterior), brlV(t.atual), `${sinalV(t.diferenca)}${pctV(t.percentual)}`, ''],
  });
  mostrar.forEach(o => {
    const cab = [`${o.nome} — ${o.situacao === 'NOVA' ? 'OM nova na taxa' : o.situacao === 'SAIU' ? 'OM fora da taxa' : `${sinalV(o.diferenca)}${pctV(o.percentual)}`}`];
    const linhas: (string | number)[][] = [['', 'Resumo', '', '', '', o.resumo]];
    if (o.motivoSemAnterior) linhas.push(['', `Sem dados de ${ano - 1}`, '', '', '', o.motivoSemAnterior.charAt(0).toUpperCase() + o.motivoSemAnterior.slice(1) + '.']);
    o.rubricas.forEach(l => linhas.push([l.numero, l.descricao, l.anterior ? brlV(l.anterior) : '—', l.atual ? brlV(l.atual) : '—', sinalV(l.diferenca), l.efeitos.map(e => `• ${NOME_CAUSA[e.causa]} ${sinalV(e.valor)}: ${e.curto}`).join('\n')]));
    out.push({
      titulo: cab[0], head: ['Nº', 'Rubrica', String(ano - 1), String(ano), 'Variação', 'Por quê'], body: linhas, destaque: o.motivoSemAnterior ? [0, 1] : [0],
      direita: [2, 3, 4], larguras: [9, 52, 24, 24, 28, 130], total: ['', 'Total anual', o.situacao === 'NOVA' ? '—' : brlV(o.anualAnterior), brlV(o.anualAtual), sinalV(o.diferenca), ''],
    });
  });
  return out;
}

export function relatorioVariacoes(analise: AnaliseOM[], ano: number, hojeBR: string): RelatorioPdf {
  const t = totaisVariacao(analise);
  return {
    titulo: `Justificativa das variações da taxa condominial ${ano} × ${ano - 1}`, arquivo: `justificativa_variacoes_taxa_${ano}.pdf`, orientacao: 'l',
    linhas: [`Gerado em ${hojeBR}`,
      `Cada diferença entre ${ano - 1} e ${ano} é explicada em R$ por causas que se somam e fecham com a variação de cada OM: valor da rubrica, lotação da própria OM, OM que entram ou saem da divisão da rubrica, lotação das demais OM, participação da OM nas rubricas e descontos.`,
      'Como ler: a parte de uma OM numa rubrica = valor da rubrica × peso da OM ÷ soma dos pesos de quem divide a rubrica (menos descontos). As causas são aplicadas uma de cada vez, nessa ordem.'],
    cartoes: ([[`Total ${ano - 1}`, brlV(t.anterior)], [`Total ${ano}`, brlV(t.atual)], ['Variação', `${sinalV(t.diferenca)}${pctV(t.percentual)}`], ['OM com aumento / redução / igual', `${t.aumentaram} / ${t.diminuiram} / ${t.iguais}`],
      ['OM novas na taxa', String(t.novas)], ['OM que saíram da taxa', String(t.saíram)]] as [string, string][]).map(([a, b]) => [String(seguro(a)), String(seguro(b))] as [string, string]),
    tabelas: tabelasJustificativa(analise, ano),
  };
}
