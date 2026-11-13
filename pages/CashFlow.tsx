
import { dataBR } from '../utils/datas';
import { BaixarModelo } from '../components/ui/BaixarModelo';
import { modeloNotasEmpenho } from '../utils/modelos';
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { notify } from '../utils/notify';
import { CashFlowItem, CashFlowExit, DocumentType, podeEditarDados } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { salvarSaidas, listarRubricas, listarSaidas, Fase5NaoInstaladaError } from '../services/relatoriosService';
import { PreviaNE, NEExistente, entraNaGravacao, gravarPreviaNE, lerPlanilhaNE, SaldoMensal, CondominioRubrica, Disponivel, Rubricas } from '../components/fluxo/PaineisFluxo';
import * as XLSX from 'xlsx';
import { Rubrica, lerNE } from '../utils/relatorios';
import { Plus, Download, Upload, Filter, FileText, FileSpreadsheet, Edit2, Trash2, Search, X, Ban } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TEMA, cabecalhoCompacto, cabecalhoInstitucional, salvarPdf, tabelaPdf, tituloRelatorio } from '../utils/pdfCabecalho';

const Lancamentos: React.FC = () => {
  const { user } = useAuth();
  const isReadOnly = !podeEditarDados(user?.role);

  const [items, setItems] = useState<CashFlowItem[]>([]);

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
  const neRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    listarRubricas(new Date().getFullYear()).then(setRubricasAno).catch(() => setRubricasAno([]));
    listarSaidas().then(ss => setClasses(new Map(ss.map(x => [x.id, x.rubricaNumero ? `R${x.rubricaNumero}` : x.categoria || ''])))).catch(() => {});
  }, []);
  const classeDe = (item: CashFlowItem) => classes.get(item.id) || '';
  const rotuloClasse = (c: string) => (c.startsWith('R') ? c.slice(1) : ({ ENERGIA: 'Energia', AGUA: 'Água e Esgoto', TELEFONIA: 'Telefonia', CONDOMINIO: 'Condomínio/diária/viatura', OUTROS: 'Outros' } as Record<string, string>)[c] || '');
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
      (item.observation?.toLowerCase().includes(search) ?? false);

    return matchesMonth && matchesYear && matchesType && matchesText;
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
      item.description + (item.rubric ? ` (${item.rubric})` : ''),
      item.observation || '',
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
    const linhas: (string | number)[][] = [['Data', 'Documento', 'Cliente', 'Descrição', 'Rubrica', 'Observação', 'Entrada', 'Saída', 'Saldo acumulado', 'Situação']];
    filteredItems.forEach(item => linhas.push([
      dataBR(item.date), item.documentNumber, item.client, item.description, item.rubric || '', item.observation || '',
      item.type === 'ENTRY' ? item.value : 0, item.type === 'EXIT' && !item.isCanceled ? item.value : 0, item.balanceAfter, item.isCanceled ? 'Anulado' : 'Ativo',
    ]));
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    ws['!cols'] = [11, 26, 32, 40, 14, 30, 14, 14, 16, 10].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Fluxo de caixa');
    XLSX.writeFile(wb, 'fluxo_caixa.xlsx');
  };

  const months = [
    { v: '1', l: 'Janeiro' }, { v: '2', l: 'Fevereiro' }, { v: '3', l: 'Março' }, { v: '4', l: 'Abril' },
    { v: '5', l: 'Maio' }, { v: '6', l: 'Junho' }, { v: '7', l: 'Julho' }, { v: '8', l: 'Agosto' },
    { v: '9', l: 'Setembro' }, { v: '10', l: 'Outubro' }, { v: '11', l: 'Novembro' }, { v: '12', l: 'Dezembro' }
  ];

  return (
    <div className="space-y-6">
      {/* ... (Keep existing header and charts) ... */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <p className="text-slate-500 text-sm">Entradas: ALTCRED recebidas (automáticas); as GRU não entram aqui (ficam na página Extra-Marinha). Saídas: notas de empenho por rubrica ou categoria.</p>
        </div>
        <div className="flex gap-2">
          {!isReadOnly && (
            <>
              <input type="file" ref={neRef} onChange={e => importarPlanilhaNE(e.target.files)} accept=".xlsx,.xls,.ods" className="hidden" />
              <Button variant="secondary" size="sm" onClick={() => neRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Importar NE (planilha)
              </Button>
              <BaixarModelo rotulo="Modelo NE" modelo={() => { const d = new Date(); return modeloNotasEmpenho(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }} />
            </>
          )}
          <Button variant="secondary" size="sm" onClick={exportExcel}>
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={exportPDF}>
            <FileText className="w-4 h-4 mr-2" /> PDF
          </Button>
          {!isReadOnly && (
            <Button onClick={() => { setEditingId(null); setFormData({}); setIsModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Nova Saída
            </Button>
          )}
        </div>
      </div>

      {/* Header Stats (Reactive) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-green-500">
          <p className="text-sm font-medium text-slate-500">Total Entradas (Período)</p>
          <h3 className="text-2xl font-bold text-green-700">R$ {totalEntries.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-red-500">
          <p className="text-sm font-medium text-slate-500">Total Saídas (Período)</p>
          <h3 className="text-2xl font-bold text-red-700">R$ {totalExits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
        <div className={`bg-white p-6 rounded-lg shadow-sm border-l-4 ${accumulatedBalance >= 0 ? 'border-blue-500' : 'border-orange-500'}`}>
          <p className="text-sm font-medium text-slate-500">Saldo Atual (Acumulado no Ano)</p>
          <h3 className={`text-2xl font-bold ${accumulatedBalance >= 0 ? 'text-blue-700' : 'text-orange-700'}`}>R$ {accumulatedBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4 items-end">
        <div className="w-full md:w-1/3">
          <Input
            label="Descrição / Rubrica / Cliente / Obs"
            placeholder="Buscar..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />
        </div>
        <div className="w-full md:w-1/6">
          <Select
            label="Tipo"
            options={[{ label: 'Entrada', value: 'ENTRY' }, { label: 'Saída', value: 'EXIT' }]}
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
          />
        </div>
        <div className="w-full md:w-1/4">
          <Select
            label="Mês"
            options={months.map(m => ({ label: m.l, value: m.v }))}
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
          />
        </div>
        <div className="w-full md:w-1/4">
          <Select
            label="Ano"
            options={availableYears.map(y => ({ label: y, value: y }))}
            value={filterYear}
            onChange={e => setFilterYear(e.target.value)}
          />
        </div>
        <div className="flex items-center pb-2 text-slate-400">
          {(filterText || filterMonth || filterYear || filterType) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterText(''); setFilterMonth(''); setFilterYear(''); setFilterType(''); }}>
              <X className="w-4 h-4 mr-1" /> Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Data</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Doc</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Cliente</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Descrição/Rubrica</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase">Observação</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Entrada</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Saída</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Saldo</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-200">
              {filteredItems.map((item, idx) => (
                <tr key={`${item.id}-${idx}`} className={`hover:bg-slate-50 ${item.isCanceled ? 'bg-slate-100' : ''}`}>
                  <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">{dataBR(item.date)}</td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    {item.documentNumber}
                    {item.type === 'EXIT' && item.value < 0 ? <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-rose-100 text-rose-800" title="Anulação parcial: diminui o valor desta NE">ANULAÇÃO</span>
                      : ehReforco(item) && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-sky-100 text-sky-800" title="Aumento do valor desta NE (mesmo empenho)">REFORÇO</span>}
                    {item.isCanceled && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">CANCELADO</span>}
                  </td>
                  <td className={`px-6 py-4 text-sm text-slate-500 ${item.isCanceled ? 'line-through opacity-60' : ''}`}>{item.client}</td>
                  <td className={`px-6 py-4 text-sm text-slate-500 ${item.isCanceled ? 'line-through opacity-60' : ''}`}>
                    {item.description}
                    {item.rubric && <span className="block text-xs text-slate-400 font-mono">Rubrica: {item.rubric}</span>}
                  </td>
                  <td className={`px-6 py-4 text-sm text-slate-500 ${item.isCanceled ? 'line-through opacity-60' : ''}`}>{item.observation || '-'}</td>

                  <td className="px-6 py-4 text-sm text-right font-medium text-green-600">
                    {item.type === 'ENTRY' ? `R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                  </td>
                  <td className={`px-6 py-4 text-sm text-right font-medium ${item.isCanceled ? 'text-slate-400 line-through' : 'text-red-600'}`}>
                    {item.type === 'EXIT' ? (item.value < 0 ? `− R$ ${(-item.value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : `R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`) : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-right font-bold text-slate-700">R$ {item.balanceAfter.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm text-right">
                    {item.type === 'EXIT' && !isReadOnly && (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => handleEdit(item)} className="text-indigo-600 hover:text-indigo-900"><Edit2 size={16} /></button>
                        <button onClick={() => setDeleteId(item.id)} className="text-red-600 hover:text-red-900"><Trash2 size={16} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-slate-500">Nenhum lançamento encontrado para os filtros selecionados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? "Editar Saída Financeira" : "Nova Saída Financeira (Empenho/ALTCRED)"}
        footer={<div className="flex justify-end gap-2"><Button onClick={handleSaveExit}>Salvar Lançamento</Button></div>}
      >
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
              { label: 'Condomínio/diária/viatura (sem rubrica)', value: 'CONDOMINIO' }, { label: 'Outros', value: 'OUTROS' },
            ]} />
          {originalDoForm && (
            <div className="md:col-span-2 p-2 rounded border border-sky-200 bg-sky-50 text-xs text-sky-900" role="note">
              <b>{anulacao ? 'Anulação parcial de empenho' : 'Reforço de empenho'}:</b> a NE {originalDoForm.documentNumber} já foi lançada ({originalDoForm.client || 'sem cliente'}, total atual R$ {totalDaNE(neDoForm).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). {anulacao ? 'Este lançamento diminui o valor da mesma NE — informe só o valor anulado.' : 'Este lançamento aumenta o valor da mesma NE — informe só o valor do reforço.'}
              <label className="flex items-center gap-1.5 mt-1"><input type="checkbox" className="h-3.5 w-3.5 accent-rose-600" checked={anulacao} onChange={e => setAnulacao(e.target.checked)} aria-label="É anulação parcial" /> É anulação parcial (diminui o valor da NE)</label>
              {(!formData.client || !classe) && <button type="button" className="ml-2 underline font-semibold" onClick={() => { setFormData(f => ({ ...f, client: f.client || originalDoForm.client, rubric: f.rubric || originalDoForm.rubric })); if (!classe) setClasse(classeDe(originalDoForm)); }}>usar cliente e rubrica da NE</button>}
            </div>
          )}
          {neInvalida && <p className="md:col-span-2 text-xs text-amber-700">Número fora do padrão da NE: UG (6) + gestão (5) + ano (4) + "NE" + número (6), ex.: 740015000012026NE000122.</p>}
          <Input label="Observação" className="md:col-span-2" value={formData.observation || ''} onChange={e => setFormData({ ...formData, observation: e.target.value })} disabled={isReadOnly} />
          <Input label="Descrição" className="md:col-span-2" value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} disabled={isReadOnly} />

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
      </Modal>

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
  const [aba, setAba] = useState<AbaFluxo>('lancamentos');
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
