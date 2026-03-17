
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { Invoice, InvoiceStatus, OperationType, ReceivedDocument, PaymentAllocation, UserRole } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Plus, Edit2, Trash2, AlertTriangle, CheckCircle, Clock, Filter, X, Ban, FileText, Printer, FileSpreadsheet, Upload, ChevronDown, ChevronUp, Search, AlertOctagon, Calculator, LayoutList, Network, FileCheck } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// --- Helper Types for the Analytical Map ---
type AnalyticalNode = {
  id: string;
  name: string;
  type: 'sector' | 'command' | 'client' | 'invoice' | 'credit'; // Added 'credit'
  grossDebt: number;
  availableCredit: number;
  netValue: number; // Max(0, grossDebt - availableCredit) for summaries
  children: AnalyticalNode[];
  isExpanded: boolean;
  data?: any; // Invoice or Document
};

export const Invoices: React.FC = () => {
  const { user } = useAuth();
  const isReadOnly = user?.role === UserRole.READ_ONLY;

  // Navigation State
  const [activeTab, setActiveTab] = useState<'list' | 'map'>('list');

  // Data State
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [advanceDocs, setAdvanceDocs] = useState<ReceivedDocument[]>([]);
  const [allDocs, setAllDocs] = useState<ReceivedDocument[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);

  // UI State
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedMapNodes, setExpandedMapNodes] = useState<Record<string, boolean>>({});

  // Modals & Forms
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Invoice>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Multiple Advance Deduction State
  const [selectedAdvances, setSelectedAdvances] = useState<string[]>([]);
  const [advanceSearchText, setAdvanceSearchText] = useState('');

  // Import Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters
  const [filterType, setFilterType] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSiplad, setFilterSiplad] = useState('');

  // Master Data
  const [services, setServices] = useState<{ label: string, value: string, acronym: string, unit: string }[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  const refresh = async () => {
    const [invs, allocs, docs, svcs, clist] = await Promise.all([
      db.getInvoices(),
      db.getAllocations(),
      db.getDocuments(),
      db.getServices(),
      db.getClients()
    ]);

    setInvoices(invs);
    setAllocations(allocs);
    setAllDocs(docs);
    setAdvanceDocs(docs.filter(d => d.operation === OperationType.ADIANTAMENTO));
    setServices(svcs.map(s => ({
      label: s.name,
      value: s.name,
      acronym: s.acronym,
      unit: s.unitMeasure
    })));
    setClients(clist);
  };

  useEffect(() => { refresh(); }, []);

  // --- MAPA ANALÍTICO LOGIC ---

  const toggleMapNode = (id: string) => {
    setExpandedMapNodes(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const analyticalData = useMemo(() => {
    // 1. Filter Active Open/Overdue Invoices
    const activeInvoices = invoices.filter(i =>
      !i.isCanceled &&
      (i.status === InvoiceStatus.OPEN || i.status === InvoiceStatus.OVERDUE)
    );

    // 2. Filter Available Credits (Documents with Balance)
    const availableCredits = allDocs.filter(d => d.availableValue > 0.005);

    // 3. Build Hierarchy Tree
    const tree: Record<string, any> = {};

    // Helper to initialize structure
    const initPath = (sector: string, command: string, client: string) => {
      if (!tree[sector]) tree[sector] = { debt: 0, credit: 0, commands: {} };
      if (!tree[sector].commands[command]) tree[sector].commands[command] = { debt: 0, credit: 0, clients: {} };
      if (!tree[sector].commands[command].clients[client]) tree[sector].commands[command].clients[client] = { debt: 0, credit: 0, invoices: [], credits: [] };
    };

    // Populate with Invoices (Debts)
    activeInvoices.forEach(inv => {
      const sector = inv.sector || 'Sem Setor';
      const command = inv.command || 'Sem Comando';
      const client = inv.client;
      const debt = inv.value + (inv.adjustmentAddition || 0) - (inv.adjustmentDeduction || 0) - inv.paidAmount;

      if (debt <= 0.005) return;

      initPath(sector, command, client);

      tree[sector].debt += debt;
      tree[sector].commands[command].debt += debt;
      tree[sector].commands[command].clients[client].debt += debt;

      tree[sector].commands[command].clients[client].invoices.push({
        ...inv,
        currentDebt: debt
      });
    });

    // Populate with Credits
    availableCredits.forEach(doc => {
      const sector = doc.sector || 'Sem Setor';
      const command = doc.command || 'Sem Comando';
      const client = doc.client;
      const credit = doc.availableValue;

      // Initialize path even if no debt exists, so we see the credit surplus
      initPath(sector, command, client);

      tree[sector].credit += credit;
      tree[sector].commands[command].credit += credit;
      tree[sector].commands[command].clients[client].credit += credit;

      tree[sector].commands[command].clients[client].credits.push({
        ...doc
      });
    });

    // Convert to Array and Sort
    const sectors: AnalyticalNode[] = Object.keys(tree).sort().map(secKey => {
      const secData = tree[secKey];

      const commands: AnalyticalNode[] = Object.keys(secData.commands).sort().map(cmdKey => {
        const cmdData = secData.commands[cmdKey];

        const clientsList: AnalyticalNode[] = Object.keys(cmdData.clients).sort().map(cliKey => {
          const cliData = cmdData.clients[cliKey];

          const invoiceNodes: AnalyticalNode[] = cliData.invoices.sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate)).map((inv: any) => ({
            id: inv.id,
            name: inv.invoiceNumber,
            type: 'invoice',
            grossDebt: inv.currentDebt,
            availableCredit: 0,
            netValue: inv.currentDebt,
            children: [],
            isExpanded: false,
            data: inv
          }));

          const creditNodes: AnalyticalNode[] = cliData.credits.map((doc: any) => ({
            id: doc.id,
            name: doc.documentNumber,
            type: 'credit',
            grossDebt: 0,
            availableCredit: doc.availableValue,
            netValue: -doc.availableValue, // Negative to visually indicate deduction
            children: [],
            isExpanded: false,
            data: doc
          }));

          return {
            id: `${secKey}-${cmdKey}-${cliKey}`,
            name: cliKey,
            type: 'client',
            grossDebt: cliData.debt,
            availableCredit: cliData.credit,
            netValue: Math.max(0, cliData.debt - cliData.credit),
            children: [...invoiceNodes, ...creditNodes], // Show both
            isExpanded: expandedMapNodes[`${secKey}-${cmdKey}-${cliKey}`] ?? false
          };
        });

        return {
          id: `${secKey}-${cmdKey}`,
          name: cmdKey,
          type: 'command',
          grossDebt: cmdData.debt,
          availableCredit: cmdData.credit,
          netValue: Math.max(0, cmdData.debt - cmdData.credit),
          children: clientsList,
          isExpanded: expandedMapNodes[`${secKey}-${cmdKey}`] ?? false
        };
      });

      const sectorId = `sec-${secKey}`;
      return {
        id: sectorId,
        name: secKey,
        type: 'sector',
        grossDebt: secData.debt,
        availableCredit: secData.credit,
        netValue: Math.max(0, secData.debt - secData.credit),
        children: commands,
        isExpanded: expandedMapNodes[sectorId] ?? true
      };
    });

    // Calculate Grand Total
    const totalDebt = sectors.reduce((acc, s) => acc + s.grossDebt, 0);
    const totalCredit = sectors.reduce((acc, s) => acc + s.availableCredit, 0);
    const grandNet = Math.max(0, totalDebt - totalCredit);

    return { sectors, grandNet };
  }, [invoices, allDocs, expandedMapNodes]);


  // --- LIST TAB LOGIC (Existing) ---
  // ... (Code reused from previous implementation)

  const handleUgChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFormData(prev => {
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

  const handleTypeChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const match = services.find(s => s.value === val);
    setFormData(prev => {
      const newState = { ...prev, type: val };
      if (match) {
        newState.unitMeasure = match.unit;
        newState.serviceAcronym = match.acronym;
      }
      return newState;
    });
  };

  const translateStatus = (status: InvoiceStatus | string) => {
    switch (status) {
      case InvoiceStatus.OPEN: return 'Em Aberto';
      case InvoiceStatus.PAID: return 'Quitada';
      case InvoiceStatus.OVERDUE: return 'Vencida';
      case InvoiceStatus.CANCELLED: return 'Cancelada';
      default: return status;
    }
  };

  const getStatusBadge = (status: InvoiceStatus | string) => {
    switch (status) {
      case InvoiceStatus.OPEN:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800"><Clock size={12} className="mr-1" /> Em Aberto</span>;
      case InvoiceStatus.PAID:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800"><CheckCircle size={12} className="mr-1" /> Quitada</span>;
      case InvoiceStatus.OVERDUE:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800"><AlertOctagon size={12} className="mr-1" /> Vencida</span>;
      case InvoiceStatus.CANCELLED:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-800"><Ban size={12} className="mr-1" /> Cancelada</span>;
      default:
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">{status}</span>;
    }
  };

  const getInvoiceCalculations = (inv: Invoice) => {
    const invAllocations = allocations.filter(a => a.invoiceId === inv.id);
    let totalAdvanceUsed = 0;
    let totalPaymentUsed = 0;
    invAllocations.forEach(alloc => {
      const doc = allDocs.find(d => d.id === alloc.documentId);
      if (doc) {
        if (doc.operation === OperationType.ADIANTAMENTO) {
          totalAdvanceUsed += alloc.amount;
        } else {
          totalPaymentUsed += alloc.amount;
        }
      }
    });
    const valService = inv.value;
    const add = inv.adjustmentAddition || 0;
    const ded = inv.adjustmentDeduction || 0;
    const baseAdjusted = Number((valService + add - ded).toFixed(2));
    const valInvoice = Number((baseAdjusted - totalAdvanceUsed).toFixed(2));
    const rawBalance = valInvoice - totalPaymentUsed;
    const finalBalance = Math.abs(rawBalance) < 0.009 ? 0 : Number(rawBalance.toFixed(2));
    return { valService, add, ded, totalAdvanceUsed, totalPaymentUsed, valInvoice, finalBalance };
  };

  const calculateAdvanceDistribution = () => {
    const base = Number(formData.value) || 0;
    const add = Number(formData.adjustmentAddition) || 0;
    const ded = Number(formData.adjustmentDeduction) || 0;
    let remainingDebt = Math.max(0, base + add - ded);
    const distribution: { docId: string, amountUsed: number, effectiveBalance: number }[] = [];
    const selectedDocs = advanceDocs.filter(d => selectedAdvances.includes(d.id));
    selectedDocs.forEach(doc => {
      let currentUsage = 0;
      if (editingId) {
        const existingAlloc = allocations.find(a => a.invoiceId === editingId && a.documentId === doc.id);
        if (existingAlloc) currentUsage = existingAlloc.amount;
      }
      const effectiveBalance = doc.availableValue + currentUsage;
      let amountToUse = 0;
      if (remainingDebt > 0 && effectiveBalance > 0.005) {
        amountToUse = Math.min(effectiveBalance, remainingDebt);
        remainingDebt -= amountToUse;
      }
      distribution.push({ docId: doc.id, amountUsed: amountToUse, effectiveBalance: effectiveBalance });
    });
    return { distribution, remainingDebt, totalInvoice: Math.max(0, base + add - ded) };
  };

  const handleToggleAdvance = (docId: string) => {
    if (selectedAdvances.includes(docId)) setSelectedAdvances(selectedAdvances.filter(id => id !== docId));
    else setSelectedAdvances([...selectedAdvances, docId]);
  };

  const toggleInvoiceSiplad = async (inv: Invoice) => {
    if (isReadOnly) return;
    const updatedInvoice = { ...inv, sipladSettled: !inv.sipladSettled };
    await db.saveInvoice(updatedInvoice);
    await refresh();
  };



  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isReadOnly || isSubmitting) return;
    setSaveError(null);

    // Validation
    const missingFields = [];
    if (!formData.invoiceNumber) missingFields.push("Número da Fatura");
    if (!formData.client) missingFields.push("Cliente/UG");
    if (!formData.value) missingFields.push("Valor");
    if (!formData.sector) missingFields.push("Setor");

    if (missingFields.length > 0) {
      setSaveError(`Os seguintes campos são obrigatórios: ${missingFields.join(', ')}`);
      return;
    }

    const duplicate = invoices.find(i =>
      i.invoiceNumber.trim().toUpperCase() === formData.invoiceNumber?.trim().toUpperCase() &&
      i.id !== editingId
    );

    if (duplicate) {
      setSaveError(`IMPEDIMENTO: A fatura número "${formData.invoiceNumber}" já está cadastrada para o cliente "${duplicate.client}".`);
      return;
    }

    setIsSubmitting(true);
    try {
      const m = formData.monthCompetence || 0;
      const y = formData.yearCompetence || 0;
      const competence = `${m.toString().padStart(2, '0')}/${y}`;
      const invoiceId = editingId || uuidv4();

      const payload: Invoice = {
        id: invoiceId,
        ug: formData.ug || '',
        sector: formData.sector!,
        command: formData.command || '',
        client: formData.client!,
        invoiceNumber: formData.invoiceNumber || '',
        consumption: formData.consumption || '',
        unitMeasure: formData.unitMeasure || '',
        serviceAcronym: formData.serviceAcronym || '',
        value: Number(formData.value),
        adjustmentAddition: Number(formData.adjustmentAddition) || 0,
        adjustmentDeduction: Number(formData.adjustmentDeduction) || 0,
        observation: formData.observation || '',
        issueDate: formData.issueDate || '',
        dueDate: formData.dueDate || '',
        monthCompetence: Number(formData.monthCompetence),
        yearCompetence: Number(formData.yearCompetence),
        competence,
        type: formData.type || 'Outros',
        paidAmount: editingId ? (formData.paidAmount || 0) : 0,
        status: editingId ? (formData.status || InvoiceStatus.OPEN) : InvoiceStatus.OPEN,
        isCanceled: formData.isCanceled || false,
        sipladSettled: editingId ? (formData.sipladSettled || false) : false
      };

      await db.saveInvoice(payload);

      const currentInvoiceAllocations = allocations.filter(a => a.invoiceId === invoiceId);
      const advanceAllocationIds = currentInvoiceAllocations.filter(a => {
        const doc = allDocs.find(d => d.id === a.documentId);
        return doc && doc.operation === OperationType.ADIANTAMENTO;
      }).map(a => a.id);

      for (const aid of advanceAllocationIds) {
        await db.deleteAllocation(aid);
      }

      const { distribution } = calculateAdvanceDistribution();

      for (const dist of distribution) {
        if (dist.amountUsed > 0.005) {
          await db.saveAllocation({
            id: uuidv4(),
            documentId: dist.docId,
            invoiceId: payload.id,
            amount: dist.amountUsed,
            date: new Date().toISOString().split('T')[0],
            siscontSettled: true,
            observation: 'Abatimento automático de Adiantamento',
            serviceType: payload.type
          });
        }
      }

      closeModal();
      await refresh();
    } catch (err: any) {
      console.error("Save Error:", err);
      setSaveError(`Erro ao salvar no Supabase: ${err.message || 'Verifique sua conexão ou permissões.'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (inv: Invoice) => {
    if (isReadOnly) return;
    setFormData(inv);
    setEditingId(inv.id);
    setSaveError(null);
    setAdvanceSearchText('');
    const invAllocations = allocations.filter(a => a.invoiceId === inv.id);
    const selectedIds: string[] = [];
    invAllocations.forEach(alloc => {
      const doc = advanceDocs.find(d => d.id === alloc.documentId);
      if (doc) selectedIds.push(doc.id);
    });
    setSelectedAdvances(selectedIds);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (actionId && !isReadOnly) {
      await db.deleteInvoice(actionId);
      await refresh();
      setActionId(null);
    }
  };

  const handleCancel = async () => {
    if (actionId && !isReadOnly) {
      const inv = invoices.find(i => i.id === actionId);
      if (inv) {
        const linkedAllocations = allocations.filter(a => a.invoiceId === inv.id);
        for (const la of linkedAllocations) {
          await db.deleteAllocation(la.id);
        }
        await db.saveInvoice({ ...inv, isCanceled: true, status: InvoiceStatus.CANCELLED, paidAmount: 0 });
        await refresh();
      }
      setIsCancelModalOpen(false);
      setActionId(null);
    }
  };

  const filteredInvoices = invoices.filter(inv => {
    const search = searchText.toLowerCase();
    const matchesSearch = !searchText || inv.client.toLowerCase().includes(search) || inv.invoiceNumber.toLowerCase().includes(search) || (inv.ug || '').toLowerCase().includes(search);
    const matchesMonth = !filterMonth || inv.monthCompetence.toString() === filterMonth;
    const matchesYear = !filterYear || inv.yearCompetence.toString() === filterYear;
    const matchesStatus = !filterStatus || inv.status === filterStatus;
    const matchesType = !filterType || inv.type === filterType;
    const matchesSiplad = !filterSiplad || (filterSiplad === 'yes' ? inv.sipladSettled : !inv.sipladSettled);
    return matchesSearch && matchesMonth && matchesYear && matchesStatus && matchesType && matchesSiplad;
  });

  const totalCount = filteredInvoices.length;
  const totalServiceSum = filteredInvoices.reduce((sum, inv) => sum + (getInvoiceCalculations(inv).valService), 0);
  const { distribution: currentDistribution, remainingDebt: currentRemainingDebt, totalInvoice: currentTotalInvoice } = calculateAdvanceDistribution();
  const totalUsed = currentDistribution.reduce((acc, curr) => acc + curr.amountUsed, 0);
  const visibleAdvanceDocs = advanceDocs.filter(d => {
    const hasBalance = d.availableValue > 0.005;
    const isSelected = selectedAdvances.includes(d.id);
    if (!hasBalance && !isSelected) return false;
    const search = advanceSearchText.toLowerCase();
    if (!search) return true;
    return d.client.toLowerCase().includes(search) || d.documentNumber.toLowerCase().includes(search);
  });

  const calculateTotals = (list: Invoice[]) => {
    return list.reduce((acc, inv) => {
      const calc = getInvoiceCalculations(inv);
      return {
        valService: acc.valService + calc.valService,
        add: acc.add + calc.add,
        ded: acc.ded + calc.ded,
        totalAdvanceUsed: acc.totalAdvanceUsed + calc.totalAdvanceUsed,
        valInvoice: acc.valInvoice + calc.valInvoice,
        finalBalance: acc.finalBalance + calc.finalBalance
      };
    }, { valService: 0, add: 0, ded: 0, totalAdvanceUsed: 0, valInvoice: 0, finalBalance: 0 });
  };

  const exportListPDF = () => {
    const doc = new jsPDF('l');
    doc.text("Relatório de Faturas - SISCONT", 14, 15);
    doc.setFontSize(10);
    doc.text(`Gerado em: ${new Date().toLocaleDateString()}`, 14, 22);
    const rows = filteredInvoices.map(inv => {
      const calc = getInvoiceCalculations(inv);
      return [
        translateStatus(inv.status), inv.ug || '-', inv.client, inv.invoiceNumber, inv.type, inv.competence,
        `R$ ${calc.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `R$ ${calc.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `R$ ${calc.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `R$ ${calc.totalAdvanceUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `R$ ${calc.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        `R$ ${calc.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
      ];
    });
    const totals = calculateTotals(filteredInvoices);
    const footerRow = [
      'TOTAL', '', '', '', '', '',
      `R$ ${totals.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `R$ ${totals.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `R$ ${totals.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `R$ ${totals.totalAdvanceUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `R$ ${totals.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
      `R$ ${totals.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ];
    autoTable(doc, {
      startY: 25,
      head: [['Status', 'UG', 'Cliente', 'Fatura', 'Tipo', 'Comp.', 'Vl Serviço', 'Acres.', 'Deb.', 'Adiant.', 'Vl Fatura', 'Saldo']],
      body: rows,
      foot: [footerRow],
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
      footStyles: { fillColor: [241, 245, 249], textColor: [30, 41, 59], fontStyle: 'bold' }
    });
    doc.save("faturas_siscont.pdf");
  };

  const exportExcel = () => {
    const headers = ["Status", "UG", "Cliente", "Fatura", "Tipo", "Sigla", "Competência", "Emissão", "Vencimento", "Consumo", "Unid.", "Valor Serviço Prestado", "Acréscimos", "Débitos", "Adiantamento", "Valor da Fatura", "Saldo", "Observação", "Siplad"];
    const csvRows = filteredInvoices.map(inv => {
      const calc = getInvoiceCalculations(inv);
      return [
        translateStatus(inv.status), inv.ug || '', `"${inv.client}"`, inv.invoiceNumber, inv.type, inv.serviceAcronym || '',
        inv.competence, inv.issueDate, inv.dueDate, inv.consumption, inv.unitMeasure,
        calc.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        calc.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        calc.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        calc.totalAdvanceUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        calc.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        calc.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
        `"${inv.observation ? inv.observation.replace(/"/g, '""') : ''}"`,
        inv.sipladSettled ? "Lançado" : "Pendente"
      ].join(",");
    });
    const totals = calculateTotals(filteredInvoices);
    const totalRow = [
      "TOTAL", "", "", "", "", "", "", "", "", "", "",
      totals.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      totals.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      totals.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      totals.totalAdvanceUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      totals.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      totals.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
      "", ""
    ].join(",");
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...csvRows, totalRow].join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", "faturas.csv");
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
              const payload: Invoice = {
                id: uuidv4(),
                ug: cols[0] || '',
                client: cols[1] || 'Importado',
                invoiceNumber: cols[2] || 'S/N',
                type: cols[3] || 'Outros',
                value: Number(cols[4].replace('.', '').replace(',', '.')) || 0,
                issueDate: cols[5] || new Date().toISOString().split('T')[0],
                dueDate: cols[6] || new Date().toISOString().split('T')[0],
                monthCompetence: Number(cols[7]) || new Date().getMonth() + 1,
                yearCompetence: Number(cols[8]) || new Date().getFullYear(),
                competence: `${(Number(cols[7]) || 1).toString().padStart(2, '0')}/${cols[8] || 2024}`,
                sector: 'Geral', command: 'Geral', consumption: '', unitMeasure: '',
                paidAmount: 0, status: InvoiceStatus.OPEN, isCanceled: false, sipladSettled: false
              };
              await db.saveInvoice(payload);
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

  const generateInvoicePDF = (inv: Invoice) => {
    const doc = new jsPDF();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Marinha do Brasil", 105, 20, { align: "center" });
    doc.setFontSize(12);
    doc.text("Base Naval da Ilha das Cobras", 105, 28, { align: "center" });
    doc.setLineWidth(0.5);
    doc.line(20, 35, 190, 35);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    let y = 50;
    const lineHeight = 10;
    const col2X = 140;

    doc.text(`UG: ${inv.ug || '-'}`, 20, y, { maxWidth: 100 });
    doc.text(`Cliente: ${inv.client}`, 80, y, { maxWidth: 60 });
    doc.text(`Comando: ${inv.command || '-'}`, col2X, y, { maxWidth: 50 });
    y += lineHeight;

    doc.text(`Setor: ${inv.sector}`, 20, y, { maxWidth: 100 });
    doc.text(`Nº Fatura: ${inv.invoiceNumber}`, col2X, y);
    y += lineHeight;

    doc.text(`Competência: ${inv.competence}`, 20, y);
    doc.text(`Tipo: ${inv.type}`, col2X, y);
    y += lineHeight;

    doc.text(`Emissão: ${new Date(inv.issueDate).toLocaleDateString()}`, 20, y);
    doc.text(`Vencimento: ${new Date(inv.dueDate).toLocaleDateString()}`, col2X, y);
    y += lineHeight + 5;

    doc.setFillColor(240, 240, 240);
    doc.rect(20, y - 6, 170, 20, "F");
    doc.setFont("helvetica", "bold");
    doc.text("Detalhes do Consumo", 25, y);
    y += lineHeight;

    doc.setFont("helvetica", "normal");
    doc.text(`Consumo: ${inv.consumption || '0'} ${inv.unitMeasure}`, 25, y);

    const calc = getInvoiceCalculations(inv);
    doc.text(`Valor Serviço Prestado: R$ ${calc.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, col2X, y);
    y += lineHeight;
    if (calc.add > 0) { doc.text(`(+) Acerto Acréscimo: R$ ${calc.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, col2X, y); y += lineHeight; }
    if (calc.ded > 0) { doc.text(`(-) Acerto Débito: R$ ${calc.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, col2X, y); y += lineHeight; }

    const invAllocations = allocations.filter(a => a.invoiceId === inv.id);
    const advanceAllocs = invAllocations.filter(a => {
      const d = allDocs.find(doc => doc.id === a.documentId);
      return d?.operation === OperationType.ADIANTAMENTO;
    });

    if (advanceAllocs.length > 0) {
      doc.setFont("helvetica", "italic");
      advanceAllocs.forEach(alloc => {
        const docSource = allDocs.find(d => d.id === alloc.documentId);
        doc.text(`(-) Adiantamento (Doc: ${docSource?.documentNumber}): R$ ${alloc.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, col2X, y, { align: 'left', maxWidth: 60 });
        y += lineHeight;
      });
      doc.setFont("helvetica", "normal");
    }

    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text(`Valor da Fatura: R$ ${calc.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, col2X, y);
    y += lineHeight;

    const paymentAllocs = invAllocations.filter(a => {
      const d = allDocs.find(doc => doc.id === a.documentId);
      return d?.operation !== OperationType.ADIANTAMENTO;
    });

    if (paymentAllocs.length > 0) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(10);
      paymentAllocs.forEach(alloc => {
        const docSource = allDocs.find(d => d.id === alloc.documentId);
        const typeLabel = docSource?.operation || 'Pagamento';
        doc.text(`(-) ${typeLabel} (Doc: ${docSource?.documentNumber}): R$ ${alloc.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, col2X, y, { align: 'left', maxWidth: 60 });
        y += lineHeight;
      });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
    }

    y += 2;
    doc.text(`Saldo a Pagar: R$ ${calc.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, col2X, y);

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");

    if (inv.observation) {
      y += 20; doc.setFontSize(10); doc.text("Observações:", 20, y);
      y += 5; doc.setFont("helvetica", "italic"); doc.text(inv.observation, 20, y, { maxWidth: 170 });
    }

    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(10); doc.setTextColor(100);
    doc.text(`Status Atual: ${translateStatus(inv.status)} - Gerado via SISCONT em ${new Date().toLocaleDateString()}`, 105, pageHeight - 10, { align: 'center' });
    doc.save(`Fatura_${inv.invoiceNumber}.pdf`);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormData({});
    setEditingId(null);
    setSaveError(null);
    setSelectedAdvances([]);
    setAdvanceSearchText('');
  };

  return (
    <div className="space-y-6">
      {/* Header & Stats */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Faturas</h2>
          <div className="flex gap-4 text-sm text-slate-500 mt-1">
            <span>Total Ativas: <strong>{totalCount}</strong></span>
            <span>Total Serviço Prestado: <strong>R$ {totalServiceSum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
          </div>
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
          <Button variant="secondary" size="sm" onClick={exportListPDF}>
            <FileText className="w-4 h-4 mr-2" /> PDF Lista
          </Button>
          {!isReadOnly && (
            <Button onClick={() => { setEditingId(null); setFormData({}); setSaveError(null); setIsModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Nova Fatura
            </Button>
          )}
        </div>
      </div>

      {/* TABS */}
      <div className="flex space-x-1 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'list'
            ? 'border-primary-600 text-primary-700'
            : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
        >
          <LayoutList size={16} /> Lista de Faturas
        </button>
        <button
          onClick={() => setActiveTab('map')}
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'map'
            ? 'border-primary-600 text-primary-700'
            : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
        >
          <Network size={16} /> Mapa Analítico de Contas
        </button>
      </div>

      {/* --- LIST VIEW --- */}
      {activeTab === 'list' && (
        <>
          {/* Filters */}
          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3 items-end">
            <div className="flex-1 w-full">
              <Input label="Busca" placeholder="UG, Cliente ou número..." value={searchText} onChange={e => setSearchText(e.target.value)} />
            </div>
            <div className="w-full md:w-32">
              <Select label="Mês" options={[{ v: '1', l: 'Janeiro' }, { v: '2', l: 'Fevereiro' }, { v: '3', l: 'Março' }, { v: '4', l: 'Abril' }, { v: '5', l: 'Maio' }, { v: '6', l: 'Junho' }, { v: '7', l: 'Julho' }, { v: '8', l: 'Agosto' }, { v: '9', l: 'Setembro' }, { v: '10', l: 'Outubro' }, { v: '11', l: 'Novembro' }, { v: '12', l: 'Dezembro' }].map(m => ({ label: m.l, value: m.v }))} value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
            </div>
            <div className="w-full md:w-24">
              <Select label="Ano" options={Array.from(new Set(invoices.map(i => i.yearCompetence || 0))).filter((y: any) => y > 0).sort((a: number, b: number) => b - a).map(y => ({ label: y.toString(), value: y }))} value={filterYear} onChange={e => setFilterYear(e.target.value)} />
            </div>
            <div className="w-full md:w-40">
              <Select label="Status" options={[{ label: 'Em Aberto', value: InvoiceStatus.OPEN }, { label: 'Quitada', value: InvoiceStatus.PAID }, { label: 'Vencida', value: InvoiceStatus.OVERDUE }, { label: 'Cancelada', value: InvoiceStatus.CANCELLED }]} value={filterStatus} onChange={e => setFilterStatus(e.target.value)} />
            </div>
            <div className="w-full md:w-28">
              <Select label="Siplad?" options={[{ label: 'Todos', value: '' }, { label: 'Lançado', value: 'yes' }, { label: 'Pendente', value: 'no' }]} value={filterSiplad} onChange={e => setFilterSiplad(e.target.value)} />
            </div>
            <div className="w-full md:w-48">
              <Select label="Tipo" options={services} value={filterType} onChange={e => setFilterType(e.target.value)} />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-3 text-left"></th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Comp.</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">UG</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Cliente</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Fatura</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Vencimento</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Vl Serviço Prestado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Acres.</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Deb.</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Adiant.</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Vl Fatura</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">Saldo</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase">Ações</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {filteredInvoices.map((inv) => {
                    const calc = getInvoiceCalculations(inv);
                    const isExpanded = expandedRowId === inv.id;

                    return (
                      <React.Fragment key={inv.id}>
                        <tr className={`hover:bg-slate-50 ${inv.isCanceled ? 'bg-slate-50 opacity-75' : ''}`}>
                          <td className="px-2 py-4">
                            <button onClick={() => setExpandedRowId(isExpanded ? null : inv.id)} className="text-slate-400 hover:text-primary-600">
                              {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">{getStatusBadge(inv.status)}</td>
                          <td className="px-4 py-4 text-sm text-slate-500">{inv.competence}</td>
                          <td className="px-4 py-4 text-sm text-slate-700">{inv.ug || '-'}</td>
                          <td className="px-4 py-4 text-sm font-medium text-slate-900 truncate max-w-[150px]" title={inv.client}>{inv.client}</td>
                          <td className="px-4 py-4 text-sm text-slate-500">{inv.invoiceNumber}</td>
                          <td className="px-4 py-4 text-sm text-slate-500 truncate max-w-[100px]" title={inv.type}>{inv.type}</td>
                          <td className="px-4 py-4 text-sm text-slate-500">{new Date(inv.dueDate).toLocaleDateString()}</td>
                          <td className="px-4 py-4 text-sm font-semibold text-slate-900">R$ {calc.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-4 text-sm text-slate-500">R$ {calc.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-4 text-sm text-slate-500">R$ {calc.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-4 text-sm text-orange-600">R$ {calc.totalAdvanceUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-4 text-sm font-bold text-indigo-700">R$ {calc.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-4 text-sm font-bold text-slate-800">R$ {calc.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => generateInvoicePDF(inv)} className="text-slate-500 hover:text-slate-800" title="Imprimir PDF"><Printer size={16} /></button>
                              {!inv.isCanceled && !isReadOnly && (
                                <>
                                  <button onClick={() => handleEdit(inv)} className="text-indigo-600 hover:text-indigo-900"><Edit2 size={16} /></button>
                                  <button onClick={() => { setActionId(inv.id); setIsCancelModalOpen(true); }} className="text-orange-600 hover:text-orange-900" title="Cancelar Fatura"><Ban size={16} /></button>
                                  <button onClick={() => { setActionId(inv.id); setIsDeleteModalOpen(true); }} className="text-red-600 hover:text-red-900"><Trash2 size={16} /></button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={15} className="px-6 py-4">
                              <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Detalhamento de Créditos Vinculados (Adiantamentos e Pagamentos)</h4>
                              <div className="bg-white rounded border border-slate-200 overflow-hidden max-w-4xl">
                                <table className="min-w-full text-sm">
                                  <thead className="bg-slate-100">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Tipo</th>
                                      <th className="px-3 py-2 text-left">Cliente</th>
                                      <th className="px-3 py-2 text-left">Documento</th>
                                      <th className="px-3 py-2 text-left">Data Doc</th>
                                      <th className="px-3 py-2 text-right">Valor Usado</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {allocations.filter(a => a.invoiceId === inv.id).map(a => {
                                      const doc = allDocs.find(d => d.id === a.documentId);
                                      if (!doc) return null;
                                      const isAdvance = doc.operation === OperationType.ADIANTAMENTO;
                                      return (
                                        <tr key={a.id} className="border-t border-slate-100">
                                          <td className="px-3 py-2">
                                            <span className={`text-xs font-semibold px-2 py-1 rounded ${isAdvance ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                              {doc.operation}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 text-slate-700">{doc.client}</td>
                                          <td className="px-3 py-2 text-slate-600">{doc.documentNumber}</td>
                                          <td className="px-3 py-2 text-slate-500">{new Date(doc.date).toLocaleDateString()}</td>
                                          <td className="px-3 py-2 text-right font-medium text-slate-700">R$ {a.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                      );
                                    })}
                                    {allocations.filter(a => a.invoiceId === inv.id).length === 0 && (
                                      <tr><td colSpan={5} className="px-3 py-2 text-center text-slate-400 italic">Nenhum crédito vinculado.</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                              <div className="mt-3 p-3 bg-white border border-slate-200 rounded flex justify-between items-center max-w-4xl">
                                <span className="text-sm font-bold text-slate-700">Status SIPLAD (Fatura):</span>
                                <label className="flex items-center gap-2 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={!!inv.sipladSettled}
                                    onChange={() => toggleInvoiceSiplad(inv)}
                                    disabled={isReadOnly}
                                    className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500 border-gray-300 cursor-pointer disabled:opacity-50"
                                  />
                                  <span className={`font-bold text-sm ${inv.sipladSettled ? "text-green-700" : "text-orange-600"}`}>
                                    {inv.sipladSettled ? "Lançado" : "Pendente"}
                                  </span>
                                </label>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {filteredInvoices.length === 0 && (
                    <tr><td colSpan={15} className="text-center py-8 text-slate-500">Nenhuma fatura encontrada.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* --- ANALYTICAL MAP TAB --- */}
      {activeTab === 'map' && (
        <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <Network size={20} className="text-primary-600" />
              Mapa Analítico de Contas em Aberto (Posição Líquida)
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Exibe o valor necessário para quitação, já abatendo automaticamente os créditos/adiantamentos disponíveis no nível do Cliente, Comando e Setor.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-black text-white uppercase text-xs font-bold">
                <tr>
                  <th className="px-4 py-3 text-left w-1/4">Setor</th>
                  <th className="px-4 py-3 text-left w-1/4">Comando</th>
                  <th className="px-4 py-3 text-left w-1/4">Cliente</th>
                  <th className="px-4 py-3 text-left w-1/4">Fatura / Detalhe</th>
                  <th className="px-4 py-3 text-right w-32">Valor Líquido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analyticalData.sectors.map(sector => (
                  <React.Fragment key={sector.id}>
                    {/* SECTOR ROW */}
                    <tr className="bg-slate-100 hover:bg-slate-200 font-bold text-slate-800">
                      <td className="px-4 py-3 flex items-center gap-2 cursor-pointer" onClick={() => toggleMapNode(sector.id)}>
                        {sector.isExpanded ? <ChevronDown size={16} /> : <ChevronDown size={16} className="-rotate-90" />}
                        {sector.name}
                      </td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right">R$ {sector.netValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                    </tr>

                    {/* COMMAND ROWS */}
                    {sector.isExpanded && sector.children.map(command => (
                      <React.Fragment key={command.id}>
                        <tr className="bg-slate-50 hover:bg-white font-semibold text-slate-700">
                          <td className="px-4 py-2 border-r border-slate-200"></td>
                          <td className="px-4 py-2 flex items-center gap-2 cursor-pointer" onClick={() => toggleMapNode(command.id)}>
                            {command.isExpanded ? <ChevronDown size={14} /> : <ChevronDown size={14} className="-rotate-90" />}
                            {command.name}
                          </td>
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2 text-right">R$ {command.netValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        </tr>

                        {/* CLIENT ROWS */}
                        {command.isExpanded && command.children.map(client => (
                          <React.Fragment key={client.id}>
                            <tr className="bg-white hover:bg-blue-50 text-slate-600">
                              <td className="px-4 py-2 border-r border-slate-200"></td>
                              <td className="px-4 py-2 border-r border-slate-200"></td>
                              <td className="px-4 py-2 flex items-center gap-2 cursor-pointer font-medium text-slate-800" onClick={() => toggleMapNode(client.id)}>
                                {client.isExpanded ? <ChevronDown size={14} /> : <ChevronDown size={14} className="-rotate-90" />}
                                {client.name}
                              </td>
                              <td className="px-4 py-2"></td>
                              <td className={`px-4 py-2 text-right font-medium ${client.netValue > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                R$ {client.netValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                              </td>
                            </tr>

                            {/* DETAIL ROWS (INVOICES & CREDITS) */}
                            {client.isExpanded && client.children.map((child, idx) => (
                              <tr key={`${child.id}-${idx}`} className="bg-white text-xs text-slate-500 border-l-4 border-l-slate-200">
                                <td className="px-4 py-1 border-r border-slate-200"></td>
                                <td className="px-4 py-1 border-r border-slate-200"></td>
                                <td className="px-4 py-1 border-r border-slate-200"></td>

                                {child.type === 'invoice' ? (
                                  // INVOICE ROW
                                  <>
                                    <td className="px-4 py-1 flex items-center gap-2">
                                      <FileText size={12} /> Fatura: {child.name} <span className="text-slate-400">({child.data?.type})</span>
                                    </td>
                                    <td className="px-4 py-1 text-right text-slate-400">
                                      (Aberto: R$ {child.grossDebt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                                    </td>
                                  </>
                                ) : (
                                  // CREDIT ROW (ALTCRED)
                                  <>
                                    <td className="px-4 py-1 flex items-center gap-2 text-green-700 font-medium">
                                      <FileCheck size={12} /> ALTCRED: {child.name}
                                    </td>
                                    <td className="px-4 py-1 text-right text-green-700 font-medium">
                                      - R$ {child.availableCredit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </td>
                                  </>
                                )}
                              </tr>
                            ))}
                          </React.Fragment>
                        ))}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
                {analyticalData.sectors.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-500">Nenhuma pendência encontrada.</td></tr>
                )}
              </tbody>
              <tfoot className="bg-slate-800 text-white font-bold sticky bottom-0">
                <tr>
                  <td className="px-4 py-4 uppercase" colSpan={4}>Total Geral Necessário para Quitação</td>
                  <td className="px-4 py-4 text-right text-lg">R$ {analyticalData.grandNet.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Edit/Create Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar Fatura' : 'Nova Fatura'}
        maxWidth="max-w-3xl"
        footer={
          <div className="flex justify-end gap-3 p-6 bg-slate-50 border-t border-slate-200">
            <Button variant="ghost" onClick={closeModal} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={handleSubmit} isLoading={isSubmitting}>
              {editingId ? 'Salvar Alterações' : 'Lançar Fatura'}
            </Button>
          </div>
        }
      >
        {saveError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-start gap-2 text-red-700">
            <AlertOctagon size={20} className="shrink-0 mt-0.5" />
            <span className="font-semibold text-sm">{saveError}</span>
          </div>
        )}

        <form className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="UG (Unidade Gestora)" value={formData.ug || ''} onChange={handleUgChange} placeholder="Ex: 789000 (Auto-preenchimento)" disabled={isReadOnly} />

          <Input label="Setor" required value={formData.sector || ''} onChange={e => setFormData({ ...formData, sector: e.target.value })} disabled={isReadOnly} />
          <Input label="Comando" required value={formData.command || ''} onChange={e => setFormData({ ...formData, command: e.target.value })} disabled={isReadOnly} />

          <Input label="Cliente" required value={formData.client || ''} onChange={e => setFormData({ ...formData, client: e.target.value })} disabled={isReadOnly} />

          <Select label="Tipo de Fatura" required options={services} value={formData.type || ''} onChange={handleTypeChange} disabled={isReadOnly} />

          <Input label="Nº Fatura" required value={formData.invoiceNumber || ''} onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })} disabled={isReadOnly} />
          <Input label="Consumo" value={formData.consumption || ''} onChange={e => setFormData({ ...formData, consumption: e.target.value })} disabled={isReadOnly} />

          <div className="flex gap-2">
            <Input label="Sigla (Auto)" value={formData.serviceAcronym || ''} onChange={e => setFormData({ ...formData, serviceAcronym: e.target.value })} disabled={isReadOnly} placeholder="Ex: AE" />
            <Input label="Unid. Medida (Auto)" value={formData.unitMeasure || ''} onChange={e => setFormData({ ...formData, unitMeasure: e.target.value })} disabled={isReadOnly} placeholder="Ex: M³" />
          </div>

          <CurrencyInput label="Valor Base" value={formData.value} onChange={val => setFormData({ ...formData, value: val })} disabled={isReadOnly} />

          <div className="flex gap-2">
            <CurrencyInput label="Acerto Acréscimo (+)" value={formData.adjustmentAddition} onChange={val => setFormData({ ...formData, adjustmentAddition: val })} disabled={isReadOnly} />
            <CurrencyInput label="Acerto Débito (-)" value={formData.adjustmentDeduction} onChange={val => setFormData({ ...formData, adjustmentDeduction: val })} disabled={isReadOnly} />
          </div>

          <Input label="Emissão" type="date" required value={formData.issueDate || ''} onChange={e => setFormData({ ...formData, issueDate: e.target.value })} disabled={isReadOnly} />
          <Input label="Vencimento" type="date" required value={formData.dueDate || ''} onChange={e => setFormData({ ...formData, dueDate: e.target.value })} disabled={isReadOnly} />
          <div className="flex gap-2">
            <Input label="Mês Comp." type="number" min="1" max="12" required value={formData.monthCompetence || ''} onChange={e => setFormData({ ...formData, monthCompetence: Number(e.target.value) })} disabled={isReadOnly} />
            <Input label="Ano Comp." type="number" min="2025" required value={formData.yearCompetence || ''} onChange={e => setFormData({ ...formData, yearCompetence: Number(e.target.value) })} disabled={isReadOnly} />
          </div>

          <Input label="Observação" className="md:col-span-2" value={formData.observation || ''} onChange={e => setFormData({ ...formData, observation: e.target.value })} disabled={isReadOnly} />

          {/* New Multiple Advance Selection List */}
          {!isReadOnly && (
            <div className="md:col-span-2 mt-4 flex flex-col bg-slate-100 rounded-lg border border-slate-300 overflow-hidden">
              {/* ... (Keep existing selection logic) ... */}
              <div className="p-3 bg-slate-200 border-b border-slate-300 flex justify-between items-center">
                <h4 className="font-bold text-slate-700 flex items-center gap-2"><Calculator size={16} /> Vincular Adiantamentos (ALTCRED)</h4>
                <span className="text-xs text-slate-500">Valor Total Fatura: <strong>R$ {currentTotalInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
              </div>

              <div className="p-3 bg-white border-b border-slate-200">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filtrar por Cliente ou Documento..."
                    value={advanceSearchText}
                    onChange={e => setAdvanceSearchText(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto bg-white">
                {visibleAdvanceDocs.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 italic text-sm">Nenhum adiantamento disponível.</div>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 sticky top-0 shadow-sm">
                      <tr>
                        <th className="w-8 px-3 py-2"></th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500 uppercase">Doc / Cliente</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">Saldo Disp.</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500 uppercase">A Usar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {visibleAdvanceDocs.map(doc => {
                        // Find if this doc is in our current calculated distribution
                        const dist = currentDistribution.find(d => d.docId === doc.id);
                        const amountUsing = dist ? dist.amountUsed : 0;
                        const effectiveBalance = dist ? dist.effectiveBalance : (
                          // Fallback calc if not selected but visible
                          doc.availableValue + (editingId ? (allocations.find(a => a.invoiceId === editingId && a.documentId === doc.id)?.amount || 0) : 0)
                        );
                        const isSelected = selectedAdvances.includes(doc.id);

                        return (
                          <tr key={doc.id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-blue-50/50' : ''}`}>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAdvance(doc.id)}
                                className="w-4 h-4 text-primary-600 rounded focus:ring-primary-500 border-gray-300 cursor-pointer"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="font-medium text-slate-800">{doc.documentNumber}</div>
                              <div className="text-xs text-slate-500">{doc.client}</div>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-600">
                              R$ {effectiveBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-primary-700">
                              {isSelected && amountUsing > 0 ? `R$ ${amountUsing.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="p-3 bg-slate-50 border-t border-slate-300 flex justify-between items-center text-sm">
                <div className="text-slate-600">
                  <span>Abatido: </span>
                  <span className="font-bold text-green-700">R$ {totalUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="text-slate-600">
                  <span>Fatura Restante: </span>
                  <span className={`font-bold ${currentRemainingDebt > 0.005 ? 'text-red-600' : 'text-slate-800'}`}>R$ {currentRemainingDebt.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          )}
        </form>
      </Modal>

      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Excluir Fatura"
        message="Tem certeza que deseja excluir esta fatura? Esta ação não pode ser desfeita."
      />

      <ConfirmModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handleCancel}
        title="Cancelar Fatura"
        message="Tem certeza que deseja cancelar esta fatura? Ela será marcada como CANCELADA e qualquer saldo de adiantamento utilizado será devolvido ao documento de origem."
      />
    </div>
  );
};
