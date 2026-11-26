import { saldoDisponivelDoc } from './baixas';

const r2 = (n: number) => Math.round(n * 100) / 100;

interface FaturaBase { id: string; invoiceNumber: string; value: number; adjustmentAddition?: number; adjustmentDeduction?: number; isCanceled?: boolean }
interface BaixaBase { invoiceId: string; documentId: string; amount: number }
interface DocBase { id: string; documentNumber: string; operation: string; totalValue: number; pendencia?: string | null }

/**
 * Confere, com as baixas que já estão gravadas no banco (leitura nova, não a da tela), se as baixas que
 * vão ser gravadas cabem no saldo de cada fatura e no saldo da ALTCRED. Devolve as mensagens de erro
 * (lista vazia = pode gravar). Impede, por exemplo, o mesmo "Gravar baixas" disparado duas vezes.
 */
export function conferirNovasBaixas(args: {
  doc: DocBase; itens: { faturaId: string; valor: number }[]; faturas: FaturaBase[]; baixasAtuais: BaixaBase[];
}): string[] {
  const { doc, itens, faturas, baixasAtuais } = args;
  const erros: string[] = [];
  const usadoFatura = new Map<string, number>(), usadoDoc = new Map<string, number>();
  baixasAtuais.forEach(b => {
    usadoFatura.set(b.invoiceId, (usadoFatura.get(b.invoiceId) || 0) + b.amount);
    usadoDoc.set(b.documentId, (usadoDoc.get(b.documentId) || 0) + b.amount);
  });
  const porFatura = new Map<string, number>();
  itens.filter(i => i.valor > 0.005).forEach(i => porFatura.set(i.faturaId, (porFatura.get(i.faturaId) || 0) + i.valor));
  porFatura.forEach((valor, id) => {
    const f = faturas.find(x => x.id === id);
    if (!f) { erros.push('Uma das faturas não foi encontrada. Atualize a tela e tente de novo.'); return; }
    const saldo = r2(f.value + (f.adjustmentAddition || 0) - (f.adjustmentDeduction || 0) - (usadoFatura.get(id) || 0));
    if (valor > saldo + 0.005) erros.push(`A fatura ${f.invoiceNumber} já tem baixa gravada: o saldo dela agora é R$ ${saldo.toFixed(2).replace('.', ',')} e a baixa pedida é de R$ ${r2(valor).toFixed(2).replace('.', ',')}. Atualize a tela (F5) antes de baixar de novo.`);
  });
  const total = r2([...porFatura.values()].reduce((s, v) => s + v, 0));
  const disponivel = saldoDisponivelDoc(doc, usadoDoc.get(doc.id) || 0);
  if (total > disponivel + 0.005) erros.push(`A ${doc.documentNumber} só tem R$ ${disponivel.toFixed(2).replace('.', ',')} disponíveis (já foram gravadas outras baixas) e a baixa pedida é de R$ ${total.toFixed(2).replace('.', ',')}. Atualize a tela (F5) antes de baixar de novo.`);
  return erros;
}

const emAndamento = new Set<string>();
/** Só deixa uma gravação por chave (ex.: a ALTCRED) rodar por vez; um segundo clique/chamada igual é recusado na hora. */
export async function executarUmaVez<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  if (emAndamento.has(chave)) throw new Error('Essas baixas já estão sendo gravadas. Aguarde terminar.');
  emAndamento.add(chave);
  try { return await fn(); } finally { emAndamento.delete(chave); }
}
