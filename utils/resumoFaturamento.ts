/**
 * Faturamento: quadro de pendências do mês, filtro dos lotes emitidos e linhas da prévia para Excel.
 * Funções puras; a tela só busca os dados e mostra.
 */
import { ItemLote, partes, referencia } from './faturamento';

export type AbaFaturamento = 'resumo' | 'precos' | 'medicoes' | 'atracacao' | 'lote' | 'creditos' | 'encerramento' | 'correcao';
export interface ItemResumo { id: string; rotulo: string; status: 'ok' | 'pendente' | 'aviso' | 'info'; detalhe: string; aba?: AbaFaturamento }

/** Serviços cujo consumo é medido todo mês (os demais têm preço fixo ou vêm de outra rotina). */
export const SERVICOS_MEDIDOS = ['AE', 'EL', 'TL', 'VT', 'RB', 'CR'];

export interface DadosResumo {
  comp: string;
  servicos: { sigla: string; nome: string }[];
  /** OM (não extra-MB) ativas: base do preço da taxa condominial */
  omsTC: string[];
  /** true quando omsTC são as OM da matriz da taxa do ano (sem matriz, vale o cadastro inteiro) */
  omsTCDaMatriz?: boolean;
  medicoes: { sigla: string; omId: string }[];
  atracacoesRealizadas: { omId: string }[];
  /** preços do ano da competência */
  precos: { sigla: string; omId: string | null }[];
  nomeOM: (id: string) => string;
  /** setor responsável pelos dados do serviço (cadastro de serviços) */
  responsavel?: (sigla: string) => string | null;
  lotes: { competencia: string; tipo: string; qtd: number }[];
  faturasDaCompetencia: number;
  /** créditos de acerto do OND ainda com saldo (compensados na prévia do lote mensal) */
  creditos?: { saldo: number; abertos: number };
}

export function resumoDoMes(d: DadosResumo): ItemResumo[] {
  const out: ItemResumo[] = [];
  const tem = (s: string) => d.servicos.some(x => x.sigla === s);
  const ref = referencia(d.comp);
  const resp = (sigla: string) => { const r = d.responsavel?.(sigla); return r ? ` Responsável: ${r}.` : ' Responsável não cadastrado.'; };

  if (tem('TC')) {
    const com = new Set(d.precos.filter(p => p.sigla === 'TC' && p.omId).map(p => p.omId!));
    const n = d.omsTC.filter(id => com.has(id)).length;
    out.push({ id: 'preco-TC', rotulo: `Taxa condominial ${partes(d.comp).ano}`, aba: 'precos',
      status: n === 0 ? 'pendente' : n < d.omsTC.length ? 'aviso' : 'ok',
      detalhe: n === 0 ? 'Nenhum preço carregado. Publique na página Taxa condominial e diárias ou importe a tabela da TC.' : `${n} de ${d.omsTC.length} OM ${d.omsTCDaMatriz ? 'da matriz' : 'ativas'} com preço${n < d.omsTC.length ? (d.omsTCDaMatriz ? ' (as demais da matriz ainda não têm preço publicado)' : ' (as demais não geram fatura de TC)') : ''}.` });
  }
  if (tem('DA')) {
    const comPreco = new Set(d.precos.filter(p => p.sigla === 'DA' && p.omId).map(p => p.omId!));
    const navios = [...new Set(d.atracacoesRealizadas.map(a => a.omId))];
    const sem = navios.filter(id => !comPreco.has(id));
    out.push({ id: 'preco-DA', rotulo: `Diária de atracação ${partes(d.comp).ano}`, aba: 'precos',
      status: comPreco.size === 0 ? 'pendente' : sem.length ? 'aviso' : 'ok',
      detalhe: comPreco.size === 0 ? 'Nenhuma diária carregada.' : sem.length ? `${sem.length} navio(s) com atracação lançada sem diária: ${sem.slice(0, 4).map(d.nomeOM).join(', ')}${sem.length > 4 ? '…' : ''}.` : `${comPreco.size} navio(s) com diária.` });
    out.push({ id: 'atracacao', rotulo: `Mapa de atracação de ${ref}`, aba: 'atracacao',
      status: navios.length ? 'ok' : 'pendente', detalhe: navios.length ? `${navios.length} navio(s) com dias lançados.` : 'Mapa não lançado: o lote sairá sem diárias.' + (navios.length ? '' : resp('DA')) });
  }
  d.servicos.filter(s => SERVICOS_MEDIDOS.includes(s.sigla)).forEach(s => {
    const n = new Set(d.medicoes.filter(m => m.sigla === s.sigla).map(m => m.omId)).size;
    out.push({ id: `medicao-${s.sigla}`, rotulo: `Medição de ${s.nome} (${s.sigla}) de ${ref}`, aba: 'medicoes',
      status: n ? 'ok' : 'pendente', detalhe: n ? `${n} OM com medição lançada.` : `Nenhuma medição lançada.${resp(s.sigla)}` });
  });
  // o aviso das faturas da competência (lote já emitido ou faturas já existentes) vem sempre em primeiro lugar
  if (d.creditos && d.creditos.saldo > 0.005)
    out.push({ id: 'creditos', rotulo: 'Créditos da OM a compensar', aba: 'creditos', status: 'info',
      detalhe: `R$ ${d.creditos.saldo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} em ${d.creditos.abertos} crédito(s) das OM. Na prévia do lote mensal eles abatem as faturas de qualquer serviço da mesma OM, do crédito mais antigo para o mais novo; o que sobrar pode ser devolvido (ALTCRED/GRU).` });
  const mensal = d.lotes.filter(l => l.competencia === d.comp && l.tipo === 'MENSAL');
  if (mensal.length) out.unshift({ id: 'lote', rotulo: `Lote mensal de ${ref}`, aba: 'lote', status: 'info', detalhe: `Já emitido pelo sistema: ${mensal.reduce((s, l) => s + l.qtd, 0)} fatura(s).` });
  else if (d.faturasDaCompetencia) out.unshift({ id: 'lote', rotulo: `Faturas de ${ref}`, aba: 'lote', status: 'aviso', detalhe: `Já existem ${d.faturasDaCompetencia} fatura(s) desta competência (migradas ou emitidas fora do sistema). Confira para não emitir em duplicidade.` });
  else out.unshift({ id: 'lote', rotulo: `Lote mensal de ${ref}`, aba: 'lote', status: 'info', detalhe: 'Ainda não emitido.' });
  return out;
}

export const pendencias = (itens: ItemResumo[]) => itens.filter(i => i.status === 'pendente').length;

// ------------------------------------------------------------------ lotes emitidos
export interface LoteResumo { id: string; competencia: string; tipo: string; qtd: number; total: number }
const TIPOS_ROTULO: Record<string, string> = { MENSAL: 'mensal', OND: 'ond estimado', ACERTO: 'acerto', CORRECAO: 'correção' };
export function filtrarLotes<T extends LoteResumo>(lotes: T[], f: { ano: string; tipo: string; busca: string }): T[] {
  const q = f.busca.trim().toLowerCase();
  return lotes
    .filter(l => (f.ano === 'TODOS' || l.competencia.startsWith(f.ano)) && (f.tipo === 'TODOS' || l.tipo === f.tipo)
      && (!q || `${referencia(l.competencia)} ${l.competencia} ${TIPOS_ROTULO[l.tipo] || l.tipo}`.toLowerCase().includes(q)))
    .sort((a, b) => b.competencia.localeCompare(a.competencia));
}
export const anosDosLotes = (lotes: LoteResumo[]) => [...new Set(lotes.map(l => l.competencia.slice(0, 4)))].sort().reverse();

// ------------------------------------------------------------------ prévia para Excel
export const CAB_PREVIA = ['Número', 'Código', 'OM usuária', 'Serviço', 'Consumo', 'Unidade', 'Serviço (01)', 'Adiantamento (02)', 'Acréscimo (03)', 'Débito (04)', 'A pagar', 'Avisos'];
export function linhasPrevia(itens: ItemLote[]): any[][] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [CAB_PREVIA, ...itens.map(i => {
    const ad = (i.adiantamentos || []).reduce((s, a) => s + a.valor, 0);
    return [i.numero || '', i.om.codigo, i.om.nome, i.servico, i.quantidade ?? '', i.unidade, i.valor, ad, i.acrescimo, i.debito, r2(i.valor - ad + i.acrescimo - i.debito), i.avisos.join('; ')];
  })];
}
