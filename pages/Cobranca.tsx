import React, { useEffect, useMemo, useState } from 'react';
import { MultiFiltro, useExcluidosLembrados } from '../components/ui/MultiFiltro';
import { cadastroService } from '../services/cadastroService';
import { Copy, FileSpreadsheet, FileText, Mail, RefreshCw } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import {
  adiantamentosComSaldo, carregarBase, comandoDoTexto, faturasAbertas, listarCobrancas, registrarCobranca, saldosParados,
} from '../services/relatoriosService';
import { listarContestacoes } from '../services/fase4Service';
import { FaturaAberta, Pivo, mensagemCobranca, pivo, quadroAberto } from '../utils/relatorios';
import { notify } from '../utils/notify';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { PainelEncarregado } from '../components/cobranca/PainelEncarregado';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const hoje = () => new Date().toISOString().slice(0, 10);
const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white';
type Base = Awaited<ReturnType<typeof carregarBase>>;
type Aba = 'quadro' | 'mensagens' | 'painel';

const TabelaPivo: React.FC<{ titulo: string; p: Pivo; rotuloLinha: string }> = ({ titulo, p, rotuloLinha }) => (
  <section className="bg-white rounded-lg border border-slate-200 overflow-hidden">
    <h3 className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold flex justify-between"><span>{titulo}</span><span className="tabular-nums">{brl(p.total)}</span></h3>
    {p.total === 0 ? <p className="px-4 py-3 text-sm text-slate-400">Nenhuma fatura.</p> : (
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-3 py-2 text-left">{rotuloLinha}</th>{p.colunas.map(c => <th key={c} className="px-3 py-2 text-right">{c}</th>)}<th className="px-3 py-2 text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {p.linhas.map(l => (
              <tr key={l}><td className="px-3 py-1.5 font-medium">{l}</td>{p.colunas.map(c => <td key={c} className="px-3 py-1.5 text-right tabular-nums">{p.valores[l][c] ? brl(p.valores[l][c]) : ''}</td>)}<td className="px-3 py-1.5 text-right tabular-nums font-semibold">{brl(p.totLinha[l])}</td></tr>
            ))}
            <tr className="bg-slate-100 font-bold"><td className="px-3 py-1.5">Total geral</td>{p.colunas.map(c => <td key={c} className="px-3 py-1.5 text-right tabular-nums">{brl(p.totColuna[c])}</td>)}<td className="px-3 py-1.5 text-right tabular-nums">{brl(p.total)}</td></tr>
          </tbody>
        </table>
      </div>
    )}
  </section>
);

/** modo 'cobranca': faturas em aberto e mensagens. modo 'painel': só o Painel do Encarregado (indicadores, dívida por idade, saldos parados). */
export const Cobranca: React.FC<{ modo?: 'cobranca' | 'painel' }> = ({ modo = 'cobranca' }) => {
  const soPainel = modo === 'painel';
  const { user } = useAuth();
  const podeEditar = user?.role !== UserRole.READ_ONLY;
  const [aba, setAba] = useState<Aba>(soPainel ? 'painel' : 'quadro');
  const [base, setBase] = useState<Base | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState('');
  const [linhaPor, setLinhaPor] = useState<'setor' | 'comando' | 'cliente'>('setor');
  // setores: múltipla escolha (guarda os excluídos) + um grupo nomeado e editável (antes fixo em DGMM)
  const [exSetores, setExSetores] = useExcluidosLembrados('siscont.cobranca.setores');
  const [editarGrupo, setEditarGrupo] = useState<{ nome: string; setores: Set<string> } | null>(null);
  const [incluirContestadas, setIncluirContestadas] = useState(false);
  const [qExtra, setQExtra] = useState(false);
  const [qContest, setQContest] = useState(false);
  const [cobrancas, setCobrancas] = useState<{ comando: string; enviadaEm: string }[]>([]);
  const [contestacoesAbertas, setContestacoesAbertas] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ comando: string; indicativo: string | null; texto: string; faturas: FaturaAberta[] } | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const b = await carregarBase();
      setBase(b); setAtualizadoEm(new Date().toLocaleString('pt-BR'));
      listarCobrancas().then(setCobrancas).catch(() => setCobrancas([]));
      listarContestacoes().then(c => setContestacoesAbertas(c.filter(x => x.status !== 'ENCERRADA').length)).catch(() => setContestacoesAbertas(null));
    } catch (e) { notify.fail('Erro ao carregar', e); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  const h = hoje();
  const setoresMaterial = useMemo(() => (base?.par.setores_material ?? 'DGMM').split(',').map(s => s.trim().toUpperCase()).filter(Boolean), [base]);
  const nomeGrupo = base?.par.nome_grupo_setores || 'Setor do Material';
  const todosSetores = useMemo(() => (base ? [...new Set(faturasAbertas(base.invoices).map(f => f.setor).filter(Boolean))].sort() : []), [base]);
  const abertas = useMemo(() => {
    if (!base) return [];
    return faturasAbertas(base.invoices).filter(f => !exSetores.has(f.setor));
  }, [base, exSetores]);
  const noGrupo = (s: string) => setoresMaterial.includes(s.toUpperCase());
  const gravarGrupo = async () => {
    if (!editarGrupo) return;
    try {
      await cadastroService.saveParametro({ chave: 'setores_material', valor: [...editarGrupo.setores].join(','), descricao: 'Setores do grupo destacado na Cobrança (separados por vírgula)' } as any);
      await cadastroService.saveParametro({ chave: 'nome_grupo_setores', valor: editarGrupo.nome.trim() || 'Setor do Material', descricao: 'Nome do grupo de setores destacado na Cobrança' } as any);
      notify.success('Grupo de setores gravado.'); setEditarGrupo(null); carregar();
    } catch (e) { notify.fail('Não foi possível gravar (somente o administrador altera parâmetros)', e); }
  };
  const q = useMemo(() => quadroAberto(abertas, h), [abertas, h]);
  // quadro como na planilha: sem extra-MB e sem contestadas (abas próprias), salvo se marcado
  const qQuadro = useMemo(() => quadroAberto(abertas.filter(f => (qExtra || !/EXTRA/i.test(f.setor)) && (qContest || !f.contestada)), h), [abertas, h, qExtra, qContest]);
  const linha = (f: FaturaAberta) => (linhaPor === 'setor' ? f.setor : linhaPor === 'comando' ? f.comando : f.cliente);
  const blocos = [
    ...qQuadro.porExercicio.map(e => ({ titulo: `Faturas vencidas ${e.ano}`, fs: e.faturas })),
    { titulo: 'Faturas vencidas — total', fs: qQuadro.vencidas }, { titulo: 'Faturas a vencer', fs: qQuadro.aVencer }, { titulo: 'Faturas em aberto — total', fs: qQuadro.todas },
  ].map(b => ({ ...b, p: pivo(b.fs, linha, f => f.tipo) }));

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    blocos.forEach(b => {
      const aoa = [[`MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE`], [b.titulo, '', `Atualizado em: ${atualizadoEm}`], [],
        [linhaPor.toUpperCase(), ...b.p.colunas, 'Total geral'], ...b.p.linhas.map(l => [l, ...b.p.colunas.map(c => b.p.valores[l][c] || null), b.p.totLinha[l]]),
        ['Total geral', ...b.p.colunas.map(c => b.p.totColuna[c]), b.p.total]];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), b.titulo.replace(/[—/]/g, '-').slice(0, 31));
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Setor', 'Comando', 'Cliente', 'Fatura', 'Tipo', 'Data-limite', 'Saldo', 'Contestada'],
      ...abertas.map(f => [f.setor, f.comando, f.cliente, f.numero, f.tipo, br(f.vencimento), f.saldo, f.contestada ? 'SIM' : ''])]), 'Detalhe');
    XLSX.writeFile(wb, `faturas_em_aberto_${h}.xlsx`);
  };
  const exportarPdf = () => {
    const doc = new jsPDF('l');
    doc.setFontSize(9); doc.text('MARINHA DO BRASIL · BASE NAVAL DA ILHA DAS COBRAS · DIVISÃO DE CONTABILIDADE', 14, 12);
    doc.text(`Atualizado em: ${atualizadoEm}`, 283, 12, { align: 'right' });
    doc.setFontSize(12); doc.text(`Quadro resumo — faturas em aberto${exSetores.size ? ` (setores: ${todosSetores.filter(x => !exSetores.has(x)).join(', ')})` : ''}`, 14, 19);
    let y = 24;
    blocos.forEach(b => {
      doc.setFontSize(10); doc.text(b.titulo.toUpperCase(), 14, y + 4);
      autoTable(doc, { startY: y + 6, head: [[linhaPor.toUpperCase(), ...b.p.colunas, 'Total']], body: [...b.p.linhas.map(l => [l, ...b.p.colunas.map(c => (b.p.valores[l][c] ? brl(b.p.valores[l][c]) : '')), brl(b.p.totLinha[l])]), ['Total geral', ...b.p.colunas.map(c => brl(b.p.totColuna[c])), brl(b.p.total)]], styles: { fontSize: 7 }, headStyles: { fillColor: [30, 41, 59] } });
      y = (doc as any).lastAutoTable.finalY + 4;
      if (y > 175) { doc.addPage(); y = 14; }
    });
    doc.save(`faturas_em_aberto_${h}.pdf`);
  };

  // ------------- mensagens de cobrança
  const vencidasPorComando = useMemo(() => {
    const m = new Map<string, FaturaAberta[]>();
    q.vencidas.filter(f => incluirContestadas || !f.contestada).forEach(f => m.set(f.comando, [...(m.get(f.comando) || []), f]));
    return [...m.entries()].map(([c, fs]) => ({ comando: c, fs, total: fs.reduce((s, f) => s + f.saldo, 0), maisAntiga: fs.reduce((a, f) => (f.vencimento < a ? f.vencimento : a), '9999') }))
      .sort((a, b) => b.total - a.total);
  }, [q, incluirContestadas]);
  const ultimaCobranca = (c: string) => cobrancas.filter(x => x.comando === c).map(x => x.enviadaEm).sort().pop();

  // ------------- painel
  const parados = useMemo(() => (base ? saldosParados(base, h, Number(base.par.dias_saldo_parado) || 60) : []), [base, h]);
  const adiant = useMemo(() => (base ? adiantamentosComSaldo(base) : []), [base]);

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{soPainel ? 'Painel do Encarregado' : 'Cobrança'}</h2>
          <p className="text-slate-500 text-sm">{soPainel ? 'Indicadores de cobrança, dívida de cada OM por faixa de atraso, saldos parados e adiantamentos.' : 'Faturas em aberto por exercício, setor, comando e tipo; mensagens de cobrança por comando.'} {atualizadoEm && <span className="text-slate-400">Atualizado em {atualizadoEm}.</span>}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
      </div>
      {!soPainel && <div className="flex space-x-1 border-b border-slate-200">
        {([['quadro', 'Faturas em aberto'], ['mensagens', 'Mensagens de cobrança']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 ${aba === k ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500'}`}>{l}</button>
        ))}
      </div>}
      {!base && carregando && <p className="text-sm text-slate-500">Carregando...</p>}

      {base && (aba === 'quadro' || aba === 'painel') && (
        <div className="flex flex-wrap gap-3 items-end">
          <MultiFiltro rotulo="Setores" opcoes={todosSetores} excluidos={exSetores} onChange={setExSetores} />
          <div className="flex flex-wrap items-center gap-2 pb-1 text-xs">
            <button className="px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50" onClick={() => setExSetores(new Set(todosSetores.filter(s => !noGrupo(s))))} title={setoresMaterial.join(', ')}>Só {nomeGrupo}</button>
            <button className="px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50" onClick={() => setExSetores(new Set(todosSetores.filter(noGrupo)))}>Exceto {nomeGrupo}</button>
            <button className="px-2 py-1 rounded-full border border-slate-300 hover:bg-slate-50" onClick={() => setExSetores(new Set())}>Todos</button>
            {podeEditar && <button className="text-primary-700 underline" onClick={() => setEditarGrupo({ nome: nomeGrupo, setores: new Set(setoresMaterial) })}>definir grupo…</button>}
          </div>
          {aba === 'quadro' && <>
            <label className="text-xs text-slate-600">Linhas por
              <select className={`${sel} block mt-1`} value={linhaPor} onChange={e => setLinhaPor(e.target.value as any)} aria-label="Linhas por">
                <option value="setor">Setor</option><option value="comando">Comando</option><option value="cliente">OM cliente</option>
              </select>
            </label>
            <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={qExtra} onChange={e => setQExtra(e.target.checked)} /> Incluir extra-MB</label>
            <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={qContest} onChange={e => setQContest(e.target.checked)} /> Incluir contestadas</label>
            <Button variant="secondary" onClick={exportarExcel}><FileSpreadsheet size={16} className="mr-1" />Excel</Button>
            <Button variant="secondary" onClick={exportarPdf}><FileText size={16} className="mr-1" />PDF</Button>
          </>}
        </div>
      )}

      {base && aba === 'quadro' && <div className="space-y-4">{blocos.map(b => <TabelaPivo key={b.titulo} titulo={b.titulo} p={b.p} rotuloLinha={linhaPor === 'setor' ? 'Setor' : linhaPor === 'comando' ? 'Comando' : 'OM cliente'} />)}</div>}

      {base && aba === 'mensagens' && (
        <div className="space-y-3">
          <label className="text-sm flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={incluirContestadas} onChange={e => setIncluirContestadas(e.target.checked)} /> Incluir faturas em contestação</label>
          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Comando', 'Indicativo', 'Faturas vencidas', 'Total', 'Mais antiga', 'Última cobrança', ''].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {vencidasPorComando.map(v => {
                  const c = comandoDoTexto(v.comando, base.comandos);
                  return (
                    <tr key={v.comando}>
                      <td className="px-3 py-2 max-w-[280px] truncate" title={v.comando}>{v.comando}</td>
                      <td className="px-3 py-2 text-xs">{c.indicativo || <span className="text-amber-700">cadastrar</span>}</td>
                      <td className="px-3 py-2">{v.fs.length}</td>
                      <td className="px-3 py-2 tabular-nums font-semibold">{brl(v.total)}</td>
                      <td className="px-3 py-2 text-xs">{br(v.maisAntiga)}</td>
                      <td className="px-3 py-2 text-xs">{br(ultimaCobranca(v.comando))}</td>
                      <td className="px-3 py-2 text-right"><button className="text-primary-700 underline text-xs" onClick={() => setMsg({ comando: v.comando, indicativo: c.indicativo, faturas: v.fs, texto: mensagemCobranca(c, v.fs, h) })}><Mail size={12} className="inline mr-1" />gerar mensagem</button></td>
                    </tr>
                  );
                })}
                {!vencidasPorComando.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">Nenhuma fatura vencida.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {base && aba === 'painel' && (
        <PainelEncarregado abertas={abertas} hoje={h} diasParado={Number(base.par.dias_saldo_parado) || 60} contestacoesAbertas={contestacoesAbertas}
          parados={parados} adiantamentos={adiant} />
      )}

      <Modal isOpen={!!msg} onClose={() => setMsg(null)} title={`Mensagem de cobrança — ${msg?.comando ?? ''}`} maxWidth="max-w-3xl"
        footer={<div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(msg!.texto); notify.success('Mensagem copiada.'); }}><Copy size={14} className="mr-1" />Copiar</Button>
          {podeEditar && <Button onClick={async () => {
            try {
              await registrarCobranca({ comando: msg!.comando, indicativo: msg!.indicativo, faturas: msg!.faturas.map(f => f.numero), valor: msg!.faturas.reduce((s, f) => s + f.saldo, 0), texto: msg!.texto, usuario: user?.name || user?.email || '' });
              notify.success('Cobrança registrada.'); setMsg(null); setCobrancas(await listarCobrancas());
            } catch (e) { notify.fail('Não foi possível registrar', e); }
          }}>Enviada — registrar</Button>}
        </div>}>
        <p className="text-xs text-slate-500 mb-2">Texto pronto para o SIGAD; ajuste ao padrão de mensagens antes de enviar.</p>
        <textarea className="w-full h-80 font-mono text-xs border border-slate-300 rounded p-2" value={msg?.texto ?? ''} onChange={e => setMsg(m => (m ? { ...m, texto: e.target.value } : m))} aria-label="Texto da cobrança" />
      </Modal>
      <Modal isOpen={!!editarGrupo} onClose={() => setEditarGrupo(null)} title="Grupo de setores destacado">
        {editarGrupo && <div className="space-y-3 text-sm">
          <p className="text-slate-600">Defina quais setores formam o grupo usado nos atalhos "Só…" e "Exceto…" (antes era fixo: Setor do Material = DGMM).</p>
          <label className="block">Nome do grupo<input className={`${sel} w-full`} value={editarGrupo.nome} onChange={e => setEditarGrupo({ ...editarGrupo, nome: e.target.value })} aria-label="Nome do grupo" /></label>
          <div className="grid grid-cols-2 gap-1 max-h-60 overflow-y-auto border border-slate-200 rounded p-2">
            {[...new Set([...todosSetores, ...setoresMaterial])].sort().map(s => (
              <label key={s} className="flex items-center gap-2"><input type="checkbox" checked={editarGrupo.setores.has(s.toUpperCase())} onChange={e => { const n = new Set(editarGrupo.setores); e.target.checked ? n.add(s.toUpperCase()) : n.delete(s.toUpperCase()); setEditarGrupo({ ...editarGrupo, setores: n }); }} />{s}</label>
            ))}
          </div>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditarGrupo(null)}>Cancelar</Button><Button onClick={gravarGrupo}>Gravar</Button></div>
        </div>}
      </Modal>
    </div>
  );
};
