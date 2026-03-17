
import { Invoice, ReceivedDocument, PaymentAllocation, CashFlowExit, CashFlowItem, User, UserRole, InvoiceStatus, OperationType, Client, ServiceDefinition } from '../types';
import { supabaseService } from './supabaseService';

// --- Simple In-Memory Cache ---
const CACHE_TTL = 30_000; // 30 seconds

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  promise?: Promise<T>; // Dedup in-flight requests
}

const cache = new Map<string, CacheEntry<any>>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) {
    return entry.data;
  }
  return null;
}

function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, timestamp: Date.now() });
}

function invalidateCache(...keys: string[]): void {
  if (keys.length === 0) {
    cache.clear();
  } else {
    keys.forEach(k => cache.delete(k));
  }
}

async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = getCached<T>(key);
  if (cached !== null) return cached;

  // Dedup: if already fetching this key, reuse the promise
  const existing = cache.get(key);
  if (existing?.promise) return existing.promise;

  const promise = fetcher().then(data => {
    setCached(key, data);
    return data;
  }).catch(err => {
    cache.delete(key);
    throw err;
  });

  cache.set(key, { data: null, timestamp: 0, promise });
  return promise;
}
export const db = {
  // --- USERS ---
  getUsers: async (): Promise<User[]> => {
    return cachedFetch('users', () => supabaseService.getUsers());
  },

  saveUser: async (user: User) => {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    });
    if (error) throw error;
    invalidateCache('users');
  },

  deleteUser: async (id: string) => {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
    invalidateCache('users');
  },

  // --- CLIENTS ---
  getClients: async (): Promise<Client[]> => cachedFetch('clients', () => supabaseService.getClients()),
  saveClient: async (client: Client) => { await supabaseService.saveClient(client); invalidateCache('clients'); },
  deleteClient: async (id: string) => { await supabaseService.deleteClient(id); invalidateCache('clients'); },

  // --- SERVICES ---
  getServices: async (): Promise<ServiceDefinition[]> => cachedFetch('services', () => supabaseService.getServices()),
  saveService: async (service: ServiceDefinition) => { await supabaseService.saveService(service); invalidateCache('services'); },
  deleteService: async (id: string) => { await supabaseService.deleteService(id); invalidateCache('services'); },

  // --- INVOICES ---
  getInvoices: async (): Promise<Invoice[]> => {
    const [invoices, allocations, documents] = await Promise.all([
      cachedFetch('raw_invoices', () => supabaseService.getInvoices()),
      cachedFetch('raw_allocations', () => supabaseService.getAllocations()),
      cachedFetch('raw_documents', () => supabaseService.getDocuments())
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

  saveInvoice: async (invoice: Invoice) => { await supabaseService.saveInvoice(invoice); invalidateCache('raw_invoices'); },
  deleteInvoice: async (id: string) => { await supabaseService.deleteInvoice(id); invalidateCache('raw_invoices'); },

  // --- DOCUMENTS ---
  getDocuments: async (): Promise<ReceivedDocument[]> => {
    const [docs, allocations, invoices] = await Promise.all([
      cachedFetch('raw_documents', () => supabaseService.getDocuments()),
      cachedFetch('raw_allocations', () => supabaseService.getAllocations()),
      cachedFetch('raw_invoices', () => supabaseService.getInvoices())
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

  saveDocument: async (doc: ReceivedDocument) => { await supabaseService.saveDocument(doc); invalidateCache('raw_documents'); },
  deleteDocument: async (id: string) => { await supabaseService.deleteDocument(id); invalidateCache('raw_documents'); },

  // --- ALLOCATIONS ---
  getAllocations: async (): Promise<PaymentAllocation[]> => cachedFetch('raw_allocations', () => supabaseService.getAllocations()),
  saveAllocation: async (alloc: PaymentAllocation) => { await supabaseService.saveAllocation(alloc); invalidateCache('raw_allocations'); },
  deleteAllocation: async (id: string) => { await supabaseService.deleteAllocation(id); invalidateCache('raw_allocations'); },

  // --- CASH FLOW ---
  getExits: async (): Promise<CashFlowExit[]> => cachedFetch('exits', () => supabaseService.getExits()),
  saveExit: async (exit: CashFlowExit) => { await supabaseService.saveExit(exit); invalidateCache('exits'); },
  deleteExit: async (id: string) => { await supabaseService.deleteExit(id); invalidateCache('exits'); },

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
