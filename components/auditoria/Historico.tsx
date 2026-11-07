import React, { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { historico, Fase7NaoInstaladaError } from '../../services/auditoriaService';
import { ACOES, RegistroAuditoria, diferencas, valorCurto } from '../../utils/auditoria';

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR');
const COR: Record<string, string> = { INSERT: 'bg-emerald-100 text-emerald-800', UPDATE: 'bg-sky-100 text-sky-800', DELETE: 'bg-red-100 text-red-800' };

/** Lista de alterações (quem, quando, de → para). */
export const ListaAlteracoes: React.FC<{ linhas: RegistroAuditoria[]; mostrarRegistro?: boolean }> = ({ linhas, mostrarRegistro }) => (
  <ol className="space-y-3">
    {linhas.map(l => (
      <li key={l.id} className="border border-slate-200 rounded-lg p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className={`px-2 py-0.5 rounded-full font-bold ${COR[l.acao]}`}>{ACOES[l.acao]}</span>
          <span className="text-slate-700 font-medium">{quando(l.em)}</span>
          <span className="text-slate-500">por {l.usuarioEmail || 'sistema'}</span>
          {mostrarRegistro && <span className="text-slate-400">· {l.tabela} {l.registroId}</span>}
        </div>
        <table className="w-full">
          <tbody>
            {diferencas(l).map(d => (
              <tr key={d.campo} className="border-t border-slate-100">
                <td className="py-0.5 pr-2 text-slate-500 w-40 align-top">{d.campo}</td>
                {l.acao !== 'INSERT' && <td className="py-0.5 pr-2 text-red-700 line-through align-top break-all">{valorCurto(d.de)}</td>}
                {l.acao !== 'DELETE' && <td className="py-0.5 text-emerald-800 align-top break-all">{valorCurto(d.para)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </li>
    ))}
  </ol>
);

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
        {erro && <p className="text-sm text-amber-800">{erro}</p>}
        {!erro && !linhas && <p className="text-sm text-slate-500">Carregando...</p>}
        {linhas && !linhas.length && <p className="text-sm text-slate-500 flex items-center gap-2"><History size={16} />Nenhuma alteração registrada desde a instalação da auditoria.</p>}
        {linhas && linhas.length > 0 && <ListaAlteracoes linhas={linhas} />}
      </div>
    </Modal>
  );
};
