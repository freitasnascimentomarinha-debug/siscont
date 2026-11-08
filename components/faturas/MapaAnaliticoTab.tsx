import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, FileCheck, FileSpreadsheet, FileText, Network, Search, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Client, Invoice, InvoiceStatus, PaymentAllocation, ReceivedDocument } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import {
  CAB_PDF_ARVORE, FaturaMapa, LinhaCreditoMapa, LinhaFaturaMapa, NivelPdf, NoMapa, OMRef, OrdemMapa, clientesDoMapa, creditosDoMapa, creditosDoMapaLista, faturasDoMapa,
  idsDoMapa, linhasArvorePdf, linhasMapa, montarMapa,
} from '../../utils/mapaAnalitico';
import { dataBR, hojeISO } from '../../utils/datas';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const vazio = (n: number) => (n > 0.005 ? brl(n) : '—');
/** Cartão que filtra a árvore: clicar liga o filtro, clicar de novo desliga. */
const Cartao: React.FC<{ rotulo: string; valor: string; dica: string; tom?: 'normal' | 'alerta' | 'ok' | 'destaque'; ativo?: boolean; onClick?: () => void }> = ({ rotulo, valor, dica, tom = 'normal', ativo, onClick }) => (
  <button type="button" onClick={onClick} disabled={!onClick} title={dica} aria-pressed={!!ativo}
    className={`text-left p-3 rounded-lg border transition-all ${ativo ? 'bg-primary-50 border-primary-500 ring-2 ring-primary-400' : 'bg-white'} ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'} ${!ativo ? (tom === 'alerta' ? 'border-red-200' : tom === 'destaque' ? 'border-slate-800 ring-1 ring-slate-800' : 'border-slate-200') : ''}`}>
    <div className="text-[11px] uppercase font-semibold text-slate-500">{rotulo}</div>
    <div className={`text-lg font-bold tabular-nums ${tom === 'alerta' ? 'text-red-700' : tom === 'ok' ? 'text-green-700' : 'text-slate-900'}`}>{valor}</div>
    {onClick && <div className="text-[11px] font-semibold text-primary-700 mt-0.5">{ativo ? 'Filtro ligado · clique para tirar' : 'Mostrar na árvore →'}</div>}
  </button>
);

type OMLinha = NoMapa & { setor: string; comando: string };
interface Detalhe { titulo: string; faturas?: LinhaFaturaMapa[]; creditos?: LinhaCreditoMapa[]; oms?: OMLinha[]; modoOM?: 'liquido' | 'sobra' }

/** Mapa Analítico de Contas: posição líquida por Setor › Comando › OM, com o crédito de cada OM abatendo só a dívida dela. */
export const MapaAnaliticoTab: React.FC<{ invoices: Invoice[]; docs: ReceivedDocument[]; baixas: PaymentAllocation[]; clients: Client[]; onVerFaturas: (nome: string) => void }> = ({ invoices, docs, baixas, clients, onVerFaturas }) => {
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<OrdemMapa>('liquido');
  const [soComValor, setSoComValor] = useState(false);
  const [filtroFat, setFiltroFat] = useState<string | undefined>(undefined); // 'vencidas' | 'aVencer' | faixa de atraso
  const [semContestadas, setSemContestadas] = useState(true);
  const [soComCredito, setSoComCredito] = useState(false);
  const [soSobra, setSoSobra] = useState(false);
  const [foco, setFoco] = useState<{ setor?: string; om?: string }>({});
  const [abertos, setAbertos] = useState<Set<string> | null>(null); // null = só os setores abertos (padrão)
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [buscaLista, setBuscaLista] = useState('');
  const hoje = hojeISO();

  const faturas = useMemo<FaturaMapa[]>(() => invoices
    .filter(i => !i.isCanceled && (i.status === InvoiceStatus.OPEN || i.status === InvoiceStatus.OVERDUE) && (i.saldoAPagar ?? 0) > 0.005)
    .map(i => ({ id: i.id, omId: i.omId ?? null, client: i.client, sector: i.sector, command: i.command, numero: i.invoiceNumber, tipo: i.type, vencimento: i.dueDate, saldo: i.saldoAPagar ?? 0, contestada: i.contestada })), [invoices]);
  const oms = useMemo<OMRef[]>(() => clients.filter(c => c.omId).map(c => ({ omId: c.omId!, nome: c.name, setor: c.sector, comando: c.command })), [clients]);
  const creditos = useMemo(() => creditosDoMapa(
    docs.filter(d => d.availableValue > 0.005).map(d => ({ id: d.id, client: d.client, sector: d.sector, command: d.command, numero: d.documentNumber, availableValue: d.availableValue })),
    baixas.map(b => ({ documentId: b.documentId, invoiceId: b.invoiceId, amount: b.amount })),
    invoices.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, omId: i.omId ?? null, client: i.client, isCanceled: i.isCanceled })), oms), [docs, baixas, invoices, oms]);
  const mapa = useMemo(() => montarMapa(faturas, creditos, oms, { hoje, ordem, busca, soComValor, soComCredito, soSobra, faturas: filtroFat, semContestadas, ...foco }), [faturas, creditos, oms, hoje, ordem, busca, soComValor, soComCredito, soSobra, filtroFat, semContestadas, foco]);
  const contestadas = useMemo(() => faturas.filter(f => f.contestada), [faturas]);
  const limparCartoes = () => { setFiltroFat(undefined); setSoComValor(false); setSoComCredito(false); setSoSobra(false); };
  const alternarFat = (v: string) => setFiltroFat(x => (x === v ? undefined : v));
  const ROTULO_FAT: Record<string, string> = { vencidas: 'Só faturas vencidas', aVencer: 'Só faturas a vencer', 'A vencer': 'Só faturas a vencer' };

  const padrao = useMemo(() => new Set(idsDoMapa(mapa, 'setor')), [mapa]);
  const aberto = (id: string) => (abertos ?? padrao).has(id) || !!busca.trim() || !!foco.om || !!filtroFat;
  const alternar = (id: string) => setAbertos(prev => { const n = new Set(prev ?? padrao); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const t = mapa.total;
  const clientes = useMemo(() => clientesDoMapa(mapa), [mapa]);
  const semCadastro = clientes.filter(x => x.semCadastro).length;
  const filtrado = !!(busca.trim() || soComValor || soComCredito || soSobra || filtroFat || foco.setor || foco.om);

  // ---------------------------------------------------------------- janelas de detalhe
  const abrir = (d: Detalhe) => { setBuscaLista(''); setDetalhe(d); };
  const abrirOM = (c: OMLinha) => abrir({ titulo: c.nome, faturas: faturasDoMapa(mapa, f => f.om === c.nome), creditos: creditosDoMapaLista(mapa).filter(x => x.om === c.nome) });
  const q = buscaLista.trim().toLowerCase();
  const fFat = (detalhe?.faturas || []).filter(f => !q || `${f.numero} ${f.om} ${f.comando} ${f.tipo}`.toLowerCase().includes(q));
  const fCre = (detalhe?.creditos || []).filter(c => !q || `${c.numero} ${c.om}`.toLowerCase().includes(q));
  const fOM = (detalhe?.oms || []).filter(c => !q || `${c.nome} ${c.comando} ${c.setor}`.toLowerCase().includes(q));
  const exportarDetalhe = () => {
    if (!detalhe) return;
    const wb = XLSX.utils.book_new();
    if (detalhe.oms) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Setor', 'Comando', 'OM', 'Faturas', 'Vencido', 'A vencer', 'Dívida', 'Crédito', 'A pagar', 'Sobra de crédito'],
      ...fOM.map(c => [c.setor, c.comando, c.nome, c.qtd, c.vencido, c.aVencer, c.divida, c.credito, c.liquido, c.sobra])]), 'OM');
    if (detalhe.faturas) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Setor', 'Comando', 'OM', 'Fatura', 'Serviço', 'Vencimento', 'Dias de atraso', 'Saldo a pagar'],
      ...fFat.map(f => [f.setor, f.comando, f.om, f.numero, f.tipo, dataBR(f.vencimento), f.atraso, f.saldo])]), 'Faturas');
    if (detalhe.creditos) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Setor', 'Comando', 'OM', 'ALTCRED/GRU', 'Crédito disponível', 'Origem'], ...fCre.map(c => [c.setor, c.comando, c.om, c.numero, c.valor, c.origem || ''])]), 'Créditos');
    XLSX.writeFile(wb, `mapa_${detalhe.titulo.replace(/[^\w]+/g, '_').slice(0, 40)}_${hoje}.xlsx`);
  };

  const exportarExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet(linhasMapa(mapa));
    ws['!cols'] = [14, 44, 50, 9, 16, 16, 16, 18, 18, 18].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Mapa analítico');
    XLSX.writeFile(wb, `mapa_analitico_${hoje}.xlsx`);
  };
  /** Texto dos filtros ligados (vai no cabeçalho do PDF). */
  const descricaoFiltros = () => {
    const f: string[] = [];
    if (filtroFat) f.push(ROTULO_FAT[filtroFat] || `faturas com ${filtroFat} de atraso`);
    if (soComValor) f.push('OM com valor a pagar');
    if (soComCredito) f.push('OM com crédito');
    if (soSobra) f.push('OM com crédito que sobra');
    if (foco.setor) f.push(`setor ${foco.setor}`);
    if (foco.om) f.push(`OM ${foco.om}`);
    if (busca.trim()) f.push(`busca "${busca.trim()}"`);
    f.push(semContestadas ? 'sem as faturas contestadas' : 'com as faturas contestadas');
    return f.join(' · ');
  };
  const exportarPdf = () => {
    const doc = new jsPDF('l');
    doc.setFontSize(9); doc.text('MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE', 14, 11);
    doc.setFontSize(13); doc.text('Mapa Analítico de Contas — posição líquida por setor, comando e OM', 14, 18);
    doc.setFontSize(8);
    doc.text(`Posição em ${dataBR(hoje)} · o crédito abate somente a dívida da própria OM`, 14, 23);
    doc.text(doc.splitTextToSize(`Filtros: ${descricaoFiltros()}`, 268), 14, 27.5);
    const linhas = linhasArvorePdf(mapa, brl, dataBR);
    const niveis: NivelPdf[] = linhas.map(l => l.nivel);
    const recuo: Record<NivelPdf, number> = { setor: 2, comando: 6, cliente: 10, fatura: 15, credito: 15 };
    autoTable(doc, {
      startY: 32, head: [CAB_PDF_ARVORE], body: linhas.map(l => l.celulas),
      foot: [['TOTAL A PAGAR (LÍQUIDO)', String(t.qtd), vazio(t.vencido), vazio(t.aVencer), vazio(t.divida), vazio(t.credito), brl(t.liquido)]],
      styles: { fontSize: 7, cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } }, headStyles: { fillColor: [15, 23, 42] }, footStyles: { fillColor: [30, 41, 59], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 118 }, 1: { halign: 'right', cellWidth: 14 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      didParseCell: (d: any) => {
        if (d.section !== 'body') { if (d.column.index >= 1) d.cell.styles.halign = 'right'; return; }
        const n = niveis[d.row.index];
        if (d.column.index === 0) d.cell.styles.cellPadding = { top: 1, bottom: 1, left: recuo[n], right: 2 };
        if (n === 'setor') { d.cell.styles.fillColor = [226, 232, 240]; d.cell.styles.fontStyle = 'bold'; }
        else if (n === 'comando') { d.cell.styles.fillColor = [241, 245, 249]; d.cell.styles.fontStyle = 'bold'; }
        else if (n === 'cliente') d.cell.styles.fontStyle = 'bold';
        else if (n === 'fatura') { d.cell.styles.textColor = [71, 85, 105]; d.cell.styles.fontSize = 6.5; }
        else if (n === 'credito') { d.cell.styles.textColor = [21, 128, 61]; d.cell.styles.fontSize = 6.5; }
      },
    });
    doc.save(`mapa_analitico_${hoje}.pdf`);
  };

  const Linha: React.FC<{ n: NoMapa; setor?: string; comando?: string }> = ({ n, setor, comando }) => {
    const abre = aberto(n.id);
    const filhos = n.nivel === 'cliente' ? (n.faturas?.length || n.creditos?.length) : n.filhos.length;
    const estilo = n.nivel === 'setor' ? 'bg-slate-100 font-bold text-slate-800' : n.nivel === 'comando' ? 'bg-slate-50 font-semibold text-slate-700' : 'bg-white text-slate-700';
    const recuo = n.nivel === 'setor' ? 'pl-3' : n.nivel === 'comando' ? 'pl-8' : 'pl-14';
    const cliqueLinha = filhos ? () => alternar(n.id) : undefined;
    return (
      <>
        <tr className={`${estilo} hover:bg-blue-50/60 ${cliqueLinha ? 'cursor-pointer' : ''}`} onClick={cliqueLinha}>
          <td className={`py-2 pr-2 ${recuo}`}>
            <div className="flex items-start gap-1.5">
              <button type="button" onClick={e => { e.stopPropagation(); alternar(n.id); }} aria-expanded={abre} aria-label={`${abre ? 'Recolher' : 'Expandir'} ${n.nome}`} className="mt-0.5 text-slate-500 shrink-0" disabled={!filhos}>
                {abre ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              <div className="min-w-0">
                {n.nivel === 'cliente'
                  ? <button type="button" className="text-left leading-tight break-words hover:text-primary-700 hover:underline" title="Abrir o detalhe desta OM" onClick={e => { e.stopPropagation(); abrirOM({ ...n, setor: setor || '', comando: comando || '' }); }}>{n.nome}</button>
                  : <div className="leading-tight break-words">{n.nome}</div>}
                <div className="flex flex-wrap gap-x-2 text-[11px] font-normal">
                  {n.nivel === 'setor' && <button type="button" className="text-primary-700 underline" onClick={e => { e.stopPropagation(); setFoco({ setor: n.nome }); }}>focar neste setor</button>}
                  {n.nivel === 'cliente' && <>
                    <button type="button" className="text-primary-700 underline" onClick={e => { e.stopPropagation(); setFoco({ om: n.nome }); }}>focar</button>
                    <button type="button" className="text-primary-700 underline" onClick={e => { e.stopPropagation(); onVerFaturas(n.nome); }}>ver faturas na lista</button>
                  </>}
                  {n.semCadastro && <span className="text-amber-700" title="O nome do cliente da ALTCRED não corresponde a nenhuma OM do cadastro">crédito sem OM no cadastro</span>}
                </div>
              </div>
            </div>
          </td>
          <td className="px-2 py-2 text-right tabular-nums text-xs">{n.qtd || '—'}</td>
          <td className={`px-2 py-2 text-right tabular-nums ${n.vencido > 0.005 ? 'text-red-700' : 'text-slate-400'}`}>{vazio(n.vencido)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{vazio(n.aVencer)}</td>
          <td className="px-2 py-2 text-right tabular-nums">{vazio(n.divida)}</td>
          <td className="px-2 py-2 text-right tabular-nums text-green-700">{vazio(n.credito)}</td>
          <td className={`px-2 py-2 text-right tabular-nums font-bold ${n.liquido > 0.005 ? 'text-red-700' : 'text-slate-400'}`}>
            {n.liquido > 0.005 ? brl(n.liquido) : '—'}
            {n.sobra > 0.005 && <div className="text-[10px] font-normal text-green-700" title="Crédito que ultrapassa a dívida da OM e fica disponível">sobra {brl(n.sobra)}</div>}
          </td>
        </tr>
        {abre && n.nivel === 'setor' && n.filhos.map(f => <Linha key={f.id} n={f} setor={n.nome} />)}
        {abre && n.nivel === 'comando' && n.filhos.map(f => <Linha key={f.id} n={f} setor={setor} comando={n.nome} />)}
        {abre && n.nivel === 'cliente' && <>
          {n.faturas!.map(f => (
            <tr key={f.id} className="bg-white text-xs text-slate-500 border-l-4 border-l-slate-200">
              <td className="py-1 pl-24 pr-2"><span className="font-mono text-slate-700">{f.numero}</span> <span className="text-slate-400">({f.tipo})</span>{f.contestada && <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 rounded px-1">contestada</span>}</td>
              <td></td>
              <td className={`px-2 py-1 text-right ${f.atraso ? 'text-red-700' : 'text-slate-400'}`} colSpan={2}>{dataBR(f.vencimento)}{f.atraso ? ` · ${f.atraso} dias` : ''}</td>
              <td className="px-2 py-1 text-right tabular-nums">{brl(f.saldo)}</td><td></td><td></td>
            </tr>
          ))}
          {n.creditos!.map(c => (
            <tr key={c.id} className="bg-white text-xs text-green-700 border-l-4 border-l-green-200">
              <td className="py-1 pl-24 pr-2 font-medium"><FileCheck size={12} className="inline mr-1" />ALTCRED/GRU: {c.numero}{c.origem && <span className="ml-2 font-normal text-green-800/80">({c.origem})</span>}</td>
              <td></td><td></td><td></td><td></td>
              <td className="px-2 py-1 text-right tabular-nums">{brl(c.valor)}</td><td></td>
            </tr>
          ))}
        </>}
      </>
    );
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
        <h3 className="font-bold text-slate-700 flex items-center gap-2"><Network size={20} className="text-primary-600" />Mapa Analítico de Contas em Aberto (posição líquida)</h3>
        <p className="text-xs text-slate-500 mt-1">Por setor, comando e OM do cadastro. A dívida é o saldo a pagar de cada fatura; o crédito (ALTCRED/GRU com saldo) abate <b>somente a dívida da própria OM</b>. Cada nível é a soma do que está dentro dele. <b>Clique nos cartões</b> para filtrar a árvore (clique de novo para tirar); clique no nome da OM para ver o detalhe dela. O PDF imprime a árvore com os filtros que estiverem ligados.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Cartao rotulo="Dívida em aberto" valor={brl(t.divida)} dica={`${t.qtd} fatura(s) com saldo a pagar. Clique para tirar os filtros dos cartões.`} ativo={!filtroFat && !soComValor && !soComCredito && !soSobra} onClick={limparCartoes} />
        <Cartao rotulo="Vencido" valor={brl(t.vencido)} tom={t.vencido > 0 ? 'alerta' : 'normal'} dica="Clique para deixar na árvore só as faturas vencidas" ativo={filtroFat === 'vencidas'} onClick={() => alternarFat('vencidas')} />
        <Cartao rotulo="A vencer" valor={brl(t.aVencer)} dica="Clique para deixar na árvore só as faturas a vencer" ativo={filtroFat === 'aVencer'} onClick={() => alternarFat('aVencer')} />
        <Cartao rotulo="Crédito usado" valor={brl(t.credito - t.sobra)} tom="ok" dica="Clique para deixar na árvore só as OM que têm crédito" ativo={soComCredito} onClick={() => setSoComCredito(v => !v)} />
        <Cartao rotulo="Crédito que sobra" valor={brl(t.sobra)} tom="ok" dica="Clique para deixar na árvore só as OM com crédito maior que a dívida" ativo={soSobra} onClick={() => setSoSobra(v => !v)} />
        <Cartao rotulo="A pagar (líquido)" valor={brl(t.liquido)} tom="destaque" dica="Clique para deixar na árvore só as OM com valor a pagar" ativo={soComValor} onClick={() => setSoComValor(v => !v)} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="relative"><span className="text-xs font-semibold text-slate-600 block mb-1">Buscar</span>
          <Search size={14} className="absolute left-2 bottom-2.5 text-slate-400" />
          <input className="pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-md w-60" placeholder="OM, comando, setor, fatura ou ALTCRED..." value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar no mapa" /></label>
        <label className="text-xs font-semibold text-slate-600">Ordenar por
          <select className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={ordem} onChange={e => setOrdem(e.target.value as OrdemMapa)} aria-label="Ordenar o mapa">
            <option value="liquido">Maior valor a pagar</option><option value="divida">Maior dívida</option><option value="nome">Nome (A–Z)</option>
          </select></label>
        <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={soComValor} onChange={e => setSoComValor(e.target.checked)} /> Só OM com valor a pagar</label>
        <label className="text-sm flex items-center gap-1.5 pb-2" title="Faturas em contestação não entram na dívida nem aparecem na árvore"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={semContestadas} onChange={e => setSemContestadas(e.target.checked)} /> Tirar as contestadas{contestadas.length ? ` (${contestadas.length} · ${brl(contestadas.reduce((x, f) => x + f.saldo, 0))})` : ''}</label>
        <div className="flex gap-3 pb-2 text-sm">
          <button type="button" className="text-primary-700 underline" onClick={() => setAbertos(new Set(idsDoMapa(mapa, 'cliente')))}>expandir tudo</button>
          <button type="button" className="text-primary-700 underline" onClick={() => setAbertos(new Set(idsDoMapa(mapa, 'comando')))}>até as OM</button>
          <button type="button" className="text-primary-700 underline" onClick={() => setAbertos(new Set())}>recolher tudo</button>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2 pb-0.5">
          <Button variant="secondary" size="sm" onClick={exportarExcel}><FileSpreadsheet size={14} className="mr-1" />Excel</Button>
          <Button variant="secondary" size="sm" onClick={exportarPdf}><FileText size={14} className="mr-1" />PDF</Button>
        </div>
      </div>

      {(foco.setor || foco.om || filtroFat || soComValor || soComCredito || soSobra) && (
        <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Filtros do mapa">
          <span className="text-slate-500">Mostrando só:</span>
          {filtroFat && <button type="button" onClick={() => setFiltroFat(undefined)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200 text-xs" title="Remover este filtro">{ROTULO_FAT[filtroFat] || `Faturas com ${filtroFat} de atraso`}{semContestadas ? ' (sem contestadas)' : ''} <X size={12} /></button>}
          {soComValor && <button type="button" onClick={() => setSoComValor(false)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200 text-xs" title="Remover este filtro">OM com valor a pagar <X size={12} /></button>}
          {soComCredito && <button type="button" onClick={() => setSoComCredito(false)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200 text-xs" title="Remover este filtro">OM com crédito <X size={12} /></button>}
          {soSobra && <button type="button" onClick={() => setSoSobra(false)} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200 text-xs" title="Remover este filtro">OM com crédito que sobra <X size={12} /></button>}
          {foco.setor && <button type="button" onClick={() => setFoco(f => ({ ...f, setor: undefined }))} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200 text-xs" title="Remover este filtro">Setor {foco.setor} <X size={12} /></button>}
          {foco.om && <button type="button" onClick={() => setFoco(f => ({ ...f, om: undefined }))} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200 text-xs" title="Remover este filtro">OM {foco.om} <X size={12} /></button>}
          <button type="button" className="text-primary-700 underline text-xs" onClick={() => { setFoco({}); limparCartoes(); }}>ver todos</button>
        </div>
      )}
      {semCadastro > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{semCadastro} crédito(s) estão em nome de um cliente que não existe no cadastro de OM; por isso não abatem nenhuma dívida. Ligue o nome da ALTCRED à OM em Recebimentos.</p>}

      <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900 text-white uppercase text-[11px] font-bold">
              <tr>
                <th className="px-3 py-3 text-left">Setor › Comando › OM</th>
                <th className="px-2 py-3 text-right">Faturas</th><th className="px-2 py-3 text-right">Vencido</th><th className="px-2 py-3 text-right">A vencer</th>
                <th className="px-2 py-3 text-right">Dívida</th><th className="px-2 py-3 text-right">Crédito</th><th className="px-2 py-3 text-right">A pagar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mapa.setores.map(s => <Linha key={s.id} n={s} />)}
              {!mapa.setores.length && <tr><td colSpan={7} className="text-center py-8 text-slate-500">{filtrado ? 'Nada com esses filtros.' : 'Nenhuma pendência encontrada.'}</td></tr>}
            </tbody>
            <tfoot className="bg-slate-800 text-white font-bold">
              <tr>
                <td className="px-3 py-3 uppercase">Total a pagar (líquido)</td>
                <td className="px-2 py-3 text-right tabular-nums">{t.qtd}</td><td className="px-2 py-3 text-right tabular-nums">{vazio(t.vencido)}</td><td className="px-2 py-3 text-right tabular-nums">{vazio(t.aVencer)}</td>
                <td className="px-2 py-3 text-right tabular-nums">{vazio(t.divida)}</td><td className="px-2 py-3 text-right tabular-nums">{vazio(t.credito)}</td><td className="px-2 py-3 text-right tabular-nums text-lg">{brl(t.liquido)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <Modal isOpen={!!detalhe} onClose={() => setDetalhe(null)} title={detalhe?.titulo || ''} maxWidth="max-w-5xl">
        {detalhe && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm text-slate-600">
                {detalhe.oms && <><b>{fOM.length}</b> OM · {detalhe.modoOM === 'sobra' ? <>sobra <b>{brl(fOM.reduce((s, c) => s + c.sobra, 0))}</b></> : <>a pagar <b>{brl(fOM.reduce((s, c) => s + c.liquido, 0))}</b></>}</>}
                {detalhe.faturas && <><b>{fFat.length}</b> fatura(s) · saldo <b>{brl(fFat.reduce((s, f) => s + f.saldo, 0))}</b></>}
                {detalhe.creditos && <>{detalhe.faturas ? ' · ' : ''}<b>{fCre.length}</b> crédito(s) · <b>{brl(fCre.reduce((s, c) => s + c.valor, 0))}</b></>}
              </div>
              <div className="flex-1" />
              <label className="relative"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><input className="pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-md" placeholder="Buscar..." value={buscaLista} onChange={e => setBuscaLista(e.target.value)} aria-label="Buscar na lista do mapa" /></label>
              <Button size="sm" variant="secondary" onClick={exportarDetalhe}><Download size={14} className="mr-1" />Excel</Button>
            </div>
            <div className="max-h-[60vh] overflow-auto space-y-4">
              {detalhe.oms && (
                <table className="w-full text-xs border border-slate-200 rounded">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr><th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-left">Setor</th><th className="px-2 py-2 text-right">Dívida</th><th className="px-2 py-2 text-right">Crédito</th><th className="px-2 py-2 text-right">{detalhe.modoOM === 'sobra' ? 'Sobra' : 'A pagar'}</th></tr></thead>
                  <tbody>{fOM.map(c => (
                    <tr key={c.id} className="border-t border-slate-100 hover:bg-primary-50/40 cursor-pointer" onClick={() => abrirOM(c)}>
                      <td className="px-2 py-1.5 font-medium"><button type="button" className="text-left hover:text-primary-700 hover:underline" title="Abrir o detalhe da OM">{c.nome}</button><div className="text-[11px] text-slate-500 font-normal">{c.comando}</div></td>
                      <td className="px-2">{c.setor}</td><td className="px-2 text-right tabular-nums">{vazio(c.divida)}</td><td className="px-2 text-right tabular-nums text-green-700">{vazio(c.credito)}</td>
                      <td className="px-2 text-right tabular-nums font-semibold">{brl(detalhe.modoOM === 'sobra' ? c.sobra : c.liquido)}</td>
                    </tr>))}</tbody>
                </table>
              )}
              {detalhe.faturas && (
                <table className="w-full text-xs border border-slate-200 rounded">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr><th className="px-2 py-2 text-left">Fatura</th><th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-left">Serviço</th><th className="px-2 py-2 text-center">Vencimento</th><th className="px-2 py-2 text-right">Atraso</th><th className="px-2 py-2 text-right">Saldo</th></tr></thead>
                  <tbody>
                    {fFat.slice(0, 500).map(f => (
                      <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono whitespace-nowrap">{f.numero}{f.contestada && <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 rounded px-1 font-sans">contestada</span>}</td>
                        <td className="px-2 max-w-[260px] truncate" title={f.om}>{f.om}</td><td className="px-2">{f.tipo}</td>
                        <td className="px-2 text-center">{dataBR(f.vencimento)}</td>
                        <td className={`px-2 text-right ${f.atraso ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>{f.atraso ? `${f.atraso} dias` : '—'}</td>
                        <td className="px-2 text-right tabular-nums font-semibold">{brl(f.saldo)}</td>
                      </tr>
                    ))}
                    {!fFat.length && <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400">Nenhuma fatura.</td></tr>}
                  </tbody>
                </table>
              )}
              {detalhe.creditos && (
                <table className="w-full text-xs border border-green-200 rounded">
                  <thead className="bg-green-50 text-green-900 sticky top-0"><tr><th className="px-2 py-2 text-left">ALTCRED/GRU</th><th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-left">Origem</th><th className="px-2 py-2 text-right">Crédito disponível</th></tr></thead>
                  <tbody>
                    {fCre.map(c => (
                      <tr key={c.id} className="border-t border-green-100"><td className="px-2 py-1.5 font-mono">{c.numero}</td><td className="px-2">{c.om}</td><td className="px-2 text-slate-500">{c.origem || '—'}</td><td className="px-2 text-right tabular-nums font-semibold text-green-700">{brl(c.valor)}</td></tr>
                    ))}
                    {!fCre.length && <tr><td colSpan={4} className="px-2 py-4 text-center text-slate-400">Nenhum crédito.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
            {detalhe.faturas && !detalhe.oms && detalhe.faturas.length > 0 && new Set(detalhe.faturas.map(f => f.om)).size === 1 && (
              <div className="text-right"><button type="button" className="text-primary-700 underline text-sm" onClick={() => { const nome = detalhe.faturas![0].om; setDetalhe(null); onVerFaturas(nome); }}>ver as faturas desta OM na lista →</button></div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
