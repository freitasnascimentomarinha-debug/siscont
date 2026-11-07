import { v4 as uuidv4 } from 'uuid';
import { DocumentType, OperationType, ReceivedDocument, Invoice, PaymentAllocation, Comando, OM, Setor } from '../types';
import { db } from './db';
import { cadastroService } from './cadastroService';
import { SolicitacaoAltcred } from '../utils/altcredSiplad';
import { FaturaCandidata, ItemProposta } from '../utils/baixaAssistida';
import { ehAdiantamento } from '../utils/baixas';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Cadastro { oms: OM[]; comandos: Comando[]; setores: Setor[] }

export async function carregarCadastro(): Promise<Cadastro> {
  try {
    const [oms, comandos, setores] = await Promise.all([cadastroService.listOMs(), cadastroService.listComandos(), cadastroService.listSetores()]);
    return { oms, comandos, setores };
  } catch {
    return { oms: [], comandos: [], setores: [] };
  }
}

/** Cliente pagador pela UG: comando com esse código ou, se não houver, a OM e o comando dela. */
export function clientePorUG(codigo: string | null | undefined, cad: Cadastro) {
  if (!codigo) return null;
  const setor = (id?: string | null) => (id && cad.setores.find(s => s.id === id)?.sigla) || '';
  const c = cad.comandos.find(x => x.codigo === codigo);
  if (c) return { comandoId: c.id, client: `${codigo} - ${c.sigla || c.nome}`, command: `${codigo} - ${c.nome}`, sector: setor(c.setorId) };
  const o = cad.oms.find(x => x.codigo === codigo && x.ativo) || cad.oms.find(x => x.codigo === codigo);
  if (!o) return null;
  const oc = o.comandoId ? cad.comandos.find(x => x.id === o.comandoId) : undefined;
  return {
    comandoId: oc?.id ?? null, client: `${codigo} - ${o.sigla || o.nome}`,
    command: oc ? `${oc.codigo ? oc.codigo + ' - ' : ''}${oc.nome}` : '', sector: setor(o.setorId || oc?.setorId),
  };
}

// ------------------------------------------------------------------ importação do PDF do SIPLAD
export type AcaoImportacao = 'NOVA' | 'COMPLETAR' | 'ESTORNO' | 'IGNORAR';
export interface ItemImportacao {
  sol: SolicitacaoAltcred;
  acao: AcaoImportacao;
  doc: ReceivedDocument; // documento a gravar (novo, existente completado, ou a ALTCRED de origem com o estorno)
  existente?: ReceivedDocument;
  avisos: string[];
}

const ehEstorno = (s: SolicitacaoAltcred) => /estorn|anula/i.test(`${s.tipoAlteracao} ${s.observacao}`);

export function planejarImportacaoSiplad(sols: SolicitacaoAltcred[], docs: ReceivedDocument[], cad: Cadastro): ItemImportacao[] {
  const porNumero = new Map(docs.map(d => [d.documentNumber.trim().toUpperCase(), d]));
  return sols.map(sol => {
    const avisos = [...sol.avisos];
    const detalhes: Partial<ReceivedDocument> = {
      exercicio: Number(sol.numero.split('.')[1]) || (sol.dataSituacao ? Number(sol.dataSituacao.slice(0, 4)) : null),
      dataCriacao: sol.dataCriacao, tipoAlteracao: sol.tipoAlteracao || null, situacaoSiplad: sol.situacao || null,
      ugCliente: sol.ugCliente || null, altcredOrigem: sol.altcredOrigem, observacaoSolicitante: sol.observacao || null,
      celulas: sol.celulas,
    };
    const existente = porNumero.get(sol.numero.toUpperCase());
    if (existente) {
      if (Math.abs(existente.totalValue - sol.valor) > 0.01 && !existente.valorEstornado) {
        avisos.push(`Valor no sistema R$ ${existente.totalValue.toFixed(2)} × no SIPLAD R$ ${sol.valor.toFixed(2)}; o valor do sistema foi mantido.`);
      }
      const destinacao = existente.destinacao?.length ? existente.destinacao : sol.faturasCitadas.map(n => ({ tipo: 'FATURA' as const, valor: n }));
      return { sol, acao: 'COMPLETAR', existente, avisos, doc: { ...existente, ...detalhes, destinacao, valorOriginal: existente.valorOriginal ?? sol.valor } };
    }
    const origem = sol.altcredOrigem ? porNumero.get(sol.altcredOrigem.toUpperCase()) : undefined;
    if (origem && ehEstorno(sol)) {
      const original = origem.valorOriginal ?? origem.totalValue;
      const estornado = r2((origem.valorEstornado || 0) + sol.valor);
      const novoTotal = r2(original - estornado);
      if (novoTotal < origem.totalValue - origem.availableValue - 0.005) {
        avisos.push(`O estorno deixa a ${origem.documentNumber} com R$ ${novoTotal.toFixed(2)}, menos do que já foi baixado (R$ ${(origem.totalValue - origem.availableValue).toFixed(2)}). Desfaça baixas antes.`);
      }
      return {
        sol, acao: 'ESTORNO', existente: origem, avisos,
        doc: {
          ...origem, valorOriginal: original, valorEstornado: estornado, totalValue: novoTotal,
          observation: [origem.observation, `Estorno de R$ ${sol.valor.toFixed(2)} pela ${sol.numero} (${sol.dataSituacao ?? ''}).`].filter(Boolean).join(' | '),
        },
      };
    }
    if (sol.altcredOrigem && !origem && ehEstorno(sol)) avisos.push(`ALTCRED de origem ${sol.altcredOrigem} não está no sistema: importada como documento separado.`);
    const cli = clientePorUG(sol.ugClienteCodigo, cad);
    if (!cli) avisos.push(`UG cliente ${sol.ugCliente || '(vazia)'} não encontrada no cadastro de comandos/OM.`);
    const adiant = /adiantament/i.test(sol.observacao);
    const destinacao = sol.faturasCitadas.map(n => ({ tipo: 'FATURA' as const, valor: n }));
    return {
      sol, acao: 'NOVA', avisos,
      doc: {
        id: uuidv4(), ug: sol.ugClienteCodigo || '', sector: cli?.sector || '', command: cli?.command || '', client: cli?.client || sol.ugCliente,
        documentNumber: sol.numero, documentType: DocumentType.ALTCRED, totalValue: sol.valor,
        date: sol.dataSituacao || sol.dataCriacao || new Date().toISOString().slice(0, 10),
        operation: adiant ? OperationType.ADIANTAMENTO : OperationType.PAGAMENTO,
        observation: sol.situacao && !/processad/i.test(sol.situacao) ? `Situação no SIPLAD: ${sol.situacao}` : '',
        comandoId: cli?.comandoId ?? null, availableValue: sol.valor, informedAdvance: adiant,
        ...detalhes, valorOriginal: sol.valor, valorEstornado: 0, destinacao,
        aguardando: !adiant && destinacao.length === 0, sobraAdiantamento: false,
      },
    };
  });
}

export async function gravarImportacaoSiplad(itens: ItemImportacao[]) {
  let n = 0;
  for (const i of itens) {
    if (i.acao === 'IGNORAR') continue;
    await db.saveDocument(i.doc);
    n++;
  }
  return n;
}

// ------------------------------------------------------------------ baixa assistida
/** Faturas em aberto com o saldo real (serviço + acréscimo − débito − adiantamentos − pagamentos). */
export function faturasCandidatas(invoices: Invoice[], docs: ReceivedDocument[], baixas: PaymentAllocation[], oms: OM[]): FaturaCandidata[] {
  const docPorId = new Map(docs.map(d => [d.id, d]));
  const usado = new Map<string, number>();
  baixas.forEach(b => { if (docPorId.has(b.documentId)) usado.set(b.invoiceId, (usado.get(b.invoiceId) || 0) + b.amount); });
  const comandoDaOm = new Map(oms.map(o => [o.id, o.comandoId ?? null]));
  return invoices
    .filter(i => !i.isCanceled && !i.quitacaoExterna)
    .map(i => ({
      id: i.id, numero: i.invoiceNumber, omId: i.omId ?? null, ug: i.ug || '', cliente: i.client, tipo: i.type,
      comandoId: i.omId ? comandoDaOm.get(i.omId) ?? null : null, vencimento: i.dueDate || '', contestada: !!i.contestada,
      saldo: r2(i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0) - (usado.get(i.id) || 0)),
    }))
    .filter(f => f.saldo > 0.005);
}

export async function gravarBaixaAssistida(doc: ReceivedDocument, itens: ItemProposta[], invoices: Invoice[], opcoes: { enviarSobra: boolean; data: string }) {
  const tipo = doc.operation === OperationType.ADIANTAMENTO ? 'ADIANTAMENTO' : 'PAGAMENTO';
  const tipoFatura = new Map(invoices.map(i => [i.id, i.type]));
  const usados = itens.filter(i => i.valor > 0.005);
  for (const i of usados) {
    await db.saveAllocation({
      id: uuidv4(), documentId: doc.id, invoiceId: i.faturaId, amount: r2(i.valor), date: opcoes.data,
      serviceType: tipoFatura.get(i.faturaId), siscontSettled: false, tipoBaixa: tipo,
      observation: `Baixa assistida${i.foraDestinacao ? ' (fora da destinação)' : ''}`,
    });
  }
  const sobra = r2(doc.availableValue - usados.reduce((s, i) => s + i.valor, 0));
  const precisaAtualizar = doc.aguardando || (opcoes.enviarSobra && sobra > 0.005 && tipo === 'PAGAMENTO');
  if (precisaAtualizar) {
    const marcarSobra = opcoes.enviarSobra && sobra > 0.005 && tipo === 'PAGAMENTO';
    await db.saveDocument({
      ...doc, aguardando: false,
      ...(marcarSobra ? {
        sobraAdiantamento: true,
        observation: [doc.observation, `SALDO DE R$ ${sobra.toFixed(2)} ENVIADO PARA ADIANTAMENTO em ${opcoes.data.split('-').reverse().join('/')}`].filter(Boolean).join(' | '),
      } : {}),
    });
  }
  return { baixas: usados.length, sobra };
}

/** Situação da baixa: usada para o rótulo "PAGO / FALTA PAGAR / PAGO A MAIOR" do extrato e das listas. */
export const situacaoPagamento = (total: number, baixado: number) =>
  baixado > total + 0.01 ? 'PAGO A MAIOR' : baixado >= total - 0.01 ? 'PAGO' : 'FALTA PAGAR';

export { ehAdiantamento };
