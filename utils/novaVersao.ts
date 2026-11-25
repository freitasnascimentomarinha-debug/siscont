/**
 * Quando uma versão nova é publicada com o sistema aberto, os arquivos das telas antigas somem do servidor e abrir uma tela
 * dá "Failed to fetch dynamically imported module". A solução é recarregar a página. Antes isso só acontecia uma vez por
 * sessão (a segunda publicação com a mesma aba aberta mostrava "Ops! Algo deu errado"). Agora recarrega de novo, com uma
 * trava de 30 segundos para nunca entrar em laço se o arquivo realmente estiver faltando.
 */
export const ERRO_DE_VERSAO_NOVA = /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|error loading dynamically/i;

export const ehErroDeVersaoNova = (e: unknown) => ERRO_DE_VERSAO_NOVA.test(String((e as { message?: string })?.message ?? e ?? ''));

/** Pode recarregar agora? (não recarregou nos últimos 30 s) */
export const podeRecarregar = (agora: number, ultimo: number | null, janelaMs = 30000) => ultimo === null || !Number.isFinite(ultimo) || agora - ultimo > janelaMs;

/** Recarrega a página se for erro de versão nova e a trava permitir. Devolve true se mandou recarregar. */
export function recarregarSeVersaoNova(e: unknown, agora = Date.now()): boolean {
  if (!ehErroDeVersaoNova(e)) return false;
  try {
    const bruto = sessionStorage.getItem('siscont-recarregou');
    const ultimo = bruto === null ? null : Number(bruto);
    if (!podeRecarregar(agora, ultimo)) return false;
    sessionStorage.setItem('siscont-recarregou', String(agora));
    window.location.reload();
    return true;
  } catch { return false; }
}
