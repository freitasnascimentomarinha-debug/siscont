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
import { FAIXAS, faixaDe } from './relatorios';

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

export interface FaturaMapa { id: string; omId?: string | null; client: string; sector: string; command: string; numero: string; tipo: string; vencimento: string; saldo: number; contestada?: boolean }
export interface CreditoMapa { id: string; client: string; sector: string; command: string; numero: string; valor: number; /** de onde veio, quando não é o cliente do próprio documento */ origem?: string }
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
export interface OpcoesMapa {
  hoje: string; ordem?: OrdemMapa; busca?: string; soComValor?: boolean;
  /** só OM com algo vencido */
  soVencido?: boolean;
  /** foco: um setor ou uma OM (nome exato) escolhidos num gráfico ou cartão */
  setor?: string; om?: string;
  /** várias OM escolhidas à mão (nomes exatos); vazio = todas */
  oms?: string[];
  /** filtro das FATURAS na árvore: só vencidas, só a vencer, ou uma faixa de atraso ("31–90 dias"...) */
  faturas?: 'vencidas' | 'aVencer' | string;
  /** tira as faturas em contestação (não entram na dívida nem aparecem na árvore) */
  semContestadas?: boolean;
  /** só as faturas em contestação (para acompanhá-las); vale em lugar de semContestadas */
  soContestadas?: boolean;
  /** só OM que têm crédito / que têm crédito sobrando */
  soComCredito?: boolean; soSobra?: boolean;
}

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

  const passaFatura = (f: FaturaMapa) => {
    if (o.semContestadas && f.contestada) return false;
    if (o.soContestadas && !f.contestada) return false;
    if (!o.faturas) return true;
    if (o.faturas === 'vencidas') return f.vencimento < o.hoje;
    if (o.faturas === 'aVencer') return f.vencimento >= o.hoje;
    return faixaDe(Math.max(0, diasEntre(f.vencimento, o.hoje))) === o.faturas;
  };
  faturas.forEach(f => {
    if (f.saldo <= 0.005 || !passaFatura(f)) return;
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
  // com um filtro de faturas ligado, OM sem nenhuma fatura que passe no filtro não aparece (só crédito não interessa ali)
  if (o.faturas) lista = lista.filter(a => a.faturas.length > 0);
  if (o.setor) lista = lista.filter(a => a.setor === o.setor);
  if (o.om) lista = lista.filter(a => a.nome === o.om);
  if (o.oms?.length) { const set = new Set(o.oms); lista = lista.filter(a => set.has(a.nome)); }
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
  if (o.soVencido) clientes = clientes.filter(x => x.n.vencido > 0.005);
  if (o.soComCredito) clientes = clientes.filter(x => x.n.credito > 0.005);
  if (o.soSobra) clientes = clientes.filter(x => x.n.sobra > 0.005);

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


// ------------------------------------------------------------------ crédito devolvido por fatura cancelada
export interface DocMapa { id: string; client: string; sector: string; command: string; numero: string; availableValue: number }
export interface BaixaMapa { documentId: string; invoiceId: string; amount: number }
export interface FaturaRef { id: string; invoiceNumber?: string; omId?: string | null; client: string; isCanceled?: boolean }

/**
 * Créditos do mapa. Quando uma fatura é cancelada, o valor baixado nela volta para a ALTCRED, mas o dinheiro foi
 * pago para a OM daquela fatura: o crédito é DELA, e não do pagador (ex.: o RT DGMM paga faturas do Arsenal; se uma
 * fatura do Arsenal é cancelada, o saldo devolvido é crédito do Arsenal). O que sobra do documento fica com o
 * cliente do próprio documento.
 */
export function creditosDoMapa(docs: DocMapa[], baixas: BaixaMapa[], faturas: FaturaRef[], oms: OMRef[]): CreditoMapa[] {
  const fat = new Map(faturas.map(f => [f.id, f]));
  const omPorId = new Map(oms.map(o => [o.omId, o]));
  const porDoc = new Map<string, BaixaMapa[]>();
  baixas.forEach(b => porDoc.set(b.documentId, [...(porDoc.get(b.documentId) || []), b]));
  const out: CreditoMapa[] = [];
  docs.forEach(d => {
    let resta = r2(d.availableValue);
    if (resta <= 0.005) return;
    const liberado = new Map<string, { nome: string; valor: number; faturas: string[] }>();
    (porDoc.get(d.id) || []).forEach(b => {
      const f = fat.get(b.invoiceId);
      if (!f?.isCanceled) return;
      const chave = f.omId || `n:${norm(f.client)}`;
      const nome = (f.omId && omPorId.get(f.omId)?.nome) || f.client;
      const g = liberado.get(chave) || { nome, valor: 0, faturas: [] };
      g.valor = r2(g.valor + b.amount); if (f.invoiceNumber && !g.faturas.includes(f.invoiceNumber)) g.faturas.push(f.invoiceNumber);
      liberado.set(chave, g);
    });
    [...liberado.entries()].sort((a, b) => b[1].valor - a[1].valor).forEach(([chave, g]) => {
      const v = r2(Math.min(g.valor, resta));
      if (v <= 0.005) return;
      out.push({ id: `${d.id}:${chave}`, client: g.nome, sector: d.sector, command: d.command, numero: d.numero, valor: v, origem: `devolvido da fatura cancelada ${g.faturas.join(', ')}` });
      resta = r2(resta - v);
    });
    if (resta > 0.005) out.push({ id: d.id, client: d.client, sector: d.sector, command: d.command, numero: d.numero, valor: resta });
  });
  return out;
}


// ------------------------------------------------------------------ listas e gráficos (interatividade)

export interface LinhaFaturaMapa { id: string; om: string; setor: string; comando: string; numero: string; tipo: string; vencimento: string; atraso: number; saldo: number; contestada?: boolean }
export interface LinhaCreditoMapa { id: string; om: string; setor: string; comando: string; numero: string; valor: number; origem?: string }

/** Todas as OM (nível cliente) do mapa, com o setor e o comando de cada uma. */
export function clientesDoMapa(m: MapaAnalitico): (NoMapa & { setor: string; comando: string })[] {
  return m.setores.flatMap(s => s.filhos.flatMap(c => c.filhos.map(x => ({ ...x, setor: s.nome, comando: c.nome }))));
}
/** Faturas do mapa (as que estão na tela), com filtro opcional. */
export function faturasDoMapa(m: MapaAnalitico, filtro: (f: LinhaFaturaMapa) => boolean = () => true): LinhaFaturaMapa[] {
  return clientesDoMapa(m).flatMap(c => (c.faturas || []).map(f => ({ id: f.id, om: c.nome, setor: c.setor, comando: c.comando, numero: f.numero, tipo: f.tipo, vencimento: f.vencimento, atraso: f.atraso, saldo: f.saldo, contestada: f.contestada }))).filter(filtro);
}
export function creditosDoMapaLista(m: MapaAnalitico): LinhaCreditoMapa[] {
  return clientesDoMapa(m).flatMap(c => (c.creditos || []).map(x => ({ id: x.id, om: c.nome, setor: c.setor, comando: c.comando, numero: x.numero, valor: x.valor, origem: x.origem })));
}
/** Dívida por faixa de atraso (a vencer, 1–30 dias, ...), para o gráfico de idade da dívida. */
export function idadeDaDivida(m: MapaAnalitico) {
  const fs = faturasDoMapa(m);
  return FAIXAS.map(x => {
    const dela = fs.filter(f => faixaDe(f.atraso) === x.rotulo);
    return { faixa: x.rotulo, valor: r2(dela.reduce((s, f) => s + f.saldo, 0)), qtd: dela.length };
  });
}
export const faturasDaFaixaMapa = (m: MapaAnalitico, faixa: string) => faturasDoMapa(m, f => faixaDe(f.atraso) === faixa);
/** As N OM com maior valor a pagar (para o gráfico de barras). */
export function maioresOMs(m: MapaAnalitico, n = 10) {
  return clientesDoMapa(m).filter(c => c.liquido > 0.005).sort((a, b) => b.liquido - a.liquido || a.nome.localeCompare(b.nome, 'pt-BR')).slice(0, n);
}


// ------------------------------------------------------------------ PDF no formato da árvore
export type NivelPdf = 'setor' | 'comando' | 'cliente' | 'fatura' | 'credito';
export interface LinhaPdf { nivel: NivelPdf; celulas: string[] }
/** Vencimento e atraso ficam em colunas próprias, separados do nome/número da fatura. */
export const CAB_PDF_ARVORE = ['Setor › Comando › OM › fatura', 'Vencimento', 'Atraso', 'Faturas', 'Vencido', 'A vencer', 'Dívida', 'Crédito', 'A pagar'];

/**
 * Linhas do PDF exatamente como a árvore do mapa (só o que passou nos filtros): setor, comando, OM e, dentro de
 * cada OM, as faturas e os créditos dela.
 */
export function linhasArvorePdf(m: MapaAnalitico, moeda: (n: number) => string, data: (iso: string) => string): LinhaPdf[] {
  const v = (n: number) => (n > 0.005 ? moeda(n) : '—');
  const no = (n: NoMapa): string[] => [n.nome, '', '', n.qtd ? String(n.qtd) : '—', v(n.vencido), v(n.aVencer), v(n.divida), v(n.credito),
    n.liquido > 0.005 ? moeda(n.liquido) : n.sobra > 0.005 ? `— (sobra ${moeda(n.sobra)})` : '—'];
  const out: LinhaPdf[] = [];
  m.setores.forEach(s => {
    out.push({ nivel: 'setor', celulas: no(s) });
    s.filhos.forEach(c => {
      out.push({ nivel: 'comando', celulas: no(c) });
      c.filhos.forEach(x => {
        out.push({ nivel: 'cliente', celulas: no(x) });
        (x.faturas || []).forEach(f => out.push({ nivel: 'fatura', celulas: [
          `${f.numero} (${f.tipo})${f.contestada ? ' · contestada' : ''}`, data(f.vencimento), f.atraso ? `${f.atraso} dias` : '—',
          '', f.atraso ? moeda(f.saldo) : '', f.atraso ? '' : moeda(f.saldo), moeda(f.saldo), '', ''] }));
        (x.creditos || []).forEach(c2 => out.push({ nivel: 'credito', celulas: [`ALTCRED/GRU ${c2.numero}${c2.origem ? ` (${c2.origem})` : ''}`, '', '', '', '', '', '', moeda(c2.valor), ''] }));
      });
    });
  });
  return out;
}
