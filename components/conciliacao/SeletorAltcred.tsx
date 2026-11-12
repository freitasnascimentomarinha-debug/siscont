import React, { useMemo, useState } from 'react';
import { ListChecks, X } from 'lucide-react';

export interface ItemAltcred { numero: string; cliente: string; valor: number; saldo: number; data: string; operacao: string }
const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/**
 * Escolher várias ALTCRED numa lista com busca e caixas de marcar. Os números marcados vão para o campo de filtro
 * (separados por vírgula), que continua aceitando digitação livre.
 */
export const SeletorAltcred: React.FC<{ itens: ItemAltcred[]; marcadas: string[]; onChange: (numeros: string[]) => void }> = ({ itens, marcadas, onChange }) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const marcadasSet = useMemo(() => new Set(marcadas.map(m => m.toUpperCase())), [marcadas]);
  const achadas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter(i => !q || `${i.numero} ${i.cliente}`.toLowerCase().includes(q));
  }, [itens, busca]);
  const visiveis = achadas.slice(0, 150);
  const alternar = (n: string) => onChange(marcadasSet.has(n.toUpperCase()) ? marcadas.filter(m => m.toUpperCase() !== n.toUpperCase()) : [...marcadas, n]);
  const marcarBusca = () => onChange([...new Set([...marcadas, ...achadas.map(i => i.numero)])]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setAberto(a => !a)} aria-expanded={aberto}
        className="text-sm border border-slate-300 rounded-md px-3 py-2 bg-white hover:bg-slate-50 inline-flex items-center gap-1.5">
        <ListChecks size={15} /> Escolher ALTCRED{marcadas.length ? ` (${marcadas.length})` : ''}
      </button>
      {aberto && (
        <div className="absolute z-30 mt-1 w-[34rem] max-w-[90vw] bg-white border border-slate-300 rounded-lg shadow-xl p-3 space-y-2" role="dialog" aria-label="Escolher ALTCRED">
          <div className="flex items-center gap-2">
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por número ou OM" aria-label="Buscar ALTCRED na lista" className="flex-1 text-sm border border-slate-300 rounded-md px-2 py-1.5" autoFocus />
            <button type="button" onClick={() => setAberto(false)} className="text-slate-500 hover:text-slate-800" aria-label="Fechar a lista"><X size={16} /></button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-500">{achadas.length} ALTCRED · <b>{marcadas.length}</b> marcada(s)</span>
            <button type="button" className="text-primary-700 underline" onClick={marcarBusca}>marcar as {achadas.length} da busca</button>
            <button type="button" className="text-primary-700 underline" onClick={() => onChange([])}>desmarcar todas</button>
          </div>
          <ul className="max-h-72 overflow-auto divide-y divide-slate-100 border border-slate-200 rounded">
            {visiveis.map(i => (
              <li key={i.numero}>
                <label className="flex items-start gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-primary-50/50">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary-600" checked={marcadasSet.has(i.numero.toUpperCase())} onChange={() => alternar(i.numero)} aria-label={`ALTCRED ${i.numero}`} />
                  <span className="flex-1 min-w-0"><span className="font-mono font-semibold">{i.numero}</span> <span className="text-slate-500">· {br(i.data)} · {i.operacao.toLowerCase()}</span>
                    <span className="block truncate text-slate-600" title={i.cliente}>{i.cliente}</span></span>
                  <span className="text-right tabular-nums whitespace-nowrap">{brl(i.valor)}<span className="block text-[10px] text-slate-500">saldo {brl(i.saldo)}</span></span>
                </label>
              </li>
            ))}
            {!visiveis.length && <li className="px-2 py-4 text-center text-xs text-slate-400">Nenhuma ALTCRED com essa busca.</li>}
          </ul>
          {achadas.length > visiveis.length && <p className="text-[11px] text-slate-500">Mostrando {visiveis.length} de {achadas.length}: refine a busca ou use "marcar as {achadas.length} da busca".</p>}
        </div>
      )}
    </div>
  );
};
