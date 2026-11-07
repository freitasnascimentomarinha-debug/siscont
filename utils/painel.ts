/**
 * Painel inicial: números "de cara" calculados das faturas (funções puras).
 *  - Faturado no ano = soma das faturas não canceladas cuja competência é do ano.
 *  - Em aberto = saldo a pagar (já descontados pagamentos e adiantamentos) das faturas não pagas e não canceladas.
 *  - Vencida = em aberto com vencimento anterior a hoje; separada pelo exercício da competência:
 *    anos anteriores × ano de referência (como o quadro "Faturas vencidas AAAA" da planilha).
 *  - A vencer = em aberto com vencimento hoje ou depois.
 */
export interface FaturaPainel {
  id: string; numero: string; cliente: string; setor: string; comando: string; tipo: string;
  ano: number; mes: number; emissao: string; vencimento: string;
  total: number; pago: number; saldo: number; cancelada: boolean; contestada: boolean;
}
export type Grupo = 'VENCIDAS_ANTERIORES' | 'VENCIDAS_ANO' | 'VENCIDAS' | 'A_VENCER' | 'EM_ABERTO' | 'FATURADAS_ANO';
export interface Bloco { valor: number; qtd: number }

const r2 = (n: number) => Math.round(n * 100) / 100;
const soma = (l: FaturaPainel[], f: (x: FaturaPainel) => number) => r2(l.reduce((s, x) => s + f(x), 0));
const bloco = (l: FaturaPainel[]): Bloco => ({ valor: soma(l, x => x.saldo), qtd: l.length });
export const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const FAIXAS_IDADE = ['A vencer', '1 a 30 dias', '31 a 90 dias', '91 a 180 dias', '181 a 365 dias', 'Mais de 1 ano'] as const;

const diasEntre = (de: string, ate: string) => Math.floor((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86400000);
export const emAberto = (f: FaturaPainel) => !f.cancelada && f.saldo > 0.009;
export const vencida = (f: FaturaPainel, hoje: string) => emAberto(f) && !!f.vencimento && f.vencimento.slice(0, 10) < hoje;

export function faixaIdade(f: FaturaPainel, hoje: string): (typeof FAIXAS_IDADE)[number] {
  if (!vencida(f, hoje)) return 'A vencer';
  const d = diasEntre(f.vencimento, hoje);
  return d <= 30 ? '1 a 30 dias' : d <= 90 ? '31 a 90 dias' : d <= 180 ? '91 a 180 dias' : d <= 365 ? '181 a 365 dias' : 'Mais de 1 ano';
}

/** Faturas de um grupo (para a lista que abre ao clicar num cartão). */
export function doGrupo(fs: FaturaPainel[], g: Grupo, ano: number, hoje: string): FaturaPainel[] {
  switch (g) {
    case 'FATURADAS_ANO': return fs.filter(f => !f.cancelada && f.ano === ano);
    case 'VENCIDAS_ANTERIORES': return fs.filter(f => vencida(f, hoje) && f.ano < ano);
    case 'VENCIDAS_ANO': return fs.filter(f => vencida(f, hoje) && f.ano >= ano);
    case 'VENCIDAS': return fs.filter(f => vencida(f, hoje));
    case 'A_VENCER': return fs.filter(f => emAberto(f) && !vencida(f, hoje));
    case 'EM_ABERTO': return fs.filter(emAberto);
  }
}

export function resumoPainel(fs: FaturaPainel[], ano: number, hoje: string) {
  const doAno = doGrupo(fs, 'FATURADAS_ANO', ano, hoje);
  const abertas = doGrupo(fs, 'EM_ABERTO', ano, hoje);
  const venc = abertas.filter(f => vencida(f, hoje));
  const anterior = doGrupo(fs, 'FATURADAS_ANO', ano - 1, hoje);

  const porMes = MESES.map((m, i) => {
    const l = doAno.filter(f => f.mes === i + 1);
    return { mes: m, faturado: soma(l, f => f.total), pago: soma(l, f => f.pago), emAberto: soma(l, f => (emAberto(f) ? f.saldo : 0)), qtd: l.length };
  });
  const idade = FAIXAS_IDADE.map(faixa => { const l = abertas.filter(f => faixaIdade(f, hoje) === faixa); return { faixa, ...bloco(l) }; });

  const agrupar = (chave: (f: FaturaPainel) => string) => {
    const m = new Map<string, { nome: string; vencido: number; aVencer: number; qtd: number }>();
    abertas.forEach(f => {
      const k = chave(f) || '(sem informação)';
      const g = m.get(k) || { nome: k, vencido: 0, aVencer: 0, qtd: 0 };
      if (vencida(f, hoje)) g.vencido += f.saldo; else g.aVencer += f.saldo;
      g.qtd++; m.set(k, g);
    });
    return [...m.values()].map(g => ({ ...g, vencido: r2(g.vencido), aVencer: r2(g.aVencer), total: r2(g.vencido + g.aVencer) })).sort((a, b) => b.total - a.total);
  };

  const faturadoAno = soma(doAno, f => f.total), pagoAno = soma(doAno, f => f.pago);
  return {
    faturadoAno: { valor: faturadoAno, qtd: doAno.length },
    faturadoAnterior: soma(anterior, f => f.total),
    pagoAno, percentualPago: faturadoAno ? Math.round((pagoAno / faturadoAno) * 1000) / 10 : 0,
    vencidasAnteriores: bloco(venc.filter(f => f.ano < ano)),
    vencidasAno: bloco(venc.filter(f => f.ano >= ano)),
    vencidas: bloco(venc),
    aVencer: bloco(abertas.filter(f => !vencida(f, hoje))),
    emAberto: bloco(abertas),
    contestadas: bloco(abertas.filter(f => f.contestada)),
    porMes, idade,
    porTipo: agrupar(f => f.tipo),
    porCliente: agrupar(f => f.cliente),
    porSetor: agrupar(f => f.setor),
    anosVencidos: [...new Set(venc.map(f => f.ano))].sort((a, b) => b - a).map(a => ({ ano: a, ...bloco(venc.filter(f => f.ano === a)) })),
  };
}

/** Taxa condominial vigente: TC mensal por OM (preços do ano). */
export function taxaCondominial(precos: { ano: number; sigla: string; omId?: string | null; valor: number }[], nomes: Map<string, string>, ano: number) {
  const anos = [...new Set(precos.filter(p => p.sigla === 'TC' && p.omId).map(p => p.ano))].sort((a, b) => b - a);
  const usado = anos.includes(ano) ? ano : anos.find(a => a < ano) ?? anos[0] ?? null;
  const oms = precos.filter(p => p.sigla === 'TC' && p.omId && p.ano === usado)
    .map(p => ({ omId: p.omId!, nome: nomes.get(p.omId!) || p.omId!, mensal: r2(p.valor), anual: r2(p.valor * 12) }))
    .sort((a, b) => b.mensal - a.mensal);
  const mensal = r2(oms.reduce((s, o) => s + o.mensal, 0));
  return { ano: usado, oms: oms.map(o => ({ ...o, percentual: mensal ? Math.round((o.mensal / mensal) * 1000) / 10 : 0 })), mensal, anual: r2(mensal * 12) };
}
