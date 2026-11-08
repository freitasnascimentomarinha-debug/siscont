import React, { useEffect, useMemo, useState } from 'react';
import { MultiFiltro, useExcluidosLembrados } from '../components/ui/MultiFiltro';
import { cadastroService } from '../services/cadastroService';
import { Copy, FileSpreadsheet, FileText, Mail, RefreshCw } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { podeEditarDados } from '../types';
import {
  adiantamentosComSaldo, carregarBase, comandoDoTexto, faturasAbertas, listarCobrancas, registrarCobranca, rotularPeloCadastro, saldosParados,
} from '../services/relatoriosService';
import { listarContestacoes } from '../services/fase4Service';
import { FAIXAS, FaturaAberta, Pivo, diasAtraso, faixaDe, mensagemCobranca, pivo, quadroAberto } from '../utils/relatorios';

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
import { notify } from '../utils/notify';
import { hojeISO } from '../utils/datas';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { PainelEncarregado } from '../components/cobranca/PainelEncarregado';
import { FaturaMapa, OMRef, creditosDoMapa, montarMapa } from '../utils/mapaAnalitico';
import { pdfArvore } from '../utils/pdfArvore';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
// calendário local (às 21h de Brasília o UTC já é o dia seguinte e marcaria como vencida a fatura que vence hoje)
const hoje = () => hojeISO();
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
  const podeEditar = podeEditarDados(user?.role);
  const [aba, setAba] = useState<Aba>(soPainel ? 'painel' : 'quadro');
  const [base, setBase] = useState<Base | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState('');
  const [linhaPor, setLinhaPor] = useState<'setor' | 'comando' | 'cliente'>('setor');
  // setores: múltipla escolha (guarda os excluídos) + um grupo nomeado e editável (antes fixo em DGMM)
  // filtro de setores lembrado separado para a Cobrança e para o Painel do Encarregado
  const [exSetores, setExSetores] = useExcluidosLembrados(soPainel ? 'siscont.painel.setores' : 'siscont.cobranca.setores');
  const [indicativos, setIndicativos] = useState<Record<string, string>>({});
  const [editarGrupo, setEditarGrupo] = useState<{ nome: string; setores: Set<string> } | null>(null);
  const [incluirContestadas, setIncluirContestadas] = useState(false);
  // filtros das mensagens de cobrança (a tabela, a mensagem e o PDF seguem o filtro)
  const [exComandos, setExComandos] = useExcluidosLembrados('siscont.cobranca.comandos');
  const [faixaMsg, setFaixaMsg] = useState('');
  const [buscaMsg, setBuscaMsg] = useState('');
  const [ultimaMsg, setUltimaMsg] = useState<'' | 'nunca' | '30' | '60' | '90'>('');
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
  // setor e comando pelo cadastro da OM (não pelo texto da fatura)
  const abertasTodas = useMemo(() => (base ? rotularPeloCadastro(faturasAbertas(base.invoices), base) : []), [base]);
  const todosSetores = useMemo(() => [...new Set(abertasTodas.map(f => f.setor).filter(Boolean))].sort(), [abertasTodas]);
  const abertas = useMemo(() => {
    if (!base) return [];
    return abertasTodas.filter(f => !exSetores.has(f.setor));
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
  const comandosVencidos = useMemo(() => [...new Set(q.vencidas.map(f => f.comando).filter(Boolean))].sort(), [q]);
  const vencidasFiltradas = useMemo(() => {
    const b = semAcento(buscaMsg.trim());
    return q.vencidas.filter(f => (incluirContestadas || !f.contestada) && !exComandos.has(f.comando)
      && (!faixaMsg || faixaDe(Math.max(0, diasAtraso(f.vencimento, h))) === faixaMsg)
      && (!b || semAcento(`${f.numero} ${f.cliente} ${f.comando} ${f.setor} ${f.tipo}`).includes(b)));
  }, [q, incluirContestadas, exComandos, faixaMsg, buscaMsg, h]);
  const vencidasPorComando = useMemo(() => {
    const m = new Map<string, FaturaAberta[]>();
    vencidasFiltradas.forEach(f => m.set(f.comando, [...(m.get(f.comando) || []), f]));
    const ult = (c: string) => cobrancas.filter(x => x.comando === c).map(x => x.enviadaEm).sort().pop();
    return [...m.entries()].map(([c, fs]) => ({ comando: c, fs, total: fs.reduce((s, f) => s + f.saldo, 0), maisAntiga: fs.reduce((a, f) => (f.vencimento < a ? f.vencimento : a), '9999') }))
      .filter(v => {
        if (!ultimaMsg) return true;
        const u = ult(v.comando);
        if (ultimaMsg === 'nunca') return !u;
        return !u || diasAtraso(u.slice(0, 10), h) > Number(ultimaMsg);
      })
      .sort((a, b) => b.total - a.total);
  }, [vencidasFiltradas, cobrancas, ultimaMsg, h]);
  const filtrosMsgLigados = !!(exSetores.size || exComandos.size || faixaMsg || buscaMsg.trim() || ultimaMsg || incluirContestadas);
  const limparFiltrosMsg = () => { setExSetores(new Set()); setExComandos(new Set()); setFaixaMsg(''); setBuscaMsg(''); setUltimaMsg(''); setIncluirContestadas(false); };
  const descricaoFiltrosMsg = () => {
    const f: string[] = [];
    if (exSetores.size) f.push(`setores: ${todosSetores.filter(x => !exSetores.has(x)).join(', ') || 'nenhum'}`);
    if (exComandos.size) f.push(`${comandosVencidos.filter(x => !exComandos.has(x)).length} de ${comandosVencidos.length} comandos`);
    if (faixaMsg) f.push(`atraso ${faixaMsg}`);
    if (buscaMsg.trim()) f.push(`busca "${buscaMsg.trim()}"`);
    if (ultimaMsg) f.push(ultimaMsg === 'nunca' ? 'comandos nunca cobrados' : `sem cobrança há mais de ${ultimaMsg} dias`);
    f.push(incluirContestadas ? 'com as faturas em contestação' : 'sem as faturas em contestação');
    return f.join(' · ');
  };
  /** Comando do cadastro pelo texto "40030 - Nome" (código) ou pelo nome. */
  const comandoDe = (texto: string) => {
    if (!base) return undefined;
    const cod = texto.match(/^\d{4,5}/)?.[0];
    return cod ? base.comandos.find(x => x.codigo === cod) : base.comandos.find(x => x.nome.toLowerCase() === texto.toLowerCase());
  };
  const semIndicativo = useMemo(() => (base ? vencidasPorComando.filter(v => !comandoDoTexto(v.comando, base.comandos).indicativo).length : 0), [vencidasPorComando, base]);
  const gravarIndicativo = async (texto: string) => {
    const c = comandoDe(texto); const ind = (indicativos[texto] || '').trim().toUpperCase();
    if (!c || !ind) return;
    try { await cadastroService.saveComando({ ...c, indicativoNaval: ind }); notify.success(`Indicativo ${ind} gravado no comando.`); setIndicativos(x => { const n = { ...x }; delete n[texto]; return n; }); carregar(); }
    catch (e) { notify.fail('Não foi possível gravar o indicativo (somente quem edita o cadastro)', e); }
  };
  const ultimaCobranca = (c: string) => cobrancas.filter(x => x.comando === c).map(x => x.enviadaEm).sort().pop();

  // ------------- PDF da cobrança no formato da árvore do Mapa Analítico (com o crédito disponível de cada OM)
  const omsMapa = useMemo<OMRef[]>(() => {
    if (!base) return [];
    const cmd = new Map(base.comandos.map(c => [c.id, c]));
    const set = new Map<string, string>((base.setores as { id: string; sigla: string }[]).map(x => [x.id, x.sigla]));
    return (base.oms as { id: string; nome: string; comandoId?: string | null; setorId?: string | null }[]).map(o => {
      const c = o.comandoId ? cmd.get(o.comandoId) : undefined;
      return { omId: o.id, nome: o.nome, setor: (o.setorId && set.get(o.setorId)) || (c?.setorId && set.get(c.setorId)) || '', comando: c ? `${c.codigo ? `${c.codigo} - ` : ''}${c.nome}` : '' };
    });
  }, [base]);
  const creditosMapa = useMemo(() => (base ? creditosDoMapa(
    base.docs.filter(d => d.availableValue > 0.005).map(d => ({ id: d.id, client: d.client, sector: d.sector, command: d.command, numero: d.documentNumber, availableValue: d.availableValue })),
    base.baixas.map(b => ({ documentId: b.documentId, invoiceId: b.invoiceId, amount: b.amount })),
    base.invoices.map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, omId: i.omId ?? null, client: i.client, isCanceled: i.isCanceled })), omsMapa) : []), [base, omsMapa]);
  const mapaDasFaturas = (lista: FaturaAberta[]) => montarMapa(
    lista.map(f => ({ id: f.id, omId: f.omId ?? null, client: f.cliente, sector: f.setor, command: f.comando, numero: f.numero, tipo: f.tipo, vencimento: f.vencimento, saldo: f.saldo, contestada: f.contestada }) as FaturaMapa),
    // só as OM das faturas cobradas (o filtro 'vencidas' tira as OM que só têm crédito)
    creditosMapa, omsMapa, { hoje: h, ordem: 'nome', faturas: 'vencidas' });
  const REGRA_CREDITO = 'O crédito (ALTCRED/GRU com saldo) é o disponível da própria OM e abate somente a dívida dela.';
  const pdfCobranca = (m: { comando: string; indicativo: string | null; faturas: FaturaAberta[] }) => {
    const contest = m.faturas.filter(f => f.contestada).length;
    pdfArvore(mapaDasFaturas(m.faturas), {
      titulo: `Cobrança de faturas em atraso — ${m.comando}`,
      linhas: [`Para: ${m.indicativo || '(sem indicativo naval)'} · posição em ${br(h)} · ${m.faturas.length} fatura(s) vencida(s)${contest ? ` (${contest} em contestação)` : ''}`, REGRA_CREDITO],
      rotuloTotal: 'TOTAL EM ATRASO / A PAGAR (LÍQUIDO)',
    }).save(`cobranca_${(m.comando.match(/^\d{4,5}/)?.[0] || m.comando).replace(/[^\w-]+/g, '_').slice(0, 40)}_${h}.pdf`);
  };
  /** PDF de todas as faturas vencidas que passaram nos filtros, em árvore. */
  const pdfFiltro = () => {
    const lista = vencidasPorComando.flatMap(v => v.fs);
    if (!lista.length) { notify.error('Nenhuma fatura no filtro.'); return; }
    pdfArvore(mapaDasFaturas(lista), {
      titulo: 'Cobrança — faturas vencidas por setor, comando e OM',
      linhas: [`Posição em ${br(h)} · ${vencidasPorComando.length} comando(s) · ${lista.length} fatura(s) vencida(s)`, `Filtros: ${descricaoFiltrosMsg()}`, REGRA_CREDITO],
      rotuloTotal: 'TOTAL EM ATRASO / A PAGAR (LÍQUIDO)',
    }).save(`cobranca_filtro_${h}.pdf`);
  };

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
          {semIndicativo > 0 && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">{semIndicativo} comando(s) com faturas vencidas não têm indicativo naval: a mensagem sairia sem o destinatário. Digite o indicativo na coluna e clique em gravar (fica no cadastro do comando).</p>}
          {!cobrancas.length && <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-2">Nenhuma cobrança registrada ainda. Depois de enviar a mensagem, clique em <b>Enviada — registrar</b> para a data aparecer em "Última cobrança".</p>}
          <div className="flex flex-wrap gap-3 items-end bg-white rounded-lg border border-slate-200 p-3" aria-label="Filtros da cobrança">
            <MultiFiltro rotulo="Setores" opcoes={todosSetores} excluidos={exSetores} onChange={setExSetores} />
            <MultiFiltro rotulo="Comandos" opcoes={comandosVencidos} excluidos={exComandos} onChange={setExComandos} largura="w-96" />
            <label className="text-xs text-slate-600">Atraso
              <select className={`${sel} block mt-1`} value={faixaMsg} onChange={e => setFaixaMsg(e.target.value)} aria-label="Faixa de atraso">
                <option value="">Todas as faixas</option>
                {FAIXAS.filter(x => x.rotulo !== 'A vencer').map(x => <option key={x.rotulo} value={x.rotulo}>{x.rotulo}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Última cobrança
              <select className={`${sel} block mt-1`} value={ultimaMsg} onChange={e => setUltimaMsg(e.target.value as any)} aria-label="Última cobrança">
                <option value="">Qualquer</option><option value="nunca">Nunca cobrados</option>
                <option value="30">Há mais de 30 dias (ou nunca)</option><option value="60">Há mais de 60 dias (ou nunca)</option><option value="90">Há mais de 90 dias (ou nunca)</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">Buscar
              <input className={`${sel} block mt-1 w-56`} placeholder="OM, fatura, comando, tipo" value={buscaMsg} onChange={e => setBuscaMsg(e.target.value)} aria-label="Buscar nas faturas vencidas" />
            </label>
            <label className="text-sm flex items-center gap-2 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={incluirContestadas} onChange={e => setIncluirContestadas(e.target.checked)} /> Incluir faturas em contestação</label>
            {filtrosMsgLigados && <button className="text-xs text-primary-700 underline pb-2" onClick={limparFiltrosMsg}>limpar filtros</button>}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-sm text-slate-600">{vencidasPorComando.length} comando(s) · {vencidasPorComando.reduce((s, v) => s + v.fs.length, 0)} fatura(s) · <b className="tabular-nums">{brl(vencidasPorComando.reduce((s, v) => s + v.total, 0))}</b></span>
              <Button variant="secondary" onClick={pdfFiltro}><FileText size={16} className="mr-1" />PDF do filtro</Button>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Comando', 'Indicativo', 'Faturas vencidas', 'Total', 'Mais antiga', 'Última cobrança', ''].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {vencidasPorComando.map(v => {
                  const c = comandoDoTexto(v.comando, base.comandos);
                  return (
                    <tr key={v.comando}>
                      <td className="px-3 py-2 max-w-[280px] truncate" title={v.comando}>{v.comando}</td>
                      <td className="px-3 py-2 text-xs">{c.indicativo || (podeEditar && comandoDe(v.comando) ? (
                        <span className="inline-flex items-center gap-1">
                          <input className="w-24 border border-amber-300 rounded px-1 py-0.5 text-xs" placeholder="ex.: DIMRJ" aria-label={`Indicativo naval de ${v.comando}`}
                            value={indicativos[v.comando] ?? ''} onChange={e => setIndicativos(x => ({ ...x, [v.comando]: e.target.value.toUpperCase() }))} />
                          <button type="button" className="text-primary-700 underline disabled:opacity-40" disabled={!(indicativos[v.comando] || '').trim()} onClick={() => gravarIndicativo(v.comando)}>gravar</button>
                        </span>) : <span className="text-amber-700">sem indicativo</span>)}</td>
                      <td className="px-3 py-2">{v.fs.length}</td>
                      <td className="px-3 py-2 tabular-nums font-semibold">{brl(v.total)}</td>
                      <td className="px-3 py-2 text-xs">{br(v.maisAntiga)}</td>
                      <td className="px-3 py-2 text-xs">{ultimaCobranca(v.comando) ? br(ultimaCobranca(v.comando)) : <span className="text-amber-700">nunca</span>}</td>
                      <td className="px-3 py-2 text-right"><button className="text-primary-700 underline text-xs" onClick={() => setMsg({ comando: v.comando, indicativo: c.indicativo, faturas: v.fs, texto: mensagemCobranca(c, v.fs, h) })}><Mail size={12} className="inline mr-1" />gerar mensagem</button></td>
                    </tr>
                  );
                })}
                {!vencidasPorComando.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400">{filtrosMsgLigados ? 'Nenhuma fatura vencida no filtro.' : 'Nenhuma fatura vencida.'}</td></tr>}
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
          <Button variant="secondary" onClick={() => pdfCobranca(msg!)}><FileText size={14} className="mr-1" />PDF das faturas</Button>
          <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(msg!.texto); notify.success('Mensagem copiada.'); }}><Copy size={14} className="mr-1" />Copiar</Button>
          {podeEditar && <Button onClick={async () => {
            try {
              await registrarCobranca({ comando: msg!.comando, indicativo: msg!.indicativo, faturas: msg!.faturas.map(f => f.numero), valor: msg!.faturas.reduce((s, f) => s + f.saldo, 0), texto: msg!.texto, usuario: user?.name || user?.email || '' });
              notify.success('Cobrança registrada.'); setMsg(null); setCobrancas(await listarCobrancas());
            } catch (e) { notify.fail('Não foi possível registrar', e); }
          }}>Enviada — registrar</Button>}
        </div>}>
        <p className="text-xs text-slate-500 mb-2">Texto pronto para o SIGAD; ajuste ao padrão de mensagens antes de enviar. <b>PDF das faturas</b> gera a relação em árvore (setor › comando › OM › faturas), como no Mapa Analítico, para anexar.</p>
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
