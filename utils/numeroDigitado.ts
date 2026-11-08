/**
 * Número digitado ou mostrado num campo: aceita "1.234,56" (formato brasileiro), "1234,56" e "1234.56"
 * (o que aparece quando o valor vem do banco). Só trata o ponto como separador de milhar quando há vírgula,
 * ou quando ele separa grupos de 3 dígitos ("1.234.567").
 */
export function numeroDigitado(v: string): number | null {
  const t = (v ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^-?\d{1,3}(\.\d{3}){2,}$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}
