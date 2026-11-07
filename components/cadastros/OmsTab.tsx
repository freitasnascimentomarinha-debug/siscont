import React, { useMemo, useState } from 'react';
import { Edit, Plus, Power, RotateCcw, Trash2 } from 'lucide-react';
import { AREAS_CNIC, OM, TIPO_OM_LABELS, TipoOM } from '../../types';
import { cadastroService } from '../../services/cadastroService';
import { notify, friendlyError } from '../../utils/notify';
import { Modal } from '../ui/Modal';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { Busca, DesativarModal, Filtro, Situacao, Td, Th } from './comum';
import { DadosCadastro } from './useCadastros';
import { chave } from '../../utils/cadastroImport';

const TIPO_COR: Record<TipoOM, string> = {
  TERRA: 'bg-sky-100 text-sky-800',
  NAVIO: 'bg-indigo-100 text-indigo-800',
  EXTRA_MB: 'bg-amber-100 text-amber-800',
};

const vazio = (): Partial<OM> => ({ tipo: 'TERRA', ativo: true });

export const OmsTab: React.FC<{ dados: DadosCadastro; podeEditar: boolean; recarregar: () => Promise<void> }> = ({ dados, podeEditar, recarregar }) => {
  const [busca, setBusca] = useState('');
  const [fTipo, setFTipo] = useState('');
  const [fSetor, setFSetor] = useState('');
  const [fSituacao, setFSituacao] = useState('ATIVAS');
  const [form, setForm] = useState<Partial<OM> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [desativar, setDesativar] = useState<OM | null>(null);
  const [excluir, setExcluir] = useState<OM | null>(null);

  const cmd = useMemo(() => new Map(dados.comandos.map(c => [c.id, c])), [dados.comandos]);
  const set = useMemo(() => new Map(dados.setores.map(s => [s.id, s])), [dados.setores]);
  const cls = useMemo(() => new Map(dados.classes.map(c => [c.id, c])), [dados.classes]);
  const setorDe = (o: Partial<OM>) => {
    const id = o.setorId || (o.comandoId ? cmd.get(o.comandoId)?.setorId : null);
    return id ? set.get(id)?.sigla || '' : '';
  };

  const lista = useMemo(() => {
    const q = chave(busca);
    return dados.oms.filter(o => {
      if (fSituacao === 'ATIVAS' && !o.ativo) return false;
      if (fSituacao === 'DESATIVADAS' && o.ativo) return false;
      if (fTipo && o.tipo !== fTipo) return false;
      if (fSetor && setorDe(o) !== fSetor) return false;
      if (!q) return true;
      const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
      return chave(`${o.codigo} ${o.nome} ${o.sigla || ''} ${o.indicativoNaval || ''} ${c?.nome || ''}`).includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados.oms, busca, fTipo, fSetor, fSituacao, cmd]);

  const salvar = async () => {
    if (!form) return;
    setErro(null);
    if (!form.nome?.trim()) return setErro('Informe o nome.');
    if (!/^\d{4,6}$/.test(form.codigo?.trim() || '')) return setErro('O código deve ter de 4 a 6 dígitos (normalmente 5, ex.: 40002).');
    if (form.tipo !== 'EXTRA_MB' && !form.comandoId) return setErro('Selecione o comando (ComImSup).');
    if (form.tipo === 'EXTRA_MB' && !form.setorId) form.setorId = dados.setores.find(s => s.sigla === 'EXTRA-MB')?.id;
    const dup = dados.oms.find(o => o.id !== form.id && o.codigo === form.codigo?.trim() && chave(o.nome) === chave(form.nome));
    if (dup) return setErro(`Já existe "${dup.nome}" com o código ${dup.codigo}.`);
    setSalvando(true);
    try {
      await cadastroService.saveOM(form);
      notify.success(form.id ? 'OM atualizada.' : 'OM cadastrada.');
      setForm(null);
      await recarregar();
    } catch (e) {
      setErro(friendlyError(e));
    } finally {
      setSalvando(false);
    }
  };

  const reativar = async (o: OM) => {
    try {
      await cadastroService.saveOM({ ...o, ativo: true, desativadoEm: null, motivoDesativacao: null });
      notify.success(`${o.nome} reativada.`);
      await recarregar();
    } catch (e) { notify.fail('Erro ao reativar', e); }
  };

  const confirmarExclusao = async () => {
    if (!excluir) return;
    try {
      if (await cadastroService.omTemMovimento(excluir.id)) {
        notify.error(`${excluir.nome} possui faturas e não pode ser excluída. Use "Desativar" para manter o histórico.`);
      } else {
        await cadastroService.deleteOM(excluir.id);
        notify.success(`${excluir.nome} excluída.`);
        await recarregar();
      }
    } catch (e) { notify.fail('Erro ao excluir', e); }
    setExcluir(null);
  };

  const comandosOrdenados = [...dados.comandos].filter(c => c.ativo || c.id === form?.comandoId)
    .sort((a, b) => (a.codigo || 'zz').localeCompare(b.codigo || 'zz'));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2 items-center">
          <Busca value={busca} onChange={setBusca} placeholder="Código, nome, sigla ou comando" />
          <Filtro label="Tipo" value={fTipo} onChange={setFTipo} options={[{ value: '', label: 'Todos os tipos' }, ...Object.entries(TIPO_OM_LABELS).map(([v, l]) => ({ value: v, label: l }))]} />
          <Filtro label="Setor" value={fSetor} onChange={setFSetor} options={[{ value: '', label: 'Todos os setores' }, ...dados.setores.map(s => ({ value: s.sigla, label: s.sigla }))]} />
          <Filtro label="Situação" value={fSituacao} onChange={setFSituacao} options={[{ value: 'ATIVAS', label: 'Ativas' }, { value: 'DESATIVADAS', label: 'Desativadas' }, { value: '', label: 'Todas' }]} />
          <span className="text-xs text-slate-500">{lista.length} de {dados.oms.length}</span>
        </div>
        {podeEditar && <Button size="sm" onClick={() => { setErro(null); setForm(vazio()); }}><Plus size={14} className="mr-1" /> Nova OM / cliente</Button>}
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50"><tr><Th>Código</Th><Th>Nome</Th><Th>Tipo</Th><Th>Comando</Th><Th>Setor</Th><Th>Classe / lotação</Th><Th>Situação</Th>{podeEditar && <Th right>Ações</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {lista.map(o => {
              const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
              return (
                <tr key={o.id} className={o.ativo ? 'hover:bg-slate-50' : 'bg-slate-50/60 text-slate-500'}>
                  <Td className="font-mono font-semibold">{o.codigo}</Td>
                  <Td>
                    <div className="font-medium text-slate-900">{o.nome}</div>
                    {(o.sigla || o.indicativoNaval) && <div className="text-xs text-slate-500">{[o.sigla, o.indicativoNaval && `Ind. ${o.indicativoNaval}`].filter(Boolean).join(' · ')}</div>}
                  </Td>
                  <Td><span className={`px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap ${TIPO_COR[o.tipo]}`}>{TIPO_OM_LABELS[o.tipo]}</span></Td>
                  <Td className="text-xs">{c ? `${c.codigo ? c.codigo + ' - ' : ''}${c.nome}` : '—'}</Td>
                  <Td className="text-xs font-semibold">{setorDe(o) || '—'}</Td>
                  <Td className="text-xs">{[o.classeId && cls.get(o.classeId)?.nome, o.lotacao != null && `${o.lotacao} militares`, o.areaCnic && `Área ${o.areaCnic}`].filter(Boolean).join(' · ') || '—'}</Td>
                  <Td><Situacao ativo={o.ativo} desde={o.desativadoEm} motivo={o.motivoDesativacao} /></Td>
                  {podeEditar && (
                    <Td className="text-right whitespace-nowrap">
                      <button onClick={() => { setErro(null); setForm({ ...o }); }} className="p-1.5 text-slate-400 hover:text-primary-600" title="Editar"><Edit size={15} /></button>
                      {o.ativo
                        ? <button onClick={() => setDesativar(o)} className="p-1.5 text-slate-400 hover:text-amber-600" title="Desativar (mantém o histórico)"><Power size={15} /></button>
                        : <button onClick={() => reativar(o)} className="p-1.5 text-slate-400 hover:text-emerald-600" title="Reativar"><RotateCcw size={15} /></button>}
                      <button onClick={() => setExcluir(o)} className="p-1.5 text-slate-400 hover:text-red-600" title="Excluir (só sem faturas)"><Trash2 size={15} /></button>
                    </Td>
                  )}
                </tr>
              );
            })}
            {lista.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-sm text-slate-400 italic">Nenhuma OM encontrada. {dados.oms.length === 0 && 'Use a aba "Importar planilhas" para trazer o cadastro das suas planilhas.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!form} onClose={() => !salvando && setForm(null)} title={form?.id ? 'Editar OM / cliente' : 'Nova OM / cliente'} maxWidth="max-w-2xl">
        {form && (
          <div className="space-y-4">
            {erro && <div className="p-2 text-xs rounded bg-red-50 text-red-700 border border-red-100" role="alert">{erro}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Código (5 dígitos)" inputMode="numeric" maxLength={6} value={form.codigo || ''} onChange={e => setForm({ ...form, codigo: e.target.value.replace(/\D/g, '') })} placeholder="40002" />
              <div className="sm:col-span-2"><Input label="Nome" value={form.nome || ''} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Corveta Barroso" /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select label="Tipo" options={Object.entries(TIPO_OM_LABELS).map(([v, l]) => ({ value: v, label: l }))} value={form.tipo || 'TERRA'} onChange={e => setForm({ ...form, tipo: e.target.value as TipoOM })} />
              <Input label="Sigla" value={form.sigla || ''} onChange={e => setForm({ ...form, sigla: e.target.value })} placeholder="Ex.: CvBarroso" />
              <Input label="Indicativo naval" value={form.indicativoNaval || ''} onChange={e => setForm({ ...form, indicativoNaval: e.target.value.toUpperCase() })} placeholder="Ex.: COMEST" />
            </div>
            {form.tipo !== 'EXTRA_MB' ? (
              <Select label="Comando (ComImSup)" options={comandosOrdenados.map(c => ({ value: c.id, label: `${c.codigo ? c.codigo + ' - ' : ''}${c.nome}` }))} value={form.comandoId || ''} onChange={e => setForm({ ...form, comandoId: e.target.value || null })} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="CNPJ" value={form.cnpj || ''} onChange={e => setForm({ ...form, cnpj: e.target.value })} placeholder="00.000.000/0000-00" />
                <Input label="Endereço" value={form.endereco || ''} onChange={e => setForm({ ...form, endereco: e.target.value })} />
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {form.tipo !== 'EXTRA_MB' && <Select label="Área do CNIC" options={Object.entries(AREAS_CNIC).map(([v, l]) => ({ value: v, label: l }))} value={form.areaCnic ? String(form.areaCnic) : ''} onChange={e => setForm({ ...form, areaCnic: e.target.value ? Number(e.target.value) : null })} />}
              {form.tipo !== 'EXTRA_MB' && <Input label={form.tipo === 'NAVIO' ? 'Tripulação (lotação)' : 'Lotação (TMFT)'} type="number" min={0} value={form.lotacao ?? ''} onChange={e => setForm({ ...form, lotacao: e.target.value === '' ? null : Number(e.target.value) })} />}
              {form.tipo === 'NAVIO' && <Select label="Classe do navio" options={dados.classes.filter(c => c.ativo || c.id === form.classeId).map(c => ({ value: c.id, label: c.nome }))} value={form.classeId || ''} onChange={e => setForm({ ...form, classeId: e.target.value || null })} />}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="E-mails para envio das faturas" value={form.emails || ''} onChange={e => setForm({ ...form, emails: e.target.value })} placeholder="separados por ;" />
              <Input label="Telefone" value={form.telefone || ''} onChange={e => setForm({ ...form, telefone: e.target.value })} />
            </div>
            <Input label="Observação" value={form.observacao || ''} onChange={e => setForm({ ...form, observacao: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button>
              <Button onClick={salvar} isLoading={salvando}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <DesativarModal
        aberto={!!desativar}
        titulo="Desativar OM / navio"
        descricao={<>Desativar <b>{desativar?.codigo} – {desativar?.nome}</b>?</>}
        onCancelar={() => setDesativar(null)}
        onConfirmar={async (data, motivo) => {
          await cadastroService.saveOM({ ...desativar!, ativo: false, desativadoEm: data, motivoDesativacao: motivo || null });
          notify.success(`${desativar!.nome} desativada.`);
          setDesativar(null);
          await recarregar();
        }}
      />

      <Modal isOpen={!!excluir} onClose={() => setExcluir(null)} title="Excluir OM">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Excluir definitivamente <b>{excluir?.codigo} – {excluir?.nome}</b>? Só é permitido para cadastro sem nenhuma fatura. Para OM ou navio que deixou de existir, prefira <b>Desativar</b>.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setExcluir(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarExclusao}>Excluir</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
