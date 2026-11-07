/**
 * Fase 4 — regras puras de versão ("cancela e substitui"), contestação e correção por atraso (OI 40-04, 6.1/6.2).
 */
const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ versões
const RE = /^(.*-)(\d)$/;
/** 40032-DA-08-2026-010-0 → 40032-DA-08-2026-010-1 (pula versões que já existem). */
export function proximaVersao(numero: string, existentes: Iterable<string> = []): string {
  const m = numero.trim().match(RE);
  if (!m) throw new Error(`Número ${numero} sem versão no final (…-0).`);
  const usados = new Set([...existentes].map(n => n.trim().toUpperCase()));
  let v = Number(m[2]) + 1;
  while (usados.has(`${m[1]}${v}`.toUpperCase())) v++;
  if (v > 9) throw new Error('Limite de versões (9) atingido para esta fatura.');
  return `${m[1]}${v}`;
}

// ------------------------------------------------------------------ contestação
export type StatusContestacao = 'ABERTA' | 'ENCAMINHADA' | 'RESPONDIDA' | 'ENCERRADA';
export type Decisao = 'RATIFICADA' | 'RETIFICADA' | 'CANCELADA';
export interface EventoContestacao { em: string; por: string; acao: string; texto?: string }
export interface Contestacao {
  id: string; invoiceId: string; numeroFatura: string; abertaEm: string; origem: string; justificativa: string;
  setorMedidor?: string | null; encaminhadaEm?: string | null; prazo?: string | null; resposta?: string | null; respondidaEm?: string | null;
  decisao?: Decisao | null; decididaEm?: string | null; novaFatura?: string | null; status: StatusContestacao;
  anexos: { nome: string; referencia?: string }[]; historico: EventoContestacao[]; abertaPor?: string | null;
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000);

/** Quanto tempo está parada e se passou do prazo do setor medidor (D7: contestação sem resposta por meses). */
export function situacaoContestacao(c: Contestacao, hoje: string) {
  const ultimo = c.historico.length ? c.historico[c.historico.length - 1].em : c.abertaEm;
  const aberta = c.status !== 'ENCERRADA';
  return {
    aberta,
    diasAberta: aberta ? diasEntre(c.abertaEm, hoje) : diasEntre(c.abertaEm, c.decididaEm || hoje),
    diasParada: aberta ? diasEntre(ultimo, hoje) : 0,
    prazoVencido: aberta && c.status === 'ENCAMINHADA' && !!c.prazo && c.prazo < hoje,
    proximoPasso: c.status === 'ABERTA' ? 'Encaminhar ao setor medidor' : c.status === 'ENCAMINHADA' ? 'Registrar a resposta do setor' : c.status === 'RESPONDIDA' ? 'Decidir: ratificar, retificar ou cancelar' : '—',
  };
}

export const evento = (por: string, acao: string, texto?: string, em = new Date().toISOString().slice(0, 10)): EventoContestacao => ({ em, por, acao, texto });

// ------------------------------------------------------------------ correção por atraso (OI 6.2)
/**
 * Fator de correção entre duas datas (exclusive início, inclusive fim): a cada dia aplica a taxa diária
 * equivalente à taxa mensal da poupança do mês daquele dia: (1 + i)^(1/base) − 1.
 */
export function fatorCorrecao(inicio: string, fim: string, taxas: Map<string, number>, base = 30) {
  let fator = 1, dias = 0;
  const semTaxa = new Set<string>();
  const d = new Date(`${inicio.slice(0, 10)}T00:00:00Z`);
  const f = new Date(`${fim.slice(0, 10)}T00:00:00Z`);
  while (d < f) {
    d.setUTCDate(d.getUTCDate() + 1);
    const mes = d.toISOString().slice(0, 7);
    const t = taxas.get(mes);
    if (t === undefined) { semTaxa.add(mes); }
    else fator *= Math.pow(1 + t / 100, 1 / base);
    dias++;
  }
  return { fator, dias, semTaxa: [...semTaxa] };
}

export interface PagamentoTardio { data: string; valor: number }
export interface Correcao {
  dataLimite: string; pagamentos: (PagamentoTardio & { dias: number; fator: number; correcao: number })[];
  total: number; diasMax: number; semTaxa: string[];
}

/**
 * Correção de uma fatura: só os pagamentos feitos DEPOIS da data-limite (dentro dos 10 dias úteis é proibido
 * corrigir, OI 6.1); cada um é corrigido da data-limite até a sua data.
 */
export function calcularCorrecao(dataLimite: string, pagamentos: PagamentoTardio[], taxas: Map<string, number>, base = 30): Correcao {
  const semTaxa = new Set<string>();
  const lista = pagamentos.filter(p => p.valor > 0 && p.data.slice(0, 10) > dataLimite.slice(0, 10)).map(p => {
    const f = fatorCorrecao(dataLimite, p.data, taxas, base);
    f.semTaxa.forEach(m => semTaxa.add(m));
    return { ...p, dias: f.dias, fator: f.fator, correcao: r2(p.valor * (f.fator - 1)) };
  });
  return { dataLimite, pagamentos: lista, total: r2(lista.reduce((s, p) => s + p.correcao, 0)), diasMax: Math.max(0, ...lista.map(p => p.dias)), semTaxa: [...semTaxa].sort() };
}
