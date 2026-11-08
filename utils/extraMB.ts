/**
 * Extra-Marinha (clientes de fora da MB: bancos, empresas...). Contas da página dedicada, sem regra nova:
 * usa o saldo a pagar já calculado de cada fatura e as baixas das GRU, como o resto do sistema.
 */
const r2 = (n: number) => Math.round(n * 100) / 100;
const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);
export const brlEx = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

export interface FaturaEx {
  id: string; numero: string; omId?: string | null; cliente: string; tipo: string; ano: number; mes: number;
  emissao: string; vencimento: string; valor: number; pago: number; saldo: number;
  cancelada: boolean; contestada: boolean; enviadaEm?: string | null;
  /** GRU que pagaram a fatura */
  grus: string[];
}
export interface GruEx {
  id: string; numero: string; autenticacao?: string | null; dataPagamento: string; cliente: string; omId?: string | null;
  valor: number; disponivel: number;
  faturas: { numero: string; valor: number; cancelada: boolean }[];
}
export type SituacaoEx = 'paga' | 'vencida' | 'a vencer' | 'contestada' | 'cancelada';

export function situacaoEx(f: FaturaEx, hoje: string): SituacaoEx {
  if (f.cancelada) return 'cancelada';
  if (f.saldo <= 0.005) return 'paga';
  if (f.contestada) return 'contestada';
  return f.vencimento && f.vencimento < hoje ? 'vencida' : 'a vencer';
}
export const atrasoEx = (f: FaturaEx, hoje: string) => (situacaoEx(f, hoje) === 'vencida' ? diasEntre(f.vencimento, hoje) : 0);

export interface LinhaResumoEx {
  chave: string; cliente: string; omId?: string | null;
  faturado: number; recebido: number; emAberto: number; vencido: number; aVencer: number; contestado: number;
  creditoGru: number; ultimaGru: string; qtdAbertas: number; maisAntiga: string;
}

/**
 * Resumo por cliente no exercício: faturado (competência do ano, sem canceladas), recebido (GRU pagas no ano),
 * em aberto (qualquer exercício; contestadas à parte), crédito das GRU com saldo e a última GRU.
 */
export function resumoExtraMB(fats: FaturaEx[], grus: GruEx[], ano: number, hoje: string) {
  const m = new Map<string, LinhaResumoEx>();
  const chaveDe = (omId: string | null | undefined, cliente: string) => omId || `n:${cliente.toLowerCase()}`;
  const linha = (omId: string | null | undefined, cliente: string) => {
    const k = chaveDe(omId, cliente);
    let l = m.get(k);
    if (!l) { l = { chave: k, cliente, omId, faturado: 0, recebido: 0, emAberto: 0, vencido: 0, aVencer: 0, contestado: 0, creditoGru: 0, ultimaGru: '', qtdAbertas: 0, maisAntiga: '' }; m.set(k, l); }
    return l;
  };
  fats.forEach(f => {
    if (f.cancelada) return;
    const l = linha(f.omId, f.cliente);
    if (f.ano === ano) l.faturado += f.valor;
    const s = situacaoEx(f, hoje);
    if (s === 'contestada') l.contestado += f.saldo;
    else if (s === 'vencida' || s === 'a vencer') {
      l.emAberto += f.saldo; l.qtdAbertas++;
      if (s === 'vencida') { l.vencido += f.saldo; if (!l.maisAntiga || f.vencimento < l.maisAntiga) l.maisAntiga = f.vencimento; } else l.aVencer += f.saldo;
    }
  });
  grus.forEach(g => {
    const l = linha(g.omId, g.cliente);
    if ((g.dataPagamento || '').startsWith(String(ano))) l.recebido += g.valor;
    l.creditoGru += g.disponivel;
    if (g.dataPagamento > l.ultimaGru) l.ultimaGru = g.dataPagamento;
  });
  const linhas = [...m.values()].map(l => ({ ...l, faturado: r2(l.faturado), recebido: r2(l.recebido), emAberto: r2(l.emAberto), vencido: r2(l.vencido), aVencer: r2(l.aVencer), contestado: r2(l.contestado), creditoGru: r2(l.creditoGru) }))
    .sort((a, b) => b.emAberto - a.emAberto || b.faturado - a.faturado || a.cliente.localeCompare(b.cliente, 'pt-BR'));
  const soma = (k: keyof LinhaResumoEx) => r2(linhas.reduce((s, l) => s + (l[k] as number), 0));
  return { linhas, total: { faturado: soma('faturado'), recebido: soma('recebido'), emAberto: soma('emAberto'), vencido: soma('vencido'), aVencer: soma('aVencer'), contestado: soma('contestado'), creditoGru: soma('creditoGru') } };
}

/** GRU que pedem atenção: saldo sem fatura vinculada, ou baixa em fatura cancelada (o valor voltou para a GRU). */
export function alertaGru(g: GruEx): string {
  const canc = g.faturas.filter(f => f.cancelada);
  if (canc.length) return `paga fatura cancelada (${canc.map(f => f.numero).join(', ')}): valor voltou para a GRU`;
  if (g.disponivel > 0.005 && !g.faturas.length) return 'sem fatura vinculada';
  if (g.disponivel > 0.005) return `saldo de ${brlEx(g.disponivel)} sem fatura`;
  return '';
}

// ------------------------------------------------------------------ e-mail de envio das faturas
/** Texto padrão da BNIC para o envio das faturas e GRU (modelo do usuário). */
export const TEXTO_EMAIL_ENVIO = [
  'Prezado Sr (a) Gerente,',
  '',
  'Encaminho a Vossa Senhoria as faturas em anexo e suas respectivas Guias de Recolhimento da União (GRU) que deverão ser quitadas de acordo com as orientações contidas nos próprios documentos.',
  '',
  'Após a quitação solicito que os respectivos comprovantes sejam encaminhados para esta caixa postal a fim de ser dado baixa em nosso sistema.',
  '',
  'Solicito confirmar o recebimento deste e-mail',
].join('\n');

export function emailEnvio(cliente: string, faturas: FaturaEx[], o: { incluirLista: boolean }) {
  const ord = [...faturas].sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero.localeCompare(b.numero));
  const comps = [...new Set(ord.map(f => `${String(f.mes).padStart(2, '0')}/${f.ano}`))];
  const assunto = `Faturas BNIC — ${cliente}${comps.length ? ` — competência ${comps.join(', ')}` : ''}`;
  const lista = o.incluirLista && ord.length ? [
    '', '', 'Faturas encaminhadas:',
    ...ord.map(f => `- ${f.numero} · ${f.tipo} · competência ${String(f.mes).padStart(2, '0')}/${f.ano} · vencimento ${dataBr(f.vencimento)} · ${brlEx(f.saldo > 0.005 ? f.saldo : f.valor)}`),
    `Total: ${brlEx(r2(ord.reduce((s, f) => s + (f.saldo > 0.005 ? f.saldo : f.valor), 0)))}`,
  ] : [];
  return { assunto, texto: [TEXTO_EMAIL_ENVIO, ...lista].join('\n') };
}
