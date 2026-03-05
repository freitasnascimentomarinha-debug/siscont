
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { ReceivedDocument, Invoice, PaymentAllocation, DocumentType, OperationType, InvoiceStatus, UserRole } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Plus, Trash2, DollarSign, FileCheck, ChevronDown, ChevronUp, CheckCircle, Search, Edit2, Upload, FileSpreadsheet, FileText, Filter, X, Layers, Save, AlertOctagon, CheckSquare, Square } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const ReceivedBalances: React.FC = () => {
  const { user } = useAuth();
  const isReadOnly = user?.role === UserRole.READ_ONLY;

  const [documents, setDocuments] = useState<ReceivedDocument[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [activeTab, setActiveTab] = useState<OperationType>(OperationType.PAGAMENTO);

  // Filters State
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'with_balance' | 'no_balance'>('all');
  const [filterClient, setFilterClient] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [filterCommand, setFilterCommand] = useState('');
  const [filterDocNumber, setFilterDocNumber] = useState('');
  const [filterUG, setFilterUG] = useState('');

  // Forms & Modals
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [docFormData, setDocFormData] = useState<Partial<ReceivedDocument>>({});
  const [saveError, setSaveError] = useState<string | null>(null); // New: Validation Error State

  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<ReceivedDocument | null>(null);

  // Edit Allocation Modal
  const [isEditAllocModalOpen, setIsEditAllocModalOpen] = useState(false);
  const [allocFormData, setAllocFormData] = useState<Partial<PaymentAllocation>>({});

  const [editingId, setEditingId] = useState<string | null>(null);

  // Import
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Payment Allocation Form
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [paymentMeta, setPaymentMeta] = useState({
    siscontSettled: false,
    siscontDueDate: '',
    observation: '',
    serviceType: ''
  });

  // Pay Modal Filter
  const [invoiceSearch, setInvoiceSearch] = useState('');

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'doc' | 'alloc', id: string } | null>(null);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  // Clients for Autofill
  const [clients, setClients] = useState<any[]>([]);

  const refresh = async () => {
    const [docs, invs, allocs, clist] = await Promise.all([
      db.getDocuments(),
      db.getInvoices(),
      db.getAllocations(),
      db.getClients()
    ]);
    setDocuments(docs);
    setInvoices(invs);
    setAllocations(allocs);
    setClients(clist);
  };

  useEffect(() => { refresh(); }, []);

  // --- Auto-fill Service Type when selecting invoice ---
  useEffect(() => {
    if (selectedInvoiceIds.length > 0) {
      // Find the last selected invoice to determine type
      const lastId = selectedInvoiceIds[selectedInvoiceIds.length - 1];
      const inv = invoices.find(i => i.id === lastId);
      if (inv) {
        setPaymentMeta(prev => ({ ...prev, serviceType: inv.type }));
      }
    }
  }, [selectedInvoiceIds, invoices]);

  // --- Auto-fill UG Logic ---
  const handleUgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDocFormData(prev => {
      const newState = { ...prev, ug: val };
      const match = clients.find(c => c.ug === val);
      if (match) {
        newState.client = match.name;
        newState.sector = match.sector;
        newState.command = match.command;
      }
      return newState;
    });
  };

  // --- Filtering Logic ---
  const filteredDocs = documents.filter(d => {
    // 1. Tab Filter
    if (d.operation !== activeTab) return false;

    // 2. Date Filter
    const dDate = new Date(d.date);
    const month = (dDate.getMonth() + 1).toString();
    const year = dDate.getFullYear().toString();
    if (filterMonth && month !== filterMonth) return false;
    if (filterYear && year !== filterYear) return false;

    // 3. Status Filter
    if (filterStatus === 'with_balance' && d.availableValue <= 0) return false;
    if (filterStatus === 'no_balance' && d.availableValue > 0) return false;

    // 4. Text Filters
    if (filterClient && !d.client.toLowerCase().includes(filterClient.toLowerCase())) return false;
    if (filterSector && !d.sector.toLowerCase().includes(filterSector.toLowerCase())) return false;
    if (filterCommand && !d.command.toLowerCase().includes(filterCommand.toLowerCase())) return false;
    if (filterDocNumber && !d.documentNumber.toLowerCase().includes(filterDocNumber.toLowerCase())) return false;
    if (filterUG && !(d.ug || '').toLowerCase().includes(filterUG.toLowerCase())) return false;

    return true;
  });

  // --- Header Stats Calculations ---
  const stats = {
    count: filteredDocs.length,
    countWithBalance: filteredDocs.filter(d => d.availableValue > 0).length,
    totalValue: filteredDocs.reduce((acc, d) => acc + d.totalValue, 0),
    totalAvailable: filteredDocs.reduce((acc, d) => acc + d.availableValue, 0)
  };

  // --- Grouping Logic (Sector > Command > Client) ---
  const groupedDocs = filteredDocs.reduce((acc, doc) => {
    const sector = doc.sector || 'Sem Setor';
    const command = doc.command || 'Sem Comando';
    const client = doc.client || 'Sem Cliente';

    if (!acc[sector]) acc[sector] = {};
    if (!acc[sector][command]) acc[sector][command] = {};
    if (!acc[sector][command][client]) acc[sector][command][client] = [];

    acc[sector][command][client].push(doc);
    return acc;
  }, {} as Record<string, Record<string, Record<string, ReceivedDocument[]>>>);

  // --- Actions ---

  const handleEdit = (doc: ReceivedDocument) => {
    if (isReadOnly) return;
    setEditingId(doc.id);
    setDocFormData(doc);
    setSaveError(null);
    setIsDocModalOpen(true);
  };

  const handleSaveDoc = async () => {
    if (isReadOnly) return;
    setSaveError(null);
    if (!docFormData.client || !docFormData.totalValue || !docFormData.documentNumber) return;

    // --- Validation: Check for duplicate document number ---
    const isDuplicate = documents.some(d =>
      d.documentNumber.trim().toUpperCase() === docFormData.documentNumber?.trim().toUpperCase() &&
      d.id !== (editingId || '') // Ignore self if editing
    );

    if (isDuplicate) {
      setSaveError(`IMPEDIMENTO: O número de documento "${docFormData.documentNumber}" já está cadastrado no sistema.`);
      return;
    }

    const type = (docFormData.documentType as DocumentType) || DocumentType.ALTCRED;

    const payload: ReceivedDocument = {
      id: editingId || uuidv4(),
      ug: docFormData.ug || '',
      sector: docFormData.sector || '',
      command: docFormData.command || '',
      client: docFormData.client!,
      documentNumber: docFormData.documentNumber!,
      documentType: type,
      totalValue: Number(docFormData.totalValue),
      availableValue: editingId ? (docFormData.availableValue || 0) : Number(docFormData.totalValue),
      date: docFormData.date || new Date().toISOString().split('T')[0],
      informedAdvance: false,
      operation: (docFormData.operation as OperationType) || OperationType.PAGAMENTO,
      observation: docFormData.observation || ''
    };

    await db.saveDocument(payload);
    setIsDocModalOpen(false);
    setDocFormData({});
    setEditingId(null);
    setSaveError(null);
    await refresh();
  };

  const handleAllocate = async () => {
    if (isReadOnly) return;
    if (!activeDoc || selectedInvoiceIds.length === 0) return;

    let currentBalance = activeDoc.availableValue;

    for (const invId of selectedInvoiceIds) {
      const inv = invoices.find(i => i.id === invId);
      if (!inv || currentBalance <= 0) continue;

      const invAllocations = allocations.filter(a => a.invoiceId === inv.id);
      const totalUsed = invAllocations.reduce((sum, a) => sum + a.amount, 0);
      const targetValue = inv.value + (inv.adjustmentAddition || 0) - (inv.adjustmentDeduction || 0);
      const debt = Math.max(0, targetValue - totalUsed);

      const payment = Math.min(debt, currentBalance);

      if (payment > 0.005) {
        await db.saveAllocation({
          id: uuidv4(),
          documentId: activeDoc.id,
          invoiceId: inv.id,
          amount: payment,
          date: new Date().toISOString().split('T')[0],
          siscontSettled: paymentMeta.siscontSettled,
          siscontDueDate: paymentMeta.siscontDueDate,
          observation: paymentMeta.observation,
          serviceType: paymentMeta.serviceType
        });
        currentBalance -= payment;
      }
    }

    setIsPayModalOpen(false);
    setSelectedInvoiceIds([]);
    await refresh();
  };

  const handleUpdateAllocation = async () => {
    if (isReadOnly) return;
    if (allocFormData.id && allocFormData.amount) {
      const original = allocations.find(a => a.id === allocFormData.id);
      if (original) {
        await db.saveAllocation({
          ...original,
          ...allocFormData,
          amount: Number(allocFormData.amount)
        } as PaymentAllocation);
      }
      setIsEditAllocModalOpen(false);
      setAllocFormData({});
      await refresh();
    }
  };

  const getDocAllocations = (docId: string) => {
    return allocations.filter(a => a.documentId === docId).map(a => {
      const inv = invoices.find(i => i.id === a.invoiceId);
      return { ...a, invoiceNumber: inv?.invoiceNumber, invoiceValue: inv?.value, invoiceClient: inv?.client };
    });
  };

  const openInvoices = invoices.filter(i => i.status !== InvoiceStatus.PAID);

  // --- Import/Export ---
  const exportPDF = () => {
    const doc = new jsPDF('l');
    doc.text("Relatório de Saldos Recebidos e Histórico - SISCONT", 14, 15);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleDateString()}`, 14, 22);

    const bodyRows: any[] = [];

    // Ordered: Data > Setor > Comando > Cliente > Nº Doc > Operação > Valor Total > Saldo Disp.
    filteredDocs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(d => {
      // Main Row
      bodyRows.push([
        new Date(d.date).toLocaleDateString(),
        d.sector,
        d.command,
        d.client,
        d.documentNumber,
        d.operation,
        `R$ ${d.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `R$ ${d.availableValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      ]);

      // History Rows (Allocations)
      const docAllocs = allocations.filter(a => a.documentId === d.id);
      if (docAllocs.length > 0) {
        docAllocs.forEach(a => {
          const inv = invoices.find(i => i.id === a.invoiceId);
          bodyRows.push([
            { content: `-> Pgto Fatura: ${inv?.invoiceNumber || '?'} (${inv?.competence}) | Vl Pago: R$ ${a.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, colSpan: 8, styles: { fillColor: [248, 250, 252], textColor: [100, 116, 139], fontStyle: 'italic' } }
          ]);
        });
      }
    });

    const footer = [
      'TOTAL', '', '', '', '', '',
      `R$ ${stats.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `R$ ${stats.totalAvailable.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ];

    autoTable(doc, {
      startY: 25,
      head: [['Data', 'Setor', 'Comando', 'Cliente', 'Nº Doc', 'Operação', 'Valor Total', 'Saldo Disp.']],
      body: bodyRows,
      foot: [footer],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
      footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold' }
    });

    doc.save("saldos_recebidos_historico.pdf");
  };

  const exportExcel = () => {
    // Columns: Data > Setor > Comando > Cliente > Nº Doc > Operação > Valor Total > Saldo Disp. > Histórico (Fatura) > Valor Pago
    const headers = ["Data", "Setor", "Comando", "Cliente", "Nº Doc", "Operação", "Valor Total", "Saldo Disponível", "Fatura Vinculada", "Valor Pago"];

    const csvRows: string[] = [];

    filteredDocs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach(d => {
      const docBase = [
        d.date,
        `"${d.sector}"`,
        `"${d.command}"`,
        `"${d.client}"`,
        d.documentNumber,
        d.operation,
        d.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        d.availableValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
      ];

      const docAllocs = allocations.filter(a => a.documentId === d.id);

      if (docAllocs.length === 0) {
        // Row without history
        csvRows.push([...docBase, "", ""].join(","));
      } else {
        // Rows for each allocation
        docAllocs.forEach(a => {
          const inv = invoices.find(i => i.id === a.invoiceId);
          csvRows.push([
            ...docBase,
            `"Fat: ${inv?.invoiceNumber || 'N/A'}"`,
            a.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })
          ].join(","));
        });
      }
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...csvRows].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "saldos_recebidos_detalhado.csv");
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
        const lines = text.split("\n").slice(1);
        const processImport = async () => {
          for (const line of lines) {
            if (!line.trim()) continue;
            const cols = line.split(",").map(s => s.replace(/"/g, ""));
            if (cols.length >= 8) {
              const payload: ReceivedDocument = {
                id: uuidv4(),
                documentNumber: cols[0] || 'S/N',
                ug: cols[1] || '',
                operation: (cols[2] as OperationType) || OperationType.PAGAMENTO,
                date: cols[3] || new Date().toISOString().split('T')[0],
                documentType: (cols[4] as DocumentType) || DocumentType.ALTCRED,
                sector: cols[5] || 'Geral',
                command: cols[6] || 'Geral',
                client: cols[7] || 'Importado',
                totalValue: Number(cols[8]) || 0,
                availableValue: Number(cols[8]) || 0, // Assume full balance on import
                informedAdvance: false
              };
              await db.saveDocument(payload);
            }
          }
          await refresh();
          alert('Importação concluída com sucesso!');
        };
        processImport();
      } catch (err) {
        alert('Erro ao importar. Verifique o CSV.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Helper for Year options
  const years = Array.from(new Set(documents.map(d => d.date.substring(0, 4)))).sort((a: string, b: string) => b.localeCompare(a));
  if (years.length === 0) years.push(new Date().getFullYear().toString());

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Saldos Recebidos (Entradas)</h2>
          <p className="text-slate-500">Gestão de Créditos, GRUs e Adiantamentos</p>
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
            <Button onClick={() => { setEditingId(null); setDocFormData({}); setSaveError(null); setIsDocModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Novo Documento
            </Button>
          )}
        </div>
      </div>

      {/* Stats Header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-semibold">Total Documentos</p>
          <p className="text-xl font-bold text-slate-800">{stats.count}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-semibold">Com Saldo Disponível</p>
          <p className="text-xl font-bold text-green-600">{stats.countWithBalance}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-semibold">Valor Total Recebido</p>
          <p className="text-xl font-bold text-blue-600">R$ {stats.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 uppercase font-semibold">Valor Disponível</p>
          <p className="text-xl font-bold text-emerald-600">R$ {stats.totalAvailable.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
        </div>
      </div>

      {/* Filters Area */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 space-y-3">
        <div className="flex items-center gap-2 text-slate-700 font-medium mb-1">
          <Filter size={16} /> Filtros Avançados
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Select label="Mês" value={filterMonth} onChange={e => setFilterMonth(e.target.value)} options={[{ v: '1', l: 'Janeiro' }, { v: '2', l: 'Fevereiro' }, { v: '3', l: 'Março' }, { v: '4', l: 'Abril' }, { v: '5', l: 'Maio' }, { v: '6', l: 'Junho' }, { v: '7', l: 'Julho' }, { v: '8', l: 'Agosto' }, { v: '9', l: 'Setembro' }, { v: '10', l: 'Outubro' }, { v: '11', l: 'Novembro' }, { v: '12', l: 'Dezembro' }].map(m => ({ label: m.l, value: m.v }))} />
          <Select label="Ano" value={filterYear} onChange={e => setFilterYear(e.target.value)} options={years.map(y => ({ label: y, value: y }))} />
          <Select label="Status" value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} options={[{ label: 'Todos', value: 'all' }, { label: 'Com Saldo', value: 'with_balance' }, { label: 'Sem Saldo', value: 'no_balance' }]} />
          <Input label="UG" value={filterUG} onChange={e => setFilterUG(e.target.value)} placeholder="Buscar UG..." />
          <Input label="Setor" value={filterSector} onChange={e => setFilterSector(e.target.value)} placeholder="Buscar Setor..." />
          <Input label="Comando" value={filterCommand} onChange={e => setFilterCommand(e.target.value)} placeholder="Buscar Comando..." />
          <Input label="Cliente" value={filterClient} onChange={e => setFilterClient(e.target.value)} placeholder="Buscar Cliente..." />
          <Input label="Nº Doc" value={filterDocNumber} onChange={e => setFilterDocNumber(e.target.value)} placeholder="Buscar Nº..." />
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => {
            setFilterMonth(''); setFilterYear(''); setFilterStatus('all'); setFilterUG(''); setFilterSector(''); setFilterCommand(''); setFilterClient(''); setFilterDocNumber('');
          }}>
            <X size={14} className="mr-1" /> Limpar Filtros
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-slate-200">
        {[OperationType.PAGAMENTO, OperationType.ADIANTAMENTO, OperationType.OUTROS].map((op) => (
          <button
            key={op}
            onClick={() => setActiveTab(op)}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === op
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            {op === OperationType.OUTROS ? 'Outros' : op.charAt(0) + op.slice(1).toLowerCase() + 's'}
          </button>
        ))}
      </div>

      {/* Hierarchical List: Sector > Command > Client > Documents */}
      <div className="space-y-6">
        {Object.keys(groupedDocs).sort().map(sector => (
          <div key={sector} className="space-y-4">
            <h3 className="text-lg font-bold text-slate-800 border-b border-slate-300 pb-1 flex items-center">
              <span className="w-2 h-6 bg-slate-800 rounded mr-2"></span> Setor: {sector}
            </h3>

            {Object.keys(groupedDocs[sector]).sort().map(command => (
              <div key={command} className="pl-4 border-l-2 border-slate-200 ml-1 space-y-4">
                <h4 className="text-md font-semibold text-slate-600 uppercase tracking-wide">Comando: {command}</h4>

                {Object.keys(groupedDocs[sector][command]).sort().map(client => (
                  <div key={client} className="pl-4 space-y-2">
                    <h5 className="text-sm font-bold text-primary-700">Cliente: {client}</h5>

                    <div className="grid grid-cols-1 gap-4">
                      {groupedDocs[sector][command][client]
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                        .map(doc => (
                          <div key={doc.id} className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
                            <div className="p-4 flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-50">
                              {/* Doc Info */}
                              <div className="flex items-center gap-4 flex-1">
                                <div className={`p-2 rounded-full ${doc.documentType === DocumentType.GRU ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600'}`}>
                                  <FileCheck size={20} />
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h4 className="font-bold text-slate-900">{doc.documentNumber}</h4>
                                    <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-600">{doc.documentType}</span>
                                    {doc.ug && <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700">UG: {doc.ug}</span>}
                                  </div>
                                  <p className="text-sm text-slate-500">{new Date(doc.date).toLocaleDateString()} - {doc.client}</p>
                                </div>
                              </div>

                              {/* Values */}
                              <div className="flex items-center gap-8">
                                <div className="text-right">
                                  <p className="text-xs text-slate-400 uppercase">Valor Total</p>
                                  <p className="font-semibold text-slate-700">R$ {doc.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-xs text-slate-400 uppercase">Disponível</p>
                                  <p className={`font-bold ${doc.availableValue > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    R$ {doc.availableValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </p>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex items-center gap-2">
                                {!isReadOnly && (
                                  <button onClick={() => handleEdit(doc)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-full" title="Editar">
                                    <Edit2 size={18} />
                                  </button>
                                )}
                                <button
                                  onClick={() => setExpandedDocId(expandedDocId === doc.id ? null : doc.id)}
                                  className="p-2 text-slate-400 hover:bg-slate-100 rounded-full"
                                  title="Ver Detalhes"
                                >
                                  {expandedDocId === doc.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                                </button>
                              </div>
                            </div>

                            {/* Collapsible Details */}
                            {expandedDocId === doc.id && (
                              <div className="p-4 border-t border-slate-100 bg-white animate-fadeIn">
                                <div className="flex justify-between items-center mb-4">
                                  <h5 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <Layers size={14} /> Histórico de Uso
                                  </h5>
                                  {!isReadOnly && (
                                    <div className="flex gap-2">
                                      <Button size="sm" variant="danger" onClick={() => setConfirmDelete({ type: 'doc', id: doc.id })}>
                                        <Trash2 className="w-3 h-3 mr-1" /> Excluir
                                      </Button>
                                      {activeTab === OperationType.PAGAMENTO && doc.availableValue > 0 && (
                                        <Button size="sm" onClick={() => { setActiveDoc(doc); setIsPayModalOpen(true); setSelectedInvoiceIds([]); setInvoiceSearch(''); }}>
                                          <DollarSign className="w-3 h-3 mr-1" /> Pagar Faturas
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {doc.observation && (
                                  <div className="mb-4 text-sm text-slate-600 bg-slate-50 p-2 rounded border border-slate-100">
                                    <strong>Obs:</strong> {doc.observation}
                                  </div>
                                )}

                                <div className="overflow-x-auto">
                                  <table className="min-w-full text-sm">
                                    <thead>
                                      <tr className="bg-slate-50 text-slate-500">
                                        <th className="px-3 py-2 text-left">Fatura</th>
                                        <th className="px-3 py-2 text-left">Tipo de Serviço</th>
                                        <th className="px-3 py-2 text-left">Valor Doc.</th>
                                        <th className="px-3 py-2 text-left">Valor Pago</th>
                                        <th className="px-3 py-2 text-right">Ações</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {getDocAllocations(doc.id).map(alloc => (
                                        <tr key={alloc.id}>
                                          <td className="px-3 py-2">
                                            <div className="font-medium text-slate-800">{alloc.invoiceNumber}</div>
                                            <div className="text-xs text-slate-400">{alloc.invoiceClient}</div>
                                          </td>
                                          <td className="px-3 py-2 text-slate-600">{alloc.serviceType || '-'}</td>
                                          <td className="px-3 py-2 text-slate-500">R$ {alloc.invoiceValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                          <td className="px-3 py-2 font-medium text-emerald-600">R$ {alloc.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                          <td className="px-3 py-2 text-right">
                                            {!isReadOnly && (
                                              <div className="flex justify-end items-center gap-2">
                                                <button onClick={() => { setAllocFormData(alloc); setIsEditAllocModalOpen(true); }} className="text-blue-500 hover:text-blue-700" title="Editar Pagamento">
                                                  <Edit2 size={14} />
                                                </button>

                                                <button onClick={() => setConfirmDelete({ type: 'alloc', id: alloc.id })} className="text-red-500 hover:text-red-700" title="Excluir Pagamento">
                                                  <Trash2 size={14} />
                                                </button>
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                      {getDocAllocations(doc.id).length === 0 && (
                                        <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400 italic">Nenhum uso registrado.</td></tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}

        {Object.keys(groupedDocs).length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg border border-slate-200 text-slate-500">
            <Search size={48} className="mx-auto mb-4 text-slate-300" />
            <p>Nenhum documento encontrado para os filtros selecionados.</p>
          </div>
        )}
      </div>

      {/* Modal - Doc Create/Edit */}
      <Modal
        isOpen={isDocModalOpen}
        onClose={() => { setIsDocModalOpen(false); setEditingId(null); setDocFormData({}); setSaveError(null); }}
        title={editingId ? "Editar Documento" : "Novo Documento"}
        maxWidth="max-w-3xl"
        footer={<div className="flex justify-end gap-2"><Button onClick={handleSaveDoc}>Salvar</Button></div>}
      >
        {saveError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-start gap-2 text-red-700">
            <AlertOctagon size={20} className="shrink-0 mt-0.5" />
            <span className="font-semibold text-sm">{saveError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Operação"
            required
            options={[
              { label: 'Pagamento', value: OperationType.PAGAMENTO },
              { label: 'Adiantamento', value: OperationType.ADIANTAMENTO },
              { label: 'Outros', value: OperationType.OUTROS }
            ]}
            value={docFormData.operation || ''}
            onChange={e => setDocFormData({ ...docFormData, operation: e.target.value as any })}
          />
          <Select label="Tipo Documento" required options={[{ label: 'ALTCRED', value: 'ALTCRED' }, { label: 'GRU', value: 'GRU' }]} value={docFormData.documentType || ''} onChange={e => setDocFormData({ ...docFormData, documentType: e.target.value as any })} />

          <Input label="Número Documento" required value={docFormData.documentNumber || ''} onChange={e => setDocFormData({ ...docFormData, documentNumber: e.target.value })} />

          <CurrencyInput label="Valor Total" value={docFormData.totalValue} onChange={val => setDocFormData({ ...docFormData, totalValue: val })} />

          <Input label="Data" type="date" required value={docFormData.date || ''} onChange={e => setDocFormData({ ...docFormData, date: e.target.value })} />

          <Input label="UG (Unidade Gestora)" value={docFormData.ug || ''} onChange={handleUgChange} placeholder="Ex: 789000 (Auto-preenchimento)" />

          <Input label="Cliente" required value={docFormData.client || ''} onChange={e => setDocFormData({ ...docFormData, client: e.target.value })} />
          <Input label="Setor" required value={docFormData.sector || ''} onChange={e => setDocFormData({ ...docFormData, sector: e.target.value })} />
          <Input label="Comando" required value={docFormData.command || ''} onChange={e => setDocFormData({ ...docFormData, command: e.target.value })} />

          <Input label="Observação" className="md:col-span-2" value={docFormData.observation || ''} onChange={e => setDocFormData({ ...docFormData, observation: e.target.value })} />
        </div>
      </Modal>

      {/* Pay Modal */}
      <Modal
        isOpen={isPayModalOpen}
        onClose={() => setIsPayModalOpen(false)}
        title={`Pagar Faturas (Disp: R$ ${activeDoc?.availableValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`}
        footer={<div className="flex justify-end gap-2"><Button onClick={handleAllocate}>Confirmar Pagamento</Button></div>}
      >
        <div className="space-y-4">
          <Input
            placeholder="Filtrar por Cliente ou Número da Fatura..."
            value={invoiceSearch}
            onChange={e => setInvoiceSearch(e.target.value)}
            className="mb-2"
          />
          <div className="max-h-60 overflow-y-auto border rounded p-2">
            <label className="text-sm font-semibold text-slate-700 block mb-2">Selecione as Faturas</label>
            {openInvoices
              .filter(inv => {
                if (!invoiceSearch) return true;
                const search = invoiceSearch.toLowerCase();
                return inv.client.toLowerCase().includes(search) || inv.invoiceNumber.toLowerCase().includes(search);
              })
              .map(inv => {
                // Determine Real Debt: (Total Invoice Value) - (All Allocations related to this invoice)
                const invAllocations = allocations.filter(a => a.invoiceId === inv.id);
                const totalAllocated = invAllocations.reduce((sum, a) => sum + a.amount, 0);
                const target = inv.value + (inv.adjustmentAddition || 0) - (inv.adjustmentDeduction || 0);
                const debt = Math.max(0, target - totalAllocated);

                if (debt < 0.01) return null; // Don't show fully paid invoices

                return (
                  <div key={inv.id} className="flex items-center gap-2 p-1 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                    <input
                      type="checkbox"
                      checked={selectedInvoiceIds.includes(inv.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedInvoiceIds([...selectedInvoiceIds, inv.id]);
                        else setSelectedInvoiceIds(selectedInvoiceIds.filter(id => id !== inv.id));
                      }}
                    />
                    <div className="flex flex-col text-sm">
                      <span className="font-medium text-slate-800">{inv.client} - {inv.invoiceNumber}</span>
                      <span className="text-xs text-slate-500">
                        Aberto: <span className="font-bold text-red-600">R$ {debt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span> | {inv.type}
                      </span>
                    </div>
                  </div>
                );
              })}
            {openInvoices.length === 0 && <p className="text-center text-sm text-slate-400 py-4">Nenhuma fatura em aberto.</p>}
          </div>

          <div className="p-3 bg-slate-50 rounded border border-slate-200 space-y-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase">Tipo de Serviço</h4>
            <Input label="Tipo de Serviço" value={paymentMeta.serviceType} onChange={e => setPaymentMeta({ ...paymentMeta, serviceType: e.target.value })} />
            <div className="flex items-center gap-2">
              <input type="checkbox" id="settled" checked={paymentMeta.siscontSettled} onChange={e => setPaymentMeta({ ...paymentMeta, siscontSettled: e.target.checked })} />
              <label htmlFor="settled" className="text-sm text-slate-700">Quitado no Siplad?</label>
            </div>
            <Input label="Vencimento Siplad" type="date" value={paymentMeta.siscontDueDate} onChange={e => setPaymentMeta({ ...paymentMeta, siscontDueDate: e.target.value })} />
            <Input label="Observação" value={paymentMeta.observation} onChange={e => setPaymentMeta({ ...paymentMeta, observation: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* Edit Allocation Modal */}
      <Modal
        isOpen={isEditAllocModalOpen}
        onClose={() => setIsEditAllocModalOpen(false)}
        title="Editar Pagamento"
        footer={<div className="flex justify-end gap-2"><Button onClick={handleUpdateAllocation}>Salvar Alterações</Button></div>}
      >
        <div className="space-y-3">
          <CurrencyInput label="Valor do Pagamento" value={allocFormData.amount} onChange={val => setAllocFormData({ ...allocFormData, amount: val })} />
          <Input label="Tipo de Serviço" value={allocFormData.serviceType || ''} onChange={e => setAllocFormData({ ...allocFormData, serviceType: e.target.value })} />
          <Input label="Data Venc. Siplad" type="date" value={allocFormData.siscontDueDate || ''} onChange={e => setAllocFormData({ ...allocFormData, siscontDueDate: e.target.value })} />
          <Input label="Observação" value={allocFormData.observation || ''} onChange={e => setAllocFormData({ ...allocFormData, observation: e.target.value })} />

          <div className="flex items-center gap-2 pt-2">
            <input type="checkbox" id="editSettled" checked={allocFormData.siscontSettled || false} onChange={e => setAllocFormData({ ...allocFormData, siscontSettled: e.target.checked })} />
            <label htmlFor="editSettled" className="text-sm text-slate-700">Quitado no Siplad?</label>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete?.type === 'doc') await db.deleteDocument(confirmDelete.id);
          else if (confirmDelete?.type === 'alloc') await db.deleteAllocation(confirmDelete.id);
          await refresh();
          setConfirmDelete(null);
        }}
        title="Confirmação de Segurança"
        message="Tem certeza que deseja continuar? Esta ação afetará saldos e status das faturas permanentemente."
      />
    </div>
  );
};
