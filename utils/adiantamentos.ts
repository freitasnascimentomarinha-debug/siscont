/**
 * Adiantamentos (equivalente às abas ADIANTAMENTOS e RESUMO ADIANTAMENTO da planilha).
 *
 * Uma ALTCRED vira adiantamento inteira (operação ADIANTAMENTO) ou só pela sobra ("SALDO ENVIADO PARA
 * ADIANTAMENTO" de uma ALTCRED de pagamento). Para cada uma:
 *   enviado    = valor da ALTCRED (adiantamento) ou valor − pagamentos (sobra)
 *   utilizado  = soma das baixas do tipo ADIANTAMENTO (faturas que usaram o saldo)
 *   saldo      = enviado − utilizado  (disponível para as próximas faturas do cliente)
 * Baixas em faturas canceladas não contam (o valor volta para o saldo).
 */
import { ehAdiantamento } from './baixas';

export interface DocAdiant {
  id: string; documentNumber: string; client: string; sector: string; command: string; ug?: string; date: string;
  totalValue: number; operation: string; sobraAdiantamento?: boolean;
}
export interface BaixaAdiant { id: string; documentId: string; invoiceId: string; amount: number; date: string; tipoBaixa?: 'PAGAMENTO' | 'ADIANTAMENTO' | null }
export interface FaturaAdiant { id: string; invoiceNumber: string; client: string; type?: string; isCanceled?: boolean }

export interface UsoAdiantamento { baixaId: string; data: string; fatura: string; cliente: string; tipo?: string; valor: number }
export interface LinhaAdiantamento {
  docId: string; numero: string; comando: string; cliente: string; data: string; origem: 'ADIANTAMENTO' | 'SOBRA';
  valorAltcred: number; enviado: number; utilizado: number; saldo: number; usos: UsoAdiantamento[];
}
export interface GrupoCliente { comando: string; cliente: string; enviado: number; utilizado: number; saldo: number; linhas: LinhaAdiantamento[] }

const r2 = (n: number) => Math.round(n * 100) / 100;

export function listaAdiantamentos(docs: DocAdiant[], baixas: BaixaAdiant[], faturas: FaturaAdiant[]): LinhaAdiantamento[] {
  const fat = new Map(faturas.map(f => [f.id, f]));
  const porDoc = new Map<string, BaixaAdiant[]>();
  baixas.forEach(b => { const l = porDoc.get(b.documentId); if (l) l.push(b); else porDoc.set(b.documentId, [b]); });
  return docs
    .filter(d => d.operation === 'ADIANTAMENTO' || d.sobraAdiantamento)
    .map(d => {
      const vale = (porDoc.get(d.id) || []).filter(b => !fat.get(b.invoiceId)?.isCanceled);
      const adiant = vale.filter(b => ehAdiantamento(b, d));
      const pagos = r2(vale.filter(b => !ehAdiantamento(b, d)).reduce((s, b) => s + b.amount, 0));
      const origem = d.operation === 'ADIANTAMENTO' ? 'ADIANTAMENTO' as const : 'SOBRA' as const;
      const enviado = origem === 'ADIANTAMENTO' ? r2(d.totalValue) : r2(Math.max(0, d.totalValue - pagos));
      const utilizado = r2(adiant.reduce((s, b) => s + b.amount, 0));
      return {
        docId: d.id, numero: d.documentNumber, comando: d.sector || '—', cliente: d.client, data: d.date, origem,
        valorAltcred: r2(d.totalValue), enviado, utilizado, saldo: r2(enviado - utilizado),
        usos: adiant.map(b => {
          const f = fat.get(b.invoiceId);
          return { baixaId: b.id, data: b.date, fatura: f?.invoiceNumber ?? '(fatura excluída)', cliente: f?.client ?? '', tipo: f?.type, valor: r2(b.amount) };
        }).sort((a, b) => a.data.localeCompare(b.data) || a.fatura.localeCompare(b.fatura)),
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data) || a.numero.localeCompare(b.numero));
}

/** Resumo por comando e cliente (como a tabela dinâmica "SUM of SALDO" da planilha). */
export function resumoPorCliente(linhas: LinhaAdiantamento[]): GrupoCliente[] {
  const m = new Map<string, GrupoCliente>();
  linhas.forEach(l => {
    const k = `${l.comando}|${l.cliente}`;
    const g = m.get(k) || { comando: l.comando, cliente: l.cliente, enviado: 0, utilizado: 0, saldo: 0, linhas: [] };
    g.enviado = r2(g.enviado + l.enviado); g.utilizado = r2(g.utilizado + l.utilizado); g.saldo = r2(g.saldo + l.saldo);
    g.linhas.push(l);
    m.set(k, g);
  });
  return [...m.values()].sort((a, b) => a.comando.localeCompare(b.comando) || a.cliente.localeCompare(b.cliente));
}
