
import { supabase } from './supabase';
import {
    Invoice,
    ReceivedDocument,
    PaymentAllocation,
    CashFlowExit,
    Client,
    ServiceDefinition,
    User
} from '../types';

export const supabaseService = {
    // --- USERS ---
    async getUsers(): Promise<User[]> {
        const { data, error } = await supabase.from('profiles').select('*');
        if (error) throw error;
        return data as User[];
    },

    // --- CLIENTS ---
    async getClients(): Promise<Client[]> {
        const { data, error } = await supabase.from('clients').select('*');
        if (error) throw error;
        return data as Client[];
    },

    async saveClient(client: Client) {
        const { error } = await supabase.from('clients').upsert({
            id: client.id,
            ug: client.ug,
            sector: client.sector,
            command: client.command,
            name: client.name
        });
        if (error) throw error;
    },

    async deleteClient(id: string) {
        const { error } = await supabase.from('clients').delete().eq('id', id);
        if (error) throw error;
    },

    // --- SERVICES ---
    async getServices(): Promise<ServiceDefinition[]> {
        const { data, error } = await supabase.from('service_definitions').select('*');
        if (error) throw error;
        // Map snake_case to camelCase if necessary, but SQL schema used unit_measure
        return (data || []).map(s => ({
            id: s.id,
            name: s.name,
            unitMeasure: s.unit_measure,
            acronym: s.acronym
        }));
    },

    async saveService(service: ServiceDefinition) {
        const { error } = await supabase.from('service_definitions').upsert({
            id: service.id,
            name: service.name,
            unit_measure: service.unitMeasure,
            acronym: service.acronym
        });
        if (error) throw error;
    },

    async deleteService(id: string) {
        const { error } = await supabase.from('service_definitions').delete().eq('id', id);
        if (error) throw error;
    },

    // --- INVOICES ---
    async getInvoices(): Promise<Invoice[]> {
        const { data, error } = await supabase.from('invoices').select('*');
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
            paidAmount: 0, // This will be calculated by the logic later
            status: 'OPEN' as any
        })) as Invoice[];
    },

    async saveInvoice(invoice: Invoice) {
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
            siplad_settled: invoice.sipladSettled
        });
        if (error) throw error;
    },

    async deleteInvoice(id: string) {
        const { error } = await supabase.from('invoices').delete().eq('id', id);
        if (error) throw error;
    },

    // --- DOCUMENTS ---
    async getDocuments(): Promise<ReceivedDocument[]> {
        const { data, error } = await supabase.from('received_documents').select('*');
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
            availableValue: 0, // Calculated later
            informedAdvance: false
        })) as ReceivedDocument[];
    },

    async saveDocument(doc: ReceivedDocument) {
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
            observation: doc.observation
        });
        if (error) throw error;
    },

    async deleteDocument(id: string) {
        const { error } = await supabase.from('received_documents').delete().eq('id', id);
        if (error) throw error;
    },

    // --- ALLOCATIONS ---
    async getAllocations(): Promise<PaymentAllocation[]> {
        const { data, error } = await supabase.from('payment_allocations').select('*');
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
            observation: a.observation
        })) as PaymentAllocation[];
    },

    async saveAllocation(alloc: PaymentAllocation) {
        const { error } = await supabase.from('payment_allocations').upsert({
            id: alloc.id,
            document_id: alloc.documentId,
            invoice_id: alloc.invoiceId,
            amount: alloc.amount,
            date: alloc.date,
            service_type: alloc.serviceType,
            siscont_settled: alloc.siscontSettled,
            siscont_due_date: alloc.siscontDueDate,
            observation: alloc.observation
        });
        if (error) throw error;
    },

    async deleteAllocation(id: string) {
        const { error } = await supabase.from('payment_allocations').delete().eq('id', id);
        if (error) throw error;
    },

    // --- CASH FLOW EXITS ---
    async getExits(): Promise<CashFlowExit[]> {
        const { data, error } = await supabase.from('cash_flow_exits').select('*');
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
    },

    async saveExit(exit: CashFlowExit) {
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
    },

    async deleteExit(id: string) {
        const { error } = await supabase.from('cash_flow_exits').delete().eq('id', id);
        if (error) throw error;
    }
};
