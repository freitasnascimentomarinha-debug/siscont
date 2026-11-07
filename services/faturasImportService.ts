import { supabase } from './supabase';
import { supabaseService } from './supabaseService';
import { cadastroService } from './cadastroService';
import { db } from './db';
import { lerComando } from '../utils/cadastroImport';
import { ContextoImportacao, PlanoMigracao, criarResolverOM } from '../utils/faturasImport';
import type { PropostaCadastro } from '../utils/cadastroImport';
import type { RegistroPonto } from '../utils/pontosAtencao';

const LOTE = 500;
export const PREFIXO_ORIGEM_BAIXA = 'Migração › ';

const erroColuna = (msg: string) => /om_id|origem|quitacao_externa|quitada_em|contestada|comando_id/.test(msg) && /column/i.test(msg);

async function inserir(tabela: string, linhas: any[], onProgresso?: (m: string) => void, rotulo?: string) {
  for (let i = 0; i < linhas.length; i += LOTE) {
    let lote = linhas.slice(i, i + LOTE);
    let { error } = await supabase.from(tabela).insert(lote);
    if (error && /tipo_baixa|sobra_adiantamento/.test(error.message || '')) { // antes do script 006
      lote = lote.map(({ tipo_baixa, sobra_adiantamento, ...resto }) => resto);
      ({ error } = await supabase.from(tabela).insert(lote));
    }
    if (error && /pontos_atencao/.test(error.message || '')) throw new Error('Falta executar o script supabase/migrations/005_pontos_atencao.sql no Supabase antes de migrar.');
    if (error && erroColuna(error.message || '')) throw new Error('Falta executar o script supabase/migrations/004_migracao_faturas.sql no Supabase antes de migrar.');
    if (error) throw new Error(`Erro ao gravar ${rotulo || tabela} (lote ${i / LOTE + 1}): ${error.message}`);
    onProgresso?.(`${rotulo || tabela}: ${Math.min(i + LOTE, linhas.length)} de ${linhas.length}`);
  }
}

/** Dados do sistema necessários para montar o plano (cadastro, serviços, feriados, o que já existe). */
export async function carregarContexto(proposta: PropostaCadastro): Promise<{ ctx: ContextoImportacao; omsCadastradas: number }> {
  const [oms, comandos, setores, servicos, feriados, parametros, faturas, documentos] = await Promise.all([
    cadastroService.listOMs(), cadastroService.listComandos(), cadastroService.listSetores(), cadastroService.listServicos(),
    cadastroService.listFeriados(), cadastroService.listParametros(), supabaseService.getInvoices(), supabaseService.getDocuments(),
  ]);
  const setorDe = new Map(setores.map(s => [s.id, s.sigla]));
  const cmdDe = new Map(comandos.map(c => [c.id, c]));
  const omsCtx = oms.map(o => {
    const c = o.comandoId ? cmdDe.get(o.comandoId) : undefined;
    return {
      id: o.id, codigo: o.codigo, nome: o.nome, tipo: o.tipo,
      setor: (o.setorId && setorDe.get(o.setorId)) || (c?.setorId && setorDe.get(c.setorId)) || '',
      comando: c ? `${c.codigo ? c.codigo + ' - ' : ''}${c.nome}` : '',
    };
  });
  const cmdPorCodigo = new Map(comandos.filter(c => c.codigo).map(c => [c.codigo!, c]));
  const idFat = new Map(faturas.map(f => [(f.invoiceNumber || '').trim().toUpperCase(), f.id]));
  const idDoc = new Map(documentos.map(d => [(d.documentNumber || '').trim().toUpperCase(), d.id]));
  const prazo = Number(parametros.find(p => p.chave === 'prazo_certificacao_dias_uteis')?.valor) || 10;
  return {
    omsCadastradas: oms.length,
    ctx: {
      resolverOM: criarResolverOM(proposta.indice, proposta.oms, omsCtx),
      resolverComando: texto => {
        const cod = lerComando(texto)?.codigo;
        const c = cod ? cmdPorCodigo.get(cod) : undefined;
        return c ? { comandoId: c.id, codigo: c.codigo!, nome: c.nome, setor: (c.setorId && setorDe.get(c.setorId)) || '' } : null;
      },
      servicos: servicos.map(s => ({ sigla: s.acronym.toUpperCase(), nome: s.name, unidade: s.unitMeasure || '' })),
      feriados: feriados.map(f => f.data),
      prazoDiasUteis: prazo,
      prazoVencimentoDias: Number(parametros.find(p => p.chave === 'prazo_vencimento_dias_corridos')?.valor) || 30,
      faturasExistentes: new Set(faturas.map(f => (f.invoiceNumber || '').trim().toUpperCase())),
      documentosExistentes: new Set(documentos.map(d => (d.documentNumber || '').trim().toUpperCase())),
      idFaturaExistente: (n => idFat.get(n)),
      idDocumentoExistente: (n => idDoc.get(n)),
      hoje: new Date().toISOString().slice(0, 10),
      novoId: () => crypto.randomUUID(),
    },
  };
}

export interface ResultadoMigracao { documentos: number; faturas: number; baixas: number }

/** Grava documentos → faturas → baixas (as baixas apontam para os dois). */
export async function aplicarMigracao(plano: PlanoMigracao, onProgresso?: (m: string) => void): Promise<ResultadoMigracao> {
  await inserir('received_documents', plano.documentos.map(d => ({
    id: d.id, ug: d.ug, sector: d.setor, command: d.comando, client: d.cliente, document_number: d.numero,
    document_type: d.tipoDocumento, total_value: d.valor, date: d.data, operation: d.operacao,
    observation: d.observacao, comando_id: d.comandoId, origem: d.origem, pontos_atencao: d.pontos,
    sobra_adiantamento: !!d.sobraAdiantamento,
  })), onProgresso, 'Documentos (ALTCRED/GRU)');

  await inserir('invoices', plano.faturas.map(f => ({
    id: f.id, ug: f.ug, sector: f.setor, command: f.comando, client: f.cliente, invoice_number: f.numero,
    consumption: f.consumo, unit_measure: f.unidade, service_acronym: f.sigla, value: f.valor,
    adjustment_addition: f.acrescimo, adjustment_deduction: f.debito, issue_date: f.emissao, due_date: f.vencimento,
    month_competence: f.mesCompetencia, year_competence: f.anoCompetencia, competence: f.competencia, type: f.tipo,
    is_canceled: f.cancelada, observation: f.observacao, siplad_settled: f.siplad,
    om_id: f.omId, origem: f.origem, quitacao_externa: f.quitacaoExterna, quitada_em: f.quitadaEm, contestada: f.contestada,
    pontos_atencao: f.pontos,
  })), onProgresso, 'Faturas');

  const fat = new Map(plano.faturas.map(f => [f.id, f]));
  const documentoAdiant = new Set(plano.documentos.filter(d => d.operacao === 'ADIANTAMENTO').map(d => d.id));
  await inserir('payment_allocations', plano.baixas.map(b => ({
    id: b.id, document_id: b.documentoId, invoice_id: b.faturaId, amount: b.valor, date: b.data,
    service_type: fat.get(b.faturaId)?.tipo ?? b.sigla, siscont_settled: fat.get(b.faturaId)?.siplad ?? false,
    observation: b.origem, origem: PREFIXO_ORIGEM_BAIXA + b.origem,
    tipo_baixa: b.origem.startsWith('RESUMO') || documentoAdiant.has(b.documentoId) ? 'ADIANTAMENTO' : 'PAGAMENTO',
  })), onProgresso, 'Baixas');

  db.invalidateCache();
  return { documentos: plano.documentos.length, faturas: plano.faturas.length, baixas: plano.baixas.length };
}

/** Situação da migração já gravada (para mostrar e permitir desfazer). */
export async function situacaoMigracao() {
  const [faturas, documentos, baixas] = await Promise.all([
    supabaseService.getInvoices(), supabaseService.getDocuments(), supabaseService.getAllocations(),
  ]);
  const fatMig = new Set(faturas.filter(f => f.origem?.startsWith('Planilha')).map(f => f.id));
  const docMig = new Set(documentos.filter(d => d.origem?.startsWith('Planilha')).map(d => d.id));
  const baixasMig = baixas.filter(b => b.origem?.startsWith(PREFIXO_ORIGEM_BAIXA) || (b.observation || '').match(/^(LANÇAMENTOS|RESUMO ADIANTAMENTO|GRU \(extra-MB\))/));
  const idsBaixasMig = new Set(baixasMig.map(b => b.id));
  const manuaisSobreMigrado = baixas.filter(b => !idsBaixasMig.has(b.id) && (fatMig.has(b.invoiceId) || docMig.has(b.documentId)));
  return { faturas: fatMig.size, documentos: docMig.size, baixas: baixasMig.length, manuaisSobreMigrado: manuaisSobreMigrado.length, idsBaixas: [...idsBaixasMig], idsFaturas: [...fatMig], idsDocs: [...docMig] };
}

async function apagar(tabela: string, ids: string[], onProgresso?: (m: string) => void) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from(tabela).delete().in('id', ids.slice(i, i + 200));
    if (error) throw new Error(`Erro ao desfazer (${tabela}): ${error.message}`);
    onProgresso?.(`Removendo ${tabela}: ${Math.min(i + 200, ids.length)} de ${ids.length}`);
  }
}

/** Remove tudo o que a migração gravou. Recusa se houver baixas manuais sobre registros migrados. */
export async function desfazerMigracao(onProgresso?: (m: string) => void) {
  const s = await situacaoMigracao();
  if (s.manuaisSobreMigrado > 0) {
    throw new Error(`Há ${s.manuaisSobreMigrado} baixa(s) lançadas manualmente sobre faturas ou documentos migrados. Remova-as antes de desfazer a migração.`);
  }
  await apagar('payment_allocations', s.idsBaixas, onProgresso);
  await apagar('invoices', s.idsFaturas, onProgresso);
  await apagar('received_documents', s.idsDocs, onProgresso);
  db.invalidateCache();
  return s;
}

/**
 * Para faturas/documentos JÁ migrados antes dos pontos de atenção: grava neles os pontos que a migração
 * conhece. Use com um plano montado sem "existentes" (todos os números da planilha). Mantém o que o
 * usuário já marcou como resolvido.
 */
export async function gravarPontosEmExistentes(plano: PlanoMigracao, onProgresso?: (m: string) => void): Promise<number> {
  const [faturas, documentos] = await Promise.all([supabaseService.getInvoices(), supabaseService.getDocuments()]);
  const chave = (n: string) => (n || '').trim().toUpperCase();
  const idFat = new Map(faturas.map(f => [chave(f.invoiceNumber), f]));
  const idDoc = new Map(documentos.map(d => [chave(d.documentNumber), d]));
  const tarefas: { tabela: string; id: string; pontos: RegistroPonto[]; extra?: Record<string, any> }[] = [];
  const mesclar = (atuais: RegistroPonto[] = [], novos: RegistroPonto[]) => {
    const fora = atuais.filter(r => r.origem !== 'migracao');
    const res = novos.map(n => atuais.find(a => a.origem === 'migracao' && a.tipo === n.tipo && a.mensagem === n.mensagem) || n);
    return [...fora, ...res];
  };
  plano.faturas.forEach(f => {
    const ex = idFat.get(chave(f.numero));
    if (!ex || (!f.pontos.length && !(ex.pontosRegistro || []).some(r => r.origem === 'migracao'))) return;
    tarefas.push({ tabela: 'invoices', id: ex.id, pontos: mesclar(ex.pontosRegistro, f.pontos) });
  });
  plano.documentos.forEach(d => {
    const ex = idDoc.get(chave(d.numero));
    if (!ex) return;
    // sobra da ALTCRED de pagamento encaminhada para adiantamento (aba ADIANTAMENTOS)
    const extra = d.sobraAdiantamento && ex.sobraAdiantamento === false ? { sobra_adiantamento: true } : undefined;
    if (!extra && !d.pontos.length && !(ex.pontosRegistro || []).some(r => r.origem === 'migracao')) return;
    tarefas.push({ tabela: 'received_documents', id: ex.id, pontos: mesclar(ex.pontosRegistro, d.pontos), extra });
  });
  for (let i = 0; i < tarefas.length; i += 10) {
    await Promise.all(tarefas.slice(i, i + 10).map(async t => {
      const { error } = await supabase.from(t.tabela).update({ pontos_atencao: t.pontos, ...(t.extra || {}) }).eq('id', t.id);
      if (error && /pontos_atencao/.test(error.message)) throw new Error('Falta executar o script supabase/migrations/005_pontos_atencao.sql no Supabase.');
      if (error) throw new Error(`Erro ao gravar pontos de atenção: ${error.message}`);
    }));
    onProgresso?.(`Pontos de atenção: ${Math.min(i + 10, tarefas.length)} de ${tarefas.length}`);
  }
  db.invalidateCache();
  return tarefas.length;
}
