/**
 * Exportação dos cadastros para planilha: funções puras que filtram e montam as linhas.
 * A tela só escolhe os filtros e grava o arquivo.
 */
import { ClasseNavio, Comando, OM, ServicoCatalogo, Setor, TIPO_OM_LABELS } from '../types';

export type Situacao = 'TODAS' | 'ATIVAS' | 'DESATIVADAS';
export interface FiltroOM {
  situacao: Situacao;
  /** valores EXCLUÍDOS (padrão do MultiFiltro): vazio = todos */
  tiposExcluidos: Set<string>;
  setoresExcluidos: Set<string>;
  comandosExcluidos: Set<string>;
  classesExcluidas: Set<string>;
  foraDaIlha: 'TODAS' | 'SIM' | 'NAO';
  busca: string;
}
export const FILTRO_VAZIO: FiltroOM = {
  situacao: 'TODAS', tiposExcluidos: new Set(), setoresExcluidos: new Set(), comandosExcluidos: new Set(), classesExcluidas: new Set(), foraDaIlha: 'TODAS', busca: '',
};

export interface Estrutura { setores: Setor[]; comandos: Comando[]; classes: ClasseNavio[] }

const SEM = '(sem)';
const sim = (b?: boolean | null) => (b ? 'Sim' : 'Não');
const sit = (ativo?: boolean) => (ativo === false ? 'Desativado' : 'Ativo');
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const nomeSetor = (e: Estrutura, id?: string | null) => (id && e.setores.find(s => s.id === id)?.sigla) || SEM;
export const nomeComando = (e: Estrutura, id?: string | null) => (id && e.comandos.find(c => c.id === id)?.nome) || SEM;
export const nomeClasse = (e: Estrutura, id?: string | null) => (id && e.classes.find(c => c.id === id)?.nome) || SEM;

export function filtrarOMs(oms: OM[], e: Estrutura, f: FiltroOM): OM[] {
  const q = norm(f.busca.trim());
  return oms.filter(o => {
    if (f.situacao === 'ATIVAS' && !o.ativo) return false;
    if (f.situacao === 'DESATIVADAS' && o.ativo) return false;
    if (f.tiposExcluidos.has(TIPO_OM_LABELS[o.tipo])) return false;
    if (f.setoresExcluidos.has(nomeSetor(e, o.setorId))) return false;
    if (f.comandosExcluidos.has(nomeComando(e, o.comandoId))) return false;
    if (o.tipo === 'NAVIO' && f.classesExcluidas.has(nomeClasse(e, o.classeId))) return false;
    if (f.foraDaIlha === 'SIM' && !o.foraDaIlha) return false;
    if (f.foraDaIlha === 'NAO' && o.foraDaIlha) return false;
    if (q && !norm([o.codigo, o.nome, o.sigla, o.indicativoNaval, ...(o.nomesAlternativos || [])].filter(Boolean).join(' ')).includes(q)) return false;
    return true;
  });
}

export const CAB_OMS = ['Código (UG)', 'Nome', 'Sigla', 'Tipo', 'Setor', 'Comando', 'Classe (navio)', 'Indicativo naval', 'Lotação', 'Área CNIC (m²)', 'CNPJ', 'Endereço', 'E-mails', 'Telefone', 'Fora da Ilha', 'Outros nomes', 'Situação', 'Desativado em', 'Motivo da desativação', 'Observação'];
export function linhasOMs(oms: OM[], e: Estrutura): any[][] {
  return [CAB_OMS, ...[...oms].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(o => [
    o.codigo, o.nome, o.sigla || '', TIPO_OM_LABELS[o.tipo], nomeSetor(e, o.setorId), nomeComando(e, o.comandoId), o.tipo === 'NAVIO' ? nomeClasse(e, o.classeId) : '',
    o.indicativoNaval || '', o.lotacao ?? '', o.areaCnic ?? '', o.cnpj || '', o.endereco || '', o.emails || '', o.telefone || '', sim(o.foraDaIlha),
    (o.nomesAlternativos || []).join('; '), sit(o.ativo), o.desativadoEm || '', o.motivoDesativacao || '', o.observacao || '',
  ])];
}

const filtraSit = <T extends { ativo?: boolean }>(l: T[], s: Situacao) => l.filter(x => s === 'TODAS' || (s === 'ATIVAS') === (x.ativo !== false));

export function linhasComandos(e: Estrutura, s: Situacao): any[][] {
  return [['Código', 'Nome', 'Sigla', 'Setor', 'Indicativo naval', 'Fora da Ilha', 'Situação', 'Desativado em', 'Motivo'],
    ...filtraSit(e.comandos, s).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(c => [c.codigo || '', c.nome, c.sigla || '', nomeSetor(e, c.setorId), c.indicativoNaval || '', sim(c.foraDaIlha), sit(c.ativo), c.desativadoEm || '', c.motivoDesativacao || ''])];
}
export function linhasSetores(e: Estrutura, s: Situacao): any[][] {
  return [['Sigla', 'Nome', 'Ordem', 'Situação'], ...filtraSit(e.setores, s).sort((a, b) => a.ordem - b.ordem).map(x => [x.sigla, x.nome || '', x.ordem, sit(x.ativo)])];
}
export function linhasClasses(e: Estrutura, oms: OM[], s: Situacao): any[][] {
  const navios = (id: string, ativo: boolean) => oms.filter(o => o.tipo === 'NAVIO' && o.classeId === id && o.ativo === ativo).map(o => o.nome).sort().join('; ');
  return [['Classe', 'Situação', 'Desativada em', 'Navios ativos', 'Navios desativados'],
    ...filtraSit(e.classes, s).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(c => [c.nome, sit(c.ativo), c.desativadoEm || '', navios(c.id, true), navios(c.id, false)])];
}
export function linhasServicos(servicos: ServicoCatalogo[], s: Situacao): any[][] {
  return [['Ordem', 'Serviço', 'Sigla', 'Unidade', 'Nome oficial', 'Emitida de acordo com', 'Setor responsável', 'Telefone do setor', 'Prazo de envio', 'Anexo da OI', 'Critério', 'Situação'],
    ...filtraSit(servicos, s).sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || a.name.localeCompare(b.name, 'pt-BR')).map(x => [x.ordem ?? '', x.name, x.acronym, x.unitMeasure, x.nomeOficial || '', x.emitidaDeAcordoCom || '', x.setorResponsavel || '', x.telefoneSetor || '', x.prazoEnvio || '', x.anexoOi || '', x.criterio || '', sit(x.ativo)])];
}
