/**
 * Crédito da OM gerado pelo acerto do OND (funções puras).
 *
 * Modelo: a fatura de acerto traz o CONSUMO REAL (valor do serviço) e abate, na linha 04, o valor ESTIMADO já faturado.
 *   estimado 100.000 · real 80.000 → fatura de acerto: serviço 80.000 − débito 100.000 = −20.000 → CRÉDITO da OM de 20.000.
 *   estimado 100.000 · real 120.000 → serviço 120.000 − débito 100.000 = +20.000 → a pagar.
 * O crédito é derivado das próprias faturas (acerto não cancelado com total negativo): retificar ou cancelar a fatura de
 * acerto acompanha o crédito sozinho. Só o que foi USADO (compensado ou devolvido) fica gravado, na tabela
 * creditos_acerto_uso (script 028).
 *
 * Compensação: o crédito abate as faturas seguintes da MESMA OM e do MESMO serviço (a água estimada compensa água),
 * da mais antiga para a mais nova, na linha 04 (débito) da fatura nova — com a observação "Compensação do crédito do
 * acerto nº ...". Não se aplica a lote OND (estimado) nem a acerto/correção.
 */
import { Invoice } from '../types';
import type { ItemLote } from './faturamento';

const r2 = (n: number) => Math.round(n * 100) / 100;
export type TipoUsoCredito = 'COMPENSACAO' | 'DEVOLUCAO';

export interface UsoCredito {
  id?: string; chave: string; tipo: TipoUsoCredito; valor: number; data: string;
  faturaId?: string | null; faturaNumero?: string | null; documento?: string | null; observacao?: string | null; loteId?: string | null; criadoPor?: string | null;
}
export interface CreditoAcerto {
  chave: string; numero: string; original: string; faturaId: string; omId: string | null; cliente: string; servico: string; emissao: string;
  valor: number; compensado: number; devolvido: number; saldo: number; usos: UsoCredito[];
}

/** Número sem a versão final ("-0", "-1"): a retificação mantém o mesmo crédito. */
export const chaveCredito = (numero: string) => String(numero || '').replace(/-\d$/, '');
const totalDe = (i: Invoice) => r2(i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0));
export const ehAcerto = (i: Invoice) => !!i.acertoDe && (i.baseCalculo as any)?.tipo !== 'CORRECAO';

/** Créditos de acerto (um por fatura de acerto vigente com total negativo), com o que já foi usado. */
export function calcularCreditos(invoices: Invoice[], usos: UsoCredito[]): CreditoAcerto[] {
  const vigentes = new Map<string, Invoice>();
  invoices.filter(i => ehAcerto(i) && !i.isCanceled).forEach(i => {
    const k = chaveCredito(i.invoiceNumber), ant = vigentes.get(k);
    if (!ant || i.invoiceNumber > ant.invoiceNumber) vigentes.set(k, i);   // versão mais nova (-1) vale
  });
  // fatura onde o crédito foi compensado: se ela foi cancelada (e não substituída), a compensação deixa de valer
  const porChave = new Map<string, Invoice[]>();
  invoices.forEach(i => { const k = chaveCredito(i.invoiceNumber); porChave.set(k, [...(porChave.get(k) || []), i]); });
  const usoValido = (u: UsoCredito) => {
    if (u.tipo !== 'COMPENSACAO' || !u.faturaNumero) return true;
    const fs = porChave.get(chaveCredito(u.faturaNumero));
    return !fs || fs.some(f => !f.isCanceled);
  };
  const porCredito = new Map<string, UsoCredito[]>();
  usos.filter(usoValido).forEach(u => porCredito.set(u.chave, [...(porCredito.get(u.chave) || []), u]));

  return [...vigentes.values()].map(i => {
    const total = totalDe(i), valor = total < -0.005 ? r2(-total) : 0;
    const us = (porCredito.get(chaveCredito(i.invoiceNumber)) || []).sort((a, b) => a.data.localeCompare(b.data));
    const compensado = r2(us.filter(u => u.tipo === 'COMPENSACAO').reduce((s, u) => s + u.valor, 0));
    const devolvido = r2(us.filter(u => u.tipo === 'DEVOLUCAO').reduce((s, u) => s + u.valor, 0));
    return {
      chave: chaveCredito(i.invoiceNumber), numero: i.invoiceNumber, original: i.acertoDe!, faturaId: i.id, omId: i.omId ?? null, cliente: i.client,
      servico: (i.serviceAcronym || '').toUpperCase(), emissao: i.issueDate, valor, compensado, devolvido, saldo: Math.max(0, r2(valor - compensado - devolvido)), usos: us,
    };
  }).filter(c => c.valor > 0).sort((a, b) => a.emissao.localeCompare(b.emissao) || a.numero.localeCompare(b.numero));
}

/**
 * Abate os créditos de acerto nas faturas do lote (mesma OM e mesmo serviço, crédito mais antigo primeiro), pela linha 04.
 * Só mexe em item com valor a pagar; o que sobrar de crédito continua com a OM.
 */
export function aplicarCreditos(itens: ItemLote[], creditos: CreditoAcerto[]): ItemLote[] {
  const saldo = new Map(creditos.map(c => [c.chave, c.saldo]));
  const ordenados = [...creditos].sort((a, b) => a.emissao.localeCompare(b.emissao) || a.numero.localeCompare(b.numero));
  return itens.map(i => {
    const limpo = { ...i, creditos: [] as NonNullable<ItemLote['creditos']> };
    if (i.estimado || i.acertoDe) return limpo;
    let resta = r2(i.valor + i.acrescimo - i.debito);
    if (resta <= 0) return limpo;
    ordenados.forEach(c => {
      if (resta <= 0 || c.omId !== i.omId || c.servico !== i.sigla) return;
      const s = saldo.get(c.chave) || 0;
      if (s <= 0) return;
      const v = r2(Math.min(s, resta));
      limpo.creditos.push({ chave: c.chave, numero: c.numero, valor: v });
      saldo.set(c.chave, r2(s - v)); resta = r2(resta - v);
    });
    const usado = r2(limpo.creditos.reduce((s, x) => s + x.valor, 0));
    return usado ? { ...limpo, debito: r2(i.debito + usado), base: { ...i.base, creditos: limpo.creditos, creditoCompensado: usado } } : limpo;
  });
}

/** Quanto do valor da fatura é compensação de crédito (gravado na base de cálculo): não é "faturado a menos" para a média do OND. */
export const creditoCompensadoNaFatura = (i: Pick<Invoice, 'baseCalculo'>) =>
  r2((((i.baseCalculo as any)?.creditos || []) as { valor: number }[]).reduce((s, c) => s + (Number(c.valor) || 0), 0));

export const resumoCreditos = (cs: CreditoAcerto[]) => ({
  total: r2(cs.reduce((s, c) => s + c.valor, 0)), compensado: r2(cs.reduce((s, c) => s + c.compensado, 0)), devolvido: r2(cs.reduce((s, c) => s + c.devolvido, 0)),
  saldo: r2(cs.reduce((s, c) => s + c.saldo, 0)), abertos: cs.filter(c => c.saldo > 0.005).length,
});
