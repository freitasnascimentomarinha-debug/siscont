import React, { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Button } from '../ui/Button';
import { listarDividaMensal, registrarDividaMensal } from '../../services/congestionamentoService';
import { CriterioDivida, arquivoCongest, dividaTotal, quadroPorODS, rotuloMes, serie13 } from '../../utils/congestionamento';
import { BaixaGer, FaturaGer, fimDoMes, mesDe, somaMeses } from '../../utils/painelGerencial';
import { baixarBytes } from '../../utils/baixarArquivo';
import { notify } from '../../utils/notify';

/** Gera a planilha mensal do gráfico CONGEST (Conselho de Gestão): dívida geral mês a mês e faturamento × dívida por ODS, com gráficos. */
export const PlanilhaCongestionamento: React.FC<{ faturas: FaturaGer[]; idx: Map<string, BaixaGer[]>; hoje: string }> = ({ faturas, idx, hoje }) => {
  // O gráfico é do mês do CONGEST (ex.: novembro) e os dados têm a posição do fim do mês anterior (outubro).
  const [mesCongest, setMesCongest] = useState(mesDe(hoje));
  const mes = somaMeses(mesCongest, -1);
  const [criterio, setCriterio] = useState<CriterioDivida>('vencido');
  const [gerando, setGerando] = useState(false);

  const gerar = async () => {
    setGerando(true);
    try {
      const T = fimDoMes(mes), ano = Number(mes.slice(0, 4));
      const fs = faturas.filter(f => !f.extra); // Marinha (as faturas Extra-MB não entram)
      const atual = dividaTotal(fs, idx, hoje, T, [ano - 1, ano], criterio);
      const guardados = await listarDividaMensal();
      const bytes = await arquivoCongest({
        mes, criterio, mesCongest,
        quadroAnterior: quadroPorODS(fs, idx, hoje, T, ano - 1, criterio), quadroAtual: quadroPorODS(fs, idx, hoje, T, ano, criterio),
        serie: serie13(mes, guardados || new Map(), atual),
      });
      baixarBytes(bytes, `GRAFICO_CONGEST_${rotuloMes(mesCongest).replace('/20', '')}.xlsx`); // ex.: GRAFICO_CONGEST_NOV26.xlsx
      // guarda o fechamento do mês para a série dos próximos meses (só quem pode gravar)
      const gravou = guardados ? await registrarDividaMensal(mes, atual) : false;
      notify.success(gravou ? `Planilha gerada. Dívida de ${rotuloMes(mes)} registrada na série.` : 'Planilha gerada.');
      if (!guardados) notify.info('A série mês a mês fica incompleta até executar o script 026 no banco.');
    } catch (e) { notify.fail('Não foi possível gerar a planilha', e); } finally { setGerando(false); }
  };

  return (
    <section aria-label="Planilha do gráfico CONGEST" className="bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-end gap-3">
      <div className="min-w-[200px]">
        <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-1"><FileSpreadsheet size={15} className="text-emerald-600" />Planilha do gráfico CONGEST (Conselho de Gestão)</h3>
        <p className="text-xs text-slate-500">Dívida geral dos últimos 13 meses e faturamento × dívida por ODS, no modelo da planilha mensal, com os gráficos.</p>
      </div>
      <label className="text-xs text-slate-600">Gráfico do CONGEST de
        <input type="month" value={mesCongest} max={mesDe(hoje)} onChange={e => e.target.value && setMesCongest(e.target.value)} className="block border border-slate-300 rounded px-2 py-1 text-sm" aria-label="Mês do CONGEST" />
      </label>
      <span className="text-xs text-slate-500 pb-1.5">dados na posição de <b>{rotuloMes(mes)}</b> (fim do mês anterior)</span>
      <label className="text-xs text-slate-600">Dívida =
        <select value={criterio} onChange={e => setCriterio(e.target.value as CriterioDivida)} className="block border border-slate-300 rounded px-2 py-1 text-sm" aria-label="Critério da dívida">
          <option value="vencido">só o vencido</option><option value="aberto">todo o em aberto (vencido + a vencer)</option>
        </select>
      </label>
      <Button size="sm" onClick={gerar} isLoading={gerando}>Baixar planilha (.xlsx)</Button>
    </section>
  );
};
