import { RegistroAuditoria, diferencas } from './auditoria';
import { TIPOS_PONTO, ehAutomatico } from './pontosAtencao';

/** Nomes em português dos campos mais comuns (o que não estiver aqui vira o nome do campo "limpo"). */
const ROTULOS: Record<string, string> = {
  // faturas
  invoice_number: 'Número da fatura', value: 'Valor do serviço (01)', adjustment_addition: 'Acréscimo (03)', adjustment_deduction: 'Débito (04)',
  issue_date: 'Emissão', due_date: 'Vencimento', data_limite_certificacao: 'Data-limite de certificação', competence: 'Competência',
  month_competence: 'Mês da competência', year_competence: 'Ano da competência', type: 'Serviço', service_acronym: 'Sigla do serviço',
  client: 'Cliente (OM)', sector: 'Setor', command: 'Comando', ug: 'UG', om_id: 'OM ligada ao cadastro', observation: 'Observação',
  consumption: 'Consumo', unit_measure: 'Unidade', is_canceled: 'Cancelada', contestada: 'Em contestação', siplad_settled: 'Lançada no SIPLAD',
  enviada_em: 'Enviada em', certificada_em: 'Certificada em', siafi_em: 'Registrada no SIAFI em', quitada_em: 'Quitada em', quitacao_externa: 'Quitação externa',
  cancelamento_motivo: 'Motivo do cancelamento', cancelada_em: 'Cancelada em', cancelada_por: 'Cancelada por', substituida_por: 'Substituída por', substitui: 'Substitui a fatura',
  acerto_de: 'Acerto da fatura', estimado: 'Consumo estimado', origem: 'Origem', lote_id: 'Lote de faturamento',
  // baixas
  amount: 'Valor da baixa', date: 'Data', tipo_baixa: 'Tipo da baixa', document_id: 'ALTCRED/documento', invoice_id: 'Fatura', service_type: 'Serviço',
  // documentos (ALTCRED / GRU)
  document_number: 'Número do documento', document_type: 'Tipo do documento', total_value: 'Valor recebido', operation: 'Operação', destinacao: 'Faturas indicadas pela OM',
  situacao_siplad: 'Situação no SIPLAD', aguardando: 'Aguardando indicação das faturas', pendencia: 'Pendência', finalidade: 'Finalidade',
  observacao_solicitante: 'Observação da OM', ug_cliente: 'UG do cliente', sobra_adiantamento: 'Sobra vira adiantamento',
  // saídas do fluxo / outros
  description: 'Descrição', rubric: 'Rubrica', rubrica_numero: 'Rubrica', categoria: 'Categoria', nome: 'Nome', codigo: 'Código', ativo: 'Ativo', status: 'Situação',
};
const DINHEIRO = new Set(['value', 'adjustment_addition', 'adjustment_deduction', 'amount', 'total_value', 'valor']);
/** Campos técnicos: não ajudam quem lê o histórico (ficam só em "dados técnicos"). */
const TECNICOS = new Set(['id', 'base_calculo', 'pontos_atencao', 'celulas', 'anexos']);

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Valor em linguagem de gente: datas dd/mm/aaaa, dinheiro em R$, Sim/Não, vazio como "em branco". */
export function valorLegivel(campo: string, v: any): string {
  if (v === null || v === undefined || v === '') return 'em branco';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (DINHEIRO.has(campo) && !Number.isNaN(Number(v))) return brl(Number(v));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return `${dataBR(v)} ${v.slice(11, 16)}`;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return dataBR(v);
  if (Array.isArray(v)) return v.length ? v.map(x => (x && typeof x === 'object' ? x.valor ?? x.nome ?? JSON.stringify(x) : String(x))).join(', ') : 'em branco';
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}
export const rotuloDoCampo = (campo: string) => ROTULOS[campo] || campo.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export interface AlteracaoLegivel {
  /** "Alterou", "Incluiu" ou "Excluiu" */ verbo: string;
  /** frases prontas (ex.: pontos de atenção resolvidos) */ frases: string[];
  /** campos alterados, já com rótulo e valores legíveis */ campos: { rotulo: string; de: string; para: string }[];
  /** nenhuma mudança que interesse a quem lê (só dado técnico) */ soTecnico: boolean;
}

/** Frases sobre os pontos de atenção: o que foi resolvido, reaberto ou anotado. */
export function frasesDePontos(antes: any, depois: any): string[] {
  const a: any[] = Array.isArray(antes) ? antes : [], d: any[] = Array.isArray(depois) ? depois : [];
  const titulo = (t: string) => TIPOS_PONTO[t]?.titulo || t;
  const chave = (p: any) => `${p.tipo}|${p.mensagem}`;
  const out: string[] = [];
  d.forEach(p => {
    const antigo = a.find(x => chave(x) === chave(p));
    if (!antigo) { out.push(`Ponto de atenção anotado: “${titulo(p.tipo)}”.`); }
    if (p.resolvido && !antigo?.resolvido) {
      out.push(`Ponto “${titulo(p.tipo)}” marcado como ${ehAutomatico(p.tipo) ? 'ciente' : 'resolvido'}${p.resolvidoPor ? ` por ${p.resolvidoPor}` : ''}${p.resolvidoEm ? ` em ${dataBR(p.resolvidoEm)}` : ''}${p.justificativa ? ` — motivo: “${p.justificativa}”` : ''}.`);
    }
    if (!p.resolvido && antigo?.resolvido) out.push(`Ponto “${titulo(p.tipo)}” reaberto.`);
  });
  a.forEach(p => { if (!d.some(x => chave(x) === chave(p))) out.push(`Ponto “${titulo(p.tipo)}” saiu da lista (o dado foi corrigido).`); });
  return out;
}

export function alteracaoLegivel(r: RegistroAuditoria): AlteracaoLegivel {
  const verbo = r.acao === 'INSERT' ? 'Incluiu' : r.acao === 'DELETE' ? 'Excluiu' : 'Alterou';
  const difs = diferencas(r);
  const frases: string[] = [];
  const pontos = difs.find(x => x.campo === 'pontos_atencao');
  if (pontos) frases.push(...frasesDePontos(pontos.de, pontos.para));
  const campos = difs.filter(x => !TECNICOS.has(x.campo)).map(x => ({ rotulo: rotuloDoCampo(x.campo), de: valorLegivel(x.campo, x.de), para: valorLegivel(x.campo, x.para) }));
  return { verbo, frases, campos, soTecnico: !frases.length && !campos.length };
}
