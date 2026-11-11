import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { omsNaMatriz } from '../../services/taxaCondominialService';
import { ContextoFaturamento, listarAtracacoes, listarLotes, listarMedicoes, listarPrecos } from '../../services/faturamentoService';
import { partes, referencia } from '../../utils/faturamento';
import { listarLivroCreditos } from '../../services/creditosOmService';
import { resumoCreditosOm } from '../../utils/creditosOm';
import { AbaFaturamento, ItemResumo, pendencias, resumoDoMes } from '../../utils/resumoFaturamento';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Campo, entrada } from './comum';

const ICONE = {
  ok: <CheckCircle2 size={18} className="text-emerald-600" aria-label="ok" />,
  pendente: <XCircle size={18} className="text-red-600" aria-label="pendente" />,
  aviso: <AlertTriangle size={18} className="text-amber-600" aria-label="atenção" />,
  info: <Circle size={18} className="text-slate-400" aria-label="informação" />,
};
const ROTULO_ABA: Record<AbaFaturamento, string> = { resumo: 'Resumo', precos: 'Preços do ano', medicoes: 'Medições do mês', atracacao: 'Atracação', lote: 'Lote de faturas', creditos: 'Créditos da OM', encerramento: 'Encerramento do exercício', correcao: 'Correção' };

/** Antes de calcular o lote: o que já foi lançado para a competência e o que falta, com atalho para cada aba. */
export const ResumoMesTab: React.FC<{ ctx: ContextoFaturamento; comp: string; setComp: (c: string) => void; ativa: boolean; irPara: (a: AbaFaturamento) => void }> = ({ ctx, comp, setComp, ativa, irPara }) => {
  const [itens, setItens] = useState<ItemResumo[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const nomes = useMemo(() => new Map(ctx.omsFat.map(o => [o.id, o.nome])), [ctx.omsFat]);

  const carregar = async () => {
    setCarregando(true);
    try {
      const [med, atr, precos, lotes] = await Promise.all([listarMedicoes([comp]), listarAtracacoes([comp]), listarPrecos([partes(comp).ano]), listarLotes().catch(() => [])]);
      const { ano, mes } = partes(comp);
      // créditos que as OM têm no livro de créditos (script 033; sem ele o saldo é zero)
      const creditos = resumoCreditosOm((await listarLivroCreditos().catch(() => ({ movs: [] }))).movs);
      // a taxa condominial só é emitida para OM cadastrada na matriz do ano (menos a emissora, que não recebe fatura)
      const daMatriz = (await omsNaMatriz(ano).catch(() => [] as string[])).filter(id => id !== ctx.emissora?.omId);
      setItens(resumoDoMes({
        comp, servicos: ctx.servicos.map(s => ({ sigla: s.sigla, nome: s.nome })),
        omsTC: daMatriz.length ? daMatriz : ctx.omsFat.filter(o => o.ativo && o.tipo !== 'EXTRA_MB').map(o => o.id),
        omsTCDaMatriz: daMatriz.length > 0,
        medicoes: med.map(m => ({ sigla: m.sigla, omId: m.omId })),
        atracacoesRealizadas: atr.filter(a => !a.previsao && (a.diasAtracado ?? 0) > 0).map(a => ({ omId: a.omId })),
        precos: precos.map(p => ({ sigla: p.sigla, omId: p.omId })), nomeOM: id => nomes.get(id) || 'OM',
        responsavel: sigla => ctx.servicos.find(x => x.sigla === sigla)?.responsavel ?? null,
        lotes: lotes.map(l => ({ competencia: l.competencia, tipo: l.tipo, qtd: l.qtd })),
        faturasDaCompetencia: ctx.invoices.filter(i => !i.isCanceled && i.yearCompetence === ano && i.monthCompetence === mes).length,
        creditos: { saldo: creditos.saldo, abertos: creditos.abertos },
      }));
    } catch (e) { notify.fail('Erro ao montar o resumo do mês', e); } finally { setCarregando(false); }
  };
  useEffect(() => { if (ativa) carregar(); }, [comp, ativa, ctx]);

  const pend = itens ? pendencias(itens) : 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Competência do resumo"><input className={entrada} type="month" value={comp} onChange={e => e.target.value && setComp(e.target.value)} aria-label="Competência do resumo" /></Campo>
        <Button variant="secondary" size="sm" onClick={carregar} isLoading={carregando}>Atualizar resumo</Button>
        <p className="text-xs text-slate-500 flex-1 min-w-[260px]">A competência vale para todas as abas. O que está pendente aparece aqui antes de calcular a prévia do lote.</p>
      </div>
      {itens && (
        <div className={`p-3 rounded-lg border text-sm ${pend ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          {pend ? <><b>{pend} pendência(s)</b> para {referencia(comp)}: o lote pode sair incompleto. Resolva abaixo ou siga mesmo assim.</> : <>Nada pendente para <b>{referencia(comp)}</b>: pode calcular a prévia do lote.</>}
        </div>
      )}
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
        {(itens || []).map(i => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            {ICONE[i.status]}
            <div className="flex-1 min-w-0"><div className="font-medium text-slate-800">{i.rotulo}</div><div className="text-xs text-slate-500">{i.detalhe}</div></div>
            {i.aba && <button type="button" className="text-primary-700 underline text-xs whitespace-nowrap" onClick={() => irPara(i.aba!)}>{i.status === 'ok' || i.status === 'info' ? 'abrir' : 'resolver'}: {ROTULO_ABA[i.aba]} →</button>}
          </li>
        ))}
        {!itens && <li className="px-3 py-6 text-center text-slate-400 text-sm">{carregando ? 'Carregando...' : 'Sem dados.'}</li>}
      </ul>
      <div className="flex justify-end"><Button onClick={() => irPara('lote')}>Ir para o lote de faturas →</Button></div>
    </div>
  );
};
