import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

/**
 * Filtro de múltipla escolha. Guarda os valores EXCLUÍDOS: "todos" = nenhum excluído, e um valor novo que apareça
 * depois já entra marcado (ex.: "todos os setores exceto EXTRA-MARINHA" continua valendo quando surge um setor novo).
 */
export const MultiFiltro: React.FC<{
  rotulo: string; opcoes: string[]; excluidos: Set<string>; onChange: (excluidos: Set<string>) => void; largura?: string;
}> = ({ rotulo, opcoes, excluidos, onChange, largura = 'w-72' }) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);
  const ex = [...excluidos].filter(v => opcoes.includes(v));
  const marcados = opcoes.length - ex.length;
  const resumo = !ex.length ? 'Todos'
    : marcados === 0 ? 'Nenhum'
    : ex.length <= 2 ? `Todos exceto ${ex.join(', ')}`
    : marcados <= 2 ? opcoes.filter(o => !excluidos.has(o)).join(', ')
    : `${marcados} de ${opcoes.length}`;
  const visiveis = useMemo(() => opcoes.filter(o => !busca || o.toLowerCase().includes(busca.toLowerCase())), [opcoes, busca]);
  const alternar = (v: string) => { const n = new Set(excluidos); n.has(v) ? n.delete(v) : n.add(v); onChange(n); };
  const somente = (v: string) => onChange(new Set(opcoes.filter(o => o !== v)));

  return (
    <div className="relative text-xs font-semibold text-slate-600" ref={ref}>
      {rotulo}
      <button type="button" aria-haspopup="listbox" aria-expanded={aberto} aria-label={`${rotulo}: ${resumo}`} onClick={() => setAberto(!aberto)}
        className={`mt-1 flex items-center gap-2 text-sm font-normal border rounded-md px-2 py-1.5 bg-white min-w-[150px] max-w-[280px] ${ex.length ? 'border-primary-400 text-primary-800 bg-primary-50' : 'border-slate-300 text-slate-800'}`}>
        <span className="truncate flex-1 text-left">{resumo}</span><ChevronDown size={14} className="shrink-0" />
      </button>
      {aberto && (
        <div className={`absolute z-40 mt-1 ${largura} bg-white border border-slate-200 rounded-lg shadow-xl p-2 font-normal`} role="listbox" aria-multiselectable>
          {opcoes.length > 8 && (
            <label className="relative block mb-2"><Search size={13} className="absolute left-2 top-2 text-slate-400" />
              <input autoFocus className="w-full pl-7 pr-2 py-1 text-sm border border-slate-300 rounded-md" placeholder="Buscar..." value={busca} onChange={e => setBusca(e.target.value)} aria-label={`Buscar em ${rotulo}`} />
            </label>
          )}
          <div className="flex gap-3 mb-1 px-1 text-[11px]">
            <button type="button" className="text-primary-700 font-semibold" onClick={() => onChange(new Set())}>Marcar todos</button>
            <button type="button" className="text-slate-500 font-semibold" onClick={() => onChange(new Set(opcoes))}>Desmarcar todos</button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {visiveis.map(o => {
              const on = !excluidos.has(o);
              return (
                <div key={o} className="group flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50">
                  <button type="button" role="option" aria-selected={on} onClick={() => alternar(o)} className="flex items-center gap-2 flex-1 text-left text-sm text-slate-800">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-300'}`}>{on && <Check size={12} />}</span>
                    <span className="truncate" title={o}>{o}</span>
                  </button>
                  <button type="button" className="opacity-0 group-hover:opacity-100 text-[11px] text-primary-700" onClick={() => somente(o)} title={`Mostrar só ${o}`}>só este</button>
                </div>
              );
            })}
            {!visiveis.length && <div className="text-slate-400 text-sm p-2">Nada encontrado.</div>}
          </div>
        </div>
      )}
    </div>
  );
};

/** Lembra a escolha do filtro neste navegador (conveniência; falha silenciosa sem armazenamento). */
export function useExcluidosLembrados(chave: string): [Set<string>, (s: Set<string>) => void] {
  const [v, setV] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(chave) || '[]')); } catch { return new Set(); }
  });
  const set = (s: Set<string>) => { setV(s); try { localStorage.setItem(chave, JSON.stringify([...s])); } catch { /* sem armazenamento */ } };
  return [v, set];
}
