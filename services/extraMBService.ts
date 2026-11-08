/** Dados da Extra-Marinha (faturas, GRU, cadastro e contratos), usados pela página e pelos Pontos de Atenção. */
import { db } from './db';
import { cadastroService } from './cadastroService';
import { OM } from '../types';
import { criarClassificador } from '../utils/publico';
import { criarResolvedor } from '../utils/documentosOM';
import { AlertaEx, ContratoEx, FaturaEx, GruEx, alertasContratos, alertasGru } from '../utils/extraMB';
import { hojeISO } from '../utils/datas';

export interface DadosExtraMB { fats: FaturaEx[]; grus: GruEx[]; oms: OM[]; contratos: ContratoEx[]; semTabela: boolean }

export async function carregarExtraMB(): Promise<DadosExtraMB> {
  const [invs, docs, allocs, cad] = await Promise.all([db.getInvoices(), db.getDocuments(), db.getAllocations(), cadastroService.listOMs()]);
  const cls = criarClassificador(cad);
  const resolv = criarResolvedor(cad as any, [], []);
  const omPorId = new Map(cad.map(o => [o.id, o]));
  const docPorId = new Map(docs.map(d => [d.id, d]));
  const invPorId = new Map(invs.map(i => [i.id, i]));
  const grusDaFatura = new Map<string, string[]>();
  allocs.forEach(a => { const d = docPorId.get(a.documentId); if (d) grusDaFatura.set(a.invoiceId, [...(grusDaFatura.get(a.invoiceId) || []), d.documentNumber]); });
  const fats: FaturaEx[] = invs.filter(i => cls.faturaExtra(i)).map(i => ({
    id: i.id, numero: i.invoiceNumber, omId: i.omId, cliente: (i.omId && omPorId.get(i.omId)?.nome) || i.client, tipo: i.type || i.serviceAcronym || '—',
    ano: i.yearCompetence, mes: i.monthCompetence, emissao: i.issueDate, vencimento: i.dueDate,
    valor: Math.round((i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0)) * 100) / 100, pago: i.paidAmount || 0, saldo: i.saldoAPagar ?? 0,
    cancelada: !!i.isCanceled, contestada: !!i.contestada, enviadaEm: i.enviadaEm, grus: [...new Set(grusDaFatura.get(i.id) || [])],
  }));
  const grus: GruEx[] = docs.filter(d => cls.docExtra(d)).map(d => {
    const om = resolv.omDoDocumento(d);
    return {
      id: d.id, numero: d.documentNumber, autenticacao: d.gruAutenticacao, dataPagamento: d.gruDataPagamento || d.date, cliente: om?.nome || d.client, omId: om?.id ?? null,
      valor: d.totalValue, disponivel: d.availableValue,
      faturas: allocs.filter(a => a.documentId === d.id).map(a => ({ numero: invPorId.get(a.invoiceId)?.invoiceNumber || '(excluída)', valor: a.amount, cancelada: !!invPorId.get(a.invoiceId)?.isCanceled })),
    };
  }).sort((a, b) => b.dataPagamento.localeCompare(a.dataPagamento));
  let contratos: ContratoEx[] = []; let semTabela = false;
  try { contratos = await cadastroService.listContratos(); } catch { semTabela = true; }
  return { fats, grus, oms: cad, contratos, semTabela };
}

export function alertasExtraMB(d: DadosExtraMB, hoje = hojeISO()): AlertaEx[] {
  const nome = (id: string) => d.oms.find(o => o.id === id)?.nome || '(cliente excluído)';
  return [...alertasContratos(d.contratos, d.fats, nome, hoje), ...alertasGru(d.grus)];
}
