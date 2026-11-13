import type { PontoAtencao, RegistroPonto } from './utils/pontosAtencao';

// Enums
export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
  READ_ONLY = 'READ_ONLY', // Added: Perfil de Consulta
  ENCARREGADO = 'ENCARREGADO', // "Encarregado da Divisão": vê todas as páginas (menos Administração), só visualiza e exporta; é quem assina
  CONSULTA_GERENCIAL = 'CONSULTA_GERENCIAL', // chefias: só o Painel inicial e o Painel do Encarregado, somente leitura
  TREINAMENTO = 'TREINAMENTO', // vê tudo e pode lançar, mas só em dados de teste (nada chega ao banco)
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
  [UserRole.ENCARREGADO]: 'Encarregado da Divisão',
  [UserRole.CONSULTA_GERENCIAL]: 'Consulta Gerencial',
  [UserRole.TREINAMENTO]: 'Treinamento',
};

/** Setores da Divisão de Contabilidade e funções no setor. Informativos: por enquanto não restringem o acesso. */
export const SETORES_DIVISAO = {
  FATURAMENTO: 'Faturamento',
  ACOMPANHAMENTO_CONTABIL: 'Acompanhamento Contábil',
  CUSTOS: 'Contabilidade de Custos',
} as const;
export type SetorDivisao = keyof typeof SETORES_DIVISAO;
export const FUNCOES_SETOR = {
  ENCARREGADO_SETOR: 'Encarregado de setor',
  AUXILIAR: 'Auxiliar',
} as const;
export type FuncaoSetor = keyof typeof FUNCOES_SETOR;

/**
 * Páginas que cada perfil vê:
 *  - Administrador: todas;  - Operador: todas, exceto Administração;
 *  - Consulta: só o Painel inicial;  - Consulta Gerencial: Painel inicial e Painel do Encarregado (só consulta);
 *  - Encarregado da Divisão: todas, exceto Administração (só consulta: não lança).
 * (null = todas as páginas, menos as listadas em `exceto`)
 */
export const PAGINAS_DO_PERFIL: Record<UserRole, { somente?: string[]; exceto?: string[] }> = {
  [UserRole.ADMIN]: {},
  [UserRole.USER]: { exceto: ['admin'] },
  [UserRole.READ_ONLY]: { somente: ['dashboard'] },
  [UserRole.ENCARREGADO]: { exceto: ['admin'] },   // lê tudo para supervisionar; não grava (podeEditarDados = false e o banco recusa)
  [UserRole.CONSULTA_GERENCIAL]: { somente: ['dashboard', 'painel'] },
  [UserRole.TREINAMENTO]: { exceto: ['admin'] },   // vê todas as páginas (menos a Administração de usuários); o que lança é só de teste
};
/** Só administrador e operador incluem, alteram e excluem (Consulta, Consulta Gerencial e Encarregado da Divisão só visualizam e exportam). */
export const podeEditarDados = (role: UserRole | undefined | null) => role === UserRole.ADMIN || role === UserRole.USER || role === UserRole.TREINAMENTO;
/** Na tela, o Treinamento enxerga o que o administrador enxerga (botões e abas); o que ele grava vai só para a cópia de teste. */
export const veComoAdmin = (role: UserRole | undefined | null) => role === UserRole.ADMIN || role === UserRole.TREINAMENTO;
export const podeVerPagina = (role: UserRole | undefined | null, pagina: string): boolean => {
  const r = PAGINAS_DO_PERFIL[role as UserRole] ?? PAGINAS_DO_PERFIL[UserRole.READ_ONLY];
  if (r.somente) return r.somente.includes(pagina);
  return !(r.exceto || []).includes(pagina);
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
  setor?: SetorDivisao | null;   // informativo (script 035)
  funcao?: FuncaoSetor | null;   // informativo (script 035)
}

// New Interface for Client Management (UG Automation)
export interface Client {
  id: string;
  omId?: string; // presente quando o cliente vem do cadastro de OM (Fase 1)
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
  /** Data-limite de certificação no SIPLAD (emissão + 10 dias úteis). Diferente do vencimento (dueDate). */
  dataLimiteCertificacao?: string | null;
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
  // Fase 1-B (script 004)
  omId?: string | null; // OM do cadastro
  origem?: string | null; // de onde veio o registro (ex.: migração da planilha)
  quitacaoExterna?: string | null; // quitada antes do SISCONT, sem o detalhe da ALTCRED/GRU
  quitadaEm?: string | null;
  contestada?: boolean;
  // Pontos de atenção (script 005): registrados (migração/ciente) e calculados
  pontosRegistro?: RegistroPonto[];
  pontos?: PontoAtencao[];
  // Fase 3 (script 007)
  loteId?: string | null;
  baseCalculo?: Record<string, unknown> | null; // memória de cálculo do lote
  estimado?: boolean; // lote OND (estimado de fim de exercício)
  acertoDe?: string | null; // fatura OND que este acerto corrige
  substitui?: string | null; // "cancela e substitui" (Fase 4)
  enviadaEm?: string | null;
  certificadaEm?: string | null;
  siafiEm?: string | null;
  // Fase 4 (script 008)
  cancelamentoMotivo?: string | null;
  canceladaEm?: string | null;
  canceladaPor?: string | null;
  substituidaPor?: string | null; // número da versão que substituiu esta
  saldoAPagar?: number; // calculado: (01 − 02 + 03 − 04) − pagamentos
  adiantamentoUsado?: number; // calculado: linha 02
}

export interface ReceivedDocument {
  /** OM do cadastro a que o documento pertence (script 029); documentos antigos são ligados pelo nome. */
  omId?: string | null;
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
  comandoId?: string | null; // comando pagador (cadastro)
  origem?: string | null;
  pontosRegistro?: RegistroPonto[];
  pontos?: PontoAtencao[];
  // Fase 2 (script 006): ALTCRED completa, destinação, GRU
  exercicio?: number | null;
  dataCriacao?: string | null;
  tipoAlteracao?: string | null; // ex.: Indenização Serviços Prestados
  situacaoSiplad?: string | null; // ex.: Processada
  ugCliente?: string | null; // "91600 - ComForSup"
  altcredOrigem?: string | null;
  observacaoSolicitante?: string | null;
  celulas?: CelulaCredito[];
  valorOriginal?: number | null;
  valorEstornado?: number;
  destinacao?: Destinacao[];
  aguardando?: boolean; // recebida, aguardando o cliente indicar as faturas
  sobraAdiantamento?: boolean; // sobra da ALTCRED de pagamento vira adiantamento
  gruAutenticacao?: string | null;
  gruDataPagamento?: string | null;
}

/** Linha da Célula de Débito (CDD) ou de Crédito (CDC) da ALTCRED. */
export interface CelulaCredito {
  tipo: 'DEBITO' | 'CREDITO';
  ptres?: string; uo?: string; esfera?: string; fr?: string; nd?: string; pi?: string; ugr?: string; uge?: string; valor: number;
}

/** Para onde o cliente mandou o crédito: faturas específicas ou uma OM. */
export interface Destinacao { tipo: 'FATURA' | 'OM'; valor: string }

/** Campos da Fase 2 gravados em received_documents (nome no banco ↔ no sistema). */
export const CAMPOS_DOC_FASE2: [keyof ReceivedDocument, string][] = [
  ['exercicio', 'exercicio'], ['dataCriacao', 'data_criacao'], ['tipoAlteracao', 'tipo_alteracao'],
  ['situacaoSiplad', 'situacao_siplad'], ['ugCliente', 'ug_cliente'], ['altcredOrigem', 'altcred_origem'],
  ['observacaoSolicitante', 'observacao_solicitante'], ['celulas', 'celulas'], ['valorOriginal', 'valor_original'],
  ['valorEstornado', 'valor_estornado'], ['destinacao', 'destinacao'], ['aguardando', 'aguardando'],
  ['sobraAdiantamento', 'sobra_adiantamento'], ['gruAutenticacao', 'gru_autenticacao'], ['gruDataPagamento', 'gru_data_pagamento'],
]

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
  origem?: string; // preenchido quando a baixa veio da migração das planilhas
  tipoBaixa?: 'PAGAMENTO' | 'ADIANTAMENTO' | null; // script 006; sem ele, vale a operação do documento
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
  /** OM localizada fora da Ilha das Cobras (cliente de serviços sem estar no complexo). */
  foraDaIlha?: boolean;
  /** Outros nomes/abreviações já usados para esta OM (ajudam a reconhecer planilhas). */
  nomesAlternativos?: string[];
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
  /** edifício onde a OM está (organização da matriz da taxa condominial) */
  edificio?: string | null;
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
  /** OM localizada fora da Ilha das Cobras (cliente de serviços sem estar no complexo). */
  foraDaIlha?: boolean;
  /** Outros nomes/abreviações já usados para esta OM (ajudam a reconhecer planilhas). */
  nomesAlternativos?: string[];
  /** UGs que a OM já teve (script 029): a importação do SIPLAD e das planilhas continua achando a OM. */
  codigosAnteriores?: string[];
}

/** Uma mudança nos dados da OM, com a data em que passou a valer (script 029). */
export interface OMHistorico {
  id: string; omId: string; campo: 'nome' | 'codigo' | 'comando_id' | 'setor_id' | 'sigla';
  valorAnterior: string | null; valorNovo: string | null; rotuloAnterior: string | null; rotuloNovo: string | null;
  vigenteDesde: string; motivo?: string | null; ato?: string | null; criadoEm?: string | null;
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
