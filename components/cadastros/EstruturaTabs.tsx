import React, { useMemo, useState } from 'react';
import { Edit, Plus, Power, RotateCcw, Trash2 } from 'lucide-react';
import { ClasseNavio, Comando, Setor } from '../../types';
import { cadastroService } from '../../services/cadastroService';
import { notify, friendlyError } from '../../utils/notify';
import { chave } from '../../utils/cadastroImport';
import { Modal } from '../ui/Modal';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { Busca, DesativarModal, Situacao, Td, Th } from './comum';
import { DadosCadastro } from './useCadastros';

interface Props { dados: DadosCadastro; podeEditar: boolean; recarregar: () => Promise<void> }

const ErroForm: React.FC<{ erro: string | null }> = ({ erro }) =>
  erro ? <div className="p-2 text-xs rounded bg-red-50 text-red-700 border border-red-100" role="alert">{erro}</div> : null;

// ------------------------------------------------------------------ Comandos
export const ComandosTab: React.FC<Props> = ({ dados, podeEditar, recarregar }) => {
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState<Partial<Comando> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [desativar, setDesativar] = useState<Comando | null>(null);
  const set = useMemo(() => new Map(dados.setores.map(s => [s.id, s])), [dados.setores]);
  const qtd = useMemo(() => {
    const m = new Map<string, { ativas: number; total: number }>();
    dados.oms.forEach(o => {
      if (!o.comandoId) return;
      const c = m.get(o.comandoId) || { ativas: 0, total: 0 };
      c.total++; if (o.ativo) c.ativas++;
      m.set(o.comandoId, c);
    });
    return m;
  }, [dados.oms]);
  const lista = dados.comandos.filter(c => !busca || chave(`${c.codigo || ''} ${c.nome} ${c.sigla || ''} ${c.indicativoNaval || ''}`).includes(chave(busca)))
    .sort((a, b) => (a.codigo || 'zz').localeCompare(b.codigo || 'zz'));

  const salvar = async () => {
    if (!form) return;
    setErro(null);
    if (!form.nome?.trim()) return setErro('Informe o nome.');
    if (form.codigo && !/^\d{4,6}$/.test(form.codigo)) return setErro('O código deve ter de 4 a 6 dígitos.');
    if (form.indicativoNaval && !/^[A-Z0-9]{2,8}$/.test(form.indicativoNaval)) return setErro('O indicativo naval deve ter de 2 a 8 letras ou números, sem espaços (ex.: AMRJRJ).');
    if (!form.setorId) return setErro('Selecione o setor.');
    setSalvando(true);
    try {
      await cadastroService.saveComando(form);
      notify.success('Comando salvo.');
      setForm(null);
      await recarregar();
    } catch (e) { setErro(friendlyError(e)); } finally { setSalvando(false); }
  };

  const excluir = async (c: Comando) => {
    if ((qtd.get(c.id)?.total || 0) > 0) return notify.error(`${c.nome} tem OM vinculadas. Desative em vez de excluir.`);
    try { await cadastroService.deleteComando(c.id); notify.success('Comando excluído.'); await recarregar(); } catch (e) { notify.fail('Erro ao excluir', e); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-between">
        <Busca value={busca} onChange={setBusca} placeholder="Código, nome ou indicativo" />
        {podeEditar && <Button size="sm" onClick={() => { setErro(null); setForm({ ativo: true }); }}><Plus size={14} className="mr-1" /> Novo comando</Button>}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50"><tr><Th>Código</Th><Th>Comando / ComImSup</Th><Th>Indicativo</Th><Th>Setor</Th><Th>OM vinculadas</Th><Th>Situação</Th>{podeEditar && <Th right>Ações</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {lista.map(c => (
              <tr key={c.id} className={c.ativo ? 'hover:bg-slate-50' : 'bg-slate-50/60 text-slate-500'}>
                <Td className="font-mono font-semibold">{c.codigo || <span className="text-amber-600 text-xs font-sans">sem código</span>}</Td>
                <Td><span className="font-medium text-slate-900">{c.nome}</span>{c.sigla && <span className="text-xs text-slate-500"> · {c.sigla}</span>}</Td>
                <Td className="font-mono text-xs">{c.indicativoNaval || <span className="text-slate-300">—</span>}</Td>
                <Td className="text-xs font-semibold">{(c.setorId && set.get(c.setorId)?.sigla) || '—'}</Td>
                <Td className="text-xs tabular-nums">{qtd.get(c.id)?.ativas || 0} ativas / {qtd.get(c.id)?.total || 0}</Td>
                <Td><Situacao ativo={c.ativo} desde={c.desativadoEm} motivo={c.motivoDesativacao} /></Td>
                {podeEditar && (
                  <Td className="text-right whitespace-nowrap">
                    <button onClick={() => { setErro(null); setForm({ ...c }); }} className="p-1.5 text-slate-400 hover:text-primary-600" title="Editar"><Edit size={15} /></button>
                    {c.ativo
                      ? <button onClick={() => setDesativar(c)} className="p-1.5 text-slate-400 hover:text-amber-600" title="Desativar"><Power size={15} /></button>
                      : <button onClick={async () => { await cadastroService.saveComando({ ...c, ativo: true, desativadoEm: null, motivoDesativacao: null }); await recarregar(); }} className="p-1.5 text-slate-400 hover:text-emerald-600" title="Reativar"><RotateCcw size={15} /></button>}
                    <button onClick={() => excluir(c)} className="p-1.5 text-slate-400 hover:text-red-600" title="Excluir (só sem OM vinculadas)"><Trash2 size={15} /></button>
                  </Td>
                )}
              </tr>
            ))}
            {lista.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-400 italic">Nenhum comando cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal isOpen={!!form} onClose={() => !salvando && setForm(null)} title={form?.id ? 'Editar comando' : 'Novo comando'}>
        {form && (
          <div className="space-y-4">
            <ErroForm erro={erro} />
            <div className="grid grid-cols-3 gap-3">
              <Input label="Código" inputMode="numeric" maxLength={6} value={form.codigo || ''} onChange={e => setForm({ ...form, codigo: e.target.value.replace(/\D/g, '') })} placeholder="91610" />
              <Input label="Sigla" value={form.sigla || ''} onChange={e => setForm({ ...form, sigla: e.target.value })} placeholder="ComEsqE1" />
              <Input label="Indicativo naval" maxLength={12} value={form.indicativoNaval || ''} onChange={e => setForm({ ...form, indicativoNaval: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} placeholder="COMESQE" />
            </div>
            <Input label="Nome" value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Comando do 1º Esquadrão de Escolta" />
            <Select label="Setor" options={dados.setores.map(s => ({ value: s.id, label: `${s.sigla}${s.nome ? ' – ' + s.nome : ''}` }))} value={form.setorId || ''} onChange={e => setForm({ ...form, setorId: e.target.value || null })} />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button><Button onClick={salvar} isLoading={salvando}>Salvar</Button></div>
          </div>
        )}
      </Modal>
      <DesativarModal aberto={!!desativar} titulo="Desativar comando" descricao={<>Desativar <b>{desativar?.nome}</b>? As OM vinculadas continuam como estão.</>}
        onCancelar={() => setDesativar(null)}
        onConfirmar={async (data, motivo) => { await cadastroService.saveComando({ ...desativar!, ativo: false, desativadoEm: data, motivoDesativacao: motivo || null }); setDesativar(null); await recarregar(); }} />
    </div>
  );
};

// ------------------------------------------------------------------ Setores
export const SetoresTab: React.FC<Props> = ({ dados, podeEditar, recarregar }) => {
  const [form, setForm] = useState<Partial<Setor> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const usoComandos = (id: string) => dados.comandos.filter(c => c.setorId === id).length;

  const salvar = async () => {
    if (!form) return;
    setErro(null);
    if (!form.sigla?.trim()) return setErro('Informe a sigla.');
    setSalvando(true);
    try { await cadastroService.saveSetor(form); notify.success('Setor salvo.'); setForm(null); await recarregar(); }
    catch (e) { setErro(friendlyError(e)); } finally { setSalvando(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">A ordem define a sequência nos relatórios e no lote de emissão.</p>
        {podeEditar && <Button size="sm" onClick={() => { setErro(null); setForm({ ordem: 100, ativo: true }); }}><Plus size={14} className="mr-1" /> Novo setor</Button>}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50"><tr><Th>Ordem</Th><Th>Sigla</Th><Th>Nome</Th><Th>Comandos</Th><Th>Situação</Th>{podeEditar && <Th right>Ações</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {dados.setores.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td className="tabular-nums text-xs">{s.ordem}</Td>
                <Td className="font-semibold">{s.sigla}</Td>
                <Td>{s.nome || '—'}</Td>
                <Td className="text-xs tabular-nums">{usoComandos(s.id)}</Td>
                <Td><Situacao ativo={s.ativo} /></Td>
                {podeEditar && <Td className="text-right whitespace-nowrap">
                  <button onClick={() => { setErro(null); setForm({ ...s }); }} className="p-1.5 text-slate-400 hover:text-primary-600" title="Editar"><Edit size={15} /></button>
                  <button onClick={async () => { await cadastroService.saveSetor({ ...s, ativo: !s.ativo }); await recarregar(); }} className="p-1.5 text-slate-400 hover:text-amber-600" title={s.ativo ? 'Desativar' : 'Reativar'}>{s.ativo ? <Power size={15} /> : <RotateCcw size={15} />}</button>
                </Td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal isOpen={!!form} onClose={() => !salvando && setForm(null)} title={form?.id ? 'Editar setor' : 'Novo setor'}>
        {form && (
          <div className="space-y-4">
            <ErroForm erro={erro} />
            <div className="grid grid-cols-3 gap-3">
              <Input label="Sigla" value={form.sigla || ''} onChange={e => setForm({ ...form, sigla: e.target.value })} placeholder="DGMM" />
              <div className="col-span-2"><Input label="Ordem" type="number" value={form.ordem ?? 100} onChange={e => setForm({ ...form, ordem: Number(e.target.value) })} /></div>
            </div>
            <Input label="Nome" value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })} />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button><Button onClick={salvar} isLoading={salvando}>Salvar</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ------------------------------------------------------------------ Classes
export const ClassesTab: React.FC<Props> = ({ dados, podeEditar, recarregar }) => {
  const [form, setForm] = useState<Partial<ClasseNavio> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [desativar, setDesativar] = useState<ClasseNavio | null>(null);
  const navios = (id: string) => dados.oms.filter(o => o.classeId === id);

  const salvar = async () => {
    if (!form) return;
    setErro(null);
    if (!form.nome?.trim()) return setErro('Informe o nome da classe.');
    setSalvando(true);
    try { await cadastroService.saveClasse(form); notify.success('Classe salva.'); setForm(null); await recarregar(); }
    catch (e) { setErro(friendlyError(e)); } finally { setSalvando(false); }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2">
        <p className="text-xs text-slate-500 max-w-2xl">A média trienal de dias atracados é calculada por classe, contando em cada ano só os navios ativos naquele ano. Navio desativado sai da classe a partir da data de desativação, sem perder o histórico.</p>
        {podeEditar && <Button size="sm" onClick={() => { setErro(null); setForm({ ativo: true }); }}><Plus size={14} className="mr-1" /> Nova classe</Button>}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50"><tr><Th>Classe</Th><Th>Navios ativos</Th><Th>Navios desativados</Th><Th>Situação</Th>{podeEditar && <Th right>Ações</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {dados.classes.map(c => {
              const n = navios(c.id);
              const at = n.filter(o => o.ativo), de = n.filter(o => !o.ativo);
              return (
                <tr key={c.id} className="hover:bg-slate-50">
                  <Td className="font-medium text-slate-900">{c.nome}</Td>
                  <Td className="text-xs">{at.length ? at.map(o => o.nome).join(', ') : <span className="text-slate-400">nenhum</span>}</Td>
                  <Td className="text-xs text-slate-500">{de.length ? de.map(o => o.nome).join(', ') : '—'}</Td>
                  <Td><Situacao ativo={c.ativo} desde={c.desativadoEm} /></Td>
                  {podeEditar && <Td className="text-right whitespace-nowrap">
                    <button onClick={() => { setErro(null); setForm({ ...c }); }} className="p-1.5 text-slate-400 hover:text-primary-600" title="Editar"><Edit size={15} /></button>
                    {c.ativo
                      ? <button onClick={() => setDesativar(c)} className="p-1.5 text-slate-400 hover:text-amber-600" title="Desativar"><Power size={15} /></button>
                      : <button onClick={async () => { await cadastroService.saveClasse({ ...c, ativo: true, desativadoEm: null }); await recarregar(); }} className="p-1.5 text-slate-400 hover:text-emerald-600" title="Reativar"><RotateCcw size={15} /></button>}
                    {n.length === 0 && <button onClick={async () => { try { await cadastroService.deleteClasse(c.id); await recarregar(); } catch (e) { notify.fail('Erro ao excluir', e); } }} className="p-1.5 text-slate-400 hover:text-red-600" title="Excluir (classe sem navios)"><Trash2 size={15} /></button>}
                  </Td>}
                </tr>
              );
            })}
            {dados.classes.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-sm text-slate-400 italic">Nenhuma classe cadastrada. A importação do Histórico Trienal cria as classes automaticamente.</td></tr>}
          </tbody>
        </table>
      </div>
      <Modal isOpen={!!form} onClose={() => !salvando && setForm(null)} title={form?.id ? 'Editar classe' : 'Nova classe de navio'}>
        {form && (
          <div className="space-y-4">
            <ErroForm erro={erro} />
            <Input label="Nome da classe" value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Corvetas Classe Barroso" />
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button><Button onClick={salvar} isLoading={salvando}>Salvar</Button></div>
          </div>
        )}
      </Modal>
      <DesativarModal aberto={!!desativar} titulo="Desativar classe" descricao={<>Desativar a classe <b>{desativar?.nome}</b>?</>}
        onCancelar={() => setDesativar(null)}
        onConfirmar={async (data) => { await cadastroService.saveClasse({ ...desativar!, ativo: false, desativadoEm: data }); setDesativar(null); await recarregar(); }} />
    </div>
  );
};
