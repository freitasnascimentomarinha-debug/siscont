
import { dataBR, hojeISO } from '../utils/datas';
import { SeletorCliente } from '../components/ui/SeletorCliente';
import { ORDEM_PADRAO, Ordem, ordenarFaturas } from '../utils/ordenarFaturas';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { AlvoPontos, PontoIcone, PontosModal } from '../components/PontosAtencao';
import { pendentes } from '../utils/pontosAtencao';
import { aceitaAdiantamento, ehAdiantamento } from '../utils/baixas';
import { baixarPdfFr172 } from '../services/fr172Service';
import { AcaoFatura, AcoesFaturaModais } from '../components/fase4/AcoesFaturaModais';
import { notify } from '../utils/notify';
import { Invoice, InvoiceStatus, OperationType, ReceivedDocument, PaymentAllocation, UserRole, podeEditarDados, veComoAdmin } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Plus, Edit2, Trash2, AlertTriangle, CheckCircle, Clock, Filter, X, Ban, FileText, Printer, RefreshCcw, MessageSquareWarning, FileSpreadsheet, ChevronDown, ChevronUp, Search, AlertOctagon, Calculator, LayoutList, Network, FileCheck, History } from 'lucide-react';
import { HistoricoModal } from '../components/auditoria/Historico';
import { MultiFiltro } from '../components/ui/MultiFiltro';
import { AcompanhamentoFatura } from '../components/faturas/AcompanhamentoFatura';
import { BarraLoteFaturas } from '../components/faturas/BarraLoteFaturas';
import { MapaAnaliticoTab } from '../components/faturas/MapaAnaliticoTab';
import { listarPrecos } from '../services/faturamentoService';
import { SeletorPublico, useClassificadorPublico, usePublico } from '../components/ui/SeletorPublico';
import { arquivoPublico, passaPublico, sufixoPublico } from '../utils/publico';
import { SEM_FILTROS, FiltrosExtras, clienteDe, comandoDe, passaFiltrosExtras, resumoCabecalho, setorDe, temFiltroExtra } from '../utils/filtrosFaturas';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { TEMA, cabecalhoCompacto, cabecalhoInstitucional, salvarPdf, tabelaPdf, tituloRelatorio } from '../utils/pdfCabecalho';

/** Por que a fatura não tem ALTCRED/GRU vinculada (evita parecer erro quando não é). */
function semCreditoTexto(inv: Invoice, calc?: { valInvoice: number }): string {
  if (inv.quitacaoExterna) return 'Quitada antes do SISCONT: a planilha de histórico (Faturas Pagas) não informa a ALTCRED/GRU usada.';
  if (calc && Math.abs(calc.valInvoice) < 0.01 && !inv.isCanceled) return 'Sem valor a pagar (valor final zero: coberta por desconto ou adiantamento não identificado na planilha).';
  return 'Nenhum crédito vinculado.';
}

export const Invoices: React.FC = () => {
  const { user } = useAuth();
  const isReadOnly = !podeEditarDados(user?.role);
  const isAdmin = veComoAdmin(user?.role);

  // Navigation State
  const [activeTab, setActiveTab] = useState<'list' | 'map'>('list');
  // MB × Extra-MB (vale para a lista e para o Mapa analítico)
  const [publico, setPublico] = usePublico('faturas');
  const cls = useClassificadorPublico();

  // Data State
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [advanceDocs, setAdvanceDocs] = useState<ReceivedDocument[]>([]);
  const [allDocs, setAllDocs] = useState<ReceivedDocument[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);

  // UI State
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

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

  // Filters
  const [filterType, setFilterType] = useState('');
  const [searchText, setSearchText] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSiplad, setFilterSiplad] = useState('');
  const [filterPontos, setFilterPontos] = useState('');
  const [extras, setExtras] = useState<FiltrosExtras>(SEM_FILTROS);
  const setExtra = (p: Partial<FiltrosExtras>) => setExtras(x => ({ ...x, ...p }));
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [pontosAlvo, setPontosAlvo] = useState<AlvoPontos | null>(null);
  const [acaoFatura, setAcaoFatura] = useState<AcaoFatura>(null);
  const [historicoDe, setHistoricoDe] = useState<Invoice | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [pagina, setPagina] = useState(0);
  const [ordem, setOrdem] = useState<Ordem>(ORDEM_PADRAO);
  const [porPagina, setPorPagina] = useState(50);

  // Master Data
  const [services, setServices] = useState<{ label: string, value: string, acronym: string, unit: string }[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  const refresh = async () => {
    let invs, allocs, docs, svcs, clist;
    setCarregando(true);
    try {
      [invs, allocs, docs, svcs, clist] = await Promise.all([
        db.getInvoices(),
        db.getAllocations(),
        db.getDocuments(),
        db.getServices(),
        db.getClients()
      ]);
    } catch (err) {
      notify.fail('Erro ao carregar faturas', err);
      setCarregando(false);
      return;
    }
    setCarregando(false);

    setInvoices(invs);
    setAllocations(allocs);
    setAllDocs(docs);
    setAdvanceDocs(docs.filter(aceitaAdiantamento));
    setServices(svcs.map(s => ({
      label: s.name,
      value: s.name,
      acronym: s.acronym,
      unit: s.unitMeasure
    })));
    setClients(clist);
  };

  useEffect(() => { refresh(); }, []);
  // outra aba (ou a volta à aba depois de um tempo) mudou os dados: recarrega para o saldo não ficar velho
  useEffect(() => {
    const aoMudar = () => { refresh(); };
    window.addEventListener('siscont:dados-mudaram', aoMudar);
    return () => window.removeEventListener('siscont:dados-mudaram', aoMudar);
  }, []);

  // --- LIST TAB LOGIC (Existing) ---
  // ... (Code reused from previous implementation)

  const omDoFormulario = (): string | null | undefined => {
    if (formData.omId) return formData.omId; // escolhido no campo Cliente (cadastro)
    const ug = (formData.ug || '').trim(), nome = (formData.client || '').trim().toLowerCase();
    const m = clients.find(c => c.omId && c.ug === ug && String(c.name).trim().toLowerCase() === nome);
    if (m) return m.omId;
    // mesmo cliente de antes (ex.: navio já desativado no cadastro): mantém a ligação
    const orig = editingId ? invoices.find(i => i.id === editingId) : undefined;
    if (orig && (orig.ug || '').trim() === ug && orig.client.trim().toLowerCase() === nome) return orig.omId;
    // cliente fora do cadastro: ao editar, desliga a OM antiga (só se a coluna já existe); ao criar, não envia
    return editingId && formData.omId !== undefined ? null : undefined;
  };

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

  // Índices: com milhares de faturas, procurar baixa/documento por lista a cada linha travava a tela
  const docsById = useMemo(() => new Map(allDocs.map(d => [d.id, d])), [allDocs]);
  const allocsByInvoice = useMemo(() => {
    const m = new Map<string, PaymentAllocation[]>();
    allocations.forEach(a => { const l = m.get(a.invoiceId); if (l) l.push(a); else m.set(a.invoiceId, [a]); });
    return m;
  }, [allocations]);

  const calcularFatura = (inv: Invoice) => {
    let totalAdvanceUsed = 0;
    let totalPaymentUsed = 0;
    (allocsByInvoice.get(inv.id) || []).forEach(alloc => {
      const doc = docsById.get(alloc.documentId);
      if (doc) {
        if (ehAdiantamento(alloc, doc)) totalAdvanceUsed += alloc.amount;
        else totalPaymentUsed += alloc.amount;
      }
    });
    const valService = inv.value;
    const add = inv.adjustmentAddition || 0;
    const ded = inv.adjustmentDeduction || 0;
    const baseAdjusted = Number((valService + add - ded).toFixed(2));
    const valInvoice = Number((baseAdjusted - totalAdvanceUsed).toFixed(2));
    // Quitada antes do SISCONT (histórico sem ALTCRED): não tem saldo a pagar
    const rawBalance = inv.quitacaoExterna && !inv.isCanceled ? 0 : valInvoice - totalPaymentUsed;
    const finalBalance = Math.abs(rawBalance) < 0.009 ? 0 : Number(rawBalance.toFixed(2));
    return { valService, add, ded, totalAdvanceUsed, totalPaymentUsed, valInvoice, finalBalance };
  };
  const calcPorFatura = useMemo(() => new Map(invoices.map(inv => [inv.id, calcularFatura(inv)])), [invoices, allocsByInvoice, docsById]);
  const getInvoiceCalculations = (inv: Invoice) => calcPorFatura.get(inv.id) || calcularFatura(inv);

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
    try {
      await db.saveInvoice(updatedInvoice);
    } catch (err) {
      notify.fail('Erro ao atualizar status Siplad', err);
    }
    await refresh();
  };



  // Fatura de TAXA CONDOMINIAL ou DIÁRIA: o valor vem do preço publicado pela página Taxa condominial e diárias
  const siglaForm = (formData.serviceAcronym || '').toUpperCase();
  const ehDaTaxa = siglaForm === 'TC' || siglaForm === 'DA';
  const [precoTaxa, setPrecoTaxa] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    setPrecoTaxa(undefined);
    if (!isModalOpen || !ehDaTaxa || !formData.omId || !formData.yearCompetence) return;
    let vivo = true;
    listarPrecos([Number(formData.yearCompetence)]).then(ps => {
      if (!vivo) return;
      const p = ps.find(x => x.sigla === siglaForm && x.omId === formData.omId);
      setPrecoTaxa(p ? p.valor : null);
      if (p && !editingId) setFormData(f => (f.value === p.valor ? f : { ...f, value: p.valor }));
    }).catch(() => vivo && setPrecoTaxa(null));
    return () => { vivo = false; };
  }, [isModalOpen, siglaForm, formData.omId, formData.yearCompetence, editingId]);

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
    // fatura avulsa de TC/diária só com o valor publicado pela Taxa condominial
    if (!editingId && ehDaTaxa) {
      if (!formData.omId) { setSaveError(`Fatura de ${siglaForm === 'TC' ? 'taxa condominial' : 'diária'}: escolha o cliente na lista do cadastro (o valor vem do preço publicado da OM).`); return; }
      if (precoTaxa === null) { setSaveError(`Não há ${siglaForm === 'TC' ? 'taxa condominial' : 'diária'} publicada para esta OM em ${formData.yearCompetence}. Calcule e publique na página Taxa condominial e diárias.`); return; }
      if (precoTaxa !== undefined && Math.abs(Number(formData.value) - precoTaxa) > 0.005) { setSaveError('O valor base precisa ser o publicado pela Taxa condominial.'); return; }
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
        sipladSettled: editingId ? (formData.sipladSettled || false) : false,
        // liga a fatura à OM do cadastro quando UG + cliente batem com uma OM cadastrada
        omId: omDoFormulario(),
      };

      await db.saveInvoice(payload);

      const currentInvoiceAllocations = allocations.filter(a => a.invoiceId === invoiceId);
      const advanceAllocationIds = currentInvoiceAllocations.filter(a => {
        const doc = allDocs.find(d => d.id === a.documentId);
        return !!doc && ehAdiantamento(a, doc);
      }).map(a => a.id);

      await db.deleteAllocations(advanceAllocationIds);

      const { distribution } = calculateAdvanceDistribution();

      await Promise.all(distribution.filter(d => d.amountUsed > 0.005).map(dist => {
          return db.saveAllocation({
            id: uuidv4(),
            documentId: dist.docId,
            invoiceId: payload.id,
            amount: dist.amountUsed,
            date: hojeISO(),
            siscontSettled: true,
            observation: 'Abatimento automático de Adiantamento',
            serviceType: payload.type,
            tipoBaixa: 'ADIANTAMENTO',
          });
      }));

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
    if (actionId && isAdmin) {
      try {
        await db.deleteInvoice(actionId);
        notify.success('Fatura excluída.');
      } catch (err) {
        notify.fail('Erro ao excluir fatura', err);
      }
      await refresh();
      setActionId(null);
    }
  };

  const handleCancel = async () => {
    if (actionId && !isReadOnly) {
      const inv = invoices.find(i => i.id === actionId);
      if (inv) {
        try {
          const linkedAllocations = allocations.filter(a => a.invoiceId === inv.id);
          await db.deleteAllocations(linkedAllocations.map(la => la.id));
          await db.saveInvoice({ ...inv, isCanceled: true, status: InvoiceStatus.CANCELLED, paidAmount: 0 });
          notify.success(`Fatura ${inv.invoiceNumber} cancelada.`);
        } catch (err) {
          notify.fail('Erro ao cancelar fatura', err);
        }
        await refresh();
      }
      setIsCancelModalOpen(false);
      setActionId(null);
    }
  };

  const { distribution: currentDistribution, remainingDebt: currentRemainingDebt, totalInvoice: currentTotalInvoice } = useMemo(() => calculateAdvanceDistribution(), [formData, advanceDocs, invoices, allocations]);
  
  const totalUsed = useMemo(() => currentDistribution.reduce((acc, curr) => acc + curr.amountUsed, 0), [currentDistribution]);
  
  const visibleAdvanceDocs = useMemo(() => {
    return advanceDocs.filter(d => {
      const hasBalance = d.availableValue > 0.005;
      const isSelected = selectedAdvances.includes(d.id);
      if (!hasBalance && !isSelected) return false;
      const search = advanceSearchText.toLowerCase();
      if (!search) return true;
      return d.client.toLowerCase().includes(search) || d.documentNumber.toLowerCase().includes(search);
    });
  }, [advanceDocs, selectedAdvances, advanceSearchText]);
  const filteredInvoices = useMemo(() => {
    return ordenarFaturas(invoices.filter(inv => {
      const search = searchText.toLowerCase();
      const matchesSearch = !searchText || 
        inv.client.toLowerCase().includes(search) || 
        inv.invoiceNumber.toLowerCase().includes(search) || 
        (inv.ug || '').toLowerCase().includes(search);
      const matchesMonth = !filterMonth || inv.monthCompetence.toString() === filterMonth;
      const matchesYear = !filterYear || inv.yearCompetence.toString() === filterYear;
      const matchesStatus = !filterStatus || inv.status === filterStatus;
      const matchesType = !filterType || inv.type === filterType;
      const matchesSiplad = !filterSiplad || (filterSiplad === 'yes' ? inv.sipladSettled : !inv.sipladSettled);
      const abertos = pendentes(inv.pontos);
      const matchesPontos = !filterPontos || (filterPontos === 'any' ? abertos.length > 0 : abertos.some(p => p.gravidade === filterPontos));
      return matchesSearch && matchesMonth && matchesYear && matchesStatus && matchesType && matchesSiplad && matchesPontos && passaFiltrosExtras(inv, extras) && passaPublico(publico, cls.faturaExtra(inv));
    }), ordem);
  }, [invoices, searchText, filterMonth, filterYear, filterStatus, filterType, filterSiplad, filterPontos, ordem, extras, publico, cls]);

  const totalCount = filteredInvoices.length;
  
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

  const totals = useMemo(() => calculateTotals(filteredInvoices), [filteredInvoices, calcPorFatura]);
  // volta para a 1ª página quando os filtros mudam
  useEffect(() => { setPagina(0); setSelecionadas(new Set()); }, [searchText, filterMonth, filterYear, filterStatus, filterType, filterSiplad, filterPontos, porPagina, ordem, extras]);
  const cabecalho = useMemo(() => resumoCabecalho(filteredInvoices), [filteredInvoices]);
  const opSetores = useMemo(() => [...new Set(invoices.map(setorDe))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [invoices]);
  const opComandos = useMemo(() => [...new Set(invoices.map(comandoDe))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [invoices]);
  const opClientes = useMemo(() => [...new Set(invoices.map(clienteDe))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [invoices]);
  const semOM = useMemo(() => invoices.filter(i => !i.omId).length, [invoices]);
  const semCompetencia = useMemo(() => invoices.filter(i => !i.yearCompetence).length, [invoices]);
  const totalPaginas = Math.max(1, Math.ceil(filteredInvoices.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const faturasDaPagina = filteredInvoices.slice(paginaAtual * porPagina, (paginaAtual + 1) * porPagina);
  const totalServiceSum = totals.valService;

  const exportListPDF = () => {
    const doc = new jsPDF('l');
    cabecalhoCompacto(doc);
    const yIni = tituloRelatorio(doc, `Relatório de Faturas${sufixoPublico(publico)}`, `Posição em ${dataBR(hojeISO())}`, 26);
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
    tabelaPdf(doc, {
      startY: yIni,
      head: [['Status', 'UG', 'Cliente', 'Fatura', 'Tipo', 'Comp.', 'Vl Serviço', 'Acres.', 'Deb.', 'Adiant.', 'Vl Fatura', 'Saldo']],
      body: rows,
      foot: [footerRow],
      styles: { fontSize: 8 },
      columnStyles: Object.fromEntries([6, 7, 8, 9, 10, 11].map(i => [i, { halign: 'right' as const }]))
    });
    salvarPdf(doc, `faturas_siscont${arquivoPublico(publico)}.pdf`);
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
    link.setAttribute("download", `faturas${arquivoPublico(publico)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const generateInvoicePDF = (inv: Invoice) => {
    const doc = new jsPDF();
    cabecalhoInstitucional(doc, 8);
    doc.setLineWidth(0.5);
    doc.line(20, 36, 190, 36);
    doc.setFont("helvetica", "bold");
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

    doc.text(`Emissão: ${dataBR(inv.issueDate)}`, 20, y);
    doc.text(`Vencimento: ${dataBR(inv.dueDate)}`, col2X, y);
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
      return ehAdiantamento(a, d);
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
      return !ehAdiantamento(a, d);
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
          <h2 className="text-2xl font-bold text-slate-800">Faturas emitidas</h2>
          {activeTab === 'list' && <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500 mt-1">
            <span>Na lista: <strong>{cabecalho.total}</strong> ({cabecalho.ativas} ativas{cabecalho.canceladas ? `, ${cabecalho.canceladas} canceladas` : ''})</span>
            <span>Serviço prestado (sem canceladas): <strong>R$ {cabecalho.servico.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
            {semOM > 0 && <button type="button" className="text-amber-700 underline" onClick={() => setExtra({ cadastro: 'sem' })} title="Faturas cujo cliente não está ligado a uma OM do cadastro">{semOM} sem OM ligada</button>}
          </div>}
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <SeletorPublico valor={publico} onChange={setPublico} />
          {activeTab === 'list' && <>
            <Button variant="secondary" size="sm" onClick={exportExcel}>
              <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
            </Button>
            <Button variant="secondary" size="sm" onClick={exportListPDF}>
              <FileText className="w-4 h-4 mr-2" /> PDF Lista
            </Button>
          </>}
          {!isReadOnly && (
            <Button onClick={() => { setEditingId(null); setFormData({}); setSaveError(null); setIsModalOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Nova fatura avulsa
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
          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-col md:flex-row md:flex-wrap gap-3 items-end">
            <div className="flex-1 w-full md:min-w-[220px]">
              <Input label="Busca" placeholder="UG, Cliente ou número..." value={searchText} onChange={e => setSearchText(e.target.value)} />
            </div>
            <div className="w-full md:w-32">
              <Select label="Mês" options={[{ v: '1', l: 'Janeiro' }, { v: '2', l: 'Fevereiro' }, { v: '3', l: 'Março' }, { v: '4', l: 'Abril' }, { v: '5', l: 'Maio' }, { v: '6', l: 'Junho' }, { v: '7', l: 'Julho' }, { v: '8', l: 'Agosto' }, { v: '9', l: 'Setembro' }, { v: '10', l: 'Outubro' }, { v: '11', l: 'Novembro' }, { v: '12', l: 'Dezembro' }].map(m => ({ label: m.l, value: m.v }))} value={filterMonth} onChange={e => setFilterMonth(e.target.value)} />
            </div>
            <div className="w-full md:w-64">
              <Select label="Ordenar por" options={[
                { label: 'Competência (mais recente) › vencimento › A–Z', value: 'competencia|0' },
                { label: 'Competência (mais antiga) › vencimento › A–Z', value: 'competencia|1' },
                { label: 'Vencimento (mais antigo primeiro)', value: 'vencimento|1' },
                { label: 'Vencimento (mais recente primeiro)', value: 'vencimento|0' },
                { label: 'Cliente (A–Z)', value: 'cliente|1' },
                { label: 'Número da fatura', value: 'numero|1' },
              ]} value={`${ordem.campo}|${ordem.asc ? 1 : 0}`} onChange={e => { const [c, a] = e.target.value.split('|'); setOrdem({ campo: c as any, asc: a === '1' }); }} />
            </div>
            <div className="w-full md:w-28">
              <Select label="Ano" options={Array.from(new Set(invoices.map(i => i.yearCompetence || 0))).filter((y: any) => y > 0).sort((a: number, b: number) => b - a).map(y => ({ label: y.toString(), value: y })).concat(semCompetencia ? [{ label: 'Sem competência', value: 0 }] : [])} value={filterYear} onChange={e => setFilterYear(e.target.value)} />
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
            <div className="w-full md:w-44">
              <Select label="Pontos de atenção" options={[{ label: 'Com algum ponto', value: 'any' }, { label: 'Gravidade alta', value: 'alta' }, { label: 'Gravidade média', value: 'media' }, { label: 'Gravidade baixa', value: 'baixa' }]} value={filterPontos} onChange={e => setFilterPontos(e.target.value)} />
            </div>
          </div>

          {/* Filtros de várias escolhas e andamento */}
          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex flex-wrap gap-4 items-end">
            <MultiFiltro rotulo="Setor" opcoes={opSetores} excluidos={extras.setoresExcluidos} onChange={x => setExtra({ setoresExcluidos: x })} />
            <MultiFiltro rotulo="Comando" opcoes={opComandos} excluidos={extras.comandosExcluidos} onChange={x => setExtra({ comandosExcluidos: x })} largura="w-96" />
            <MultiFiltro rotulo="Cliente (OM)" opcoes={opClientes} excluidos={extras.clientesExcluidos} onChange={x => setExtra({ clientesExcluidos: x })} largura="w-96" />
            <label className="text-xs font-semibold text-slate-600">Cadastro
              <select className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={extras.cadastro} onChange={e => setExtra({ cadastro: e.target.value as FiltrosExtras['cadastro'] })} aria-label="Filtrar por cadastro">
                <option value="">Todas</option><option value="sem">Só sem OM ligada ({semOM})</option>
              </select></label>
            <label className="text-xs font-semibold text-slate-600">Andamento
              <select className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={extras.andamento} onChange={e => setExtra({ andamento: e.target.value as FiltrosExtras['andamento'] })} aria-label="Filtrar por andamento">
                <option value="">Todas</option><option value="naoEnviada">Ainda não enviadas</option><option value="naoCertificada">Ainda não certificadas</option><option value="semSiafi">Sem registro no SIAFI</option>
              </select></label>
            {temFiltroExtra(extras) && <button type="button" className="text-sm text-primary-700 underline pb-2" onClick={() => setExtras(SEM_FILTROS)}>limpar estes filtros</button>}
          </div>

          {!isReadOnly && <BarraLoteFaturas selecionadas={[...selecionadas]} totalFiltradas={filteredInvoices.length} selecionouTodas={selecionadas.size === filteredInvoices.length}
            onSelecionarFiltradas={() => setSelecionadas(new Set(filteredInvoices.map(i => i.id)))} onLimpar={() => setSelecionadas(new Set())} onFeito={refresh} />}

          {/* Table */}
          <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-2 py-2 text-left w-16"><div className="flex items-center gap-1">{!isReadOnly && <input type="checkbox" aria-label="Selecionar as faturas desta página" className="h-4 w-4 accent-primary-600"
                      checked={faturasDaPagina.length > 0 && faturasDaPagina.every(i => selecionadas.has(i.id))}
                      onChange={e => setSelecionadas(prev => { const n = new Set(prev); faturasDaPagina.forEach(i => (e.target.checked ? n.add(i.id) : n.delete(i.id))); return n; })} />}</div></th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase">Status</th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase" aria-sort={ordem.campo === 'competencia' ? (ordem.asc ? 'ascending' : 'descending') : undefined}><button type="button" className="uppercase hover:text-primary-700" title="Clique para ordenar" onClick={() => setOrdem(o => ({ campo: 'competencia', asc: o.campo === 'competencia' ? !o.asc : false }))}>Comp.{ordem.campo === 'competencia' ? (ordem.asc ? ' ▲' : ' ▼') : ''}</button></th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase" aria-sort={ordem.campo === 'cliente' ? (ordem.asc ? 'ascending' : 'descending') : undefined}><button type="button" className="uppercase hover:text-primary-700" title="Clique para ordenar" onClick={() => setOrdem(o => ({ campo: 'cliente', asc: o.campo === 'cliente' ? !o.asc : true }))}>Cliente{ordem.campo === 'cliente' ? (ordem.asc ? ' ▲' : ' ▼') : ''}</button></th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase" aria-sort={ordem.campo === 'numero' ? (ordem.asc ? 'ascending' : 'descending') : undefined}><button type="button" className="uppercase hover:text-primary-700" title="Clique para ordenar" onClick={() => setOrdem(o => ({ campo: 'numero', asc: o.campo === 'numero' ? !o.asc : true }))}>Fatura{ordem.campo === 'numero' ? (ordem.asc ? ' ▲' : ' ▼') : ''}</button></th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase" aria-sort={ordem.campo === 'vencimento' ? (ordem.asc ? 'ascending' : 'descending') : undefined}><button type="button" className="uppercase hover:text-primary-700" title="Clique para ordenar" onClick={() => setOrdem(o => ({ campo: 'vencimento', asc: o.campo === 'vencimento' ? !o.asc : true }))}>Vencimento{ordem.campo === 'vencimento' ? (ordem.asc ? ' ▲' : ' ▼') : ''}</button></th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase">Serviço prestado</th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase" title="Valor da fatura: serviço + acréscimo − débito − adiantamento">Vl fatura</th>
                    <th className="px-2 py-2 text-left text-[11px] font-medium text-slate-500 uppercase">Saldo</th>
                    <th className="px-2 py-2 text-right text-[11px] font-medium text-slate-500 uppercase sticky right-0 bg-slate-50">Ações</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-200">
                  {carregando && invoices.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500 text-sm">Carregando faturas...</td></tr>
                  )}
                  {!carregando && filteredInvoices.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400 text-sm">Nenhuma fatura com esses filtros.</td></tr>
                  )}
                  {faturasDaPagina.map((inv) => {
                    const calc = getInvoiceCalculations(inv);
                    const isExpanded = expandedRowId === inv.id;

                    return (
                      <React.Fragment key={inv.id}>
                        <tr className={`hover:bg-slate-50 ${inv.isCanceled ? 'bg-slate-50 opacity-75' : ''} ${selecionadas.has(inv.id) ? 'bg-primary-50/50' : ''}`}>
                          <td className="px-2 py-2 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {!isReadOnly && <input type="checkbox" aria-label={`Selecionar a fatura ${inv.invoiceNumber}`} className="h-4 w-4 accent-primary-600" checked={selecionadas.has(inv.id)}
                                onChange={() => setSelecionadas(prev => { const n = new Set(prev); n.has(inv.id) ? n.delete(inv.id) : n.add(inv.id); return n; })} />}
                              <button onClick={() => setExpandedRowId(isExpanded ? null : inv.id)} className="text-slate-400 hover:text-primary-600" aria-label={`${isExpanded ? 'Recolher' : 'Ver detalhes d'}a fatura ${inv.invoiceNumber}`} aria-expanded={isExpanded}>
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {inv.substituidaPor
                              ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700" title={`Substituída por ${inv.substituidaPor}${inv.cancelamentoMotivo ? `: ${inv.cancelamentoMotivo}` : ''}`}><RefreshCcw size={12} className="mr-1" /> Substituída</span>
                              : <span title={inv.isCanceled && inv.cancelamentoMotivo ? `Motivo: ${inv.cancelamentoMotivo}` : undefined}>{getStatusBadge(inv.status)}</span>}
                            {inv.contestada && !inv.isCanceled && <div className="mt-1"><span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800">Contestada</span></div>}
                            {!inv.isCanceled && <div className="mt-1 flex gap-1" aria-label="Andamento da fatura">
                              {([['E', 'Enviada', inv.enviadaEm], ['C', 'Certificada', inv.certificadaEm], ['S', 'SIAFI', inv.siafiEm]] as const).map(([l, nome, d]) => (
                                <span key={l} title={d ? `${nome} em ${dataBR(d)}` : `${nome}: pendente`} aria-label={d ? `${nome} em ${dataBR(d)}` : `${nome}: pendente`}
                                  className={`inline-flex w-5 h-5 items-center justify-center rounded text-[10px] font-bold ${d ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-400'}`}>{l}</span>
                              ))}
                            </div>}
                          </td>
                          <td className="px-2 py-2 text-xs text-slate-500 whitespace-nowrap">{inv.competence}</td>
                          <td className="px-2 py-2 max-w-[200px]"><div className="text-sm font-medium text-slate-900 leading-tight break-words" title={inv.client}>{inv.client}</div><div className="text-[11px] text-slate-500 truncate" title={inv.type}>UG {inv.ug || '—'} · {inv.type}</div></td>
                          <td className="px-2 py-2 text-xs font-mono text-slate-600 whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {inv.invoiceNumber}
                              <PontoIcone pontos={inv.pontos} onClick={() => setPontosAlvo({ alvo: 'fatura', id: inv.id, titulo: inv.invoiceNumber, subtitulo: `${inv.ug || ''} ${inv.client} · ${inv.type} · ${inv.competence}`, pontos: inv.pontos || [] })} />
                            </span>
                          </td>
                                                    <td className="px-2 py-2 text-xs text-slate-600 whitespace-nowrap">{dataBR(inv.dueDate)}</td>
                          <td className="px-2 py-2 text-right whitespace-nowrap">
                            <div className="text-sm font-semibold text-slate-900 tabular-nums">R$ {calc.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
                            {(calc.add > 0 || calc.ded > 0 || calc.totalAdvanceUsed > 0) && <div className="text-[11px] leading-tight text-slate-500">
                              {calc.add > 0 && <span title="Acréscimo">+{calc.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} </span>}
                              {calc.ded > 0 && <span title="Débito">−{calc.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} </span>}
                              {calc.totalAdvanceUsed > 0 && <span className="text-orange-600" title="Adiantamento abatido">adiant. {calc.totalAdvanceUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                            </div>}
                          </td>
                          <td className="px-2 py-2 text-sm font-bold text-indigo-700 text-right whitespace-nowrap tabular-nums">R$ {calc.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 text-sm font-bold text-slate-800 text-right whitespace-nowrap tabular-nums">R$ {calc.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                          <td className="px-2 py-2 whitespace-nowrap text-right text-sm font-medium sticky right-0 bg-white shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]">
                            <div className="flex flex-wrap justify-end gap-1.5 w-[96px] ml-auto">
                              <button onClick={() => baixarPdfFr172(inv).catch(e => notify.fail('Erro ao gerar o PDF', e))} className="text-slate-500 hover:text-slate-800" title="PDF da fatura (FR-172)" aria-label={`PDF da fatura ${inv.invoiceNumber}`}><Printer size={16} /></button>
                              <button onClick={() => setHistoricoDe(inv)} className="text-slate-400 hover:text-slate-800" title="Histórico: quem alterou e quando" aria-label={`Histórico da fatura ${inv.invoiceNumber}`}><History size={16} /></button>
                              {!inv.isCanceled && !isReadOnly && (
                                <>
                                  <button onClick={() => handleEdit(inv)} className="text-indigo-600 hover:text-indigo-900" title="Editar a fatura" aria-label={`Editar a fatura ${inv.invoiceNumber}`}><Edit2 size={16} /></button>
                                  <button onClick={() => setAcaoFatura({ tipo: 'substituir', fatura: inv })} className="text-sky-600 hover:text-sky-900" title="Retificar: cancela e substitui (nova versão)" aria-label={`Retificar a fatura ${inv.invoiceNumber}`}><RefreshCcw size={16} /></button>
                                  {!inv.contestada && <button onClick={() => setAcaoFatura({ tipo: 'contestar', fatura: inv })} className="text-amber-600 hover:text-amber-800" title="Abrir contestação" aria-label={`Contestar a fatura ${inv.invoiceNumber}`}><MessageSquareWarning size={16} /></button>}
                                  <button onClick={() => setAcaoFatura({ tipo: 'cancelar', fatura: inv })} className="text-orange-600 hover:text-orange-900" title="Cancelar fatura (motivo obrigatório)" aria-label={`Cancelar a fatura ${inv.invoiceNumber}`}><Ban size={16} /></button>
                                  {isAdmin && <button onClick={() => { setActionId(inv.id); setIsDeleteModalOpen(true); }} className="text-red-600 hover:text-red-900" title="Excluir (só administrador; para fatura emitida prefira cancelar ou retificar)" aria-label={`Excluir a fatura ${inv.invoiceNumber}`}><Trash2 size={16} /></button>}
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-50/80">
                            <td colSpan={10} className="px-6 py-4">
                              <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Dados e valores da fatura</h4>
                              <dl className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-2 text-sm max-w-4xl mb-4">
                                {([['UG', inv.ug || '—'], ['Serviço', inv.type || '—'], ['Competência', inv.competence || '—'], ['Emissão', dataBR(inv.issueDate) || '—'], ['Vencimento', dataBR(inv.dueDate) || '—'],
                                   ['Serviço prestado', `R$ ${calc.valService.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`], ['Acréscimo (+)', `R$ ${calc.add.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`], ['Débito (−)', `R$ ${calc.ded.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
                                   ['Adiantamento abatido', `R$ ${calc.totalAdvanceUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`], ['Valor da fatura', `R$ ${calc.valInvoice.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
                                   ['Pago', `R$ ${calc.totalPaymentUsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`], ['Saldo a pagar', `R$ ${calc.finalBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`]] as const).map(([r, v]) => (
                                  <div key={r}><dt className="text-[11px] text-slate-500">{r}</dt><dd className="font-semibold text-slate-800 tabular-nums">{v}</dd></div>
                                ))}
                              </dl>
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
                                    {(allocsByInvoice.get(inv.id) || []).map(a => {
                                      const doc = docsById.get(a.documentId);
                                      if (!doc) return null;
                                      const isAdvance = ehAdiantamento(a, doc);
                                      return (
                                        <tr key={a.id} className="border-t border-slate-100">
                                          <td className="px-3 py-2">
                                            <span className={`text-xs font-semibold px-2 py-1 rounded ${isAdvance ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}>
                                              {isAdvance ? 'ADIANTAMENTO' : 'PAGAMENTO'}
                                            </span>
                                          </td>
                                          <td className="px-3 py-2 text-slate-700">{doc.client}</td>
                                          <td className="px-3 py-2 text-slate-600">{doc.documentNumber}</td>
                                          <td className="px-3 py-2 text-slate-500">{dataBR(doc.date)}</td>
                                          <td className="px-3 py-2 text-right font-medium text-slate-700">R$ {a.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                        </tr>
                                      );
                                    })}
                                    {!(allocsByInvoice.get(inv.id) || []).length && (
                                      <tr><td colSpan={5} className="px-3 py-2 text-center text-slate-500 italic">{semCreditoTexto(inv, calcPorFatura.get(inv.id))}</td></tr>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                              <AcompanhamentoFatura inv={inv} podeEditar={!isReadOnly} onMudou={refresh} />
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
                    <tr><td colSpan={10} className="text-center py-8 text-slate-500">Nenhuma fatura encontrada.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {filteredInvoices.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50 text-sm text-slate-600">
                <span>
                  Mostrando <b>{(paginaAtual * porPagina + 1).toLocaleString('pt-BR')}</b>–<b>{Math.min((paginaAtual + 1) * porPagina, filteredInvoices.length).toLocaleString('pt-BR')}</b> de <b>{filteredInvoices.length.toLocaleString('pt-BR')}</b> faturas
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1">Por página
                    <select aria-label="Faturas por página" value={porPagina} onChange={e => setPorPagina(Number(e.target.value))} className="border border-slate-300 rounded px-1 py-0.5 bg-white">
                      {[25, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                  <Button size="sm" variant="secondary" onClick={() => setPagina(0)} disabled={paginaAtual === 0}>«</Button>
                  <Button size="sm" variant="secondary" onClick={() => setPagina(paginaAtual - 1)} disabled={paginaAtual === 0}>Anterior</Button>
                  <span className="tabular-nums">Página {paginaAtual + 1} de {totalPaginas}</span>
                  <Button size="sm" variant="secondary" onClick={() => setPagina(paginaAtual + 1)} disabled={paginaAtual >= totalPaginas - 1}>Próxima</Button>
                  <Button size="sm" variant="secondary" onClick={() => setPagina(totalPaginas - 1)} disabled={paginaAtual >= totalPaginas - 1}>»</Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* --- ANALYTICAL MAP TAB --- */}
      {activeTab === 'map' && (
        <MapaAnaliticoTab invoices={invoices.filter(i => passaPublico(publico, cls.faturaExtra(i)))} docs={allDocs.filter(d => passaPublico(publico, cls.docExtra(d)))} baixas={allocations} clients={clients} publico={publico}
          onVerFaturas={nome => { setSearchText(nome); setActiveTab('list'); }} />
      )}

      {/* Edit/Create Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingId ? 'Editar Fatura' : 'Nova fatura avulsa'}
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

        {!editingId && <div className="mb-3 p-2 text-xs rounded border border-amber-200 bg-amber-50 text-amber-900">A emissão regular é feita pelo lote em <b>Emitir faturas do mês</b> (numeração, datas e adiantamento automáticos). Use esta tela só para fatura avulsa; número fora do padrão gera ponto de atenção.</div>}
        <form className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="UG (Unidade Gestora)" value={formData.ug || ''} onChange={handleUgChange} placeholder="Ex: 789000 (Auto-preenchimento)" disabled={isReadOnly} />

          <Input label="Setor" required value={formData.sector || ''} onChange={e => setFormData({ ...formData, sector: e.target.value })} disabled={isReadOnly} />
          <Input label="Comando" required value={formData.command || ''} onChange={e => setFormData({ ...formData, command: e.target.value })} disabled={isReadOnly} />

          <SeletorCliente valor={formData.client || ''} omId={formData.omId} disabled={isReadOnly}
            onTexto={t => setFormData({ ...formData, client: t, omId: editingId && formData.omId !== undefined ? null : undefined })}
            onEscolher={c => setFormData({ ...formData, client: c.client, ug: c.ug, sector: c.sector, command: c.command, omId: c.omId })} />

          <Select label="Tipo de Fatura" required options={services} value={formData.type || ''} onChange={handleTypeChange} disabled={isReadOnly} />

          <Input label="Nº Fatura" required value={formData.invoiceNumber || ''} onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })} disabled={isReadOnly} />
          <Input label="Consumo" value={formData.consumption || ''} onChange={e => setFormData({ ...formData, consumption: e.target.value })} disabled={isReadOnly} />

          <div className="flex gap-2">
            <Input label="Sigla (Auto)" value={formData.serviceAcronym || ''} onChange={e => setFormData({ ...formData, serviceAcronym: e.target.value })} disabled={isReadOnly} placeholder="Ex: AE" />
            <Input label="Unid. Medida (Auto)" value={formData.unitMeasure || ''} onChange={e => setFormData({ ...formData, unitMeasure: e.target.value })} disabled={isReadOnly} placeholder="Ex: M³" />
          </div>

          <div>
            <CurrencyInput label="Valor Base" value={formData.value} onChange={val => setFormData({ ...formData, value: val })} disabled={isReadOnly || (!editingId && ehDaTaxa)} />
            {ehDaTaxa && (
              <p className={`mt-1 text-xs ${precoTaxa === null ? 'text-red-700' : 'text-slate-500'}`} role="note">
                {!formData.omId || !formData.yearCompetence ? 'Escolha o cliente do cadastro e o ano: o valor vem da taxa publicada pela página Taxa condominial e diárias.'
                  : precoTaxa === undefined ? 'Buscando o valor publicado...'
                  : precoTaxa === null ? `Sem ${siglaForm === 'TC' ? 'taxa condominial' : 'diária'} publicada para esta OM em ${formData.yearCompetence}: calcule e publique na página Taxa condominial e diárias.`
                  : editingId && Math.abs(Number(formData.value) - precoTaxa) > 0.005 ? `Atenção: o valor publicado para ${formData.yearCompetence} é R$ ${precoTaxa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.`
                  : `Valor publicado pela Taxa condominial (${formData.yearCompetence}). Para mudar, ajuste e publique lá; diferenças desta fatura vão em acréscimo/débito.`}
              </p>
            )}
          </div>

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

      <HistoricoModal tabela="invoices" registroId={historicoDe?.id ?? null} titulo={`Histórico da fatura ${historicoDe?.invoiceNumber ?? ''}`} onClose={() => setHistoricoDe(null)} />
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDelete}
        title="Excluir Fatura"
        message="Excluir apaga a fatura e TAMBÉM as baixas ligadas a ela (o saldo volta para a ALTCRED). Para fatura já emitida, prefira Cancelar ou Retificar. Esta ação não pode ser desfeita."
      />

      <ConfirmModal
        isOpen={isCancelModalOpen}
        onClose={() => setIsCancelModalOpen(false)}
        onConfirm={handleCancel}
        title="Cancelar Fatura"
        message="Tem certeza que deseja cancelar esta fatura? Ela será marcada como CANCELADA e qualquer saldo de adiantamento utilizado será devolvido ao documento de origem."
      />
      <AcoesFaturaModais acao={acaoFatura} onClose={() => setAcaoFatura(null)} onFeito={refresh} usuario={user?.name || user?.email || ''}
        numeros={invoices.map(i => i.invoiceNumber)} baixado={id => (allocsByInvoice.get(id) || []).reduce((s, a) => s + a.amount, 0)} />
      <PontosModal alvo={pontosAlvo} onClose={() => setPontosAlvo(null)} podeEditar={!isReadOnly} usuario={user?.name || user?.email || ''}
        onAlterado={async () => {
          await refresh();
          const inv = (await db.getInvoices()).find(i => i.id === pontosAlvo?.id);
          setPontosAlvo(a => (a && inv ? { ...a, pontos: inv.pontos || [] } : a));
        }} />
    </div>
  );
};
