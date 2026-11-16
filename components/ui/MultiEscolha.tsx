import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface OpcaoEscolha { value: string; label: string }

/**
 * Filtro de escolha múltipla: guarda os valores ESCOLHIDOS ("nenhum escolhido" = sem filtro = todos).
 * Ex.: Status "Em aberto" + "Vencida"; Serviço "AE" + "EL".
 */
export const MultiEscolha: React.FC<{
  rotulo: string; opcoes: OpcaoEscolha[]; escolhidos: Set<string>; onChange: (v: Set<string>) => void; largura?: string; tituloVazio?: string;
}> = ({ rotulo, opcoes, escolhidos, onChange, largura = 'w-56', tituloVazio = 'Todos' }) => {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);
  const marcados = opcoes.filter(o => escolhidos.has(o.value));
  const resumo = !marcados.length ? tituloVazio : marcados.length <= 2 ? marcados.map(o => o.label).join(' + ') : `${marcados.length} escolhidos`;
  const alternar = (v: string) => { const n = new Set(escolhidos); n.has(v) ? n.delete(v) : n.add(v); onChange(n); };
  return (
    <div className="relative text-xs font-semibold text-slate-600" ref={ref}>
      {rotulo}
      <button type="button" aria-haspopup="listbox" aria-expanded={aberto} aria-label={`${rotulo}: ${resumo}`} onClick={() => setAberto(!aberto)}
        className={`mt-1 flex items-center gap-2 text-sm font-normal border rounded-md px-2 py-1.5 bg-white min-w-[110px] max-w-[220px] ${marcados.length ? 'border-primary-400 text-primary-800 bg-primary-50' : 'border-slate-300 text-slate-800'}`}>
        <span className="truncate flex-1 text-left">{resumo}</span><ChevronDown size={14} className="shrink-0" />
      </button>
      {aberto && (
        <div className={`absolute z-40 mt-1 ${largura} bg-white border border-slate-200 rounded-lg shadow-xl p-2 font-normal`} role="listbox" aria-multiselectable aria-label={rotulo}>
          <div className="flex gap-3 mb-1 px-1 text-[11px]">
            <button type="button" className="text-primary-700 font-semibold" onClick={() => onChange(new Set(opcoes.map(o => o.value)))}>Marcar todos</button>
            <button type="button" className="text-slate-500 font-semibold" onClick={() => onChange(new Set())}>Limpar</button>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {opcoes.map(o => {
              const on = escolhidos.has(o.value);
              return (
                <button key={o.value} type="button" role="option" aria-selected={on} onClick={() => alternar(o.value)} className="flex items-center gap-2 w-full px-1 py-1 rounded hover:bg-slate-50 text-left text-sm text-slate-800">
                  <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-300'}`}>{on && <Check size={12} />}</span>
                  <span className="truncate" title={o.label}>{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
