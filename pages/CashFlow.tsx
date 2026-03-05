
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { CashFlowItem, CashFlowExit, DocumentType, UserRole } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Plus, Download, Upload, Filter, FileText, FileSpreadsheet, Edit2, Trash2, Search, X, Ban } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const CashFlow: React.FC = () => {
  const { user } = useAuth();
  const isReadOnly = user?.role === UserRole.READ_ONLY;

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

  // File Import Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => setItems(await db.getCashFlow());
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

    const payload: CashFlowExit = {
      id: editingId || uuidv4(),
      date: formData.date || new Date().toISOString().split('T')[0],
      documentNumber: formData.documentNumber!,
      documentType: (formData.documentType as DocumentType) || DocumentType.EMPENHO,
      client: formData.client || '',
      value: Number(formData.value),
      rubric: formData.rubric || '',
      description: formData.description || '',
      observation: formData.observation || '',
      isCanceled: formData.isCanceled || false,
    };

    await db.saveExit(payload);
    closeModal();
    await refresh();
  };

  const handleEdit = (item: CashFlowItem) => {
    if (isReadOnly) return;
    if (item.type !== 'EXIT') return;
    setFormData({
      date: item.date,
      documentNumber: item.documentNumber,
      documentType: DocumentType.EMPENHO, // Defaulting, ideally we should store precise type in db.ts logic for better reconstruction
      client: item.client,
      value: item.value,
      rubric: item.rubric,
      description: item.description,
      observation: item.observation,
      isCanceled: item.isCanceled
    });
    setEditingId(item.id);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (deleteId && !isReadOnly) {
      await db.deleteExit(deleteId);
      setDeleteId(null);
      await refresh();
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormData({});
    setEditingId(null);
  };

  // ... (Export functions remain unchanged) ...
  const exportPDF = () => {
    const doc = new jsPDF('l');
    doc.text("Relatório de Fluxo de Caixa - SISCONT", 14, 15);
    doc.setFontSize(10);
    doc.text(`Período: ${filterMonth ? filterMonth : 'Todos'}/${filterYear ? filterYear : 'Todos'} | Gerado em: ${new Date().toLocaleDateString()}`, 14, 22);

    const rows = filteredItems.map(item => [
      new Date(item.date).toLocaleDateString(),
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

    autoTable(doc, {
      startY: 25,
      head: [['Data', 'Doc', 'Cliente', 'Descrição/Rubrica', 'Obs', 'Entrada', 'Saída', 'Saldo']],
      body: rows,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] }
    });

    doc.save("fluxo_caixa_siscont.pdf");
  };

  const exportExcel = () => {
    const headers = ["Data", "Documento", "Cliente", "Descrição", "Rubrica", "Observação", "Entrada", "Saída", "Saldo Acumulado", "Status"];
    const csvRows = filteredItems.map(item => {
      const exitValue = item.isCanceled ? '0.00' : item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
      return [
        item.date,
        item.documentNumber,
        `"${item.client}"`,
        `"${item.description}"`,
        `"${item.rubric || ''}"`,
        `"${item.observation || ''}"`,
        item.type === 'ENTRY' ? item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '0.00',
        item.type === 'EXIT' ? exitValue : '0.00',
        item.balanceAfter.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        item.isCanceled ? 'CANCELADO' : 'ATIVO'
      ].join(",");
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...csvRows].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "fluxo_caixa.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnly) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        // Skipping header
        const lines = text.split("\n").slice(1);
        const processImport = async () => {
          for (const line of lines) {
            if (!line.trim()) continue;
            const cols = line.split(",").map(s => s.replace(/"/g, ""));
            if (cols.length >= 5) {
              const payload: CashFlowExit = {
                id: uuidv4(),
                date: cols[0] || new Date().toISOString().split('T')[0],
                documentNumber: cols[1] || 'IMP',
                documentType: DocumentType.EMPENHO,
                client: cols[2] || 'Importado',
                description: cols[3] || 'Importação via CSV',
                rubric: cols[4] || '',
                observation: cols[5] || '',
                value: Number(cols[7]) || 0,
                isCanceled: false
              };
              if (payload.value > 0) await db.saveExit(payload);
            }
          }
          await refresh();
          alert('Importação concluída com sucesso!');
        };
        processImport();
      } catch (err) {
        alert('Erro ao importar arquivo. Verifique o formato CSV.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
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
          <h2 className="text-2xl font-bold text-slate-800">Fluxo de Caixa</h2>
          <p className="text-slate-500">Gestão de entradas e saídas financeiras</p>
        </div>
        <div className="flex gap-2">
          {!isReadOnly && (
            <>
              <input type="file" ref={fileInputRef} onChange={handleImport} accept=".csv" className="hidden" />
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" /> Importar
              </Button>
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
                  <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">{new Date(item.date).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-sm font-medium text-slate-900">
                    {item.documentNumber}
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
                    {item.type === 'EXIT' ? `R$ ${item.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
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

          <Input label="Rubrica" value={formData.rubric || ''} onChange={e => setFormData({ ...formData, rubric: e.target.value })} disabled={isReadOnly} />
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
