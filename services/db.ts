
import { hojeISO } from '../utils/datas';
import { Invoice, ReceivedDocument, PaymentAllocation, CashFlowExit, CashFlowItem, User, UserRole, InvoiceStatus, OperationType, Client, ServiceDefinition } from '../types';
import { supabaseService } from './supabaseService';
import { ehAdiantamento } from '../utils/baixas';
import { avaliarPontos, marcarResolvido, reabrir, PontoAtencao, RegistroPonto } from '../utils/pontosAtencao';

// --- Simple In-Memory Cache ---
// Gravações feitas por este navegador limpam o cache na hora; o prazo só vale para mudanças de outros usuários
const CACHE_TTL = 120_000; // 2 minutos

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
const TABELA_PONTOS = { fatura: 'invoices', documento: 'received_documents' } as const;
const SEM_005 = 'Falta executar o script supabase/migrations/005_pontos_atencao.sql no Supabase para gravar pontos de atenção.';

async function lerRegistros(alvo: 'fatura' | 'documento', id: string): Promise<RegistroPonto[]> {
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.from(TABELA_PONTOS[alvo]).select('pontos_atencao').eq('id', id).single();
  if (error) throw new Error(/pontos_atencao/.test(error.message) ? SEM_005 : error.message);
  return Array.isArray(data?.pontos_atencao) ? data.pontos_atencao : [];
}

async function gravarRegistros(alvo: 'fatura' | 'documento', id: string, registros: RegistroPonto[]) {
  const { supabase } = await import('./supabase');
  const { error } = await supabase.from(TABELA_PONTOS[alvo]).update({ pontos_atencao: registros }).eq('id', id);
  if (error) throw new Error(/pontos_atencao/.test(error.message) ? SEM_005 : error.message);
  invalidateCache(alvo === 'fatura' ? 'raw_invoices' : 'raw_documents');
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
  /**
   * Clientes para preenchimento automático (Faturas/Saldos). Vem do cadastro
   * hierárquico da Fase 1 (OM ativas); se o script 002 ainda não foi executado,
   * usa a tabela antiga `clients`.
   */
  getClients: async (): Promise<Client[]> => cachedFetch('clients', async () => {
    const { cadastroService, omsToClients, CadastroNaoInstaladoError } = await import('./cadastroService');
    try {
      const [oms, comandos, setores] = await Promise.all([
        cadastroService.listOMs(), cadastroService.listComandos(), cadastroService.listSetores(),
      ]);
      if (oms.length > 0) return omsToClients(oms, comandos, setores);
    } catch (err) {
      if (!(err instanceof CadastroNaoInstaladoError)) throw err;
    }
    return supabaseService.getClients();
  }),
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

    // Índices para não varrer listas grandes a cada fatura (milhares de faturas após a migração)
    const docPorId = new Map(documents.map(d => [d.id, d]));
    const porFatura = new Map<string, { adiant: number; pago: number }>();
    allocations.forEach(a => {
      const doc = docPorId.get(a.documentId);
      if (!doc) return;
      const t = porFatura.get(a.invoiceId) || { adiant: 0, pago: 0 };
      if (ehAdiantamento(a, doc)) t.adiant += a.amount; else t.pago += a.amount;
      porFatura.set(a.invoiceId, t);
    });
    const today = hojeISO(); // calendário local: às 21h de Brasília o UTC já é o dia seguinte e marcaria como vencida a fatura que vence hoje
    const pontos = avaliarPontos(invoices, documents, allocations).faturas;

    return invoices.map(inv => {
      const { adiant: advancesTotal, pago: paymentsTotal } = porFatura.get(inv.id) || { adiant: 0, pago: 0 };
      const baseValue = inv.value + (inv.adjustmentAddition || 0) - (inv.adjustmentDeduction || 0);
      const payableAmount = Math.max(0, baseValue - advancesTotal);

      let status = InvoiceStatus.OPEN;
      if (inv.isCanceled) status = InvoiceStatus.CANCELLED;
      // Quitada antes do SISCONT (histórico migrado sem o detalhe da ALTCRED/GRU)
      else if (inv.quitacaoExterna) status = InvoiceStatus.PAID;
      else if (paymentsTotal >= payableAmount - 0.01) status = InvoiceStatus.PAID;
      else if (inv.dueDate < today) status = InvoiceStatus.OVERDUE;
      else status = InvoiceStatus.OPEN;

      const paidAmount = inv.quitacaoExterna && !inv.isCanceled ? Math.max(paymentsTotal, payableAmount) : paymentsTotal;
      const saldoAPagar = status === InvoiceStatus.CANCELLED || status === InvoiceStatus.PAID ? 0 : Math.max(0, Math.round((payableAmount - paymentsTotal) * 100) / 100);
      return { ...inv, paidAmount, status, saldoAPagar, adiantamentoUsado: Math.round(advancesTotal * 100) / 100, pontos: pontos.get(inv.id) || [] };
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

    const canceladas = new Set(invoices.filter(i => i.isCanceled).map(i => i.id));
    const existentes = new Set(invoices.map(i => i.id));
    const usado = new Map<string, number>();
    allocations.forEach(a => {
      if (!existentes.has(a.invoiceId) || canceladas.has(a.invoiceId)) return;
      usado.set(a.documentId, (usado.get(a.documentId) || 0) + a.amount);
    });
    const pontos = avaliarPontos(invoices, docs, allocations).documentos;
    return docs.map(doc => ({ ...doc, availableValue: doc.totalValue - (usado.get(doc.id) || 0), pontos: pontos.get(doc.id) || [] }));
  },

  // --- PONTOS DE ATENÇÃO ---
  /** Marca um ponto como resolvido (ou "ciente", quando automático), com justificativa. */
  resolverPonto: async (alvo: 'fatura' | 'documento', id: string, ponto: PontoAtencao, por: string, justificativa: string) => {
    const atuais = await lerRegistros(alvo, id);
    await gravarRegistros(alvo, id, marcarResolvido(atuais, ponto, por, justificativa, new Date().toISOString().slice(0, 10)));
  },
  reabrirPonto: async (alvo: 'fatura' | 'documento', id: string, ponto: PontoAtencao) => {
    const atuais = await lerRegistros(alvo, id);
    await gravarRegistros(alvo, id, reabrir(atuais, ponto));
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
    // Cadastros da Fase 1 (vazios se o script 002 ainda não foi executado)
    const { cadastroService } = await import('./cadastroService');
    const seguro = async <T,>(f: () => Promise<T[]>): Promise<T[]> => { try { return await f(); } catch { return []; } };
    const [oms, comandos, setores, classes, parametros, feriados] = await Promise.all([
      seguro(cadastroService.listOMs), seguro(cadastroService.listComandos), seguro(cadastroService.listSetores),
      seguro(cadastroService.listClasses), seguro(cadastroService.listParametros), seguro(cadastroService.listFeriados),
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
      oms, comandos, setores, classes, parametros, feriados,
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
