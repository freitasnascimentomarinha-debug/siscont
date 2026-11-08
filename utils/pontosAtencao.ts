/**
 * Pontos de atenção: inconsistências de faturas e documentos (ALTCRED/GRU).
 *
 * Dois tipos de ponto:
 *  - AUTOMÁTICOS: o sistema recalcula a cada leitura a partir dos dados (pago a maior, ALTCRED estourada,
 *    vencimento antes da emissão...). Somem sozinhos quando o dado é corrigido.
 *  - REGISTRADOS: anotados no registro (coluna pontos_atencao) por quem só sabia do problema naquele
 *    momento — a migração das planilhas (ex.: vencimento recalculado, valor diferente do livro de emissão).
 *    Ficam até alguém marcar como resolvido.
 * Um ponto automático também pode ser marcado como "ciente" com justificativa (ex.: crédito realmente
 * devolvido). Se o valor mudar, a mensagem muda e o ponto volta a aparecer.
 */
import { citarPrazo, obterNormas } from './normas';
import { lerFatura } from './cadastroImport';

export type Gravidade = 'alta' | 'media' | 'baixa';
export type Alvo = 'fatura' | 'documento';

/** Como fica gravado em invoices.pontos_atencao / received_documents.pontos_atencao. */
export interface RegistroPonto {
  tipo: string;
  mensagem: string;
  origem: 'migracao' | 'sistema' | 'usuario';
  em: string; // data ISO
  resolvido?: boolean;
  resolvidoEm?: string;
  resolvidoPor?: string;
  justificativa?: string;
}

export interface PontoAtencao {
  tipo: string;
  titulo: string;
  gravidade: Gravidade;
  mensagem: string;
  comoCorrigir: string;
  automatico: boolean;
  origem: RegistroPonto['origem'];
  em?: string;
  resolvido?: { em?: string; por?: string; justificativa?: string };
}

interface DefTipo { titulo: string; gravidade: Gravidade; comoCorrigir: string; alvo: Alvo }

export const TIPOS_PONTO: Record<string, DefTipo> = {
  // ---- faturas: automáticos
  PAGO_A_MAIOR: { alvo: 'fatura', gravidade: 'alta', titulo: 'Pago a maior', comoCorrigir: 'Confira as baixas da fatura: remova a baixa em duplicidade ou ajuste o valor. Se o excedente for real, registre a devolução ou o crédito para a OM.' },
  ADIANTAMENTO_MAIOR: { alvo: 'fatura', gravidade: 'alta', titulo: 'Adiantamento maior que o serviço', comoCorrigir: 'O adiantamento usado passou do valor do serviço; provável lançamento em duplicidade no RESUMO ADIANTAMENTO. Remova a baixa repetida.' },
  CANCELADA_COM_BAIXA: { alvo: 'fatura', gravidade: 'alta', titulo: 'Cancelada com baixa', comoCorrigir: 'Fatura cancelada não deve ter baixa: desfaça as baixas para devolver o saldo à ALTCRED ou transfira-as para a fatura substituta (-1).' },
  VENCIMENTO_INVALIDO: { alvo: 'fatura', gravidade: 'alta', titulo: 'Vencimento inválido', get comoCorrigir() { return `Edite a fatura e informe o vencimento: emissão + 10 dias úteis (${citarPrazo()}).`; } },
  NUMERO_REPETIDO: { alvo: 'fatura', gravidade: 'alta', titulo: 'Número repetido', comoCorrigir: 'Duas faturas com o mesmo número. Exclua a duplicada ou corrija a versão (último dígito: -1 cancela e substitui).' },
  VALOR_NEGATIVO: { alvo: 'fatura', gravidade: 'media', titulo: 'Valor negativo', comoCorrigir: 'Crédito deve ser lançado como débito (linha 04) numa fatura de acerto, não como fatura negativa.' },
  SEM_CADASTRO: { alvo: 'fatura', gravidade: 'media', titulo: 'Sem OM do cadastro', comoCorrigir: 'Edite a fatura e escolha o cliente na lista do cadastro (ou cadastre a OM em Cadastros).' },
  COMPETENCIA_DIVERGENTE: { alvo: 'fatura', gravidade: 'media', titulo: 'Competência diferente do número', comoCorrigir: 'O mês/ano do número (OM-SS-MM-AAAA-SEQ-V) não bate com a competência da fatura. Corrija um dos dois.' },
  SERVICO_DIVERGENTE: { alvo: 'fatura', gravidade: 'media', titulo: 'Serviço diferente do número', comoCorrigir: 'A sigla do serviço no número não bate com a sigla da fatura. Corrija um dos dois.' },
  NUMERO_FORA_PADRAO: { alvo: 'fatura', gravidade: 'baixa', titulo: 'Número fora do padrão', get comoCorrigir() { return `Padrão da ${obterNormas().nome}: OM-SIGLA-MM-AAAA-SEQ-V (ex.: 40030-EL-08-2026-010-0).`; } },
  // ---- anotados por quem confere os dados (ficam até serem marcados como resolvidos)
  CANCELAMENTO_A_VERIFICAR: { alvo: 'fatura', gravidade: 'baixa', titulo: 'Cancelamento a verificar', comoCorrigir: 'Confirme na planilha de pagamento se a fatura foi cancelada de propósito. Se foi engano, restaure a fatura para o valor baixado pagá-la; se foi proposital, o valor baixado fica como crédito (adiantamento) da OM e já aparece no Mapa Analítico.' },
  CREDITO_DE_FATURA_CANCELADA: { alvo: 'documento', gravidade: 'baixa', titulo: 'Crédito devolvido por fatura cancelada', comoCorrigir: 'Parte desta ALTCRED voltou a ser crédito porque a fatura paga por ela foi cancelada. O crédito é da OM da fatura (não do pagador) e aparece nela no Mapa Analítico. Confirme se o cancelamento foi proposital.' },
  // ---- faturas: anotados pela migração
  STATUS_DIVERGENTE: { alvo: 'fatura', gravidade: 'alta', titulo: 'Situação diferente da planilha', comoCorrigir: 'A situação calculada pelas baixas difere do STATUS da planilha. Confira as baixas desta fatura na planilha original.' },
  FATURA_DO_LIVRO: { alvo: 'fatura', gravidade: 'media', titulo: 'Fatura só no livro de emissão', comoCorrigir: 'Não constava nas listas da planilha de pagamento. Confirme no SIPLAD se a fatura existe e está correta.' },
  VALOR_DIVERGENTE_LIVRO: { alvo: 'fatura', gravidade: 'media', titulo: 'Valor diferente do livro de emissão', comoCorrigir: 'Adotado o valor vigente da planilha de pagamento. Confirme o desconto/correção feito depois da emissão.' },
  VENCIMENTO_CORRIGIDO: { alvo: 'fatura', gravidade: 'baixa', titulo: 'Vencimento recalculado', comoCorrigir: 'O vencimento da planilha era inválido; foi recalculado pela OI. Confira com o SIPLAD.' },
  EMISSAO_CORRIGIDA: { alvo: 'fatura', gravidade: 'baixa', titulo: 'Emissão presumida', comoCorrigir: 'Sem data de emissão na planilha; adotado o dia 15 do mês seguinte à competência. Confira com o SIPLAD.' },
  FATURA_REPETIDA: { alvo: 'fatura', gravidade: 'baixa', titulo: 'Repetida nas listas da planilha', comoCorrigir: 'Aparecia em mais de uma aba da planilha; valeu a primeira (FATURAS > Extra-MB > Pagas). Confira se os dados estão certos.' },
  // ---- documentos: automáticos
  ALTCRED_ESTOURADA: { alvo: 'documento', gravidade: 'alta', titulo: 'Crédito usado a mais', comoCorrigir: 'As baixas somam mais que o valor do documento. Confira a ALTCRED no SIPLAD e remova ou mude de documento as baixas excedentes.' },
  DOC_NUMERO_REPETIDO: { alvo: 'documento', gravidade: 'alta', titulo: 'Número repetido', comoCorrigir: 'Dois documentos com o mesmo número. Junte as baixas em um deles e exclua o outro.' },
  DOC_VALOR_INVALIDO: { alvo: 'documento', gravidade: 'media', titulo: 'Valor zerado ou negativo', comoCorrigir: 'Edite o documento e informe o valor recebido.' },
  BAIXA_FORA_DESTINACAO: { alvo: 'documento', gravidade: 'media', titulo: 'Baixa fora da destinação', comoCorrigir: 'O cliente indicou faturas/OM para este crédito, mas houve baixa em outras. Confirme com a OM ou mude a baixa (OI: o crédito é usado conforme a destinação).' },
  BAIXA_SEM_DOCUMENTO: { alvo: 'fatura', gravidade: 'alta', titulo: 'Baixa sem documento', comoCorrigir: 'Há baixa ligada a uma ALTCRED/GRU que não existe mais. Exclua a baixa e lance de novo com o documento correto.' },
  // ---- documentos: anotados pela migração
  BAIXA_SEM_FATURA: { alvo: 'documento', gravidade: 'alta', titulo: 'Baixa para fatura inexistente', comoCorrigir: 'A planilha baixava, com este documento, uma fatura que não existe em nenhuma lista. Descubra o número correto e lance a baixa manualmente.' },
  ALTCRED_DIVERGENTE: { alvo: 'documento', gravidade: 'alta', titulo: 'Utilizado diferente da planilha', comoCorrigir: 'O valor baixado no sistema difere do VALOR UTILIZADO da aba ALTCRED. Confira as baixas deste documento.' },
  ADIANTAMENTO_DIVERGENTE: { alvo: 'documento', gravidade: 'alta', titulo: 'Adiantamento diferente da planilha', comoCorrigir: 'Valor enviado para adiantamento, utilizado ou saldo diferente da aba ADIANTAMENTOS. Confira as faturas que usaram este adiantamento (RESUMO ADIANTAMENTO).' },
  ADIANTAMENTO_NAO_ENVIADO: { alvo: 'documento', gravidade: 'alta', titulo: 'Usada como adiantamento sem envio', comoCorrigir: 'A ALTCRED foi usada como adiantamento sem constar na aba ADIANTAMENTOS (provável uso em duplicidade: pagou faturas e também abateu adiantamentos). Desfaça as baixas indevidas.' },
  ALTCRED_NAO_IDENTIFICADA: { alvo: 'documento', gravidade: 'media', titulo: 'Adiantamento sem ALTCRED identificada', comoCorrigir: 'O livro de emissão registra adiantamento nestas faturas, mas a planilha não diz de qual ALTCRED veio. Identifique a ALTCRED (aba ADIANTAMENTOS/SIPLAD) e transfira as baixas para ela.' },
  ALTCRED_CRIADA: { alvo: 'documento', gravidade: 'media', titulo: 'ALTCRED criada pelas baixas', comoCorrigir: 'Não constava na aba ALTCRED; criada com o valor somado das baixas. Confira o valor real no SIPLAD e ajuste.' },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => `R$ ${r2(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface FaturaParaPontos {
  id: string; invoiceNumber: string; value: number; adjustmentAddition?: number; adjustmentDeduction?: number;
  issueDate: string; dueDate: string; monthCompetence: number; yearCompetence: number; serviceAcronym?: string;
  isCanceled?: boolean; quitacaoExterna?: string | null; omId?: string | null; pontosRegistro?: RegistroPonto[]; acertoDe?: string | null;
}
export interface DocumentoParaPontos {
  id: string; documentNumber: string; documentType: string; totalValue: number; operation: string;
  comandoId?: string | null; pontosRegistro?: RegistroPonto[];
  destinacao?: { tipo: 'FATURA' | 'OM'; valor: string }[];
}
export interface BaixaParaPontos { documentId: string; invoiceId: string; amount: number; tipoBaixa?: 'PAGAMENTO' | 'ADIANTAMENTO' | null }

function montar(tipo: string, mensagem: string, automatico: boolean, origem: RegistroPonto['origem'], registro?: RegistroPonto): PontoAtencao {
  const d = TIPOS_PONTO[tipo] || { titulo: tipo, gravidade: 'media' as Gravidade, comoCorrigir: '' };
  return {
    tipo, titulo: d.titulo, gravidade: d.gravidade, mensagem, comoCorrigir: d.comoCorrigir, automatico, origem,
    em: registro?.em,
    resolvido: registro?.resolvido ? { em: registro.resolvidoEm, por: registro.resolvidoPor, justificativa: registro.justificativa } : undefined,
  };
}

/** Junta os pontos automáticos com os registrados (e com o "ciente" dado pelo usuário). */
function combinar(automaticos: [string, string][], registros: RegistroPonto[] = []): PontoAtencao[] {
  const out: PontoAtencao[] = [];
  automaticos.forEach(([tipo, msg]) => {
    const ciente = registros.find(r => r.tipo === tipo && r.mensagem === msg && r.resolvido);
    out.push(montar(tipo, msg, true, 'sistema', ciente));
  });
  const autoTipos = new Set(Object.keys(TIPOS_AUTOMATICOS));
  registros.forEach(r => {
    if (autoTipos.has(r.tipo)) return; // automático: vale o recalculado acima
    out.push(montar(r.tipo, r.mensagem, false, r.origem, r));
  });
  const peso = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => Number(!!a.resolvido) - Number(!!b.resolvido) || peso[a.gravidade] - peso[b.gravidade]);
}

const TIPOS_AUTOMATICOS: Record<string, true> = {
  PAGO_A_MAIOR: true, ADIANTAMENTO_MAIOR: true, CANCELADA_COM_BAIXA: true, VENCIMENTO_INVALIDO: true, NUMERO_REPETIDO: true,
  VALOR_NEGATIVO: true, SEM_CADASTRO: true, COMPETENCIA_DIVERGENTE: true, SERVICO_DIVERGENTE: true, NUMERO_FORA_PADRAO: true,
  ALTCRED_ESTOURADA: true, DOC_NUMERO_REPETIDO: true, DOC_VALOR_INVALIDO: true, BAIXA_FORA_DESTINACAO: true, BAIXA_SEM_DOCUMENTO: true,
};
export const ehAutomatico = (tipo: string) => !!TIPOS_AUTOMATICOS[tipo];

export function avaliarPontos(
  faturas: FaturaParaPontos[], documentos: DocumentoParaPontos[], baixas: BaixaParaPontos[],
): { faturas: Map<string, PontoAtencao[]>; documentos: Map<string, PontoAtencao[]> } {
  const opDoc = new Map(documentos.map(d => [d.id, d.operation]));
  const canceladas = new Set(faturas.filter(f => f.isCanceled).map(f => f.id));
  const existe = new Set(faturas.map(f => f.id));
  const porFatura = new Map<string, { adiant: number; pago: number; n: number }>();
  const usoDoc = new Map<string, number>();
  const semDoc = new Map<string, number>();
  const faturasDoDoc = new Map<string, string[]>();
  baixas.forEach(b => {
    if (!opDoc.has(b.documentId)) { semDoc.set(b.invoiceId, (semDoc.get(b.invoiceId) || 0) + b.amount); return; }
    const l = faturasDoDoc.get(b.documentId); if (l) l.push(b.invoiceId); else faturasDoDoc.set(b.documentId, [b.invoiceId]);
    const s = porFatura.get(b.invoiceId) || { adiant: 0, pago: 0, n: 0 };
    if (b.tipoBaixa ? b.tipoBaixa === 'ADIANTAMENTO' : opDoc.get(b.documentId) === 'ADIANTAMENTO') s.adiant += b.amount; else s.pago += b.amount;
    s.n++;
    porFatura.set(b.invoiceId, s);
    if (existe.has(b.invoiceId) && !canceladas.has(b.invoiceId)) usoDoc.set(b.documentId, (usoDoc.get(b.documentId) || 0) + b.amount);
  });
  const contar = (xs: string[]) => { const m = new Map<string, number>(); xs.forEach(x => m.set(x, (m.get(x) || 0) + 1)); return m; };
  const numFat = contar(faturas.map(f => (f.invoiceNumber || '').trim().toUpperCase()));
  const numDoc = contar(documentos.map(d => (d.documentNumber || '').trim().toUpperCase()));

  const pf = new Map<string, PontoAtencao[]>();
  faturas.forEach(f => {
    const a: [string, string][] = [];
    const num = (f.invoiceNumber || '').trim().toUpperCase();
    const s = porFatura.get(f.id) || { adiant: 0, pago: 0, n: 0 };
    const total = r2(f.value + (f.adjustmentAddition || 0) - (f.adjustmentDeduction || 0));
    if (semDoc.has(f.id)) a.push(['BAIXA_SEM_DOCUMENTO', `Baixa(s) de ${brl(semDoc.get(f.id)!)} ligada(s) a documento inexistente.`]);
    if (f.isCanceled) {
      if (s.n > 0) a.push(['CANCELADA_COM_BAIXA', `Fatura cancelada com ${s.n} baixa(s) somando ${brl(s.adiant + s.pago)}.`]);
    } else {
      if (s.adiant > 0.01 && s.adiant > total + 0.01) a.push(['ADIANTAMENTO_MAIOR', `Adiantamento usado ${brl(s.adiant)} para serviço de ${brl(total)}.`]);
      if (s.adiant + s.pago > total + 0.01) a.push(['PAGO_A_MAIOR', `Baixado ${brl(s.adiant + s.pago)} para fatura de ${brl(total)}: excedente de ${brl(s.adiant + s.pago - total)}.`]);
      if (total < -0.01 && !f.acertoDe) a.push(['VALOR_NEGATIVO', `Valor da fatura ${brl(total)}.`]);
    }
    if (!f.dueDate) a.push(['VENCIMENTO_INVALIDO', 'Fatura sem data de vencimento.']);
    else if (f.issueDate && f.dueDate < f.issueDate) a.push(['VENCIMENTO_INVALIDO', `Vencimento ${dataBR(f.dueDate)} anterior à emissão ${dataBR(f.issueDate)}.`]);
    if (num && (numFat.get(num) || 0) > 1) a.push(['NUMERO_REPETIDO', `O número ${num} aparece em ${numFat.get(num)} faturas.`]);
    if (f.omId === null) a.push(['SEM_CADASTRO', 'Fatura não ligada a uma OM do cadastro.']);
    const lido = lerFatura(num);
    if (num && (!lido || !lido.padrao)) a.push(['NUMERO_FORA_PADRAO', `Número "${num}" fora do padrão OM-SIGLA-MM-AAAA-SEQ-V.`]);
    else if (lido) {
      const mm = lido.competencia % 100, aaaa = Math.floor(lido.competencia / 100);
      if (f.monthCompetence && f.yearCompetence && (mm !== f.monthCompetence || aaaa !== f.yearCompetence)) {
        a.push(['COMPETENCIA_DIVERGENTE', `Número indica ${String(mm).padStart(2, '0')}/${aaaa}; competência da fatura ${String(f.monthCompetence).padStart(2, '0')}/${f.yearCompetence}.`]);
      }
      if (f.serviceAcronym && lido.sigla !== f.serviceAcronym.trim().toUpperCase()) {
        a.push(['SERVICO_DIVERGENTE', `Número indica o serviço ${lido.sigla}; fatura lançada como ${f.serviceAcronym.toUpperCase()}.`]);
      }
    }
    const pontos = combinar(a, f.pontosRegistro);
    if (pontos.length) pf.set(f.id, pontos);
  });

  const pd = new Map<string, PontoAtencao[]>();
  const fatPorId = new Map(faturas.map(f => [f.id, f]));
  documentos.forEach(d => {
    const a: [string, string][] = [];
    const num = (d.documentNumber || '').trim().toUpperCase();
    const usado = r2(usoDoc.get(d.id) || 0);
    if (usado > d.totalValue + 0.01) a.push(['ALTCRED_ESTOURADA', `Valor ${brl(d.totalValue)}; baixado ${brl(usado)} (${brl(usado - d.totalValue)} a mais).`]);
    if (num && (numDoc.get(num) || 0) > 1) a.push(['DOC_NUMERO_REPETIDO', `O número ${num} aparece em ${numDoc.get(num)} documentos.`]);
    if (!(d.totalValue > 0)) a.push(['DOC_VALOR_INVALIDO', `Valor do documento ${brl(d.totalValue || 0)}.`]);
    if (d.destinacao?.length) {
      const destFat = new Set(d.destinacao.filter(x => x.tipo === 'FATURA').map(x => x.valor.trim().toUpperCase()));
      const destOm = new Set(d.destinacao.filter(x => x.tipo === 'OM').map(x => x.valor));
      const fora = [...new Set(faturasDoDoc.get(d.id) || [])].map(id => fatPorId.get(id)).filter(f => f
        && !destFat.has((f.invoiceNumber || '').trim().toUpperCase()) && !(f.omId && destOm.has(f.omId))) as FaturaParaPontos[];
      if (fora.length) a.push(['BAIXA_FORA_DESTINACAO', `Baixa em ${fora.length} fatura(s) fora da destinação: ${fora.slice(0, 5).map(f => f.invoiceNumber).join(', ')}${fora.length > 5 ? '…' : ''}.`]);
    }
    const pontos = combinar(a, d.pontosRegistro);
    if (pontos.length) pd.set(d.id, pontos);
  });
  return { faturas: pf, documentos: pd };
}

const dataBR = (iso: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso || '—');

export const pendentes = (p?: PontoAtencao[]) => (p || []).filter(x => !x.resolvido);

/** Registro a gravar quando o usuário marca um ponto como resolvido (ou "ciente", se automático). */
export function marcarResolvido(registros: RegistroPonto[] = [], ponto: PontoAtencao, por: string, justificativa: string, hoje: string): RegistroPonto[] {
  const lista = registros.map(r => ({ ...r }));
  const r = lista.find(x => x.tipo === ponto.tipo && x.mensagem === ponto.mensagem);
  const marca = { resolvido: true, resolvidoEm: hoje, resolvidoPor: por, justificativa: justificativa.trim() || undefined };
  if (r) Object.assign(r, marca);
  else lista.push({ tipo: ponto.tipo, mensagem: ponto.mensagem, origem: 'sistema', em: hoje, ...marca });
  return lista;
}

/** Desfaz a marcação: o ponto volta a ficar pendente. */
export function reabrir(registros: RegistroPonto[] = [], ponto: PontoAtencao): RegistroPonto[] {
  return registros
    .filter(r => !(r.origem === 'sistema' && r.tipo === ponto.tipo && r.mensagem === ponto.mensagem))
    .map(r => (r.tipo === ponto.tipo && r.mensagem === ponto.mensagem
      ? { tipo: r.tipo, mensagem: r.mensagem, origem: r.origem, em: r.em } : r));
}
