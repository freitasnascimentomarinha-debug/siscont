
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
  console.log(`[Cache] Invalidando chaves: ${keys.length === 0 ? 'TUDO' : keys.join(', ')}`);
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
  // Gestão completa (criar login, senha, bloquear, excluir) fica em services/adminApi.ts,
  // pois exige a chave service_role no servidor. Aqui ficam apenas leitura e edição
  // de perfil, usadas como alternativa quando a API não está configurada.
  getUsers: async (): Promise<User[]> => {
    return cachedFetch('users', () => supabaseService.getUsers());
  },

  updateProfile: async (user: Pick<User, 'id'> & Partial<Pick<User, 'name' | 'role' | 'active'>>) => {
    const { supabase } = await import('./supabase');
    const { id, ...patch } = user;
    const { error } = await supabase.from('profiles').update(patch).eq('id', id);
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
  deleteInvoice: async (id: string) => {
    // Remove primeiro as alocações vinculadas para não deixar saldo "preso" em documentos
    const allocations = await supabaseService.getAllocations();
    for (const a of allocations.filter(a => a.invoiceId === id)) await supabaseService.deleteAllocation(a.id);
    await supabaseService.deleteInvoice(id);
    invalidateCache('raw_invoices', 'raw_allocations');
  },

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
  deleteDocument: async (id: string) => {
    const allocations = await supabaseService.getAllocations();
    for (const a of allocations.filter(a => a.documentId === id)) await supabaseService.deleteAllocation(a.id);
    await supabaseService.deleteDocument(id);
    invalidateCache('raw_documents', 'raw_allocations');
  },

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
      cachedFetch('raw_documents', () => supabaseService.getDocuments()),
      cachedFetch('exits', () => supabaseService.getExits())
    ]);

    const items: CashFlowItem[] = [];
    docs.forEach(d => {
      items.push({ id: d.id, date: d.date, documentNumber: d.documentNumber, client: d.client, type: 'ENTRY', value: d.totalValue, description: `Entrada via ${d.documentType} (${d.operation})`, observation: d.observation, balanceAfter: 0 });
    });
    exits.forEach(e => {
      items.push({ id: e.id, date: e.date, documentNumber: e.documentNumber, client: e.client, type: 'EXIT', value: e.value, rubric: e.rubric, description: e.description, observation: e.observation, isCanceled: e.isCanceled, documentType: e.documentType, balanceAfter: 0 });
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

  // --- BACKUP & RESTAURAÇÃO (dados no Supabase) ---
  /** Lê todas as tabelas diretamente do Supabase (sem cache) para gerar o backup. */
  getAllData: async () => {
    const [clients, services, invoices, documents, allocations, exits, users] = await Promise.all([
      supabaseService.getClients(),
      supabaseService.getServices(),
      supabaseService.getInvoices(),
      supabaseService.getDocuments(),
      supabaseService.getAllocations(),
      supabaseService.getExits(),
      supabaseService.getUsers().catch(() => [] as User[]),
    ]);
    const strip = <T extends object>(rows: T[], keys: string[]) =>
      rows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))));
    return {
      clients,
      services,
      // Campos calculados não vão para o backup
      invoices: strip(invoices, ['paidAmount', 'status']),
      documents: strip(documents, ['availableValue', 'informedAdvance']),
      allocations,
      exits,
      users: users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    };
  },

  /**
   * Restaura um backup gravando (upsert) no Supabase. Registros com o mesmo ID
   * são sobrescritos; registros que não estão no backup são mantidos.
   * Usuários NÃO são restaurados (logins são gerenciados pelo Supabase Auth).
   */
  restoreBackup: async (data: any, onProgress?: (msg: string) => void) => {
    const toBool = (v: any) => v === true || v === 'true' || v === 1 || v === 'TRUE';
    const toNum = (v: any) => (v === undefined || v === null || v === '' ? 0 : Number(v));
    const steps: [string, any[] | undefined, (r: any) => Promise<void>][] = [
      ['Clientes', data.clients, r => supabaseService.saveClient({ ...r, ug: String(r.ug ?? '') })],
      ['Serviços', data.services, r => supabaseService.saveService(r)],
      ['Faturas', data.invoices, r => supabaseService.saveInvoice({
        ...r,
        value: toNum(r.value),
        adjustmentAddition: toNum(r.adjustmentAddition),
        adjustmentDeduction: toNum(r.adjustmentDeduction),
        isCanceled: toBool(r.isCanceled),
        sipladSettled: toBool(r.sipladSettled),
        ug: r.ug !== undefined ? String(r.ug) : r.ug,
        invoiceNumber: String(r.invoiceNumber ?? ''),
      })],
      ['Documentos', data.documents, r => supabaseService.saveDocument({ ...r, totalValue: toNum(r.totalValue), ug: r.ug !== undefined ? String(r.ug) : r.ug, documentNumber: String(r.documentNumber ?? '') })],
      ['Alocações', data.allocations, r => supabaseService.saveAllocation({ ...r, amount: toNum(r.amount), siscontSettled: toBool(r.siscontSettled) })],
      ['Saídas', data.exits, r => supabaseService.saveExit({ ...r, value: toNum(r.value), isCanceled: toBool(r.isCanceled), documentNumber: String(r.documentNumber ?? '') })],
    ];
    const summary: Record<string, number> = {};
    for (const [label, rows, save] of steps) {
      if (!Array.isArray(rows)) continue;
      let count = 0;
      for (const row of rows) {
        if (!row?.id) continue;
        await save(row);
        count++;
        if (count % 25 === 0) onProgress?.(`${label}: ${count}/${rows.length}`);
      }
      summary[label] = count;
      onProgress?.(`${label}: ${count} registro(s)`);
    }
    invalidateCache();
    return summary;
  },

  /** Dados antigos salvos no navegador (versão anterior do sistema, antes do Supabase). */
  getLegacyLocalData: () => {
    const read = (k: string) => {
      try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; }
    };
    const data = {
      clients: read('siscont_clients'),
      services: read('siscont_services'),
      invoices: read('siscont_invoices'),
      documents: read('siscont_documents'),
      allocations: read('siscont_allocations'),
      exits: read('siscont_exits'),
    };
    const total = Object.values(data).reduce((n, arr: any) => n + (Array.isArray(arr) ? arr.length : 0), 0);
    return { data, total };
  },

  invalidateCache: invalidateCache,
  refreshCache: () => invalidateCache()
};
