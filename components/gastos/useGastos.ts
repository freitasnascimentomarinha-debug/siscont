import { useEffect, useMemo, useState } from 'react';
import { listarMedicoes } from '../../services/faturamentoService';
import { cadastroService } from '../../services/cadastroService';
import { carregarBase, listarSaidas, tcRecebidaNoPeriodo } from '../../services/relatoriosService';
import { taxaParaGastos } from '../../services/taxaCondominialService';
import { MedicaoGasto, OpcoesGastos, RubricaGasto, SaidaGasto, SubgrupoId, mesesDe, montarGastos, utilidadesDaBase } from '../../utils/gastosBNIC';

type Taxa = Awaited<ReturnType<typeof taxaParaGastos>>;
export const PARAM_GRUPOS = 'gastos_grupos_rubricas';
export const PARAM_UNIAO = 'gastos_fornecedores_unidos';
const lerJson = (taxa: Taxa | null, chave: string): Record<string, any> => {
  try { const v = taxa?.parametros.find(p => p.chave === chave)?.valor; const o = v ? JSON.parse(v) : {}; return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
};

/** Carrega e calcula os gastos da BNIC de um exercício e período (somente leitura). Usado pela página e pelo resumo do painel. */
export function useGastosBNIC(ano: number, periodo: { de: string; ate: string }, versao = 0) {
  const [taxa, setTaxa] = useState<Taxa | null>(null);
  const [saidas, setSaidas] = useState<SaidaGasto[]>([]);
  const [medicoes, setMedicoes] = useState<MedicaoGasto[]>([]);
  const [servicos, setServicos] = useState<{ sigla: string; nome: string; unidade?: string }[]>([]);
  const [base, setBase] = useState<Awaited<ReturnType<typeof carregarBase>> | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErro('');
    Promise.all([taxaParaGastos(ano), listarSaidas().catch(() => []), cadastroService.listServicos().catch(() => []), carregarBase().catch(() => null)]).then(([t, ss, sv, b]) => {
      if (!vivo) return;
      setTaxa(t); setBase(b);
      setSaidas(ss.filter(s => !s.isCanceled && !s.anuladaEm).map(s => ({ id: s.id, date: s.date, value: s.value, client: s.client, documentNumber: s.documentNumber, rubricaNumero: s.rubricaNumero ?? null, categoria: s.categoria ?? null })));
      setServicos(sv.map((x: any) => ({ sigla: x.acronym, nome: x.name, unidade: x.unitMeasure })));
    }).catch(e => { if (vivo) setErro(e?.message || 'Não foi possível carregar os gastos.'); }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [ano, versao]);

  const de = periodo.de, ate = periodo.ate;
  useEffect(() => {
    let vivo = true;
    listarMedicoes(mesesDe(de, ate)).then(ms => { if (vivo) setMedicoes(ms.map(m => ({ competencia: m.competencia, sigla: m.sigla, omId: m.omId, quantidade: m.quantidade ?? null, valor: m.valor ?? null, estimada: !!m.estimada, origem: m.origem ?? null }))); }).catch(() => { if (vivo) setMedicoes([]); });
    return () => { vivo = false; };
  }, [de, ate, versao]);

  const rubricas = useMemo<RubricaGasto[]>(() => (taxa?.rubricas || []).map(r => ({ numero: r.numero, descricao: r.descricao, tipo: r.tipo, vigente: r.vigente, omLiquido: r.omLiquido })), [taxa]);
  const opcoes = useMemo<OpcoesGastos & { grupos: Record<string, SubgrupoId>; uniao: Record<string, string> }>(() => ({
    grupos: lerJson(taxa, PARAM_GRUPOS) as Record<string, SubgrupoId>, uniao: lerJson(taxa, PARAM_UNIAO) as Record<string, string>,
    tcRecebida: base ? tcRecebidaNoPeriodo(base, de, ate) : 0,
  }), [taxa, base, de, ate]);
  const gastos = useMemo(() => montarGastos(rubricas, saidas, periodo, opcoes), [rubricas, saidas, periodo, opcoes]);
  const utilidades = useMemo(() => utilidadesDaBase(medicoes, taxa?.emissora.omId ?? null, periodo, servicos), [medicoes, taxa, periodo, servicos]);
  const salvarParametro = async (chave: string, valor: Record<string, unknown>, descricao: string) => { await cadastroService.saveParametro({ chave, valor: JSON.stringify(valor), descricao } as any); };
  return { taxa, gastos, utilidades, servicos, saidas, medicoes, rubricas, opcoes, tcRecebida: opcoes.tcRecebida || 0, saidasNoAno: saidas.length, salvarParametro, carregando, erro };
}
