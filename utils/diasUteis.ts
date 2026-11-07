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
