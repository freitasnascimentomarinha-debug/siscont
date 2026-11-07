/** Datas em AAAA-MM-DD, sem fuso (evita o dia "voltar" em UTC-3). */
const parse = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export const ehFimDeSemana = (iso: string) => { const w = parse(iso).getUTCDay(); return w === 0 || w === 6; };

/**
 * Soma N dias úteis a uma data (não conta a própria data), pulando sábados,
 * domingos e as datas informadas como feriado. Ex.: data-limite de certificação
 * no SIPLAD = emissão + 10 dias úteis (OI 40-04, item 6.1).
 */
export function somarDiasUteis(inicio: string, dias: number, feriados: Iterable<string> = []): string {
  const fer = new Set(feriados);
  const d = parse(inicio);
  let restantes = dias;
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = fmt(d);
    if (!ehFimDeSemana(iso) && !fer.has(iso)) restantes--;
  }
  return fmt(d);
}

export const formatarDataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

/** A própria data, se for dia útil; senão o próximo dia útil. */
export function proximoDiaUtil(iso: string, feriados: Iterable<string> = []): string {
  const fer = new Set(feriados);
  const d = parse(iso.slice(0, 10));
  while (ehFimDeSemana(fmt(d)) || fer.has(fmt(d))) d.setUTCDate(d.getUTCDate() + 1);
  return fmt(d);
}

export function somarDiasCorridos(iso: string, dias: number): string {
  const d = parse(iso.slice(0, 10));
  d.setUTCDate(d.getUTCDate() + dias);
  return fmt(d);
}

/**
 * Datas da fatura (são duas coisas diferentes):
 *  - certificação no SIPLAD: emissão + 10 dias úteis (OI 40-04, item 6.1), para todas as faturas;
 *  - vencimento (pagamento): emissão + 30 dias corridos, levado ao próximo dia útil se cair em fim de semana ou
 *    feriado. Exceção: faturas OND (estimado de fim de exercício) vencem na data-limite de certificação.
 */
export function datasDaFatura(emissao: string, opcoes: { ond?: boolean; prazoCertificacao?: number; prazoVencimento?: number; feriados?: Iterable<string> } = {}) {
  const fer = [...(opcoes.feriados || [])];
  const certificacao = somarDiasUteis(emissao, opcoes.prazoCertificacao ?? 10, fer);
  const vencimento = opcoes.ond ? certificacao : proximoDiaUtil(somarDiasCorridos(emissao, opcoes.prazoVencimento ?? 30), fer);
  return { certificacao, vencimento };
}
