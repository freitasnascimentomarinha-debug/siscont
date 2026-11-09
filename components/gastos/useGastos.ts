import { useEffect, useMemo, useState } from 'react';
import { listarMedicoes } from '../../services/faturamentoService';
import { cadastroService } from '../../services/cadastroService';
import { listarSaidas } from '../../services/relatoriosService';
import { taxaParaGastos } from '../../services/taxaCondominialService';
import { MedicaoGasto, RubricaGasto, SaidaGasto, mesesDe, montarGastos, utilidadesDaBase } from '../../utils/gastosBNIC';

type Taxa = Awaited<ReturnType<typeof taxaParaGastos>>;

/** Carrega e calcula os gastos da BNIC de um exercício e período (somente leitura). Usado pela página e pelo resumo do painel. */
export function useGastosBNIC(ano: number, periodo: { de: string; ate: string }, versao = 0) {
  const [taxa, setTaxa] = useState<Taxa | null>(null);
  const [saidas, setSaidas] = useState<SaidaGasto[]>([]);
  const [medicoes, setMedicoes] = useState<MedicaoGasto[]>([]);
  const [servicos, setServicos] = useState<{ sigla: string; nome: string; unidade?: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErro('');
    Promise.all([taxaParaGastos(ano), listarSaidas().catch(() => []), cadastroService.listServicos().catch(() => [])]).then(([t, ss, sv]) => {
      if (!vivo) return;
      setTaxa(t);
      setSaidas(ss.filter(s => !s.isCanceled && !s.anuladaEm).map(s => ({ id: s.id, date: s.date, value: s.value, client: s.client, documentNumber: s.documentNumber, rubricaNumero: s.rubricaNumero ?? null, categoria: s.categoria ?? null })));
      setServicos(sv.map((x: any) => ({ sigla: x.acronym, nome: x.name, unidade: x.unitMeasure })));
    }).catch(e => { if (vivo) setErro(e?.message || 'Não foi possível carregar os gastos.'); }).finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [ano, versao]);

  const de = periodo.de, ate = periodo.ate;
  useEffect(() => {
    let vivo = true;
    listarMedicoes(mesesDe(de, ate)).then(ms => { if (vivo) setMedicoes(ms.map(m => ({ competencia: m.competencia, sigla: m.sigla, omId: m.omId, quantidade: m.quantidade ?? null, valor: m.valor ?? null }))); }).catch(() => { if (vivo) setMedicoes([]); });
    return () => { vivo = false; };
  }, [de, ate, versao]);

  const rubricas = useMemo<RubricaGasto[]>(() => (taxa?.rubricas || []).map(r => ({ numero: r.numero, descricao: r.descricao, tipo: r.tipo, vigente: r.vigente })), [taxa]);
  const gastos = useMemo(() => montarGastos(rubricas, saidas, periodo), [rubricas, saidas, periodo]);
  const utilidades = useMemo(() => utilidadesDaBase(medicoes, taxa?.emissora.omId ?? null, periodo, servicos), [medicoes, taxa, periodo, servicos]);
  return { taxa, gastos, utilidades, servicos, saidasNoAno: saidas.length, carregando, erro };
}
