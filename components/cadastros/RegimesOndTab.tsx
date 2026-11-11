import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, History, Info, Plus } from 'lucide-react';
import { Invoice } from '../../types';
import { db } from '../../services/db';
import { regimeOndService } from '../../services/regimeOndService';
import { DESCRICAO_REGIME, FatImpacto, LinhaRegime, Regime, RegimeEfetivo, impactoDaMudanca, resolverRegime, rotuloRegime } from '../../utils/regimeOnd';
import { hojeISO } from '../../utils/datas';
import { notify } from '../../utils/notify';
import { Modal } from '../ui/Modal';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { Busca, Td, Th } from './comum';
import { DadosCadastro } from './useCadastros';

const COR: Record<string, string> = { 1: 'bg-sky-100 text-sky-800', 2: 'bg-emerald-100 text-emerald-800', 3: 'bg-slate-200 text-slate-700', x: 'bg-amber-100 text-amber-800' };
const Selo: React.FC<{ r: Regime | null }> = ({ r }) => (
  <span className={`inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-bold ${COR[r ?? 'x']}`}>{r ? rotuloRegime(r) : 'Sem regra (segue como antes)'}</span>
);
const textoOrigem = (e: RegimeEfetivo) => e.origem === 'EXCECAO' ? `Exceção da OM (desde ${e.desde})` : e.origem === 'SERVICO' ? `Regra do serviço (desde ${e.desde})` : '—';
const dataHora = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

interface Alvo { escopo: 'SERVICO' | 'OM'; sigla: string; omId?: string }

/**
 * Regime de fim de exercício (OND) por serviço, com exceções por OM. A regra do serviço vale para todas as OMs que o têm;
 * a exceção vale só para a OM. Cada mudança vale a partir de um exercício e fica no histórico (nada é alterado ou apagado).
 */
export const RegimesOndTab: React.FC<{ dados: DadosCadastro; podeEditar: boolean }> = ({ dados, podeEditar }) => {
  const anoAtual = Number(hojeISO().slice(0, 4));
  const [linhas, setLinhas] = useState<LinhaRegime[]>([]);
  const [faturas, setFaturas] = useState<Invoice[]>([]);
  const [instalado, setInstalado] = useState(true);
  const [ano, setAno] = useState(anoAtual);
  const [aberto, setAberto] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [alvo, setAlvo] = useState<Alvo | null>(null);
  const [verHistorico, setVerHistorico] = useState(false);

  const carregar = useCallback(async () => {
    const [ls, fs, ok] = await Promise.all([regimeOndService.listar(), db.getInvoices(), regimeOndService.instalado()]);
    setLinhas(ls); setFaturas(fs); setInstalado(ok);
  }, []);
  useEffect(() => { carregar().catch(() => undefined); }, [carregar]);

  const omPorId = useMemo(() => new Map(dados.oms.map(o => [o.id, o])), [dados.oms]);
  /** OMs que têm o serviço: com fatura dele nos últimos 3 exercícios ou com exceção cadastrada. */
  const omsDoServico = useMemo(() => {
    const m = new Map<string, Set<string>>();
    faturas.filter(f => !f.isCanceled && f.omId && f.yearCompetence >= ano - 2 && f.yearCompetence <= ano).forEach(f => {
      const s = m.get(f.serviceAcronym) || new Set<string>(); s.add(f.omId!); m.set(f.serviceAcronym, s);
    });
    linhas.filter(l => l.escopo === 'OM' && l.omId).forEach(l => { const s = m.get(l.sigla) || new Set<string>(); s.add(l.omId!); m.set(l.sigla, s); });
    return m;
  }, [faturas, linhas, ano]);

  const resumo = useMemo(() => dados.servicos.filter(s => s.ativo !== false).map(s => {
    const geral = resolverRegime(linhas, null, s.acronym, ano);
    const oms = [...(omsDoServico.get(s.acronym) || [])];
    const efetivos = oms.map(id => ({ id, e: resolverRegime(linhas, id, s.acronym, ano) }));
    return { s, geral, oms: efetivos, excecoes: efetivos.filter(x => x.e.origem === 'EXCECAO').length };
  }), [dados.servicos, linhas, omsDoServico, ano]);

  const faturasImpacto: FatImpacto[] = useMemo(() => faturas.map(f => ({ omId: f.omId, sigla: f.serviceAcronym, ano: f.yearCompetence, mes: f.monthCompetence, estimado: !!f.estimado, acertoDe: f.acertoDe ?? null, cancelada: f.isCanceled })), [faturas]);

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 text-sm flex gap-2">
        <Info size={16} className="shrink-0 mt-0.5" />
        <div>
          <p>Define, para cada serviço, como ele é tratado no fim do exercício. A regra do serviço vale para <b>todas as OMs</b> que o têm; use a <b>exceção</b> quando uma OM seguir regra diferente.</p>
          <p className="text-xs mt-1"><b>1 – Estimativa e acerto:</b> uma fatura estimada em outubro (OUT–DEZ) e acerto em janeiro · <b>2 – Mensal normal:</b> continua faturando em out, nov e dez · <b>3 – Não participa:</b> fora da estimativa e do acerto. Serviço <b>sem regra</b> segue como antes. A mudança vale a partir do exercício informado e não recalcula exercícios anteriores.</p>
        </div>
      </div>
      {!instalado && <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm" role="alert">Falta executar o script <code>supabase/migrations/032_regime_ond.sql</code> no Supabase. Enquanto isso o faturamento segue como era antes.</div>}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40"><Select label="Exercício" value={String(ano)} onChange={e => setAno(Number(e.target.value))} options={[anoAtual - 1, anoAtual, anoAtual + 1].map(a => ({ value: String(a), label: String(a) }))} /></div>
        <p className="text-xs text-slate-500 pb-2">Mostra o regime que vale em {ano}.</p>
        <button className="ml-auto text-sm text-primary-700 hover:underline inline-flex items-center gap-1 pb-2" onClick={() => setVerHistorico(v => !v)}><History size={14} /> {verHistorico ? 'Ocultar' : 'Ver'} histórico de alterações ({linhas.length})</button>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200" data-testid="tabela-regimes">
          <thead className="bg-slate-50"><tr><Th /><Th>Serviço</Th><Th>Regra geral em {ano}</Th><Th right>OMs abrangidas</Th><Th right>Exceções</Th>{podeEditar && <Th right>Ações</Th>}</tr></thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {resumo.map(({ s, geral, oms, excecoes }) => (
              <React.Fragment key={s.id}>
                <tr className="hover:bg-slate-50">
                  <Td><button aria-label={`Ver OMs de ${s.acronym}`} onClick={() => setAberto(aberto === s.acronym ? null : s.acronym)} className="text-slate-400 hover:text-primary-600">{aberto === s.acronym ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button></Td>
                  <Td><span className="font-mono font-bold">{s.acronym}</span> <span className="text-slate-600">{s.name}</span></Td>
                  <Td><Selo r={geral.regime} />{geral.desde && <div className="text-[11px] text-slate-500 mt-0.5">vigente desde {geral.desde}</div>}</Td>
                  <Td className="text-right tabular-nums">{oms.length}</Td>
                  <Td className="text-right tabular-nums">{excecoes}</Td>
                  {podeEditar && <Td className="text-right"><Button size="sm" variant="ghost" aria-label={`Alterar regra de ${s.acronym}`} onClick={() => setAlvo({ escopo: 'SERVICO', sigla: s.acronym })}>Alterar regra</Button></Td>}
                </tr>
                {aberto === s.acronym && (
                  <tr><td colSpan={6} className="bg-slate-50/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <Busca value={busca} onChange={setBusca} placeholder="Buscar OM" />
                      {podeEditar && <Button size="sm" aria-label={`Nova exceção de ${s.acronym}`} onClick={() => setAlvo({ escopo: 'OM', sigla: s.acronym })}><Plus size={14} className="mr-1" /> Nova exceção</Button>}
                      <span className="text-xs text-slate-500">OMs com fatura de {s.acronym} nos últimos 3 exercícios ou com exceção cadastrada.</span>
                    </div>
                    <div className="overflow-x-auto border border-slate-200 rounded bg-white max-h-80 overflow-y-auto">
                      <table className="min-w-full divide-y divide-slate-100">
                        <thead className="bg-slate-50 sticky top-0"><tr><Th>UG</Th><Th>OM</Th><Th>Regime em {ano}</Th><Th>Origem</Th>{podeEditar && <Th right>Ações</Th>}</tr></thead>
                        <tbody className="divide-y divide-slate-100">
                          {oms.map(x => ({ ...x, om: omPorId.get(x.id) })).filter(x => x.om && (!busca || `${x.om.nome} ${x.om.codigo}`.toLowerCase().includes(busca.toLowerCase())))
                            .sort((a, b) => Number(b.e.origem === 'EXCECAO') - Number(a.e.origem === 'EXCECAO') || a.om!.nome.localeCompare(b.om!.nome, 'pt-BR'))
                            .map(x => (
                              <tr key={x.id} className={x.e.origem === 'EXCECAO' ? 'bg-amber-50/50' : ''}>
                                <Td className="font-mono text-xs">{x.om!.codigo}</Td><Td>{x.om!.nome}</Td><Td><Selo r={x.e.regime} /></Td><Td className="text-xs text-slate-600">{textoOrigem(x.e)}</Td>
                                {podeEditar && <Td className="text-right"><button className="text-primary-700 hover:underline text-xs font-semibold" aria-label={`Exceção de ${x.om!.nome} em ${s.acronym}`} onClick={() => setAlvo({ escopo: 'OM', sigla: s.acronym, omId: x.id })}>{x.e.origem === 'EXCECAO' ? 'alterar exceção' : 'criar exceção'}</button></Td>}
                              </tr>
                            ))}
                          {!oms.length && <tr><Td className="text-slate-500" >Nenhuma OM com fatura deste serviço.</Td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {verHistorico && (
        <div className="overflow-x-auto border border-slate-200 rounded-lg" data-testid="historico-regimes">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50"><tr><Th>Registrado em</Th><Th>Por</Th><Th>Serviço</Th><Th>OM</Th><Th>Regime</Th><Th>Vale desde</Th><Th>Motivo</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {linhas.map(l => (
                <tr key={l.id}>
                  <Td className="text-xs whitespace-nowrap">{dataHora(l.criadoEm)}</Td><Td className="text-xs">{l.origem === 'MIGRACAO' ? 'Configuração inicial' : l.criadoPorNome || '—'}</Td>
                  <Td className="font-mono font-bold">{l.sigla}</Td><Td className="text-xs">{l.escopo === 'OM' ? omPorId.get(l.omId || '')?.nome || '—' : 'Regra do serviço'}</Td>
                  <Td>{l.regime ? <Selo r={l.regime} /> : <span className="text-xs text-slate-600">volta a seguir a regra do serviço</span>}</Td><Td>{l.anoInicio}</Td><Td className="text-xs text-slate-600">{l.motivo || '—'}</Td>
                </tr>
              ))}
              {!linhas.length && <tr><Td className="text-slate-500">Nenhuma configuração registrada ainda.</Td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {alvo && <MudarRegimeModal alvo={alvo} anoAtual={anoAtual} linhas={linhas} faturas={faturasImpacto} omsDoServico={[...(omsDoServico.get(alvo.sigla) || [])]}
        nomeServico={dados.servicos.find(s => s.acronym === alvo.sigla)?.name || alvo.sigla} oms={dados.oms.map(o => ({ id: o.id, nome: `${o.codigo} · ${o.nome}` }))}
        onClose={() => setAlvo(null)} onFeito={async () => { setAlvo(null); await carregar(); }} />}
    </div>
  );
};

const MudarRegimeModal: React.FC<{
  alvo: Alvo; anoAtual: number; linhas: LinhaRegime[]; faturas: FatImpacto[]; omsDoServico: string[]; nomeServico: string; oms: { id: string; nome: string }[];
  onClose: () => void; onFeito: () => Promise<void>;
}> = ({ alvo, anoAtual, linhas, faturas, omsDoServico, nomeServico, oms, onClose, onFeito }) => {
  const [omId, setOmId] = useState(alvo.omId || '');
  const [regime, setRegime] = useState<string>('');
  const [anoInicio, setAnoInicio] = useState(String(anoAtual));
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const omDoServico = oms.filter(o => omsDoServico.includes(o.id) || o.id === omId);
  const rNum: Regime | null = regime === '1' || regime === '2' || regime === '3' ? Number(regime) as Regime : null;
  const escolheu = alvo.escopo === 'SERVICO' ? !!rNum : (!!omId && regime !== '');

  const imp = useMemo(() => escolheu ? impactoDaMudanca(linhas, { escopo: alvo.escopo, sigla: alvo.sigla, omId: omId || null, anoInicio: Number(anoInicio), regime: rNum }, omsDoServico, faturas, anoAtual) : null,
    [escolheu, linhas, alvo, omId, anoInicio, rNum, omsDoServico, faturas, anoAtual]);
  const nomeOm = (id: string) => oms.find(o => o.id === id)?.nome || id;
  const bloqueado = !!imp && (imp.erros.length > 0 || imp.bloqueios.length > 0);

  const registrar = async () => {
    if (!imp || bloqueado) return;
    setSalvando(true);
    try {
      await regimeOndService.registrar({ escopo: alvo.escopo, sigla: alvo.sigla, omId: omId || null, anoInicio: Number(anoInicio), regime: rNum, motivo });
      notify.success(alvo.escopo === 'SERVICO' ? `Regra de ${alvo.sigla} registrada a partir de ${anoInicio}.` : `Exceção registrada a partir de ${anoInicio}.`);
      await onFeito();
    } catch (e) { notify.fail('Não foi possível registrar', e); } finally { setSalvando(false); }
  };

  return (
    <Modal isOpen onClose={() => !salvando && onClose()} maxWidth="max-w-2xl"
      title={alvo.escopo === 'SERVICO' ? `Regra de fim de exercício — ${alvo.sigla} · ${nomeServico}` : `Exceção de OM — ${alvo.sigla} · ${nomeServico}`}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button><Button onClick={registrar} isLoading={salvando} disabled={!escolheu || bloqueado}>Registrar</Button></div>}>
      <div className="space-y-3 text-sm">
        {alvo.escopo === 'OM' && <Select label="OM" value={omId} onChange={e => setOmId(e.target.value)} disabled={!!alvo.omId} options={(alvo.omId ? omDoServico : oms).map(o => ({ value: o.id, label: o.nome }))} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="Regime" value={regime} onChange={e => setRegime(e.target.value)}
            options={[...(alvo.escopo === 'OM' ? [{ value: 'seguir', label: 'Seguir a regra do serviço (remove a exceção)' }] : []), ...([1, 2, 3] as Regime[]).map(r => ({ value: String(r), label: rotuloRegime(r) }))]} />
          <Select label="Vale a partir do exercício" value={anoInicio} onChange={e => setAnoInicio(e.target.value)} options={[anoAtual, anoAtual + 1, anoAtual + 2].map(a => ({ value: String(a), label: String(a) }))} />
        </div>
        {rNum && <p className="text-xs text-slate-600">{DESCRICAO_REGIME[rNum]}</p>}
        <Input label="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: a OM passou a ter faturamento mensal" />
        {imp && (
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1" data-testid="impacto-regime">
            <div className="text-xs font-semibold uppercase text-slate-600">O que muda a partir de {anoInicio}</div>
            {imp.erros.map(e => <div key={e} className="text-red-700 text-xs" role="alert">{e}</div>)}
            <div>Mudam de regime: {imp.mudam} de {imp.itens.length} OM. Faturas já emitidas, créditos e exercícios anteriores não são alterados.</div>
            {imp.itens.filter(i => i.mudou).slice(0, 6).map(i => <div key={i.omId} className="text-xs text-slate-600">{nomeOm(i.omId)}: {rotuloRegime(i.atual.regime)} → {rotuloRegime(i.novo.regime)}</div>)}
            {imp.mudam > 6 && <div className="text-xs text-slate-500">… e mais {imp.mudam - 6}.</div>}
            {imp.itens.filter(i => i.bloqueio).map(i => <div key={i.omId} className="text-xs text-red-700" role="alert">Bloqueado — {nomeOm(i.omId)}: {i.bloqueio}.</div>)}
          </div>
        )}
      </div>
    </Modal>
  );
};
