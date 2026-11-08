import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { db } from '../services/db';
import { carregarCadastro, Cadastro } from '../services/recebimentosService';
import { Invoice, PaymentAllocation, ReceivedDocument } from '../types';
import { ehAdiantamento } from '../utils/baixas';
import { comSubtotais, DocExtrato, Extrato, montarExtrato } from '../utils/extrato';
import { criarResolvedor } from '../utils/documentosOM';
import { dataBR, hojeISO } from '../utils/datas';
import { notify } from '../utils/notify';
import { Button } from '../components/ui/Button';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '');
const r2 = (n: number) => Math.round(n * 100) / 100;
const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';

interface Escopo { tipo: 'COMANDO' | 'OM'; id: string; rotulo: string }

/** Os 4 quadros como colunas/linhas, usados na tela, no PDF e no Excel. */
function quadros(e: Extrato) {
  const sa = comSubtotais(e.saldoAltcred, 'cliente', 'valor', k => `${k} Total`);
  const somaSaldo = (cli: string) => r2(e.saldoAltcred.filter(x => x.cliente === cli).reduce((s, x) => s + x.saldo, 0));
  const ad = comSubtotais(e.adiantamentos, 'altcred', 'valor', k => `${k} Total`);
  const pg = comSubtotais(e.pagas, 'data', 'valor', k => `${br(k)} Total`);
  const ab = comSubtotais(e.abertas, 'cliente', 'saldo', k => `${k} Total`);
  return [
    {
      titulo: 'Saldo ALTCRED', colunas: ['Comando', 'Cliente', 'Nº ALTCRED', 'Valor ALTCRED', 'Saldo'],
      linhas: sa.map(x => x._subtotal
        ? { sub: true, c: ['', x.cliente, '', brl(x.valor), brl(somaSaldo(String(x.cliente).replace(/ Total$/, '')))] }
        : { c: [x.comando, x.cliente, x.numero, brl(x.valor), brl(x.saldo)] }),
      total: ['Total geral', '', '', brl(e.totais.valorAltcred), brl(e.totais.saldoAltcred)],
    },
    {
      titulo: 'Adiantamentos utilizados', colunas: ['Cliente', 'ALTCRED', 'Fatura', 'Valor'],
      linhas: ad.map(x => (x._subtotal ? { sub: true, c: ['', x.altcred, '', brl(x.valor)] } : { c: [x.cliente, x.altcred, x.fatura, brl(x.valor)] })),
      total: ['Total geral', '', '', brl(e.totais.adiantamentos)],
    },
    {
      titulo: 'Faturas pagas (por data de situação)', colunas: ['Data de situação', 'Cliente', 'Nº ALTCRED', 'Nº Fatura', 'Valor utilizado'],
      linhas: pg.map(x => (x._subtotal ? { sub: true, c: [x.data, '', '', '', brl(x.valor)] } : { c: [br(x.data), x.cliente, x.altcred, x.fatura, brl(x.valor)] })),
      total: ['Total geral', '', '', '', brl(e.totais.pagas)],
    },
    {
      titulo: 'Faturas em aberto', colunas: ['Setor', 'Cliente', 'Fatura', 'Saldo'],
      linhas: ab.map(x => (x._subtotal ? { sub: true, c: ['', x.cliente, '', brl(x.saldo)] } : { c: [x.setor, x.cliente, x.fatura, brl(x.saldo)] })),
      total: ['Total geral', '', '', brl(e.totais.abertas)],
    },
  ];
}

export const Conciliacao: React.FC = () => {
  const [cad, setCad] = useState<Cadastro>({ oms: [], comandos: [], setores: [] });
  const [docs, setDocs] = useState<ReceivedDocument[]>([]);
  const [faturas, setFaturas] = useState<Invoice[]>([]);
  const [baixas, setBaixas] = useState<PaymentAllocation[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [escopo, setEscopo] = useState<Escopo | null>(null);
  const [busca, setBusca] = useState('');
  const [exercicio, setExercicio] = useState<string>(String(new Date().getFullYear()));
  const [abertasDoExercicio, setAbertasDoExercicio] = useState(false);
  const resolv = useMemo(() => criarResolvedor(cad.oms, cad.comandos, cad.setores), [cad]);

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
  const filtradas = opcoes.filter(o => !busca || o.rotulo.toLowerCase().includes(busca.toLowerCase())).slice(0, 80);
  const anos = useMemo(() => [...new Set(docs.map(d => String(d.exercicio ?? d.date?.slice(0, 4))).filter(Boolean))].sort().reverse(), [docs]);

  const extrato = useMemo<Extrato | null>(() => {
    if (!escopo) return null;
    const omDe = new Map(cad.oms.map(o => [o.id, o]));
    let docOk: (d: ReceivedDocument) => boolean, fatOk: (f: Invoice) => boolean;
    // a OM de cada documento vem do cadastro (nome ou outros nomes; UG só quando é de uma OM só) — códigos como 41000
    // são usados por várias OM e não servem para dizer de quem é a ALTCRED
    const omDoc = new Map(docs.map(d => [d.id, resolv.omDoDocumento(d)]));
    if (escopo.tipo === 'COMANDO') {
      const c = cad.comandos.find(x => x.id === escopo.id)!;
      const cod = c.codigo || '#';
      docOk = d => { const o = omDoc.get(d.id); return o ? o.comandoId === c.id : d.comandoId === c.id || d.ug === cod || (d.ugCliente || '').startsWith(cod); };
      fatOk = f => (f.omId ? omDe.get(f.omId)?.comandoId === c.id : false) || (!f.omId && (f.ug === cod || (f.command || '').startsWith(cod)));
    } else {
      const o = omDe.get(escopo.id)!;
      const unico = resolv.codigoUnico(o.codigo);
      docOk = d => { const od = omDoc.get(d.id); return od ? od.id === o.id : unico && (d.ug === o.codigo || (d.ugCliente || '').startsWith(o.codigo)); };
      fatOk = f => f.omId === o.id || (!f.omId && unico && f.ug === o.codigo);
    }
    const doAno = (d: ReceivedDocument) => exercicio === 'todos' || String(d.exercicio ?? d.date?.slice(0, 4)) === exercicio;
    const fatDoAno = (f: Invoice) => !abertasDoExercicio || exercicio === 'todos' || String(f.yearCompetence) === exercicio;
    const paraExtrato = (d: ReceivedDocument): DocExtrato => ({ id: d.id, numero: d.documentNumber, comando: resolv.rotuloDoDocumento(d).comando, cliente: d.client, data: d.date, valor: d.totalValue, saldo: d.availableValue, sobraAdiantamento: d.sobraAdiantamento, operacao: d.operation });
    const docsEsc = docs.filter(d => docOk(d) && doAno(d));
    const docPorId = new Map(docs.map(d => [d.id, d]));
    const usado = new Map<string, number>();
    baixas.forEach(b => { if (docPorId.has(b.documentId)) usado.set(b.invoiceId, (usado.get(b.invoiceId) || 0) + b.amount); });
    const todas = new Map(faturas.map(f => [f.id, { numero: f.invoiceNumber }]));
    return montarExtrato(
      docsEsc.map(paraExtrato),
      faturas.filter(f => fatOk(f) && fatDoAno(f)).map(f => ({
        id: f.id, numero: f.invoiceNumber, setor: f.sector, cliente: f.client, cancelada: f.isCanceled,
        saldo: f.quitacaoExterna ? 0 : r2(f.value + (f.adjustmentAddition || 0) - (f.adjustmentDeduction || 0) - (usado.get(f.id) || 0)),
      })),
      baixas.map(b => ({ documentId: b.documentId, invoiceId: b.invoiceId, valor: b.amount, adiantamento: ehAdiantamento(b, docPorId.get(b.documentId)) })),
      todas,
      // pagamentos e adiantamentos pelas FATURAS do escopo, de qualquer pagador (ex.: RT DGMM pagando o Arsenal), no exercício escolhido
      { porFaturasDoEscopo: true, todosDocs: docs.filter(doAno).map(paraExtrato) },
    );
  }, [escopo, exercicio, abertasDoExercicio, cad, docs, faturas, baixas, resolv]);

  const qs = extrato ? quadros(extrato) : [];
  const titulo = escopo ? `Extrato de conciliação — ${escopo.rotulo}` : '';
  const subtitulo = `Exercício ${exercicio === 'todos' ? 'todos' : exercicio} · faturas em aberto ${abertasDoExercicio && exercicio !== 'todos' ? `só de ${exercicio}` : 'de qualquer exercício'} · pagamentos de qualquer pagador · gerado em ${dataBR(hojeISO())}`;
  const nomeArq = escopo ? `extrato_${escopo.rotulo.split(' - ')[0]}_${exercicio}` : 'extrato';

  const exportarPdf = () => {
    const doc = new jsPDF();
    doc.setFontSize(9);
    doc.text('MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE', 14, 12);
    doc.setFontSize(12); doc.text(titulo, 14, 19, { maxWidth: 180 });
    doc.setFontSize(8); doc.text(subtitulo, 14, 25);
    let y = 30;
    qs.forEach(q => {
      doc.setFontSize(10); doc.text(q.titulo.toUpperCase(), 14, y + 4);
      autoTable(doc, {
        startY: y + 6, head: [q.colunas], body: [...q.linhas.map(l => l.c), q.total], theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1.2 }, headStyles: { fillColor: [30, 41, 59] },
        didParseCell: d => {
          const linha = q.linhas[d.row.index];
          if (d.section === 'body' && (d.row.index === q.linhas.length || linha?.sub)) d.cell.styles.fontStyle = 'bold';
          if (d.section === 'body' && d.column.index === q.colunas.length - 1) d.cell.styles.halign = 'right';
        },
      });
      y = (doc as any).lastAutoTable.finalY + 6;
      if (y > 260) { doc.addPage(); y = 14; }
    });
    doc.save(`${nomeArq}.pdf`);
  };

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    qs.forEach(q => {
      const ws = XLSX.utils.aoa_to_sheet([[titulo], [subtitulo], [], q.colunas, ...q.linhas.map(l => l.c), q.total]);
      XLSX.utils.book_append_sheet(wb, ws, q.titulo.slice(0, 31).replace(/[()]/g, ''));
    });
    XLSX.writeFile(wb, `${nomeArq}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Extrato de Conciliação</h2>
          <p className="text-slate-500 text-sm max-w-3xl">Por comando ou OM: saldo das ALTCRED, adiantamentos utilizados, faturas pagas (por data de situação) e faturas em aberto — os quatro quadros enviados às OM para conciliação.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
      </div>

      <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-wrap gap-3 items-end">
        <label className="flex-1 min-w-[260px] text-xs text-slate-600">Comando ou OM
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Digite o código ou o nome (ex.: 40030, DIM)..." className={`${sel} w-full mt-1`} />
          {busca && !escopo?.rotulo.toLowerCase().includes(busca.toLowerCase()) && (
            <div className="mt-1 max-h-56 overflow-y-auto border border-slate-200 rounded-md bg-white shadow-sm">
              {filtradas.map(o => (
                <button key={o.tipo + o.id} className="block w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50" onClick={() => { setEscopo(o); setBusca(o.rotulo); }}>
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

      {!escopo && <p className="text-sm text-slate-500">Escolha um comando (inclui as OM subordinadas) ou uma OM para montar o extrato.</p>}

      {extrato && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['Saldo das ALTCRED', extrato.totais.saldoAltcred], ['Adiantamentos utilizados', extrato.totais.adiantamentos], ['Faturas pagas', extrato.totais.pagas], ['Faturas em aberto', extrato.totais.abertas]].map(([r, v]) => (
              <div key={r as string} className="p-3 rounded-lg border border-slate-200 bg-white">
                <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{r}</div>
                <div className="text-xl font-bold text-slate-900 tabular-nums">{brl(v as number)}</div>
              </div>
            ))}
          </div>
          {qs.map(q => (
            <section key={q.titulo} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <h3 className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold">{q.titulo}</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{q.colunas.map((c, i) => <th key={c} className={`px-3 py-2 ${i === q.colunas.length - 1 ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {q.linhas.map((l, i) => (
                      <tr key={i} className={l.sub ? 'bg-slate-50 font-semibold' : ''}>
                        {l.c.map((v, k) => <td key={k} className={`px-3 py-1.5 ${k === l.c.length - 1 ? 'text-right tabular-nums' : ''} ${/altcred|fatura/i.test(q.colunas[k]) && !/valor/i.test(q.colunas[k]) ? 'font-mono text-xs' : ''}`}>{v}</td>)}
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
