import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, FileText, RefreshCw, X, AlertTriangle } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { db } from '../services/db';
import { carregarCadastro, Cadastro } from '../services/recebimentosService';
import { Invoice, PaymentAllocation, ReceivedDocument } from '../types';
import { ehAdiantamento } from '../utils/baixas';
import { comSubtotais, DocExtrato, Extrato, InfoFatura, montarExtrato } from '../utils/extrato';
import { criarResolvedor } from '../utils/documentosOM';
import { dataBR, hojeISO } from '../utils/datas';
import { notify } from '../utils/notify';
import { Button } from '../components/ui/Button';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';

interface Escopo { tipo: 'COMANDO' | 'OM'; id: string; rotulo: string }
interface Quadro { titulo: string; colunas: string[]; linhas: { sub?: boolean; c: string[]; nota?: string }[]; total: string[] }

/** Resumo da conciliação (vai na tela, no PDF e no Excel). */
function linhasResumo(e: Extrato): [string, string][] {
  const r = e.resumo;
  return [
    ['Valor recebido nas ALTCRED/GRU', brl(r.recebido)],
    ['(−) Usado em faturas da própria OM/comando', brl(r.usadoProprias)],
    ['(−) Usado em faturas de outras OM', brl(r.usadoOutras)],
    ['(=) Saldo das ALTCRED pela conta', brl(r.saldoCalculado)],
    ['Saldo das ALTCRED no sistema', brl(r.saldoInformado)],
    ['Diferença', Math.abs(r.diferenca) < 0.01 ? 'fecha (R$ 0,00)' : brl(r.diferenca)],
    ['Faturas da OM pagas por outros pagadores', brl(r.pagoPorOutros)],
    ['Faturas em aberto (vencido / a vencer)', `${brl(e.totais.abertas)} (${brl(e.totais.vencido)} / ${brl(e.totais.aVencer)})`],
  ];
}

/** Os quadros como colunas/linhas, usados na tela, no PDF e no Excel. */
function quadros(e: Extrato): Quadro[] {
  const sa = comSubtotais(e.saldoAltcred, 'cliente', 'valor', k => `${k} Total`);
  const somaSaldo = (cli: string) => r2(e.saldoAltcred.filter(x => x.cliente === cli).reduce((s, x) => s + x.saldo, 0));
  const ad = comSubtotais(e.adiantamentos, 'altcred', 'valor', k => `${k} Total`);
  const pg = comSubtotais(e.pagas, 'data', 'valor', k => `${dataBR(k)} Total`);
  const ab = comSubtotais(e.abertas, 'cliente', 'saldo', k => `${k} Total`);
  const nota = (x: { outraOM: boolean; outroPagador: boolean }) => (x.outraOM ? 'fatura de outra OM' : x.outroPagador ? 'pago por outro pagador' : undefined);
  return [
    {
      titulo: 'Saldo ALTCRED', colunas: ['Comando', 'Cliente', 'Nº ALTCRED', 'Valor ALTCRED', 'Saldo'],
      linhas: sa.map(x => x._subtotal
        ? { sub: true, c: ['', x.cliente, '', brl(x.valor), brl(somaSaldo(String(x.cliente).replace(/ Total$/, '')))] }
        : { c: [x.comando, x.cliente, x.numero, brl(x.valor), brl(x.saldo)] }),
      total: ['Total geral', '', '', brl(e.totais.valorAltcred), brl(e.totais.saldoAltcred)],
    },
    {
      titulo: 'Adiantamentos utilizados', colunas: ['Pagador', 'ALTCRED', 'Fatura', 'Cliente da fatura', 'Valor'],
      linhas: ad.map(x => (x._subtotal ? { sub: true, c: ['', x.altcred, '', '', brl(x.valor)] } : { c: [x.cliente, x.altcred, x.fatura, x.clienteFatura, brl(x.valor)], nota: nota(x) })),
      total: ['Total geral', '', '', '', brl(e.totais.adiantamentos)],
    },
    {
      titulo: 'Faturas pagas (por data de situação)', colunas: ['Data de situação', 'Pagador', 'Nº ALTCRED', 'Nº Fatura', 'Cliente da fatura', 'Valor utilizado'],
      linhas: pg.map(x => (x._subtotal ? { sub: true, c: [x.data, '', '', '', '', brl(x.valor)] } : { c: [dataBR(x.data), x.cliente, x.altcred, x.fatura, x.clienteFatura, brl(x.valor)], nota: nota(x) })),
      total: ['Total geral', '', '', '', '', brl(e.totais.pagas)],
    },
    {
      titulo: 'Faturas em aberto', colunas: ['Setor', 'Cliente', 'Fatura', 'Vencimento', 'Atraso', 'Saldo'],
      linhas: ab.map(x => (x._subtotal ? { sub: true, c: ['', x.cliente, '', '', '', brl(x.saldo)] }
        : { c: [x.setor, x.cliente, `${x.fatura}${x.contestada ? ' (contestada)' : ''}`, dataBR(x.vencimento), x.atraso ? `${x.atraso} dias` : 'no prazo', brl(x.saldo)] })),
      total: ['Total geral', '', '', '', '', brl(e.totais.abertas)],
    },
  ];
}

export const Conciliacao: React.FC = () => {
  const [cad, setCad] = useState<Cadastro>({ oms: [], comandos: [], setores: [] });
  const [docs, setDocs] = useState<ReceivedDocument[]>([]);
  const [faturas, setFaturas] = useState<Invoice[]>([]);
  const [baixas, setBaixas] = useState<PaymentAllocation[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [escopos, setEscopos] = useState<Escopo[]>([]);
  const [busca, setBusca] = useState('');
  const [exercicio, setExercicio] = useState<string>(String(new Date().getFullYear()));
  const [abertasDoExercicio, setAbertasDoExercicio] = useState(false);
  const resolv = useMemo(() => criarResolvedor(cad.oms, cad.comandos, cad.setores), [cad]);
  const hoje = hojeISO();

  const carregar = async () => {
    setCarregando(true);
    try {
      const [c, d, f, b] = await Promise.all([carregarCadastro(), db.getDocuments(), db.getInvoices(), db.getAllocations()]);
      setCad(c); setDocs(d); setFaturas(f); setBaixas(b);
    } catch (e) { notify.fail('Erro ao carregar dados', e); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  const opcoes = useMemo(() => {
    const cmds = cad.comandos.filter(c => c.codigo).map(c => ({ tipo: 'COMANDO' as const, id: c.id, rotulo: `${c.codigo} - ${c.nome}${c.sigla ? ` (${c.sigla})` : ''}` }));
    const oms = cad.oms.map(o => ({ tipo: 'OM' as const, id: o.id, rotulo: `${o.codigo} - ${o.nome}${o.ativo ? '' : ' (desativada)'}` }));
    return [...cmds.sort((a, b) => a.rotulo.localeCompare(b.rotulo)), ...oms.sort((a, b) => a.rotulo.localeCompare(b.rotulo))];
  }, [cad]);
  const q = busca.trim().toLowerCase();
  const filtradas = q ? opcoes.filter(o => o.rotulo.toLowerCase().includes(q) && !escopos.some(e => e.tipo === o.tipo && e.id === o.id)).slice(0, 200) : [];
  const anos = useMemo(() => [...new Set(docs.map(d => String(d.exercicio ?? d.date?.slice(0, 4))).filter(Boolean))].sort().reverse(), [docs]);
  const adicionar = (o: Escopo) => { setEscopos(l => (l.some(e => e.tipo === o.tipo && e.id === o.id) ? l : [...l, o])); setBusca(''); };

  // sugestões: as OM com mais valor em aberto (atalho para não precisar digitar)
  const sugestoes = useMemo(() => {
    const m = new Map<string, number>();
    faturas.forEach(f => { if (f.omId && !f.isCanceled && (f.saldoAPagar ?? 0) > 0.005) m.set(f.omId, (m.get(f.omId) || 0) + (f.saldoAPagar ?? 0)); });
    const omDe = new Map(cad.oms.map(o => [o.id, o]));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => { const o = omDe.get(id); return o ? { escopo: { tipo: 'OM' as const, id, rotulo: `${o.codigo} - ${o.nome}` }, valor: v } : null; }).filter(Boolean) as { escopo: Escopo; valor: number }[];
  }, [faturas, cad]);

  const extrato = useMemo<Extrato | null>(() => {
    if (!escopos.length) return null;
    const omDe = new Map(cad.oms.map(o => [o.id, o]));
    // a OM de cada documento vem do cadastro (nome ou outros nomes; UG só quando é de uma OM só) — códigos como 41000
    // são usados por várias OM e não servem para dizer de quem é a ALTCRED
    const omDoc = new Map(docs.map(d => [d.id, resolv.omDoDocumento(d)]));
    const testes = escopos.map(escopo => {
      if (escopo.tipo === 'COMANDO') {
        const c = cad.comandos.find(x => x.id === escopo.id);
        const cod = c?.codigo || '#';
        return {
          doc: (d: ReceivedDocument) => { const o = omDoc.get(d.id); return o ? o.comandoId === c?.id : d.comandoId === c?.id || d.ug === cod || (d.ugCliente || '').startsWith(cod); },
          fat: (f: Invoice) => (f.omId ? omDe.get(f.omId)?.comandoId === c?.id : false) || (!f.omId && (f.ug === cod || (f.command || '').startsWith(cod))),
        };
      }
      const o = omDe.get(escopo.id);
      const unico = o ? resolv.codigoUnico(o.codigo) : false;
      return {
        doc: (d: ReceivedDocument) => { const od = omDoc.get(d.id); return od ? od.id === o?.id : unico && (d.ug === o?.codigo || (d.ugCliente || '').startsWith(o?.codigo || '#')); },
        fat: (f: Invoice) => f.omId === o?.id || (!f.omId && unico && f.ug === o?.codigo),
      };
    });
    const docOk = (d: ReceivedDocument) => testes.some(t => t.doc(d));
    const fatOk = (f: Invoice) => testes.some(t => t.fat(f));
    const doAno = (d: ReceivedDocument) => exercicio === 'todos' || String(d.exercicio ?? d.date?.slice(0, 4)) === exercicio;
    const fatDoAno = (f: Invoice) => !abertasDoExercicio || exercicio === 'todos' || String(f.yearCompetence) === exercicio;
    // cliente e comando pelo cadastro (uma OM = um subtotal, mesmo que o documento tenha outra grafia)
    const paraExtrato = (d: ReceivedDocument): DocExtrato => { const r = resolv.rotuloDoDocumento(d); return { id: d.id, numero: d.documentNumber, comando: r.comando, cliente: r.cliente, data: d.date, valor: d.totalValue, saldo: d.availableValue, sobraAdiantamento: d.sobraAdiantamento, operacao: d.operation }; };
    const clienteFatura = (f: Invoice) => (f.omId && omDe.get(f.omId)?.nome) || f.client;
    const setorFatura = (f: Invoice) => { const o = f.omId ? omDe.get(f.omId) : undefined; return o ? resolv.rotuloDaOM(o).setor : f.sector; };
    const docPorId = new Map(docs.map(d => [d.id, d]));
    const todas = new Map<string, InfoFatura>(faturas.map(f => [f.id, { numero: f.invoiceNumber, cliente: clienteFatura(f), cancelada: f.isCanceled }]));
    return montarExtrato(
      docs.filter(d => docOk(d) && doAno(d)).map(paraExtrato),
      faturas.filter(f => fatOk(f) && fatDoAno(f)).map(f => ({
        id: f.id, numero: f.invoiceNumber, setor: setorFatura(f), cliente: clienteFatura(f), cancelada: f.isCanceled, vencimento: f.dueDate, contestada: f.contestada,
        saldo: f.isCanceled || f.quitacaoExterna ? 0 : r2(f.saldoAPagar ?? 0),
      })),
      baixas.map(b => ({ documentId: b.documentId, invoiceId: b.invoiceId, valor: b.amount, adiantamento: ehAdiantamento(b, docPorId.get(b.documentId)) })),
      todas,
      // pagamentos das faturas do escopo (de qualquer pagador) e usos das ALTCRED do escopo (em qualquer fatura), no exercício
      { porFaturasDoEscopo: true, todosDocs: docs.filter(doAno).map(paraExtrato), hoje },
    );
  }, [escopos, exercicio, abertasDoExercicio, cad, docs, faturas, baixas, resolv, hoje]);

  const qs = extrato ? quadros(extrato) : [];
  const nomeEscopo = escopos.length <= 2 ? escopos.map(e => e.rotulo).join(' + ') : `${escopos.length} comandos/OM (${escopos.map(e => e.rotulo.split(' - ')[0]).join(', ')})`;
  const titulo = escopos.length ? `Extrato de conciliação — ${nomeEscopo}` : '';
  const subtitulo = `Exercício ${exercicio === 'todos' ? 'todos' : exercicio} · faturas em aberto ${abertasDoExercicio && exercicio !== 'todos' ? `só de ${exercicio}` : 'de qualquer exercício'} · pagamentos de qualquer pagador · gerado em ${dataBR(hoje)}`;
  const nomeArq = escopos.length ? `extrato_${escopos.map(e => e.rotulo.split(' - ')[0]).join('_').slice(0, 60)}_${exercicio}` : 'extrato';
  const fecha = extrato ? Math.abs(extrato.resumo.diferenca) < 0.01 : true;

  const exportarPdf = () => {
    if (!extrato) return;
    const doc = new jsPDF();
    doc.setFontSize(9);
    doc.text('MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE', 14, 12);
    doc.setFontSize(12); doc.text(doc.splitTextToSize(titulo, 182), 14, 19);
    doc.setFontSize(8); doc.text(subtitulo, 14, 27);
    doc.setFontSize(10); doc.text('RESUMO DA CONCILIAÇÃO', 14, 34);
    autoTable(doc, { startY: 36, body: linhasResumo(extrato), theme: 'grid', styles: { fontSize: 8, cellPadding: 1.2 }, columnStyles: { 1: { halign: 'right', cellWidth: 70 } },
      didParseCell: d => { if ([3, 5].includes(d.row.index)) d.cell.styles.fontStyle = 'bold'; } });
    let y = (doc as any).lastAutoTable.finalY + 6;
    qs.forEach(q => {
      if (y > 255) { doc.addPage(); y = 14; }
      doc.setFontSize(10); doc.text(q.titulo.toUpperCase(), 14, y + 4);
      autoTable(doc, {
        startY: y + 6, head: [q.colunas], body: [...q.linhas.map(l => l.c), q.total], theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.2 }, headStyles: { fillColor: [30, 41, 59] },
        didParseCell: d => {
          const linha = q.linhas[d.row.index];
          if (d.section === 'body' && (d.row.index === q.linhas.length || linha?.sub)) d.cell.styles.fontStyle = 'bold';
          if (d.section === 'body' && linha?.nota) d.cell.styles.textColor = [120, 53, 15];
          if (d.column.index === q.colunas.length - 1) d.cell.styles.halign = 'right';
        },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
    });
    doc.save(`${nomeArq}.pdf`);
  };
  const exportarExcel = () => {
    if (!extrato) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[titulo], [subtitulo], [], ['Resumo da conciliação', 'Valor'], ...linhasResumo(extrato)]), 'Resumo');
    qs.forEach(q => {
      const ws = XLSX.utils.aoa_to_sheet([[titulo], [subtitulo], [], [...q.colunas, 'Observação'], ...q.linhas.map(l => [...l.c, l.nota || '']), q.total]);
      XLSX.utils.book_append_sheet(wb, ws, q.titulo.slice(0, 31).replace(/[()]/g, ''));
    });
    XLSX.writeFile(wb, `${nomeArq}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Extrato de Conciliação</h2>
          <p className="text-slate-500 text-sm max-w-3xl">Por comando ou OM (um ou vários): resumo da conciliação, saldo das ALTCRED, adiantamentos utilizados, faturas pagas e faturas em aberto — os quadros enviados às OM. Os pagamentos aparecem de qualquer pagador, e os usos das ALTCRED da OM em faturas de outras OM também.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
      </div>

      <div className="bg-white p-4 rounded-lg border border-slate-200 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="flex-1 min-w-[260px] text-xs text-slate-600">Adicionar comando ou OM
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Digite o código ou o nome (ex.: 40030, DIM)..." className={`${sel} w-full mt-1`} aria-label="Buscar comando ou OM" />
            {q && (
              <div className="mt-1 max-h-56 overflow-y-auto border border-slate-200 rounded-md bg-white shadow-sm">
                {filtradas.map(o => (
                  <button key={o.tipo + o.id} type="button" className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => adicionar(o)}>
                    <span className="text-[10px] font-bold uppercase text-slate-400 mr-2">{o.tipo === 'COMANDO' ? 'Comando' : 'OM'}</span>{o.rotulo}
                  </button>
                ))}
                {!filtradas.length && <div className="px-3 py-2 text-sm text-slate-400">Nada encontrado.</div>}
              </div>
            )}
          </label>
          <label className="text-xs text-slate-600">Exercício (ALTCRED e pagamentos)
            <select value={exercicio} onChange={e => setExercicio(e.target.value)} className={`${sel} block mt-1`} aria-label="Exercício do extrato">
              {[...new Set([String(new Date().getFullYear()), ...anos])].map(a => <option key={a} value={a}>{a}</option>)}
              <option value="todos">Todos</option>
            </select>
          </label>
          <label className="text-sm flex items-center gap-1.5 pb-2" title="Sem marcar, as faturas em aberto entram de qualquer exercício (dívida antiga continua aparecendo)">
            <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={abertasDoExercicio} disabled={exercicio === 'todos'} onChange={e => setAbertasDoExercicio(e.target.checked)} /> Faturas em aberto só deste exercício
          </label>
          <Button variant="secondary" onClick={exportarPdf} disabled={!extrato}><FileText size={16} className="mr-1" /> PDF</Button>
          <Button variant="secondary" onClick={exportarExcel} disabled={!extrato}><FileSpreadsheet size={16} className="mr-1" /> Excel</Button>
        </div>
        {escopos.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Comandos e OM do extrato">
            <span className="text-slate-500">No extrato:</span>
            {escopos.map(e => (
              <button key={e.tipo + e.id} type="button" onClick={() => setEscopos(l => l.filter(x => !(x.tipo === e.tipo && x.id === e.id)))} title="Tirar do extrato"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary-50 text-primary-800 border border-primary-200 text-xs">
                <span className="text-[10px] font-bold uppercase text-primary-600">{e.tipo === 'COMANDO' ? 'Comando' : 'OM'}</span> {e.rotulo} <X size={12} />
              </button>
            ))}
            <button type="button" className="text-primary-700 underline text-xs" onClick={() => setEscopos([])}>limpar</button>
          </div>
        )}
        {!escopos.length && sugestoes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Sugestões de OM">
            <span className="text-slate-500">OM com mais valor em aberto:</span>
            {sugestoes.map(s => (
              <button key={s.escopo.id} type="button" onClick={() => adicionar(s.escopo)} className="px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50">
                {s.escopo.rotulo} <span className="text-slate-500">· {brl(s.valor)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!escopos.length && <p className="text-sm text-slate-500">Escolha um ou mais comandos (incluem as OM subordinadas) ou OM para montar o extrato.</p>}

      {extrato && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {([['Saldo das ALTCRED', extrato.totais.saldoAltcred, ''], ['Adiantamentos utilizados', extrato.totais.adiantamentos, ''], ['Faturas pagas', extrato.totais.pagas, ''],
              ['Em aberto — vencido', extrato.totais.vencido, 'text-red-700'], ['Em aberto — a vencer', extrato.totais.aVencer, ''], ['Em aberto contestado', extrato.totais.contestado, 'text-amber-700']] as const).map(([r, v, cor]) => (
              <div key={r} className="p-3 rounded-lg border border-slate-200 bg-white">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{r}</div>
                <div className={`text-xl font-bold tabular-nums ${cor || 'text-slate-900'}`}>{brl(v)}</div>
              </div>
            ))}
          </div>

          <section className={`rounded-lg border overflow-hidden ${fecha ? 'border-emerald-200' : 'border-red-300'}`} aria-label="Resumo da conciliação">
            <h3 className={`px-4 py-2 text-sm font-semibold flex items-center gap-2 ${fecha ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900'}`}>
              {fecha ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} Resumo da conciliação {fecha ? '— fecha' : '— não fecha: confira as baixas das ALTCRED'}
            </h3>
            <table className="min-w-full text-sm bg-white"><tbody className="divide-y divide-slate-100">
              {linhasResumo(extrato).map(([r, v], i) => (
                <tr key={r} className={[3, 5].includes(i) ? 'font-semibold' : ''}><td className="px-4 py-1.5">{r}</td><td className="px-4 py-1.5 text-right tabular-nums">{v}</td></tr>
              ))}
            </tbody></table>
          </section>

          {qs.map(q => (
            <section key={q.titulo} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <h3 className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold">{q.titulo}</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{q.colunas.map((c, i) => <th key={c} className={`px-3 py-2 ${i === q.colunas.length - 1 ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {q.linhas.map((l, i) => (
                      <tr key={i} className={l.sub ? 'bg-slate-50 font-semibold' : l.nota ? 'bg-amber-50/40' : ''} title={l.nota}>
                        {l.c.map((v, k) => <td key={k} className={`px-3 py-1.5 ${k === l.c.length - 1 ? 'text-right tabular-nums' : ''} ${/altcred|fatura/i.test(q.colunas[k]) && !/valor|cliente/i.test(q.colunas[k]) ? 'font-mono text-xs' : ''}`}>
                          {v}{k === 0 && l.nota && <span className="ml-1 text-[10px] font-sans bg-amber-100 text-amber-800 rounded px-1">{l.nota}</span>}
                        </td>)}
                      </tr>
                    ))}
                    {!q.linhas.length && <tr><td colSpan={q.colunas.length} className="px-3 py-3 text-center text-slate-400">Nada neste quadro.</td></tr>}
                    <tr className="bg-slate-100 font-bold">{q.total.map((v, k) => <td key={k} className={`px-3 py-1.5 ${k === q.total.length - 1 ? 'text-right tabular-nums' : ''}`}>{v}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
};
