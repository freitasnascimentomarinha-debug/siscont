import React from 'react';
import { BarraGrupos } from '../gastos/BarraGrupos';
import { useGastosBNIC } from '../gastos/useGastos';
import { Secao, Vazio, brl, mesBR } from './comum';

/** Ir para outra página do sistema (o menu escuta este evento). */
export const irParaPagina = (pagina: string) => window.dispatchEvent(new CustomEvent('siscont:ir', { detail: pagina }));

/** Resumo dos gastos da BNIC no Painel do Encarregado: mesmos números da página Gastos da BNIC. */
export const ResumoGastos: React.FC<{ ano: number; periodo: { de: string; ate: string } }> = ({ ano, periodo }) => {
  const { taxa, gastos, utilidades, carregando, erro } = useGastosBNIC(ano, periodo);
  const t = gastos.totais;
  const consumo = utilidades.reduce((s, u) => s + u.valor, 0);
  const rotulo = periodo.de === periodo.ate ? mesBR(periodo.de) : `${mesBR(periodo.de)} a ${mesBR(periodo.ate)}`;
  return (
    <Secao titulo="Gastos da BNIC" id="painel-gastos" subtitulo={`Previsto em ${ano} e empenhado em ${rotulo}.`}
      acoes={<button type="button" className="text-xs font-semibold text-primary-700 hover:underline" onClick={() => irParaPagina('gastos')} aria-label="Ver detalhes dos gastos da BNIC">Ver detalhes →</button>}>
      {erro ? <p className="text-sm text-red-700">{erro}</p> : carregando && !taxa ? <Vazio>Carregando…</Vazio> : gastos.grupos.length === 0 ? <Vazio>O exercício {ano} ainda não tem rubricas cadastradas.</Vazio> : (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><dt className="text-slate-500">Previsto</dt><dd className="text-base font-bold tabular-nums text-slate-900">{brl(t.previsto)}</dd></div>
            <div><dt className="text-slate-500">Empenhado</dt><dd className="text-base font-bold tabular-nums text-orange-700">{brl(t.empenhado)}</dd><dd className="text-slate-400">{t.execucao === null ? '' : `${t.execucao.toLocaleString('pt-BR')}% do previsto em rubricas`}</dd></div>
            <div><dt className="text-slate-500">Consumo medido da base</dt><dd className="text-base font-bold tabular-nums text-slate-900">{brl(consumo)}</dd></div>
            <div><dt className="text-slate-500">Parte da BNIC no rateio</dt><dd className="text-base font-bold tabular-nums text-slate-900">{taxa?.quota ? brl(taxa.quota.anual) : '—'}</dd>{taxa?.quota && <dd className="text-slate-400">{brl(taxa.quota.mensal)}/mês</dd>}</div>
          </dl>
          <BarraGrupos grupos={gastos.grupos} />
          {t.qtdEmpenhos === 0 && <p className="text-[11px] text-slate-500">Nenhum empenho lançado no período: o empenhado aparece zerado.</p>}
        </div>
      )}
    </Secao>
  );
};
