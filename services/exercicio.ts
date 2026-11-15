/**
 * Janela de exercícios: quantos anos de faturas as telas carregam.
 *  - null  = "Todos os anos" (padrão: tudo como sempre foi)
 *  - número = carrega as faturas de competência >= esse ano, MAIS as que ainda têm saldo em aberto ou estão em contestação,
 *    MAIS os documentos e baixas ligados a elas (função dados_janela, script 039). Nada que vale dinheiro some.
 * Fica guardada no navegador de cada usuário (não muda nada para os demais).
 */
import { useSyncExternalStore } from 'react';

const CHAVE = 'siscont.exercicio.desde';
const ouvintes = new Set<() => void>();

function lerGuardado(): number | null {
  try { const v = window.localStorage.getItem(CHAVE); const n = v ? Number(v) : NaN; return Number.isInteger(n) && n > 2000 && n < 2100 ? n : null; } catch { return null; }
}
let desde: number | null = typeof window !== 'undefined' ? lerGuardado() : null;

export const anoCorrente = () => new Date().getFullYear();
/** Janela recomendada: ano anterior e ano atual. */
export const desdePadrao = () => anoCorrente() - 1;

export const exercicio = {
  get: () => desde,
  /** Muda a janela (null = todos os anos). Quem está ouvindo (o App) recarrega as telas. */
  set(novo: number | null) {
    const v = novo === null ? null : Math.min(novo, anoCorrente());
    if (v === desde) return;
    desde = v;
    try { if (v === null) window.localStorage.removeItem(CHAVE); else window.localStorage.setItem(CHAVE, String(v)); } catch { /* sem storage */ }
    ouvintes.forEach(f => f());
  },
  /** Garante que um ano antigo esteja dentro da janela (ex.: o usuário escolheu 2023 num filtro). */
  incluirAno(ano: number) { if (desde !== null && ano < desde) exercicio.set(ano); },
  subscribe(f: () => void) { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
};

export const useExercicio = () => useSyncExternalStore(exercicio.subscribe, exercicio.get, exercicio.get);
