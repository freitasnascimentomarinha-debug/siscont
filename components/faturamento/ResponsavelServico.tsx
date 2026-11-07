import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { ContextoFaturamento } from '../../services/faturamentoService';
import { cadastroService } from '../../services/cadastroService';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { entrada } from './comum';

/**
 * Setor responsável pelos dados de um serviço (quem manda a medição ou o mapa). Os setores e seus nomes mudam,
 * então não ficam no código: vêm do cadastro do serviço (Cadastros › Serviços) e podem ser corrigidos aqui mesmo.
 */
export const ResponsavelServico: React.FC<{ ctx: ContextoFaturamento; sigla: string; podeEditar: boolean; onSalvo: () => Promise<void> | void }> = ({ ctx, sigla, podeEditar, onSalvo }) => {
  const s = ctx.servicos.find(x => x.sigla === sigla);
  const [editando, setEditando] = useState(false);
  const [setor, setSetor] = useState('');
  const [tel, setTel] = useState('');
  const [salvando, setSalvando] = useState(false);

  const abrir = () => { setSetor(s?.responsavel || ''); setTel(s?.telefone || ''); setEditando(true); };
  const salvar = async () => {
    setSalvando(true);
    try {
      const todos = await cadastroService.listServicos();
      const atual = todos.find(x => x.acronym.toUpperCase() === sigla);
      if (!atual) throw new Error(`Serviço ${sigla} não encontrado no cadastro.`);
      await cadastroService.saveServico({ ...atual, setorResponsavel: setor.trim(), telefoneSetor: tel.trim() });
      notify.success(`Responsável de ${sigla} gravado.`);
      setEditando(false);
      await onSalvo();
    } catch (e) { notify.fail('Não foi possível gravar o responsável', e); } finally { setSalvando(false); }
  };

  if (!s) return null;
  if (editando) return (
    <div className="flex flex-wrap items-end gap-2 p-2 rounded-lg border border-primary-200 bg-primary-50/40 text-xs">
      <label className="flex flex-col gap-1 text-slate-600">Setor responsável pelos dados ({sigla})
        <input className={`${entrada} w-72`} value={setor} onChange={e => setSetor(e.target.value)} aria-label={`Setor responsável de ${sigla}`} placeholder="ex.: Divisão de Eletricidade" autoFocus /></label>
      <label className="flex flex-col gap-1 text-slate-600">Telefone / ramal
        <input className={`${entrada} w-44`} value={tel} onChange={e => setTel(e.target.value)} aria-label={`Telefone do setor de ${sigla}`} /></label>
      <Button size="sm" onClick={salvar} isLoading={salvando}>Gravar</Button>
      <Button size="sm" variant="ghost" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</Button>
    </div>
  );
  return (
    <p className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
      <span><b>Responsável pelos dados de {s.nome}:</b> {s.responsavel ? <>{s.responsavel}{s.telefone ? ` · ${s.telefone}` : ''}</> : <span className="text-amber-700">não cadastrado</span>}</span>
      {podeEditar && <button type="button" className="text-primary-700 underline inline-flex items-center gap-1" onClick={abrir}><Pencil size={11} />{s.responsavel ? 'alterar' : 'cadastrar'}</button>}
    </p>
  );
};
