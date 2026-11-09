import React from 'react';
import { GrupoGasto } from '../../utils/gastosBNIC';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Barra 100% do valor previsto, uma fatia por grupo de gasto. Clicável quando `onClick` é informado. */
export const BarraGrupos: React.FC<{ grupos: GrupoGasto[]; onClick?: (id: string) => void }> = ({ grupos, onClick }) => {
  const total = grupos.reduce((s, g) => s + g.previsto, 0);
  const com = grupos.filter(g => g.previsto > 0);
  if (total <= 0) return <p className="text-sm text-slate-400 py-3">Nenhum valor previsto para o exercício.</p>;
  return (
    <div>
      <div className="flex h-8 w-full rounded-lg overflow-hidden border border-slate-200" role="img" aria-label="Distribuição do valor previsto por grupo de gasto">
        {com.map(g => (
          <button key={g.id} type="button" disabled={!onClick} onClick={() => onClick?.(g.id)} title={`${g.rotulo}: ${brl(g.previsto)} (${g.pctDoPrevisto.toLocaleString('pt-BR')}%)`}
            className={`h-full ${onClick ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`} style={{ width: `${(g.previsto / total) * 100}%`, background: g.cor }} aria-label={`${g.rotulo}: ${g.pctDoPrevisto}%`} />
        ))}
      </div>
      <ul className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {com.map(g => (
          <li key={g.id} className="flex items-center gap-1.5 min-w-0"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.cor }} /><span className="truncate text-slate-700" title={g.rotulo}>{g.rotulo}</span><b className="ml-auto tabular-nums text-slate-900">{g.pctDoPrevisto.toLocaleString('pt-BR')}%</b></li>
        ))}
      </ul>
    </div>
  );
};
