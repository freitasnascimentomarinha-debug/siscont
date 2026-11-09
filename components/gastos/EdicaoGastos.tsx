import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Fornecedor, RubricaGasto, ROTULO_SUBGRUPO, SUBGRUPOS, SubgrupoId, subgrupoDaRubrica } from '../../utils/gastosBNIC';

const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1 bg-white';

/** Escolher à mão o grupo de cada rubrica (vale para todos os exercícios). Só administrador. */
export const EditarGrupos: React.FC<{ rubricas: RubricaGasto[]; atuais: Record<string, SubgrupoId>; onSalvar: (m: Record<string, SubgrupoId>) => Promise<void>; onClose: () => void }> = ({ rubricas, atuais, onSalvar, onClose }) => {
  const [m, setM] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(atuais).map(([k, v]) => [k, v as string])));
  const [salvando, setSalvando] = useState(false);
  const gravar = async () => {
    setSalvando(true);
    try { await onSalvar(Object.fromEntries(Object.entries(m).filter(([, v]) => v && SUBGRUPOS.some(g => g.id === v))) as Record<string, SubgrupoId>); onClose(); } finally { setSalvando(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title="Grupos das rubricas" maxWidth="max-w-3xl" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={gravar} isLoading={salvando}>Gravar grupos</Button></div>}>
      <p className="text-xs text-slate-500 mb-2">O grupo vem do assunto da descrição da rubrica. Se uma rubrica estiver no grupo errado, escolha o certo aqui; "automático" volta à regra. Vale para todos os exercícios.</p>
      <div className="max-h-[55vh] overflow-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
        {[...rubricas].sort((a, b) => a.numero - b.numero).map(r => (
          <div key={r.numero} className="flex items-center gap-2 px-2 py-1.5 text-xs">
            <span className="flex-1 min-w-0 truncate" title={r.descricao}><b>{r.numero}</b> · {r.descricao}</span>
            <select aria-label={`Grupo da rubrica ${r.numero}`} className={sel} value={m[r.numero] || ''} onChange={e => setM({ ...m, [r.numero]: e.target.value })}>
              <option value="">Automático ({ROTULO_SUBGRUPO[subgrupoDaRubrica(r)]})</option>
              {SUBGRUPOS.map(g => <option key={g.id} value={g.id}>{g.rotulo}</option>)}
            </select>
          </div>
        ))}
      </div>
    </Modal>
  );
};

/** Juntar um fornecedor a outro (nomes escritos de forma diferente na nota de empenho). Só administrador. */
export const JuntarFornecedor: React.FC<{ origem: Fornecedor; todos: Fornecedor[]; onSalvar: (alvoNome: string) => Promise<void>; onClose: () => void }> = ({ origem, todos, onSalvar, onClose }) => {
  const [alvo, setAlvo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const outros = todos.filter(f => f.chave !== origem.chave);
  const gravar = async () => { setSalvando(true); try { await onSalvar(alvo); onClose(); } finally { setSalvando(false); } };
  return (
    <Modal isOpen onClose={onClose} title="Juntar fornecedores" maxWidth="max-w-lg" footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={gravar} isLoading={salvando} disabled={!alvo}>Juntar</Button></div>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Os empenhos de <b>{origem.nome}</b> passam a ser somados ao fornecedor escolhido. Nenhuma nota de empenho é alterada: é só a forma de agrupar nesta página, e dá para desfazer.</p>
        <label className="block text-xs font-semibold text-slate-600">Juntar com
          <select aria-label="Fornecedor de destino" className={`${sel} block mt-1 w-full`} value={alvo} onChange={e => setAlvo(e.target.value)}>
            <option value="">escolher…</option>
            {outros.map(f => <option key={f.chave} value={f.nome}>{f.nome}</option>)}
          </select></label>
      </div>
    </Modal>
  );
};
