
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
export const ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'Administrador',
  [UserRole.USER]: 'Operador',
  [UserRole.READ_ONLY]: 'Consulta',
};

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active?: boolean; // false = pendente de liberação ou bloqueado
}

/** Usuário como retornado pela API de administração (Auth + perfil). */
export interface ManagedUser extends User {
  active: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
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
  documentType?: DocumentType;
  balanceAfter: number;
}

// ---------------------------------------------------------------------
// Fase 1 — Cadastros (Setor → Comando → OM, classes de navio, parâmetros)
// ---------------------------------------------------------------------
export type TipoOM = 'TERRA' | 'NAVIO' | 'EXTRA_MB';

export const TIPO_OM_LABELS: Record<TipoOM, string> = {
  TERRA: 'OM de terra',
  NAVIO: 'Navio',
  EXTRA_MB: 'Extra-MB',
};

export interface Setor {
  id: string;
  sigla: string;
  nome?: string | null;
  ordem: number;
  ativo: boolean;
}

export interface Comando {
  id: string;
  codigo?: string | null;
  nome: string;
  sigla?: string | null;
  /** Indicativo naval do comando (destino das mensagens de envio e cobrança das faturas). */
  indicativoNaval?: string | null;
  setorId?: string | null;
  ativo: boolean;
  desativadoEm?: string | null;
  motivoDesativacao?: string | null;
}

export interface ClasseNavio {
  id: string;
  nome: string;
  ativo: boolean;
  desativadoEm?: string | null;
}

export interface OM {
  id: string;
  /** Código usado no número da fatura. */
  codigo: string;
  /** false = não tem código próprio: usa o do comando (OM/navio) ou o da BNIC, 40015 (extra-MB). */
  codigoProprio?: boolean;
  nome: string;
  sigla?: string | null;
  indicativoNaval?: string | null;
  tipo: TipoOM;
  comandoId?: string | null;
  setorId?: string | null;
  areaCnic?: number | null;
  lotacao?: number | null;
  classeId?: string | null;
  cnpj?: string | null;
  endereco?: string | null;
  emails?: string | null;
  telefone?: string | null;
  observacao?: string | null;
  ativo: boolean;
  ativadoEm?: string | null;
  desativadoEm?: string | null;
  motivoDesativacao?: string | null;
}

/** Tipo de serviço com os campos do catálogo da OI 40-04. */
export interface ServicoCatalogo extends ServiceDefinition {
  nomeOficial?: string | null;
  emitidaDeAcordoCom?: string | null;
  setorResponsavel?: string | null;
  telefoneSetor?: string | null;
  prazoEnvio?: string | null;
  anexoOi?: string | null;
  criterio?: string | null;
  ordem?: number | null;
  ativo?: boolean;
}

export interface Parametro {
  chave: string;
  valor: string;
  descricao?: string | null;
}

export type TipoFeriado = 'NACIONAL' | 'ESTADUAL' | 'MUNICIPAL' | 'PONTO_FACULTATIVO';

export interface Feriado {
  data: string; // AAAA-MM-DD
  descricao: string;
  tipo: TipoFeriado;
}

/** Áreas do CNIC (OI 40-04, item 3.1). */
export const AREAS_CNIC: Record<number, string> = {
  1: 'Área 1 – Parte baixa interna',
  2: 'Área 2 – Parte alta',
  3: 'Área 3 – Parte baixa externa',
  4: 'Área 4 – Ilha Fiscal',
  5: 'Área 5 – CIAW',
};
