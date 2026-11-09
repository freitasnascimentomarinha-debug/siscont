import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Modal } from '../ui/Modal';
import { ContestacaoGer, resumoContestacoes } from '../../utils/painelGerencial';
import { COR, Kpi, Secao, Selo, br, brl, mesBR, qtdBR } from './comum';
import { CtxPainel } from './tipos';

const COR_TEMPO = ['#86b6ef', '#3b82f6', '#f59e0b', '#dc2626', '#7f1d1d'];
const STATUS: Record<string, string> = { ABERTA: 'Aberta', ENCAMINHADA: 'Encaminhada ao setor', RESPONDIDA: 'Respondida', ENCERRADA: 'Encerrada' };

const Detalhe: React.FC<{ x: ContestacaoGer; onClose: () => void }> = ({ x, onClose }) => (
  <Modal isOpen onClose={onClose} title={`Contestação — ${x.c.numeroFatura}`} maxWidth="max-w-3xl">
    <div className="space-y-3 text-sm">
      <p className="text-xs text-slate-500">Somente consulta. O andamento é registrado na página Contestações.</p>
      <dl className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <div><dt className="text-slate-500">OM</dt><dd className="font-semibold">{x.cliente}</dd></div>
        <div><dt className="text-slate-500">Valor</dt><dd className="font-semibold tabular-nums">{brl(x.valor)}</dd></div>
        <div><dt className="text-slate-500">Situação</dt><dd className="font-semibold">{STATUS[x.c.status] || x.c.status}</dd></div>
        <div><dt className="text-slate-500">Aberta em</dt><dd className="font-semibold">{br(x.c.abertaEm)} ({x.diasAberta} dias)</dd></div>
        <div><dt className="text-slate-500">Última movimentação</dt><dd className="font-semibold">{br(x.ultimoMov)}{x.aberta ? ` (há ${x.diasParada} dias)` : ''}</dd></div>
        <div><dt className="text-slate-500">Setor medidor / prazo</dt><dd className="font-semibold">{x.c.setorMedidor || '—'}{x.c.prazo ? ` · até ${br(x.c.prazo)}` : ''}{x.prazoVencido ? ' (vencido)' : ''}</dd></div>
      </dl>
      <div><h4 className="text-xs font-bold text-slate-600">Justificativa da OM</h4><p className="text-xs text-slate-700 whitespace-pre-wrap">{x.c.justificativa}</p></div>
      {x.c.resposta && <div><h4 className="text-xs font-bold text-slate-600">Resposta do setor ({br(x.c.respondidaEm)})</h4><p className="text-xs text-slate-700 whitespace-pre-wrap">{x.c.resposta}</p></div>}
      {x.c.decisao && <p className="text-xs"><b>Decisão:</b> {x.c.decisao.toLowerCase()} em {br(x.c.decididaEm)}{x.c.novaFatura ? ` · nova fatura ${x.c.novaFatura}` : ''}</p>}
      {x.aberta && <p className="text-xs"><b>Próximo passo:</b> {x.proximoPasso}</p>}
      <div><h4 className="text-xs font-bold text-slate-600">Histórico</h4>
        <ul className="text-xs divide-y divide-slate-100 border border-slate-200 rounded-lg">{x.c.historico.map((h, i) => <li key={i} className="px-2 py-1.5"><b>{br(h.em)}</b> · {h.acao.toLowerCase()} · <span className="text-slate-500">{h.por}</span>{h.texto && <div className="text-slate-600">{h.texto}</div>}</li>)}
          {!x.c.historico.length && <li className="px-2 py-2 text-slate-400">Sem eventos registrados.</li>}</ul></div>
    </div>
  </Modal>
);

export const ContestacoesTab: React.FC<{ ctx: CtxPainel }> = ({ ctx }) => {
  const { contest, periodo, criterios: c, hoje } = ctx;
  const r = useMemo(() => resumoContestacoes(contest, periodo, c), [contest, periodo, c]);
  const [faixa, setFaixa] = useState<string | null>(null);
  const [ver, setVer] = useState<ContestacaoGer | null>(null);
  const rotulo = periodo.de === periodo.ate ? mesBR(periodo.de) : `${mesBR(periodo.de)} a ${mesBR(periodo.ate)}`;
  const lista = faixa ? r.porFaixa.find(f => f.faixa === faixa)!.itens : r.maisAntigas;
  const pontos = useMemo(() => {
    const comPonto = ctx.fs.filter(f => f.pontos > 0 && !f.cancelada);
    return { qtd: comPonto.length, valor: comPonto.reduce((s, f) => s + f.saldo, 0), faturas: comPonto };
  }, [ctx.fs]);
  const totalParado = ctx.parados.reduce((s, p) => s + p.valor, 0);
  const totalAdiant = ctx.adiantamentos.reduce((s, a) => s + a.saldo, 0);

  const Linha: React.FC<{ x: ContestacaoGer }> = ({ x }) => (
    <tr className="hover:bg-primary-50/40 cursor-pointer" onClick={() => setVer(x)}>
      <td className="px-2 py-1.5 font-mono whitespace-nowrap">{x.c.numeroFatura}</td>
      <td className="px-2 max-w-[220px] truncate" title={x.cliente}>{x.cliente}</td>
      <td className="px-2 text-right tabular-nums" title={x.valor ? undefined : 'fatura já quitada ou sem saldo'}>{x.valor ? brl(x.valor) : '—'}</td>
      <td className="px-2 hidden md:table-cell">{STATUS[x.c.status] || x.c.status}</td>
      <td className="px-2 text-center hidden md:table-cell">{br(x.c.abertaEm)}</td>
      <td className="px-2 text-right">{x.diasAberta} d</td>
      <td className={`px-2 text-right ${x.diasParada > c.diasContestParada ? 'text-orange-700 font-semibold' : ''}`}>{x.aberta ? `${x.diasParada} d` : '—'}</td>
      <td className="px-2">{x.prazoVencido ? <Selo prioridade="critico">prazo vencido</Selo> : x.aberta && x.diasAberta > c.diasContestLonga ? <Selo prioridade="critico">longa</Selo> : x.aberta && x.diasParada > c.diasContestParada ? <Selo prioridade="atencao">parada</Selo> : ''}</td>
    </tr>
  );
  const Cab = () => <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Fatura</th><th className="px-2 text-left">OM</th><th className="px-2 text-right">Valor</th><th className="px-2 text-left hidden md:table-cell">Situação</th><th className="px-2 hidden md:table-cell">Aberta em</th><th className="px-2 text-right">Tramitação</th><th className="px-2 text-right">Sem mov.</th><th className="px-2 text-left">Alerta</th></tr></thead>;

  return (
    <div className="space-y-5">
      <section aria-label="Indicadores das contestações" className="grid gap-3 grid-cols-2 lg:grid-cols-6">
        <Kpi rotulo="Abertas" cor="#d97706" valor={qtdBR(r.abertas.length)} detalhe="em tramitação" />
        <Kpi rotulo="Valor contestado" cor="#d97706" valor={brl(r.valor)} detalhe="saldo das faturas" dica="Valor das faturas das contestações abertas." />
        <Kpi rotulo="Tempo médio de resolução" cor="#475569" valor={r.tempoMedio === null ? '—' : `${r.tempoMedio.toLocaleString('pt-BR')} dias`} detalhe={`${qtdBR(r.resolvidas.length)} resolvida(s) em ${rotulo}`} dica="Da abertura à decisão, nas contestações encerradas dentro do período." />
        <Kpi rotulo="Sem movimentação" cor="#d97706" alerta={r.semMovimento.length > 0} valor={qtdBR(r.semMovimento.length)} detalhe={`há mais de ${c.diasContestParada} dias`} />
        <Kpi rotulo="Tramitação longa" cor="#dc2626" alerta={r.longa.length > 0} valor={qtdBR(r.longa.length)} detalhe={`mais de ${c.diasContestLonga} dias`} />
        <Kpi rotulo="Prazo vencido" cor="#dc2626" alerta={r.prazoVencido.length > 0} valor={qtdBR(r.prazoVencido.length)} detalhe="resposta do setor" />
      </section>

      <div className="grid xl:grid-cols-2 gap-4">
        <Secao titulo="Tempo de tramitação" subtitulo="Contestações abertas por tempo desde a abertura. Clique numa barra para listar.">
          <div className="h-56" role="img" aria-label="Gráfico das contestações por tempo de tramitação">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.porFaixa} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) setFaixa(r.porFaixa[Number(i)].faixa); }}>
                <CartesianGrid vertical={false} stroke={COR.grade} />
                <XAxis dataKey="faixa" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} interval={0} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={28} />
                <Tooltip formatter={(v: any, _n: any, p: any) => [`${v} contestação(ões) · ${brl(p?.payload?.valor ?? 0)}`, 'Abertas']} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="qtd" name="Contestações" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={48}>{r.porFaixa.map((f, i) => <Cell key={f.faixa} fill={COR_TEMPO[i]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">{r.porFaixa.map((f, i) => <button key={f.faixa} type="button" onClick={() => setFaixa(faixa === f.faixa ? null : f.faixa)} aria-pressed={faixa === f.faixa}
            className={`rounded-md border px-2 py-1 ${faixa === f.faixa ? 'ring-2 ring-primary-500' : 'border-slate-200'}`} style={{ borderLeft: `4px solid ${COR_TEMPO[i]}` }}>{f.faixa}: <b>{f.qtd}</b>{f.qtd ? ` · ${brl(f.valor)}` : ''}</button>)}</div>
        </Secao>

        <Secao titulo="Outras pendências que exigem acompanhamento" subtitulo="Reúne o que está parado fora das contestações.">
          <ul className="divide-y divide-slate-100 text-sm">
            <li className="py-2 flex items-center gap-3"><div className="flex-1"><b>ALTCRED/GRU com saldo parado</b><div className="text-xs text-slate-500">mais de {c.diasSaldoParado} dias sem movimento: dinheiro recebido ainda não atribuído a faturas</div></div><div className="text-right tabular-nums"><b>{qtdBR(ctx.parados.length)}</b><div className="text-xs">{brl(totalParado)}</div></div></li>
            <li className="py-2 flex items-center gap-3"><div className="flex-1"><b>Adiantamentos com saldo disponível</b><div className="text-xs text-slate-500">crédito recebido ainda não usado em faturas</div></div><div className="text-right tabular-nums"><b>{qtdBR(new Set(ctx.adiantamentos.map(a => a.cliente)).size)}</b><div className="text-xs">{brl(totalAdiant)}</div></div></li>
            <li className="py-2 flex items-center gap-3"><div className="flex-1"><b>Faturas com ponto de atenção</b><div className="text-xs text-slate-500">inconsistências apontadas pelo sistema (página Pontos de Atenção)</div></div><div className="text-right tabular-nums"><b>{qtdBR(pontos.qtd)}</b><div className="text-xs">{brl(pontos.valor)}</div></div></li>
            <li className="py-2 flex items-center gap-3"><div className="flex-1"><b>Contestações com prazo do setor vencido</b><div className="text-xs text-slate-500">resposta do setor medidor atrasada</div></div><div className="text-right tabular-nums"><b>{qtdBR(r.prazoVencido.length)}</b></div></li>
          </ul>
          {pontos.qtd > 0 && <button type="button" className="mt-2 text-xs font-semibold text-primary-700" onClick={() => ctx.abrirLista('Faturas com ponto de atenção', pontos.faturas)}>Ver as faturas com ponto de atenção →</button>}
        </Secao>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <h3 className="px-4 py-2 font-bold text-slate-800 border-b border-slate-200 flex flex-wrap items-center gap-2">{faixa ? `Contestações abertas — ${faixa}` : 'Contestações abertas mais antigas'}
          {faixa && <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => setFaixa(null)}>mostrar as mais antigas</button>}</h3>
        <div className="overflow-x-auto"><table className="min-w-full text-xs" aria-label="Contestações abertas"><Cab /><tbody className="divide-y divide-slate-100">
          {lista.map(x => <Linha key={x.c.id} x={x} />)}
          {!lista.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Nenhuma contestação aberta.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <h3 className="px-4 py-2 font-bold text-slate-800 border-b border-slate-200">Resolvidas no período ({rotulo}) <span className="text-slate-400 font-normal text-sm">· {r.resolvidas.length}</span></h3>
        <div className="overflow-x-auto"><table className="min-w-full text-xs" aria-label="Contestações resolvidas"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Fatura</th><th className="px-2 text-left">OM</th><th className="px-2 text-right">Valor</th><th className="px-2 text-left">Decisão</th><th className="px-2">Decidida em</th><th className="px-2 text-right">Dias</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {r.resolvidas.slice(0, 50).map(x => <tr key={x.c.id} className="hover:bg-primary-50/40 cursor-pointer" onClick={() => setVer(x)}><td className="px-2 py-1.5 font-mono">{x.c.numeroFatura}</td><td className="px-2 max-w-[240px] truncate">{x.cliente}</td><td className="px-2 text-right tabular-nums">{brl(x.valor)}</td><td className="px-2">{x.c.decisao?.toLowerCase() || '—'}</td><td className="px-2 text-center">{br(x.c.decididaEm)}</td><td className="px-2 text-right">{x.diasResolucao ?? '—'}</td></tr>)}
            {!r.resolvidas.length && <tr><td colSpan={6} className="px-3 py-5 text-center text-slate-400">Nenhuma contestação resolvida no período.</td></tr>}
          </tbody></table></div>
      </section>
      <p className="text-[11px] text-slate-500">Data de referência: {br(hoje)}. Tramitação = dias desde a abertura (até a decisão, nas encerradas). "Sem movimentação" = dias desde o último evento do histórico.</p>
      {ver && <Detalhe x={ver} onClose={() => setVer(null)} />}
    </div>
  );
};

