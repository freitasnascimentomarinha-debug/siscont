import { useCallback, useState } from 'react';

/**
 * Aba aberta guardada no endereço (#/cobranca/mensagens): atualizar o navegador (F5) volta na mesma aba.
 * Valor desconhecido no endereço vale o padrão. Falha silenciosa fora do navegador.
 */
export function useAbaNoEndereco<T extends string>(validas: readonly T[], padrao: T): [T, (a: T) => void] {
  const [aba, setAbaEstado] = useState<T>(() => {
    try { const seg = window.location.hash.replace(/^#\/?/, '').split('/')[1] as T; return validas.includes(seg) ? seg : padrao; } catch { return padrao; }
  });
  const setAba = useCallback((a: T) => {
    setAbaEstado(a);
    try {
      const pagina = window.location.hash.replace(/^#\/?/, '').split('/')[0];
      if (pagina) window.history.replaceState(null, '', `#/${pagina}/${a}`);
    } catch { /* sem histórico */ }
  }, []);
  return [aba, setAba];
}
