import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Plus, Search } from 'lucide-react';
import { cadastroService } from '../../services/cadastroService';
import { Comando, OM, Setor } from '../../types';
import { ClienteModal } from '../taxa/ClienteModal';
import { normalizar } from '../../utils/taxaCondominialImport';

export interface ClienteEscolhido { omId: string; ug: string; client: string; sector: string; command: string; comandoId: string | null }

/**
 * Campo "Cliente" ligado ao Cadastro de OM: busca por nome, sigla, código, nome alternativo ou comando; ao escolher,
 * preenche UG, setor e comando e liga o registro à OM. Também permite cadastrar um cliente novo na hora.
 * Texto que não está no cadastro continua aceito (registros antigos), com aviso.
 */
export const SeletorCliente: React.FC<{
  valor: string; omId?: string | null; disabled?: boolean;
  onEscolher: (c: ClienteEscolhido) => void; onTexto: (texto: string) => void;
}> = ({ valor, omId, disabled, onEscolher, onTexto }) => {
  const [oms, setOms] = useState<OM[]>([]);
  const [cmds, setCmds] = useState<Comando[]>([]);
  const [setores, setSetores] = useState<Setor[]>([]);
  const [aberto, setAberto] = useState(false);
  const [novo, setNovo] = useState(false);
  const [verDesativadas, setVerDesativadas] = useState(false);
  // telas que não guardam a OM (ex.: documento recebido) mostram a ligação escolhida nesta edição
  const [escolhidoId, setEscolhidoId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    Promise.all([cadastroService.listOMs(), cadastroService.listComandos(), cadastroService.listSetores()])
      .then(([o, c, s]) => { setOms(o); setCmds(c); setSetores(s); }).catch(() => undefined);
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, []);
  const cmd = useMemo(() => new Map(cmds.map(c => [c.id, c])), [cmds]);
  const set = useMemo(() => new Map(setores.map(s => [s.id, s])), [setores]);
  const descrever = (o: OM): ClienteEscolhido => {
    const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
    const setorId = o.setorId || c?.setorId || undefined;
    return { omId: o.id, ug: o.codigo, client: o.nome, sector: (setorId && set.get(setorId)?.sigla) || (o.tipo === 'EXTRA_MB' ? 'EXTRA-MB' : ''), command: c ? (c.codigo ? `${c.codigo} - ${c.nome}` : c.nome) : '', comandoId: o.comandoId ?? null };
  };
  const idLigado = omId ?? escolhidoId;
  const ligado = idLigado ? oms.find(o => o.id === idLigado) : undefined;
  const lista = useMemo(() => {
    const t = normalizar(valor || '').split(' ').filter(p => p.length > 1);
    return oms.filter(o => verDesativadas || o.ativo)
      .map(o => {
        const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
        const alvo = normalizar(`${o.nome} ${o.sigla || ''} ${o.codigo} ${(o.nomesAlternativos || []).join(' ')} ${c?.nome || ''} ${c?.codigo || ''}`);
        return { o, pts: t.length ? t.filter(p => alvo.includes(p)).length : 1 };
      })
      .filter(x => x.pts > 0)
      .sort((a, b) => b.pts - a.pts || Number(b.o.ativo) - Number(a.o.ativo) || a.o.nome.localeCompare(b.o.nome))
      .slice(0, 40);
  }, [oms, valor, verDesativadas, cmd]);

  return (
    <div className="relative" ref={ref}>
      <label className="block text-sm font-medium text-slate-700 mb-1">Cliente <span className="text-red-500">*</span></label>
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-3 text-slate-400" />
        <input disabled={disabled} required value={valor} onFocus={() => setAberto(true)}
          onChange={e => { onTexto(e.target.value); setEscolhidoId(null); setAberto(true); }}
          className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50"
          placeholder="Digite nome, sigla ou código da OM" aria-label="Cliente" aria-autocomplete="list" aria-expanded={aberto} />
      </div>
      <p className="text-[11px] mt-0.5 min-h-[14px]">
        {ligado ? <span className="text-emerald-700 flex items-center gap-1"><Link2 size={11} />Ligado ao cadastro: {ligado.codigo} · {ligado.nome}{ligado.ativo ? '' : ' (desativada)'}</span>
          : valor ? <span className="text-amber-700">Não está ligado ao cadastro — escolha na lista ou cadastre o cliente.</span> : null}
      </p>
      {aberto && !disabled && (
        <div className="absolute z-40 mt-1 w-full min-w-[320px] bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto" role="listbox">
          {lista.map(({ o }) => {
            const d = descrever(o);
            return (
              <button key={o.id} type="button" role="option" aria-selected={o.id === omId} onClick={() => { onEscolher(d); setEscolhidoId(o.id); setAberto(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-primary-50 text-sm border-b border-slate-50">
                <span className="font-medium">{o.nome}</span>{o.sigla ? <span className="text-slate-500"> · {o.sigla}</span> : ''}
                <span className="block text-[11px] text-slate-500">{o.codigo} · {d.sector || 'sem setor'} · {d.command || 'sem comando'}{o.foraDaIlha ? ' · fora da Ilha' : ''}{o.ativo ? '' : ' · desativada'}</span>
              </button>
            );
          })}
          {!lista.length && <div className="px-3 py-2 text-xs text-slate-400">Nenhum cliente encontrado no cadastro.</div>}
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 sticky bottom-0">
            <label className="text-[11px] flex items-center gap-1"><input type="checkbox" checked={verDesativadas} onChange={e => setVerDesativadas(e.target.checked)} />mostrar desativadas</label>
            <button type="button" className="text-xs text-primary-700 font-semibold flex items-center gap-1" onClick={() => { setNovo(true); setAberto(false); }}><Plus size={12} />Cadastrar novo cliente</button>
          </div>
        </div>
      )}
      <ClienteModal aberto={novo} titulo="Cadastrar cliente" oms={oms} nomeSugerido={valor}
        onFechar={() => setNovo(false)}
        onEscolher={async om => { setNovo(false); const lista2 = await cadastroService.listOMs().catch(() => oms); setOms(lista2); const o = lista2.find(x => x.id === om.id) || (om as OM); onEscolher(descrever(o)); setEscolhidoId(o.id); }} />
    </div>
  );
};
