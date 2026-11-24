import React, { useEffect, useMemo, useState } from 'react';
import { History, Info } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { historico, Fase7NaoInstaladaError } from '../../services/auditoriaService';
import { RegistroAuditoria, diferencas, valorCurto } from '../../utils/auditoria';
import { alteracaoLegivel } from '../../utils/auditoriaLegivel';

const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const hojeBR = () => new Date().toLocaleDateString('pt-BR');
const COR: Record<string, string> = { INSERT: 'bg-emerald-100 text-emerald-800', UPDATE: 'bg-sky-100 text-sky-800', DELETE: 'bg-red-100 text-red-800' };
const quem = (email: string | null) => (email ? email.split('@')[0] : 'o sistema');

const Cartao: React.FC<{ l: RegistroAuditoria; mostrarRegistro?: boolean }> = ({ l, mostrarRegistro }) => {
  const [tecnico, setTecnico] = useState(false);
  const a = useMemo(() => alteracaoLegivel(l), [l]);
  return (
    <li className="border border-slate-200 rounded-lg p-3 text-sm bg-white" data-testid="alteracao">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${COR[l.acao]}`}>{a.verbo}</span>
        <span className="text-slate-800 font-medium">às {hora(l.em)}</span>
        <span className="text-slate-600">por <b>{quem(l.usuarioEmail)}</b></span>
        {mostrarRegistro && <span className="text-xs text-slate-400">· {l.tabela} {l.registroId}</span>}
      </div>
      {a.frases.map((f, i) => <p key={i} className="text-slate-800 flex gap-1.5"><span aria-hidden>✔</span><span>{f}</span></p>)}
      {a.campos.length > 0 && (
        <ul className="mt-1 space-y-1">
          {a.campos.map(c => (
            <li key={c.rotulo} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-slate-700">{c.rotulo}:</span>
              {l.acao === 'UPDATE' ? <>
                <span className="text-slate-500">era</span><span className="text-red-700">{c.de}</span>
                <span className="text-slate-500">→ agora</span><span className="text-emerald-800 font-semibold">{c.para}</span>
              </> : <span className={l.acao === 'DELETE' ? 'text-red-700' : 'text-emerald-800'}>{l.acao === 'DELETE' ? c.de : c.para}</span>}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="mt-2 text-[11px] text-slate-400 hover:text-slate-600 underline" onClick={() => setTecnico(!tecnico)} aria-expanded={tecnico}>{tecnico ? 'esconder' : 'ver'} dados técnicos</button>
      {tecnico && (
        <table className="w-full text-[11px] mt-1">
          <tbody>
            {diferencas(l).map(d => (
              <tr key={d.campo} className="border-t border-slate-100">
                <td className="py-0.5 pr-2 text-slate-500 w-36 align-top">{d.campo}</td>
                {l.acao !== 'INSERT' && <td className="py-0.5 pr-2 text-red-700 line-through align-top break-all">{valorCurto(d.de)}</td>}
                {l.acao !== 'DELETE' && <td className="py-0.5 text-emerald-800 align-top break-all">{valorCurto(d.para)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
};

/** Lista de alterações em linguagem simples: o quê, quando e por quem, agrupada por dia. */
export const ListaAlteracoes: React.FC<{ linhas: RegistroAuditoria[]; mostrarRegistro?: boolean }> = ({ linhas, mostrarRegistro }) => {
  const [verInternas, setVerInternas] = useState(false);
  const { visiveis, internas } = useMemo(() => {
    const v: RegistroAuditoria[] = [], i: RegistroAuditoria[] = [];
    linhas.forEach(l => (alteracaoLegivel(l).soTecnico ? i : v).push(l));
    return { visiveis: v, internas: i };
  }, [linhas]);
  const lista = verInternas ? linhas : visiveis;
  const grupos = useMemo(() => {
    const m = new Map<string, RegistroAuditoria[]>();
    lista.forEach(l => { const k = dia(l.em); m.set(k, [...(m.get(k) || []), l]); });
    return [...m.entries()];
  }, [lista]);
  return (
    <div className="space-y-4">
      {grupos.map(([d, ls]) => (
        <section key={d} aria-label={`Alterações de ${d}`}>
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1.5">{d === hojeBR() ? `Hoje · ${d}` : d}</h4>
          <ol className="space-y-2">{ls.map(l => <Cartao key={l.id} l={l} mostrarRegistro={mostrarRegistro} />)}</ol>
        </section>
      ))}
      {internas.length > 0 && (
        <button type="button" className="text-xs text-slate-500 underline flex items-center gap-1" onClick={() => setVerInternas(!verInternas)}>
          <Info size={12} />{verInternas ? 'Esconder' : 'Mostrar'} {internas.length} atualização(ões) interna(s) do sistema, sem mudança nos dados que você vê
        </button>
      )}
    </div>
  );
};

/** Modal "Histórico" de um registro. */
export const HistoricoModal: React.FC<{ tabela: string; registroId: string | null; titulo: string; onClose: () => void }> = ({ tabela, registroId, titulo, onClose }) => {
  const [linhas, setLinhas] = useState<RegistroAuditoria[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!registroId) return;
    setLinhas(null); setErro(null);
    historico(tabela, registroId).then(setLinhas).catch(e => setErro(e instanceof Fase7NaoInstaladaError ? 'A trilha de auditoria ainda não foi instalada (script 010).' : e?.message || 'Erro ao carregar.'));
  }, [tabela, registroId]);
  return (
    <Modal isOpen={!!registroId} onClose={onClose} title={titulo} maxWidth="max-w-2xl">
      <div className="max-h-[70vh] overflow-y-auto">
        <p className="text-xs text-slate-500 mb-3">Tudo o que foi alterado neste registro: o que mudou, quando e por quem. O mais recente aparece primeiro.</p>
        {erro && <p className="text-sm text-amber-800">{erro}</p>}
        {!erro && !linhas && <p className="text-sm text-slate-500">Carregando...</p>}
        {linhas && !linhas.length && <p className="text-sm text-slate-500 flex items-center gap-2"><History size={16} />Nenhuma alteração registrada desde a instalação da auditoria.</p>}
        {linhas && linhas.length > 0 && <ListaAlteracoes linhas={linhas} />}
      </div>
    </Modal>
  );
};
