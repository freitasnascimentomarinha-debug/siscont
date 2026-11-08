import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCheck, FileSpreadsheet, FileText, Network, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Client, Invoice, InvoiceStatus, ReceivedDocument } from '../../types';
import { Button } from '../ui/Button';
import { CreditoMapa, FaturaMapa, NoMapa, OMRef, OrdemMapa, idsDoMapa, linhasMapa, montarMapa } from '../../utils/mapaAnalitico';
import { dataBR, hojeISO } from '../../utils/datas';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const vazio = (n: number) => (n > 0.005 ? brl(n) : '—');

const Cartao: React.FC<{ rotulo: string; valor: string; dica: string; tom?: 'normal' | 'alerta' | 'ok' | 'destaque' }> = ({ rotulo, valor, dica, tom = 'normal' }) => (
  <div title={dica} className={`p-3 rounded-lg border bg-white ${tom === 'alerta' ? 'border-red-200' : tom === 'destaque' ? 'border-slate-800 ring-1 ring-slate-800' : 'border-slate-200'}`}>
    <div className="text-[11px] uppercase font-semibold text-slate-500">{rotulo}</div>
    <div className={`text-lg font-bold tabular-nums ${tom === 'alerta' ? 'text-red-700' : tom === 'ok' ? 'text-green-700' : 'text-slate-900'}`}>{valor}</div>
  </div>
);

/** Mapa Analítico de Contas: posição líquida por Setor › Comando › OM, com o crédito de cada OM abatendo só a dívida dela. */
export const MapaAnaliticoTab: React.FC<{ invoices: Invoice[]; docs: ReceivedDocument[]; clients: Client[]; onVerFaturas: (nome: string) => void }> = ({ invoices, docs, clients, onVerFaturas }) => {
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<OrdemMapa>('liquido');
  const [soComValor, setSoComValor] = useState(false);
  const [abertos, setAbertos] = useState<Set<string> | null>(null); // null = só os setores abertos (padrão)
  const hoje = hojeISO();

  const faturas = useMemo<FaturaMapa[]>(() => invoices
    .filter(i => !i.isCanceled && (i.status === InvoiceStatus.OPEN || i.status === InvoiceStatus.OVERDUE) && (i.saldoAPagar ?? 0) > 0.005)
    .map(i => ({ id: i.id, omId: i.omId ?? null, client: i.client, sector: i.sector, command: i.command, numero: i.invoiceNumber, tipo: i.type, vencimento: i.dueDate, saldo: i.saldoAPagar ?? 0, contestada: i.contestada })), [invoices]);
  const creditos = useMemo<CreditoMapa[]>(() => docs.filter(d => d.availableValue > 0.005)
    .map(d => ({ id: d.id, client: d.client, sector: d.sector, command: d.command, numero: d.documentNumber, valor: d.availableValue })), [docs]);
  const oms = useMemo<OMRef[]>(() => clients.filter(c => c.omId).map(c => ({ omId: c.omId!, nome: c.name, setor: c.sector, comando: c.command })), [clients]);
  const mapa = useMemo(() => montarMapa(faturas, creditos, oms, { hoje, ordem, busca, soComValor }), [faturas, creditos, oms, hoje, ordem, busca, soComValor]);

  const padrao = useMemo(() => new Set(idsDoMapa(mapa, 'setor')), [mapa]);
  const aberto = (id: string) => (abertos ?? padrao).has(id) || (!!busca.trim() && true);
  const alternar = (id: string) => setAbertos(prev => { const n = new Set(prev ?? padrao); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const t = mapa.total;
  const semCadastro = useMemo(() => mapa.setores.flatMap(s => s.filhos.flatMap(c => c.filhos)).filter(x => x.semCadastro).length, [mapa]);

  const exportarExcel = () => {
    const ws = XLSX.utils.aoa_to_sheet(linhasMapa(mapa));
    ws['!cols'] = [14, 44, 50, 9, 16, 16, 16, 18, 18, 18].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Mapa analítico');
    XLSX.writeFile(wb, `mapa_analitico_${hoje}.xlsx`);
  };
  const exportarPdf = () => {
    const doc = new jsPDF('l');
    doc.setFontSize(10); doc.text('MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE', 14, 12);
    doc.setFontSize(13); doc.text('Mapa Analítico de Contas — posição líquida por setor, comando e OM', 14, 19);
    doc.setFontSize(8); doc.text(`Posição em ${dataBR(hoje)} · crédito abate somente a dívida da própria OM`, 14, 24);
    const l = linhasMapa(mapa);
    autoTable(doc, { startY: 28, head: [l[0].map(String)], body: l.slice(1).map(r => r.map((v, i) => (i >= 4 && typeof v === 'number' ? brl(v) : String(v)))),
      styles: { fontSize: 7 }, headStyles: { fillColor: [30, 41, 59] }, columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } } });
    doc.save(`mapa_analitico_${hoje}.pdf`);
  };

  const Linha: React.FC<{ n: NoMapa }> = ({ n }) => {
    const abre = aberto(n.id);
    const filhos = n.nivel === 'cliente' ? (n.faturas?.length || n.creditos?.length) : n.filhos.length;
    const estilo = n.nivel === 'setor' ? 'bg-slate-100 font-bold text-slate-800' : n.nivel === 'comando' ? 'bg-slate-50 font-semibold text-slate-700' : 'bg-white text-slate-700';
    const recuo = n.nivel === 'setor' ? 'pl-3' : n.nivel === 'comando' ? 'pl-8' : 'pl-14';
    return (
      <>
        <tr className={`${estilo} hover:bg-blue-50/60`}>
          <td className={`py-2 pr-2 ${recuo}`}>
            <div className="flex items-start gap-1.5">
              <button type="button" onClick={() => alternar(n.id)} aria-expanded={abre} aria-label={`${abre ? 'Recolher' : 'Expandir'} ${n.nome}`} className="mt-0.5 text-slate-500 shrink-0" disabled={!filhos}>
                {abre ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
              <div className="min-w-0">
                <div className="leading-tight break-words">{n.nome}</div>
                {n.nivel === 'cliente' && <div className="flex flex-wrap gap-x-2 text-[11px] font-normal">
                  <button type="button" className="text-primary-700 underline" onClick={() => onVerFaturas(n.nome)}>ver faturas na lista</button>
                  {n.semCadastro && <span className="text-amber-700" title="O nome do cliente da ALTCRED não corresponde a nenhuma OM do cadastro">crédito sem OM no cadastro</span>}
                </div>}
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
        {abre && n.nivel !== 'cliente' && n.filhos.map(f => <Linha key={f.id} n={f} />)}
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
              <td className="py-1 pl-24 pr-2 font-medium"><FileCheck size={12} className="inline mr-1" />ALTCRED/GRU: {c.numero}</td>
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
        <p className="text-xs text-slate-500 mt-1">Por setor, comando e OM do cadastro. A dívida é o saldo a pagar de cada fatura; o crédito (ALTCRED/GRU com saldo) abate <b>somente a dívida da própria OM</b>. Cada nível é a soma do que está dentro dele.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Cartao rotulo="Dívida em aberto" valor={brl(t.divida)} dica={`${t.qtd} fatura(s) com saldo a pagar`} />
        <Cartao rotulo="Vencido" valor={brl(t.vencido)} tom={t.vencido > 0 ? 'alerta' : 'normal'} dica="Parte da dívida cujo vencimento já passou" />
        <Cartao rotulo="A vencer" valor={brl(t.aVencer)} dica="Parte da dívida ainda dentro do prazo" />
        <Cartao rotulo="Crédito usado" valor={brl(t.credito - t.sobra)} tom="ok" dica="Crédito das OM que abate a dívida delas" />
        <Cartao rotulo="Crédito que sobra" valor={brl(t.sobra)} tom="ok" dica="Crédito de OM que ultrapassa a própria dívida (não paga fatura de outra OM)" />
        <Cartao rotulo="A pagar (líquido)" valor={brl(t.liquido)} tom="destaque" dica="Soma do valor a pagar de cada OM depois de abater o crédito dela" />
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
        <div className="flex gap-3 pb-2 text-sm">
          <button type="button" className="text-primary-700 underline" onClick={() => setAbertos(new Set(idsDoMapa(mapa, 'cliente')))}>expandir tudo</button>
          <button type="button" className="text-primary-700 underline" onClick={() => setAbertos(new Set(idsDoMapa(mapa, 'comando')))}>até as OM</button>
          <button type="button" className="text-primary-700 underline" onClick={() => setAbertos(new Set())}>recolher tudo</button>
        </div>
        <div className="flex-1" />
        <div className="flex gap-2 pb-0.5"><Button variant="secondary" size="sm" onClick={exportarExcel}><FileSpreadsheet size={14} className="mr-1" />Excel</Button>
        <Button variant="secondary" size="sm" onClick={exportarPdf}><FileText size={14} className="mr-1" />PDF</Button></div>
      </div>
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
              {!mapa.setores.length && <tr><td colSpan={7} className="text-center py-8 text-slate-500">Nenhuma pendência encontrada.</td></tr>}
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
    </div>
  );
};
