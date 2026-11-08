import React, { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Download, FileText, HelpCircle, Landmark, RefreshCw, Receipt, Search, Wallet, X } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { db } from '../services/db';
import { cadastroService } from '../services/cadastroService';
import { listarPrecos } from '../services/faturamentoService';
import { notify } from '../utils/notify';
import { Invoice, InvoiceStatus, ReceivedDocument } from '../types';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { MultiFiltro } from '../components/ui/MultiFiltro';
import { FAIXAS_IDADE, FaturaPainel, Grupo, doGrupo, emAberto, faixaIdade, resumoPainel, taxaCondominial } from '../utils/painel';
import { ComandoCad, OMCad, Rotulo, SetorCad, criarResolvedor } from '../utils/documentosOM';

// Cores (paleta validada): série 1 azul, série 2 laranja; status com rótulo; rampa azul ordinal para a idade da dívida.
const COR = { faturado: '#2a78d6', pago: '#eb6834', vencido: '#d03b3b', aVencer: '#0ca30c', grade: '#e2e8f0', eixo: '#64748b' };
const RAMPA_IDADE = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
const corIdade = (faixa: string) => (faixa === 'A vencer' ? COR.aVencer : RAMPA_IDADE[FAIXAS_IDADE.indexOf(faixa as any) - 1]);

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compacto = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`;
  if (a >= 1e3) return `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return brl(n);
};
const br = (iso: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const totalDe = (i: Invoice) => i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0);

/** Setor, comando e cliente pelo cadastro da OM (OM unificada aparece com um nome só); sem OM ligada, o texto da fatura. */
const paraPainel = (i: Invoice, rotulo: (omId: string) => Rotulo | undefined): FaturaPainel => {
  const r = i.omId ? rotulo(i.omId) : undefined;
  return {
  id: i.id, numero: i.invoiceNumber, cliente: r?.cliente || i.client, setor: r?.setor || i.sector, comando: r?.comando || i.command, tipo: i.type || i.serviceAcronym || '—',
  ano: i.yearCompetence, mes: i.monthCompetence, emissao: i.issueDate, vencimento: i.dueDate,
  total: totalDe(i), pago: i.paidAmount || 0,
  saldo: i.isCanceled || i.status === InvoiceStatus.PAID ? 0 : i.saldoAPagar ?? Math.max(0, totalDe(i) - (i.paidAmount || 0)),
  cancelada: !!i.isCanceled, contestada: !!i.contestada,
  };
};

/** Dica ao passar o mouse (ou focar com o teclado). */
const Dica: React.FC<{ texto: string }> = ({ texto }) => (
  <span className="relative group inline-flex align-middle" tabIndex={0} aria-label={texto}>
    <HelpCircle size={14} className="text-slate-400" />
    <span role="tooltip" className="pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 top-5 w-64 rounded-lg bg-slate-800 text-white text-xs font-normal normal-case tracking-normal p-2 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shadow-lg">{texto}</span>
  </span>
);

const Cartao: React.FC<{
  titulo: string; valor: number; qtd?: number; detalhe?: string; dica: string; icone: React.ElementType; cor: string; destaque?: boolean; onClick?: () => void;
}> = ({ titulo, valor, qtd, detalhe, dica, icone: Icone, cor, destaque, onClick }) => (
  <button type="button" onClick={onClick} disabled={!onClick}
    className={`text-left bg-white rounded-xl border p-4 shadow-sm transition-all ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'} ${destaque ? 'border-slate-300 ring-1 ring-slate-200' : 'border-slate-200'}`}
    style={{ borderTop: `4px solid ${cor}` }} aria-label={`${titulo}: ${brl(valor)}${qtd !== undefined ? `, ${qtd} faturas` : ''}. Clique para ver a lista.`}>
    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
      <Icone size={15} style={{ color: cor }} /> <span className="flex-1">{titulo}</span> <Dica texto={dica} />
    </div>
    <div className={`mt-2 font-bold text-slate-900 tabular-nums ${destaque ? 'text-2xl' : 'text-xl'}`}>{brl(valor)}</div>
    <div className="mt-1 text-xs text-slate-500">{qtd !== undefined && <>{qtd.toLocaleString('pt-BR')} fatura(s)</>}{detalhe && <>{qtd !== undefined ? ' · ' : ''}{detalhe}</>}</div>
    {onClick && <div className="mt-2 text-[11px] font-semibold text-primary-700">Ver faturas →</div>}
  </button>
);

const Painel: React.FC<{ titulo: string; subtitulo?: string; dica?: string; children: React.ReactNode; acoes?: React.ReactNode; className?: string }> = ({ titulo, subtitulo, dica, children, acoes, className }) => (
  <section className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 ${className || ''}`}>
    <div className="flex items-start justify-between gap-2 mb-3">
      <div>
        <h3 className="font-bold text-slate-800 flex items-center gap-2">{titulo}{dica && <Dica texto={dica} />}</h3>
        {subtitulo && <p className="text-xs text-slate-500">{subtitulo}</p>}
      </div>
      {acoes}
    </div>
    {children}
  </section>
);

const DicaGrafico: React.FC<any> = ({ active, payload, label, rotulo }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-lg p-2 text-xs">
      <div className="font-semibold text-slate-800 mb-1">{rotulo ? rotulo(label, payload) : label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-slate-700">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color || p.payload?.cor }} />
          <span className="flex-1">{p.name}</span><b className="tabular-nums">{brl(p.value)}</b>
        </div>
      ))}
      {payload[0]?.payload?.qtd !== undefined && <div className="text-slate-500 mt-1">{payload[0].payload.qtd} fatura(s) · clique para ver</div>}
    </div>
  );
};

export const Dashboard: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [documents, setDocuments] = useState<ReceivedDocument[]>([]);
  const [precos, setPrecos] = useState<{ ano: number; sigla: string; omId?: string | null; valor: number }[]>([]);
  const [nomesOM, setNomesOM] = useState<Map<string, string>>(new Map());
  const [cad, setCad] = useState<{ oms: OMCad[]; comandos: ComandoCad[]; setores: SetorCad[] }>({ oms: [], comandos: [], setores: [] });
  const [carregando, setCarregando] = useState(true);
  const hoje = hojeIso();
  const [ano, setAno] = useState(new Date().getFullYear());
  // filtros de múltipla escolha (guardam os EXCLUÍDOS). Não são lembrados: ao abrir a página, tudo volta a "Todos".
  const [exSetor, setExSetor] = useState<Set<string>>(new Set());
  const [exComando, setExComando] = useState<Set<string>>(new Set());
  const [exCliente, setExCliente] = useState<Set<string>>(new Set());
  const [exServico, setExServico] = useState<Set<string>>(new Set());
  const [ordem, setOrdem] = useState<{ campo: 'vencimento' | 'saldo' | 'total' | 'numero' | 'cliente' | 'atraso'; asc: boolean }>({ campo: 'saldo', asc: false });
  const [lista, setLista] = useState<{ titulo: string; faturas: FaturaPainel[] } | null>(null);
  const [buscaLista, setBuscaLista] = useState('');
  const [verTodasTc, setVerTodasTc] = useState(false);

  const carregar = async () => {
    setCarregando(true);
    try {
      const [invs, docs] = await Promise.all([db.getInvoices(), db.getDocuments()]);
      setInvoices(invs); setDocuments(docs);
      const a = new Date().getFullYear();
      const [p, oms, comandos, setores] = await Promise.all([listarPrecos([a - 2, a - 1, a, a + 1]).catch(() => []), cadastroService.listOMs().catch(() => []),
        cadastroService.listComandos().catch(() => []), cadastroService.listSetores().catch(() => [])]);
      setPrecos(p); setNomesOM(new Map((oms as any[]).map(o => [o.id as string, (o.sigla || o.nome) as string] as [string, string])));
      setCad({ oms: oms as any, comandos: comandos as any, setores: setores as any });
    } catch (err) { notify.fail('Erro ao carregar o painel', err); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  const resolv = useMemo(() => criarResolvedor(cad.oms, cad.comandos, cad.setores), [cad]);
  const rotuloOM = useMemo(() => {
    const porId = new Map(cad.oms.map(o => [o.id, o]));
    const memo = new Map<string, Rotulo | undefined>();
    return (id: string) => { if (!memo.has(id)) { const o = porId.get(id); memo.set(id, o ? resolv.rotuloDaOM(o) : undefined); } return memo.get(id); };
  }, [cad, resolv]);
  const todas = useMemo(() => invoices.map(i => paraPainel(i, rotuloOM)), [invoices, rotuloOM]);
  const passa = (x: { setor: string; comando: string; cliente: string }) => !exSetor.has(x.setor) && !exComando.has(x.comando) && !exCliente.has(x.cliente);
  const filtradas = useMemo(() => todas.filter(f => passa(f) && !exServico.has(f.tipo)), [todas, exSetor, exComando, exCliente, exServico]);
  const setCliente = (c: string) => setExCliente(new Set(opcoes('cliente').filter(o => o !== c)));
  const r = useMemo(() => resumoPainel(filtradas, ano, hoje), [filtradas, ano, hoje]);
  // taxa condominial segue os filtros: só as OM que passam no setor/comando/cliente, e some se o serviço TC estiver fora
  const tiposTC = useMemo(() => [...new Set(todas.filter(f => /-TC-/.test(f.numero)).map(f => f.tipo))], [todas]);
  const tcForaDoFiltro = tiposTC.length > 0 && tiposTC.every(t => exServico.has(t));
  const tc = useMemo(() => {
    const ok = (omId?: string | null) => { if (tcForaDoFiltro) return false; const rt = omId ? rotuloOM(omId) : undefined; return !rt || passa(rt); };
    // o ano da tabela vem da tabela inteira (o filtro não muda qual tabela está vigente)
    return { ...taxaCondominial(precos.filter(p => p.sigla !== 'TC' || ok(p.omId)), nomesOM, ano), ano: taxaCondominial(precos, nomesOM, ano).ano };
  }, [precos, nomesOM, ano, rotuloOM, exSetor, exComando, exCliente, tcForaDoFiltro]);
  const anos = useMemo(() => [...new Set([new Date().getFullYear(), ...todas.map(f => f.ano).filter(Boolean)])].sort((a, b) => b - a), [todas]);
  // OM que pagam taxa condominial também entram nas opções (mesmo sem fatura), para o filtro alcançar o quadro da TC
  const rotulosTC = useMemo(() => precos.filter(p => p.sigla === 'TC' && p.omId).map(p => rotuloOM(p.omId!)).filter(Boolean) as Rotulo[], [precos, rotuloOM]);
  const opcoes = (k: 'setor' | 'comando' | 'cliente' | 'tipo') => [...new Set([...todas.map(f => f[k]), ...(k === 'tipo' ? [] : rotulosTC.map(x => x[k]))].filter(Boolean))].sort();
  const resumoFiltro = (ex: Set<string>, k: 'setor' | 'comando' | 'cliente' | 'tipo') => {
    const o = opcoes(k), e = o.filter(v => ex.has(v));
    return !e.length ? '' : e.length <= 2 ? `todos exceto ${e.join(', ')}` : o.length - e.length <= 2 ? o.filter(v => !ex.has(v)).join(', ') : `${o.length - e.length} de ${o.length}`;
  };

  const abrir = (titulo: string, g: Grupo) => { setBuscaLista(''); setLista({ titulo, faturas: doGrupo(filtradas, g, ano, hoje) }); };
  const abrirFiltro = (titulo: string, f: (x: FaturaPainel) => boolean) => { setBuscaLista(''); setLista({ titulo, faturas: filtradas.filter(f) }); };
  const filtrosAtivos = ([
    ['Setor', resumoFiltro(exSetor, 'setor'), () => setExSetor(new Set())],
    ['Comando', resumoFiltro(exComando, 'comando'), () => setExComando(new Set())],
    ['Cliente', resumoFiltro(exCliente, 'cliente'), () => setExCliente(new Set())],
    ['Serviço', resumoFiltro(exServico, 'tipo'), () => setExServico(new Set())],
  ] as [string, string, () => void][]).filter(f => f[1]);

  // composição do em aberto (barra 100%)
  const composicao = [
    { nome: `Vencidas até ${ano - 1}`, valor: r.vencidasAnteriores.valor, cor: '#8f1d1d', grupo: 'VENCIDAS_ANTERIORES' as Grupo },
    { nome: `Vencidas de ${ano}`, valor: r.vencidasAno.valor, cor: COR.vencido, grupo: 'VENCIDAS_ANO' as Grupo },
    { nome: 'A vencer', valor: r.aVencer.valor, cor: COR.aVencer, grupo: 'A_VENCER' as Grupo },
  ];
  const variacao = r.faturadoAnterior ? Math.round(((r.faturadoAno.valor - r.faturadoAnterior) / r.faturadoAnterior) * 1000) / 10 : null;

  // ------------------------------------------------------------- exportações
  const listaFiltrada = useMemo(() => {
    if (!lista) return [];
    const b = buscaLista.trim().toLowerCase();
    const atraso = (f: FaturaPainel) => (f.saldo > 0.009 && f.vencimento && f.vencimento < hoje ? Date.parse(hoje) - Date.parse(f.vencimento.slice(0, 10)) : -1);
    const chave = (f: FaturaPainel): string | number => ordem.campo === 'atraso' ? atraso(f) : ordem.campo === 'vencimento' ? (f.vencimento || '9999') : (f as any)[ordem.campo];
    return lista.faturas.filter(f => !b || `${f.numero} ${f.cliente} ${f.setor} ${f.tipo}`.toLowerCase().includes(b))
      .sort((x, y) => { const a1 = chave(x), b1 = chave(y); const c = typeof a1 === 'number' ? a1 - (b1 as number) : String(a1).localeCompare(String(b1)); return (ordem.asc ? c : -c) || y.saldo - x.saldo; });
  }, [lista, buscaLista, ordem, hoje]);
  const exportarLista = () => {
    if (!lista) return;
    const ws = XLSX.utils.json_to_sheet(listaFiltrada.map(f => ({
      Fatura: f.numero, Cliente: f.cliente, Setor: f.setor, Comando: f.comando, Serviço: f.tipo, Competência: `${String(f.mes).padStart(2, '0')}/${f.ano}`,
      Emissão: br(f.emissao), Vencimento: br(f.vencimento), Valor: f.total, Pago: f.pago, 'Saldo em aberto': f.saldo, Contestada: f.contestada ? 'sim' : '',
    })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Faturas');
    XLSX.writeFile(wb, `${lista.titulo.replace(/[^\wÀ-ú]+/g, '_')}.xlsx`);
  };
  const exportarResumoPDF = () => {
    const doc = new jsPDF('l');
    doc.setFontSize(13); doc.text(`SISCONT — Painel de faturamento ${ano}`, 14, 15);
    doc.setFontSize(9); doc.text(`Posição em ${br(hoje)}${filtrosAtivos.length ? ` · Filtros: ${filtrosAtivos.map(f => `${f[0]} ${f[1]}`).join(', ')}` : ''}`, 14, 21);
    autoTable(doc, {
      startY: 26, head: [['Indicador', 'Valor', 'Faturas']],
      body: [
        [`Faturado em ${ano}`, brl(r.faturadoAno.valor), String(r.faturadoAno.qtd)],
        [`Vencidas até ${ano - 1}`, brl(r.vencidasAnteriores.valor), String(r.vencidasAnteriores.qtd)],
        [`Vencidas de ${ano}`, brl(r.vencidasAno.valor), String(r.vencidasAno.qtd)],
        ['Total vencidas', brl(r.vencidas.valor), String(r.vencidas.qtd)],
        ['A vencer', brl(r.aVencer.valor), String(r.aVencer.qtd)],
        ['Total em aberto (sem contestadas)', brl(r.emAberto.valor), String(r.emAberto.qtd)],
        ['Em contestação (fora do em aberto)', brl(r.contestadas.valor), String(r.contestadas.qtd)],
        ...(tc.ano ? [[`Taxa condominial ${tc.ano} (mensal / anual)`, `${brl(tc.mensal)} / ${brl(tc.anual)}`, `${tc.oms.length} OM`]] : []),
      ],
      styles: { fontSize: 9 },
    });
    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 6, head: [['Em aberto por setor', 'Vencido', 'A vencer', 'Total']],
      body: r.porSetor.map(s => [s.nome, brl(s.vencido), brl(s.aVencer), brl(s.total)]), styles: { fontSize: 8 },
    });
    doc.save(`painel_siscont_${ano}.pdf`);
  };
  const exportarSaldosPDF = () => {
    const doc = new jsPDF('l');
    doc.text('Extrato de saldos disponíveis e faturas em aberto - SISCONT', 14, 15);
    doc.setFontSize(9); doc.text(`Posição em ${br(hoje)} · faturas em contestação fora do em aberto${filtrosAtivos.length ? ` · Filtros: ${filtrosAtivos.map(f => `${f[0]} ${f[1]}`).join(', ')}` : ''}`, 14, 20);
    const docs = documents.filter(d => d.availableValue > 0.005 && passa(resolv.rotuloDoDocumento(d)));
    autoTable(doc, { startY: 25, head: [['Setor', 'Comando', 'Cliente', 'Documento', 'Operação', 'Saldo disponível']], body: docs.map(d => { const rt = resolv.rotuloDoDocumento(d); return [rt.setor, rt.comando, rt.cliente, d.documentNumber, d.operation, brl(d.availableValue)]; }), styles: { fontSize: 8 } });
    autoTable(doc, { startY: (doc as any).lastAutoTable.finalY + 8, head: [['Setor', 'Cliente', 'Serviço', 'Fatura', 'Vencimento', 'Saldo em aberto']], body: doGrupo(filtradas, 'EM_ABERTO', ano, hoje).map(f => [f.setor, f.cliente, f.tipo, f.numero, br(f.vencimento), brl(f.saldo)]), styles: { fontSize: 8 } });
    doc.save('extrato_saldos_siscont.pdf');
  };

  const devedores = r.porCliente.slice(0, 10);
  const tiposAbertos = r.porTipo.slice(0, 8);
  const tcVisiveis = verTodasTc ? tc.oms : tc.oms.slice(0, 12);

  return (
    <div className="space-y-5">
      {/* Cabeçalho e filtros (uma linha) */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Painel inicial</h2>
          <p className="text-slate-500 text-sm">Posição em <b>{br(hoje)}</b>. Clique em qualquer cartão ou barra para ver as faturas.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />}Atualizar</Button>
          <Button size="sm" variant="secondary" onClick={exportarResumoPDF}><FileText size={14} className="mr-1" />Resumo (PDF)</Button>
          <Button size="sm" variant="secondary" onClick={exportarSaldosPDF}><Wallet size={14} className="mr-1" />Extrato de saldos (PDF)</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3 bg-white p-3 rounded-xl border border-slate-200">
        <label className="text-xs font-semibold text-slate-600">Ano de referência
          <select className="block mt-1 text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Ano de referência">
            {anos.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <MultiFiltro rotulo="Setor" opcoes={opcoes('setor')} excluidos={exSetor} onChange={setExSetor} />
        <MultiFiltro rotulo="Comando" opcoes={opcoes('comando')} excluidos={exComando} onChange={setExComando} largura="w-96" />
        <MultiFiltro rotulo="Cliente (OM)" opcoes={opcoes('cliente')} excluidos={exCliente} onChange={setExCliente} largura="w-96" />
        <MultiFiltro rotulo="Serviço" opcoes={opcoes('tipo')} excluidos={exServico} onChange={setExServico} />
        {filtrosAtivos.length > 0 && (
          <div className="flex flex-wrap gap-1 pb-1">
            {filtrosAtivos.map(([rot, v, limpar]) => (
              <button key={rot} onClick={limpar} className="text-xs bg-primary-50 text-primary-800 border border-primary-200 rounded-full px-2 py-1 flex items-center gap-1" title="Remover filtro">{rot}: {v} <X size={12} /></button>
            ))}
          </div>
        )}
      </div>

      {filtrosAtivos.length > 0 && (
        <div className="p-3 rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-900 text-sm flex flex-wrap items-center gap-3" role="status">
          <AlertTriangle size={18} className="shrink-0" />
          <span className="flex-1"><b>Filtro ativo</b> — os valores abaixo <b>não são o total geral</b>: {filtrosAtivos.map(f => `${f[0]} ${f[1]}`).join(' · ')}.</span>
          <button onClick={() => { setExSetor(new Set()); setExComando(new Set()); setExCliente(new Set()); setExServico(new Set()); }} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">Limpar filtros (ver total geral)</button>
        </div>
      )}
      {/* Números de cara: linha 1 = o essencial; linha 2 = detalhamento das vencidas e a taxa condominial */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Cartao titulo={`Faturado em ${ano}`} valor={r.faturadoAno.valor} qtd={r.faturadoAno.qtd} icone={Receipt} cor={COR.faturado} destaque
          detalhe={`${r.percentualPago.toLocaleString('pt-BR')}% já pago${variacao !== null ? ` · ${variacao >= 0 ? '+' : ''}${variacao.toLocaleString('pt-BR')}% vs ${ano - 1}` : ''}`}
          dica={`Soma de todas as faturas emitidas com competência em ${ano} (sem as canceladas).`} onClick={() => abrir(`Faturas de ${ano}`, 'FATURADAS_ANO')} />
        <Cartao titulo="Total vencidas" valor={r.vencidas.valor} qtd={r.vencidas.qtd} icone={AlertTriangle} cor={COR.vencido} destaque
          detalhe={r.emAberto.valor ? `${Math.round((r.vencidas.valor / r.emAberto.valor) * 100)}% do em aberto` : undefined}
          dica="Faturas em aberto cujo vencimento já passou (soma das vencidas de anos anteriores e do ano)." onClick={() => abrir('Faturas vencidas', 'VENCIDAS')} />
        <Cartao titulo="A vencer" valor={r.aVencer.valor} qtd={r.aVencer.qtd} icone={CheckCircle2} cor={COR.aVencer} destaque
          detalhe="ainda dentro do prazo"
          dica="Faturas em aberto ainda dentro do prazo de vencimento (emissão + 30 dias)." onClick={() => abrir('Faturas a vencer', 'A_VENCER')} />
        <Cartao titulo="Total em aberto" valor={r.emAberto.valor} qtd={r.emAberto.qtd} icone={Wallet} cor="#475569" destaque
          detalhe="= vencidas + a vencer · sem as contestadas"
          dica="Tudo o que ainda falta receber: saldo das faturas não pagas (já descontados pagamentos e adiantamentos). As faturas em contestação ficam fora e aparecem no cartão próprio." onClick={() => abrir('Faturas em aberto', 'EM_ABERTO')} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Cartao titulo={`Vencidas até ${ano - 1}`} valor={r.vencidasAnteriores.valor} qtd={r.vencidasAnteriores.qtd} icone={CalendarClock} cor="#8f1d1d"
          detalhe={r.anosVencidos.filter(a => a.ano < ano).slice(0, 3).map(a => `${a.ano}: ${compacto(a.valor)}`).join(' · ')}
          dica={`Faturas vencidas de competência de exercícios anteriores a ${ano}.`} onClick={() => abrir(`Vencidas de anos anteriores a ${ano}`, 'VENCIDAS_ANTERIORES')} />
        <Cartao titulo={`Vencidas de ${ano}`} valor={r.vencidasAno.valor} qtd={r.vencidasAno.qtd} icone={Clock} cor={COR.vencido}
          dica={`Faturas vencidas de competência ${ano}.`} onClick={() => abrir(`Vencidas de ${ano}`, 'VENCIDAS_ANO')} />
        <Cartao titulo="Em contestação" valor={r.contestadas.valor} qtd={r.contestadas.qtd} icone={HelpCircle} cor="#b45309"
          detalhe="fora do em aberto"
          dica="Faturas com contestação aberta: não entram no em aberto, nas vencidas, nos gráficos nem nos maiores devedores até a contestação ser resolvida."
          onClick={() => abrir('Faturas em contestação', 'CONTESTADAS')} />
        <Cartao titulo={`Taxa condominial ${tc.ano ?? ''} (mensal)`.trim()} valor={tc.mensal} icone={Landmark} cor={COR.faturado}
          detalhe={tcForaDoFiltro ? 'serviço fora do filtro' : tc.ano ? `${tc.oms.length} OM · anual ${compacto(tc.anual)}` : 'tabela ainda não publicada'}
          dica="Soma da taxa condominial mensal de todas as OM (tabela vigente). O valor de cada OM está mais abaixo."
          onClick={tc.oms.length ? () => document.getElementById('painel-tc')?.scrollIntoView({ behavior: 'smooth' }) : undefined} />
      </div>

      {/* Composição do em aberto */}
      <Painel titulo="De que é feito o em aberto" subtitulo="Cada faixa é clicável. Vermelho escuro = mais antigo." dica="A barra soma 100% do total em aberto, dividido entre vencidas de anos anteriores, vencidas do ano e a vencer.">
        {r.emAberto.valor > 0 ? (
          <>
            <div className="flex h-9 w-full rounded-lg overflow-hidden gap-[2px] bg-white" role="img" aria-label="Composição do total em aberto">
              {composicao.filter(c => c.valor > 0).map(c => (
                <button key={c.nome} title={`${c.nome}: ${brl(c.valor)} (${Math.round((c.valor / r.emAberto.valor) * 100)}%)`} aria-label={`Faixa da barra — ${c.nome}, ${Math.round((c.valor / r.emAberto.valor) * 100)}%`} onClick={() => abrir(c.nome, c.grupo)}
                  className="h-full hover:opacity-80 transition-opacity first:rounded-l-lg last:rounded-r-lg" style={{ width: `${(c.valor / r.emAberto.valor) * 100}%`, background: c.cor, minWidth: 6 }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-xs">
              {composicao.map(c => (
                <span key={c.nome} className="flex items-center gap-1.5 text-slate-700"><span className="w-3 h-3 rounded-sm" style={{ background: c.cor }} />{c.nome}: <b className="tabular-nums">{brl(c.valor)}</b><span className="text-slate-500">({r.emAberto.valor ? Math.round((c.valor / r.emAberto.valor) * 100) : 0}%)</span></span>
              ))}
            </div>
          </>
        ) : <p className="text-sm text-emerald-700 flex items-center gap-2"><CheckCircle2 size={16} />Nenhuma fatura em aberto com os filtros escolhidos.</p>}
      </Painel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Painel titulo={`Faturado por mês — ${ano}`} subtitulo="Barras azuis: valor faturado na competência · laranja: quanto dessas faturas já foi pago" dica="Clique numa barra para ver as faturas daquela competência.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.porMes} margin={{ top: 4, right: 8, left: 8, bottom: 0 }} barGap={2}
                onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) abrirFiltro(`Faturas de ${r.porMes[Number(i)].mes}/${ano}`, f => !f.cancelada && f.ano === ano && f.mes === Number(i) + 1); }}>
                <CartesianGrid vertical={false} stroke={COR.grade} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: COR.eixo }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={78} />
                <Tooltip content={<DicaGrafico rotulo={(l: string) => `${l}/${ano}`} />} cursor={{ fill: '#f1f5f9' }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v: any) => <span style={{ color: '#334155' }}>{v}</span>} />
                <Bar dataKey="faturado" name="Faturado" fill={COR.faturado} radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={22} />
                <Bar dataKey="pago" name="Já pago" fill={COR.pago} radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Painel>

        <Painel titulo="Idade da dívida" subtitulo="Quanto tempo o valor em aberto está vencido" dica="Verde: ainda no prazo. Tons de azul cada vez mais escuros: vencidas há mais tempo. Clique numa barra para ver as faturas.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.idade.map(i => ({ ...i, cor: corIdade(i.faixa) }))} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
                onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) { const fx = r.idade[Number(i)].faixa; abrirFiltro(`Em aberto: ${fx}`, f => emAberto(f) && faixaIdade(f, hoje) === fx); } }}>
                <CartesianGrid vertical={false} stroke={COR.grade} />
                <XAxis dataKey="faixa" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={78} />
                <Tooltip content={<DicaGrafico />} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" name="Em aberto" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={48}>
                  {r.idade.map(i => <Cell key={i.faixa} fill={corIdade(i.faixa)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Painel>

        <Painel titulo="Maiores devedores" subtitulo="As 10 OM/clientes com maior valor em aberto" dica="Vermelho: parte vencida · verde: parte a vencer. Clique para filtrar o painel por esse cliente.">
          <div style={{ height: Math.max(180, devedores.length * 30 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={devedores} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={6}
                onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) setCliente(devedores[Number(i)].nome); }}>
                <CartesianGrid horizontal={false} stroke={COR.grade} />
                <XAxis type="number" tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nome" width={170} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
                <Tooltip content={<DicaGrafico />} cursor={{ fill: '#f1f5f9' }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v: any) => <span style={{ color: '#334155' }}>{v}</span>} />
                <Bar dataKey="vencido" name="Vencido" stackId="d" fill={COR.vencido} stroke="#ffffff" strokeWidth={1} cursor="pointer" />
                <Bar dataKey="aVencer" name="A vencer" stackId="d" fill={COR.aVencer} stroke="#ffffff" strokeWidth={1} radius={[0, 4, 4, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Painel>

        <Painel titulo="Em aberto por serviço" subtitulo="Água, energia, taxa condominial, diárias..." dica="Clique numa barra para ver as faturas em aberto daquele serviço.">
          <div style={{ height: Math.max(180, tiposAbertos.length * 30 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tiposAbertos} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={6}
                onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) { const t = tiposAbertos[Number(i)].nome; abrirFiltro(`Em aberto: ${t}`, f => f.tipo === t && emAberto(f)); } }}>
                <CartesianGrid horizontal={false} stroke={COR.grade} />
                <XAxis type="number" tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="nome" width={170} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 25)}…` : v)} />
                <Tooltip content={<DicaGrafico />} cursor={{ fill: '#f1f5f9' }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} formatter={(v: any) => <span style={{ color: '#334155' }}>{v}</span>} />
                <Bar dataKey="vencido" name="Vencido" stackId="t" fill={COR.vencido} stroke="#ffffff" strokeWidth={1} cursor="pointer" />
                <Bar dataKey="aVencer" name="A vencer" stackId="t" fill={COR.aVencer} stroke="#ffffff" strokeWidth={1} radius={[0, 4, 4, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Painel>
      </div>

      {/* Taxa condominial */}
      <div id="painel-tc" />
      <Painel titulo={`Taxa condominial ${tc.ano ?? ''}`.trim()} subtitulo={tc.ano && tc.ano !== ano ? `Tabela de ${ano} ainda não publicada: mostrando a de ${tc.ano}.` : 'Valor mensal cobrado de cada OM (tabela vigente publicada)'}
        dica="Vem dos Preços do ano (publicados pela tela Taxa condominial e diárias)." acoes={<Landmark size={18} className="text-slate-400" />}>
        {tc.oms.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200"><div className="text-xs text-slate-500">Total mensal ({filtrosAtivos.length ? 'OM do filtro' : 'todas as OM'})</div><div className="text-2xl font-bold text-slate-900 tabular-nums">{brl(tc.mensal)}</div></div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200"><div className="text-xs text-slate-500">Total anual</div><div className="text-xl font-bold text-slate-900 tabular-nums">{brl(tc.anual)}</div></div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200"><div className="text-xs text-slate-500">OM que pagam a taxa</div><div className="text-xl font-bold text-slate-900">{tc.oms.length}</div></div>
            </div>
            <div className="lg:col-span-2">
              <div style={{ height: tcVisiveis.length * 26 + 30 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tcVisiveis} layout="vertical" margin={{ top: 0, right: 90, left: 0, bottom: 0 }} barCategoryGap={4}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 21)}…` : v)} />
                    <Tooltip content={<DicaGrafico rotulo={(l: string, p: any[]) => `${l} · ${p[0]?.payload?.percentual}% do total · anual ${brl(p[0]?.payload?.anual)}`} />} cursor={{ fill: '#f1f5f9' }} />
                    <Bar dataKey="mensal" name="Mensal" fill={COR.faturado} radius={[0, 4, 4, 0]}
                      label={{ position: 'right', fontSize: 11, fill: '#334155', formatter: (v: any) => brl(Number(v)) }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {tc.oms.length > 12 && <button className="text-xs text-primary-700 font-semibold mt-1" onClick={() => setVerTodasTc(!verTodasTc)}>{verTodasTc ? 'Mostrar só as 12 maiores' : `Mostrar todas as ${tc.oms.length} OM`}</button>}
            </div>
          </div>
        ) : tcForaDoFiltro || (filtrosAtivos.length && precos.some(p => p.sigla === 'TC')) ? <p className="text-sm text-slate-500">Nenhuma OM com taxa condominial no filtro escolhido.</p>
        : <p className="text-sm text-slate-500">Nenhuma tabela de taxa condominial publicada. Publique em <b>Contabilidade de custos → Taxa condominial e diárias</b>.</p>}
      </Painel>

      {/* Lista de faturas (abre ao clicar) */}
      <Modal isOpen={!!lista} onClose={() => setLista(null)} title={lista?.titulo || ''} maxWidth="max-w-5xl">
        {lista && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm text-slate-600"><b>{listaFiltrada.length}</b> fatura(s) · em aberto <b>{brl(listaFiltrada.reduce((s, f) => s + f.saldo, 0))}</b> · valor <b>{brl(listaFiltrada.reduce((s, f) => s + f.total, 0))}</b></div>
              <div className="flex-1" />
              <label className="relative"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><input className="pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-md" placeholder="Buscar fatura, cliente..." value={buscaLista} onChange={e => setBuscaLista(e.target.value)} aria-label="Buscar na lista" /></label>
              <Button size="sm" variant="secondary" onClick={exportarLista}><Download size={14} className="mr-1" />Excel</Button>
            </div>
            <div className="max-h-[60vh] overflow-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
                  {([['numero', 'Fatura', 'text-left'], ['cliente', 'Cliente', 'text-left'], [null, 'Serviço', 'text-left'], [null, 'Comp.', ''], ['vencimento', 'Vencimento', ''], ['atraso', 'Atraso', 'text-right'], ['total', 'Valor', 'text-right'], ['saldo', 'Em aberto', 'text-right']] as const).map(([c, rot, al]) => (
                    <th key={rot} className={`px-2 py-2 ${al}`} aria-sort={c && ordem.campo === c ? (ordem.asc ? 'ascending' : 'descending') : undefined}>
                      {c ? <button type="button" className="font-semibold hover:text-primary-700" onClick={() => setOrdem(o => ({ campo: c, asc: o.campo === c ? !o.asc : c === 'vencimento' || c === 'numero' || c === 'cliente' }))} title="Clique para ordenar">{rot}{ordem.campo === c ? (ordem.asc ? ' ▲' : ' ▼') : ''}</button> : rot}
                    </th>
                  ))}
                </tr></thead>
                <tbody>
                  {listaFiltrada.slice(0, 500).map(f => {
                    const atraso = f.saldo > 0.009 && f.vencimento && f.vencimento < hoje ? Math.floor((Date.parse(hoje) - Date.parse(f.vencimento.slice(0, 10))) / 86400000) : 0;
                    return (
                      <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">{f.numero}{f.contestada && <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 rounded px-1">contestada</span>}</td>
                        <td className="px-2 max-w-[220px] truncate" title={f.cliente}>{f.cliente}</td>
                        <td className="px-2">{f.tipo}</td>
                        <td className="px-2 text-center">{String(f.mes).padStart(2, '0')}/{f.ano}</td>
                        <td className="px-2 text-center">{br(f.vencimento)}</td>
                        <td className={`px-2 text-right ${atraso ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>{atraso ? `${atraso} dias` : '—'}</td>
                        <td className="px-2 text-right tabular-nums">{brl(f.total)}</td>
                        <td className="px-2 text-right tabular-nums font-semibold">{brl(f.saldo)}</td>
                      </tr>
                    );
                  })}
                  {!listaFiltrada.length && <tr><td colSpan={8} className="px-2 py-6 text-center text-slate-400">Nenhuma fatura.</td></tr>}
                </tbody>
              </table>
            </div>
            {listaFiltrada.length > 500 && <p className="text-xs text-slate-500">Mostrando as 500 de maior valor; o Excel traz todas.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
};

