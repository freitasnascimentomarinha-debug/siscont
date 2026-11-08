/**
 * Mapa Analítico de Contas: posição líquida por Setor › Comando › OM.
 *
 * Regras:
 *  - a dívida de cada fatura é o SALDO A PAGAR real (já descontados adiantamento e pagamentos);
 *  - o crédito (ALTCRED/GRU com saldo) só abate a dívida da PRÓPRIA OM: crédito de uma OM não paga fatura de outra;
 *  - a OM é a do cadastro (a fatura pelo vínculo, o crédito pelo nome do cliente), então setor e comando vêm do
 *    cadastro e não do texto digitado em cada documento;
 *  - cada nível é a SOMA dos filhos; o total é a soma dos valores a pagar de cada OM.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

export interface FaturaMapa { id: string; omId?: string | null; client: string; sector: string; command: string; numero: string; tipo: string; vencimento: string; saldo: number; contestada?: boolean }
export interface CreditoMapa { id: string; client: string; sector: string; command: string; numero: string; valor: number }
export interface OMRef { omId: string; nome: string; setor: string; comando: string }
export type OrdemMapa = 'liquido' | 'divida' | 'nome';
export interface Totais { qtd: number; divida: number; vencido: number; aVencer: number; credito: number; liquido: number; sobra: number }
export interface NoMapa extends Totais {
  id: string; nivel: 'setor' | 'comando' | 'cliente'; nome: string;
  filhos: NoMapa[];
  faturas?: (FaturaMapa & { atraso: number })[]; creditos?: CreditoMapa[];
  /** crédito que não foi ligado a nenhuma OM do cadastro (nome diferente) */
  semCadastro?: boolean;
}
export interface MapaAnalitico { setores: NoMapa[]; total: Totais }
export interface OpcoesMapa { hoje: string; ordem?: OrdemMapa; busca?: string; soComValor?: boolean }

const zero = (): Totais => ({ qtd: 0, divida: 0, vencido: 0, aVencer: 0, credito: 0, liquido: 0, sobra: 0 });
const somar = (a: Totais, b: Totais): Totais => ({
  qtd: a.qtd + b.qtd, divida: r2(a.divida + b.divida), vencido: r2(a.vencido + b.vencido), aVencer: r2(a.aVencer + b.aVencer),
  credito: r2(a.credito + b.credito), liquido: r2(a.liquido + b.liquido), sobra: r2(a.sobra + b.sobra),
});

interface Acc { chave: string; nome: string; setor: string; comando: string; faturas: FaturaMapa[]; creditos: CreditoMapa[]; semCadastro: boolean }

export function montarMapa(faturas: FaturaMapa[], creditos: CreditoMapa[], oms: OMRef[], o: OpcoesMapa): MapaAnalitico {
  const porId = new Map(oms.map(x => [x.omId, x]));
  const porNome = new Map(oms.map(x => [norm(x.nome), x]));
  const nos = new Map<string, Acc>();
  const no = (chave: string, nome: string, setor: string, comando: string, semCadastro: boolean) => {
    let a = nos.get(chave);
    if (!a) { a = { chave, nome, setor: setor || 'Sem Setor', comando: comando || 'Sem Comando', faturas: [], creditos: [], semCadastro }; nos.set(chave, a); }
    return a;
  };

  faturas.forEach(f => {
    if (f.saldo <= 0.005) return;
    const om = (f.omId && porId.get(f.omId)) || porNome.get(norm(f.client));
    const a = om ? no(om.omId, om.nome, om.setor, om.comando, false) : no(`n:${norm(f.client)}`, f.client, f.sector, f.command, false);
    a.faturas.push(f);
  });
  creditos.forEach(c => {
    if (c.valor <= 0.005) return;
    const om = porNome.get(norm(c.client));
    const a = om ? no(om.omId, om.nome, om.setor, om.comando, false) : no(`n:${norm(c.client)}`, c.client, c.sector, c.command, true);
    a.creditos.push(c);
  });

  // filtros (antes de somar, para os totais acompanharem o que está na tela)
  const q = norm(o.busca || '');
  let lista = [...nos.values()];
  if (q) lista = lista.filter(a => norm(`${a.nome} ${a.setor} ${a.comando}`).includes(q) || a.faturas.some(f => norm(f.numero).includes(q)) || a.creditos.some(c => norm(c.numero).includes(q)));

  const clienteNo = (a: Acc): NoMapa => {
    const divida = r2(a.faturas.reduce((s, f) => s + f.saldo, 0));
    const credito = r2(a.creditos.reduce((s, c) => s + c.valor, 0));
    const vencido = r2(a.faturas.filter(f => f.vencimento < o.hoje).reduce((s, f) => s + f.saldo, 0));
    return {
      id: `cli:${a.chave}`, nivel: 'cliente', nome: a.nome, filhos: [], semCadastro: a.semCadastro,
      qtd: a.faturas.length, divida, vencido, aVencer: r2(divida - vencido), credito,
      liquido: r2(Math.max(0, divida - credito)), sobra: r2(Math.max(0, credito - divida)),
      faturas: [...a.faturas].sort((x, y) => x.vencimento.localeCompare(y.vencimento)).map(f => ({ ...f, atraso: Math.max(0, diasEntre(f.vencimento, o.hoje)) })),
      creditos: [...a.creditos].sort((x, y) => y.valor - x.valor),
    };
  };
  let clientes = lista.map(a => ({ a, n: clienteNo(a) }));
  if (o.soComValor) clientes = clientes.filter(x => x.n.liquido > 0.005);

  const ordem = o.ordem || 'liquido';
  const cmp = (x: { nome: string } & Totais, y: { nome: string } & Totais) =>
    ordem === 'nome' ? x.nome.localeCompare(y.nome, 'pt-BR') : (ordem === 'divida' ? y.divida - x.divida : y.liquido - x.liquido) || x.nome.localeCompare(y.nome, 'pt-BR');

  const porSetor = new Map<string, Map<string, NoMapa[]>>();
  clientes.forEach(({ a, n }) => {
    const cm = porSetor.get(a.setor) || new Map<string, NoMapa[]>();
    cm.set(a.comando, [...(cm.get(a.comando) || []), n]);
    porSetor.set(a.setor, cm);
  });

  const setores: NoMapa[] = [...porSetor.entries()].map(([setor, cm]) => {
    const comandos: NoMapa[] = [...cm.entries()].map(([comando, cls]) => {
      const filhos = [...cls].sort(cmp);
      return { id: `cmd:${setor}|${comando}`, nivel: 'comando' as const, nome: comando, filhos, ...filhos.reduce<Totais>(somar, zero()) };
    }).sort(cmp);
    return { id: `set:${setor}`, nivel: 'setor' as const, nome: setor, filhos: comandos, ...comandos.reduce<Totais>(somar, zero()) };
  }).sort(cmp);

  return { setores, total: setores.reduce<Totais>(somar, zero()) };
}

export const idsDoMapa = (m: MapaAnalitico, ate: 'setor' | 'comando' | 'cliente'): string[] => {
  const out: string[] = [];
  m.setores.forEach(s => { out.push(s.id); if (ate !== 'setor') s.filhos.forEach(c => { out.push(c.id); if (ate === 'cliente') c.filhos.forEach(x => out.push(x.id)); }); });
  return out;
};

export const CAB_MAPA = ['Setor', 'Comando', 'Cliente (OM)', 'Faturas', 'Vencido', 'A vencer', 'Dívida', 'Crédito disponível', 'A pagar (líquido)', 'Crédito que sobra'];
export function linhasMapa(m: MapaAnalitico): any[][] {
  const out: any[][] = [CAB_MAPA];
  m.setores.forEach(s => s.filhos.forEach(c => c.filhos.forEach(x => out.push([s.nome, c.nome, x.nome, x.qtd, x.vencido, x.aVencer, x.divida, x.credito, x.liquido, x.sobra]))));
  out.push(['TOTAL', '', '', m.total.qtd, m.total.vencido, m.total.aVencer, m.total.divida, m.total.credito, m.total.liquido, m.total.sobra]);
  return out;
}
