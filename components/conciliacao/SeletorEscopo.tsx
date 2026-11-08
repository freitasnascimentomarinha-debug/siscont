import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface Escopo { tipo: 'COMANDO' | 'OM'; id: string; rotulo: string }
export interface OpcaoEscopo extends Escopo { codigo: string; nome: string; sigla?: string | null; setor: string; ativo: boolean }

const norm = (t: string) => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const chave = (e: Escopo) => `${e.tipo}:${e.id}`;

/**
 * Filtro para escolher os comandos e OM do extrato: busca por código, nome, sigla ou setor; só comandos, só OM ou
 * os dois; por setor; com ou sem as desativadas; marca vários de uma vez.
 */
export const SeletorEscopo: React.FC<{ opcoes: OpcaoEscopo[]; selecionados: Escopo[]; onChange: (s: Escopo[]) => void }> = ({ opcoes, selecionados, onChange }) => {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState<'TODOS' | 'COMANDO' | 'OM'>('TODOS');
  const [setor, setSetor] = useState('');
  const [desativadas, setDesativadas] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);

  const marcados = useMemo(() => new Set(selecionados.map(chave)), [selecionados]);
  const setores = useMemo(() => [...new Set(opcoes.map(o => o.setor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [opcoes]);
  const q = norm(busca.trim());
  const visiveis = useMemo(() => opcoes
    .filter(o => (tipo === 'TODOS' || o.tipo === tipo) && (!setor || o.setor === setor) && (desativadas || o.ativo))
    .filter(o => !q || norm(`${o.codigo} ${o.nome} ${o.sigla || ''} ${o.setor}`).includes(q)), [opcoes, tipo, setor, desativadas, q]);
  const mostrados = visiveis.slice(0, 300);

  const alternar = (o: OpcaoEscopo) => onChange(marcados.has(chave(o)) ? selecionados.filter(s => chave(s) !== chave(o)) : [...selecionados, { tipo: o.tipo, id: o.id, rotulo: o.rotulo }]);
  const marcarVisiveis = () => onChange([...selecionados, ...visiveis.filter(o => !marcados.has(chave(o))).map(o => ({ tipo: o.tipo, id: o.id, rotulo: o.rotulo }))]);
  const resumo = !selecionados.length ? 'Escolher comandos e OM' : selecionados.length === 1 ? selecionados[0].rotulo : `${selecionados.length} selecionados`;

  return (
    <div className="relative flex-1 min-w-[280px] text-xs text-slate-600" ref={ref}>
      Comandos e OM do extrato
      <button type="button" onClick={() => setAberto(a => !a)} aria-haspopup="dialog" aria-expanded={aberto} aria-label={`Escolher comandos e OM: ${resumo}`}
        className={`mt-1 w-full flex items-center gap-2 text-sm text-left border rounded-md px-2 py-1.5 bg-white ${selecionados.length ? 'border-primary-400 text-primary-800 bg-primary-50' : 'border-slate-300 text-slate-700'}`}>
        <span className="flex-1 truncate">{resumo}</span><ChevronDown size={14} className="shrink-0" />
      </button>
      {aberto && (
        <div className="absolute z-40 mt-1 w-[min(640px,92vw)] bg-white border border-slate-200 rounded-lg shadow-xl p-3 space-y-2" role="dialog" aria-label="Filtro de comandos e OM">
          <div className="flex flex-wrap items-end gap-2">
            <label className="relative flex-1 min-w-[200px]"><Search size={13} className="absolute left-2 top-2.5 text-slate-400" />
              <input autoFocus className="w-full pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-md" placeholder="Código, nome, sigla ou setor..." value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar comando ou OM" /></label>
            <div className="flex rounded-md border border-slate-300 overflow-hidden text-xs" role="radiogroup" aria-label="Tipo">
              {(['TODOS', 'COMANDO', 'OM'] as const).map(t => (
                <button key={t} type="button" role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)} className={`px-2 py-1.5 ${tipo === t ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                  {t === 'TODOS' ? 'Todos' : t === 'COMANDO' ? 'Comandos' : 'OM'}
                </button>
              ))}
            </div>
            <select className="text-xs border border-slate-300 rounded-md px-1.5 py-1.5 bg-white" value={setor} onChange={e => setSetor(e.target.value)} aria-label="Setor">
              <option value="">Todos os setores</option>{setores.map(x => <option key={x} value={x}>{x}</option>)}
            </select>
            <label className="flex items-center gap-1 pb-1.5"><input type="checkbox" className="h-3.5 w-3.5 accent-primary-600" checked={desativadas} onChange={e => setDesativadas(e.target.checked)} /> incluir desativadas</label>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-slate-500">{visiveis.length} encontrado(s){visiveis.length > mostrados.length ? ` · mostrando ${mostrados.length}, refine a busca` : ''}</span>
            <span className="flex-1" />
            <button type="button" className="text-primary-700 font-semibold disabled:opacity-40" disabled={!visiveis.length} onClick={marcarVisiveis}>marcar os visíveis</button>
            <button type="button" className="text-slate-500 font-semibold disabled:opacity-40" disabled={!selecionados.length} onClick={() => onChange([])}>desmarcar todos</button>
          </div>
          <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded">
            {mostrados.map(o => (
              <li key={chave(o)}>
                <label className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={marcados.has(chave(o))} onChange={() => alternar(o)} aria-label={`${o.tipo === 'COMANDO' ? 'Comando' : 'OM'} ${o.rotulo}`} />
                  <span className={`text-[10px] font-bold uppercase w-16 shrink-0 ${o.tipo === 'COMANDO' ? 'text-sky-700' : 'text-slate-400'}`}>{o.tipo === 'COMANDO' ? 'Comando' : 'OM'}</span>
                  <span className="font-mono text-xs w-14 shrink-0">{o.codigo}</span>
                  <span className="flex-1 truncate" title={o.nome}>{o.nome}{o.sigla ? <span className="text-slate-400"> ({o.sigla})</span> : ''}{!o.ativo && <span className="text-amber-700"> · desativada</span>}</span>
                  <span className="text-[11px] text-slate-500 shrink-0">{o.setor}</span>
                </label>
              </li>
            ))}
            {!mostrados.length && <li className="px-2 py-4 text-center text-slate-400 text-sm">Nada encontrado.</li>}
          </ul>
          <div className="flex justify-end"><button type="button" className="text-sm px-3 py-1 rounded-md bg-primary-600 text-white inline-flex items-center gap-1" onClick={() => setAberto(false)}><X size={13} />fechar</button></div>
        </div>
      )}
    </div>
  );
};
