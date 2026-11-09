import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Search } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import {
  CampoOM, FAIXAS_ATRASO, LinhaOM, ORDENS_OM, SITUACOES, SituacaoId, atrasoDe, chaveOM, faturadoRecebido, mesDe, ordenarOM, situacoesDaOM, somaMeses,
} from '../../utils/painelGerencial';
import { COR, COR_FAIXA, Kpi, Secao, Vazio, br, brl, compacto, mesBR, qtdBR } from './comum';
import { CtxPainel } from './tipos';

const fmtCampo = (campo: CampoOM, l: LinhaOM): string => {
  switch (campo) {
    case 'qtdVencidas': return `${l.qtdVencidas} fatura(s)`;
    case 'pctInad': return l.pctInad === null ? '—' : `${l.pctInad.toLocaleString('pt-BR')}%`;
    case 'atrasoMedio': return `${l.atrasoMedio} dias`;
    case 'variacao': return `${l.variacao >= 0 ? '+' : '−'}${brl(Math.abs(l.variacao))}`;
    case 'contestado': return brl(l.contestado);
    case 'saldoParado': return brl(l.saldoParado);
    default: return brl(l.vencido);
  }
};
const valorCampo = (campo: CampoOM, l: LinhaOM): number => {
  switch (campo) { case 'qtdVencidas': return l.qtdVencidas; case 'pctInad': return l.pctInad ?? 0; case 'atrasoMedio': return l.atrasoMedio; case 'variacao': return l.variacao; case 'contestado': return l.contestado; case 'saldoParado': return l.saldoParado; default: return l.vencido; }
};

/** Ficha da OM: tudo o que se sabe dela num só lugar (somente consulta). */
const FichaOM: React.FC<{ chave: string; ctx: CtxPainel; onClose: () => void }> = ({ chave, ctx, onClose }) => {
  const l = ctx.linhas.find(x => x.chave === chave);
  const fsOM = useMemo(() => ctx.fs.filter(f => !f.cancelada && chaveOM(f) === chave), [ctx.fs, chave]);
  const numeros = useMemo(() => new Set(fsOM.map(f => f.numero)), [fsOM]);
  const recOM = useMemo(() => ctx.recebimentos.filter(r => !!l?.omId && r.omId === l.omId), [ctx.recebimentos, l]);
  const ate = mesDe(ctx.hoje), de = somaMeses(ate, -11);
  const hist = useMemo(() => faturadoRecebido(fsOM, recOM, de, ate).map(p => ({ ...p, nome: mesBR(p.mes) })), [fsOM, recOM, de, ate]);
  const contest = ctx.contest.filter(x => x.fatura && chaveOM(x.fatura) === chave);
  const cobr = ctx.cobrancas.filter(c => c.faturas.some(n => numeros.has(n)) || (l && c.comando === l.comando));
  const abertas = fsOM.filter(f => f.saldo > 0.009).sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
  const recentes = fsOM.filter(f => f.saldo <= 0.009).sort((a, b) => (b.emissao || '').localeCompare(a.emissao || '')).slice(0, 10);
  const ultimaCobr = cobr[0];
  const ultimoEvento = contest.flatMap(x => x.c.historico.map(h => ({ em: h.em, texto: `contestação ${x.c.numeroFatura}: ${h.acao.toLowerCase()}` }))).sort((a, b) => b.em.localeCompare(a.em))[0];
  if (!l) return null;
  return (
    <Modal isOpen onClose={onClose} title={l.cliente} maxWidth="max-w-5xl">
      <div className="space-y-4 text-sm">
        <p className="text-xs text-slate-500">{l.comando} · setor {l.setor} · somente consulta</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Kpi rotulo="Em aberto" valor={brl(l.emAberto)} detalhe={`${l.qtdAberto} fatura(s)`} />
          <Kpi rotulo="Vencido" cor={COR.vencido} alerta={l.vencido > 0} valor={brl(l.vencido)} detalhe={`${l.qtdVencidas} fatura(s) · ${l.atrasoMedio} dias em média`} />
          <Kpi rotulo="Em contestação" cor="#d97706" valor={brl(l.contestado)} detalhe={`${l.qtdContestadas} fatura(s)`} />
          <Kpi rotulo="Variação em 30 dias" cor="#475569" valor={fmtCampo('variacao', l)} detalhe={l.variacaoPct === null ? undefined : `${l.variacaoPct}% do vencido`} />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Faixas de atraso">
          {['A vencer', ...FAIXAS_ATRASO].map(f => (
            <span key={f} className="text-xs rounded-md border border-slate-200 px-2 py-1 bg-white" style={{ borderLeft: `4px solid ${COR_FAIXA[f]}` }}>{f}: <b className="tabular-nums">{brl(l.porFaixa[f] || 0)}</b></span>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <div className="border border-slate-200 rounded-lg p-2">
            <h4 className="text-xs font-bold text-slate-600 mb-1">Faturado × recebido (12 meses; recebido pelo ALTCRED/GRU)</h4>
            <div className="h-44"><ResponsiveContainer width="100%" height="100%">
              <BarChart data={hist} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COR.grade} /><XAxis dataKey="nome" tick={{ fontSize: 9, fill: COR.eixo }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 9, fill: COR.eixo }} axisLine={false} tickLine={false} width={44} />
                <Tooltip formatter={(v: any, n: any) => [brl(Number(v)), n]} /><Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="faturado" name="Faturado" fill={COR.faturado} maxBarSize={14} /><Bar dataKey="recebido" name="Recebido" fill={COR.recebido} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer></div>
          </div>
          <div className="border border-slate-200 rounded-lg p-2 text-xs space-y-1">
            <h4 className="font-bold text-slate-600">Acompanhamento</h4>
            <p><span className="text-slate-500">Última movimentação:</span> <b>{br(l.ultimaMov)}</b> (emissão ou pagamento)</p>
            <p><span className="text-slate-500">Última providência registrada:</span> <b>{ultimaCobr ? `cobrança enviada em ${br(ultimaCobr.enviadaEm)}${ultimaCobr.faturas.some(n => numeros.has(n)) ? '' : ' (ao comando)'}` : ultimoEvento ? `${br(ultimoEvento.em)} — ${ultimoEvento.texto}` : 'nenhuma registrada'}</b></p>
            <p><span className="text-slate-500">Responsável pelo acompanhamento:</span> <b>não registrado</b> <span className="text-slate-400">(o sistema ainda não guarda responsável por OM — veja a aba Equipe)</span></p>
            <p><span className="text-slate-500">Saldo parado (ALTCRED/GRU):</span> <b>{brl(l.saldoParado)}</b></p>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-600 mb-1">Faturas com saldo ({abertas.length})</h4>
          <div className="max-h-56 overflow-auto border border-slate-200 rounded-lg">
            <table className="w-full text-xs"><thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
              <th className="px-2 py-1.5 text-left">Fatura</th><th className="px-2 hidden md:table-cell">Emissão</th><th className="px-2">Vencimento</th><th className="px-2 text-right">Valor</th><th className="px-2 text-right">Saldo</th><th className="px-2 text-right">Atraso</th><th className="px-2 text-left">Situação</th>
            </tr></thead><tbody>
              {abertas.map(f => { const a = atrasoDe(f, ctx.hoje); return (
                <tr key={f.id} className="border-t border-slate-100"><td className="px-2 py-1 font-mono whitespace-nowrap">{f.numero}</td><td className="px-2 text-center hidden md:table-cell">{br(f.emissao)}</td><td className="px-2 text-center">{br(f.vencimento)}</td>
                  <td className="px-2 text-right tabular-nums">{brl(f.total)}</td><td className="px-2 text-right tabular-nums font-semibold">{brl(f.saldo)}</td><td className={`px-2 text-right ${a ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>{a ? `${a} dias` : '—'}</td>
                  <td className="px-2">{f.contestada ? 'em contestação' : a ? 'vencida' : 'a vencer'}</td></tr>); })}
              {!abertas.length && <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-400">Nenhuma fatura com saldo.</td></tr>}
            </tbody></table>
          </div>
          {recentes.length > 0 && <details className="mt-1 text-xs"><summary className="cursor-pointer text-slate-500">Últimas faturas quitadas ({recentes.length})</summary>
            <ul className="mt-1 columns-1 md:columns-2">{recentes.map(f => <li key={f.id} className="font-mono">{f.numero} <span className="text-slate-400 font-sans">· {brl(f.total)}</span></li>)}</ul></details>}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div><h4 className="text-xs font-bold text-slate-600 mb-1">Contestações ({contest.length})</h4>
            {contest.length ? <ul className="text-xs space-y-1">{contest.map(x => <li key={x.c.id} className="border border-slate-200 rounded p-1.5"><b className="font-mono">{x.c.numeroFatura}</b> · {x.c.status.toLowerCase()} · {x.diasAberta} dias{x.aberta ? ` (parada há ${x.diasParada})` : ''} · {brl(x.valor)}</li>)}</ul> : <p className="text-xs text-slate-400">Nenhuma.</p>}</div>
          <div><h4 className="text-xs font-bold text-slate-600 mb-1">Histórico de cobranças ({cobr.length})</h4>
            {cobr.length ? <ul className="text-xs space-y-1">{cobr.slice(0, 8).map((c, i) => <li key={i} className="border border-slate-200 rounded p-1.5">{br(c.enviadaEm)} · {brl(c.valor)} · {c.faturas.length} fatura(s){c.faturas.some(n => numeros.has(n)) ? '' : ' (ao comando)'}</li>)}</ul> : <p className="text-xs text-slate-400">Nenhuma cobrança registrada para esta OM.</p>}</div>
        </div>
      </div>
    </Modal>
  );
};

const POR_PAGINA = 25;
export const OMsTab: React.FC<{ ctx: CtxPainel }> = ({ ctx }) => {
  const { linhas, criterios: c, hoje } = ctx;
  const [ordem, setOrdem] = useState<{ campo: CampoOM; asc: boolean }>({ campo: 'vencido', asc: false });
  const [visao, setVisao] = useState<'ranking' | 'faixas'>('ranking');
  const [busca, setBusca] = useState('');
  const [faixa, setFaixa] = useState('');
  const [soVencidas, setSoVencidas] = useState(false);
  const [situacao, setSituacao] = useState<SituacaoId | ''>('');
  const [pagina, setPagina] = useState(0);
  const [ficha, setFicha] = useState<string | null>(null);

  // OM com contestação parada também contam como "pendência de acompanhamento"
  const comContestParada = useMemo(() => new Set(ctx.contest.filter(x => x.aberta && x.diasParada > c.diasContestParada && x.fatura).map(x => chaveOM(x.fatura!))), [ctx.contest, c]);
  const sit = useMemo(() => new Map(linhas.map(l => [l.chave, situacoesDaOM(l, c, comContestParada.has(l.chave))])), [linhas, c, comContestParada]);
  const contagem = useMemo(() => Object.fromEntries(SITUACOES.map(s => [s.id, linhas.filter(l => sit.get(l.chave)![s.id]).length])) as Record<SituacaoId, number>, [linhas, sit]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const l = linhas.filter(x => (!q || `${x.cliente} ${x.comando} ${x.setor}`.toLowerCase().includes(q)) && (!soVencidas || x.vencido > 0)
      && (!faixa || (x.porFaixa[faixa] || 0) > 0) && (!situacao || sit.get(x.chave)![situacao]));
    return ordenarOM(l, ordem.campo, ordem.asc);
  }, [linhas, busca, soVencidas, faixa, situacao, ordem, sit]);
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const pag = Math.min(pagina, paginas - 1);
  const visiveis = filtradas.slice(pag * POR_PAGINA, (pag + 1) * POR_PAGINA);
  const ordenar = (campo: CampoOM) => { setOrdem(o => ({ campo, asc: o.campo === campo ? !o.asc : campo === 'cliente' || campo === 'ultimaMov' })); setPagina(0); };
  const seta = (campo: CampoOM) => (ordem.campo === campo ? (ordem.asc ? ' ▲' : ' ▼') : '');
  const Th: React.FC<{ campo: CampoOM; rot: string; al?: string; cls?: string }> = ({ campo, rot, al = 'text-right', cls = '' }) => <th className={`px-2 py-2 ${al} ${cls}`}><button type="button" className="font-semibold uppercase hover:text-primary-700" onClick={() => ordenar(campo)} title="Clique para ordenar">{rot}{seta(campo)}</button></th>;

  // gráfico do ranking: 10 primeiras pelo critério escolhido (valor numérico)
  const campoRanking = ORDENS_OM.some(o => o.campo === ordem.campo) ? ordem.campo : 'vencido';
  const top = useMemo(() => ordenarOM(filtradas, campoRanking, false).slice(0, 10).filter(l => valorCampo(campoRanking, l) > 0)
    .map(l => ({ chave: l.chave, nome: l.cliente.length > 30 ? `${l.cliente.slice(0, 29)}…` : l.cliente, cliente: l.cliente, valor: valorCampo(campoRanking, l), texto: fmtCampo(campoRanking, l) })), [filtradas, campoRanking]);
  const moeda = ['vencido', 'contestado', 'saldoParado', 'variacao'].includes(campoRanking);

  const exportar = () => {
    const cab = ['OM', 'Comando', 'Setor', 'Em aberto', 'Vencido', '% inadimplência', 'Faturas vencidas', `Vencido > ${c.diasAtencao} dias`, `Vencido > ${c.diasCritico} dias`, ...FAIXAS_ATRASO.map(f => `Vencido ${f}`), 'Contestado', 'Atraso médio (dias)', 'Saldo parado', 'Última movimentação', 'Variação vencido 30 dias'];
    const ws = XLSX.utils.aoa_to_sheet([cab, ...filtradas.map(l => [l.cliente, l.comando, l.setor, l.emAberto, l.vencido, l.pctInad ?? '', l.qtdVencidas, l.v90, l.v365, ...FAIXAS_ATRASO.map(f => l.porFaixa[f] || 0), l.contestado, l.atrasoMedio, l.saldoParado, br(l.ultimaMov), l.variacao])]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Situação das OM');
    XLSX.writeFile(wb, `painel_situacao_das_OM_${hoje}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <Secao titulo="Situação geral das OM" subtitulo="Uma OM pode estar em mais de uma situação ao mesmo tempo. Clique para filtrar a tabela.">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2" role="group" aria-label="Situação das OM">
          {SITUACOES.map(s => (
            <button key={s.id} type="button" aria-pressed={situacao === s.id} title={s.dica(c)} onClick={() => { setSituacao(situacao === s.id ? '' : s.id); setPagina(0); }}
              className={`text-left rounded-lg border p-2.5 bg-white hover:shadow-md ${situacao === s.id ? 'ring-2 ring-primary-500' : 'border-slate-200'}`} style={{ borderTop: `4px solid ${s.cor}` }}>
              <div className="text-2xl font-bold tabular-nums text-slate-900">{qtdBR(contagem[s.id])}</div>
              <div className="text-xs font-semibold text-slate-600 leading-tight">{s.rotulo}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">{qtdBR(linhas.length)} OM com faturas no recorte. Débito crítico = fatura vencida há mais de {c.diasAtencao} dias.</p>
      </Secao>

      <Secao titulo="Ranking das OM" subtitulo="As 10 primeiras no critério escolhido. Clique numa barra para abrir a ficha da OM."
        acoes={<label className="text-xs text-slate-600">Ordenar por <select className="ml-1 text-sm border border-slate-300 rounded-md px-2 py-1 bg-white" aria-label="Critério do ranking" value={campoRanking} onChange={e => { setOrdem({ campo: e.target.value as CampoOM, asc: false }); setPagina(0); }}>
          {ORDENS_OM.map(o => <option key={o.campo} value={o.campo}>{o.rotulo}</option>)}</select></label>}>
        {top.length === 0 ? <Vazio>Nenhuma OM com valor neste critério.</Vazio> : (
          <div className="h-72" role="img" aria-label="Gráfico do ranking das OM">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={top} layout="vertical" margin={{ top: 4, right: 96, left: 4, bottom: 0 }} onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) setFicha(top[Number(i)].chave); }}>
                <CartesianGrid horizontal={false} stroke={COR.grade} />
                <XAxis type="number" tickFormatter={moeda ? compacto : undefined} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nome" width={190} tick={{ fontSize: 10, fill: '#334155' }} axisLine={false} tickLine={false} interval={0} />
                <Tooltip formatter={(_v: any, _n: any, p: any) => [p?.payload?.texto, ORDENS_OM.find(o => o.campo === campoRanking)?.rotulo]} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" fill={COR.vencido} radius={[0, 4, 4, 0]} cursor="pointer" maxBarSize={20}><LabelList dataKey="texto" position="right" style={{ fontSize: 10, fill: '#334155' }} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Secao>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-end gap-3">
          <h3 className="font-bold text-slate-800 mr-auto">Situação por OM</h3>
          <div role="group" aria-label="Visão da tabela" className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs">
            {([['ranking', 'Ranking'], ['faixas', 'Por faixa de atraso']] as const).map(([k, r]) => <button key={k} type="button" aria-pressed={visao === k} onClick={() => setVisao(k)} className={`px-2.5 py-1.5 ${visao === k ? 'bg-primary-600 text-white' : 'bg-white text-slate-700'} ${k !== 'ranking' ? 'border-l border-slate-300' : ''}`}>{r}</button>)}
          </div>
          <label className="relative"><Search size={14} className="absolute left-2 top-2 text-slate-400" /><input className="pl-7 pr-2 py-1 text-sm border border-slate-300 rounded-md w-52" placeholder="Buscar OM, comando ou setor..." value={busca} onChange={e => { setBusca(e.target.value); setPagina(0); }} aria-label="Buscar OM" /></label>
          <label className="text-xs text-slate-600">Faixa de atraso <select className="ml-1 text-sm border border-slate-300 rounded-md px-1.5 py-1 bg-white" aria-label="Filtrar faixa de atraso" value={faixa} onChange={e => { setFaixa(e.target.value); setPagina(0); }}><option value="">Todas</option><option value="A vencer">A vencer</option>{FAIXAS_ATRASO.map(f => <option key={f} value={f}>{f}</option>)}</select></label>
          <label className="text-sm flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={soVencidas} onChange={e => { setSoVencidas(e.target.checked); setPagina(0); }} /> Só com vencidas</label>
          <Button size="sm" variant="secondary" onClick={exportar}><Download size={14} className="mr-1" />Excel</Button>
        </div>
        <p className="px-4 pt-2 text-xs text-slate-500">Clique numa <b>linha</b> para abrir a ficha da OM e no <b>título da coluna</b> para ordenar. {qtdBR(filtradas.length)} de {qtdBR(linhas.length)} OM.</p>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs" aria-label="Situação por OM">
            <thead className="bg-slate-50 text-slate-500 uppercase"><tr>
              <Th campo="cliente" rot="OM" al="text-left" />
              {visao === 'faixas' && <th className="px-2 py-2 text-left hidden xl:table-cell">Comando</th>}
              <Th campo="emAberto" rot="Em aberto" /><Th campo="vencido" rot="Vencido" />
              {visao === 'ranking' ? <>
                <Th campo="pctInad" rot="% inad." cls="hidden md:table-cell" /><Th campo="qtdVencidas" rot="Fat. venc." cls="hidden md:table-cell" />
                <Th campo="v90" rot={`> ${c.diasAtencao} d`} cls="hidden lg:table-cell" /><Th campo="v365" rot={`> ${c.diasCritico} d`} cls="hidden lg:table-cell" />
                <Th campo="contestado" rot="Contestado" cls="hidden lg:table-cell" /><Th campo="variacao" rot="Var. 30 d" cls="hidden md:table-cell" />
              </> : FAIXAS_ATRASO.map(f => <Th key={f} campo={`faixa:${f}` as CampoOM} rot={f.replace(' dias', '')} cls="hidden md:table-cell" />)}
              <Th campo="ultimaMov" rot="Últ. mov." al="text-left" cls="hidden md:table-cell" />
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {visiveis.map(l => (
                <tr key={l.chave} className="hover:bg-primary-50/40 cursor-pointer" onClick={() => setFicha(l.chave)}>
                  <td className="px-2 py-1.5 font-medium max-w-[240px]"><div className="truncate" title={l.cliente}>{l.cliente}</div>
                    <div className="text-[10px] text-slate-400 truncate">{l.comando}</div>
                    <div className="md:hidden text-[10px] text-slate-500">{l.pctInad === null ? '' : `${l.pctInad}% inad. · `}{l.qtdVencidas} venc. · últ. mov. {br(l.ultimaMov)}</div></td>
                  {visao === 'faixas' && <td className="px-2 hidden xl:table-cell text-slate-500 max-w-[200px] truncate" title={l.comando}>{l.comando}</td>}
                  <td className="px-2 text-right tabular-nums">{brl(l.emAberto)}</td>
                  <td className={`px-2 text-right tabular-nums font-bold ${l.vencido > 0 ? 'text-red-700' : 'text-slate-400'}`}>{brl(l.vencido)}</td>
                  {visao === 'ranking' ? <>
                    <td className="px-2 text-right hidden md:table-cell">{l.pctInad === null ? '—' : `${l.pctInad.toLocaleString('pt-BR')}%`}</td>
                    <td className="px-2 text-right hidden md:table-cell">{l.qtdVencidas || ''}</td>
                    <td className={`px-2 text-right tabular-nums hidden lg:table-cell ${l.v90 ? 'text-orange-700 font-semibold' : ''}`}>{l.v90 ? brl(l.v90) : ''}</td>
                    <td className={`px-2 text-right tabular-nums hidden lg:table-cell ${l.v365 ? 'text-red-800 font-bold' : ''}`}>{l.v365 ? brl(l.v365) : ''}</td>
                    <td className="px-2 text-right tabular-nums hidden lg:table-cell text-amber-700">{l.contestado ? brl(l.contestado) : ''}</td>
                    <td className={`px-2 text-right tabular-nums hidden md:table-cell ${l.variacao > 0 ? 'text-red-700' : l.variacao < 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{l.variacao ? fmtCampo('variacao', l) : '—'}</td>
                  </> : FAIXAS_ATRASO.map((f, i) => <td key={f} className={`px-2 text-right tabular-nums hidden md:table-cell ${i >= 2 && l.porFaixa[f] ? 'text-red-700 font-semibold' : ''}`}>{l.porFaixa[f] ? brl(l.porFaixa[f]) : ''}</td>)}
                  <td className="px-2 hidden md:table-cell whitespace-nowrap">{br(l.ultimaMov)}</td>
                </tr>
              ))}
              {!visiveis.length && <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-400">Nenhuma OM com esse filtro.</td></tr>}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-slate-200 text-xs text-slate-600">
            <button type="button" disabled={pag === 0} onClick={() => setPagina(pag - 1)} className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40">← Anterior</button>
            <span>Página {pag + 1} de {paginas}</span>
            <button type="button" disabled={pag >= paginas - 1} onClick={() => setPagina(pag + 1)} className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40">Próxima →</button>
          </div>
        )}
      </section>
      {ficha && <FichaOM chave={ficha} ctx={ctx} onClose={() => setFicha(null)} />}
    </div>
  );
};
