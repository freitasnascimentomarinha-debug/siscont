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

// ------------------------------------------------------------------ contratos (Etapa 3)
export interface ContratoEx {
  id: string; omId: string; numero: string; objeto?: string | null; servico?: string | null;
  inicio?: string | null; fim?: string | null; valorMensal?: number | null;
  indiceReajuste?: string | null; mesReajuste?: number | null; observacao?: string | null; ativo: boolean;
  /** fiscal responsável pelo contrato */
  fiscalNome?: string | null; fiscalSetor?: string | null; fiscalEmail?: string | null; fiscalTelefone?: string | null;
}
/** "Fiscal: CC Fulano (SEC-1) · fulano@marinha.mil.br · (21) 2126-0000" */
export const fiscalTexto = (c: ContratoEx) => {
  const p = [c.fiscalNome ? `${c.fiscalNome}${c.fiscalSetor ? ` (${c.fiscalSetor})` : ''}` : c.fiscalSetor || '', c.fiscalEmail || '', c.fiscalTelefone || ''].filter(Boolean);
  return p.length ? `Fiscal: ${p.join(' · ')}` : '';
};
export type GravidadeEx = 'alta' | 'media' | 'baixa';
export interface AlertaEx { gravidade: GravidadeEx; tipo: string; cliente: string; referencia: string; mensagem: string }
const MESES_EX = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const siglaFatura = (numero: string) => (numero.split('-')[1] || '').toUpperCase();
const chaveComp = (ano: number, mes: number) => ano * 12 + (mes - 1);
const compTexto = (k: number) => `${String((k % 12) + 1).padStart(2, '0')}/${Math.floor(k / 12)}`;

/**
 * Alertas dos contratos Extra-MB:
 *  - vencido (alta) / vencendo em até `diasAviso` dias (média);
 *  - reajuste neste mês ou no próximo (baixa);
 *  - valor da última fatura do serviço diferente do valor mensal do contrato (média);
 *  - contrato vigente sem fatura do serviço na última competência faturada para a Extra-MB (média).
 */
export function alertasContratos(contratos: ContratoEx[], fats: FaturaEx[], nomeOM: (id: string) => string, hoje: string, diasAviso = 60): AlertaEx[] {
  const out: AlertaEx[] = [];
  const ativas = fats.filter(f => !f.cancelada && f.ano && f.mes);
  const ultimaComp = ativas.reduce((m, f) => Math.max(m, chaveComp(f.ano, f.mes)), -1);
  const mesHoje = Number(hoje.slice(5, 7));
  contratos.filter(c => c.ativo).forEach(c => {
    const cliente = nomeOM(c.omId);
    const ref = `Contrato ${c.numero}${c.objeto ? ` (${c.objeto})` : ''}`;
    const fiscal = fiscalTexto(c) ? ` ${fiscalTexto(c)}.` : '';
    if (c.fim && c.fim < hoje) out.push({ gravidade: 'alta', tipo: 'Contrato vencido', cliente, referencia: ref, mensagem: `Vigência terminou em ${dataBr(c.fim)}. Renove (atualize a data) ou desative o contrato.${fiscal}` });
    else if (c.fim && diasEntre(hoje, c.fim) <= diasAviso) out.push({ gravidade: 'media', tipo: 'Contrato vencendo', cliente, referencia: ref, mensagem: `Vence em ${dataBr(c.fim)} (${diasEntre(hoje, c.fim)} dias).${fiscal}` });
    if (c.mesReajuste && (c.mesReajuste === mesHoje || c.mesReajuste === (mesHoje % 12) + 1)) {
      out.push({ gravidade: 'baixa', tipo: 'Reajuste', cliente, referencia: ref, mensagem: `Reajuste${c.indiceReajuste ? ` pelo ${c.indiceReajuste}` : ''} em ${MESES_EX[c.mesReajuste - 1]}: atualize o valor mensal do contrato e o preço do faturamento.${fiscal}` });
    }
    const doServico = ativas.filter(f => f.omId === c.omId && (!c.servico || siglaFatura(f.numero) === c.servico.toUpperCase()));
    if (c.valorMensal && doServico.length) {
      const ult = doServico.reduce((m, f) => Math.max(m, chaveComp(f.ano, f.mes)), -1);
      const valores = doServico.filter(f => chaveComp(f.ano, f.mes) === ult).map(f => f.valor);
      if (!valores.some(v => Math.abs(v - c.valorMensal!) < 0.01)) {
        out.push({ gravidade: 'media', tipo: 'Valor diferente do contrato', cliente, referencia: ref, mensagem: `Competência ${compTexto(ult)}: faturado ${valores.map(brlEx).join(' / ')}; o contrato prevê ${brlEx(c.valorMensal)} por mês.` });
      }
    }
    if (ultimaComp >= 0) {
      const ini = c.inicio ? chaveComp(Number(c.inicio.slice(0, 4)), Number(c.inicio.slice(5, 7))) : -Infinity;
      const fimK = c.fim ? chaveComp(Number(c.fim.slice(0, 4)), Number(c.fim.slice(5, 7))) : Infinity;
      if (ultimaComp >= ini && ultimaComp <= fimK && !doServico.some(f => chaveComp(f.ano, f.mes) === ultimaComp)) {
        out.push({ gravidade: 'media', tipo: 'Sem fatura na competência', cliente, referencia: ref, mensagem: `Contrato vigente sem fatura${c.servico ? ` de ${c.servico}` : ''} na competência ${compTexto(ultimaComp)} (última faturada para a Extra-MB).` });
      }
    }
  });
  const peso = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => peso[a.gravidade] - peso[b.gravidade] || a.cliente.localeCompare(b.cliente, 'pt-BR'));
}

/** Alertas das GRU no mesmo formato (para a lista única de pendências da Extra-MB). */
export const alertasGru = (grus: GruEx[]): AlertaEx[] => grus.map(g => ({ g, m: alertaGru(g) })).filter(x => x.m).map(({ g, m }) => ({
  gravidade: (g.faturas.some(f => f.cancelada) ? 'alta' : 'media') as GravidadeEx, tipo: 'GRU', cliente: g.cliente, referencia: `${g.numero} (${dataBr(g.dataPagamento)}, ${brlEx(g.valor)})`, mensagem: m,
}));
