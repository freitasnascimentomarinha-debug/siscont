
import { supabase } from './supabase';
import {
    Invoice,
    ReceivedDocument,
    PaymentAllocation,
    CashFlowExit,
    Client,
    ServiceDefinition,
    User,
    CAMPOS_DOC_FASE2
} from '../types';

// --- Leitura paginada ---
// O Supabase (PostgREST) devolve no máximo 1.000 linhas por consulta. Com a migração das planilhas
// passam de 6.000 faturas, então todas as leituras de tabela inteira são feitas em páginas.
const PAGINA = 1000;
async function selectAll(tabela: string): Promise<{ data: any[]; error: any }> {
    // 1ª página já traz o total; as demais são pedidas em paralelo (6.700 faturas = 7 páginas de uma vez)
    const pagina = (de: number, contar = false) => supabase.from(tabela)
        .select('*', contar ? { count: 'exact' } : undefined)
        .order('id', { ascending: true }).range(de, de + PAGINA - 1);
    const primeira = await pagina(0, true);
    if (primeira.error) return { data: [], error: primeira.error };
    const todas: any[] = [...(primeira.data || [])];
    const total = primeira.count ?? todas.length;
    if (todas.length < PAGINA || total <= PAGINA) return { data: todas, error: null };
    const resto = await Promise.all(
        Array.from({ length: Math.ceil(total / PAGINA) - 1 }, (_, i) => pagina((i + 1) * PAGINA)),
    );
    for (const r of resto) {
        if (r.error) return { data: [], error: r.error };
        todas.push(...(r.data || []));
    }
    // linhas incluídas durante a leitura: busca o que passou do total contado
    if (resto.length && (resto[resto.length - 1].data || []).length === PAGINA) {
        for (let de = Math.ceil(total / PAGINA) * PAGINA; ; de += PAGINA) {
            const r = await pagina(de);
            if (r.error) return { data: [], error: r.error };
            todas.push(...(r.data || []));
            if (!r.data || r.data.length < PAGINA) break;
        }
    }
    return { data: todas, error: null };
}

// Campos da Fase 2 (script 006): lidos só se a coluna existe e enviados só se preenchidos,
// para o sistema continuar funcionando antes do script.
const NUMERICOS = new Set(['valor_original', 'valor_estornado']);
function doFase2(d: any): Partial<ReceivedDocument> {
    const out: any = {};
    CAMPOS_DOC_FASE2.forEach(([k, col]) => {
        if (!(col in d)) return;
        out[k] = NUMERICOS.has(col) && d[col] !== null ? Number(d[col]) : d[col];
    });
    return out;
}
function paraFase2(doc: ReceivedDocument): Record<string, any> {
    const out: Record<string, any> = {};
    CAMPOS_DOC_FASE2.forEach(([k, col]) => { if (doc[k] !== undefined) out[col] = doc[k]; });
    return out;
}

// --- Retry wrapper for write operations ---
const MAX_RETRIES = 3;
const BASE_DELAY = 300; // ms

async function withRetry<T>(operation: () => Promise<T>, label = 'operation'): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            return await operation();
        } catch (err: any) {
            lastError = err;
            // Only retry on network/transient errors, not auth/permission errors
            const isTransient = !err?.code || err?.code === 'PGRST301' || err?.message?.includes('fetch') || err?.message?.includes('network');
            if (!isTransient || attempt === MAX_RETRIES - 1) {
                throw err;
            }
            const delay = BASE_DELAY * Math.pow(3, attempt);
            console.warn(`⚠️ ${label} falhou (tentativa ${attempt + 1}/${MAX_RETRIES}), retentando em ${delay}ms...`, err?.message);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

export const supabaseService = {
    // --- USERS ---
    async getUsers(): Promise<User[]> {
        return await withRetry(async () => {
            const { data, error } = await selectAll('profiles');
            if (error) throw error;
            return data as User[];
        }, 'getUsers');
    },

    // --- CLIENTS ---
    async getClients(): Promise<Client[]> {
        return await withRetry(async () => {
            const { data, error } = await selectAll('clients');
            if (error) throw error;
            return data as Client[];
        }, 'getClients');
    },

    async saveClient(client: Client) {
        await withRetry(async () => {
            const { error } = await supabase.from('clients').upsert({
                id: client.id,
                ug: client.ug,
                sector: client.sector,
                command: client.command,
                name: client.name
            });
            if (error) throw error;
        }, 'saveClient');
    },

    async deleteClient(id: string) {
        await withRetry(async () => {
            const { error } = await supabase.from('clients').delete().eq('id', id);
            if (error) throw error;
        }, 'deleteClient');
    },

    // --- SERVICES ---
    async getServices(): Promise<ServiceDefinition[]> {
        return await withRetry(async () => {
            const { data, error } = await selectAll('service_definitions');
            if (error) throw error;
            return (data || []).map(s => ({
                id: s.id,
                name: s.name,
                unitMeasure: s.unit_measure,
                acronym: s.acronym
            }));
        }, 'getServices');
    },

    async saveService(service: ServiceDefinition) {
        await withRetry(async () => {
            const { error } = await supabase.from('service_definitions').upsert({
                id: service.id,
                name: service.name,
                unit_measure: service.unitMeasure,
                acronym: service.acronym
            });
            if (error) throw error;
        }, 'saveService');
    },

    async deleteService(id: string) {
        await withRetry(async () => {
            const { error } = await supabase.from('service_definitions').delete().eq('id', id);
            if (error) throw error;
        }, 'deleteService');
    },

    // --- INVOICES ---
    async getInvoices(): Promise<Invoice[]> {
        return await withRetry(async () => {
            const { data, error } = await selectAll('invoices');
            if (error) throw error;
            return (data || []).map(i => ({
                id: i.id,
                ug: i.ug,
                sector: i.sector,
                command: i.command,
                client: i.client,
                invoiceNumber: i.invoice_number,
                consumption: i.consumption,
                unitMeasure: i.unit_measure,
                serviceAcronym: i.service_acronym,
                value: Number(i.value),
                adjustmentAddition: Number(i.adjustment_addition),
                adjustmentDeduction: Number(i.adjustment_deduction),
                issueDate: i.issue_date,
                dueDate: i.due_date,
                monthCompetence: i.month_competence,
                yearCompetence: i.year_competence,
                competence: i.competence,
                type: i.type,
                isCanceled: i.is_canceled,
                observation: i.observation,
                sipladSettled: i.siplad_settled,
                // colunas do script 004 (ausentes antes dele: ficam undefined e não são reenviadas)
                omId: 'om_id' in i ? i.om_id : undefined,
                origem: 'origem' in i ? i.origem : undefined,
                quitacaoExterna: 'quitacao_externa' in i ? i.quitacao_externa : undefined,
                quitadaEm: 'quitada_em' in i ? i.quitada_em : undefined,
                contestada: 'contestada' in i ? i.contestada === true : undefined,
                pontosRegistro: Array.isArray(i.pontos_atencao) ? i.pontos_atencao : undefined,
                paidAmount: 0,
                status: 'OPEN' as any
            })) as Invoice[];
        }, 'getInvoices');
    },

    async saveInvoice(invoice: Invoice) {
        await withRetry(async () => {
            const { error } = await supabase.from('invoices').upsert({
                id: invoice.id,
                ug: invoice.ug,
                sector: invoice.sector,
                command: invoice.command,
                client: invoice.client,
                invoice_number: invoice.invoiceNumber,
                consumption: invoice.consumption,
                unit_measure: invoice.unitMeasure,
                service_acronym: invoice.serviceAcronym,
                value: invoice.value,
                adjustment_addition: invoice.adjustmentAddition,
                adjustment_deduction: invoice.adjustmentDeduction,
                issue_date: invoice.issueDate,
                due_date: invoice.dueDate,
                month_competence: invoice.monthCompetence,
                year_competence: invoice.yearCompetence,
                competence: invoice.competence,
                type: invoice.type,
                is_canceled: invoice.isCanceled,
                observation: invoice.observation,
                siplad_settled: invoice.sipladSettled,
                // campos do script 004: só enviados quando preenchidos (funciona antes do script)
                ...(invoice.omId !== undefined ? { om_id: invoice.omId } : {}),
                ...(invoice.contestada !== undefined ? { contestada: invoice.contestada } : {}),
                ...(invoice.quitacaoExterna !== undefined ? { quitacao_externa: invoice.quitacaoExterna, quitada_em: invoice.quitadaEm ?? null } : {}),
            });
            if (error) throw error;
        }, 'saveInvoice');
    },

    async deleteInvoice(id: string) {
        await withRetry(async () => {
            const { error } = await supabase.from('invoices').delete().eq('id', id);
            if (error) throw error;
        }, 'deleteInvoice');
    },

    // --- DOCUMENTS ---
    async getDocuments(): Promise<ReceivedDocument[]> {
        return await withRetry(async () => {
            const { data, error } = await selectAll('received_documents');
            if (error) throw error;
            return (data || []).map(d => ({
                id: d.id,
                ug: d.ug,
                sector: d.sector,
                command: d.command,
                client: d.client,
                documentNumber: d.document_number,
                documentType: d.document_type,
                totalValue: Number(d.total_value),
                date: d.date,
                operation: d.operation,
                observation: d.observation,
                comandoId: 'comando_id' in d ? d.comando_id : undefined,
                pontosRegistro: Array.isArray(d.pontos_atencao) ? d.pontos_atencao : undefined,
                origem: d.origem ?? null,
                ...doFase2(d),
                availableValue: 0,
                informedAdvance: false
            })) as ReceivedDocument[];
        }, 'getDocuments');
    },

    async saveDocument(doc: ReceivedDocument) {
        await withRetry(async () => {
            const { error } = await supabase.from('received_documents').upsert({
                id: doc.id,
                ug: doc.ug,
                sector: doc.sector,
                command: doc.command,
                client: doc.client,
                document_number: doc.documentNumber,
                document_type: doc.documentType,
                total_value: doc.totalValue,
                date: doc.date,
                operation: doc.operation,
                observation: doc.observation,
                ...(doc.comandoId !== undefined ? { comando_id: doc.comandoId } : {}),
                ...paraFase2(doc),
            });
            if (error && /column/i.test(error.message) && CAMPOS_DOC_FASE2.some(([, c]) => error.message.includes(c))) {
                throw new Error('Falta executar o script supabase/migrations/006_recebimentos_fase2.sql no Supabase para gravar os dados do SIPLAD, destinação e GRU.');
            }
            if (error) throw error;
        }, 'saveDocument');
    },

    async deleteDocument(id: string) {
        await withRetry(async () => {
            const { error } = await supabase.from('received_documents').delete().eq('id', id);
            if (error) throw error;
        }, 'deleteDocument');
    },

    // --- ALLOCATIONS ---
    async getAllocations(): Promise<PaymentAllocation[]> {
        return await withRetry(async () => {
            const { data, error } = await selectAll('payment_allocations');
            if (error) throw error;
            return (data || []).map(a => ({
                id: a.id,
                documentId: a.document_id,
                invoiceId: a.invoice_id,
                amount: Number(a.amount),
                date: a.date,
                serviceType: a.service_type,
                siscontSettled: a.siscont_settled,
                siscontDueDate: a.siscont_due_date,
                origem: 'origem' in a ? a.origem ?? undefined : undefined,
                tipoBaixa: 'tipo_baixa' in a ? a.tipo_baixa : undefined,
                observation: a.observation
            })) as PaymentAllocation[];
        }, 'getAllocations');
    },

    async saveAllocation(alloc: PaymentAllocation) {
        await withRetry(async () => {
            const linha: Record<string, any> = {
                id: alloc.id,
                document_id: alloc.documentId,
                invoice_id: alloc.invoiceId,
                amount: alloc.amount,
                date: alloc.date,
                service_type: alloc.serviceType,
                siscont_settled: alloc.siscontSettled,
                siscont_due_date: alloc.siscontDueDate,
                observation: alloc.observation,
                ...(alloc.tipoBaixa ? { tipo_baixa: alloc.tipoBaixa } : {}),
            };
            let { error } = await supabase.from('payment_allocations').upsert(linha);
            // antes do script 006 não existe a coluna tipo_baixa: grava sem ela
            if (error && /tipo_baixa/.test(error.message)) {
                delete linha.tipo_baixa;
                ({ error } = await supabase.from('payment_allocations').upsert(linha));
            }
            if (error) throw error;
        }, 'saveAllocation');
    },

    async deleteAllocation(id: string) {
        await withRetry(async () => {
            const { error } = await supabase.from('payment_allocations').delete().eq('id', id);
            if (error) throw error;
        }, 'deleteAllocation');
    },

    // --- CASH FLOW EXITS ---
    async getExits(): Promise<CashFlowExit[]> {
        return await withRetry(async () => {
            const { data, error } = await selectAll('cash_flow_exits');
            if (error) throw error;
            return (data || []).map(e => ({
                id: e.id,
                date: e.date,
                documentNumber: e.document_number,
                documentType: e.document_type,
                client: e.client,
                value: Number(e.value),
                rubric: e.rubric,
                description: e.description,
                observation: e.observation,
                isCanceled: e.is_canceled
            })) as CashFlowExit[];
        }, 'getExits');
    },

    async saveExit(exit: CashFlowExit) {
        await withRetry(async () => {
            const { error } = await supabase.from('cash_flow_exits').upsert({
                id: exit.id,
                date: exit.date,
                document_number: exit.documentNumber,
                document_type: exit.documentType,
                client: exit.client,
                value: exit.value,
                rubric: exit.rubric,
                description: exit.description,
                observation: exit.observation,
                is_canceled: exit.isCanceled
            });
            if (error) throw error;
        }, 'saveExit');
    },

    async deleteExit(id: string) {
        await withRetry(async () => {
            const { error } = await supabase.from('cash_flow_exits').delete().eq('id', id);
            if (error) throw error;
        }, 'deleteExit');
    }
};
