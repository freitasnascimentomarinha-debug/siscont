import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { carregarContexto, montarDados } from '../../services/faturamentoService';
import { listarLivroCreditos } from '../../services/creditosOmService';
import { cancelarApuracao } from '../../services/encerramentoService';
import { apurarOnd, mesesDoAno } from '../../utils/faturamento';
import { FiltroEncerramento, LinhaEncerramento, SITUACOES, filtrarEncerramento, indicadoresEncerramento, linhasEncerramento } from '../../utils/encerramento';
import { RELATORIOS_ENC, montarRelatorio } from '../../utils/relatoriosEncerramento';
import { MovCredito } from '../../utils/creditosOm';
import { rotuloRegime } from '../../utils/regimeOnd';
import { pdfRelatorio } from '../../utils/pdfRelatorio';
import { hojeISO } from '../../utils/datas';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Input';
import { Aviso, brl } from './comum';

const COR_SIT: Record<string, string> = {
  'Não configurado': 'bg-amber-100 text-amber-800', 'Pendente de estimativa': 'bg-amber-100 text-amber-800', 'Estimativa gerada': 'bg-sky-100 text-sky-800',
  'Aguardando subsídios reais': 'bg-orange-100 text-orange-800', 'Subsídios parcialmente lançados': 'bg-orange-100 text-orange-800', 'Pronto para apuração': 'bg-violet-100 text-violet-800',
  'Apuração realizada': 'bg-emerald-100 text-emerald-800', 'Fatura complementar gerada': 'bg-red-100 text-red-800', 'Crédito registrado': 'bg-emerald-100 text-emerald-800',
  'Sem diferença': 'bg-slate-200 text-slate-700', 'Apuração cancelada': 'bg-slate-200 text-slate-600',
};
const Selo: React.FC<{ s: string }> = ({ s }) => <span className={`inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-bold ${COR_SIT[s] || 'bg-slate-100 text-slate-700'}`}>{s}</span>;
const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/**
 * Acompanhamento do encerramento do exercício: estimativa de outubro, subsídios reais de OUT–DEZ, apuração de janeiro, créditos e débitos.
 * Só consulta (e exporta); o administrador pode cancelar uma apuração com motivo.
 */
export const EncerramentoTab: React.FC<{ admin?: boolean }> = ({ admin = false }) => {
  const anoAtual = Number(hojeISO().slice(0, 4));
  const [ano, setAno] = useState(new Date().getMonth() < 9 ? anoAtual - 1 : anoAtual);
  const [filtro, setFiltro] = useState<FiltroEncerramento>({ regime: '1' });
  const [dados, setDados] = useState<{ linhas: LinhaEncerramento[]; livro: MovCredito[]; oms: { id: string; nome: string }[]; servicos: { sigla: string; nome: string }[]; faturas: { numero: string; cancelada: boolean }[] } | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [detalhe, setDetalhe] = useState<LinhaEncerramento | null>(null);
  const [relatorio, setRelatorio] = useState<string>(RELATORIOS_ENC[0].id);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const ctx = await carregarContexto();
      const d = await montarDados(ctx, 'ACERTO', `${ano}-10`);
      const apuracao = apurarOnd({ ...d, anoOnd: ano });
      const { movs } = await listarLivroCreditos();
      const linhas = linhasEncerramento({ ano, oms: ctx.omsFat, servicos: ctx.servicos, regimes: d.regimesOnd || [], historico: d.historico, apuracao, apuracoes: d.apuracoes || [], semMovimento: d.semMovimento || [] });
      setDados({ linhas, livro: movs, oms: ctx.omsFat.map(o => ({ id: o.id, nome: o.nome })), servicos: ctx.servicos.map(s => ({ sigla: s.sigla, nome: s.nome })), faturas: d.historico.map(h => ({ numero: h.numero, cancelada: !!h.cancelada })) });
    } catch (e: any) { setErro(e?.message || 'Erro ao carregar o acompanhamento.'); } finally { setCarregando(false); }
  }, [ano]);
  useEffect(() => { carregar(); }, [carregar]);

  const filtradas = useMemo(() => (dados ? filtrarEncerramento(dados.linhas, filtro) : []), [dados, filtro]);
  const ind = useMemo(() => (dados ? indicadoresEncerramento(dados.linhas, dados.livro) : null), [dados]);
  const nomeOm = (id: string) => dados?.oms.find(o => o.id === id)?.nome || id;
  const set = (k: keyof FiltroEncerramento, v: string) => setFiltro(f => ({ ...f, [k]: v || undefined }));

  const rel = () => montarRelatorio(relatorio as any, ano, dados!.linhas, dados!.livro, nomeOm, ind!);
  const excel = () => {
    const r = rel();
    const ws = XLSX.utils.aoa_to_sheet([r.head, ...r.rows]);
    ws['!cols'] = r.head.map((h, i) => ({ wch: Math.max(12, Math.min(48, Math.max(h.length, ...r.rows.map(x => String(x[i] ?? '').length)) + 2)) }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, r.titulo.slice(0, 28).replace(/[\\/?*[\]:]/g, ' '));
    XLSX.writeFile(wb, `encerramento_${ano}_${r.id}.xlsx`);
  };
  const pdf = () => {
    const r = rel(), ehConsol = r.id === 'consolidado';
    const fmt = (v: string | number, i: number, linha: (string | number)[]) => typeof v === 'number' && r.valores.includes(i) ? (ehConsol && !/valor|crédito|débito|saldo/i.test(String(linha[0])) ? String(v) : brl(v)) : String(v);
    pdfRelatorio({
      titulo: r.titulo, linhas: [`Exercício ${ano} · gerado em ${dataBR(hojeISO())}`], orientacao: r.head.length > 6 ? 'l' : 'p', arquivo: `encerramento_${ano}_${r.id}.pdf`,
      cartoes: r.id === 'consolidado' ? undefined : [['Linhas', String(r.rows.length)]],
      tabelas: [{ titulo: r.titulo, head: r.head, body: r.rows.map(l => l.map((v, i) => fmt(v, i, l))), direita: r.valores }],
    }).save(`encerramento_${ano}_${r.id}.pdf`);
  };

  const cancelar = async (l: LinhaEncerramento) => {
    const motivo = window.prompt('Motivo do cancelamento da apuração (o acerto poderá ser apurado de novo):');
    if (!motivo?.trim() || !l.apuracao?.id) return;
    try { await cancelarApuracao(l.apuracao.id, motivo); notify.success('Apuração cancelada.'); setDetalhe(null); await carregar(); } catch (e) { notify.fail('Erro ao cancelar a apuração', e); }
  };
  const acertoAtivo = (l: LinhaEncerramento) => !!l.apuracao?.acertoNumero && dados?.faturas.some(f => f.numero === l.apuracao!.acertoNumero && !f.cancelada);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-600 max-w-3xl">Acompanha, para cada OM e serviço, a <b>estimativa de outubro</b>, os <b>subsídios reais</b> de outubro a dezembro, a <b>apuração</b> em janeiro e o <b>crédito ou débito</b> que resultou. Só consulta: nada aqui emite fatura.</p>
        <div className="flex items-end gap-2">
          <div className="w-32"><Select label="Exercício" value={String(ano)} onChange={e => setAno(Number(e.target.value))} options={[anoAtual - 2, anoAtual - 1, anoAtual, anoAtual + 1].map(a => ({ value: String(a), label: String(a) }))} /></div>
          <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />}Atualizar</Button>
        </div>
      </div>
      {erro && <Aviso tom="red">{erro}</Aviso>}

      {ind && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-testid="indicadores-encerramento">
          {[['OMs participantes', ind.omsParticipantes], ['Serviços estimados', ind.servicosEstimados], ['Faturas estimativas emitidas', ind.faturasEstimativas], ['Valor total estimado', brl(ind.valorEstimado)], ['Subsídios reais pendentes (meses)', ind.subsidiosPendentes],
            ['Apurações concluídas', ind.apuracoesConcluidas], ['Créditos gerados', brl(ind.creditosGerados)], ['Débitos complementares', brl(ind.debitosComplementares)], ['Saldo de créditos disponíveis', brl(ind.saldoCreditos)]].map(([t, v]) => (
            <div key={String(t)} className="p-3 rounded-xl border border-slate-200 bg-white"><div className="text-xs text-slate-500">{t}</div><div className="text-lg font-semibold tabular-nums">{v}</div></div>
          ))}
        </div>
      )}

      {dados && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Select label="OM" value={filtro.om || ''} onChange={e => set('om', e.target.value)} options={[...dados.oms].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(o => ({ value: o.id, label: o.nome }))} />
          <Select label="Serviço" value={filtro.servico || ''} onChange={e => set('servico', e.target.value)} options={dados.servicos.map(s => ({ value: s.sigla, label: `${s.sigla} · ${s.nome}` }))} />
          <Select label="Regime" value={filtro.regime || ''} onChange={e => set('regime', e.target.value)} options={[{ value: '1', label: '1 – Estimativa e acerto' }, { value: '2', label: '2 – Mensal normal' }, { value: '3', label: '3 – Não participa' }, { value: 'x', label: 'Sem regra' }]} />
          <Select label="Situação" value={filtro.situacao || ''} onChange={e => set('situacao', e.target.value)} options={[...SITUACOES, 'Mensal normal (fora da estimativa)', 'Não participa'].map(s => ({ value: s, label: s }))} />
          <Select label="Subsídios reais" value={filtro.subsidios || ''} onChange={e => set('subsidios', e.target.value)} options={[{ value: 'pendentes', label: 'Pendentes' }, { value: 'parciais', label: 'Parcialmente lançados' }, { value: 'completos', label: 'Completos' }]} />
          <Select label="Acerto" value={filtro.acerto || ''} onChange={e => set('acerto', e.target.value)} options={[{ value: 'feito', label: 'Apurado' }, { value: 'pendente', label: 'Ainda não apurado' }]} />
        </div>
      )}

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-sm" data-testid="tabela-encerramento">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
            <th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-left">Serviço</th><th className="px-2 py-2 text-left">Regime</th><th className="px-2 py-2 text-right">Estimativa</th>
            <th className="px-2 py-2 text-center">Subsídios OUT–DEZ</th><th className="px-2 py-2 text-left">Situação</th><th className="px-2 py-2 text-right">Diferença</th><th />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {filtradas.map(l => (
              <tr key={l.chave}>
                <td className="px-2 py-1.5 max-w-[260px]"><div className="truncate" title={l.omNome}>{l.omNome}</div><div className="text-[11px] text-slate-500">UG {l.ug}</div></td>
                <td className="px-2 py-1.5 font-mono font-bold">{l.sigla}</td>
                <td className="px-2 py-1.5 text-xs">{l.regime ? rotuloRegime(l.regime) : 'Sem regra'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.estimado !== null ? brl(l.estimado) : <span className="text-slate-400">{l.regime === 1 ? `a emitir (${brl(l.estimadoCalculado)})` : '—'}</span>}</td>
                <td className="px-2 py-1.5 text-center text-xs">{l.regime === 1 && l.estimativa ? `${l.lancados} de 3` : '—'}</td>
                <td className="px-2 py-1.5"><Selo s={l.situacao} /></td>
                <td className={`px-2 py-1.5 text-right tabular-nums ${l.diferenca !== null && l.diferenca < -0.005 ? 'text-emerald-700' : l.diferenca !== null && l.diferenca > 0.005 ? 'text-red-700' : ''}`}>{l.diferenca !== null ? brl(l.apuracao ? l.apuracao.diferenca : l.diferenca) : ''}</td>
                <td className="px-2 py-1.5 text-right"><Button size="sm" variant="ghost" aria-label={`Detalhe de ${l.omNome} ${l.sigla}`} onClick={() => setDetalhe(l)}>Detalhe</Button></td>
              </tr>
            ))}
            {!filtradas.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">{carregando ? 'Carregando...' : 'Nenhuma OM/serviço com esses filtros.'}</td></tr>}
          </tbody>
        </table>
      </div>

      {dados && ind && (
        <div className="flex flex-wrap items-end gap-2 p-3 rounded-lg border border-slate-200 bg-slate-50">
          <div className="min-w-[320px]"><Select label="Relatório" value={relatorio} onChange={e => setRelatorio(e.target.value)} options={RELATORIOS_ENC.map(r => ({ value: r.id, label: r.rotulo }))} /></div>
          <Button size="sm" variant="secondary" onClick={excel}><FileSpreadsheet size={14} className="mr-1" />Excel</Button>
          <Button size="sm" variant="secondary" onClick={pdf}><FileText size={14} className="mr-1" />PDF</Button>
        </div>
      )}

      <Modal isOpen={!!detalhe} onClose={() => setDetalhe(null)} title={detalhe ? `${detalhe.omNome} — ${detalhe.sigla} · ${detalhe.servico}` : ''} maxWidth="max-w-3xl">
        {detalhe && (
          <div className="space-y-3 text-sm" data-testid="detalhe-encerramento">
            <div className="flex flex-wrap gap-2 items-center"><Selo s={detalhe.situacao} /><span className="text-xs text-slate-500">{rotuloRegime(detalhe.regime)} · {detalhe.regimeEfetivo.origem === 'EXCECAO' ? 'exceção da OM' : detalhe.regimeEfetivo.origem === 'SERVICO' ? 'regra do serviço' : 'sem regra'}</span></div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500 mb-1">Histórico de janeiro a agosto (memória de cálculo da estimativa)</div>
              <div className="grid grid-cols-8 gap-1 text-xs">{[1, 2, 3, 4, 5, 6, 7, 8].map(m => <div key={m} className="border border-slate-200 rounded p-1 text-center"><div className="text-slate-500">{mesesDoAno[m - 1]}</div><div className="tabular-nums">{detalhe.janAgo[m] !== undefined ? brl(detalhe.janAgo[m]) : '—'}</div></div>)}</div>
              <p className="text-xs text-slate-600 mt-1">Total {brl(detalhe.totalJanAgo)} ÷ 8 = média {brl(detalhe.mediaMensal)} × 3 = <b>{brl(detalhe.estimadoCalculado)}</b> estimado{detalhe.estimado !== null && Math.abs(detalhe.estimado - detalhe.estimadoCalculado) > 0.01 ? ` (fatura emitida: ${brl(detalhe.estimado)})` : ''}.</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500 mb-1">Fatura estimativa</div>
              <p>{detalhe.estimativa ? <><span className="font-mono">{detalhe.estimativa.numero}</span> · {brl(detalhe.estimativa.valor)}</> : <span className="text-slate-500">ainda não emitida</span>}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500 mb-1">Subsídios reais</div>
              <div className="grid grid-cols-3 gap-2 text-xs">{detalhe.reais.map(r => <div key={r.mes} className="border border-slate-200 rounded p-2"><div className="text-slate-500">{mesesDoAno[r.mes - 1]}</div><div className="tabular-nums font-semibold">{r.valor === null ? 'falta lançar' : brl(r.valor)}</div>{r.semMov && <div className="text-slate-500">sem movimento</div>}</div>)}</div>
              <p className="text-xs mt-1">Total real: <b>{detalhe.totalReal !== null ? brl(detalhe.totalReal) : 'aguardando os três meses'}</b>{detalhe.diferenca !== null && <> · Diferença: <b>{brl(detalhe.apuracao ? detalhe.apuracao.diferenca : detalhe.diferenca)}</b> ({detalhe.resultado === 'DEBITO' ? 'débito complementar' : detalhe.resultado === 'CREDITO' ? 'crédito da OM' : 'sem diferença'})</>}</p>
            </div>
            {detalhe.apuracao && (
              <div className="p-2 rounded border border-emerald-200 bg-emerald-50 text-xs">
                Apuração registrada por {detalhe.apuracao.criadoPorNome || '—'} em {dataBR(detalhe.apuracao.criadoEm)}{detalhe.apuracao.acertoNumero ? ` · fatura de acerto ${detalhe.apuracao.acertoNumero}` : ' · sem fatura (sem diferença)'}.
                {admin && (acertoAtivo(detalhe) ? <span className="ml-2 text-slate-500">Para cancelar a apuração, cancele antes a fatura de acerto.</span> : <button className="ml-2 underline text-red-700" onClick={() => cancelar(detalhe)}>Cancelar apuração</button>)}
              </div>
            )}
            {detalhe.apuracaoCancelada && !detalhe.apuracao && <div className="p-2 rounded border border-slate-200 bg-slate-50 text-xs">Apuração cancelada em {dataBR(detalhe.apuracaoCancelada.canceladaEm)}: {detalhe.apuracaoCancelada.canceladaMotivo}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
};
