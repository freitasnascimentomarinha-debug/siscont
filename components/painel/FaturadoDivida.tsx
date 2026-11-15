import React, { useEffect, useMemo, useState } from 'react';
import { FaturaPainel } from '../../utils/painel';
import { Dimensao, ROTULO_DIMENSAO, composicaoPorTipo, faturadoXDivida } from '../../utils/painelAgrupar';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compacto = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? `R$ ${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi` : a >= 1e3 ? `R$ ${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : brl(n); };
const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
// mesma paleta do painel: azul = faturado; vermelho = vencido; verde = a vencer; âmbar = em contestação
const COR = { faturado: '#2a78d6', divida: '#d03b3b', aVencer: '#0ca30c', contestado: '#b45309' };

/**
 * "Faturado × dívida": por setor, comando ou OM, quanto foi faturado e quanto ainda está em aberto; ao escolher um item,
 * mostra de que tipos de fatura a dívida é feita (vencida, a vencer, em contestação).
 */
export const FaturadoDividaPanel: React.FC<{ faturas: FaturaPainel[]; hoje: string; ano: number }> = ({ faturas, hoje, ano }) => {
  const [dim, setDim] = useState<Dimensao>('comando');
  const [periodo, setPeriodo] = useState<'ano' | 'todos'>('ano');
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const anoSel = periodo === 'ano' ? ano : null;

  const linhas = useMemo(() => faturadoXDivida(faturas, dim, anoSel, hoje).filter(l => l.faturado > 0 || l.divida > 0 || l.contestado > 0), [faturas, dim, anoSel, hoje]);
  useEffect(() => { setEscolhido(null); setVerTodos(false); }, [dim, periodo, ano]);
  const mostradas = verTodos ? linhas : linhas.slice(0, 10);
  const maximo = Math.max(...mostradas.map(l => l.faturado), 0.01);
  const tipos = useMemo(() => composicaoPorTipo(faturas, hoje, escolhido ? dim : undefined, escolhido ?? undefined, anoSel).filter(t => t.total > 0), [faturas, hoje, dim, escolhido, anoSel]);
  const totalDivida = tipos.reduce((s, t) => s + t.total, 0);
  const maxTipo = Math.max(...tipos.map(t => t.total), 0.01);
  const botao = (ativo: boolean, i: number) => `px-3 py-1.5 text-sm ${ativo ? 'bg-primary-600 text-white' : 'text-slate-700 hover:bg-slate-50'} ${i ? 'border-l border-slate-300' : ''}`;

  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3" data-testid="faturado-divida">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800">Faturado × dívida</h3>
          <p className="text-xs text-slate-500">Quanto cada {ROTULO_DIMENSAO[dim].toLowerCase()} foi faturado e quanto ainda deve (em aberto, sem as contestadas). Clique numa linha para ver de que a dívida é feita.</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <fieldset><legend className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">Agrupar por</legend>
            <div role="radiogroup" aria-label="Faturado × dívida: agrupar por" className="inline-flex rounded-md border border-slate-300 overflow-hidden bg-white">
              {(['setor', 'comando', 'cliente'] as Dimensao[]).map((d, i) => <button key={d} type="button" role="radio" aria-checked={dim === d} onClick={() => setDim(d)} className={botao(dim === d, i)}>{ROTULO_DIMENSAO[d]}</button>)}
            </div></fieldset>
          <fieldset><legend className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">Faturas de</legend>
            <div role="radiogroup" aria-label="Faturado × dívida: período" className="inline-flex rounded-md border border-slate-300 overflow-hidden bg-white">
              <button type="button" role="radio" aria-checked={periodo === 'ano'} onClick={() => setPeriodo('ano')} className={botao(periodo === 'ano', 0)}>{ano}</button>
              <button type="button" role="radio" aria-checked={periodo === 'todos'} onClick={() => setPeriodo('todos')} className={botao(periodo === 'todos', 1)}>Todos os anos</button>
            </div></fieldset>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <div className="flex flex-wrap gap-x-4 text-xs text-slate-600 mb-2">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: COR.faturado }} />Faturado</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: COR.divida }} />Dívida (em aberto)</span>
          </div>
          <ul className="space-y-1" aria-label="Faturado e dívida por grupo">
            {mostradas.map(l => (
              <li key={l.nome}>
                <button type="button" aria-pressed={escolhido === l.nome} onClick={() => setEscolhido(escolhido === l.nome ? null : l.nome)}
                  className={`w-full text-left rounded-lg px-2 py-1.5 border ${escolhido === l.nome ? 'border-primary-400 bg-primary-50' : 'border-transparent hover:bg-slate-50'}`}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium text-slate-800 truncate" title={l.nome}>{l.nome}</span>
                    <span className="text-xs text-slate-500 shrink-0 tabular-nums">{l.divida > 0 ? <><b className="text-red-700">{pct(l.pctDivida)}</b> do faturado em aberto</> : 'sem dívida'}</span>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    <div className="flex items-center gap-2"><div className="flex-1"><div className="h-2.5 rounded-sm" style={{ width: `${Math.max(1, (l.faturado / maximo) * 100)}%`, background: COR.faturado }} /></div><span className="w-24 text-right text-[11px] text-slate-600 tabular-nums whitespace-nowrap">{compacto(l.faturado)}</span></div>
                    <div className="flex items-center gap-2"><div className="flex-1"><div className="h-2.5 rounded-sm" style={{ width: `${l.divida > 0 ? Math.max(1, (l.divida / maximo) * 100) : 0}%`, background: COR.divida }} /></div><span className="w-24 text-right text-[11px] text-slate-600 tabular-nums whitespace-nowrap">{compacto(l.divida)}</span></div>
                  </div>
                </button>
              </li>
            ))}
            {!linhas.length && <li className="text-sm text-slate-500 p-3">Nada faturado neste período com os filtros atuais.</li>}
          </ul>
          {linhas.length > 10 && <button className="text-xs text-primary-700 font-semibold mt-2" onClick={() => setVerTodos(!verTodos)}>{verTodos ? 'Mostrar só os 10 maiores' : `Mostrar todos (${linhas.length})`}</button>}
        </div>

        <div className="lg:col-span-2 rounded-lg border border-slate-200 p-3 bg-slate-50/50" aria-live="polite">
          <h4 className="text-sm font-bold text-slate-800">De que é feita a dívida{escolhido ? <> de <span className="text-primary-700">{escolhido}</span></> : ' (todos os itens ao lado)'}</h4>
          <p className="text-xs text-slate-500 mb-2">Por tipo de fatura · dívida em aberto <b className="tabular-nums">{brl(totalDivida)}</b></p>
          <div className="flex flex-wrap gap-x-3 text-[11px] text-slate-600 mb-2">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COR.divida }} />Vencida</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: COR.aVencer }} />A vencer</span>
          </div>
          <ul className="space-y-2">
            {tipos.map(t => (
              <li key={t.tipo} className="text-sm" data-testid="tipo-divida">
                <div className="flex justify-between gap-2"><span className="font-medium text-slate-800">{t.tipo}</span><span className="tabular-nums text-slate-700"><b>{brl(t.total)}</b> <span className="text-xs text-slate-500">({pct(t.pct)})</span></span></div>
                <div className="flex h-2.5 mt-0.5 rounded-sm overflow-hidden bg-slate-200" style={{ width: `${t.total > 0 ? Math.max(3, (t.total / maxTipo) * 100) : 0}%` }} role="img" aria-label={`${t.tipo}: vencida ${brl(t.vencido)}, a vencer ${brl(t.aVencer)}, fora da dívida, em contestação ${brl(t.contestado)}`}>
                  {t.vencido > 0 && <div style={{ width: `${(t.vencido / t.total) * 100}%`, background: COR.divida }} />}
                  {t.aVencer > 0 && <div style={{ width: `${(t.aVencer / t.total) * 100}%`, background: COR.aVencer }} />}
                </div>
                <p className="text-[11px] text-slate-500 tabular-nums">{t.qtd} fatura(s){t.vencido > 0 ? ` · vencida ${compacto(t.vencido)}` : ''}{t.aVencer > 0 ? ` · a vencer ${compacto(t.aVencer)}` : ''}{t.contestado > 0 ? ` · em contestação (fora da dívida) ${compacto(t.contestado)}` : ''}</p>
              </li>
            ))}
            {!tipos.length && <li className="text-sm text-slate-500">Sem dívida neste recorte.</li>}
          </ul>
        </div>
      </div>
    </section>
  );
};
