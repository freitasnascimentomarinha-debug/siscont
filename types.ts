
// Enums
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
  READ_ONLY = 'READ_ONLY', // Added: Perfil de Consulta
}

export enum InvoiceStatus {
  OPEN = 'OPEN',
  PAID = 'PAID',
  // PARTIALLY_PAID removed as requested
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED', // Added
}

export enum DocumentType {
  ALTCRED = 'ALTCRED',
  GRU = 'GRU',
  EMPENHO = 'EMPENHO', // Added for Cash Flow Exits
}

export enum OperationType {
  ADIANTAMENTO = 'ADIANTAMENTO',
  PAGAMENTO = 'PAGAMENTO',
  OUTROS = 'OUTROS',
  // RESERVADO removed as requested
}

// Legacy Enum - Kept for backward compatibility, but UI will prefer ServiceDefinition
export enum InvoiceType {
  AGUA_ESGOTO = 'Água e Esgoto',
  ENERGIA = 'Energia',
  TAXA_CONDOMINIAL = 'Taxa Condominial',
  VIATURA = 'Viatura',
  REBOCADO = 'Rebocador',
  DIARIA_ATRACACAO = 'Diária de Atracação',
  TELEFONIA = 'Telefonia',
  OUTROS = 'Outros'
}

// Interfaces
export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  password?: string; 
}

// New Interface for Client Management (UG Automation)
export interface Client {
  id: string;
  ug: string;
  sector: string;
  command: string;
  name: string; // The "Client" Name
}

// New Interface for Service Types Management
export interface ServiceDefinition {
  id: string;
  name: string;
  unitMeasure: string;
  acronym: string; // "Sigla" (e.g., AE, VT, EN) - Distinct from Unit
}

export interface Invoice {
  id: string;
  ug?: string; // Unidade Gestora
  sector: string;
  command: string;
  client: string;
  invoiceNumber: string;
  consumption: string;
  unitMeasure: string;
  serviceAcronym?: string; // New field: Sigla do Serviço (Ex: AE, VT)
  value: number; // Base Value
  adjustmentAddition?: number; // Acerto Acréscimo
  adjustmentDeduction?: number; // Acerto Débito
  issueDate: string; // ISO Date
  dueDate: string; // ISO Date
  monthCompetence: number;
  yearCompetence: number;
  competence: string; // Generated MM/YYYY
  type: string; // Changed from InvoiceType enum to string to support dynamic types
  paidAmount: number; // Calculated field (Includes Advance Abatement)
  status: InvoiceStatus; // Calculated field
  isCanceled?: boolean; // Added field
  observation?: string; // Added field
  sipladSettled?: boolean; // New field: Status Siplad (Lançado/Pendente)
}

export interface ReceivedDocument {
  id: string;
  ug?: string; // Added: Unidade Gestora for filtering
  sector: string;
  command: string;
  client: string;
  documentNumber: string;
  documentType: DocumentType;
  totalValue: number;
  date: string;
  availableValue: number; // Calculated
  informedAdvance: boolean; // Legacy flag, now handled by OperationType
  operation: OperationType;
  observation?: string;
}

// This represents a link between a Document and an Invoice (Payment)
export interface PaymentAllocation {
  id: string;
  documentId: string; // Foreign Key to ReceivedDocument
  invoiceId: string; // Foreign Key to Invoice
  amount: number;
  date: string;
  serviceType?: string; // Historical snapshot
  siscontSettled: boolean;
  siscontDueDate?: string;
  observation?: string;
}

// Manually registered Exits (Saídas) for Cash Flow
export interface CashFlowExit {
  id: string;
  date: string;
  documentNumber: string;
  documentType: DocumentType; // Usually Empenho or ALTCRED
  client: string;
  value: number;
  rubric: string;
  description: string;
  observation?: string; // Added field
  isCanceled?: boolean; // Added field for Empenho Cancellation
}

// Derived type for the Cash Flow View
export interface CashFlowItem {
  id: string;
  date: string;
  documentNumber: string;
  client: string;
  type: 'ENTRY' | 'EXIT';
  value: number;
  rubric?: string;
  description?: string;
  observation?: string;
  isCanceled?: boolean;
  balanceAfter: number;
}
