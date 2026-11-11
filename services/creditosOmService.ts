import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';
import { MovCredito, TipoMovCredito, chaveAcerto, creditosDaOm, estornaveisManuais, planejarUso } from '../utils/creditosOm';

const r2 = (n: number) => Math.round(n * 100) / 100;

export class Fase33NaoInstaladaError extends Error {
  constructor() { super('Falta executar o script supabase/migrations/033_creditos_om.sql no Supabase (livro de créditos por OM).'); }
}
const traduzir = (error: any): never => {
  const msg = String(error?.message || '');
  if (/creditos_om/.test(msg) && /does not exist|Could not find|schema cache/i.test(msg)) throw new Fase33NaoInstaladaError();
  if (/Saldo de crédito insuficiente|não tem saldo suficiente/.test(msg)) throw new Error('O saldo de crédito da OM mudou ou não é suficiente (outra emissão ao mesmo tempo, ou o crédito já foi usado). Recalcule a prévia e tente de novo.');
  if (/duplicate key/.test(msg)) throw new Error('Este movimento de crédito já foi registrado.');
  throw error;
};

const deLinha = (r: any): MovCredito => ({
  id: r.id, omId: r.om_id, data: String(r.data).slice(0, 10), tipo: r.tipo, valor: Number(r.valor),
  servicoOrigem: r.servico_origem, exercicioOrigem: r.exercicio_origem, origemNumero: r.origem_numero, origemChave: r.origem_chave,
  destinoNumero: r.destino_numero, destinoId: r.destino_id, creditoRef: r.credito_ref, estornoDe: r.estorno_de,
  documento: r.documento, observacao: r.observacao, loteId: r.lote_id, saldoAnterior: r.saldo_anterior != null ? Number(r.saldo_anterior) : null,
  saldoPosterior: r.saldo_posterior != null ? Number(r.saldo_posterior) : null, criadoPorNome: r.criado_por_nome, criadoEm: r.criado_em,
});
const paraLinha = (m: Partial<MovCredito> & { omId: string; tipo: TipoMovCredito; valor: number }) => ({
  id: m.id || uuidv4(), om_id: m.omId, data: m.data, tipo: m.tipo, valor: r2(m.valor), servico_origem: m.servicoOrigem ?? null, exercicio_origem: m.exercicioOrigem ?? null,
  origem_numero: m.origemNumero ?? null, origem_chave: m.origemChave ?? null, destino_numero: m.destinoNumero ?? null, destino_id: m.destinoId ?? null,
  credito_ref: m.creditoRef ?? null, estorno_de: m.estornoDe ?? null, documento: m.documento?.trim() || null, observacao: m.observacao?.trim() || null, lote_id: m.loteId ?? null,
});

/** O livro inteiro (sem o script 033 devolve vazio e `instalado = false`). */
export async function listarLivroCreditos(): Promise<{ movs: MovCredito[]; instalado: boolean }> {
  const out: MovCredito[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from('creditos_om').select('*').order('criado_em', { ascending: true }).range(off, off + 999);
    if (error) return { movs: [], instalado: false };
    out.push(...(data || []).map(deLinha));
    if (!data || data.length < 1000) break;
  }
  return { movs: out, instalado: true };
}

const inserir = async (linhas: ReturnType<typeof paraLinha>[]) => {
  if (!linhas.length) return;
  const { error } = await supabase.from('creditos_om').insert(linhas);
  if (error) traduzir(error);
};

/** Utilização do crédito nas faturas do lote (já gravadas): uma linha por pedaço de crédito. Falha se o saldo mudou. */
export async function registrarUsosDoLote(itens: { omId: string; numero: string; faturaId: string; creditos: { chave: string; valor: number }[] }[], loteId: string, data: string) {
  await inserir(itens.flatMap(i => i.creditos.map(c => paraLinha({
    omId: i.omId, tipo: 'UTILIZACAO', valor: -c.valor, data, creditoRef: c.chave, destinoNumero: i.numero, destinoId: i.faturaId, loteId, observacao: 'Compensação automática no lote',
  }))));
}

/** Crédito gerado pelas faturas de acerto do lote (real menor que o estimado). Um acerto gera um crédito só. */
export async function registrarEntradasDeAcerto(itens: { omId: string; numero: string; sigla: string; credito: number; exercicio: number }[], loteId: string, data: string) {
  await inserir(itens.filter(i => i.credito > 0.004).map(i => paraLinha({
    omId: i.omId, tipo: 'ENTRADA_ACERTO', valor: i.credito, data, servicoOrigem: i.sigla, exercicioOrigem: i.exercicio, origemNumero: i.numero, origemChave: chaveAcerto(i.numero), loteId,
  })));
}

/** Devolução do crédito à OM (ALTCRED/GRU), do mais antigo para o mais novo. */
export async function registrarDevolucao(omId: string, valor: number, data: string, documento: string, observacao?: string) {
  const { movs } = await listarLivroCreditos();
  const pedacos = planejarUso(creditosDaOm(movs, omId), valor);
  if (r2(pedacos.reduce((s, p) => s + p.valor, 0)) + 0.004 < valor) throw new Error('O valor passa do saldo de crédito da OM.');
  await inserir(pedacos.map(p => paraLinha({ omId, tipo: 'DEVOLUCAO', valor: -p.valor, data, creditoRef: p.entradaId, documento, observacao })));
}

/** Saldo de abertura (crédito de acertos anteriores ao SISCONT). Só o administrador. */
export async function lancarAbertura(a: { omId: string; valor: number; data: string; exercicio?: number | null; servico?: string | null; documento: string; observacao?: string }) {
  await inserir([paraLinha({ omId: a.omId, tipo: 'ABERTURA', valor: a.valor, data: a.data, exercicioOrigem: a.exercicio ?? null, servicoOrigem: a.servico ?? null, documento: a.documento, observacao: a.observacao })]);
}

/** Estorno de um lançamento manual (devolução ou saldo de abertura). */
export async function estornarMovimento(mov: MovCredito, data: string, observacao: string) {
  const { movs } = await listarLivroCreditos();
  if (!estornaveisManuais(movs, mov.omId).some(m => m.id === mov.id)) throw new Error('Este movimento já foi estornado.');
  await inserir([paraLinha({ omId: mov.omId, tipo: 'ESTORNO', valor: -mov.valor, data, creditoRef: mov.creditoRef ?? mov.id, estornoDe: mov.id, observacao })]);
}

/**
 * Fatura cancelada: o crédito que ela usou volta ao livro (estorno) e, se ela for um acerto, o crédito que gerou é estornado
 * (recusado se já foi usado). Chamar ANTES de cancelar: se falhar, a fatura não é cancelada.
 */
export async function estornarPorCancelamentoDeFatura(numero: string, omId: string | null | undefined, data: string) {
  const { movs, instalado } = await listarLivroCreditos();
  if (!instalado || !omId) return;
  const jaEstornados = new Set(movs.filter(m => m.tipo === 'ESTORNO').map(m => m.estornoDe));
  const usos = movs.filter(m => m.tipo === 'UTILIZACAO' && chaveAcerto(m.destinoNumero || '') === chaveAcerto(numero) && !jaEstornados.has(m.id));
  const entrada = movs.find(m => m.tipo === 'ENTRADA_ACERTO' && m.origemChave === chaveAcerto(numero) && !jaEstornados.has(m.id));
  const linhas = usos.map(u => paraLinha({ omId: u.omId, tipo: 'ESTORNO', valor: -u.valor, data, creditoRef: u.creditoRef!, estornoDe: u.id, destinoNumero: u.destinoNumero, observacao: `Fatura ${numero} cancelada: crédito devolvido à OM` }));
  if (entrada) linhas.push(paraLinha({ omId: entrada.omId, tipo: 'ESTORNO', valor: -entrada.valor, data, creditoRef: entrada.id, estornoDe: entrada.id, observacao: `Acerto ${numero} cancelado: crédito estornado` }));
  try { await inserir(linhas); }
  catch (e: any) {
    if (entrada && /saldo|já foi usado/i.test(String(e?.message))) throw new Error('Este acerto gerou um crédito que já foi utilizado ou devolvido. Estorne primeiro as faturas que o usaram (cancelando-as) ou a devolução.');
    throw e;
  }
}

/** Desfaz o que um lote gravou no livro quando a emissão falha depois (estorno, pois o livro não apaga). */
export async function estornarLote(loteId: string, data: string) {
  const { movs } = await listarLivroCreditos();
  const jaEstornados = new Set(movs.filter(m => m.tipo === 'ESTORNO').map(m => m.estornoDe));
  const dele = movs.filter(m => m.loteId === loteId && (m.tipo === 'UTILIZACAO' || m.tipo === 'ENTRADA_ACERTO') && !jaEstornados.has(m.id));
  await inserir(dele.filter(m => m.tipo === 'UTILIZACAO').concat(dele.filter(m => m.tipo === 'ENTRADA_ACERTO')).map(m => paraLinha({
    omId: m.omId, tipo: 'ESTORNO', valor: -m.valor, data, creditoRef: m.creditoRef ?? m.id, estornoDe: m.id, destinoNumero: m.destinoNumero, observacao: 'Emissão do lote desfeita',
  })));
}
