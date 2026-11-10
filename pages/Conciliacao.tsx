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
import { SeletorPublico, usePublico } from '../components/ui/SeletorPublico';
import { passaPublico } from '../utils/publico';
import { Escopo, OpcaoEscopo, SeletorEscopo } from '../components/conciliacao/SeletorEscopo';
import { TEMA, cabecalhoCompacto, fimDaTabela, salvarPdf, tabelaPdf, tituloRelatorio } from '../utils/pdfCabecalho';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';

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

  const [publico, setPublico] = usePublico('extrato');
  // comando é Extra-MB quando todas as OM dele são Extra-MB (ou o setor é o EXTRA-MB)
  const extraDe = useMemo(() => {
    const porCmd = new Map<string, boolean[]>();
    cad.oms.forEach(o => { if (o.comandoId) porCmd.set(o.comandoId, [...(porCmd.get(o.comandoId) || []), o.tipo === 'EXTRA_MB']); });
    return (op: OpcaoEscopo) => op.tipo === 'OM' ? cad.oms.find(o => o.id === op.id)?.tipo === 'EXTRA_MB'
      : /extra/i.test(op.setor) || ((porCmd.get(op.id) || []).length > 0 && (porCmd.get(op.id) || []).every(Boolean));
  }, [cad]);
  const opcoesTodas = useMemo<OpcaoEscopo[]>(() => {
    const setorDe = (id?: string | null) => (id && cad.setores.find(x => x.id === id)?.sigla) || '';
    const cmdDe = new Map(cad.comandos.map(c => [c.id, c]));
    const cmds = cad.comandos.filter(c => c.codigo).map(c => ({ tipo: 'COMANDO' as const, id: c.id, rotulo: `${c.codigo} - ${c.nome}${c.sigla ? ` (${c.sigla})` : ''}`, codigo: c.codigo || '', nome: c.nome, sigla: c.sigla, setor: setorDe(c.setorId), ativo: c.ativo !== false }));
    const oms = cad.oms.map(o => ({ tipo: 'OM' as const, id: o.id, rotulo: `${o.codigo} - ${o.nome}`, codigo: o.codigo, nome: o.nome, sigla: o.sigla, setor: setorDe(o.setorId) || setorDe(o.comandoId ? cmdDe.get(o.comandoId)?.setorId : null) || (o.tipo === 'EXTRA_MB' ? 'EXTRA-MB' : ''), ativo: o.ativo }));
    return [...cmds.sort((a, b) => a.codigo.localeCompare(b.codigo) || a.nome.localeCompare(b.nome)), ...oms.sort((a, b) => a.codigo.localeCompare(b.codigo) || a.nome.localeCompare(b.nome))];
  }, [cad]);
  const opcoes = useMemo(() => opcoesTodas.filter(op => passaPublico(publico, extraDe(op))), [opcoesTodas, publico, extraDe]);
  const todosExtra = () => setEscopos(opcoesTodas.filter(op => op.tipo === 'OM' && op.ativo && extraDe(op)).map(({ tipo, id, rotulo }) => ({ tipo, id, rotulo })));
  const soExtra = escopos.length > 0 && escopos.every(e => extraDe(opcoesTodas.find(o => o.tipo === e.tipo && o.id === e.id) || ({ tipo: e.tipo, id: e.id, setor: '' } as OpcaoEscopo)));
  const anos = useMemo(() => [...new Set(docs.map(d => String(d.exercicio ?? d.date?.slice(0, 4))).filter(Boolean))].sort().reverse(), [docs]);

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
  const nomeEscopo = soExtra && escopos.length > 2 ? `Extra-Marinha (${escopos.length} clientes)` : escopos.length <= 2 ? escopos.map(e => e.rotulo).join(' + ') : `${escopos.length} comandos/OM (${escopos.map(e => e.rotulo.split(' - ')[0]).join(', ')})`;
  const titulo = escopos.length ? `Extrato de conciliação — ${nomeEscopo}` : '';
  const subtitulo = `Exercício ${exercicio === 'todos' ? 'todos' : exercicio} · faturas em aberto ${abertasDoExercicio && exercicio !== 'todos' ? `só de ${exercicio}` : 'de qualquer exercício'} · pagamentos de qualquer pagador · gerado em ${dataBR(hoje)}`;
  const nomeArq = escopos.length ? `extrato_${soExtra && escopos.length > 2 ? 'extra_mb' : ''}${escopos.map(e => e.rotulo.split(' - ')[0]).join('_').slice(0, 60)}_${exercicio}` : 'extrato';
  const fecha = extrato ? Math.abs(extrato.resumo.diferenca) < 0.01 : true;

  const exportarPdf = () => {
    if (!extrato) return;
    const doc = new jsPDF();
    cabecalhoCompacto(doc);
    const y0 = tituloRelatorio(doc, titulo, subtitulo, 26);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...TEMA.faixa); doc.text('RESUMO DA CONCILIAÇÃO', 14, y0 + 2); doc.setTextColor(0);
    tabelaPdf(doc, { startY: y0 + 4, body: linhasResumo(extrato), styles: { fontSize: 8.5, cellPadding: 1.5 }, columnStyles: { 1: { halign: 'right', cellWidth: 70 } },
      didParseCell: d => { if ([3, 5].includes(d.row.index)) d.cell.styles.fontStyle = 'bold'; } });
    let y = fimDaTabela(doc) + 6;
    qs.forEach(q => {
      if (y > 250) { doc.addPage(); y = 16; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...TEMA.faixa); doc.text(q.titulo.toUpperCase(), 14, y + 4); doc.setTextColor(0);
      tabelaPdf(doc, {
        startY: y + 6, head: [q.colunas], body: [...q.linhas.map(l => l.c), q.total],
        styles: { fontSize: 8, cellPadding: 1.3 }, headStyles: { fillColor: TEMA.cab },
        didParseCell: d => {
          const linha = q.linhas[d.row.index];
          if (d.section === 'body' && (d.row.index === q.linhas.length || linha?.sub)) d.cell.styles.fontStyle = 'bold';
          if (d.section === 'body' && linha?.nota) d.cell.styles.textColor = TEMA.nota;
          if (d.column.index === q.colunas.length - 1) d.cell.styles.halign = 'right';
        },
      });
      y = fimDaTabela(doc) + 6;
    });
    salvarPdf(doc, `${nomeArq}.pdf`);
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
          <SeletorPublico valor={publico} onChange={setPublico} />
          <SeletorEscopo opcoes={opcoes} selecionados={escopos} onChange={setEscopos} />
          {publico === 'EXTRA' && <button type="button" className="text-sm text-amber-800 underline pb-2" onClick={todosExtra} title="Põe no extrato todos os clientes Extra-MB ativos">todos os clientes Extra-MB</button>}
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
