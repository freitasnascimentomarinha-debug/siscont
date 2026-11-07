import { supabase } from './supabase';
import { cadastroService } from './cadastroService';
import { chave, PlanoImportacao } from '../utils/cadastroImport';

const LOTE = 200;

async function inserir(tabela: string, linhas: any[]) {
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await supabase.from(tabela).insert(linhas.slice(i, i + LOTE));
    if (error && /codigo_proprio|indicativo_naval/.test(error.message || '')) {
      throw new Error('Falta executar o script supabase/migrations/003_codigo_proprio_indicativo.sql no Supabase antes de importar.');
    }
    if (error) throw new Error(`Erro ao gravar ${tabela}: ${error.message}`);
  }
}

export interface ResultadoImportacao { setores: number; comandos: number; classes: number; oms: number; classesAplicadas: number }

/** Grava o plano na ordem setores → comandos → classes → OM (cada etapa resolve os ids da anterior). */
export async function aplicarImportacao(plano: PlanoImportacao, onProgresso?: (msg: string) => void): Promise<ResultadoImportacao> {
  onProgresso?.('Gravando setores...');
  await inserir('setores', plano.setores.map(sigla => ({ sigla, ordem: 500 })));
  const setores = await cadastroService.listSetores();
  const setorId = new Map(setores.map(s => [s.sigla.toUpperCase(), s.id]));

  onProgresso?.('Gravando comandos...');
  await inserir('comandos', plano.comandos.map(c => ({ codigo: c.codigo, nome: c.nome, setor_id: c.setor ? setorId.get(c.setor.toUpperCase()) ?? null : null })));
  const comandos = await cadastroService.listComandos();
  const cmdId = new Map(comandos.map(c => [c.codigo ? `#${c.codigo}` : `@${chave(c.nome)}`, c.id]));

  onProgresso?.('Gravando classes de navio...');
  await inserir('classes_navio', plano.classes.map(nome => ({ nome })));
  const classes = await cadastroService.listClasses();
  const classeId = new Map(classes.map(c => [chave(c.nome), c.id]));

  onProgresso?.(`Gravando ${plano.oms.length} OM...`);
  await inserir('oms', plano.oms.map(o => ({
    codigo: o.codigo,
    codigo_proprio: o.codigoProprio,
    nome: o.nome,
    tipo: o.tipo,
    comando_id: o.comandoChave ? cmdId.get(o.comandoChave) ?? null : null,
    setor_id: o.setor ? setorId.get(o.setor.toUpperCase()) ?? null : null,
    classe_id: o.tipo === 'NAVIO' && o.classe ? classeId.get(chave(o.classe)) ?? null : null,
    ativo: o.ativo,
    desativado_em: o.desativadoEm,
    motivo_desativacao: o.motivo,
    observacao: o.variantes.length ? `Também grafado: ${o.variantes.slice(0, 5).join('; ')}` : null,
  })));

  let classesAplicadas = 0;
  for (const c of plano.classesEmOMExistentes) {
    const id = classeId.get(chave(c.classe));
    if (!id) continue;
    const { error } = await supabase.from('oms').update({ classe_id: id }).eq('id', c.omId);
    if (error) throw new Error(`Erro ao associar classe: ${error.message}`);
    classesAplicadas++;
  }
  onProgresso?.('Concluído.');
  return { setores: plano.setores.length, comandos: plano.comandos.length, classes: plano.classes.length, oms: plano.oms.length, classesAplicadas };
}
