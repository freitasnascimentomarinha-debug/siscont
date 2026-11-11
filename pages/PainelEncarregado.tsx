import React, { useEffect, useMemo, useState } from 'react';
import { Filter, RefreshCw, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { MultiFiltro, useExcluidosLembrados } from '../components/ui/MultiFiltro';
import { SeletorPublico, useClassificadorPublico, usePublico } from '../components/ui/SeletorPublico';
import { Button } from '../components/ui/Button';
import { ListaFaturas, br } from '../components/painel/comum';
import { VisaoGeral } from '../components/painel/VisaoGeral';
import { OMsTab } from '../components/painel/OMsTab';
import { ContestacoesTab } from '../components/painel/ContestacoesTab';
import { EquipeTab } from '../components/painel/EquipeTab';
import { EncerramentoTab } from '../components/faturamento/EncerramentoTab';
import { PlanilhaCongestionamento } from '../components/painel/PlanilhaCongestionamento';
import { AbaPainel, CtxPainel } from '../components/painel/tipos';
import { adiantamentosComSaldo, carregarBase, listarCobrancas, saldosParados } from '../services/relatoriosService';
import { listarContestacoes } from '../services/fase4Service';
import { ehAdiantamento } from '../utils/baixas';
import { criarResolvedor } from '../utils/documentosOM';
import { hojeISO } from '../utils/datas';
import { Contestacao } from '../utils/fase4';
import { InvoiceStatus } from '../types';
import { notify } from '../utils/notify';
import { ROTULO_PUBLICO, passaPublico } from '../utils/publico';
import {
  BaixaGer, FaturaGer, Recebimento, analisarContestacoes, baixasPorFatura, criteriosDe, gerarAlertas, linhasOM, mesDe,
} from '../utils/painelGerencial';
import { pdfPainel } from '../utils/pdfPainel';
import { excelPainel } from '../utils/excelPainel';
import { baixarBytes } from '../utils/baixarArquivo';

type Base = Awaited<ReturnType<typeof carregarBase>>;
const ABAS: { id: AbaPainel; rotulo: string }[] = [
  { id: 'geral', rotulo: 'Visão geral' }, { id: 'oms', rotulo: 'OM' }, { id: 'contestacoes', rotulo: 'Contestações e pendências' }, { id: 'equipe', rotulo: 'Equipe' }, { id: 'encerramento', rotulo: 'Encerramento do exercício' },
];
const totalDe = (i: { value: number; adjustmentAddition?: number; adjustmentDeduction?: number }) => i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0);

/**
 * Painel do Encarregado: visão gerencial somente de consulta (indicadores, alertas, gráficos, OM, contestações e atividade).
 * Nada aqui grava dados; a trava de escrita do perfil Encarregado também está no banco (RLS).
 */
export const PainelEncarregado: React.FC = () => {
  const [base, setBase] = useState<Base | null>(null);
  const [contestacoes, setContestacoes] = useState<Contestacao[]>([]);
  const [cobrancas, setCobrancas] = useState<CtxPainel['cobrancas']>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState('');
  const [aba, setAba] = useState<AbaPainel>('geral');
  const [lista, setLista] = useState<{ titulo: string; faturas: FaturaGer[] } | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);

  const hoje = hojeISO();
  const anoAtual = Number(hoje.slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const [de, setDe] = useState(`${anoAtual}-01`);
  const [ate, setAte] = useState(mesDe(hoje));
  const [publico, setPublico] = usePublico('painel-encarregado', 'TODOS');
  const [exSetores, setExSetores] = useExcluidosLembrados('siscont.painel.setores');
  const [exComandos, setExComandos] = useState<Set<string>>(new Set());

  const carregar = async () => {
    setCarregando(true);
    try {
      const b = await carregarBase();
      setBase(b); setAtualizadoEm(new Date().toLocaleString('pt-BR'));
      const [cb, ct] = await Promise.all([listarCobrancas().catch(() => []), listarContestacoes().catch(() => [] as Contestacao[])]);
      setCobrancas(cb); setContestacoes(ct);
    } catch (e) { notify.fail('Erro ao carregar o painel', e); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  const cls = useClassificadorPublico(base?.oms as any);
  const resolv = useMemo(() => (base ? criarResolvedor(base.oms as any, base.comandos as any, base.setores as any) : null), [base]);
  const omPorId = useMemo(() => new Map((base?.oms || []).map(o => [o.id, o])), [base]);

  // todas as faturas, com setor/comando/cliente pelo cadastro da OM
  const todas = useMemo<FaturaGer[]>(() => {
    if (!base || !resolv) return [];
    return base.invoices.map(i => {
      const o = i.omId ? omPorId.get(i.omId) : undefined;
      const r = o ? resolv.rotuloDaOM(o as any) : undefined;
      return {
        id: i.id, numero: i.invoiceNumber, cliente: r?.cliente || i.client, setor: r?.setor || i.sector, comando: r?.comando || i.command, tipo: i.type || i.serviceAcronym || '—',
        ano: i.yearCompetence, mes: i.monthCompetence, emissao: i.issueDate, vencimento: i.dueDate, total: totalDe(i), pago: i.paidAmount || 0,
        saldo: i.isCanceled || i.status === InvoiceStatus.PAID ? 0 : i.saldoAPagar ?? Math.max(0, totalDe(i) - (i.paidAmount || 0)),
        cancelada: !!i.isCanceled, contestada: !!i.contestada, omId: i.omId ?? null, extra: cls.faturaExtra(i as any),
        quitadaExterna: !!i.quitacaoExterna, quitadaEm: i.quitadaEm ?? null, pontos: (i.pontos || []).length,
      };
    });
  }, [base, resolv, omPorId, cls]);

  const todosSetores = useMemo(() => [...new Set(todas.map(f => f.setor).filter(Boolean))].sort(), [todas]);
  const todosComandos = useMemo(() => [...new Set(todas.map(f => f.comando).filter(Boolean))].sort(), [todas]);
  const anos = useMemo(() => [...new Set([anoAtual, ...todas.map(f => f.ano).filter(Boolean)])].sort((a, b) => b - a), [todas, anoAtual]);
  const setoresMaterial = useMemo(() => (base?.par.setores_material ?? 'DGMM').split(',').map((s: string) => s.trim().toUpperCase()).filter(Boolean), [base]);
  const nomeGrupo = base?.par.nome_grupo_setores || 'Setor do Material';
  const noGrupo = (s: string) => setoresMaterial.includes(s.toUpperCase());

  const fs = useMemo(() => todas.filter(f => !exSetores.has(f.setor) && !exComandos.has(f.comando) && passaPublico(publico, f.extra)), [todas, exSetores, exComandos, publico]);
  const criterios = useMemo(() => criteriosDe(base?.par || {}), [base]);

  const { bs, idx } = useMemo(() => {
    if (!base) return { bs: [] as BaixaGer[], idx: new Map<string, BaixaGer[]>() };
    const ids = new Set(fs.map(f => f.id));
    const docPorId = new Map(base.docs.map(d => [d.id, d]));
    const lista: BaixaGer[] = [];
    base.baixas.forEach(a => { if (ids.has(a.invoiceId)) lista.push({ invoiceId: a.invoiceId, docId: a.documentId, valor: a.amount, data: a.date, adiantamento: ehAdiantamento(a, docPorId.get(a.documentId) as any) }); });
    return { bs: lista, idx: baixasPorFatura(lista) };
  }, [base, fs]);

  // baixas de TODAS as faturas (a planilha do CONGEST não depende dos filtros da tela)
  const idxTodas = useMemo(() => {
    if (!base) return new Map<string, BaixaGer[]>();
    const docPorId = new Map(base.docs.map(d => [d.id, d]));
    return baixasPorFatura(base.baixas.map(a => ({ invoiceId: a.invoiceId, docId: a.documentId, valor: a.amount, data: a.date, adiantamento: ehAdiantamento(a, docPorId.get(a.documentId)) })));
  }, [base]);

  // documentos (ALTCRED/GRU): só os do recorte (público, setor, comando)
  const docNoRecorte = (d: { client: string; sector?: string; command?: string; ug?: string | null; comandoId?: string | null }) => {
    const om = resolv?.omDoDocumento(d as any);
    const r = om ? resolv!.rotuloDaOM(om) : undefined;
    const setor = r?.setor ?? d.sector ?? '', comando = r?.comando ?? d.command ?? '';
    return !exSetores.has(setor) && !exComandos.has(comando) && passaPublico(publico, cls.docExtra(d as any));
  };
  const parados = useMemo(() => (base ? saldosParados(base, hoje, criterios.diasSaldoParado).filter(x => docNoRecorte(x.doc)).map(x => ({ id: x.doc.id, numero: x.doc.documentNumber, cliente: x.doc.client, valor: x.doc.availableValue, dias: x.dias, ultimo: x.ultimo, omId: resolv?.omDoDocumento(x.doc as any)?.id ?? null })) : []),
    [base, hoje, criterios, exSetores, exComandos, publico, cls, resolv]);
  const adiantamentos = useMemo(() => (base ? adiantamentosComSaldo(base).filter(l => docNoRecorte({ client: l.cliente, command: l.comando })).map(l => ({ cliente: l.cliente, saldo: l.saldo })) : []),
    [base, exSetores, exComandos, publico, cls, resolv]);

  // dinheiro que entrou no recorte: ALTCRED/GRU pela data do documento
  const recebimentos = useMemo<Recebimento[]>(() => (base ? base.docs.filter(d => d.date && d.totalValue > 0 && docNoRecorte(d)).map(d => ({ id: d.id, valor: d.totalValue, data: d.date, omId: resolv?.omDoDocumento(d as any)?.id ?? null })) : []),
    [base, exSetores, exComandos, publico, cls, resolv]);

  const linhas = useMemo(() => {
    const porOM = new Map<string, number>();
    parados.forEach(p => { if (p.omId) porOM.set(p.omId, (porOM.get(p.omId) || 0) + p.valor); });
    return linhasOM(fs, idx, hoje, criterios, f => (f.omId ? porOM.get(f.omId) || 0 : 0));
  }, [fs, idx, hoje, criterios, parados]);
  const contest = useMemo(() => analisarContestacoes(contestacoes, new Map(fs.map(f => [f.id, f])), hoje), [contestacoes, fs, hoje]);
  const periodo = useMemo(() => ({ de: de <= ate ? de : ate, ate: de <= ate ? ate : de }), [de, ate]);
  const alertas = useMemo(() => gerarAlertas({ fs, linhas, hoje, c: criterios, contest, parados, cobrancas }), [fs, linhas, hoje, criterios, contest, parados, cobrancas]);

  const ctx: CtxPainel = {
    hoje, criterios, periodo, fs, bs, idx, recebimentos, linhas, contest, alertas, parados, adiantamentos, cobrancas,
    abrirLista: (titulo, faturas) => setLista({ titulo, faturas }), irPara: setAba,
  };

  const mudarAno = (a: number) => { setAno(a); setDe(`${a}-01`); setAte(a === anoAtual ? mesDe(hoje) : `${a}-12`); };
  const resumoEx = (ex: Set<string>, opcoes: string[]) => { const e = opcoes.filter(v => ex.has(v)); return !e.length ? '' : e.length <= 2 ? `todos exceto ${e.join(', ')}` : opcoes.length - e.length <= 2 ? opcoes.filter(v => !ex.has(v)).join(', ') : `${opcoes.length - e.length} de ${opcoes.length}`; };
  const filtrosAtivos: [string, string, () => void][] = ([
    ['Público', publico !== 'TODOS' ? `só ${ROTULO_PUBLICO[publico]}` : '', () => setPublico('TODOS')],
    ['Setor', resumoEx(exSetores, todosSetores), () => setExSetores(new Set())],
    ['Comando', resumoEx(exComandos, todosComandos), () => setExComandos(new Set())],
  ] as [string, string, () => void][]).filter(f => f[1]);
  const periodoPadrao = de === `${ano}-01` && ate === (ano === anoAtual ? mesDe(hoje) : `${ano}-12`);
  const limpar = () => { setPublico('TODOS'); setExSetores(new Set()); setExComandos(new Set()); mudarAno(anoAtual); };
  const algumFiltro = filtrosAtivos.length > 0 || !periodoPadrao || ano !== anoAtual;

  // integridade: faturas sem OM ligada e faturas com ponto de atenção
  const semOM = useMemo(() => todas.filter(f => !f.omId && !f.cancelada).length, [todas]);
  const comPonto = useMemo(() => todas.filter(f => f.pontos > 0 && !f.cancelada).length, [todas]);
  const integro = semOM === 0 && comPonto === 0;

  const gerarPdf = () => {
    try {
      pdfPainel({ hoje, periodo, fs, bs, idx, recebimentos, linhas, alertas, contest, criterios, parados, adiantamentos, filtros: filtrosAtivos.map(([r, v]) => `${r}: ${v}`), atualizadoEm });
    } catch (e) { notify.fail('Não foi possível gerar o PDF', e); }
  };

  const gerarExcel = async () => {
    try {
      baixarBytes(await excelPainel({ hoje, periodo, fs, bs, idx, recebimentos, linhas, alertas, contest, criterios, parados, adiantamentos, filtros: filtrosAtivos.map(([r, v]) => `${r}: ${v}`), atualizadoEm }), `painel_encarregado_${hoje}.xlsx`);
    } catch (e) { notify.fail('Não foi possível gerar o Excel', e); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Painel do Encarregado</h2>
          <p className="text-slate-500 text-sm">Visão gerencial de faturamento, cobrança, recebimentos, OM e contestações. Somente consulta.</p>
          <p className="text-xs text-slate-400 mt-0.5">Posição em <b>{br(hoje)}</b>{atualizadoEm && <> · atualizado em {atualizadoEm}</>}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {base && (integro
            ? <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200" title={`${todas.length} faturas e ${base.baixas.length} baixas lidas, sem inconsistências apontadas`}><ShieldCheck size={13} />Dados íntegros</span>
            : <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200" title={`${semOM} fatura(s) sem OM ligada ao cadastro e ${comPonto} com ponto de atenção (página Pontos de Atenção). Os números do painel usam o que está gravado.`}><TriangleAlert size={13} />{comPonto} com ponto de atenção{semOM ? ` · ${semOM} sem OM` : ''}</span>)}
          <Button size="sm" variant="secondary" onClick={gerarPdf} disabled={!base}>PDF com gráficos</Button>
          <Button size="sm" variant="secondary" onClick={gerarExcel} disabled={!base}>Excel com gráficos</Button>
          <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
        </div>
      </div>

      {base && <PlanilhaCongestionamento faturas={todas} idx={idxTodas} hoje={hoje} />}

      {base && (
        <section aria-label="Filtros" className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
          <button type="button" className="md:hidden flex items-center gap-1.5 text-sm font-semibold text-slate-700" onClick={() => setFiltrosAbertos(!filtrosAbertos)} aria-expanded={filtrosAbertos}><Filter size={14} />Filtros{algumFiltro ? ` (ativos)` : ''}</button>
          <div className={`${filtrosAbertos ? 'flex' : 'hidden'} md:flex flex-wrap gap-3 items-end`}>
            <label className="text-xs font-semibold text-slate-600">Exercício
              <select aria-label="Exercício" className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={ano} onChange={e => mudarAno(Number(e.target.value))}>{anos.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Período de
              <input type="month" aria-label="Período inicial" className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1" value={de} onChange={e => e.target.value && setDe(e.target.value)} /></label>
            <label className="text-xs font-semibold text-slate-600">até
              <input type="month" aria-label="Período final" className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1" value={ate} onChange={e => e.target.value && setAte(e.target.value)} /></label>
            <SeletorPublico valor={publico} onChange={setPublico} />
            <MultiFiltro rotulo="Setor" opcoes={todosSetores} excluidos={exSetores} onChange={setExSetores} />
            <MultiFiltro rotulo="Comando / grupo de OM" opcoes={todosComandos} excluidos={exComandos} onChange={setExComandos} largura="w-96" />
            <div className="flex flex-wrap items-center gap-1.5 pb-1 text-xs">
              <button type="button" className="px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50" onClick={() => setExSetores(new Set(todosSetores.filter(s => !noGrupo(s))))} title={setoresMaterial.join(', ')}>Só {nomeGrupo}</button>
              <button type="button" className="px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50" onClick={() => setExSetores(new Set(todosSetores.filter(noGrupo)))}>Exceto {nomeGrupo}</button>
            </div>
            <Button size="sm" variant="ghost" onClick={limpar} disabled={!algumFiltro}><X size={14} className="mr-1" />Limpar filtros</Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Recorte consultado">
            <span className="text-slate-500">Recorte:</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">exercício {ano}</span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">período {periodo.de.slice(5)}/{periodo.de.slice(0, 4)} a {periodo.ate.slice(5)}/{periodo.ate.slice(0, 4)}</span>
            {filtrosAtivos.map(([r, v, limpa]) => <span key={r} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-primary-50 text-primary-800 border border-primary-200">{r}: {v}<button type="button" onClick={limpa} aria-label={`Remover filtro ${r}`} className="hover:bg-primary-100 rounded-full"><X size={12} /></button></span>)}
            {!filtrosAtivos.length && <span className="text-slate-400">todos os setores, comandos e públicos</span>}
            <span className="ml-auto text-slate-400">{fs.length.toLocaleString('pt-BR')} faturas no recorte</span>
          </div>
        </section>
      )}

      {!base && carregando && <p className="text-sm text-slate-500">Carregando...</p>}
      {base && (
        <>
          <nav className="flex gap-1 border-b border-slate-200 overflow-x-auto" role="tablist" aria-label="Seções do painel">
            {ABAS.map(a => <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} onClick={() => setAba(a.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${aba === a.id ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {a.rotulo}{a.id === 'contestacoes' && contest.filter(x => x.aberta).length > 0 && <span className="ml-1.5 text-[11px] bg-amber-100 text-amber-800 rounded-full px-1.5">{contest.filter(x => x.aberta).length}</span>}</button>)}
          </nav>
          <div role="tabpanel">
            {aba === 'geral' && <VisaoGeral ctx={ctx} />}
            {aba === 'oms' && <OMsTab ctx={ctx} />}
            {aba === 'contestacoes' && <ContestacoesTab ctx={ctx} />}
            {aba === 'equipe' && <EquipeTab ctx={ctx} />}
            {aba === 'encerramento' && <EncerramentoTab />}
          </div>
        </>
      )}
      {lista && <ListaFaturas titulo={lista.titulo} faturas={lista.faturas} hoje={hoje} onClose={() => setLista(null)} />}
    </div>
  );
};
