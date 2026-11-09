import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, Download, Pencil, RefreshCw } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Button } from '../components/ui/Button';
import { BarraGrupos } from '../components/gastos/BarraGrupos';
import { Detalhe, DetalheGastos, detalheEmpenhos } from '../components/gastos/DetalheGastos';
import { EditarGrupos, JuntarFornecedor } from '../components/gastos/EdicaoGastos';
import { PARAM_GRUPOS, PARAM_UNIAO, useGastosBNIC } from '../components/gastos/useGastos';
import { Kpi, Secao, Vazio, br, brl, compacto, mesBR, qtdBR } from '../components/painel/comum';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { CATEGORIAS_SEM_RUBRICA, Fornecedor, GrupoGasto, LinhaGasto, SUBGRUPOS, SubgrupoId, Utilidade, chaveFornecedor, grupoDaRubrica, mesDe } from '../utils/gastosBNIC';
import { notify } from '../utils/notify';
import { hojeISO } from '../utils/datas';

const COR_SEM = '#94a3b8';
/** Serviços que a própria base consome e que se espera ver medidos para a BNIC. */
const UTILIDADES_ESPERADAS = ['AE', 'EL', 'TL', 'GS'];
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR')}%`);
type MetricaRubrica = 'previsto' | 'empenhado' | 'recebido';
const ROTULO_METRICA: Record<MetricaRubrica, string> = { previsto: 'Previsto', empenhado: 'Empenhado', recebido: 'Recebido das OM' };

/** Gastos da BNIC reunidos num lugar só: o que está previsto, o que já foi empenhado e recebido, o consumo da própria base e os fornecedores. */
export const GastosBNIC: React.FC = () => {
  const { user } = useAuth();
  const admin = user?.role === UserRole.ADMIN;
  const hoje = hojeISO();
  const anoAtual = Number(hoje.slice(0, 4));
  const [ano, setAno] = useState(anoAtual);
  const [de, setDe] = useState(`${anoAtual}-01`);
  const [ate, setAte] = useState(hoje.slice(0, 7));
  const [versao, setVersao] = useState(0);
  const [abertos, setAbertos] = useState<Set<SubgrupoId>>(new Set());
  const [paginaForn, setPaginaForn] = useState(0);
  const [metrica, setMetrica] = useState<MetricaRubrica>('previsto');
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [editandoGrupos, setEditandoGrupos] = useState(false);
  const [juntando, setJuntando] = useState<Fornecedor | null>(null);
  const periodo = useMemo(() => ({ de: de <= ate ? de : ate, ate: de <= ate ? ate : de }), [de, ate]);
  const { taxa, gastos, utilidades, servicos, saidas, medicoes, rubricas, opcoes, tcRecebida, saidasNoAno, salvarParametro, carregando, erro } = useGastosBNIC(ano, periodo, versao);
  const mudarAno = (a: number) => { setAno(a); setDe(`${a}-01`); setAte(a === anoAtual ? hoje.slice(0, 7) : `${a}-12`); };
  const alternar = (id: SubgrupoId) => setAbertos(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const t = gastos.totais;
  const consumoTotal = utilidades.reduce((s, u) => s + u.valor, 0);
  const semMedicao = useMemo(() => UTILIDADES_ESPERADAS.filter(sg => !utilidades.some(u => u.sigla === sg)), [utilidades]);
  const rotuloPeriodo = periodo.de === periodo.ate ? mesBR(periodo.de) : `${mesBR(periodo.de)} a ${mesBR(periodo.ate)}`;
  const anos = [anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2];
  const corGrupo = (id: string) => (id === 'semRubrica' ? COR_SEM : SUBGRUPOS.find(g => g.id === id)?.cor || COR_SEM);
  const nomeGrupo = (id: string) => (id === 'semRubrica' ? 'Empenhos sem rubrica' : SUBGRUPOS.find(g => g.id === id)?.rotulo || id);
  const chavesMes = [...SUBGRUPOS.map(g => g.id as string), 'semRubrica'].filter(k => gastos.porMes.some(p => Number(p[k]) !== 0 && p[k] !== undefined));
  const POR_PAG = 15, pagsForn = Math.max(1, Math.ceil(gastos.fornecedores.length / POR_PAG)), pagF = Math.min(paginaForn, pagsForn - 1);
  const todasLinhas = useMemo(() => gastos.grupos.flatMap(g => g.linhas), [gastos]);
  const maiores = useMemo(() => [...todasLinhas].sort((a, b) => b[metrica] - a[metrica]).filter(l => l[metrica] > 0).slice(0, 10).map(l => ({ ...l, nome: `${l.numero} · ${l.descricao}`.length > 40 ? `${`${l.numero} · ${l.descricao}`.slice(0, 39)}…` : `${l.numero} · ${l.descricao}`, valor: l[metrica] })), [todasLinhas, metrica]);

  // ---- detalhes (somente consulta): a lista que forma cada número
  const noPeriodo = useMemo(() => saidas.filter(s => mesDe(s.date) >= periodo.de && mesDe(s.date) <= periodo.ate), [saidas, periodo]);
  const arq = (nome: string) => `${nome.replace(/[^\wÀ-ú]+/g, '_').slice(0, 40)}_${periodo.de}_${periodo.ate}`;
  const verEmpenhos = (titulo: string, lista: typeof noPeriodo) => setDetalhe(detalheEmpenhos(titulo, `Notas de empenho de ${rotuloPeriodo} (anulações descontadas). Somente consulta.`, lista, arq(titulo)));
  const numerosDoGrupo = (g: GrupoGasto) => new Set(g.linhas.map(l => l.numero));
  const verRubrica = (l: LinhaGasto) => verEmpenhos(`Empenhos da rubrica ${l.numero} — ${l.descricao}`, noPeriodo.filter(s => s.rubricaNumero === l.numero));
  const verGrupo = (g: GrupoGasto) => verEmpenhos(`Empenhos — ${g.rotulo}`, noPeriodo.filter(s => s.rubricaNumero && numerosDoGrupo(g).has(s.rubricaNumero)));
  const verSemRubrica = (cat: string) => verEmpenhos(`Empenhos sem rubrica — ${CATEGORIAS_SEM_RUBRICA[cat]}`, noPeriodo.filter(s => (!s.rubricaNumero || !todasLinhas.some(l => l.numero === s.rubricaNumero)) && ((s.rubricaNumero ? 'SEM_INDICACAO' : (s.categoria && CATEGORIAS_SEM_RUBRICA[s.categoria] ? s.categoria : 'SEM_INDICACAO')) === cat)));
  const verFornecedor = (f: Fornecedor) => verEmpenhos(`Empenhos — ${f.nome}`, noPeriodo.filter(s => { const o = (s.client || '').trim() || '(sem fornecedor informado)'; const alvo = opcoes.uniao[chaveFornecedor(o)]; return chaveFornecedor(alvo || o) === f.chave; }));
  const nomeOM = (id: string) => taxa?.nomes[id] || id;
  const verUtilidade = (u: Utilidade) => {
    const meus = medicoes.filter(m => m.sigla === u.sigla && m.omId === taxa?.emissora.omId && mesDe(m.competencia) >= periodo.de && mesDe(m.competencia) <= periodo.ate).sort((a, b) => a.competencia.localeCompare(b.competencia));
    const top = u.ranking.slice(0, 10);
    setDetalhe({
      titulo: `Consumo da base — ${u.nome}`, subtitulo: `Medições da BNIC em ${rotuloPeriodo}${u.posicao ? ` · a BNIC é a ${u.posicao}ª maior de ${u.ranking.length} OM medidas neste serviço` : ''}. Quem mais consome (valor medido no período):`,
      cabecalho: ['Competência', 'Quantidade', 'Valor', 'Observação'], direita: [1, 2],
      linhas: [...meus.map(m => [mesBR(mesDe(m.competencia)), `${(m.quantidade ?? 0).toLocaleString('pt-BR')} ${u.unidade}`, brl(m.valor ?? 0), `${m.estimada ? 'estimada · ' : ''}${m.origem || ''}`]),
        ...top.map((r, i) => [<b key={i}>{i + 1}º</b>, nomeOM(r.omId), brl(r.valor), r.omId === taxa?.emissora.omId ? <b key="b">← BNIC</b> : ''])],
      total: { rotulo: 'BNIC no período', valor: u.valor, coluna: 2 },
    });
  };

  // ---- gravação (administrador): grupos das rubricas e fornecedores juntados
  const gravar = async (fn: () => Promise<void>, ok: string) => { try { await fn(); notify.success(ok); setVersao(v => v + 1); } catch (e) { notify.fail('Não foi possível gravar (somente o administrador altera estas escolhas)', e); throw e; } };
  const salvarGrupos = (m: Record<string, SubgrupoId>) => gravar(() => salvarParametro(PARAM_GRUPOS, m, 'Gastos da BNIC: grupo escolhido à mão para cada rubrica (número → grupo)'), 'Grupos gravados.');
  const juntar = (origem: Fornecedor, alvoNome: string) => gravar(() => salvarParametro(PARAM_UNIAO, { ...opcoes.uniao, [origem.chave]: alvoNome, ...Object.fromEntries(origem.variantes.map(v => [chaveFornecedor(v), alvoNome])) }, 'Gastos da BNIC: fornecedores juntados (nome de origem → nome de destino)'), 'Fornecedores juntados.');
  const desfazer = (f: Fornecedor) => gravar(() => salvarParametro(PARAM_UNIAO, Object.fromEntries(Object.entries(opcoes.uniao).filter(([, alvo]) => chaveFornecedor(alvo) !== f.chave)), 'Gastos da BNIC: fornecedores juntados (nome de origem → nome de destino)'), 'Junção desfeita.');

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Grupo', 'Rubrica', 'Descrição', `Previsto ${ano}`, `Empenhado ${rotuloPeriodo}`, 'Saldo do previsto', '% executado', 'Recebido das OM (rateio proporcional)', 'Saldo em conta'],
      ...gastos.grupos.flatMap(g => [[g.rotulo, '', '', g.previsto, g.empenhado, g.saldo, g.execucao === null ? '' : g.execucao / 100, g.recebido, g.saldoEmConta], ...g.linhas.map(l => ['', l.numero, l.descricao, l.previsto, l.empenhado, l.saldo, l.execucao === null ? '' : l.execucao / 100, l.recebido, l.saldoEmConta])]),
      ['TOTAL DAS RUBRICAS', '', '', t.previsto, t.empenhadoRubricas, t.saldo, t.execucao === null ? '' : t.execucao / 100, t.recebido, t.saldoEmConta]]), 'Previsto, empenhado e recebido');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Categoria', 'Empenhos', 'Valor empenhado'], ...gastos.semRubrica.map(x => [x.rotulo, x.qtd, x.empenhado])]), 'Empenhos sem rubrica');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Fornecedor', 'Empenhos', 'Valor', 'Rubricas', 'Categorias', 'Nomes juntados'], ...gastos.fornecedores.map(f => [f.nome, f.qtd, f.valor, f.rubricas.join(', '), f.categorias.join('; '), f.variantes.join('; ')])]), 'Fornecedores');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Serviço', 'Quantidade', 'Unidade', 'Valor (R$)', 'Total medido no complexo (R$)', '% da BNIC', 'Posição entre as OM'], ...utilidades.map(u => [u.nome, u.quantidade, u.unidade, u.valor, u.totalComplexo, u.pct === null ? '' : u.pct / 100, u.posicao ?? ''])]), 'Consumo da base');
    XLSX.writeFile(wb, `gastos_bnic_${ano}_${periodo.de}_${periodo.ate}.xlsx`);
  };
  const juntados = gastos.fornecedores.filter(f => f.variantes.length > 0);
  const alteradas = Object.keys(opcoes.grupos).length;

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Gastos da BNIC</h2>
          <p className="text-slate-500 text-sm">O que a base prevê gastar, o que já foi empenhado e recebido das OM, o consumo da própria base e os fornecedores. Somente consulta.</p>
          {taxa && <p className="text-xs text-slate-400 mt-0.5">Proposta {ano}: {taxa.status.toLowerCase()} · posição em {br(hoje)}</p>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={exportar} disabled={carregando || !taxa}><Download size={14} className="mr-1" />Excel</Button>
          <Button size="sm" variant="ghost" onClick={() => setVersao(v => v + 1)} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
        </div>
      </div>

      <section aria-label="Filtros" className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-slate-600">Exercício
          <select aria-label="Exercício" className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={ano} onChange={e => mudarAno(Number(e.target.value))}>{anos.map(a => <option key={a} value={a}>{a}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600">Período de
          <input type="month" aria-label="Período inicial" className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1" value={de} onChange={e => e.target.value && setDe(e.target.value)} /></label>
        <label className="text-xs font-semibold text-slate-600">até
          <input type="month" aria-label="Período final" className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1" value={ate} onChange={e => e.target.value && setAte(e.target.value)} /></label>
        <p className="text-xs text-slate-500 pb-2 flex-1 min-w-[240px]">O <b>previsto</b> é do exercício inteiro. O <b>empenhado</b>, o <b>recebido</b> e o <b>consumo da base</b> são do período escolhido.</p>
      </section>

      {erro && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{erro}</p>}
      {carregando && !taxa && <p className="text-sm text-slate-500">Carregando...</p>}
      {taxa && (
        <>
          {gastos.grupos.length === 0 && <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3">O exercício {ano} ainda não tem rubricas cadastradas. Elas vêm da página Taxa condominial e diárias.</p>}
          {t.qtdEmpenhos === 0 && gastos.grupos.length > 0 && (
            <p className="text-sm text-blue-900 bg-blue-50 border border-blue-200 rounded-lg p-3" role="note">
              Nenhum empenho lançado em {rotuloPeriodo}{saidasNoAno === 0 ? ' (o Fluxo de caixa ainda não tem saídas)' : ''}: o <b>empenhado</b> aparece zerado. Lance as notas de empenho no Fluxo de caixa (Nova Saída) ou importe a planilha de saídas.
            </p>
          )}

          <section aria-label="Indicadores dos gastos" className="grid gap-3 grid-cols-2 lg:grid-cols-3">
            <Kpi rotulo={`Previsto em ${ano}`} destaque cor="#2a78d6" valor={brl(t.previsto)} detalhe={`${qtdBR(todasLinhas.length)} rubrica(s) · valor vigente`} dica="Soma das rubricas da taxa condominial e dos outros gastos, depois do desconto geral." />
            <Kpi rotulo={`Empenhado · ${rotuloPeriodo}`} destaque cor="#eb6834" valor={brl(t.empenhado)} detalhe={`${qtdBR(t.qtdEmpenhos)} empenho(s)`} dica="Notas de empenho do Fluxo de caixa no período (anulações descontadas): em rubricas e sem rubrica." />
            <Kpi rotulo="Saldo do previsto" cor="#0d9488" valor={brl(t.saldo)} detalhe={t.execucao === null ? undefined : `${pct(t.execucao)} executado`} dica="Previsto − empenhado em rubricas. Empenhos sem rubrica não abatem rubrica nenhuma." />
            <Kpi rotulo={`Recebido das OM · ${rotuloPeriodo}`} cor="#16a34a" valor={brl(tcRecebida)} detalhe={`saldo em conta ${brl(t.saldoEmConta)} (recebido − empenhado)`} dica="Taxa condominial recebida no período (baixas em faturas TC). É dividida entre as rubricas na proporção de cada uma no valor cobrado das OM, como na aba Rubricas do Fluxo de caixa." />
            <Kpi rotulo={`Consumo medido da base · ${rotuloPeriodo}`} cor="#7c3aed" valor={brl(consumoTotal)} detalhe={utilidades.length ? utilidades.map(u => u.nome).join(', ') : 'nenhuma medição da BNIC'} dica="Medições do mês lançadas para a própria BNIC (água, energia, telefonia...)." />
            <Kpi rotulo="Parte da BNIC no rateio" cor="#475569" valor={taxa.quota ? brl(taxa.quota.anual) : '—'} detalhe={taxa.quota ? `${brl(taxa.quota.mensal)}/mês · ${pct(taxa.quota.percentual)} da taxa` : taxa.emissora.omId && !taxa.emissora.participaRateio ? 'a BNIC não participa do rateio' : 'sem rateio no exercício'} dica="Quanto da taxa fica com a OM emissora (só controle: não é gasto a mais, é a parte do orçamento que cabe à própria base)." />
          </section>

          <Secao titulo="Previsto, empenhado e recebido por grupo" subtitulo="De que é feito o orçamento e quanto já foi pago e recebido. Abra um grupo para ver as rubricas; clique numa rubrica para ver os empenhos."
            dica="Recebido das OM = taxa condominial recebida, dividida entre as rubricas na proporção de cada uma no valor cobrado das OM (rateio proporcional). Saldo em conta = recebido − empenhado."
            acoes={admin && <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold text-primary-700 hover:underline" onClick={() => setEditandoGrupos(true)}><Pencil size={12} />Editar grupos{alteradas ? ` (${alteradas} ajustada${alteradas > 1 ? 's' : ''})` : ''}</button>}>
            <BarraGrupos grupos={gastos.grupos} onClick={id => alternar(id as SubgrupoId)} />
            {!t.rateioDisponivel && gastos.grupos.length > 0 && <p className="mt-2 text-[11px] text-amber-800">Sem rateio da taxa no exercício (nenhuma OM com lotação): o recebido não é dividido entre as rubricas.</p>}
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-xs" aria-label="Previsto, empenhado e recebido por grupo">
                <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Grupo / rubrica</th><th className="px-2 text-right">Previsto</th><th className="px-2 text-right">Empenhado</th><th className="px-2 text-right hidden lg:table-cell">Saldo do previsto</th><th className="px-2 text-right hidden md:table-cell">% exec.</th><th className="px-2 text-right">Recebido das OM</th><th className="px-2 text-right hidden md:table-cell">Saldo em conta</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {gastos.grupos.map(g => (
                    <React.Fragment key={g.id}>
                      <tr className="bg-slate-50/70 cursor-pointer hover:bg-slate-100" onClick={() => alternar(g.id)} aria-expanded={abertos.has(g.id)}>
                        <td className="px-2 py-2 font-bold text-slate-800"><span className="inline-flex items-center gap-1.5">{abertos.has(g.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="w-2.5 h-2.5 rounded-sm" style={{ background: g.cor }} />{g.rotulo}<span className="font-normal text-slate-400">({g.linhas.length})</span>
                          <button type="button" className="font-normal text-primary-700 underline text-[11px]" onClick={e => { e.stopPropagation(); verGrupo(g); }} aria-label={`Ver empenhos do grupo ${g.rotulo}`}>empenhos</button></span></td>
                        <td className="px-2 text-right tabular-nums font-bold">{brl(g.previsto)}</td><td className="px-2 text-right tabular-nums font-bold text-orange-700">{brl(g.empenhado)}</td>
                        <td className="px-2 text-right tabular-nums hidden lg:table-cell">{brl(g.saldo)}</td><td className="px-2 text-right hidden md:table-cell">{pct(g.execucao)}</td>
                        <td className="px-2 text-right tabular-nums font-bold text-emerald-700">{brl(g.recebido)}</td><td className={`px-2 text-right tabular-nums hidden md:table-cell ${g.saldoEmConta < 0 ? 'text-red-700' : ''}`}>{brl(g.saldoEmConta)}</td>
                      </tr>
                      {abertos.has(g.id) && g.linhas.map(l => (
                        <tr key={l.numero} className="text-slate-600 cursor-pointer hover:bg-primary-50/40" onClick={() => verRubrica(l)} title="Ver os empenhos desta rubrica">
                          <td className="px-2 py-1.5 pl-9">{l.numero} · {l.descricao}</td><td className="px-2 text-right tabular-nums">{brl(l.previsto)}</td><td className="px-2 text-right tabular-nums">{l.empenhado ? brl(l.empenhado) : '—'}</td>
                          <td className="px-2 text-right tabular-nums hidden lg:table-cell">{brl(l.saldo)}</td><td className="px-2 text-right hidden md:table-cell">{pct(l.execucao)}</td>
                          <td className="px-2 text-right tabular-nums" title={`${l.pesoRateio.toLocaleString('pt-BR')}% do valor cobrado das OM`}>{l.recebido ? brl(l.recebido) : '—'}</td><td className={`px-2 text-right tabular-nums hidden md:table-cell ${l.saldoEmConta < 0 ? 'text-red-700' : ''}`}>{brl(l.saldoEmConta)}</td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                  {gastos.grupos.length > 0 && <>
                    <tr className="bg-slate-100 font-bold"><td className="px-2 py-2">Total das rubricas</td><td className="px-2 text-right tabular-nums">{brl(t.previsto)}</td><td className="px-2 text-right tabular-nums">{brl(t.empenhadoRubricas)}</td><td className="px-2 text-right tabular-nums hidden lg:table-cell">{brl(t.saldo)}</td><td className="px-2 text-right hidden md:table-cell">{pct(t.execucao)}</td><td className="px-2 text-right tabular-nums">{brl(t.recebido)}</td><td className="px-2 text-right tabular-nums hidden md:table-cell">{brl(t.saldoEmConta)}</td></tr>
                    <tr className="text-slate-600"><td className="px-2 py-1.5">Empenhos sem rubrica <span className="text-slate-400">(detalhados abaixo)</span></td><td className="px-2 text-right text-slate-400">—</td><td className="px-2 text-right tabular-nums">{brl(t.empenhadoSemRubrica)}</td><td className="hidden lg:table-cell" /><td className="hidden md:table-cell" /><td /><td className="hidden md:table-cell" /></tr>
                    <tr className="bg-slate-200 font-bold"><td className="px-2 py-2">Total empenhado</td><td /><td className="px-2 text-right tabular-nums">{brl(t.empenhado)}</td><td className="hidden lg:table-cell" /><td className="hidden md:table-cell" /><td /><td className="hidden md:table-cell" /></tr>
                  </>}
                </tbody>
              </table>
            </div>
          </Secao>

          <Secao titulo="Maiores rubricas" subtitulo="As 10 maiores no critério escolhido. Clique numa barra para ver os empenhos da rubrica."
            acoes={<div role="group" aria-label="Critério das maiores rubricas" className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs">
              {(Object.keys(ROTULO_METRICA) as MetricaRubrica[]).map((k, i) => <button key={k} type="button" aria-pressed={metrica === k} onClick={() => setMetrica(k)} className={`px-2.5 py-1 ${metrica === k ? 'bg-primary-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'} ${i ? 'border-l border-slate-300' : ''}`}>{ROTULO_METRICA[k]}</button>)}</div>}>
            {maiores.length === 0 ? <Vazio>Nenhuma rubrica com valor neste critério.</Vazio> : (
              <div className="h-72" role="img" aria-label="Gráfico das maiores rubricas">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={maiores} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 0 }} onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) verRubrica(maiores[Number(i)]); }}>
                    <CartesianGrid horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tickFormatter={compacto} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="nome" width={230} tick={{ fontSize: 10, fill: '#334155' }} axisLine={false} tickLine={false} interval={0} />
                    <Tooltip formatter={(v: any) => [brl(Number(v)), ROTULO_METRICA[metrica]]} cursor={{ fill: '#f1f5f9' }} />
                    <Bar dataKey="valor" radius={[0, 4, 4, 0]} cursor="pointer" maxBarSize={20} fill={metrica === 'previsto' ? '#2a78d6' : metrica === 'empenhado' ? '#eb6834' : '#16a34a'} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Secao>

          <Secao titulo="Empenhado mês a mês" subtitulo={`Notas de empenho de ${rotuloPeriodo}, por grupo.`}>
            {chavesMes.length === 0 ? <Vazio>Nenhum empenho no período.</Vazio> : (
              <div className="h-64" role="img" aria-label="Gráfico do empenhado por mês e por grupo">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={gastos.porMes.map(p => ({ ...p, nome: mesBR(p.mes) }))} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" /><XAxis dataKey="nome" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={compacto} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={52} />
                    <Tooltip formatter={(v: any, n: any) => [brl(Number(v)), n]} /><Legend wrapperStyle={{ fontSize: 11 }} />
                    {chavesMes.map(k => <Bar key={k} dataKey={k} name={nomeGrupo(k)} stackId="m" fill={corGrupo(k)} maxBarSize={36} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Secao>

          <div className="grid xl:grid-cols-2 gap-4">
            <Secao titulo="Empenhos sem rubrica" subtitulo="Notas de empenho que não foram ligadas a uma rubrica da taxa. Clique numa linha para ver as notas." dica="Não entram nos grupos acima, para não contar o mesmo dinheiro duas vezes.">
              {gastos.semRubrica.length === 0 ? <Vazio>Nenhum empenho sem rubrica no período.</Vazio> : (
                <table className="min-w-full text-xs" aria-label="Empenhos sem rubrica"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Categoria</th><th className="px-2 text-right">Empenhos</th><th className="px-2 text-right">Valor</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{gastos.semRubrica.map(x => <tr key={x.categoria} className="cursor-pointer hover:bg-primary-50/40" onClick={() => verSemRubrica(x.categoria)}><td className="px-2 py-1.5">{x.rotulo}</td><td className="px-2 text-right">{x.qtd}</td><td className="px-2 text-right tabular-nums font-semibold">{brl(x.empenhado)}</td></tr>)}
                    <tr className="bg-slate-100 font-bold"><td className="px-2 py-1.5">Total</td><td className="px-2 text-right">{gastos.semRubrica.reduce((s, x) => s + x.qtd, 0)}</td><td className="px-2 text-right tabular-nums">{brl(t.empenhadoSemRubrica)}</td></tr></tbody></table>
              )}
            </Secao>

            <Secao titulo="Consumo da própria base" subtitulo={`Medições lançadas para a BNIC em ${rotuloPeriodo}. Clique numa linha para ver quem mais consome.`} dica="Vem de Faturamento › Medições do mês. A BNIC não recebe fatura: o consumo dela fica registrado só para controle.">
              {utilidades.length === 0 ? <Vazio>Nenhuma medição da BNIC no período.</Vazio> : (
                <table className="min-w-full text-xs" aria-label="Consumo da própria base"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Serviço</th><th className="px-2 text-right">Quantidade</th><th className="px-2 text-right">Valor</th><th className="px-2 text-right">% do complexo</th><th className="px-2 text-right hidden md:table-cell">Posição</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">{utilidades.map(u => <tr key={u.sigla} className="cursor-pointer hover:bg-primary-50/40" onClick={() => verUtilidade(u)}><td className="px-2 py-1.5">{u.nome}</td><td className="px-2 text-right tabular-nums">{u.quantidade.toLocaleString('pt-BR')} {u.unidade}</td><td className="px-2 text-right tabular-nums font-semibold">{brl(u.valor)}</td><td className="px-2 text-right" title={`Total medido para todas as OM: ${brl(u.totalComplexo)}`}>{pct(u.pct)}</td><td className="px-2 text-right hidden md:table-cell">{u.posicao ? `${u.posicao}º de ${u.ranking.length}` : '—'}</td></tr>)}</tbody></table>
              )}
              {semMedicao.length > 0 && <p className="mt-2 text-[11px] text-slate-500">Ainda sem medição da BNIC no período: {semMedicao.map(sg => servicos.find(x => x.sigla === sg)?.nome || sg).join(', ')}. Lance em Faturamento › Medições do mês para aparecer aqui.</p>}
            </Secao>
          </div>

          <Secao titulo="Empenhos por fornecedor" subtitulo={`Quem recebeu os empenhos de ${rotuloPeriodo}. É outro recorte do mesmo dinheiro (não se soma aos grupos). Clique numa linha para ver as notas.`} dica="Agrupa pelo nome do favorecido da nota de empenho; nomes que só diferem em maiúsculas ou acentos são juntados sozinhos. Nomes realmente diferentes o administrador pode juntar.">
            {gastos.fornecedores.length === 0 ? <Vazio>Nenhum empenho no período.</Vazio> : (
              <>
                <div className="h-64 mb-3" role="img" aria-label="Gráfico dos maiores fornecedores">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={gastos.fornecedores.slice(0, 10).map(f => ({ ...f, nome: f.nome.length > 34 ? `${f.nome.slice(0, 33)}…` : f.nome }))} layout="vertical" margin={{ top: 4, right: 70, left: 4, bottom: 0 }}>
                      <CartesianGrid horizontal={false} stroke="#e2e8f0" /><XAxis type="number" tickFormatter={compacto} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="nome" width={200} tick={{ fontSize: 10, fill: '#334155' }} axisLine={false} tickLine={false} interval={0} />
                      <Tooltip formatter={(v: any) => [brl(Number(v)), 'Empenhado']} cursor={{ fill: '#f1f5f9' }} />
                      <Bar dataKey="valor" fill="#eb6834" radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto"><table className="min-w-full text-xs" aria-label="Empenhos por fornecedor">
                  <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Fornecedor</th><th className="px-2 text-right">Empenhos</th><th className="px-2 text-right">Valor</th><th className="px-2 text-left hidden md:table-cell">Rubricas / categorias</th>{admin && <th className="px-2" />}</tr></thead>
                  <tbody className="divide-y divide-slate-100">{gastos.fornecedores.slice(pagF * POR_PAG, (pagF + 1) * POR_PAG).map(f => (
                    <tr key={f.chave} className="cursor-pointer hover:bg-primary-50/40" onClick={() => verFornecedor(f)}><td className="px-2 py-1.5 font-medium max-w-[280px]"><div className="truncate" title={f.nome}>{f.nome}</div>{f.variantes.length > 0 && <div className="text-[10px] font-normal text-slate-400 truncate" title={f.variantes.join('; ')}>inclui: {f.variantes.join('; ')}</div>}</td><td className="px-2 text-right">{f.qtd}</td><td className="px-2 text-right tabular-nums font-semibold">{brl(f.valor)}</td>
                      <td className="px-2 hidden md:table-cell text-slate-500">{[...f.rubricas.map(r => `R${r}`), ...f.categorias].join(', ') || '—'}</td>
                      {admin && <td className="px-2 text-right">{f.variantes.length > 0
                        ? <button type="button" className="text-[11px] text-slate-500 underline" onClick={e => { e.stopPropagation(); desfazer(f).catch(() => undefined); }} aria-label={`Desfazer a junção de ${f.nome}`}>desfazer</button>
                        : <button type="button" className="text-[11px] text-primary-700 underline" onClick={e => { e.stopPropagation(); setJuntando(f); }} aria-label={`Juntar ${f.nome} com outro fornecedor`}>juntar com…</button>}</td>}
                    </tr>))}</tbody></table></div>
                {pagsForn > 1 && <div className="flex items-center justify-between pt-2 text-xs text-slate-600"><button type="button" disabled={pagF === 0} onClick={() => setPaginaForn(pagF - 1)} className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40">← Anterior</button><span>Página {pagF + 1} de {pagsForn}</span><button type="button" disabled={pagF >= pagsForn - 1} onClick={() => setPaginaForn(pagF + 1)} className="px-2 py-1 border border-slate-300 rounded disabled:opacity-40">Próxima →</button></div>}
                {juntados.length > 0 && <p className="mt-2 text-[11px] text-slate-500">{juntados.length} fornecedor(es) com nomes juntados (a nota de empenho continua com o nome original).</p>}
              </>
            )}
          </Secao>

          <details className="bg-white rounded-xl border border-slate-200 p-4 text-xs text-slate-700">
            <summary className="cursor-pointer font-bold text-slate-800 text-sm">Como é calculado</summary>
            <ul className="mt-3 space-y-1.5 list-disc pl-5">
              <li><b>Previsto</b>: valor vigente das rubricas da taxa condominial (1 a 33) e dos outros gastos (34 a 37) do exercício, depois do desconto geral. É a mesma proposta da página Taxa condominial e diárias.</li>
              <li><b>Empenhado</b>: saídas (NE) do Fluxo de caixa no período, sem as canceladas e anuladas; a anulação parcial entra como valor negativo. Saída com rubrica entra no grupo da rubrica; sem rubrica, em "Empenhos sem rubrica". Nenhum valor é contado duas vezes.</li>
              <li><b>Saldo do previsto</b> = previsto − empenhado em rubricas. <b>% executado</b> = empenhado do período ÷ previsto do exercício inteiro.</li>
              <li><b>Recebido das OM</b>: taxa condominial recebida no período (baixas em faturas TC, pela data da baixa), dividida entre as rubricas <b>na proporção</b> de cada uma no valor cobrado das OM. É a mesma regra da aba Rubricas do Fluxo de caixa; <b>saldo em conta</b> = recebido − empenhado. Por ser um rateio proporcional, o recebido de cada rubrica é uma estimativa, e o total fecha com o valor recebido.</li>
              <li><b>Consumo da base</b>: medições lançadas para a própria BNIC em Faturamento › Medições do mês, em R$. A posição compara com as demais OM medidas no mesmo serviço.</li>
              <li><b>Parte da BNIC no rateio</b>: quanto da taxa fica com a OM emissora. Não é gasto a mais: é a fatia do orçamento que cabe à própria base.</li>
              <li><b>Grupos das rubricas</b>: definidos pelo assunto da descrição (as linhas 34 a 37 formam "Outros gastos da BNIC"); o administrador pode ajustar o grupo de cada rubrica.</li>
            </ul>
          </details>
        </>
      )}
      {detalhe && <DetalheGastos d={detalhe} onClose={() => setDetalhe(null)} />}
      {editandoGrupos && <EditarGrupos rubricas={rubricas} atuais={opcoes.grupos} onSalvar={salvarGrupos} onClose={() => setEditandoGrupos(false)} />}
      {juntando && <JuntarFornecedor origem={juntando} todos={gastos.fornecedores} onSalvar={a => juntar(juntando, a)} onClose={() => setJuntando(null)} />}
    </div>
  );
};
