import React, { useEffect, useState } from 'react';
import { cadastroService } from '../../services/cadastroService';
import { OMTipo, Publico, ROTULO_PUBLICO, criarClassificador } from '../../utils/publico';

/** Escolha lembrada por tela (MB / Extra-MB / Todos). */
export function usePublico(chave: string, padrao: Publico = 'TODOS'): [Publico, (p: Publico) => void] {
  const k = `siscont.publico.${chave}`;
  const [p, setP] = useState<Publico>(() => {
    try { const v = localStorage.getItem(k); return v === 'MB' || v === 'EXTRA' || v === 'TODOS' ? v : padrao; } catch { return padrao; }
  });
  const set = (v: Publico) => { setP(v); try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
  return [p, set];
}

let cacheOMs: Promise<OMTipo[]> | null = null;
/** Classificador MB × Extra-MB pelo cadastro de OM (carregado uma vez). */
export function useClassificadorPublico(omsProntas?: OMTipo[]) {
  const [oms, setOms] = useState<OMTipo[]>(omsProntas || []);
  useEffect(() => {
    if (omsProntas) { setOms(omsProntas); return; }
    cacheOMs = cacheOMs || cadastroService.listOMs().then(l => l as OMTipo[]).catch(() => { cacheOMs = null; return []; });
    cacheOMs.then(setOms);
  }, [omsProntas]);
  return React.useMemo(() => criarClassificador(oms), [oms]);
}

export const SeletorPublico: React.FC<{ valor: Publico; onChange: (p: Publico) => void; className?: string }> = ({ valor, onChange, className }) => (
  <div className={`text-xs text-slate-600 ${className || ''}`}>
    <span className="block mb-1 font-semibold">Público</span>
    <div role="radiogroup" aria-label="Público" className="inline-flex rounded-md border border-slate-300 overflow-hidden bg-white">
      {(['TODOS', 'MB', 'EXTRA'] as Publico[]).map(p => (
        <button key={p} type="button" role="radio" aria-checked={valor === p} onClick={() => onChange(p)}
          title={p === 'MB' ? 'Só OM da Marinha' : p === 'EXTRA' ? 'Só clientes de fora da Marinha (bancos, empresas...)' : 'MB e Extra-MB'}
          className={`px-3 py-1.5 text-sm ${valor === p ? (p === 'EXTRA' ? 'bg-amber-600 text-white' : 'bg-primary-600 text-white') : 'text-slate-700 hover:bg-slate-50'} ${p !== 'TODOS' ? 'border-l border-slate-300' : ''}`}>
          {ROTULO_PUBLICO[p]}
        </button>
      ))}
    </div>
  </div>
);
