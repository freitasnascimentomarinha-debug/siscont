/**
 * Fluxo de caixa (aba Lançamentos): funções puras de apresentação.
 *  - separarOrigem: tira da Observação a anotação do sistema "Importada de arquivo › aba" (fica como etiqueta de origem).
 *  - etiquetaDaClasse: rubrica ("7 — Extintores") ou categoria ("Energia"), sempre pela classificação gravada, não pelo texto digitado.
 *  - agruparPorMes: grupos por mês com entradas, saídas e saldo no fim do mês.
 */
import { CashFlowItem } from '../types';

const ROTULO_CATEGORIA: Record<string, string> = {
  ENERGIA: 'Energia', AGUA: 'Água e esgoto', TELEFONIA: 'Telefonia', CONDOMINIO: 'Condomínio/diária/viatura', EXPEDIENTE: 'Expediente e limpeza', OUTROS: 'Outros',
};
export const CLASSES_CATEGORIA = Object.keys(ROTULO_CATEGORIA);

/** "Importada de x.xlsx › Página1" (com ou sem "Reforço de empenho — " antes) vira origem; o resto é observação do usuário. */
export function separarOrigem(obs?: string | null): { origem: string; texto: string } {
  const t = (obs || '').trim();
  const m = t.match(/^(?:(?:Reforço|Anulação parcial) de empenho\s*—\s*)?Importada de\s+(.+?)\s*›\s*(.+)$/i);
  if (!m) return { origem: '', texto: t };
  const [, arquivo, aba] = m;
  const prefixo = t.match(/^((?:Reforço|Anulação parcial) de empenho)\s*—/i)?.[1] || '';
  return { origem: `${arquivo} › ${aba}`, texto: prefixo };
}

export type CorEtiqueta = 'verde' | 'ambar' | 'azul' | 'violeta' | 'teal' | 'cinza' | 'vermelho';
export interface Etiqueta { classe: string; texto: string; completo: string; cor: CorEtiqueta }

/** `classe` = "R7" (rubrica 7 da taxa condominial) ou a categoria ("ENERGIA"...). Vazio = sem classificação. */
export function etiquetaDaClasse(classe: string, rubricas: { numero: number; descricao: string }[] = []): Etiqueta {
  if (!classe) return { classe: '', texto: 'Sem classificação', completo: 'Sem rubrica nem categoria', cor: 'vermelho' };
  if (/^R\d+$/.test(classe)) {
    const n = Number(classe.slice(1)), r = rubricas.find(x => x.numero === n);
    const desc = r?.descricao || '';
    return { classe, texto: desc ? `${n} — ${desc.length > 26 ? desc.slice(0, 25) + '…' : desc}` : `Rubrica ${n}`, completo: desc ? `Rubrica ${n} — ${desc}` : `Rubrica ${n}`, cor: 'verde' };
  }
  const cores: Record<string, CorEtiqueta> = { ENERGIA: 'ambar', AGUA: 'azul', TELEFONIA: 'violeta', CONDOMINIO: 'verde', EXPEDIENTE: 'teal', OUTROS: 'cinza' };
  const t = ROTULO_CATEGORIA[classe] || classe;
  return { classe, texto: t, completo: t, cor: cores[classe] || 'cinza' };
}

/** Saída que ainda pede classificação: sem rubrica/categoria ou em "Outros". */
export const precisaAtencao = (item: Pick<CashFlowItem, 'type' | 'isCanceled'>, classe: string) =>
  item.type === 'EXIT' && !item.isCanceled && (!classe || classe === 'OUTROS');

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface GrupoMes { chave: string; rotulo: string; itens: CashFlowItem[]; entradas: number; saidas: number; saldoFim: number }

/**
 * Agrupa por mês (chave AAAA-MM), na ordem em que os itens vêm. `todos` = todos os lançamentos (sem filtro), para o saldo no fim do mês
 * ser o saldo corrido real (o de cada item já vem em balanceAfter), mesmo quando só algumas linhas estão filtradas.
 */
export function agruparPorMes(itens: CashFlowItem[], todos: CashFlowItem[] = itens): GrupoMes[] {
  const saldoFimDe = new Map<string, number>();
  todos.forEach(i => saldoFimDe.set(i.date.slice(0, 7), i.balanceAfter));   // `todos` vem em ordem cronológica: o último de cada mês vale
  const m = new Map<string, GrupoMes>();
  itens.forEach(i => {
    const k = i.date.slice(0, 7);
    const g = m.get(k) || { chave: k, rotulo: `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(0, 4)}`, itens: [], entradas: 0, saidas: 0, saldoFim: saldoFimDe.get(k) ?? 0 };
    g.itens.push(i);
    if (i.type === 'ENTRY') g.entradas = r2(g.entradas + i.value); else if (!i.isCanceled) g.saidas = r2(g.saidas + i.value);
    m.set(k, g);
  });
  return [...m.values()];
}
