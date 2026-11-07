import React, { useEffect, useMemo, useState } from 'react';
import { PARAM_NORMAS, normasDe } from '../../utils/normas';
import { Edit, Plus, Save, Trash2 } from 'lucide-react';
import { Feriado, OM, Parametro, ServicoCatalogo, TipoFeriado } from '../../types';
import { PARAM_EMISSORA, PARAM_EMISSORA_RATEIO, resolverEmissora } from '../../utils/emissora';
import { cadastroService } from '../../services/cadastroService';
import { notify, friendlyError } from '../../utils/notify';
import { somarDiasUteis, formatarDataBR, datasDaFatura } from '../../utils/diasUteis';
import { Modal } from '../ui/Modal';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { Situacao, Td, Th, hoje } from './comum';
import { DadosCadastro } from './useCadastros';

interface Props { dados: DadosCadastro; podeEditar: boolean; recarregar: () => Promise<void> }

// ------------------------------------------------------------------ Serviços
export const ServicosTab: React.FC<Props> = ({ dados, podeEditar, recarregar }) => {
  const [form, setForm] = useState<Partial<ServicoCatalogo> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    if (!form) return;
    setErro(null);
    if (!/^[A-Z]{2}$/.test((form.acronym || '').trim().toUpperCase())) return setErro('A sigla deve ter 2 letras (ex.: AE). Ela compõe o número da fatura.');
    if (!form.name?.trim()) return setErro('Informe o nome.');
    const dup = dados.servicos.find(s => s.id !== form.id && s.acronym.toUpperCase() === form.acronym!.trim().toUpperCase());
    if (dup) return setErro(`A sigla ${dup.acronym} já é usada por "${dup.name}".`);
    setSalvando(true);
    try { await cadastroService.saveServico(form); notify.success('Serviço salvo.'); setForm(null); await recarregar(); }
    catch (e) { setErro(friendlyError(e)); } finally { setSalvando(false); }
  };

  const campo = (k: keyof ServicoCatalogo, label: string, placeholder?: string) => (
    <Input label={label} value={(form?.[k] as string) || ''} onChange={e => setForm({ ...form!, [k]: e.target.value })} placeholder={placeholder} />
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-2">
        <p className="text-xs text-slate-500">Textos usados na fatura (modelo FR-172, anexos da norma vigente), setor responsável e prazos de envio dos dados de cada serviço.</p>
        {podeEditar && <Button size="sm" onClick={() => { setErro(null); setForm({ ativo: true, ordem: 200 }); }}><Plus size={14} className="mr-1" /> Novo serviço</Button>}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50"><tr><Th>Sigla</Th><Th>Serviço / texto na fatura</Th><Th>Unid.</Th><Th>Setor responsável</Th><Th>Prazo dos dados</Th><Th>Modelo / critério</Th><Th>Situação</Th>{podeEditar && <Th right>Ações</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {dados.servicos.map(s => (
              <tr key={s.id} className="hover:bg-slate-50">
                <Td className="font-mono font-bold">{s.acronym}</Td>
                <Td><div className="font-medium text-slate-900">{s.name}</div><div className="text-[11px] text-slate-500">{s.nomeOficial || '—'}{s.emitidaDeAcordoCom && ` · emitida de acordo com ${s.emitidaDeAcordoCom.toLowerCase()}`}</div></Td>
                <Td className="text-xs">{s.unitMeasure || '—'}</Td>
                <Td className="text-xs">{s.setorResponsavel || '—'}{s.telefoneSetor && <div className="text-slate-400">{s.telefoneSetor}</div>}</Td>
                <Td className="text-xs">{s.prazoEnvio || '—'}</Td>
                <Td className="text-xs">{[s.anexoOi, s.criterio].filter(Boolean).join(' · ') || '—'}</Td>
                <Td><Situacao ativo={s.ativo !== false} /></Td>
                {podeEditar && <Td className="text-right"><button onClick={() => { setErro(null); setForm({ ...s }); }} className="p-1.5 text-slate-400 hover:text-primary-600" title="Editar"><Edit size={15} /></button></Td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal isOpen={!!form} onClose={() => !salvando && setForm(null)} title={form?.id ? `Editar serviço ${form.acronym || ''}` : 'Novo serviço'} maxWidth="max-w-2xl">
        {form && (
          <div className="space-y-3">
            {erro && <div className="p-2 text-xs rounded bg-red-50 text-red-700 border border-red-100" role="alert">{erro}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input label="Sigla" maxLength={2} value={form.acronym || ''} onChange={e => setForm({ ...form, acronym: e.target.value.toUpperCase() })} placeholder="AE" disabled={!!form.id} title={form.id ? 'A sigla compõe os números das faturas já emitidas e não pode ser alterada' : undefined} />
              {campo('name', 'Nome curto', 'Água e Esgoto')}
              {campo('unitMeasure', 'Unidade de medida', 'M³')}
            </div>
            {campo('nomeOficial', '"Serviço prestado" na fatura', 'FORNECIMENTO DE ÁGUA POTÁVEL E COLETA DE ESGOTO')}
            {campo('emitidaDeAcordoCom', '"Emitida de acordo com"', 'O DETALHAMENTO NO CAMPO OBSERVAÇÃO')}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {campo('setorResponsavel', 'Setor responsável pelos dados', 'Divisão de Serviços Auxiliares')}
              {campo('telefoneSetor', 'Telefone para dúvidas', '8110-3376 (RETELMA)')}
              {campo('prazoEnvio', 'Prazo de envio dos dados', 'Até o dia 10')}
              {campo('anexoOi', 'Modelo (anexo da OI)', 'Anexo C')}
            </div>
            {campo('criterio', 'Critério de cobrança')}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Ordem" type="number" value={form.ordem ?? 100} onChange={e => setForm({ ...form, ordem: Number(e.target.value) })} />
              <Select label="Situação" options={[{ value: 'S', label: 'Ativo' }, { value: 'N', label: 'Desativado' }]} value={form.ativo === false ? 'N' : 'S'} onChange={e => setForm({ ...form, ativo: e.target.value !== 'N' })} />
            </div>
            <div className="flex justify-end gap-2 pt-1"><Button variant="ghost" onClick={() => setForm(null)} disabled={salvando}>Cancelar</Button><Button onClick={salvar} isLoading={salvando}>Salvar</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
};

// --------------------------------------------------- Norma (OI) citada nos textos do faturamento
const NormaCard: React.FC<{ params: Parametro[]; podeEditar: boolean; gravado: () => void }> = ({ params, podeEditar, gravado }) => {
  const atual = normasDe(params);
  const [n, setN] = useState(atual);
  const [salvando, setSalvando] = useState(false);
  // só recarrega o que veio do banco enquanto o usuário não digitou (senão a digitação se perderia)
  const [digitou, setDigitou] = useState(false);
  useEffect(() => { if (!digitou) setN(normasDe(params)); }, [params, digitou]);
  const edita = (p: Partial<typeof n>) => { setDigitou(true); setN(x => ({ ...x, ...p })); };
  const mudou = n.nome !== atual.nome || n.itemPrazo !== atual.itemPrazo || n.itemCorrecao !== atual.itemCorrecao;
  const gravar = async () => {
    if (!n.nome.trim()) return notify.error('Informe o nome da norma.');
    setSalvando(true);
    try {
      await cadastroService.saveParametro({ chave: PARAM_NORMAS.nome, valor: n.nome.trim(), descricao: 'Norma (OI) citada nos textos do faturamento' });
      await cadastroService.saveParametro({ chave: PARAM_NORMAS.itemPrazo, valor: n.itemPrazo.trim(), descricao: 'Item da norma sobre o prazo de certificação' });
      await cadastroService.saveParametro({ chave: PARAM_NORMAS.itemCorrecao, valor: n.itemCorrecao.trim(), descricao: 'Item da norma sobre a correção por atraso' });
      notify.success('Norma gravada.'); setDigitou(false); gravado();
    } catch (e) { notify.fail('Erro ao gravar a norma', e); } finally { setSalvando(false); }
  };
  return (
    <div className="p-4 rounded-lg border border-slate-200 bg-white">
      <h4 className="text-sm font-semibold text-slate-800 mb-1">Norma citada nas faturas e no faturamento</h4>
      <p className="text-xs text-slate-500 mb-3">A norma (OI) e seus itens mudam; aqui você atualiza o nome e os itens citados nos textos das faturas, no PDF e nas telas. O setor responsável de cada lançamento é cadastrado em <b>Serviços</b> (ou direto na aba de medições e de atracação).</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
        <Input label="Norma (nome)" value={n.nome} onChange={e => edita({ nome: e.target.value })} disabled={!podeEditar} placeholder="OI 40-04" />
        <Input label="Item do prazo de certificação" value={n.itemPrazo} onChange={e => edita({ itemPrazo: e.target.value })} disabled={!podeEditar} placeholder="6.1" />
        <Input label="Item da correção por atraso" value={n.itemCorrecao} onChange={e => edita({ itemCorrecao: e.target.value })} disabled={!podeEditar} placeholder="6.2" />
      </div>
      {podeEditar && <div className="mt-3 flex justify-end"><Button size="sm" onClick={gravar} isLoading={salvando} disabled={!mudou}>Gravar norma</Button></div>}
    </div>
  );
};

// --------------------------------------------------- Parâmetros e feriados
const TIPOS_FERIADO: { value: TipoFeriado; label: string }[] = [
  { value: 'NACIONAL', label: 'Nacional' }, { value: 'ESTADUAL', label: 'Estadual (RJ)' },
  { value: 'MUNICIPAL', label: 'Municipal (Rio)' }, { value: 'PONTO_FACULTATIVO', label: 'Ponto facultativo' },
];

export const ParametrosTab: React.FC<{ podeEditar: boolean; oms?: OM[] }> = ({ podeEditar, oms = [] }) => {
  const [params, setParams] = useState<Parametro[]>([]);
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [novo, setNovo] = useState<Feriado>({ data: '', descricao: '', tipo: 'NACIONAL' });
  const [emissao, setEmissao] = useState(hoje());
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try {
      const [p, f] = await Promise.all([cadastroService.listParametros(), cadastroService.listFeriados()]);
      setParams(p); setFeriados(f); setEditados({});
    } catch (e) { notify.fail('Erro ao carregar parâmetros', e); }
  };
  useEffect(() => { carregar(); }, []);

  const prazo = Number(params.find(p => p.chave === 'prazo_certificacao_dias_uteis')?.valor) || 10;
  const prazoVenc = Number(params.find(p => p.chave === 'prazo_vencimento_dias_corridos')?.valor) || 30;
  const dataLimite = useMemo(() => (emissao ? somarDiasUteis(emissao, prazo, feriados.map(f => f.data)) : ''), [emissao, prazo, feriados]);
  const vencimento = useMemo(() => (emissao ? datasDaFatura(emissao, { prazoCertificacao: prazo, prazoVencimento: prazoVenc, feriados: feriados.map(f => f.data) }).vencimento : ''), [emissao, prazo, prazoVenc, feriados]);
  const anos = [...new Set([...feriados.map(f => f.data.slice(0, 4)), ano])].sort();
  const doAno = feriados.filter(f => f.data.startsWith(ano));

  const salvarParams = async () => {
    setSalvando(true);
    try {
      for (const [chave, valor] of Object.entries(editados)) await cadastroService.saveParametro({ chave, valor });
      notify.success('Parâmetros salvos.');
      await carregar();
    } catch (e) { notify.fail('Erro ao salvar parâmetros', e); } finally { setSalvando(false); }
  };

  const incluirFeriado = async () => {
    if (!novo.data || !novo.descricao.trim()) return notify.error('Informe a data e a descrição do feriado.');
    try { await cadastroService.saveFeriado({ ...novo, descricao: novo.descricao.trim() }); setNovo({ data: '', descricao: '', tipo: 'NACIONAL' }); await carregar(); }
    catch (e) { notify.fail('Erro ao incluir feriado', e); }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      <section className="xl:col-span-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Parâmetros do faturamento</h3>
          {podeEditar && <Button size="sm" onClick={salvarParams} isLoading={salvando} disabled={Object.keys(editados).length === 0}><Save size={14} className="mr-1" /> Salvar alterações</Button>}
        </div>
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
          {params.filter(p => p.chave !== PARAM_EMISSORA && p.chave !== PARAM_EMISSORA_RATEIO && !Object.values(PARAM_NORMAS).includes(p.chave as any)).map(p => (
            <div key={p.chave} className="p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
              <div className="md:col-span-2"><div className="text-sm font-medium text-slate-800">{p.descricao || p.chave}</div><div className="text-[11px] font-mono text-slate-400">{p.chave}</div></div>
              <input
                aria-label={p.descricao || p.chave}
                className="md:col-span-3 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50"
                value={editados[p.chave] ?? p.valor}
                onChange={e => setEditados({ ...editados, [p.chave]: e.target.value })}
                disabled={!podeEditar}
              />
            </div>
          ))}
          {params.length === 0 && <div className="p-6 text-center text-sm text-slate-400 italic">Nenhum parâmetro carregado.</div>}
        </div>

        <EmissoraCard oms={oms} params={params} podeEditar={podeEditar} gravado={carregar} />
        <NormaCard params={params} podeEditar={podeEditar} gravado={carregar} />

        <div className="p-4 rounded-lg border border-sky-200 bg-sky-50/60">
          <h4 className="text-sm font-semibold text-sky-900 mb-2">Certificação e vencimento da fatura</h4>
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-44"><Input label="Data de emissão" type="date" value={emissao} onChange={e => setEmissao(e.target.value)} /></div>
            <div className="text-sm text-sky-900 pb-2">Certificação no SIPLAD (+ {prazo} dias úteis): <b className="text-base tabular-nums">{formatarDataBR(dataLimite)}</b></div>
            <div className="text-sm text-sky-900 pb-2">Vencimento (+ {prazoVenc} dias corridos): <b className="text-base tabular-nums">{formatarDataBR(vencimento)}</b></div>
          </div>
          <p className="text-[11px] text-sky-800/80 mt-2">Certificação não conta sábados, domingos nem feriados. Vencimento conta dias corridos e, se cair em fim de semana ou feriado, passa para o próximo dia útil. Faturas OND vencem na data de certificação.</p>
        </div>
      </section>

      <section className="xl:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-800">Feriados e pontos facultativos</h3>
          <select aria-label="Ano" value={ano} onChange={e => setAno(e.target.value)} className="h-8 text-sm rounded-md border border-slate-300 px-2 bg-white">
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50"><tr><Th>Data</Th><Th>Descrição</Th><Th>Tipo</Th>{podeEditar && <Th right> </Th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {doAno.map(f => (
                <tr key={f.data}>
                  <Td className="tabular-nums whitespace-nowrap">{formatarDataBR(f.data)}</Td>
                  <Td>{f.descricao}</Td>
                  <Td className="text-xs">{TIPOS_FERIADO.find(t => t.value === f.tipo)?.label}</Td>
                  {podeEditar && <Td className="text-right"><button onClick={async () => { await cadastroService.deleteFeriado(f.data); await carregar(); }} className="p-1 text-slate-400 hover:text-red-600" title="Remover"><Trash2 size={14} /></button></Td>}
                </tr>
              ))}
              {doAno.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-sm text-slate-400 italic">Nenhum feriado cadastrado para {ano}.</td></tr>}
            </tbody>
          </table>
        </div>
        {podeEditar && (
          <div className="grid grid-cols-2 gap-2 items-end p-3 border border-dashed border-slate-300 rounded-lg">
            <Input label="Data" type="date" value={novo.data} onChange={e => setNovo({ ...novo, data: e.target.value })} />
            <Select label="Tipo" options={TIPOS_FERIADO} value={novo.tipo} onChange={e => setNovo({ ...novo, tipo: (e.target.value || 'NACIONAL') as TipoFeriado })} />
            <div className="col-span-2"><Input label="Descrição" value={novo.descricao} onChange={e => setNovo({ ...novo, descricao: e.target.value })} placeholder="Ex.: Ponto facultativo – véspera de Natal" /></div>
            <div className="col-span-2 flex justify-end"><Button size="sm" variant="secondary" onClick={incluirFeriado}><Plus size={14} className="mr-1" /> Incluir data</Button></div>
          </div>
        )}
      </section>
    </div>
  );
};

// ------------------------------------------------------------------ OM emissora
/** OM responsável pela emissão das faturas (BNIC): pode ser trocada e participar ou não dos rateios. Nunca recebe fatura. */
const EmissoraCard: React.FC<{ oms: OM[]; params: Parametro[]; podeEditar: boolean; gravado: () => Promise<void> }> = ({ oms, params, podeEditar, gravado }) => {
  const atual = useMemo(() => resolverEmissora(oms, params), [oms, params]);
  const [omId, setOmId] = useState<string | null>(null);
  const [participa, setParticipa] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);
  const id = omId ?? atual.omId ?? '';
  const part = participa ?? atual.participaRateio;
  const mudou = id !== (atual.omId ?? '') || part !== atual.participaRateio || (!atual.definidaNosParametros && !!id);
  const opcoes = useMemo(() => oms.filter(o => o.ativo && o.tipo !== 'NAVIO').sort((a, b) => a.nome.localeCompare(b.nome)), [oms]);
  const salvar = async () => {
    if (!id) return notify.error('Escolha a OM emissora.');
    setSalvando(true);
    try {
      await cadastroService.saveParametro({ chave: PARAM_EMISSORA, valor: id, descricao: 'OM responsável pela emissão das faturas (não recebe fatura)' });
      await cadastroService.saveParametro({ chave: PARAM_EMISSORA_RATEIO, valor: part ? 'SIM' : 'NAO', descricao: 'A OM emissora participa dos rateios (controle e contabilidade de custos)' });
      notify.success('OM emissora gravada.');
      setOmId(null); setParticipa(null);
      await gravado();
    } catch (e) { notify.fail('Erro ao gravar a OM emissora', e); } finally { setSalvando(false); }
  };
  return (
    <div className="p-4 rounded-lg border border-indigo-200 bg-indigo-50/50 space-y-2">
      <h4 className="text-sm font-semibold text-indigo-900">OM responsável pela emissão das faturas</h4>
      <p className="text-xs text-indigo-900/80">A OM emissora faz os rateios e emite as faturas. Ela <b>não é cliente de si mesma</b>: nunca recebe fatura. Quando participa dos rateios, a parte dela fica registrada só para <b>controle e contabilidade de custos</b>.</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600 flex flex-col gap-1 min-w-[280px] flex-1">OM emissora
          <select aria-label="OM emissora" disabled={!podeEditar} className="text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={id} onChange={e => setOmId(e.target.value)}>
            <option value="">— escolha —</option>
            {opcoes.map(o => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}{o.sigla ? ` (${o.sigla})` : ''}</option>)}
          </select>
        </label>
        <fieldset className="text-sm flex gap-3 pb-1.5" disabled={!podeEditar}>
          <label className="flex items-center gap-1"><input type="radio" name="emissora-rateio" checked={part} onChange={() => setParticipa(true)} />Participa dos rateios</label>
          <label className="flex items-center gap-1"><input type="radio" name="emissora-rateio" checked={!part} onChange={() => setParticipa(false)} />Não participa</label>
        </fieldset>
        {podeEditar && <Button size="sm" onClick={salvar} isLoading={salvando} disabled={!mudou}><Save size={14} className="mr-1" />Gravar</Button>}
      </div>
      <p className="text-[11px] text-indigo-900/70">
        {!atual.definidaNosParametros && atual.omId && <>Sugestão automática: {atual.nome} (pela sigla/nome BNIC). Grave para confirmar. </>}
        {!atual.omId && <span className="text-red-700">Nenhuma OM emissora encontrada no cadastro: escolha uma. </span>}
        Participa: a OM entra na taxa condominial e nas medições como as demais, mas o lote de faturas a deixa de fora. Não participa: a parte dela na taxa condominial é dividida entre as outras OM.
      </p>
    </div>
  );
};
