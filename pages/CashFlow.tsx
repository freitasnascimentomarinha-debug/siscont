
import { dataBR } from '../utils/datas';
import { BaixarModelo } from '../components/ui/BaixarModelo';
import { modeloNotasEmpenho } from '../utils/modelos';
import React, { useState, useEffect, useRef } from 'react';
import { useAbaNoEndereco } from '../utils/abaNoEndereco';
import { db } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { notify } from '../utils/notify';
import { CashFlowItem, CashFlowExit, DocumentType, ReceivedDocument, podeEditarDados } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Gaveta } from '../components/ui/Gaveta';
import { MenuAcoes } from '../components/ui/MenuAcoes';
import { baixarModelo } from '../components/ui/BaixarModelo';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { CLASSES_CATEGORIA, Etiqueta, agruparPorMes, etiquetaDaClasse, precisaAtencao, separarOrigem } from '../utils/fluxoCaixa';
import { salvarSaidas, listarRubricas, listarSaidas, Fase5NaoInstaladaError, Saida } from '../services/relatoriosService';
import { ImportarSipladModal } from '../components/recebimentos/ImportarSipladModal';
import { CATEGORIAS } from '../utils/relatorios';
import { PreviaNE, NEExistente, entraNaGravacao, gravarPreviaNE, lerPlanilhaNE, SaldoMensal, CondominioRubrica, Disponivel, Rubricas } from '../components/fluxo/PaineisFluxo';
import * as XLSX from 'xlsx';
import { Rubrica, lerNE } from '../utils/relatorios';
import { Plus, Download, Upload, Filter, FileText, FileSpreadsheet, Edit2, Trash2, Search, X, Ban, ChevronDown, ChevronRight, BarChart3, AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TEMA, cabecalhoCompacto, cabecalhoInstitucional, salvarPdf, tabelaPdf, tituloRelatorio } from '../utils/pdfCabecalho';

const Lancamentos: React.FC = () => {
  const { user } = useAuth();
  const isReadOnly = !podeEditarDados(user?.role);

  const [items, setItems] = useState<CashFlowItem[]>([]);
  const [sipladAberto, setSipladAberto] = useState(false);
  const [docsCredito, setDocsCredito] = useState<ReceivedDocument[]>([]);

  // Filters
  const [filterText, setFilterText] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterType, setFilterType] = useState('');

  // Modal & Form State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<CashFlowExit>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [classe, setClasse] = useState('');
  // anulação parcial: diminui o valor de uma NE já lançada (gravada com valor negativo)
  const [anulacao, setAnulacao] = useState(false);
  const [rubricasAno, setRubricasAno] = useState<Rubrica[]>([]);
  const [classes, setClasses] = useState<Map<string, string>>(new Map());
  const [saidasFull, setSaidasFull] = useState<Saida[]>([]);
  const [filterClasse, setFilterClasse] = useState('');          // '' | 'ATENCAO' | 'R7' | 'ENERGIA'...
  const [filterDestino, setFilterDestino] = useState('');       // '' | 'PAGAMENTO' | 'ADIANTAMENTO' | 'OUTROS' (só entradas)
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [descAberta, setDescAberta] = useState<Set<string>>(new Set());
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [classeLote, setClasseLote] = useState('');
  const [confirmaLote, setConfirmaLote] = useState(false);
  const [mostrarGrafico, setMostrarGrafico] = useState(false);
  const neRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    listarRubricas(new Date().getFullYear()).then(setRubricasAno).catch(() => setRubricasAno([]));
    listarSaidas().then(ss => { setSaidasFull(ss); setClasses(new Map(ss.map(x => [x.id, x.rubricaNumero ? `R${x.rubricaNumero}` : x.categoria || '']))); }).catch(() => {});
  }, []);
  const classeDe = (item: CashFlowItem) => classes.get(item.id) || '';
  const rotuloClasse = (c: string) => (c.startsWith('R') ? c.slice(1) : ({ ENERGIA: 'Energia', AGUA: 'Água e Esgoto', TELEFONIA: 'Telefonia', CONDOMINIO: 'Condomínio/diária/viatura', EXPEDIENTE: 'Material de expediente e limpeza', OUTROS: 'Outros' } as Record<string, string>)[c] || '');
  const neInvalida = formData.documentType !== 'ALTCRED' && !!formData.documentNumber && !lerNE(formData.documentNumber);
  // NE já lançadas (para reconhecer o REFORÇO: aumento do valor da mesma NE, sem empenho novo)
  const nesLancadas: NEExistente[] = items.filter(i => i.type === 'EXIT').map(i => ({ numero: i.documentNumber, data: i.date, valor: i.value, client: i.client, rubric: i.rubric }));
  /** primeiro lançamento de cada NE (o empenho); os seguintes, com o mesmo número, são reforços */
  const primeiroDaNE = new Map<string, string>();
  [...items].filter(i => i.type === 'EXIT').sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.id.localeCompare(b.id))
    .forEach(i => { const k = (i.documentNumber || '').trim().toUpperCase(); if (!primeiroDaNE.has(k)) primeiroDaNE.set(k, i.id); });
  const ehReforco = (i: CashFlowItem) => i.type === 'EXIT' && primeiroDaNE.get((i.documentNumber || '').trim().toUpperCase()) !== i.id;
  const neDoForm = (formData.documentNumber || '').trim().toUpperCase();
  const originalDoForm = neDoForm ? items.find(i => i.type === 'EXIT' && i.id === primeiroDaNE.get(neDoForm) && i.id !== editingId) : undefined;
  const totalDaNE = (ne: string) => items.filter(i => i.type === 'EXIT' && !i.isCanceled && (i.documentNumber || '').trim().toUpperCase() === ne).reduce((t, i) => t + i.value, 0);

  // importação da planilha de NE: primeiro a PRÉVIA, depois "Gravar"
  const [previaNE, setPreviaNE] = useState<PreviaNE | null>(null);
  const [gravandoNE, setGravandoNE] = useState(false);
  const importarPlanilhaNE = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const rubs = await listarRubricas(new Date().getFullYear()).then(r => r.map(x => x.numero)).catch(() => [] as number[]);
      setPreviaNE(await lerPlanilhaNE(files[0], nesLancadas, rubs));
    } catch (e) { notify.fail('Erro ao ler a planilha de notas de empenho', e); } finally { if (neRef.current) neRef.current.value = ''; }
  };
  const gravarNE = async () => {
    if (!previaNE) return;
    setGravandoNE(true);
    try {
      const ref = previaNE.itens.filter(i => i.situacao === 'REFORCO').length;
      const n = await gravarPreviaNE(previaNE);
      const anu = previaNE.itens.filter(i => i.situacao === 'ANULACAO').length;
      notify.success(`${n} lançamento(s) importado(s): ${n - ref - anu} nota(s) de empenho nova(s)${ref ? `, ${ref} reforço(s)` : ''}${anu ? `, ${anu} anulação(ões)` : ''}.`);
      setPreviaNE(null);
      await refresh();
    } catch (e) { notify.fail('Erro ao gravar as notas de empenho', e); } finally { setGravandoNE(false); }
  };


  const refresh = async () => {
    try {
      setItems(await db.getCashFlow());
      setDocsCredito(await db.getDocuments());
      listarSaidas().then(ss => { setSaidasFull(ss); setClasses(new Map(ss.map(x => [x.id, x.rubricaNumero ? `R${x.rubricaNumero}` : x.categoria || '']))); }).catch(() => {});
    } catch (err) {
      notify.fail('Erro ao carregar fluxo de caixa', err);
    }
  };
  useEffect(() => { refresh(); }, []);

  // --- Dynamic Year Calculation ---
  const availableYears = Array.from(new Set(items.map(i => i.date.substring(0, 4)))).sort((a: string, b: string) => b.localeCompare(a));
  if (availableYears.length === 0) availableYears.push(new Date().getFullYear().toString());

  // --- Filtering Logic ---
  const filteredItems = items.filter(item => {
    const itemDate = new Date(item.date);

    // Period Filter
    const matchesMonth = !filterMonth || (itemDate.getUTCMonth() + 1).toString() === filterMonth;
    const matchesYear = !filterYear || itemDate.getUTCFullYear().toString() === filterYear;

    // Type Filter
    const matchesType = !filterType || item.type === filterType;

    // Text Filter (Description, Rubric, Client, Doc Number, Observation)
    const search = filterText.toLowerCase();
    const matchesText = !filterText ||
      (item.description?.toLowerCase().includes(search) ?? false) ||
      (item.rubric?.toLowerCase().includes(search) ?? false) ||
      (item.client?.toLowerCase().includes(search) ?? false) ||
      (item.documentNumber?.toLowerCase().includes(search) ?? false) ||
      (item.observation?.toLowerCase().includes(search) ?? false) ||
      (etiquetaDaClasse(classeDe(item), rubricasAno).completo.toLowerCase().includes(search));

    const classe = classeDe(item);
    const matchesClasse = !filterClasse || (filterClasse === 'ATENCAO' ? precisaAtencao(item, classe) : item.type === 'EXIT' && classe === filterClasse);
    const matchesDestino = !filterDestino || (item.type === 'ENTRY' && item.destino === filterDestino);

    return matchesMonth && matchesYear && matchesType && matchesText && matchesClasse && matchesDestino;
  });

  // --- Header Stats Calculation (Reactive) ---
  // Excludes Canceled items from logic
  const totalEntries = filteredItems.filter(i => i.type === 'ENTRY').reduce((acc, i) => acc + i.value, 0);
  const totalExits = filteredItems.filter(i => i.type === 'EXIT' && !i.isCanceled).reduce((acc, i) => acc + i.value, 0);

  const accumulatedBalance = filteredItems.length > 0
    ? filteredItems[filteredItems.length - 1].balanceAfter
    : 0;

  // --- Actions ---

  const handleSaveExit = async () => {
    if (isReadOnly) return;
    if (!formData.value || !formData.documentNumber) return;

    if (anulacao && !editingId) {
      if (!originalDoForm) { notify.error('Anulação: informe o número de uma NE já lançada.'); return; }
      if (Number(formData.value) > totalDaNE(neDoForm) + 0.005) { notify.error(`A anulação passa do valor atual da NE (R$ ${totalDaNE(neDoForm).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}).`); return; }
    }
    const payload: CashFlowExit = {
      id: editingId || uuidv4(),
      date: formData.date || new Date().toISOString().split('T')[0],
      documentNumber: formData.documentNumber!,
      documentType: (formData.documentType as DocumentType) || DocumentType.EMPENHO,
      client: formData.client || '',
      value: anulacao && !editingId ? -Math.abs(Number(formData.value)) : Number(formData.value),
      rubric: formData.rubric || '',
      description: formData.description || '',
      observation: formData.observation || '',
      isCanceled: formData.isCanceled || false,
    };
    // mesma NE já lançada: este lançamento é um REFORÇO (aumenta o valor do empenho)
    const marca = anulacao ? 'Anulação parcial de empenho' : 'Reforço de empenho';
    if (!editingId && originalDoForm && !/^(Reforço|Anulação parcial) de empenho/i.test(payload.observation || '')) payload.observation = `${marca}${payload.observation ? ` — ${payload.observation}` : ''}`;

    const cls = classe ? (classe.startsWith('R') ? { rubricaNumero: Number(classe.slice(1)), categoria: 'CONDOMINIO' } : { rubricaNumero: null, categoria: classe }) : { rubricaNumero: null, categoria: null };
    try {
      try { await salvarSaidas([{ ...payload, rubric: payload.rubric || rotuloClasse(classe), ...cls }]); }
      catch (e) { if (e instanceof Fase5NaoInstaladaError) await db.saveExit(payload); else throw e; }
      closeModal();
      notify.success('Saída salva.');
      await refresh();
    } catch (err) {
      notify.fail('Erro ao salvar saída', err);
    }
  };

  const handleEdit = (item: CashFlowItem) => {
    if (isReadOnly) return;
    if (item.type !== 'EXIT') return;
    setFormData({
      date: item.date,
      documentNumber: item.documentNumber,
      documentType: item.documentType || DocumentType.EMPENHO,
      client: item.client,
      value: item.value,
      rubric: item.rubric,
      description: item.description,
      observation: item.observation,
      isCanceled: item.isCanceled
    });
    setEditingId(item.id);
    setClasse(classeDe(item));
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (deleteId && !isReadOnly) {
      try {
        await db.deleteExit(deleteId);
        notify.success('Saída excluída.');
      } catch (err) {
        notify.fail('Erro ao excluir saída', err);
      }
      setDeleteId(null);
      await refresh();
    }
  };

  /** Muda a rubrica/categoria de uma ou mais saídas (edição rápida e em lote). */
  const aplicarClasse = async (ids: string[], nova: string) => {
    if (isReadOnly || !ids.length) return;
    const cls = nova ? (nova.startsWith('R') ? { rubricaNumero: Number(nova.slice(1)), categoria: 'CONDOMINIO' } : { rubricaNumero: null, categoria: nova }) : { rubricaNumero: null, categoria: null };
    const alvo = saidasFull.filter(x => ids.includes(x.id)).map(x => ({ ...x, ...cls, rubric: rotuloClasse(nova) || x.rubric }));
    if (!alvo.length) { notify.error('Não achei essas saídas para alterar. Atualize a página.'); return; }
    try {
      await salvarSaidas(alvo as Saida[]);
      notify.success(`${alvo.length} saída(s) ${nova ? `classificada(s) como ${etiquetaDaClasse(nova, rubricasAno).completo}` : 'sem classificação'}.`);
      setSelecionados(new Set()); setClasseLote(''); setConfirmaLote(false);
      await refresh();
    } catch (e) { notify.fail('Não foi possível alterar a classificação', e); }
  };
  const alternar = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormData({});
    setEditingId(null);
    setClasse('');
    setAnulacao(false);
  };

  // ... (Export functions remain unchanged) ...
  const exportPDF = () => {
    const doc = new jsPDF('l');
    cabecalhoCompacto(doc);
    const yIni = tituloRelatorio(doc, 'Relatório de Fluxo de Caixa', `Período: ${filterMonth ? filterMonth : 'Todos'}/${filterYear ? filterYear : 'Todos'} · posição em ${dataBR(new Date().toISOString().slice(0, 10))}`, 26);

    const rows = filteredItems.map(item => [
      dataBR(item.date),
      item.documentNumber + (item.isCanceled ? ' (CANCELADO)' : ''),
      item.client,
      item.description + (item.type === 'EXIT' && classeDe(item) ? ` (${etiquetaDaClasse(classeDe(item), rubricasAno).completo})` : (item.rubric ? ` (${item.rubric})` : '')),
      separarOrigem(item.observation).texto,
      item.type === 'ENTRY' ? `R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-',
      item.type === 'EXIT'
        ? (item.isCanceled ? '(R$ 0,00)' : `R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
        : '-',
      `R$ ${item.balanceAfter.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    // Footer row
    rows.push(['TOTAL', '', '', '', '', `R$ ${totalEntries.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, `R$ ${totalExits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, '']);

    tabelaPdf(doc, {
      startY: yIni,
      head: [['Data', 'Doc', 'Cliente', 'Descrição/Rubrica', 'Obs', 'Entrada', 'Saída', 'Saldo']],
      body: rows,
      styles: { fontSize: 8 },
      columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
      didParseCell: (d: any) => { if (d.section === 'body' && d.row.index === rows.length - 1) { d.cell.styles.fillColor = TEMA.total; d.cell.styles.fontStyle = 'bold'; } },
    });

    salvarPdf(doc, 'fluxo_caixa_siscont.pdf');
  };

  /** Excel (.xlsx) de verdade, com valores numéricos. */
  const exportExcel = () => {
    const linhas: (string | number)[][] = [['Data', 'Documento', 'Cliente', 'Descrição', 'Rubrica / categoria', 'Observação', 'Origem', 'Entrada', 'Saída', 'Saldo acumulado', 'Situação']];
    filteredItems.forEach(item => linhas.push([
      dataBR(item.date), item.documentNumber, item.client, item.description, item.type === 'EXIT' ? etiquetaDaClasse(classeDe(item), rubricasAno).completo : '', separarOrigem(item.observation).texto, separarOrigem(item.observation).origem,
      item.type === 'ENTRY' ? item.value : 0, item.type === 'EXIT' && !item.isCanceled ? item.value : 0, item.balanceAfter, item.isCanceled ? 'Anulado' : 'Ativo',
    ]));
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    ws['!cols'] = [11, 26, 32, 40, 26, 24, 30, 14, 14, 16, 10].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Fluxo de caixa');
    XLSX.writeFile(wb, 'fluxo_caixa.xlsx');
  };

  const months = [
    { v: '1', l: 'Janeiro' }, { v: '2', l: 'Fevereiro' }, { v: '3', l: 'Março' }, { v: '4', l: 'Abril' },
    { v: '5', l: 'Maio' }, { v: '6', l: 'Junho' }, { v: '7', l: 'Julho' }, { v: '8', l: 'Agosto' },
    { v: '9', l: 'Setembro' }, { v: '10', l: 'Outubro' }, { v: '11', l: 'Novembro' }, { v: '12', l: 'Dezembro' }
  ];

  const opcoesClasse = [
    ...(rubricasAno.length ? rubricasAno.map(r => ({ numero: r.numero, descricao: r.descricao })) : Array.from({ length: 33 }, (_, i) => ({ numero: i + 1, descricao: '(condomínio)' })))
      .map(r => ({ label: `${r.numero} — ${r.descricao}`, value: `R${r.numero}` })),
    ...CLASSES_CATEGORIA.map(c => ({ label: etiquetaDaClasse(c).texto, value: c })),
  ];
  const grupos = agruparPorMes(filteredItems, items);
  const atencaoQtd = items.filter(i => precisaAtencao(i, classeDe(i))).length;
  const saidasDaLista = filteredItems.filter(i => i.type === 'EXIT' && !isReadOnly);
  const filtrosLigados = [filterText && `Busca “${filterText}”`, filterType && (filterType === 'ENTRY' ? 'Só entradas' : 'Só saídas'), filterMonth && `Mês ${filterMonth}`, filterYear && `Ano ${filterYear}`,
    filterClasse && (filterClasse === 'ATENCAO' ? 'Sem classificação' : etiquetaDaClasse(filterClasse, rubricasAno).completo), filterDestino && ({ PAGAMENTO: 'Pagar faturas', ADIANTAMENTO: 'Adiantamento', OUTROS: 'Outros serviços' } as Record<string, string>)[filterDestino]].filter(Boolean) as string[];
  const limparFiltros = () => { setFilterText(''); setFilterMonth(''); setFilterYear(''); setFilterType(''); setFilterClasse(''); setFilterDestino(''); };
  const corEtiqueta: Record<Etiqueta['cor'], string> = { verde: 'bg-emerald-100 text-emerald-800 border-emerald-200', ambar: 'bg-amber-100 text-amber-800 border-amber-200', azul: 'bg-sky-100 text-sky-800 border-sky-200', violeta: 'bg-violet-100 text-violet-800 border-violet-200', teal: 'bg-teal-100 text-teal-800 border-teal-200', cinza: 'bg-slate-100 text-slate-700 border-slate-200', vermelho: 'bg-red-100 text-red-800 border-red-200' };
  const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  const dadosGrafico = agruparPorMes(filteredItems, items).map(g => ({ mes: g.rotulo.replace(/^(\w{3})\w*\//, '$1/'), Entradas: g.entradas, Saídas: g.saidas, 'Saldo no fim do mês': g.saldoFim }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
        <p className="text-slate-500 text-sm max-w-3xl">Entradas: as ALTCRED de Créditos recebidos (automáticas); a etiqueta mostra o destino de cada uma. As GRU ficam na página Extra-Marinha. Saídas: notas de empenho, cada uma com a sua rubrica ou categoria.</p>
        <div className="flex flex-wrap items-center gap-2">
          {!isReadOnly && (
            <>
              <input type="file" ref={neRef} onChange={e => importarPlanilhaNE(e.target.files)} accept=".xlsx,.xls,.ods" className="hidden" />
              <MenuAcoes rotulo="Importar" icone={<Upload size={14} />} itens={[
                { rotulo: 'NE (planilha)', onClick: () => neRef.current?.click(), dica: 'Notas de empenho de uma planilha; mostra a prévia antes de gravar' },
                { rotulo: 'ALTCRED (PDF do SIPLAD)', onClick: () => setSipladAberto(true), dica: 'As mesmas ALTCRED de Créditos recebidos; escolha o destino de cada uma' },
                { rotulo: 'Baixar planilha modelo de NE', onClick: () => { const d = new Date(); baixarModelo(modeloNotasEmpenho(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)); } },
              ]} />
            </>
          )}
          <MenuAcoes rotulo="Exportar" icone={<Download size={14} />} itens={[
            { rotulo: 'Excel', onClick: exportExcel, icone: <FileSpreadsheet size={14} /> },
            { rotulo: 'PDF', onClick: exportPDF, icone: <FileText size={14} /> },
          ]} />
          {!isReadOnly && (
            <Button onClick={() => { setEditingId(null); setFormData({}); setIsModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Nova Saída
            </Button>
          )}
        </div>
      </div>

      {/* Cartões do período filtrado + saldo corrido */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="cartoes-fluxo">
        <div className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-green-500">
          <p className="text-xs font-medium text-slate-500">Entradas do período</p>
          <h3 className="text-xl font-bold text-green-700 tabular-nums">{brl(totalEntries)}</h3>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-red-500">
          <p className="text-xs font-medium text-slate-500">Saídas do período</p>
          <h3 className="text-xl font-bold text-red-700 tabular-nums">{brl(totalExits)}</h3>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border-l-4 border-slate-400">
          <p className="text-xs font-medium text-slate-500">Resultado do período (entradas − saídas)</p>
          <h3 className={`text-xl font-bold tabular-nums ${totalEntries - totalExits >= 0 ? 'text-slate-700' : 'text-orange-700'}`}>{brl(totalEntries - totalExits)}</h3>
        </div>
        <div className={`bg-white p-4 rounded-lg shadow-sm border-l-4 ${accumulatedBalance >= 0 ? 'border-blue-500' : 'border-orange-500'}`}>
          <p className="text-xs font-medium text-slate-500">Saldo corrido do ano até o último lançamento listado</p>
          <h3 className={`text-xl font-bold tabular-nums ${accumulatedBalance >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>{brl(accumulatedBalance)}</h3>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 space-y-3" data-testid="filtros-fluxo">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div className="w-64"><Input label="Busca" placeholder="Descrição, fornecedor, NE, rubrica…" value={filterText} onChange={e => setFilterText(e.target.value)} /></div>
          <div className="w-32"><Select label="Mês" options={months.map(m => ({ label: m.l, value: m.v }))} value={filterMonth} onChange={e => setFilterMonth(e.target.value)} /></div>
          <div className="w-28"><Select label="Ano" options={availableYears.map(y => ({ label: y, value: y }))} value={filterYear} onChange={e => setFilterYear(e.target.value)} /></div>
          <div className="w-36"><Select label="Tipo" options={[{ label: 'Entradas', value: 'ENTRY' }, { label: 'Saídas', value: 'EXIT' }]} value={filterType} onChange={e => setFilterType(e.target.value)} /></div>
          <label className="text-sm font-medium text-slate-700 block">Rubrica / categoria
            <select aria-label="Filtrar por rubrica ou categoria" value={filterClasse} onChange={e => setFilterClasse(e.target.value)} className="mt-1 block w-60 rounded-md border border-slate-300 px-3 py-2 text-sm bg-white">
              <option value="">Todas</option>
              <option value="ATENCAO">Sem classificação (precisa de atenção)</option>
              {opcoesClasse.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="w-48"><Select label="Destino da ALTCRED" options={[{ label: 'Pagar faturas', value: 'PAGAMENTO' }, { label: 'Adiantamento', value: 'ADIANTAMENTO' }, { label: 'Outros serviços', value: 'OUTROS' }]} value={filterDestino} onChange={e => setFilterDestino(e.target.value)} /></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 text-sm" aria-live="polite">
          <span className="text-slate-600"><b>{filteredItems.length}</b> de {items.length} lançamentos{filtrosLigados.length ? ' atendem aos filtros:' : ' (nenhum filtro ligado)'}</span>
          {filtrosLigados.map(f => <span key={f} className="inline-flex items-center rounded-full bg-primary-50 text-primary-800 border border-primary-200 px-2 py-0.5 text-xs">{f}</span>)}
          {atencaoQtd > 0 && filterClasse !== 'ATENCAO' && (
            <button type="button" onClick={() => setFilterClasse('ATENCAO')} className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-800 border border-amber-300 px-2 py-0.5 text-xs font-semibold" title="Saídas sem rubrica nem categoria: classifique para os painéis ficarem certos (Outros também vale como categoria)">
              <AlertTriangle size={12} />{atencaoQtd} saída(s) precisam de classificação
            </button>
          )}
          <button type="button" onClick={() => setMostrarGrafico(!mostrarGrafico)} aria-expanded={mostrarGrafico} className="ml-auto inline-flex items-center gap-1 text-primary-700 font-semibold"><BarChart3 size={14} />{mostrarGrafico ? 'Esconder gráfico mensal' : 'Ver gráfico mensal'}</button>
          {filtrosLigados.length > 0 && <button type="button" className="text-primary-700 underline" onClick={limparFiltros}>Limpar filtros</button>}
        </div>
        {mostrarGrafico && (
          <div className="h-64" role="img" aria-label="Entradas e saídas por mês e saldo no fim do mês">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dadosGrafico} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`} />
                <Tooltip formatter={(v: number) => brl(v)} /><Legend />
                <Bar dataKey="Entradas" fill="#0ca30c" /><Bar dataKey="Saídas" fill="#d03b3b" />
                <Line type="monotone" dataKey="Saldo no fim do mês" stroke="#2a78d6" strokeWidth={2} dot />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Edição em lote */}
      {selecionados.size > 0 && !isReadOnly && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-primary-300 bg-primary-50 px-4 py-2 text-sm" role="region" aria-label="Edição em lote">
          <b>{selecionados.size} saída(s) selecionada(s)</b>
          <label className="flex items-center gap-2">Classificar como
            <select aria-label="Classificar as selecionadas como" value={classeLote} onChange={e => setClasseLote(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1 bg-white">
              <option value="">Escolha…</option>
              {opcoesClasse.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <Button size="sm" onClick={() => setConfirmaLote(true)} disabled={!classeLote}>Aplicar</Button>
          <button type="button" className="text-slate-600 underline" onClick={() => setSelecionados(new Set())}>Limpar seleção</button>
        </div>
      )}

      {/* Tabela por mês */}
      <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed" aria-label="Lançamentos do fluxo de caixa">
            <colgroup><col style={{ width: 28 }} /><col style={{ width: 88 }} /><col style={{ width: 196 }} /><col /><col style={{ width: 140 }} /><col style={{ width: 108 }} /><col style={{ width: 108 }} /><col style={{ width: 140 }} /><col style={{ width: 56 }} /></colgroup>
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="pl-3 pr-1 py-2 w-8">
                  {!isReadOnly && saidasDaLista.length > 0 && (
                    <input type="checkbox" aria-label="Selecionar todas as saídas da lista" checked={saidasDaLista.length > 0 && saidasDaLista.every(i => selecionados.has(i.id))}
                      onChange={e => setSelecionados(e.target.checked ? new Set(saidasDaLista.map(i => i.id)) : new Set())} />
                  )}
                </th>
                <th className="px-2 py-2 text-left">Data</th>
                <th className="px-2 py-2 text-left">Documento / fornecedor</th>
                <th className="px-2 py-2 text-left">Descrição</th>
                <th className="px-2 py-2 text-left">Rubrica / categoria</th>
                <th className="px-2 py-2 text-right">Entrada</th>
                <th className="px-2 py-2 text-right">Saída</th>
                <th className="px-2 py-2 text-right">Saldo</th>
                <th className="px-2 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(g => (
                <React.Fragment key={g.chave}>
                  <tr className="bg-slate-100 border-y border-slate-200">
                    <td colSpan={9} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                        <button type="button" onClick={() => setRecolhidos(alternar(recolhidos, g.chave))} aria-expanded={!recolhidos.has(g.chave)} className="font-bold text-slate-800 flex items-center gap-1">
                          {recolhidos.has(g.chave) ? <ChevronRight size={16} /> : <ChevronDown size={16} />}{g.rotulo}
                        </button>
                        <span className="text-slate-500">{g.itens.length} lançamento(s)</span>
                        <span className="text-green-700">Entradas <b className="tabular-nums">{brl(g.entradas)}</b></span>
                        <span className="text-red-700">Saídas <b className="tabular-nums">{brl(g.saidas)}</b></span>
                        <span className="text-slate-700">Saldo no fim do mês <b className={`tabular-nums ${g.saldoFim < 0 ? 'text-orange-700' : ''}`}>{brl(g.saldoFim)}</b></span>
                      </div>
                    </td>
                  </tr>
                  {!recolhidos.has(g.chave) && g.itens.map((item, idx) => {
                    const classe = classeDe(item);
                    const et = etiquetaDaClasse(classe, rubricasAno);
                    const { origem, texto: obsUsuario } = separarOrigem(item.observation);
                    const aberta = descAberta.has(item.id);
                    return (
                      <tr key={`${item.id}-${idx}`} className={`border-b border-slate-100 hover:bg-slate-50 align-top ${item.isCanceled ? 'bg-slate-100' : ''}`}>
                        <td className="pl-3 pr-1 py-2">
                          {item.type === 'EXIT' && !isReadOnly && <input type="checkbox" aria-label={`Selecionar ${item.documentNumber}`} checked={selecionados.has(item.id)} onChange={() => setSelecionados(alternar(selecionados, item.id))} />}
                        </td>
                        <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">{dataBR(item.date)}</td>
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-900">
                            <span className="text-[13px] whitespace-nowrap">{item.documentNumber}</span>
                            {item.type === 'EXIT' && item.value < 0 ? <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800" title="Anulação parcial: diminui o valor desta NE">ANULAÇÃO</span>
                              : ehReforco(item) && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-sky-100 text-sky-800" title="Aumento do valor desta NE (mesmo empenho)">REFORÇO</span>}
                            {item.isCanceled && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">CANCELADO</span>}
                            {item.type === 'ENTRY' && item.destino === 'OUTROS' && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-700" title="Crédito recebido para outros serviços: não paga fatura">OUTROS SERVIÇOS{item.finalidade ? ` · ${CATEGORIAS.find(c => c.id === item.finalidade)?.rotulo || item.finalidade}` : ''}</span>}
                            {item.type === 'ENTRY' && item.destino === 'ADIANTAMENTO' && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800" title="Valor guardado para faturas futuras">ADIANTAMENTO</span>}
                            {item.type === 'ENTRY' && item.destino === 'PAGAMENTO' && item.aguardando && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800" title="A OM ainda não indicou as faturas: o acompanhamento contábil escolhe em Créditos recebidos">A DESTINAR</span>}
                          </div>
                          <div className={`text-xs text-slate-500 truncate ${item.isCanceled ? 'line-through opacity-60' : ''}`} title={item.client}>{item.client}</div>
                        </td>
                        <td className={`px-2 py-2 text-slate-600 ${item.isCanceled ? 'line-through opacity-60' : ''}`}>
                          {item.description && (
                            <button type="button" onClick={() => setDescAberta(alternar(descAberta, item.id))} aria-expanded={aberta} title={aberta ? 'Recolher o texto' : 'Clique para ler o texto inteiro'}
                              className={`text-left text-xs leading-snug ${aberta ? '' : 'line-clamp-2'}`}>{item.description}</button>
                          )}
                          {obsUsuario && <div className="text-xs italic text-slate-500 mt-0.5">Obs.: {obsUsuario}</div>}
                          {origem && <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500" title={`Importada de ${origem}`}>origem: planilha</span>}
                        </td>
                        <td className="px-2 py-2">
                          {item.type === 'EXIT' ? (
                            isReadOnly
                              ? <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${corEtiqueta[et.cor]}`} title={et.completo}>{et.texto}</span>
                              : (
                                <select aria-label={`Rubrica ou categoria de ${item.documentNumber}`} value={classe} onChange={e => aplicarClasse([item.id], e.target.value)} title={et.completo}
                                  className={`w-full rounded border text-xs font-medium px-1 py-1 ${corEtiqueta[et.cor]}`}>
                                  <option value="">Sem classificação</option>
                                  {opcoesClasse.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                              )
                          ) : (item.destino === 'OUTROS' && item.finalidade
                            ? <span className={`inline-block px-2 py-0.5 rounded border text-xs font-medium ${corEtiqueta[etiquetaDaClasse(item.finalidade).cor]}`}>{etiquetaDaClasse(item.finalidade).texto}</span>
                            : <span className="text-slate-300">—</span>)}
                        </td>
                        <td className="px-2 py-2 text-right text-[13px] font-medium text-green-600 tabular-nums whitespace-nowrap">{item.type === 'ENTRY' ? brl(item.value) : ''}</td>
                        <td className={`px-2 py-2 text-right text-[13px] font-medium tabular-nums whitespace-nowrap ${item.isCanceled ? 'text-slate-400 line-through' : 'text-red-600'}`}>
                          {item.type === 'EXIT' ? (item.value < 0 ? `− ${brl(-item.value)}` : brl(item.value)) : ''}
                        </td>
                        <td className={`px-2 py-2 text-right text-[13px] font-bold tabular-nums whitespace-nowrap ${item.balanceAfter < 0 ? 'text-orange-700' : 'text-slate-700'}`}>{brl(item.balanceAfter)}</td>
                        <td className="px-2 py-2 text-right">
                          {item.type === 'EXIT' && !isReadOnly && (
                            <div className="flex justify-end gap-2">
                              <button onClick={() => handleEdit(item)} className="text-indigo-600 hover:text-indigo-900" aria-label={`Editar ${item.documentNumber}`} title="Editar"><Edit2 size={16} /></button>
                              <button onClick={() => setDeleteId(item.id)} className="text-red-600 hover:text-red-900" aria-label={`Excluir ${item.documentNumber}`} title="Excluir"><Trash2 size={16} /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
              {filteredItems.length === 0 && (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-slate-500">Nenhum lançamento encontrado para os filtros selecionados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ConfirmModal isOpen={confirmaLote} onClose={() => setConfirmaLote(false)} onConfirm={() => aplicarClasse([...selecionados], classeLote)}
        title="Classificar saídas em lote" message={`Vai classificar ${selecionados.size} saída(s) como “${classeLote ? etiquetaDaClasse(classeLote, rubricasAno).completo : ''}”. Nada mais é alterado (valor, data e descrição continuam iguais). Confirmar?`} />

      <Gaveta aberta={isModalOpen} onClose={closeModal} titulo={editingId ? 'Editar saída financeira' : 'Nova saída financeira (empenho/ALTCRED)'}
        rodape={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={closeModal}>Cancelar</Button><Button onClick={handleSaveExit}>Salvar Lançamento</Button></div>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Data" type="date" required value={formData.date || ''} onChange={e => setFormData({ ...formData, date: e.target.value })} disabled={isReadOnly} />
          <Input label="Número Documento" required value={formData.documentNumber || ''} onChange={e => setFormData({ ...formData, documentNumber: e.target.value })} disabled={isReadOnly} />
          <Select label="Tipo Doc" options={[{ label: 'Empenho', value: 'EMPENHO' }, { label: 'ALTCRED', value: 'ALTCRED' }]} value={formData.documentType || ''} onChange={e => setFormData({ ...formData, documentType: e.target.value as any })} disabled={isReadOnly} />
          <Input label="Cliente" required value={formData.client || ''} onChange={e => setFormData({ ...formData, client: e.target.value })} disabled={isReadOnly} />

          <CurrencyInput label="Valor Saída" value={formData.value} onChange={val => setFormData({ ...formData, value: val })} disabled={isReadOnly} />

          <Select label="Rubrica / categoria" value={classe} onChange={e => setClasse(e.target.value)} disabled={isReadOnly}
            options={[
              ...rubricasAno.map(r => ({ label: `${r.numero} — ${r.descricao}`, value: `R${r.numero}` })),
              ...(!rubricasAno.length ? Array.from({ length: 33 }, (_, i) => ({ label: `Rubrica ${i + 1} (condomínio)`, value: `R${i + 1}` })) : []),
              { label: 'Energia', value: 'ENERGIA' }, { label: 'Água e esgoto', value: 'AGUA' }, { label: 'Telefonia', value: 'TELEFONIA' },
              { label: 'Condomínio/diária/viatura (sem rubrica)', value: 'CONDOMINIO' }, { label: 'Material de expediente e limpeza', value: 'EXPEDIENTE' }, { label: 'Outros', value: 'OUTROS' },
            ]} />
          {originalDoForm && (
            <div className="md:col-span-2 p-2 rounded border border-sky-200 bg-sky-50 text-xs text-sky-900" role="note">
              <b>{anulacao ? 'Anulação parcial de empenho' : 'Reforço de empenho'}:</b> a NE {originalDoForm.documentNumber} já foi lançada ({originalDoForm.client || 'sem cliente'}, total atual R$ {totalDaNE(neDoForm).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). {anulacao ? 'Este lançamento diminui o valor da mesma NE — informe só o valor anulado.' : 'Este lançamento aumenta o valor da mesma NE — informe só o valor do reforço.'}
              <label className="flex items-center gap-1.5 mt-1"><input type="checkbox" className="h-3.5 w-3.5 accent-rose-600" checked={anulacao} onChange={e => setAnulacao(e.target.checked)} aria-label="É anulação parcial" /> É anulação parcial (diminui o valor da NE)</label>
              {(!formData.client || !classe) && <button type="button" className="ml-2 underline font-semibold" onClick={() => { setFormData(f => ({ ...f, client: f.client || originalDoForm.client, rubric: f.rubric || originalDoForm.rubric })); if (!classe) setClasse(classeDe(originalDoForm)); }}>usar cliente e rubrica da NE</button>}
            </div>
          )}
          {neInvalida && <p className="md:col-span-2 text-xs text-amber-700">Número fora do padrão da NE: UG (6) + gestão (5) + ano (4) + "NE" + número (6), ex.: 740015000012026NE000122.</p>}
          <div className="md:col-span-2"><Input label="Observação" value={formData.observation || ''} onChange={e => setFormData({ ...formData, observation: e.target.value })} disabled={isReadOnly} /></div>
          <div className="md:col-span-2"><Input label="Descrição" value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} disabled={isReadOnly} /></div>

          {formData.documentType === 'EMPENHO' && (
            <div className="md:col-span-2 p-3 bg-red-50 border border-red-100 rounded">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.isCanceled || false}
                  onChange={e => setFormData({ ...formData, isCanceled: e.target.checked })}
                  className="w-4 h-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                  disabled={isReadOnly}
                />
                <span className="text-red-700 font-medium flex items-center gap-2"><Ban size={16} /> Empenho Cancelado (Não contabilizar no saldo)</span>
              </label>
            </div>
          )}
        </div>
      </Gaveta>


      <ImportarSipladModal aberto={sipladAberto} onClose={() => setSipladAberto(false)} documentos={docsCredito} onGravado={refresh} />
      <Modal isOpen={!!previaNE} onClose={() => setPreviaNE(null)} title={`Prévia da importação de NE — ${previaNE?.arquivo ?? ''}`} maxWidth="max-w-5xl"
        footer={<div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setPreviaNE(null)}>Cancelar</Button>
          <Button onClick={gravarNE} isLoading={gravandoNE} disabled={!previaNE?.itens.some(entraNaGravacao)}>Gravar {previaNE?.itens.filter(entraNaGravacao).length || 0} lançamento(s)</Button>
        </div>}>
        {previaNE && (() => {
          const novas = previaNE.itens.filter(i => i.situacao === 'NOVA');
          const reforcos = previaNE.itens.filter(i => i.situacao === 'REFORCO');
          const anulacoes = previaNE.itens.filter(i => i.situacao === 'ANULACAO');
          const comAviso = novas.filter(i => i.avisos.length).length;
          return (
            <div className="space-y-3 text-sm" aria-label="Prévia das notas de empenho">
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200"><b>{novas.length}</b> nova(s) · R$ {novas.reduce((t, i) => t + i.saida.value, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                {reforcos.length > 0 && <span className="px-2 py-1 rounded bg-sky-50 text-sky-800 border border-sky-200"><b>{reforcos.length}</b> reforço(s) · R$ {reforcos.reduce((t, i) => t + i.saida.value, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                {anulacoes.length > 0 && <span className="px-2 py-1 rounded bg-rose-50 text-rose-800 border border-rose-200"><b>{anulacoes.length}</b> anulação(ões) · − R$ {(-anulacoes.reduce((t, i) => t + i.saida.value, 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                <span className="px-2 py-1 rounded bg-slate-50 text-slate-700 border border-slate-200"><b>{previaNE.itens.length - novas.length - reforcos.length - anulacoes.length}</b> já importada(s) — não serão gravadas de novo</span>
                <span className="px-2 py-1 rounded bg-amber-50 text-amber-800 border border-amber-200"><b>{previaNE.ignoradas.length}</b> linha(s) pulada(s)</span>
                {comAviso > 0 && <span className="px-2 py-1 rounded bg-orange-50 text-orange-800 border border-orange-200"><b>{comAviso}</b> nova(s) com aviso de rubrica</span>}
              </div>
              <div className="max-h-[45vh] overflow-auto border border-slate-200 rounded">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>{['Situação', 'Data', 'Nota de empenho', 'Cliente', 'Rubrica / categoria', 'Valor'].map(x => <th key={x} className={`px-2 py-1.5 ${x === 'Valor' ? 'text-right' : 'text-left'}`}>{x}</th>)}</tr></thead>
                  <tbody>
                    {previaNE.itens.map((i, k) => (
                      <tr key={k} className={`border-t border-slate-100 ${!entraNaGravacao(i) ? 'text-slate-400' : ''}`}>
                        <td className="px-2 py-1 whitespace-nowrap">{i.situacao === 'NOVA' ? <span className="text-emerald-700 font-semibold">nova</span> : i.situacao === 'REFORCO' ? <span className="text-sky-700 font-semibold">reforço</span> : i.situacao === 'ANULACAO' ? <span className="text-rose-700 font-semibold">anulação</span> : i.situacao === 'JA_EXISTE' ? 'já importada' : 'repetida na planilha'}</td>
                        <td className="px-2 py-1 whitespace-nowrap">{dataBR(i.saida.date)}</td>
                        <td className="px-2 py-1 font-mono whitespace-nowrap">{i.saida.documentNumber}</td>
                        <td className="px-2 py-1 max-w-[220px] truncate" title={i.saida.client}>{i.saida.client}</td>
                        <td className="px-2 py-1">{i.saida.rubricaNumero ? `Rubrica ${i.saida.rubricaNumero}` : (i.saida.categoria && rotuloClasse(i.saida.categoria)) || i.saida.categoria || '—'}{i.avisos.map(a => <div key={a} className="text-orange-700">⚠ {a}</div>)}</td>
                        <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${i.saida.value < 0 ? 'text-rose-700' : ''}`}>{i.saida.value < 0 ? '− ' : ''}R$ {Math.abs(i.saida.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    {!previaNE.itens.length && <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400">Nenhuma nota de empenho encontrada na planilha.</td></tr>}
                  </tbody>
                </table>
              </div>
              {previaNE.ignoradas.length > 0 && (
                <details className="border border-amber-200 rounded bg-amber-50 p-2" open={previaNE.ignoradas.length <= 10}>
                  <summary className="cursor-pointer font-semibold text-amber-900">Linhas puladas ({previaNE.ignoradas.length})</summary>
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-900">{previaNE.ignoradas.map((g, k) => <li key={k}>{g.aba}, linha {g.linha}: {g.motivo}</li>)}</ul>
                </details>
              )}
              <p className="text-xs text-slate-500"><b>Reforço</b> = mesmo número de NE com outra data ou valor: aumenta o valor do empenho (não cria empenho novo). <b>Anulação</b> = valor negativo numa NE já lançada: diminui o valor dela (não pode passar do valor da NE). Linha com mesmo número, data e valor de um lançamento existente já foi importada e não é gravada de novo.</p>
            </div>
          );
        })()}
      </Modal>
      <ConfirmModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Excluir Lançamento"
        message="Tem certeza que deseja excluir este lançamento de saída? O saldo será recalculado."
      />
    </div>
  );
};

type AbaFluxo = 'lancamentos' | 'mensal' | 'condominio' | 'disponivel' | 'rubricas';
export const CashFlow: React.FC = () => {
  const { user } = useAuth();
  const [aba, setAba] = useAbaNoEndereco<AbaFluxo>(['lancamentos', 'mensal', 'condominio', 'disponivel', 'rubricas'], 'lancamentos');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Fluxo de Caixa</h2>
        <p className="text-slate-500 text-sm">Seção de Contabilidade de Custos: créditos recebidos × notas de empenho, saldo mensal, condomínio por rubrica e disponível na AI R.901.16.</p>
      </div>
      <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto">
        {([['lancamentos', 'Lançamentos'], ['mensal', 'Saldo mensal'], ['condominio', 'Condomínio por rubrica'], ['disponivel', 'Disponível R.901.16'], ['rubricas', 'Rubricas']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${aba === k ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500'}`}>{l}</button>
        ))}
      </div>
      {aba === 'lancamentos' && <Lancamentos />}
      {aba === 'mensal' && <SaldoMensal />}
      {aba === 'condominio' && <CondominioRubrica />}
      {aba === 'disponivel' && <Disponivel />}
      {aba === 'rubricas' && <Rubricas podeEditar={podeEditarDados(user?.role)} />}
    </div>
  );
};
