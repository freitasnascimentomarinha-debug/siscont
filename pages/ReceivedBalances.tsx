
import { dataBR, hojeISO } from '../utils/datas';
import { MultiFiltro } from '../components/ui/MultiFiltro';
import { FaturasParaPagar, SelecaoPagamento } from '../components/recebimentos/FaturasParaPagar';
import { distribuirPagamento, resumoPagamento, saldoDaFatura } from '../utils/pagamentoDocumento';
import { criarResolvedor, Rotulo } from '../utils/documentosOM';
import { SeletorCliente } from '../components/ui/SeletorCliente';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/db';
import { useAuth } from '../context/AuthContext';
import { AlvoPontos, PontoIcone, PontosModal } from '../components/PontosAtencao';
import { pendentes } from '../utils/pontosAtencao';
import { ImportarSipladModal } from '../components/recebimentos/ImportarSipladModal';
import { BaixaAssistidaModal } from '../components/recebimentos/BaixaAssistidaModal';
import { ResumoAdiantamentos } from '../components/recebimentos/ResumoAdiantamentos';
import { DadosSiplad, CamposFase2 } from '../components/recebimentos/DadosSiplad';
import { carregarCadastro, Cadastro } from '../services/recebimentosService';
import { notify, friendlyError } from '../utils/notify';
import { ReceivedDocument, Invoice, PaymentAllocation, DocumentType, OperationType, InvoiceStatus, UserRole, OM, CAMPOS_DOC_FASE2 } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select, CurrencyInput } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
import { Plus, Trash2, DollarSign, FileCheck, ChevronDown, ChevronUp, CheckCircle, Search, Edit2, Upload, FileSpreadsheet, FileText, Filter, X, Layers, Save, AlertOctagon, CheckSquare, Square } from 'lucide-react';
import { FileUp, Wand2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export const ReceivedBalances: React.FC = () => {
  const { user } = useAuth();
  const isReadOnly = user?.role === UserRole.READ_ONLY;
  const isAdmin = user?.role === UserRole.ADMIN;

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
  const [filterPontos, setFilterPontos] = useState('');
  const [pontosAlvo, setPontosAlvo] = useState<AlvoPontos | null>(null);

  // Forms & Modals
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [docFormData, setDocFormData] = useState<Partial<ReceivedDocument>>({});
  const [saveError, setSaveError] = useState<string | null>(null); // New: Validation Error State

  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [activeDoc, setActiveDoc] = useState<ReceivedDocument | null>(null);
  const [sipladAberto, setSipladAberto] = useState(false);
  const [baixaDoc, setBaixaDoc] = useState<ReceivedDocument | null>(null);
  const [oms, setOms] = useState<OM[]>([]);
  const [cad, setCad] = useState<Cadastro>({ oms: [], comandos: [], setores: [] });
  // filtros de várias escolhas (valores EXCLUÍDOS) pelo setor/comando/cliente do cadastro, e busca pela fatura paga
  const [exSetor, setExSetor] = useState<Set<string>>(new Set());
  const [exComando, setExComando] = useState<Set<string>>(new Set());
  const [exCliente, setExCliente] = useState<Set<string>>(new Set());
  const [filterFatura, setFilterFatura] = useState('');
  const [pagina, setPagina] = useState(0);
  // faturas escolhidas para pagar já na inclusão do documento
  const [pagarNaInclusao, setPagarNaInclusao] = useState<SelecaoPagamento>({ ids: [], manuais: {} });
  const [porPagina, setPorPagina] = useState(30);

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
  const [carregando, setCarregando] = useState(true);

  // Clients for Autofill
  const [clients, setClients] = useState<any[]>([]);

  const refresh = async () => {
    let docs, invs, allocs, clist;
    setCarregando(true);
    try {
      [docs, invs, allocs, clist] = await Promise.all([
        db.getDocuments(),
        db.getInvoices(),
        db.getAllocations(),
        db.getClients()
      ]);
      carregarCadastro().then(c => { setOms(c.oms); setCad(c); });
    } catch (err) {
      notify.fail('Erro ao carregar saldos', err);
      setCarregando(false);
      return;
    }
    setCarregando(false);
    setDocuments(docs);
    setInvoices(invs);
    setAllocations(allocs);
    setClients(clist);
  };

  useEffect(() => { refresh(); }, []);
  // volta para a 1ª página quando os filtros ou a aba mudam
  useEffect(() => { setPagina(0); }, [activeTab, filterMonth, filterYear, filterStatus, filterClient, filterDocNumber, filterUG, filterPontos, filterFatura, exSetor, exComando, exCliente, porPagina]);

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

  // --- OM de cada documento pelo cadastro (setor/comando/cliente), não pelo texto digitado ---
  const resolv = useMemo(() => criarResolvedor(cad.oms, cad.comandos, cad.setores), [cad]);
  const rotulos = useMemo(() => new Map<string, Rotulo>(documents.map(d => [d.id, resolv.rotuloDoDocumento(d)])), [documents, resolv]);
  const rot = (d: ReceivedDocument) => rotulos.get(d.id) || { omId: null, setor: d.sector || 'Sem setor', comando: d.command || 'Sem comando', cliente: d.client || 'Sem cliente', comandoId: null };
  const faturasPagasPorDoc = useMemo(() => {
    const num = new Map(invoices.map(i => [i.id, (i.invoiceNumber || '').toLowerCase()]));
    const m = new Map<string, string[]>();
    allocations.forEach(a => { const n = num.get(a.invoiceId); if (n) m.set(a.documentId, [...(m.get(a.documentId) || []), n]); });
    return m;
  }, [invoices, allocations]);
  const daAba = (d: ReceivedDocument) => d.operation === activeTab || (activeTab === OperationType.ADIANTAMENTO && !!d.sobraAdiantamento);
  const uniq = (l: string[]) => [...new Set(l)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const opSetores = useMemo(() => uniq(documents.filter(daAba).map(d => rot(d).setor)), [documents, rotulos, activeTab]);
  const opComandos = useMemo(() => uniq(documents.filter(daAba).map(d => rot(d).comando)), [documents, rotulos, activeTab]);
  const opClientes = useMemo(() => uniq(documents.filter(daAba).map(d => rot(d).cliente)), [documents, rotulos, activeTab]);

  // --- Filtering Logic ---
  const filteredDocs = documents.filter(d => {
    // 1. Tab Filter
    // sobra de ALTCRED de pagamento enviada para adiantamento aparece também na aba Adiantamentos
    if (d.operation !== activeTab && !(activeTab === OperationType.ADIANTAMENTO && d.sobraAdiantamento)) return false;

    // 2. Date Filter
    // a data vem como AAAA-MM-DD: ler o texto (new Date() leria em UTC e o dia 1º cairia no mês anterior)
    const month = String(Number((d.date || '').slice(5, 7)));
    const year = (d.date || '').slice(0, 4);
    if (filterMonth && month !== filterMonth) return false;
    if (filterYear && year !== filterYear) return false;

    // 3. Status Filter
    if (filterStatus === 'with_balance' && d.availableValue <= 0) return false;
    if (filterStatus === 'no_balance' && d.availableValue > 0) return false;

    // 4. Text Filters
    const r = rot(d);
    if (exSetor.has(r.setor) || exComando.has(r.comando) || exCliente.has(r.cliente)) return false;
    if (filterClient && !(d.client || '').toLowerCase().includes(filterClient.toLowerCase())) return false;
    if (filterFatura.trim() && !(faturasPagasPorDoc.get(d.id) || []).some(n => n.includes(filterFatura.trim().toLowerCase()))) return false;
    if (filterDocNumber && !(d.documentNumber || '').toLowerCase().includes(filterDocNumber.toLowerCase())) return false;
    if (filterUG && !(d.ug || '').toLowerCase().includes(filterUG.toLowerCase())) return false;
    if (filterPontos) {
      const abertos = pendentes(d.pontos);
      if (filterPontos === 'any' ? !abertos.length : !abertos.some(p => p.gravidade === filterPontos)) return false;
    }

    return true;
  });

  // --- Header Stats Calculations ---
  const stats = {
    count: filteredDocs.length,
    countWithBalance: filteredDocs.filter(d => d.availableValue > 0).length,
    totalValue: filteredDocs.reduce((acc, d) => acc + d.totalValue, 0),
    totalAvailable: filteredDocs.reduce((acc, d) => acc + d.availableValue, 0)
  };

  // --- Grouping Logic (Setor > Comando > Cliente do cadastro), com paginação e subtotais ---
  const ordenados = useMemo(() => [...filteredDocs].sort((a, b) => {
    const ra = rot(a), rb = rot(b);
    return ra.setor.localeCompare(rb.setor, 'pt-BR') || ra.comando.localeCompare(rb.comando, 'pt-BR') || ra.cliente.localeCompare(rb.cliente, 'pt-BR') || (b.date || '').localeCompare(a.date || '');
  }), [filteredDocs, rotulos]);
  const totaisGrupo = useMemo(() => {
    const m = new Map<string, { qtd: number; total: number; disponivel: number }>();
    const add = (k: string, d: ReceivedDocument) => { const t = m.get(k) || { qtd: 0, total: 0, disponivel: 0 }; t.qtd++; t.total += d.totalValue; t.disponivel += d.availableValue; m.set(k, t); };
    filteredDocs.forEach(d => { const r = rot(d); add(r.setor, d); add(`${r.setor}|${r.comando}`, d); add(`${r.setor}|${r.comando}|${r.cliente}`, d); });
    return m;
  }, [filteredDocs, rotulos]);
  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const daPagina = ordenados.slice(paginaAtual * porPagina, (paginaAtual + 1) * porPagina);
  const groupedDocs = daPagina.reduce((acc, doc) => {
    const r = rot(doc);
    if (!acc[r.setor]) acc[r.setor] = {};
    if (!acc[r.setor][r.comando]) acc[r.setor][r.comando] = {};
    if (!acc[r.setor][r.comando][r.cliente]) acc[r.setor][r.comando][r.cliente] = [];
    acc[r.setor][r.comando][r.cliente].push(doc);
    return acc;
  }, {} as Record<string, Record<string, Record<string, ReceivedDocument[]>>>);
  const subtotal = (k: string) => { const t = totaisGrupo.get(k); return t ? `${t.qtd} doc · recebido R$ ${t.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · disponível R$ ${t.disponivel.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : ''; };

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
      date: docFormData.date || hojeISO(),
      informedAdvance: false,
      operation: (docFormData.operation as OperationType) || OperationType.PAGAMENTO,
      observation: docFormData.observation || '',
      // campos da Fase 2 (ALTCRED do SIPLAD, destinação, GRU): só os que existem no formulário/registro
      ...Object.fromEntries(CAMPOS_DOC_FASE2.map(([k]) => [k, docFormData[k]]).filter(([, v]) => v !== undefined)),
    };

    // faturas escolhidas para pagar já na inclusão (só documento novo; não vale para "Outros")
    const escolhidas = !editingId && payload.operation !== OperationType.OUTROS
      ? pagarNaInclusao.ids.map(id => invoices.find(i => i.id === id)).filter(Boolean) as Invoice[] : [];
    const itens = distribuirPagamento(payload.totalValue, escolhidas.map(f => ({ id: f.id, saldo: saldoDaFatura(f) })), pagarNaInclusao.manuais).filter(i => i.valor > 0.005);
    if (resumoPagamento(payload.totalValue, itens).excedeu) {
      setSaveError('O valor a pagar nas faturas escolhidas passa do valor do documento. Ajuste os valores.');
      return;
    }

    try {
      await db.saveDocument(payload);
    } catch (err) {
      setSaveError(`Erro ao salvar: ${friendlyError(err)}`);
      return;
    }
    let baixas = 0;
    try {
      for (const it of itens) {
        await db.saveAllocation({
          id: uuidv4(), documentId: payload.id, invoiceId: it.id, amount: it.valor, date: payload.date,
          siscontSettled: false, siscontDueDate: '', observation: '', serviceType: invoices.find(i => i.id === it.id)?.type || '',
          tipoBaixa: payload.operation === OperationType.ADIANTAMENTO ? 'ADIANTAMENTO' : 'PAGAMENTO',
        });
        baixas++;
      }
    } catch (err) {
      notify.fail(`Documento salvo, mas houve erro depois de ${baixas} baixa(s); confira e complete pelo botão "Pagar faturas"`, err);
    }
    setIsDocModalOpen(false);
    setDocFormData({});
    setEditingId(null);
    setSaveError(null);
    setPagarNaInclusao({ ids: [], manuais: {} });
    notify.success(baixas ? `Documento salvo e ${baixas} fatura(s) baixada(s).` : 'Documento salvo.');
    await refresh();
  };

  const handleAllocate = async () => {
    if (isReadOnly) return;
    if (!activeDoc || selectedInvoiceIds.length === 0) return;

    let currentBalance = activeDoc.availableValue;
    let created = 0;

    try {
    for (const invId of selectedInvoiceIds) {
      const inv = invoices.find(i => i.id === invId);
      if (!inv || currentBalance <= 0) continue;

      const totalUsed = allocations.filter(a => a.invoiceId === inv.id).reduce((sum, a) => sum + a.amount, 0);
      const debt = saldoDaFatura(inv, totalUsed);

      const payment = Math.min(debt, currentBalance);

      if (payment > 0.005) {
        await db.saveAllocation({
          id: uuidv4(),
          documentId: activeDoc.id,
          invoiceId: inv.id,
          amount: payment,
          date: hojeISO(),
          siscontSettled: paymentMeta.siscontSettled,
          siscontDueDate: paymentMeta.siscontDueDate,
          observation: paymentMeta.observation,
          serviceType: paymentMeta.serviceType,
          tipoBaixa: activeDoc.operation === OperationType.ADIANTAMENTO ? 'ADIANTAMENTO' : 'PAGAMENTO',
        });
        currentBalance -= payment;
        created++;
      }
    }
    } catch (err) {
      notify.fail(created > 0 ? `Erro após registrar ${created} pagamento(s)` : 'Erro ao registrar pagamento', err);
      await refresh();
      return;
    }

    notify.success(created > 0 ? `${created} pagamento(s) registrado(s).` : 'Nenhum valor a pagar nas faturas selecionadas.');
    setIsPayModalOpen(false);
    setSelectedInvoiceIds([]);
    await refresh();
  };

  const handleUpdateAllocation = async () => {
    if (isReadOnly) return;
    if (allocFormData.id && allocFormData.amount) {
      const original = allocations.find(a => a.id === allocFormData.id);
      if (original) {
        try {
          await db.saveAllocation({
            ...original,
            ...allocFormData,
            amount: Number(allocFormData.amount)
          } as PaymentAllocation);
          notify.success('Pagamento atualizado.');
        } catch (err) {
          notify.fail('Erro ao atualizar pagamento', err);
          return;
        }
      }
      setIsEditAllocModalOpen(false);
      setAllocFormData({});
      await refresh();
    }
  };

  const invoicesById = useMemo(() => new Map(invoices.map(i => [i.id, i])), [invoices]);
  const alocadoPorFatura = useMemo(() => {
    const m = new Map<string, number>();
    allocations.forEach(a => m.set(a.invoiceId, (m.get(a.invoiceId) || 0) + a.amount));
    return m;
  }, [allocations]);

  const getDocAllocations = (docId: string) => {
    return allocations.filter(a => a.documentId === docId).map(a => {
      const inv = invoicesById.get(a.invoiceId);
      return { ...a, invoiceNumber: inv?.invoiceNumber, invoiceValue: inv?.value, invoiceClient: inv?.client, invoiceCanceled: !!inv?.isCanceled };
    });
  };

  const openInvoices = useMemo(() => invoices.filter(i => i.status !== InvoiceStatus.PAID && i.status !== InvoiceStatus.CANCELLED), [invoices]);

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
        dataBR(d.date),
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
          const inv = invoicesById.get(a.invoiceId);
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
          const inv = invoicesById.get(a.invoiceId);
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
                date: cols[3] || hojeISO(),
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
          <h2 className="text-2xl font-bold text-slate-800">Recebimentos (ALTCRED/GRU)</h2>
          <p className="text-slate-500">ALTCRED, GRU, baixas nas faturas e adiantamentos · agrupados por setor, comando e OM do cadastro</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <>
              <input type="file" ref={fileInputRef} onChange={handleImport} accept=".csv" className="hidden" />
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} title="Importação antiga por CSV (a importação normal é pelo PDF do SIPLAD)">
                <Upload className="w-4 h-4 mr-2" /> Importar CSV
              </Button>
            </>
          )}
          {!isReadOnly && (
            <Button variant="secondary" size="sm" onClick={() => setSipladAberto(true)}>
              <FileUp className="w-4 h-4 mr-2" /> PDF do SIPLAD
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={exportExcel}>
            <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={exportPDF}>
            <FileText className="w-4 h-4 mr-2" /> PDF
          </Button>
          {!isReadOnly && (
            <Button onClick={() => { setEditingId(null); setDocFormData({}); setSaveError(null); setPagarNaInclusao({ ids: [], manuais: {} }); setIsDocModalOpen(true); }}>
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
          <Input label="Cliente (texto)" value={filterClient} onChange={e => setFilterClient(e.target.value)} placeholder="Nome no documento..." />
          <Input label="Fatura paga (nº)" value={filterFatura} onChange={e => setFilterFatura(e.target.value)} placeholder="Ex.: 41000-TC-09..." />
          <Input label="Nº Doc" value={filterDocNumber} onChange={e => setFilterDocNumber(e.target.value)} placeholder="Buscar Nº..." />
          <Select label="Pontos de atenção" value={filterPontos} onChange={e => setFilterPontos(e.target.value)} options={[{ label: 'Com algum ponto', value: 'any' }, { label: 'Gravidade alta', value: 'alta' }, { label: 'Gravidade média', value: 'media' }, { label: 'Gravidade baixa', value: 'baixa' }]} />
        </div>
        <div className="flex flex-wrap items-end gap-4">
          <MultiFiltro rotulo="Setor" opcoes={opSetores} excluidos={exSetor} onChange={setExSetor} />
          <MultiFiltro rotulo="Comando" opcoes={opComandos} excluidos={exComando} onChange={setExComando} largura="w-96" />
          <MultiFiltro rotulo="Cliente (OM)" opcoes={opClientes} excluidos={exCliente} onChange={setExCliente} largura="w-96" />
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={() => {
            setFilterMonth(''); setFilterYear(''); setFilterStatus('all'); setFilterUG(''); setFilterSector(''); setFilterCommand(''); setFilterClient(''); setFilterDocNumber('');
            setFilterFatura(''); setExSetor(new Set()); setExComando(new Set()); setExCliente(new Set()); setFilterPontos('');
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

      {activeTab === OperationType.ADIANTAMENTO && <ResumoAdiantamentos documentos={documents} baixas={allocations} faturas={invoices} />}

      {/* Hierarchical List: Sector > Command > Client > Documents */}
      <div className="space-y-6">
        {Object.keys(groupedDocs).sort().map(sector => (
          <div key={sector} className="space-y-4">
            <h3 className="text-lg font-bold text-slate-800 border-b border-slate-300 pb-1 flex items-center">
              <span className="w-2 h-6 bg-slate-800 rounded mr-2"></span> Setor: {sector}<span className="ml-3 text-xs font-normal text-slate-500">{subtotal(sector)}</span>
            </h3>

            {Object.keys(groupedDocs[sector]).sort().map(command => (
              <div key={command} className="pl-4 border-l-2 border-slate-200 ml-1 space-y-4">
                <h4 className="text-md font-semibold text-slate-600 uppercase tracking-wide">Comando: {command}<span className="ml-2 text-xs font-normal normal-case tracking-normal text-slate-500">{subtotal(`${sector}|${command}`)}</span></h4>

                {Object.keys(groupedDocs[sector][command]).sort().map(client => (
                  <div key={client} className="pl-4 space-y-2">
                    <h5 className="text-sm font-bold text-primary-700">Cliente: {client}<span className="ml-2 text-xs font-normal text-slate-500">{subtotal(`${sector}|${command}|${client}`)}</span></h5>

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
                                    <PontoIcone pontos={doc.pontos} onClick={() => setPontosAlvo({ alvo: 'documento', id: doc.id, titulo: doc.documentNumber, subtitulo: `${doc.documentType} · ${doc.client}`, pontos: doc.pontos || [] })} />
                                    <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-600">{doc.documentType}</span>
                                    {doc.ug && <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700">UG: {doc.ug}</span>}
                                    {doc.aguardando && doc.availableValue > 0.005 && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800" title="O cliente ainda não indicou as faturas">Aguardando destinação</span>}
                                    {doc.sobraAdiantamento && <span className="text-xs px-2 py-0.5 rounded bg-yellow-100 text-yellow-800" title="A sobra desta ALTCRED de pagamento é usada como adiantamento">Sobra em adiantamento</span>}
                                    {!!doc.valorEstornado && <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">Estorno R$ {doc.valorEstornado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>}
                                    {doc.situacaoSiplad && !/processad/i.test(doc.situacaoSiplad) && <span className="text-xs px-2 py-0.5 rounded bg-slate-200 text-slate-700">SIPLAD: {doc.situacaoSiplad}</span>}
                                  </div>
                                  <p className="text-sm text-slate-500">{dataBR(doc.date)} - {doc.client}</p>
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
                                      {doc.availableValue > 0.005 && (
                                        <Button size="sm" variant="secondary" onClick={() => setBaixaDoc(doc)}>
                                          <Wand2 className="w-3 h-3 mr-1" /> Baixa assistida
                                        </Button>
                                      )}
                                      {activeTab === OperationType.PAGAMENTO && doc.availableValue > 0 && (
                                        <Button size="sm" onClick={() => { setActiveDoc(doc); setIsPayModalOpen(true); setSelectedInvoiceIds([]); setInvoiceSearch(''); }}>
                                          <DollarSign className="w-3 h-3 mr-1" /> Pagar Faturas
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                <DadosSiplad doc={doc} />
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
                                        <tr key={alloc.id} className={alloc.invoiceCanceled ? 'bg-red-50/50' : ''}>
                                          <td className="px-3 py-2">
                                            <div className="font-medium text-slate-800">
                                              {alloc.invoiceNumber}
                                              {alloc.invoiceCanceled && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold" title="Fatura cancelada: o valor não é descontado do documento e volta para o disponível">fatura cancelada</span>}
                                            </div>
                                            <div className="text-xs text-slate-400">{alloc.invoiceClient}</div>
                                          </td>
                                          <td className="px-3 py-2 text-slate-600">{alloc.serviceType || '-'}</td>
                                          <td className="px-3 py-2 text-slate-500">R$ {alloc.invoiceValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                          <td className={`px-3 py-2 font-medium ${alloc.invoiceCanceled ? 'text-slate-400 line-through' : 'text-emerald-600'}`} title={alloc.invoiceCanceled ? 'Não descontado do disponível (fatura cancelada)' : undefined}>R$ {alloc.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
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

        {carregando && documents.length === 0 && (
          <div className="p-8 text-center text-slate-500 text-sm bg-white rounded-lg border border-slate-200">Carregando documentos...</div>
        )}
        {!carregando && Object.keys(groupedDocs).length === 0 && (
          <div className="text-center py-12 bg-white rounded-lg border border-slate-200 text-slate-500">
            <Search size={48} className="mx-auto mb-4 text-slate-300" />
            <p>Nenhum documento encontrado para os filtros selecionados.</p>
          </div>
        )}
        {ordenados.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600" aria-label="Paginação dos documentos">
            <span>Mostrando <b>{paginaAtual * porPagina + 1}–{Math.min((paginaAtual + 1) * porPagina, ordenados.length)}</b> de <b>{ordenados.length}</b> documentos</span>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1">Por página
                <select aria-label="Documentos por página" value={porPagina} onChange={e => setPorPagina(Number(e.target.value))} className="border border-slate-300 rounded px-1 py-0.5">
                  {[30, 60, 120, 500].map(n => <option key={n} value={n}>{n}</option>)}
                </select></label>
              <Button size="sm" variant="secondary" onClick={() => setPagina(paginaAtual - 1)} disabled={paginaAtual === 0}>Anterior</Button>
              <span>Página {paginaAtual + 1} de {totalPaginas}</span>
              <Button size="sm" variant="secondary" onClick={() => setPagina(paginaAtual + 1)} disabled={paginaAtual >= totalPaginas - 1}>Próxima</Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal - Doc Create/Edit */}
      <Modal
        isOpen={isDocModalOpen}
        onClose={() => { setIsDocModalOpen(false); setEditingId(null); setDocFormData({}); setSaveError(null); setPagarNaInclusao({ ids: [], manuais: {} }); }}
        title={editingId ? "Editar Documento" : "Novo Documento"}
        maxWidth="max-w-3xl"
        footer={<div className="flex justify-end gap-2"><Button onClick={handleSaveDoc}>{!editingId && pagarNaInclusao.ids.length && docFormData.operation !== OperationType.OUTROS ? `Salvar e baixar ${pagarNaInclusao.ids.length} fatura(s)` : 'Salvar'}</Button></div>}
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

          <SeletorCliente valor={docFormData.client || ''}
            onTexto={t => setDocFormData({ ...docFormData, client: t })}
            onEscolher={c => setDocFormData({ ...docFormData, client: c.client, ug: c.ug, sector: c.sector, command: c.command, ...(c.comandoId ? { comandoId: c.comandoId } : {}) })} />
          <Input label="Setor" required value={docFormData.sector || ''} onChange={e => setDocFormData({ ...docFormData, sector: e.target.value })} />
          <Input label="Comando" required value={docFormData.command || ''} onChange={e => setDocFormData({ ...docFormData, command: e.target.value })} />

          <Input label="Observação" className="md:col-span-2" value={docFormData.observation || ''} onChange={e => setDocFormData({ ...docFormData, observation: e.target.value })} />
        </div>
        <CamposFase2 dados={docFormData} onChange={d => setDocFormData({ ...docFormData, ...d })} />
        {!editingId && docFormData.operation !== OperationType.OUTROS && (() => {
          const om = resolv.omDoDocumento({ client: docFormData.client || '', ug: docFormData.ug });
          return <FaturasParaPagar faturas={openInvoices} omId={om?.id ?? null} nomeOM={om?.nome} valorDoc={Number(docFormData.totalValue) || 0}
            selecao={pagarNaInclusao} onChange={setPagarNaInclusao} adiantamento={docFormData.operation === OperationType.ADIANTAMENTO} />;
        })()}
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
                const totalAllocated = alocadoPorFatura.get(inv.id) || 0;
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
          try {
            if (confirmDelete?.type === 'doc') await db.deleteDocument(confirmDelete.id);
            else if (confirmDelete?.type === 'alloc') await db.deleteAllocation(confirmDelete.id);
            notify.success('Registro excluído.');
          } catch (err) {
            notify.fail('Erro ao excluir', err);
          }
          await refresh();
          setConfirmDelete(null);
        }}
        title="Confirmação de Segurança"
        message="Tem certeza que deseja continuar? Esta ação afetará saldos e status das faturas permanentemente."
      />
      <ImportarSipladModal aberto={sipladAberto} onClose={() => setSipladAberto(false)} documentos={documents} onGravado={refresh} />
      <BaixaAssistidaModal doc={baixaDoc} onClose={() => setBaixaDoc(null)} invoices={invoices} documentos={documents} baixas={allocations} oms={oms} onGravado={refresh} />
      <PontosModal alvo={pontosAlvo} onClose={() => setPontosAlvo(null)} podeEditar={!isReadOnly} usuario={user?.name || user?.email || ''}
        onAlterado={async () => {
          await refresh();
          const d = (await db.getDocuments()).find(x => x.id === pontosAlvo?.id);
          setPontosAlvo(a => (a && d ? { ...a, pontos: d.pontos || [] } : a));
        }} />
    </div>
  );
};
