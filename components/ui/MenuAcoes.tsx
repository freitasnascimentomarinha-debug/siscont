import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ItemMenu { rotulo: string; onClick: () => void; icone?: React.ReactNode; dica?: string }

/** Botão com lista de ações (Importar, Exportar...): deixa o cabeçalho limpo. Fecha ao escolher, ao clicar fora ou com Esc. */
export const MenuAcoes: React.FC<{ rotulo: string; icone?: React.ReactNode; itens: ItemMenu[]; desabilitado?: boolean }> = ({ rotulo, icone, itens, desabilitado }) => {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora); document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aberto]);
  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" disabled={desabilitado} aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto(!aberto)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
        {icone}{rotulo}<ChevronDown size={14} className="text-slate-400" />
      </button>
      {aberto && (
        <ul role="menu" className="absolute right-0 z-30 mt-1 min-w-[16rem] rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {itens.map(i => (
            <li key={i.rotulo} role="none">
              <button type="button" role="menuitem" title={i.dica} onClick={() => { setAberto(false); i.onClick(); }}
                className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">{i.icone}{i.rotulo}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
