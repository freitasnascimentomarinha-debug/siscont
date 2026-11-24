/**
 * Evita o "-0,00" na tela: um valor que arredonda para zero (ex.: -0 ou -0,0000000036, resíduo de ponto flutuante)
 * é mostrado como "0,00", sem o sinal de menos. Valores realmente negativos continuam com o sinal.
 * Vale para todo `número.toLocaleString(...)` do sistema (telas, PDFs e Excel).
 */
export function instalarSemZeroNegativo() {
  const marca = '__semZeroNegativo';
  const proto = Number.prototype as any;
  if (proto[marca]) return;
  const original = Number.prototype.toLocaleString;
  Number.prototype.toLocaleString = function (this: number, locales?: any, options?: any): string {
    const v = Number(this);
    if (v < 0 || Object.is(v, -0)) {
      const abs = original.call(Math.abs(v), locales, options);
      if (!/[1-9]/.test(abs)) return abs;   // só zeros: sem o sinal de menos
    }
    return original.call(this, locales, options);
  } as typeof Number.prototype.toLocaleString;
  Object.defineProperty(proto, marca, { value: true, enumerable: false });
}
