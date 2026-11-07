import type { RegistroPonto } from './pontosAtencao';
/**
 * Fase 1-B — migração de faturas, ALTCRED e baixas a partir das planilhas
 * "Pagamento 2026" (abas FATURAS, Faturas Pagas, Faturas Extra-MB, ALTCRED,
 * LANÇAMENTOS, RESUMO ADIANTAMENTO, canceladas, contestadas) e "Faturamento"
 * (livro de emissão: valor do serviço, adiantamento, acréscimo, débito, consumo).
 *
 * Funções puras: montam o plano de gravação e o relatório de conferência.
 *
 * Regras (conferidas nos dados):
 *  - FATURAS."Valor" é o valor FINAL (linha 05), já sem o adiantamento; o valor do
 *    serviço (linha 01), acréscimo e débito vêm do livro de emissão.
 *  - LANÇAMENTOS = pagamentos (ALTCRED → fatura). Linha com fatura "ADIANTAMENTO"
 *    é a sobra da ALTCRED enviada para adiantamento (fica como saldo do documento).
 *  - RESUMO ADIANTAMENTO = uso de adiantamento (ALTCRED → fatura).
 *  - Faturas Pagas / Pagas Extra-MB = histórico quitado sem o detalhe da ALTCRED.
 */
import { Celula, Matriz, chave, chaveDaLinha, lerComando, lerFatura, limpar, normalizarSetor } from './cadastroImport';
import { somarDiasUteis } from './diasUteis';

// ------------------------------------------------------------ conversões
export function numero(v: Celula): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  let t = String(v).replace(/R\$\s?/i, '').replace(/\s/g, '').trim();
  if (!t || t === '-') return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const dataValida = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Data em AAAA-MM-DD a partir de número serial do Excel, Date ou texto dd/mm/aa(aa); null se inválida. */
export function data(v: Celula): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    if (v < 30000 || v > 80000) return null; // fora de 1982–2119: não é data
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dataValida(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    return dataValida(y, +m[2], +m[1]) ? iso(y, +m[2], +m[1]) : null;
  }
  return null;
}

const bool = (v: Celula) => v === true || /^(true|sim|verdadeiro|x|1)$/i.test(String(v ?? '').trim());

// ------------------------------------------------------- leitura de abas
type Campos = Record<string, string[]>;

/** Acha o cabeçalho e devolve as linhas como objetos {campo: célula}. */
export function linhasPorCabecalho(m: Matriz, campos: Campos, obrigatorios: string[], maxCab = 40): Record<string, Celula>[] {
  for (let i = 0; i < Math.min(maxCab, m.length); i++) {
    const row = (m[i] || []).map(c => chave(c));
    const col: Record<string, number> = {};
    Object.entries(campos).forEach(([k, alts]) => {
      const j = row.findIndex(c => alts.includes(c));
      if (j >= 0) col[k] = j;
    });
    if (!obrigatorios.every(k => col[k] !== undefined)) continue;
    const out: Record<string, Celula>[] = [];
    for (let r = i + 1; r < m.length; r++) {
      const linha = m[r] || [];
      const o: Record<string, Celula> = {};
      let vazia = true;
      Object.entries(col).forEach(([k, j]) => { o[k] = linha[j]; if (linha[j] !== null && linha[j] !== undefined && linha[j] !== '') vazia = false; });
      if (!vazia) out.push(o);
    }
    return out;
  }
  return [];
}

const C_FATURA: Campos = {
  setor: ['setor'], comando: ['comando'], cliente: ['cliente'], fatura: ['fatura', 'nfatura'], valor: ['valor'],
  emissao: ['dataemis', 'dataemissao'], vencimento: ['datavenc', 'datavencimento'], status: ['status', 'situacao'],
  siplad: ['quitadasiplad'], obs: ['observacoes', 'observacao'], pagamento: ['datadepagamento'], autenticacao: ['autbancaria'],
  dataContestacao: ['datacontestacao'], retificacao: ['retificacao'],
};
const C_LIVRO: Campos = {
  setor: ['setor'], comando: ['comando'], cliente: ['cliente'], fatura: ['fatura'], consumo: ['consumo'], unidade: ['uniddemedida', 'unidmedida', 'unidademedida', 'unidmed', 'unidadedemedida', 'unid'],
  servico: ['valorservprest', 'valorservicoprestado', 'valordoservicoprestado', 'valorserv'], adiantamento: ['valordoadiantamento', 'valoradiantamento'],
  acrescimo: ['acrescimo'], debito: ['debito'], final: ['valorfinal'], emissao: ['dataemis'], vencimento: ['datavenc'],
};
const C_ALTCRED: Campos = {
  data: ['datadesituacao', 'data'], setor: ['comando'], cliente: ['cliente'], numero: ['naltcred', 'altcred'],
  tipo: ['tipo'], valor: ['valoraltcred'], utilizado: ['valorutilizado'], obs: ['observacao'],
};
const C_BAIXA: Campos = {
  data: ['datadesituacao', 'data'], setor: ['comando'], cliente: ['cliente'], altcred: ['naltcred', 'altcred'],
  fatura: ['nfatura', 'fatura'], valor: ['valorutilizado', 'valor'],
};

/** Nome das abas reconhecidas (pela chave do nome). */
export const ABAS_FATURAS: Record<string, keyof PlanilhasFaturas> = {
  faturas: 'faturas', faturaspagas: 'pagas', faturasextramb: 'extra', faturaspagasextramb: 'extraPagas',
  altcred: 'altcred', lancamentos: 'lancamentos', resumoadiantamento: 'resumoAdiantamento',
  faturascanceladas: 'canceladas', faturascontestadas: 'contestadas', adiantamentos: 'adiantamentos',
};
export const ehAbaDoLivro = (nome: string) => /^(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|ond)\d{2}$/i.test(limpar(nome).replace(/\s/g, ''));
/** Aba consolidada do ano no livro de emissão ("FATURAMENTO 2026"): usada quando a fatura não está na aba do mês. */
export const ehLivroConsolidado = (nome: string) => /^faturamento\d{4}$/i.test(limpar(nome).replace(/\s/g, ''));

export interface PlanilhasFaturas {
  faturas: Matriz[]; pagas: Matriz[]; extra: Matriz[]; extraPagas: Matriz[]; altcred: Matriz[];
  lancamentos: Matriz[]; resumoAdiantamento: Matriz[]; canceladas: Matriz[]; contestadas: Matriz[]; livro: Matriz[];
  /** Abas "FATURAMENTO AAAA" do livro (consolidado do ano). */
  livroConsolidado: Matriz[];
  /** Aba ADIANTAMENTOS: ALTCRED (ou a sobra delas) encaminhadas para adiantamento. */
  adiantamentos: Matriz[];
}
export const planilhasVazias = (): PlanilhasFaturas => ({
  faturas: [], pagas: [], extra: [], extraPagas: [], altcred: [], lancamentos: [], resumoAdiantamento: [], canceladas: [], contestadas: [], livro: [], livroConsolidado: [], adiantamentos: [],
});

// ------------------------------------------------------------- plano
export interface OMResolvida { omId: string; codigo: string; nome: string; setor: string; comando: string }
export interface ComandoResolvido { comandoId: string; codigo: string; nome: string; setor: string }

export interface ContextoImportacao {
  /** Cliente do cadastro para uma linha de fatura (setor, cliente, número). */
  resolverOM: (l: { setor: Celula; cliente: Celula; fatura: string }) => OMResolvida | null;
  /** Comando do cadastro pelo código ("81100 - ComGptPatNavSE"). */
  resolverComando: (texto: Celula) => ComandoResolvido | null;
  servicos: { sigla: string; nome: string; unidade: string }[];
  feriados: string[];
  prazoDiasUteis: number;
  faturasExistentes: Set<string>;
  documentosExistentes: Set<string>;
  /** Para completar uma migração já gravada: id do registro existente pelo número (liga baixas novas a ele). */
  idFaturaExistente?: (numero: string) => string | undefined;
  idDocumentoExistente?: (numero: string) => string | undefined;
  hoje: string;
  novoId: () => string;
}

export interface FaturaPlano {
  id: string; numero: string; origem: string; omId: string | null; ug: string; setor: string; comando: string; cliente: string;
  sigla: string; tipo: string; unidade: string; consumo: string; mesCompetencia: number; anoCompetencia: number; competencia: string;
  valor: number; acrescimo: number; debito: number; emissao: string; vencimento: string;
  cancelada: boolean; contestada: boolean; siplad: boolean; quitacaoExterna: string | null; quitadaEm: string | null; observacao: string;
  statusPlanilha: string | null; saldoPlanilha: number | null;
  /** Pontos de atenção que só a migração conhece (gravados em pontos_atencao). */
  pontos: RegistroPonto[];
}
export interface DocumentoPlano {
  id: string; numero: string; tipoDocumento: 'ALTCRED' | 'GRU'; operacao: 'PAGAMENTO' | 'ADIANTAMENTO' | 'OUTROS';
  valor: number; data: string; ug: string; setor: string; comando: string; cliente: string; comandoId: string | null;
  observacao: string; origem: string; utilizadoPlanilha: number | null;
  pontos: RegistroPonto[];
  /** A planilha mandou a sobra desta ALTCRED para adiantamento (linha "ADIANTAMENTO" nos LANÇAMENTOS). */
  sobraAdiantamento?: boolean;
}
export interface BaixaPlano { id: string; documentoId: string; faturaId: string; valor: number; data: string; origem: string; sigla: string }

export interface AvisoMigracao { tipo: string; grave: boolean; mensagem: string; exemplos?: string[] }

export interface PlanoMigracao {
  faturas: FaturaPlano[];
  documentos: DocumentoPlano[];
  baixas: BaixaPlano[];
  avisos: AvisoMigracao[];
  resumo: {
    porOrigem: Record<string, number>;
    abertas: number; valorAberto: number; valorAbertoPlanilha: number;
    /** Em aberto separado como a planilha: FATURAS (vencidas + a vencer), contestadas e extra-MB. */
    abertoFaturas: number; abertoContestadas: number; abertoExtraMB: number; abertoOutras: number;
    conferidasFaturas: number; divergentesFaturas: number;
    conferidasAltcred: number; divergentesAltcred: number;
    /** Aba ADIANTAMENTOS: ALTCRED conferidas (valor enviado, utilizado e saldo) e saldo total disponível. */
    conferidasAdiant: number; divergentesAdiant: number; saldoAdiantPlanilha: number; saldoAdiantSistema: number;
    baixasEmExistentes: number;
    ignoradasExistentes: number;
  };
}

const ORIGEM: Record<string, string> = {
  faturas: 'Planilha Pagamento 2026 › FATURAS',
  extra: 'Planilha Pagamento 2026 › Faturas Extra-MB',
  pagas: 'Planilha Pagamento 2026 › Faturas Pagas (histórico)',
  extraPagas: 'Planilha Pagamento 2026 › Faturas Pagas Extra-MB (histórico)',
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function planejarMigracao(p: PlanilhasFaturas, ctx: ContextoImportacao): PlanoMigracao {
  const avisos: AvisoMigracao[] = [];
  const aviso = (tipo: string, grave: boolean, mensagem: string, exemplos?: string[]) => {
    if (!exemplos || exemplos.length) avisos.push({ tipo, grave, mensagem, exemplos: exemplos?.slice(0, 12) });
  };
  const norm = (n: Celula) => limpar(n).toUpperCase();
  const servico = new Map(ctx.servicos.map(s => [s.sigla.toUpperCase(), s]));
  const anotar = (r: { pontos: RegistroPonto[] } | undefined, tipo: string, mensagem: string) => {
    if (r) r.pontos.push({ tipo, mensagem, origem: 'migracao', em: ctx.hoje });
  };
  const rs = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const anotacoesFatura: [string, string, string][] = []; // [numero, tipo, mensagem] aplicadas após criar a fatura

  // 1. Livro de emissão (última ocorrência vale)
  const livro = new Map<string, Record<string, Celula>>();
  p.livro.forEach(m => linhasPorCabecalho(m, C_LIVRO, ['fatura']).forEach(l => {
    const n = norm(l.fatura);
    if (lerFatura(n)) livro.set(n, l);
  }));
  // consolidado do ano só completa o que não está nas abas mensais
  (p.livroConsolidado || []).forEach(m => linhasPorCabecalho(m, C_LIVRO, ['fatura']).forEach(l => {
    const n = norm(l.fatura);
    if (lerFatura(n) && !livro.has(n)) livro.set(n, l);
  }));

  // 2. Baixas (pagamentos e adiantamentos) por fatura e por ALTCRED
  type B = { altcred: string; fatura: string; valor: number; data: string | null; setor: Celula; cliente: Celula; origem: string };
  const baixasBrutas: B[] = [];
  const sobraParaAdiant = new Set<string>();
  const lerBaixas = (ms: Matriz[], origem: string) => ms.forEach(m => linhasPorCabecalho(m, C_BAIXA, ['altcred', 'fatura', 'valor'], 40).forEach(l => {
    const alt = norm(l.altcred), fat = norm(l.fatura), v = numero(l.valor);
    if (!alt || !fat || v === null || v === 0) return;
    if (fat === 'ADIANTAMENTO') { sobraParaAdiant.add(alt); return; } // sobra da ALTCRED enviada para adiantamento: fica como saldo do documento
    baixasBrutas.push({ altcred: alt, fatura: fat, valor: v, data: data(l.data), setor: l.setor, cliente: l.cliente, origem });
  }));
  lerBaixas(p.lancamentos, 'LANÇAMENTOS (pagamento)');
  lerBaixas(p.resumoAdiantamento, 'RESUMO ADIANTAMENTO (uso de adiantamento)');
  const adiantPorFatura = new Map<string, number>();
  baixasBrutas.filter(b => b.origem.startsWith('RESUMO')).forEach(b => adiantPorFatura.set(b.fatura, (adiantPorFatura.get(b.fatura) || 0) + b.valor));

  // 3. Canceladas e contestadas (abas próprias)
  const canceladas = new Set<string>(), contestadas = new Map<string, string>();
  p.canceladas.forEach(m => linhasPorCabecalho(m, C_FATURA, ['fatura']).forEach(l => canceladas.add(norm(l.fatura))));
  p.contestadas.forEach(m => linhasPorCabecalho(m, C_FATURA, ['fatura']).forEach(l => {
    const n = norm(l.fatura);
    const obs = [limpar(l.status), limpar(l.retificacao)].filter(Boolean).join(' — ');
    contestadas.set(n, obs);
    if (/cancelad/i.test(limpar(l.retificacao))) canceladas.add(n);
  }));

  // 4. Faturas (precedência: FATURAS > Extra-MB > Pagas > Pagas Extra-MB)
  const faturas = new Map<string, FaturaPlano>();
  const repetidas: string[] = [], semCliente: string[] = [], vencCorrigido: string[] = [], emisCorrigida: string[] = [],
    servicoDivergente: string[] = [], foraPadrao: string[] = [], existentes: string[] = [];
  const gru: { fatura: string; data: string; autenticacao: string; valor: number }[] = [];
  const adiantSemAltcred: { fatura: string; valor: number; comando: string; ano: number }[] = [];
  const fontes: [keyof PlanilhasFaturas, string][] = [['faturas', 'faturas'], ['extra', 'extra'], ['pagas', 'pagas'], ['extraPagas', 'extraPagas']];
  for (const [aba, origemK] of fontes) {
    for (const m of p[aba]) {
      for (const l of linhasPorCabecalho(m, C_FATURA, ['cliente', 'fatura', 'valor'])) {
        const n = norm(l.fatura);
        const f = lerFatura(n);
        if (!f) continue;
        if (faturas.has(n)) {
          repetidas.push(`${n} (${ORIGEM[origemK].split('› ')[1]})`);
          anotar(faturas.get(n), 'FATURA_REPETIDA', `Também consta na aba ${ORIGEM[origemK].split('› ')[1]} da planilha; valeram os dados de ${faturas.get(n)!.origem.split('› ')[1]}.`);
          continue;
        }
        if (ctx.faturasExistentes.has(n)) { existentes.push(n); continue; }
        if (!f.padrao) foraPadrao.push(n);

        const lv = livro.get(n);
        const valorPlanilha = numero(l.valor) ?? 0;
        // A planilha de pagamento traz o valor VIGENTE (final, linha 05, já sem o adiantamento usado).
        // O livro de emissão detalha serviço (01), acréscimo (03) e débito (04), mas pode estar desatualizado
        // (descontos e correções feitos depois da emissão). O livro só é usado quando bate com a planilha.
        const adiantUsado = origemK === 'faturas' ? adiantPorFatura.get(n) || 0 : 0;
        let valor = r2(valorPlanilha + adiantUsado), acrescimo = 0, debito = 0;
        if (lv) {
          const sv = numero(lv.servico), ac = numero(lv.acrescimo) || 0, db = numero(lv.debito) || 0;
          const adL = numero(lv.adiantamento) || 0;
          if (sv !== null && Math.abs(r2(sv + ac - db) - valor) <= 0.01) { valor = r2(sv); acrescimo = r2(ac); debito = r2(db); }
          else if (sv !== null && origemK === 'faturas' && adL > adiantUsado + 0.01 && Math.abs(r2(sv + ac - db - adL) - valorPlanilha) <= 0.01) {
            // O livro registra adiantamento maior que o do RESUMO ADIANTAMENTO: o serviço real é o do livro e a
            // diferença foi abatida de adiantamento cuja ALTCRED não está identificada na planilha.
            valor = r2(sv); acrescimo = r2(ac); debito = r2(db);
            adiantSemAltcred.push({ fatura: n, valor: r2(adL - adiantUsado), comando: limpar(l.comando), ano: Math.floor(f.competencia / 100) || 0 });
          }
          else if (sv !== null && origemK === 'faturas') {
            servicoDivergente.push(`${n}: vigente na planilha R$ ${r2(valorPlanilha + adiantUsado).toFixed(2)} × livro de emissão R$ ${r2(sv + ac - db).toFixed(2)}`);
            anotacoesFatura.push([n, 'VALOR_DIVERGENTE_LIVRO', `Valor vigente na planilha ${rs(r2(valorPlanilha + adiantUsado))}; no livro de emissão ${rs(r2(sv + ac - db))} (serviço ${rs(r2(sv))} + acréscimo ${rs(r2(ac))} − débito ${rs(r2(db))}).`]);
          }
        }

        // competência pelo número da fatura (MM-AAAA)
        const mm = f.competencia % 100, aaaa = Math.floor(f.competencia / 100);
        const competencia = f.competencia ? `${String(mm).padStart(2, '0')}/${aaaa}` : '';

        let emissao = data(l.emissao) || (lv ? data(lv.emissao) : null);
        if (!emissao) {
          // dia 15 do mês seguinte à competência (padrão de emissão)
          const y = mm === 12 ? aaaa + 1 : aaaa, mo = mm === 12 ? 1 : mm + 1;
          emissao = f.competencia ? iso(y, mo, 15) : ctx.hoje;
          emisCorrigida.push(`${n}: emissão "${limpar(l.emissao) || 'vazia'}" → ${emissao}`);
          anotacoesFatura.push([n, 'EMISSAO_CORRIGIDA', `Emissão na planilha "${limpar(l.emissao) || 'vazia'}"; adotado ${br(emissao)}.`]);
        }
        let vencimento = data(l.vencimento) || (lv ? data(lv.vencimento) : null);
        if (!vencimento || vencimento < emissao) {
          const novo = somarDiasUteis(emissao, ctx.prazoDiasUteis, ctx.feriados);
          const original = typeof l.vencimento === 'number' ? (data(l.vencimento) ?? String(l.vencimento)) : limpar(l.vencimento);
          vencCorrigido.push(`${n}: "${original || 'vazio'}" → ${novo}`);
          anotacoesFatura.push([n, 'VENCIMENTO_CORRIGIDO', `Vencimento na planilha "${original && /^\d{4}-\d{2}-\d{2}$/.test(original) ? br(original) : original || 'vazio'}"; recalculado para ${br(novo)} (emissão + ${ctx.prazoDiasUteis} dias úteis).`]);
          vencimento = novo;
        }

        const om = ctx.resolverOM({ setor: l.setor, cliente: l.cliente, fatura: n });
        if (!om) semCliente.push(`${n} — ${limpar(l.cliente)}`);
        const setorTxt = om?.setor || normalizarSetor(l.setor).sigla || '';
        const sv = servico.get(f.sigla);
        const statusPlan = limpar(l.status).toUpperCase() || null;
        const contest = contestadas.has(n) || statusPlan === 'CONTESTADA';
        const cancel = canceladas.has(n) || statusPlan === 'CANCELADA';
        const historico = origemK === 'pagas' || origemK === 'extraPagas';
        const pagEm = data(l.pagamento);
        if (origemK === 'extra' && pagEm) gru.push({ fatura: n, data: pagEm, autenticacao: limpar(l.autenticacao), valor: valorPlanilha });

        faturas.set(n, {
          id: ctx.novoId(), numero: n, origem: ORIGEM[origemK], omId: om?.omId ?? null,
          ug: om?.codigo ?? f.codigo, setor: setorTxt, comando: om?.comando ?? limpar(l.comando), cliente: om?.nome ?? limpar(l.cliente),
          sigla: f.sigla, tipo: sv?.nome ?? f.sigla, unidade: lv ? limpar(lv.unidade) || sv?.unidade || '' : sv?.unidade || '',
          consumo: lv ? limpar(lv.consumo) : '', mesCompetencia: mm, anoCompetencia: aaaa, competencia,
          valor, acrescimo, debito,
          emissao, vencimento, cancelada: cancel, contestada: contest, siplad: bool(l.siplad),
          quitacaoExterna: historico ? 'Quitada antes do SISCONT (histórico da planilha, sem detalhe da ALTCRED/GRU)' : null,
          quitadaEm: historico ? vencimento : null,
          observacao: [limpar(l.obs), contestadas.get(n) ? `Contestação: ${contestadas.get(n)}` : ''].filter(Boolean).join(' | '),
          statusPlanilha: historico ? 'PAGO' : statusPlan, saldoPlanilha: origemK === 'faturas' ? numero(l.valor) : null,
          pontos: [],
        });
        anotacoesFatura.filter(a => a[0] === n).forEach(([, t, m]) => anotar(faturas.get(n), t, m));
      }
    }
  }

  // 4-B. Faturas citadas nas baixas que não estão nas listas, mas existem no livro de emissão
  const doLivro: string[] = [];
  baixasBrutas.forEach(b => {
    if (faturas.has(b.fatura) || ctx.faturasExistentes.has(b.fatura)) return;
    const lv = livro.get(b.fatura), f = lerFatura(b.fatura);
    if (!lv || !f) return;
    const mm = f.competencia % 100, aaaa = Math.floor(f.competencia / 100);
    const sv = numero(lv.servico) || 0;
    const emissao = data(lv.emissao) || (f.competencia ? iso(mm === 12 ? aaaa + 1 : aaaa, mm === 12 ? 1 : mm + 1, 15) : ctx.hoje);
    const venc = data(lv.vencimento);
    const om = ctx.resolverOM({ setor: lv.setor ?? null, cliente: lv.cliente ?? '', fatura: b.fatura });
    const sg = servico.get(f.sigla);
    faturas.set(b.fatura, {
      id: ctx.novoId(), numero: b.fatura, origem: 'Planilha Faturamento › livro de emissão (citada nas baixas)', omId: om?.omId ?? null,
      ug: om?.codigo ?? f.codigo, setor: om?.setor ?? (normalizarSetor(lv.setor ?? null).sigla || ''), comando: om?.comando ?? limpar(lv.comando),
      cliente: om?.nome ?? limpar(lv.cliente), sigla: f.sigla, tipo: sg?.nome ?? f.sigla, unidade: limpar(lv.unidade) || sg?.unidade || '',
      consumo: limpar(lv.consumo), mesCompetencia: mm, anoCompetencia: aaaa, competencia: f.competencia ? `${String(mm).padStart(2, '0')}/${aaaa}` : '',
      valor: r2(sv), acrescimo: r2(numero(lv.acrescimo) || 0), debito: r2(numero(lv.debito) || 0), emissao,
      vencimento: venc && venc >= emissao ? venc : somarDiasUteis(emissao, ctx.prazoDiasUteis, ctx.feriados),
      cancelada: canceladas.has(b.fatura), contestada: contestadas.has(b.fatura), siplad: false, quitacaoExterna: null, quitadaEm: null,
      observacao: 'Fatura ausente das listas da planilha de pagamento; dados do livro de emissão.', statusPlanilha: null, saldoPlanilha: null,
      pontos: [{ tipo: 'FATURA_DO_LIVRO', mensagem: `Citada na baixa da ${b.altcred}, mas ausente das listas da planilha de pagamento; dados tirados do livro de emissão.`, origem: 'migracao', em: ctx.hoje }],
    });
    if (!om) semCliente.push(`${b.fatura} — ${limpar(lv.cliente)}`);
    doLivro.push(b.fatura);
  });
  aviso('FATURA_DO_LIVRO', true, `${[...new Set(doLivro)].length} fatura(s) citadas nas baixas não estavam nas listas da planilha de pagamento e foram criadas a partir do livro de emissão.`, [...new Set(doLivro)]);

  // 5. Documentos: ALTCRED (aba ALTCRED + citadas nas baixas) e GRU (extra-MB pagas)
  const documentos = new Map<string, DocumentoPlano>();
  const docsExistentes: string[] = [];
  p.altcred.forEach(m => linhasPorCabecalho(m, C_ALTCRED, ['numero', 'valor']).forEach(l => {
    const n = norm(l.numero);
    if (!n || documentos.has(n)) return;
    if (ctx.documentosExistentes.has(n)) { docsExistentes.push(n); return; }
    const tipo = limpar(l.tipo).toUpperCase();
    const cmd = ctx.resolverComando(l.cliente);
    documentos.set(n, {
      id: ctx.novoId(), numero: n, tipoDocumento: 'ALTCRED',
      operacao: tipo === 'ADIANTAMENTO' ? 'ADIANTAMENTO' : tipo === 'PAGAMENTO' ? 'PAGAMENTO' : 'OUTROS',
      valor: r2(numero(l.valor) || 0), data: data(l.data) || ctx.hoje,
      ug: cmd?.codigo ?? lerComando(l.cliente)?.codigo ?? '', setor: cmd?.setor || normalizarSetor(l.setor).sigla || '',
      comando: cmd?.nome ?? limpar(l.cliente), cliente: cmd?.nome ?? limpar(l.cliente), comandoId: cmd?.comandoId ?? null,
      observacao: [tipo && !['ADIANTAMENTO', 'PAGAMENTO'].includes(tipo) ? `Tipo na planilha: ${tipo}` : '', limpar(l.obs)].filter(Boolean).join(' | '),
      origem: 'Planilha Pagamento 2026 › ALTCRED', utilizadoPlanilha: numero(l.utilizado), pontos: [],
    });
  }));
  // 5-A. Aba ADIANTAMENTOS: ALTCRED encaminhadas para adiantamento (inteiras ou só a sobra)
  type LA = { numero: string; valor: number; utilizado: number; saldo: number; cliente: string };
  const listaAdiant: LA[] = [];
  p.adiantamentos.forEach(m => linhasPorCabecalho(m, C_ALTCRED, ['numero', 'valor']).forEach(l => {
    const n = norm(l.numero), v = numero(l.valor);
    if (!n || v === null) return;
    const u = numero(l.utilizado) ?? 0;
    listaAdiant.push({ numero: n, valor: r2(v), utilizado: r2(u), saldo: r2(v - u), cliente: limpar(l.cliente) });
    const d = documentos.get(n);
    if (d) { if (d.operacao !== 'ADIANTAMENTO') d.sobraAdiantamento = true; return; }
    if (ctx.documentosExistentes.has(n)) return;
    const cmd = ctx.resolverComando(l.cliente);
    documentos.set(n, {
      id: ctx.novoId(), numero: n, tipoDocumento: 'ALTCRED', operacao: 'ADIANTAMENTO', valor: r2(v), data: data(l.data) || ctx.hoje,
      ug: cmd?.codigo ?? lerComando(l.cliente)?.codigo ?? '', setor: cmd?.setor || normalizarSetor(l.setor).sigla || '',
      comando: cmd?.nome ?? limpar(l.cliente), cliente: cmd?.nome ?? limpar(l.cliente), comandoId: cmd?.comandoId ?? null,
      observacao: 'Consta só na aba ADIANTAMENTOS (não está na aba ALTCRED).', origem: 'Planilha Pagamento 2026 › ADIANTAMENTOS',
      utilizadoPlanilha: r2(u), pontos: [], sobraAdiantamento: false,
    });
  }));
  const naListaAdiant = new Set(listaAdiant.map(a => a.numero));

  const altcredCriadas: string[] = [];
  const usoPorAltcred = new Map<string, B[]>();
  baixasBrutas.forEach(b => { const l = usoPorAltcred.get(b.altcred) || []; l.push(b); usoPorAltcred.set(b.altcred, l); });
  usoPorAltcred.forEach((bs, n) => {
    if (documentos.has(n) || ctx.documentosExistentes.has(n)) return;
    const total = r2(bs.reduce((s, b) => s + b.valor, 0));
    const cmd = ctx.resolverComando(bs[0].cliente);
    const adiant = bs.every(b => b.origem.startsWith('RESUMO'));
    documentos.set(n, {
      id: ctx.novoId(), numero: n, tipoDocumento: 'ALTCRED', operacao: adiant ? 'ADIANTAMENTO' : 'PAGAMENTO', valor: total,
      data: bs.map(b => b.data).filter(Boolean).sort()[0] || ctx.hoje,
      ug: cmd?.codigo ?? '', setor: cmd?.setor || normalizarSetor(bs[0].setor).sigla || '', comando: cmd?.nome ?? limpar(bs[0].cliente),
      cliente: cmd?.nome ?? limpar(bs[0].cliente), comandoId: cmd?.comandoId ?? null,
      observacao: 'ALTCRED citada nas baixas, mas ausente da aba ALTCRED (provável exercício anterior). Valor = soma das baixas; confira no SIPLAD.',
      origem: 'Planilha Pagamento 2026 › baixas', utilizadoPlanilha: total,
      pontos: [{ tipo: 'ALTCRED_CRIADA', mensagem: `Ausente da aba ALTCRED; criada com ${rs(total)}, soma de ${bs.length} baixa(s) da planilha.`, origem: 'migracao', em: ctx.hoje }],
    });
    altcredCriadas.push(`${n}: ${bs.length} baixa(s), R$ ${total.toFixed(2)}`);
  });
  const numeroGru = (g: { autenticacao: string; fatura: string }) => (g.autenticacao ? `GRU ${g.autenticacao}` : `GRU ${g.fatura}`);
  const valorGru = new Map<string, number>();
  gru.forEach(g => valorGru.set(numeroGru(g), (valorGru.get(numeroGru(g)) || 0) + g.valor));
  gru.forEach(g => {
    const fat = faturas.get(g.fatura)!;
    if (documentos.has(numeroGru(g))) return; // mesma autenticação quitou mais de uma fatura
    documentos.set(numeroGru(g), {
      id: ctx.novoId(), numero: numeroGru(g), tipoDocumento: 'GRU', operacao: 'PAGAMENTO', valor: r2(valorGru.get(numeroGru(g))!), data: g.data,
      ug: fat.ug, setor: fat.setor, comando: fat.comando, cliente: fat.cliente, comandoId: null,
      observacao: g.autenticacao ? `Autenticação bancária ${g.autenticacao}` : 'GRU sem autenticação bancária informada na planilha',
      origem: 'Planilha Pagamento 2026 › Faturas Extra-MB', utilizadoPlanilha: r2(valorGru.get(numeroGru(g))!), pontos: [],
    });
  });

  documentos.forEach((d, n) => { if (sobraParaAdiant.has(n) && d.operacao !== 'ADIANTAMENTO') d.sobraAdiantamento = true; });
  usoPorAltcredAdiant(baixasBrutas).forEach(n => { const d = documentos.get(n); if (d && d.operacao !== 'ADIANTAMENTO') d.sobraAdiantamento = true; });

  // 5-B. Adiantamentos do livro sem ALTCRED identificada: um documento por comando e ano, para o saldo fechar
  const semAltcredDoc = new Map<string, DocumentoPlano>();
  const docSemAltcredDaFatura = new Map<string, DocumentoPlano>();
  const qtdSemAltcred = new Map<string, number>();
  adiantSemAltcred.forEach(a => {
    const fat = faturas.get(a.fatura)!;
    const cmd = ctx.resolverComando(a.comando);
    const cod = cmd?.codigo ?? lerComando(a.comando)?.codigo ?? fat.ug;
    const numeroDoc = `S/ALTCRED ${a.ano} ${cod}`;
    if (ctx.documentosExistentes.has(numeroDoc)) return;
    let d = semAltcredDoc.get(numeroDoc);
    if (!d) {
      d = {
        id: ctx.novoId(), numero: numeroDoc, tipoDocumento: 'ALTCRED', operacao: 'ADIANTAMENTO', valor: 0, data: fat.emissao,
        ug: cod, setor: cmd?.setor || fat.setor, comando: cmd?.nome ?? fat.comando, cliente: cmd?.nome ?? fat.comando, comandoId: cmd?.comandoId ?? null,
        observacao: `Adiantamentos abatidos em faturas de ${a.ano} segundo o livro de emissão (coluna "Valor do Adiantamento"), sem a ALTCRED correspondente no RESUMO ADIANTAMENTO.`,
        origem: 'Planilha Faturamento › adiantamento sem ALTCRED', utilizadoPlanilha: null, pontos: [],
      };
      semAltcredDoc.set(numeroDoc, d);
      documentos.set(numeroDoc, d);
    }
    d.valor = r2(d.valor + a.valor);
    if (fat.emissao < d.data) d.data = fat.emissao;
    docSemAltcredDaFatura.set(a.fatura, d);
    qtdSemAltcred.set(d.numero, (qtdSemAltcred.get(d.numero) || 0) + 1);
  });
  semAltcredDoc.forEach(d => anotar(d, 'ALTCRED_NAO_IDENTIFICADA',
    `${qtdSemAltcred.get(d.numero)} fatura(s) com adiantamento de ${rs(d.valor)} no livro de emissão sem a ALTCRED no RESUMO ADIANTAMENTO.`));

  // 6. Baixas
  const baixas: BaixaPlano[] = [];
  const semFatura: string[] = [], semDocumento: string[] = [];
  let baixasEmExistentes = 0;
  baixasBrutas.forEach(b => {
    const fat = faturas.get(b.fatura);
    const doc = documentos.get(b.altcred);
    // migração complementar: um dos lados já está no sistema e o outro é novo → liga ao existente
    const fatId = fat?.id ?? (doc ? ctx.idFaturaExistente?.(b.fatura) : undefined);
    const docId = doc?.id ?? (fat ? ctx.idDocumentoExistente?.(b.altcred) : undefined);
    if (!fatId) {
      if (ctx.faturasExistentes.has(b.fatura)) return; // fatura e documento já existem: baixa já gravada antes
      semFatura.push(`${b.altcred} → ${b.fatura} (R$ ${b.valor.toFixed(2)})`);
      anotar(doc, 'BAIXA_SEM_FATURA', `A planilha (${b.origem.split(' (')[0]}) baixava ${rs(b.valor)} na fatura ${b.fatura}${b.data ? ` em ${br(b.data)}` : ''}, que não existe em nenhuma lista; baixa não migrada.`);
      return;
    }
    if (!docId) { if (!ctx.documentosExistentes.has(b.altcred)) semDocumento.push(`${b.altcred} → ${b.fatura}`); return; }
    if (!fat || !doc) baixasEmExistentes++;
    baixas.push({ id: ctx.novoId(), documentoId: docId, faturaId: fatId, valor: r2(b.valor), data: b.data || doc?.data || ctx.hoje, origem: b.origem, sigla: fat?.sigla ?? lerFatura(b.fatura)?.sigla ?? '' });
  });
  adiantSemAltcred.forEach(a => {
    const fat = faturas.get(a.fatura)!;
    const d = docSemAltcredDaFatura.get(a.fatura);
    if (d) baixas.push({ id: ctx.novoId(), documentoId: d.id, faturaId: fat.id, valor: a.valor, data: fat.emissao, origem: 'RESUMO ADIANTAMENTO (livro de emissão, sem ALTCRED)', sigla: fat.sigla });
  });
  aviso('ALTCRED_NAO_IDENTIFICADA', true, `${adiantSemAltcred.length} fatura(s) quitadas com adiantamento registrado só no livro de emissão (sem a ALTCRED no RESUMO ADIANTAMENTO), somando ${rs(r2(adiantSemAltcred.reduce((s2, a) => s2 + a.valor, 0)))}: valor do serviço tirado do livro e adiantamento lançado em "S/ALTCRED <ano> <comando>".`,
    adiantSemAltcred.map(a => `${a.fatura}: ${rs(a.valor)}`));
  gru.forEach(g => {
    const doc = documentos.get(numeroGru(g))!;
    const fat = faturas.get(g.fatura)!;
    baixas.push({ id: ctx.novoId(), documentoId: doc.id, faturaId: fat.id, valor: r2(g.valor), data: g.data, origem: 'GRU (extra-MB)', sigla: fat.sigla });
  });

  // 7. Conferência com a planilha
  const porFatura = new Map<string, { adiant: number; pago: number }>();
  baixas.forEach(b => {
    const s = porFatura.get(b.faturaId) || { adiant: 0, pago: 0 };
    if (b.origem.startsWith('RESUMO')) s.adiant += b.valor; else s.pago += b.valor;
    porFatura.set(b.faturaId, s);
  });
  let conferidasFaturas = 0, abertas = 0, valorAberto = 0, valorAbertoPlanilha = 0;
  let abertoFaturas = 0, abertoContestadas = 0, abertoExtraMB = 0, abertoOutras = 0;
  const divergentes: string[] = [], pagoMaior: string[] = [], adiantMaior: string[] = [];
  faturas.forEach(f => {
    if (f.cancelada) return;
    const s = porFatura.get(f.id) || { adiant: 0, pago: 0 };
    const total = r2(f.valor + f.acrescimo - f.debito);
    const saldo = f.quitacaoExterna ? 0 : r2(total - s.adiant - s.pago);
    if (s.adiant > 0.01 && s.adiant > total + 0.01) adiantMaior.push(`${f.numero}: serviço R$ ${total.toFixed(2)}, adiantamento usado R$ ${r2(s.adiant).toFixed(2)}`);
    if (saldo < -0.01) pagoMaior.push(`${f.numero}: pago R$ ${r2(s.adiant + s.pago).toFixed(2)} para R$ ${total.toFixed(2)} (excedente R$ ${(-saldo).toFixed(2)})`);
    if (saldo > 0.01) {
      abertas++; valorAberto += saldo;
      if (f.contestada) abertoContestadas += saldo;
      else if (f.origem === ORIGEM.faturas) abertoFaturas += saldo;
      else if (f.origem === ORIGEM.extra) abertoExtraMB += saldo;
      else abertoOutras += saldo;
    }
    if (['VENCIDA', 'A VENCER'].includes(f.statusPlanilha || '') && f.saldoPlanilha !== null) valorAbertoPlanilha += Math.max(0, f.saldoPlanilha - s.pago);
    if (f.quitacaoExterna || !f.statusPlanilha) return;
    const quitadaPlan = f.statusPlanilha === 'PAGO' || f.statusPlanilha === 'PAGO A MAIOR';
    const abertaPlan = f.statusPlanilha === 'VENCIDA' || f.statusPlanilha === 'A VENCER';
    const ok = (quitadaPlan && saldo <= 0.01) || (abertaPlan && saldo > 0.01) || (!quitadaPlan && !abertaPlan);
    if (ok) conferidasFaturas++;
    else {
      divergentes.push(`${f.numero}: planilha ${f.statusPlanilha}, saldo calculado R$ ${saldo.toFixed(2)}`);
      anotar(f, 'STATUS_DIVERGENTE', `Na planilha: ${f.statusPlanilha}; pelas baixas migradas o saldo é ${rs(saldo)}.`);
    }
  });
  let conferidasAltcred = 0;
  const altDiv: string[] = [], altEstouro: string[] = [];
  const usoDoc = new Map<string, number>();
  baixas.forEach(b => usoDoc.set(b.documentoId, (usoDoc.get(b.documentoId) || 0) + b.valor));
  documentos.forEach(d => {
    const usado = r2(usoDoc.get(d.id) || 0);
    if (usado > d.valor + 0.01) altEstouro.push(`${d.numero}: valor R$ ${d.valor.toFixed(2)}, baixado R$ ${usado.toFixed(2)}`);
    if (d.utilizadoPlanilha === null) return;
    if (Math.abs(usado - d.utilizadoPlanilha) <= 0.01) conferidasAltcred++;
    else {
      altDiv.push(`${d.numero}: planilha utilizado R$ ${d.utilizadoPlanilha.toFixed(2)}, migrado R$ ${usado.toFixed(2)}`);
      anotar(d, 'ALTCRED_DIVERGENTE', `VALOR UTILIZADO na aba ALTCRED ${rs(d.utilizadoPlanilha)}; baixas migradas somam ${rs(usado)}.`);
    }
  });

  // 7-A. Conferência da aba ADIANTAMENTOS (valor encaminhado, utilizado e saldo por ALTCRED)
  let conferidasAdiant = 0, saldoAdiantPlanilha = 0, saldoAdiantSistema = 0;
  const adiantDiv: string[] = [];
  const canceladasIds = new Set([...faturas.values()].filter(f => f.cancelada).map(f => f.id));
  const pagoDoc = new Map<string, number>(), adiantDoc = new Map<string, number>();
  baixas.forEach(b => {
    const m = b.origem.startsWith('RESUMO') ? adiantDoc : pagoDoc;
    if (!canceladasIds.has(b.faturaId)) m.set(b.documentoId, r2((m.get(b.documentoId) || 0) + b.valor));
  });
  listaAdiant.forEach(a => {
    const d = documentos.get(a.numero);
    saldoAdiantPlanilha += a.saldo;
    if (!d) return; // já existia no sistema antes desta leitura
    const parte = d.operacao === 'ADIANTAMENTO' ? d.valor : r2(d.valor - (pagoDoc.get(d.id) || 0));
    const usado = adiantDoc.get(d.id) || 0;
    const saldo = r2(parte - usado);
    saldoAdiantSistema += saldo;
    const p: string[] = [];
    if (Math.abs(parte - a.valor) > 0.01) p.push(`enviado para adiantamento: planilha ${rs(a.valor)} × sistema ${rs(parte)}`);
    if (Math.abs(usado - a.utilizado) > 0.01) p.push(`utilizado: planilha ${rs(a.utilizado)} × sistema ${rs(usado)}`);
    if (Math.abs(saldo - a.saldo) > 0.01) p.push(`saldo: planilha ${rs(a.saldo)} × sistema ${rs(saldo)}`);
    if (!p.length) { conferidasAdiant++; return; }
    adiantDiv.push(`${a.numero} (${a.cliente}): ${p.join('; ')}`);
    anotar(d, 'ADIANTAMENTO_DIVERGENTE', `Aba ADIANTAMENTOS × sistema — ${p.join('; ')}.`);
  });
  const naoEnviadas = [...new Set(baixasBrutas.filter(b => b.origem.startsWith('RESUMO') && !naListaAdiant.has(b.altcred)).map(b => b.altcred))];
  if (listaAdiant.length) naoEnviadas.forEach(n => anotar(documentos.get(n), 'ADIANTAMENTO_NAO_ENVIADO',
    `Usada como adiantamento no RESUMO ADIANTAMENTO (${rs(r2(baixasBrutas.filter(b => b.altcred === n && b.origem.startsWith('RESUMO')).reduce((s2, b) => s2 + b.valor, 0)))}), mas não consta na aba ADIANTAMENTOS.`));
  aviso('ADIANTAMENTO_DIVERGENTE', true, `${adiantDiv.length} ALTCRED da aba ADIANTAMENTOS com valor enviado, utilizado ou saldo diferente do calculado pelas baixas.`, adiantDiv);
  if (listaAdiant.length) aviso('ADIANTAMENTO_NAO_ENVIADO', true, `${naoEnviadas.length} ALTCRED usadas como adiantamento no RESUMO sem constar na aba ADIANTAMENTOS.`, naoEnviadas);

  aviso('ALTCRED_ESTOURADA', true, `${altEstouro.length} ALTCRED com baixas acima do valor recebido (crédito usado a mais na planilha). Migradas como estão; corrija as baixas.`, altEstouro);
  aviso('ADIANTAMENTO_MAIOR', true, `${adiantMaior.length} fatura(s) com adiantamento usado maior que o valor do serviço.`, adiantMaior);
  aviso('PAGO_A_MAIOR', true, `${pagoMaior.length} fatura(s) com baixas acima do valor (pago a maior).`, pagoMaior);
  aviso('STATUS_DIVERGENTE', true, `${divergentes.length} fatura(s) cuja situação calculada difere do STATUS da planilha.`, divergentes);
  aviso('ALTCRED_DIVERGENTE', true, `${altDiv.length} ALTCRED cujo valor utilizado migrado difere do da planilha.`, altDiv);
  aviso('SEM_CLIENTE', true, `${semCliente.length} fatura(s) sem cliente correspondente no cadastro (importadas com o nome da planilha; ligue ao cadastro depois).`, semCliente);
  aviso('BAIXA_SEM_FATURA', true, `${semFatura.length} baixa(s) para fatura que não está nas listas de faturas (não importadas).`, semFatura);
  aviso('BAIXA_SEM_DOCUMENTO', true, `${semDocumento.length} baixa(s) com documento já existente no sistema (não importadas).`, semDocumento);
  aviso('ALTCRED_CRIADA', false, `${altcredCriadas.length} ALTCRED citadas nas baixas e ausentes da aba ALTCRED foram criadas com o valor das baixas.`, altcredCriadas);
  aviso('VENCIMENTO_CORRIGIDO', false, `${vencCorrigido.length} vencimento(s) inválidos, vazios ou anteriores à emissão recalculados pela OI 40-04 (emissão + ${ctx.prazoDiasUteis} dias úteis).`, vencCorrigido);
  aviso('EMISSAO_CORRIGIDA', false, `${emisCorrigida.length} data(s) de emissão ausentes ou inválidas: adotado o dia 15 do mês seguinte à competência.`, emisCorrigida);
  aviso('VALOR_DIVERGENTE_LIVRO', false, `${servicoDivergente.length} fatura(s) com valor vigente na planilha diferente do livro de emissão (desconto ou correção após a emissão); adotado o valor da planilha.`, servicoDivergente);
  aviso('FATURA_REPETIDA', false, `${repetidas.length} fatura(s) aparecem em mais de uma lista; vale a primeira (FATURAS > Extra-MB > Pagas).`, repetidas);
  aviso('JA_EXISTENTE', false, `${existentes.length} fatura(s) e ${docsExistentes.length} documento(s) já existem no sistema e foram mantidos como estão.`, [...existentes, ...docsExistentes]);
  aviso('FORA_DO_PADRAO', false, `${foraPadrao.length} número(s) de fatura fora do padrão OM-SS-MM-AAAA-SEQ-V (importados como estão).`, foraPadrao);
  if (!p.livro.length) aviso('SEM_LIVRO', true, 'O livro de emissão (planilha Faturamento) não foi enviado: sem ele, o valor do serviço das faturas com adiantamento é reconstruído (valor final + adiantamento usado) e não há consumo, acréscimo e débito.', []);

  const lista = [...faturas.values()];
  const porOrigem: Record<string, number> = {};
  lista.forEach(f => { porOrigem[f.origem] = (porOrigem[f.origem] || 0) + 1; });
  return {
    faturas: lista,
    documentos: [...documentos.values()],
    baixas,
    avisos,
    resumo: {
      porOrigem, abertas, valorAberto: r2(valorAberto), valorAbertoPlanilha: r2(valorAbertoPlanilha),
      abertoFaturas: r2(abertoFaturas), abertoContestadas: r2(abertoContestadas), abertoExtraMB: r2(abertoExtraMB), abertoOutras: r2(abertoOutras),
      conferidasFaturas, divergentesFaturas: divergentes.length, conferidasAltcred, divergentesAltcred: altDiv.length,
      conferidasAdiant, divergentesAdiant: adiantDiv.length, saldoAdiantPlanilha: r2(saldoAdiantPlanilha), saldoAdiantSistema: r2(saldoAdiantSistema),
      baixasEmExistentes,
      ignoradasExistentes: existentes.length + docsExistentes.length,
    },
  };
}

/** Índice para resolver o cliente do cadastro de cada fatura (usa o índice da análise do cadastro). */
/** ALTCRED de pagamento usadas no RESUMO ADIANTAMENTO: a sobra delas virou adiantamento. */
function usoPorAltcredAdiant(bs: { altcred: string; origem: string }[]) {
  return new Set(bs.filter(b => b.origem.startsWith('RESUMO')).map(b => b.altcred));
}

export function criarResolverOM(
  indice: Record<string, string>,
  propostas: { chave: string; codigo: string; nome: string; tipo: string }[],
  oms: { id: string; codigo: string; nome: string; tipo: string; setor: string; comando: string }[],
): ContextoImportacao['resolverOM'] {
  const prop = new Map(propostas.map(p => [p.chave, p]));
  const porCodNome = new Map(oms.map(o => [`${o.codigo}|${chave(o.nome)}`, o]));
  const extraPorNome = new Map(oms.filter(o => o.tipo === 'EXTRA_MB').map(o => [chave(o.nome), o]));
  return l => {
    const k = chaveDaLinha(l);
    if (!k) return null;
    const p = indice[k] ? prop.get(indice[k]) : undefined;
    const alvo = p
      ? (p.tipo === 'EXTRA_MB' ? extraPorNome.get(chave(p.nome)) : undefined) || porCodNome.get(`${p.codigo}|${chave(p.nome)}`)
      : porCodNome.get(k) || (k.startsWith('X|') ? extraPorNome.get(k.slice(2)) : undefined);
    return alvo ? { omId: alvo.id, codigo: alvo.codigo, nome: alvo.nome, setor: alvo.setor, comando: alvo.comando } : null;
  };
}
