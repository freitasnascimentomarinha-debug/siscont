
import { Invoice, ReceivedDocument, PaymentAllocation, CashFlowExit, CashFlowItem, User, UserRole, InvoiceStatus, OperationType, Client, ServiceDefinition } from '../types';
import { supabaseService } from './supabaseService';

export const db = {
  // --- USERS ---
  getUsers: async (): Promise<User[]> => {
    return await supabaseService.getUsers();
  },

  saveUser: async (user: User) => {
    // Note: Profiles are usually updated via Supabase Auth or a specific trigger.
    // For now, we use the profiles table.
    const { supabase } = await import('./supabase');
    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      name: user.name,
      role: user.role
    });
    if (error) throw error;
  },

  deleteUser: async (id: string) => {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
  },

  // --- CLIENTS ---
  getClients: async (): Promise<Client[]> => await supabaseService.getClients(),
  saveClient: async (client: Client) => await supabaseService.saveClient(client),
  deleteClient: async (id: string) => await supabaseService.deleteClient(id),

  // --- SERVICES ---
  getServices: async (): Promise<ServiceDefinition[]> => await supabaseService.getServices(),
  saveService: async (service: ServiceDefinition) => await supabaseService.saveService(service),
  deleteService: async (id: string) => await supabaseService.deleteService(id),

  // --- INVOICES ---
  getInvoices: async (): Promise<Invoice[]> => {
    const [invoices, allocations, documents] = await Promise.all([
      supabaseService.getInvoices(),
      supabaseService.getAllocations(),
      supabaseService.getDocuments()
    ]);

    return invoices.map(inv => {
      const invAllocations = allocations.filter(a => a.invoiceId === inv.id);
      let advancesTotal = 0;
      let paymentsTotal = 0;

      invAllocations.forEach(alloc => {
        const doc = documents.find(d => d.id === alloc.documentId);
        if (doc) {
          if (doc.operation === OperationType.ADIANTAMENTO) advancesTotal += alloc.amount;
          else paymentsTotal += alloc.amount;
        }
      });

      let status = InvoiceStatus.OPEN;
      const today = new Date().toISOString().split('T')[0];
      const baseValue = inv.value + (inv.adjustmentAddition || 0) - (inv.adjustmentDeduction || 0);
      const payableAmount = Math.max(0, baseValue - advancesTotal);

      if (inv.isCanceled) status = InvoiceStatus.CANCELLED;
      else if (paymentsTotal >= payableAmount - 0.01) status = InvoiceStatus.PAID;
      else if (inv.dueDate < today) status = InvoiceStatus.OVERDUE;
      else status = InvoiceStatus.OPEN;

      return { ...inv, paidAmount: paymentsTotal, status };
    });
  },

  saveInvoice: async (invoice: Invoice) => await supabaseService.saveInvoice(invoice),
  deleteInvoice: async (id: string) => await supabaseService.deleteInvoice(id),

  // --- DOCUMENTS ---
  getDocuments: async (): Promise<ReceivedDocument[]> => {
    const [docs, allocations, invoices] = await Promise.all([
      supabaseService.getDocuments(),
      supabaseService.getAllocations(),
      supabaseService.getInvoices()
    ]);

    return docs.map(doc => {
      const used = allocations
        .filter(a => {
          if (a.documentId !== doc.id) return false;
          const inv = invoices.find(i => i.id === a.invoiceId);
          return inv && !inv.isCanceled;
        })
        .reduce((sum, a) => sum + a.amount, 0);
      return { ...doc, availableValue: doc.totalValue - used };
    });
  },

  saveDocument: async (doc: ReceivedDocument) => await supabaseService.saveDocument(doc),
  deleteDocument: async (id: string) => await supabaseService.deleteDocument(id),

  // --- ALLOCATIONS ---
  getAllocations: async (): Promise<PaymentAllocation[]> => await supabaseService.getAllocations(),
  saveAllocation: async (alloc: PaymentAllocation) => await supabaseService.saveAllocation(alloc),
  deleteAllocation: async (id: string) => await supabaseService.deleteAllocation(id),

  // --- CASH FLOW ---
  getExits: async (): Promise<CashFlowExit[]> => await supabaseService.getExits(),
  saveExit: async (exit: CashFlowExit) => await supabaseService.saveExit(exit),
  deleteExit: async (id: string) => await supabaseService.deleteExit(id),

  getCashFlow: async (): Promise<CashFlowItem[]> => {
    const [docs, exits] = await Promise.all([
      supabaseService.getDocuments(),
      supabaseService.getExits()
    ]);

    const items: CashFlowItem[] = [];
    docs.forEach(d => {
      items.push({ id: d.id, date: d.date, documentNumber: d.documentNumber, client: d.client, type: 'ENTRY', value: d.totalValue, description: `Entrada via ${d.documentType} (${d.operation})`, observation: d.observation, balanceAfter: 0 });
    });
    exits.forEach(e => {
      items.push({ id: e.id, date: e.date, documentNumber: e.documentNumber, client: e.client, type: 'EXIT', value: e.value, rubric: e.rubric, description: e.description, observation: e.observation, isCanceled: e.isCanceled, balanceAfter: 0 });
    });

    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let balance = 0;
    let currentYear = '';
    return items.map(item => {
      const itemYear = item.date.substring(0, 4);
      if (itemYear !== currentYear) { balance = 0; currentYear = itemYear; }
      if (item.type === 'ENTRY') balance += item.value;
      else if (!item.isCanceled) balance -= item.value;
      return { ...item, balanceAfter: balance };
    });
  },

  // --- SYNC & BACKUP ---
  syncToSupabase: async () => {
    const { getInvoices, getDocuments, getAllocations, getClients, getServices, getUsers, getExits } = supabaseService;
    // This is a manual migration helper
    const localClients = JSON.parse(localStorage.getItem('siscont_clients') || '[]');
    for (const c of localClients) await supabaseService.saveClient(c);
    const localServices = JSON.parse(localStorage.getItem('siscont_services') || '[]');
    for (const s of localServices) await supabaseService.saveService(s);
    const localInvoices = JSON.parse(localStorage.getItem('siscont_invoices') || '[]');
    for (const i of localInvoices) await supabaseService.saveInvoice(i);
    const localDocs = JSON.parse(localStorage.getItem('siscont_documents') || '[]');
    for (const d of localDocs) await supabaseService.saveDocument(d);
    const localAllocs = JSON.parse(localStorage.getItem('siscont_allocations') || '[]');
    for (const a of localAllocs) await supabaseService.saveAllocation(a);
    const localExits = JSON.parse(localStorage.getItem('siscont_exits') || '[]');
    for (const e of localExits) await supabaseService.saveExit(e);
  },

  pullFromSupabase: async () => {
    const [cl, sv, inv, doc, alc, ext] = await Promise.all([
      supabaseService.getClients(),
      supabaseService.getServices(),
      supabaseService.getInvoices(),
      supabaseService.getDocuments(),
      supabaseService.getAllocations(),
      supabaseService.getExits()
    ]);
    localStorage.setItem('siscont_clients', JSON.stringify(cl));
    localStorage.setItem('siscont_services', JSON.stringify(sv));
    localStorage.setItem('siscont_invoices', JSON.stringify(inv));
    localStorage.setItem('siscont_documents', JSON.stringify(doc));
    localStorage.setItem('siscont_allocations', JSON.stringify(alc));
    localStorage.setItem('siscont_exits', JSON.stringify(ext));
  },

  restoreBackup: async (data: any) => {
    if (data.clients) localStorage.setItem('siscont_clients', JSON.stringify(data.clients));
    if (data.services) localStorage.setItem('siscont_services', JSON.stringify(data.services));
    if (data.invoices) localStorage.setItem('siscont_invoices', JSON.stringify(data.invoices));
    if (data.documents) localStorage.setItem('siscont_documents', JSON.stringify(data.documents));
    if (data.allocations) localStorage.setItem('siscont_allocations', JSON.stringify(data.allocations));
    if (data.exits) localStorage.setItem('siscont_exits', JSON.stringify(data.exits));
    if (data.users) localStorage.setItem('siscont_users', JSON.stringify(data.users));
  },

  getAllData: () => ({
    invoices: JSON.parse(localStorage.getItem('siscont_invoices') || '[]'),
    documents: JSON.parse(localStorage.getItem('siscont_documents') || '[]'),
    allocations: JSON.parse(localStorage.getItem('siscont_allocations') || '[]'),
    clients: JSON.parse(localStorage.getItem('siscont_clients') || '[]'),
    services: JSON.parse(localStorage.getItem('siscont_services') || '[]'),
    users: JSON.parse(localStorage.getItem('siscont_users') || '[]'),
    exits: JSON.parse(localStorage.getItem('siscont_exits') || '[]')
  })
};
