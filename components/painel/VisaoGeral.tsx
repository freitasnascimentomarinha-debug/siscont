import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2 } from 'lucide-react';
import { emAberto, vencida } from '../../utils/painel';
import {
  Alerta, Granularidade, agruparFR, faixaDaFatura, faturadoRecebido, indicadores, mesDe, recuperacaoMensal, serieInadimplencia,
} from '../../utils/painelGerencial';
import { COR, COR_FAIXA, COR_PRIO, Grupo, Kpi, Secao, Selo, Vazio, br, brl, compacto, mesBR, qtdBR } from './comum';
import { CtxPainel } from './tipos';

const TIT_FAIXA: Record<string, string> = { 'A vencer': 'A vencer' };

const Alertas: React.FC<{ ctx: CtxPainel }> = ({ ctx }) => {
  const [todos, setTodos] = useState(false);
  const { alertas: al, criterios: c } = ctx;
  const cont = (p: Alerta['prioridade']) => al.filter(a => a.prioridade === p).length;
  const visiveis = todos ? al : al.slice(0, 3);
  const abrir = (a: Alerta) => {
    if (a.destino === 'contestacoes') ctx.irPara('contestacoes');
    else if (a.destino === 'parados') document.getElementById('painel-parados')?.scrollIntoView({ behavior: 'smooth' });
    else if (a.faturas) ctx.abrirLista(a.tipo, a.faturas);
  };
  return (
    <Secao titulo="Pontos que exigem atenção" id="painel-alertas"
      subtitulo={`Identificados automaticamente. Critérios: atenção > ${c.diasAtencao} dias, crítico > ${c.diasCritico} dias de atraso (a administração altera em Cadastros › Parâmetros).`}
      acoes={al.length > 0 && <div className="flex gap-1.5 flex-wrap text-xs"><Selo prioridade="critico">{cont('critico')} crítico(s)</Selo><Selo prioridade="atencao">{cont('atencao')} atenção</Selo><Selo prioridade="info">{cont('info')} informativo(s)</Selo></div>}>
      {al.length === 0 ? (
        <div className={`flex items-center gap-2 p-3 rounded-lg border ${COR_PRIO.regular.fundo} ${COR_PRIO.regular.borda} ${COR_PRIO.regular.texto}`}><CheckCircle2 size={18} /><Selo prioridade="regular" /> Nenhum ponto exige atenção com os critérios atuais.</div>
      ) : (
        <div className="space-y-2">
          {visiveis.map(a => (
            <div key={a.id} className={`rounded-lg border p-2.5 ${COR_PRIO[a.prioridade].fundo} ${COR_PRIO[a.prioridade].borda}`}>
              <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                <Selo prioridade={a.prioridade} />
                <div className="flex-1 min-w-[200px]"><div className="font-semibold text-slate-800 text-sm">{a.tipo}</div><div className="text-xs text-slate-600">{a.om} · {a.detalhe}</div></div>
                <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-700">
                  {a.valor !== null && <div><dt className="inline text-slate-500">Valor </dt><dd className="inline font-bold tabular-nums">{brl(a.valor)}</dd></div>}
                  <div><dt className="inline text-slate-500">Registros </dt><dd className="inline font-bold">{qtdBR(a.qtd)}</dd></div>
                  {a.dias !== null && <div><dt className="inline text-slate-500">Tempo </dt><dd className="inline font-bold">{qtdBR(a.dias)} dias</dd></div>}
                  <div><dt className="inline text-slate-500">Últ. movimentação </dt><dd className="inline font-bold">{br(a.ultimaMov)}</dd></div>
                </dl>
                <button type="button" className="text-xs font-semibold text-primary-700 hover:underline" onClick={() => abrir(a)} aria-label={`Ver detalhes: ${a.tipo}`}>Ver detalhes →</button>
              </div>
            </div>
          ))}
          {al.length > 3 && <button type="button" className="text-xs font-semibold text-primary-700" onClick={() => setTodos(!todos)}>{todos ? 'Mostrar só os 3 principais' : `Ver todos os ${al.length} pontos`}</button>}
        </div>
      )}
    </Secao>
  );
};

export const VisaoGeral: React.FC<{ ctx: CtxPainel }> = ({ ctx }) => {
  const { fs, bs, idx, hoje, periodo, criterios: c } = ctx;
  const [gran, setGran] = useState<Granularidade>('mensal');
  const ind = useMemo(() => indicadores(fs, bs, idx, periodo, hoje, c, ctx.recebimentos), [fs, bs, idx, periodo, hoje, c, ctx.recebimentos]);
  const abertas = useMemo(() => fs.filter(emAberto), [fs]);
  const vencidas = useMemo(() => fs.filter(f => vencida(f, hoje)), [fs, hoje]);
  const contestadas = useMemo(() => fs.filter(f => f.contestada && !f.cancelada && f.saldo > 0.009), [fs]);
  const rotuloPeriodo = periodo.de === periodo.ate ? mesBR(periodo.de) : `${mesBR(periodo.de)} a ${mesBR(periodo.ate)}`;

  const fr = useMemo(() => agruparFR(faturadoRecebido(fs, ctx.recebimentos, periodo.de, periodo.ate), gran).map(p => ({ ...p, nome: gran === 'mensal' ? mesBR(p.mes) : p.mes })), [fs, ctx.recebimentos, periodo, gran]);
  const mesAtual = mesDe(hoje);
  const ateSerie = periodo.ate > mesAtual ? mesAtual : periodo.ate;
  const serie = useMemo(() => serieInadimplencia(fs, idx, hoje, ateSerie, 12).map(p => ({ ...p, nome: mesBR(p.mes) })), [fs, idx, hoje, ateSerie]);
  const rec = useMemo(() => recuperacaoMensal(fs, bs, idx, periodo.de, ateSerie, hoje).map(p => ({ ...p, nome: mesBR(p.mes), pct: p.pct ?? 0 })), [fs, bs, idx, periodo.de, ateSerie, hoje]);
  const idade = ind.cobranca.faixas;
  const ctn = useMemo(() => {
    const ab = ctx.contest.filter(x => x.aberta);
    return { abertas: ab.length, valor: ab.reduce((s, x) => s + x.valor, 0), parada: ab.filter(x => x.diasParada > c.diasContestParada), prazo: ab.filter(x => x.prazoVencido) };
  }, [ctx.contest, c]);
  const totalParado = ctx.parados.reduce((s, p) => s + p.valor, 0);
  const totalAdiant = ctx.adiantamentos.reduce((s, a) => s + a.saldo, 0);
  const adiantPorCliente = useMemo(() => Object.entries(ctx.adiantamentos.reduce<Record<string, number>>((m, a) => ({ ...m, [a.cliente]: (m[a.cliente] || 0) + a.saldo }), {})).sort((a, b) => b[1] - a[1]), [ctx.adiantamentos]);
  const [todosParados, setTodosParados] = useState(false);
  const [todosAdiant, setTodosAdiant] = useState(false);
  const abrirFaixa = (nome: string) => ctx.abrirLista(`Em aberto: ${nome}`, abertas.filter(f => faixaDaFatura(f, hoje) === nome));

  return (
    <div className="space-y-5">
      <Alertas ctx={ctx} />

      <Grupo titulo={`Faturamento · ${rotuloPeriodo}`} cols="grid-cols-2 lg:grid-cols-3">
        <Kpi rotulo="Total faturado" destaque cor={COR.faturado} valor={brl(ind.faturamento.faturado.valor)} detalhe={`${qtdBR(ind.faturamento.faturado.qtd)} fatura(s) emitida(s)`} dica="Faturas não canceladas com competência no período."
          onClick={() => ctx.abrirLista(`Faturado ${rotuloPeriodo}`, fs.filter(f => !f.cancelada && `${f.ano}-${String(f.mes).padStart(2, '0')}` >= periodo.de && `${f.ano}-${String(f.mes).padStart(2, '0')}` <= periodo.ate))} />
        <Kpi rotulo={`Em aberto em ${br(hoje)}`} destaque cor="#475569" valor={brl(ind.faturamento.emAberto.valor)} detalhe={`${qtdBR(ind.faturamento.emAberto.qtd)} fatura(s)`} dica="Saldo a pagar das faturas não canceladas e não contestadas (posição de hoje)." onClick={() => ctx.abrirLista('Faturas em aberto', abertas)} />
        <Kpi rotulo="Canceladas" cor="#94a3b8" valor={brl(ind.faturamento.canceladas.valor)} detalhe={`${qtdBR(ind.faturamento.canceladas.qtd)} fatura(s) no período`} dica="Faturas canceladas com competência no período."
          onClick={ind.faturamento.canceladas.qtd ? () => ctx.abrirLista(`Canceladas ${rotuloPeriodo}`, fs.filter(f => f.cancelada && `${f.ano}-${String(f.mes).padStart(2, '0')}` >= periodo.de && `${f.ano}-${String(f.mes).padStart(2, '0')}` <= periodo.ate)) : undefined} />
      </Grupo>

      <section aria-label="Cobrança e inadimplência">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Cobrança e inadimplência · posição em {br(hoje)}</h3>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <Kpi rotulo="Total vencido" destaque cor={COR.vencido} alerta={ind.cobranca.vencido.qtd > 0} valor={brl(ind.cobranca.vencido.valor)} detalhe={`${qtdBR(ind.cobranca.vencido.qtd)} fatura(s) vencida(s)`} dica="Em aberto com vencimento anterior a hoje (contestadas ficam fora)." onClick={() => ctx.abrirLista('Faturas vencidas', vencidas)} />
          <Kpi rotulo="Inadimplência" destaque cor={COR.vencido} valor={ind.cobranca.pctInadimplencia === null ? '—' : `${ind.cobranca.pctInadimplencia.toLocaleString('pt-BR')}%`} detalhe="vencido ÷ em aberto" dica="Saldo vencido dividido pelo saldo total em aberto." />
          <Kpi rotulo="OM inadimplentes" cor={COR.vencido} valor={qtdBR(ind.cobranca.omInadimplentes)} detalhe="com fatura vencida" dica="Quantidade de OM com pelo menos uma fatura vencida em aberto." onClick={() => ctx.irPara('oms')} />
          <Kpi rotulo="Prazo médio de atraso" cor={COR.vencido} valor={`${qtdBR(ind.cobranca.prazoMedio)} dias`} detalhe="ponderado pelo saldo" dica="Média dos dias de atraso das faturas vencidas, ponderada pelo valor de cada uma." />
        </div>
        <div className="mt-3 grid gap-2 grid-cols-2 md:grid-cols-3 xl:grid-cols-6" role="list" aria-label="Valor por faixa de atraso">
          {idade.map(x => {
            const grave = x.faixa === 'Mais de 365 dias' ? 'ring-2 ring-red-700' : x.faixa === '181–365 dias' || x.faixa === '91–180 dias' ? 'ring-1 ring-orange-400' : '';
            return (
              <button key={x.faixa} type="button" role="listitem" onClick={() => abrirFaixa(x.faixa)} disabled={!x.qtd} aria-label={`${TIT_FAIXA[x.faixa] || x.faixa}: ${brl(x.valor)}, ${x.qtd} fatura(s)`}
                className={`text-left bg-white rounded-lg border border-slate-200 p-2 ${grave} ${x.qtd ? 'hover:shadow-md cursor-pointer' : 'opacity-60 cursor-default'}`} style={{ borderLeft: `5px solid ${COR_FAIXA[x.faixa]}` }}>
                <div className="text-[11px] font-semibold text-slate-500">{x.faixa === 'A vencer' ? 'A vencer' : `Vencido ${x.faixa}`}</div>
                <div className={`font-bold tabular-nums text-sm ${x.faixa === 'Mais de 365 dias' ? 'text-red-900' : ''}`}>{brl(x.valor)}</div>
                <div className="text-[11px] text-slate-500">{qtdBR(x.qtd)} fatura(s)</div>
              </button>
            );
          })}
        </div>
      </section>

      <Grupo titulo={`Recebimentos · ${rotuloPeriodo}`} cols="grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Total recebido" destaque cor={COR.recebido} valor={brl(ind.recebimentos.recebido.valor)} detalhe={`${qtdBR(ind.recebimentos.recebido.qtd)} ALTCRED/GRU recebido(s)`} dica="Dinheiro que entrou no período, pela data do ALTCRED/GRU: inclui pagamentos de faturas de meses anteriores, adiantamentos e saldos ainda não atribuídos a faturas." />
        <Kpi rotulo="Faturado já quitado" cor={COR.recebido} valor={ind.recebimentos.pctDoFaturado === null ? '—' : `${ind.recebimentos.pctDoFaturado.toLocaleString('pt-BR')}%`} detalhe="das faturas do período" dica="Quanto do valor faturado no período já foi pago ou abatido por adiantamento até hoje (o Painel inicial mostra só o pago em dinheiro, por isso o número dele é menor)." />
        <Kpi rotulo="Vencido recuperado" cor={COR.recebido} valor={brl(ind.recebimentos.recuperacao.recuperado)} detalhe={ind.recebimentos.recuperacao.pct === null ? 'sem dívida vencida no início' : `${ind.recebimentos.recuperacao.pct.toLocaleString('pt-BR')}% de ${compacto(ind.recebimentos.recuperacao.elegivel)} vencidos no início`} dica="Baixas do período (pagamento ou adiantamento) em faturas que já estavam vencidas no começo do período, em relação ao saldo vencido naquele dia." />
        <Kpi rotulo="Adiantamentos disponíveis" cor="#0d9488" valor={brl(totalAdiant)} detalhe={`${qtdBR(adiantPorCliente.length)} cliente(s) com saldo`} dica="Crédito recebido ainda não usado em faturas."
          onClick={adiantPorCliente.length ? () => document.getElementById('painel-adiantamentos')?.scrollIntoView({ behavior: 'smooth' }) : undefined} />
      </Grupo>

      <Grupo titulo="Contestações e pendências" cols="grid-cols-2 lg:grid-cols-5">
        <Kpi rotulo="Contestações abertas" cor="#d97706" valor={qtdBR(ctn.abertas)} detalhe={ctn.abertas ? 'em tramitação' : undefined} onClick={() => ctx.irPara('contestacoes')} dica="Contestações ainda não encerradas." />
        <Kpi rotulo="Valor contestado" cor="#d97706" valor={brl(ind.contestadas.valor)} detalhe={`${qtdBR(ind.contestadas.qtd)} fatura(s)`} dica="Saldo das faturas em contestação (não conta como em aberto)." onClick={contestadas.length ? () => ctx.abrirLista('Faturas em contestação', contestadas) : undefined} />
        <Kpi rotulo="Sem movimentação" cor="#d97706" alerta={ctn.parada.length > 0} valor={qtdBR(ctn.parada.length)} detalhe={`há mais de ${c.diasContestParada} dias`} onClick={() => ctx.irPara('contestacoes')} dica="Contestações abertas sem nenhum andamento registrado além do limite." />
        <Kpi rotulo="Saldos parados" cor="#7c3aed" valor={`${qtdBR(ctx.parados.length)} · ${compacto(totalParado)}`} detalhe={`ALTCRED/GRU sem movimento > ${c.diasSaldoParado} dias`} dica="Dinheiro recebido que ainda não foi atribuído a faturas."
          onClick={ctx.parados.length ? () => document.getElementById('painel-parados')?.scrollIntoView({ behavior: 'smooth' }) : undefined} />
        <Kpi rotulo="Prazo ultrapassado" cor="#dc2626" alerta={ctn.prazo.length > 0} valor={qtdBR(ctn.prazo.length)} detalhe="resposta do setor vencida" onClick={() => ctx.irPara('contestacoes')} dica="Contestações encaminhadas ao setor medidor cujo prazo de resposta já passou." />
      </Grupo>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Secao titulo="Faturamento × recebimentos" subtitulo="Faturado pela competência; recebido pela data do ALTCRED/GRU (inclui dívidas de meses anteriores e adiantamentos)."
          acoes={<div role="group" aria-label="Agrupamento" className="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs">
            {(['mensal', 'trimestral', 'anual'] as Granularidade[]).map(g => <button key={g} type="button" aria-pressed={gran === g} onClick={() => setGran(g)} className={`px-2.5 py-1 capitalize ${gran === g ? 'bg-primary-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50'} ${g !== 'mensal' ? 'border-l border-slate-300' : ''}`}>{g}</button>)}
          </div>}>
          <div className="h-64" role="img" aria-label="Gráfico de faturado e recebido por período">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={fr} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COR.grade} />
                <XAxis dataKey="nome" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v: any, n: any) => [brl(Number(v)), n]} cursor={{ fill: '#f1f5f9' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="faturado" name="Faturado" fill={COR.faturado} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar dataKey="recebido" name="Recebido" fill={COR.recebido} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Line dataKey="diferenca" name="Diferença (faturado − recebido)" stroke="#475569" strokeWidth={2} dot={{ r: 2 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Secao>

        <Secao titulo="Evolução da inadimplência" subtitulo="Saldo vencido (e em aberto) ao fim de cada mês, nos últimos 12 meses." dica="O passado é reconstruído pelas datas das baixas. Faturas canceladas ou contestadas hoje não entram em nenhum mês.">
          <div className="h-64" role="img" aria-label="Gráfico da evolução do saldo vencido">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serie} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={COR.grade} />
                <XAxis dataKey="nome" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v: any, n: any) => [brl(Number(v)), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey="emAberto" name="Em aberto" stroke="#94a3b8" strokeWidth={2} dot={false} />
                <Line dataKey="vencido" name="Vencido" stroke={COR.vencido} strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Secao>

        <Secao titulo="Idade da dívida" subtitulo="Valor em aberto por tempo de atraso. Clique numa barra para ver as faturas.">
          <div className="h-64" role="img" aria-label="Gráfico da idade da dívida">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={idade} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null && idade[Number(i)]?.qtd) abrirFaixa(idade[Number(i)].faixa); }}>
                <CartesianGrid vertical={false} stroke={COR.grade} />
                <XAxis dataKey="faixa" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v: any, _n: any, p: any) => [`${brl(Number(v))} (${p?.payload?.qtd ?? 0} fatura(s))`, 'Em aberto']} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" name="Em aberto" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={52}>{idade.map(x => <Cell key={x.faixa} fill={COR_FAIXA[x.faixa]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Secao>

        <Secao titulo="Recuperação de crédito" subtitulo="Por mês: quanto do que já estava vencido no começo do mês foi recebido." dica="Percentual = baixas do mês em faturas já vencidas na véspera ÷ saldo vencido naquele dia.">
          {rec.length === 0 ? <Vazio>Sem meses no período.</Vazio> : (
            <div className="h-64" role="img" aria-label="Gráfico da recuperação de crédito por mês">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rec} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={COR.grade} />
                  <XAxis dataKey="nome" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="v" tickFormatter={compacto} tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={52} />
                  <YAxis yAxisId="p" orientation="right" unit="%" tick={{ fontSize: 10, fill: COR.eixo }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip formatter={(v: any, n: any) => [n === '% recuperado' ? `${v}%` : brl(Number(v)), n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="v" dataKey="recuperado" name="Recuperado" fill={COR.recebido} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  <Line yAxisId="p" dataKey="pct" name="% recuperado" stroke="#0f766e" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </Secao>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Secao id="painel-parados" titulo={`ALTCRED/GRU com saldo parado (mais de ${c.diasSaldoParado} dias)`} subtitulo="Dinheiro recebido ainda não atribuído a faturas.">
          <table className="min-w-full text-xs"><tbody className="divide-y divide-slate-100">
            {(todosParados ? ctx.parados : ctx.parados.slice(0, 10)).map(p => <tr key={p.id}><td className="px-2 py-1.5 font-mono">{p.numero}</td><td className="px-2 truncate max-w-[180px]" title={p.cliente}>{p.cliente}</td><td className="px-2 text-right tabular-nums font-semibold">{brl(p.valor)}</td><td className="px-2 text-slate-500">{p.dias} dias</td></tr>)}
            {!ctx.parados.length && <tr><td className="px-2 py-4 text-center text-slate-400">Nenhum.</td></tr>}
          </tbody></table>
          {ctx.parados.length > 10 && <button type="button" className="mt-2 text-xs font-semibold text-primary-700" onClick={() => setTodosParados(!todosParados)}>{todosParados ? 'Mostrar só os 10 maiores' : `Ver todos os ${ctx.parados.length}`}</button>}
        </Secao>
        <Secao id="painel-adiantamentos" titulo="Adiantamentos disponíveis por cliente" subtitulo="Crédito recebido ainda não usado em faturas.">
          <table className="min-w-full text-xs"><tbody className="divide-y divide-slate-100">
            {(todosAdiant ? adiantPorCliente : adiantPorCliente.slice(0, 10)).map(([cl, v]) => <tr key={cl}><td className="px-2 py-1.5 truncate max-w-[260px]" title={cl}>{cl}</td><td className="px-2 text-right tabular-nums font-semibold text-emerald-700">{brl(v)}</td></tr>)}
            {!adiantPorCliente.length && <tr><td className="px-2 py-4 text-center text-slate-400">Nenhum.</td></tr>}
          </tbody></table>
          {adiantPorCliente.length > 10 && <button type="button" className="mt-2 text-xs font-semibold text-primary-700" onClick={() => setTodosAdiant(!todosAdiant)}>{todosAdiant ? 'Mostrar só os 10 maiores' : `Ver todos os ${adiantPorCliente.length}`}</button>}
        </Secao>
      </div>

      <details className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
        <summary className="cursor-pointer font-bold text-slate-800">Como cada indicador é calculado</summary>
        <ul className="mt-3 space-y-1.5 text-xs list-disc pl-5">
          <li><b>Posição em {br(hoje)}</b> (em aberto, vencido, faixas, contestado): mesma regra do Painel inicial. Em aberto = saldo a pagar das faturas não canceladas e <b>não contestadas</b>; vencido = em aberto com vencimento anterior a hoje. Faturas em contestação aparecem à parte.</li>
          <li><b>Faturado</b>: faturas não canceladas com competência no período. <b>Canceladas</b>: competência no período.</li>
          <li><b>Recebido</b>: valor dos ALTCRED/GRU pela <b>data do documento</b> (data efetiva do recebimento). Inclui o que paga faturas de meses anteriores, os adiantamentos e os saldos ainda não atribuídos a faturas; é o dinheiro que entrou, não o que foi baixado.</li>
          <li><b>Faturado já quitado</b>: (valor − saldo) das faturas do período ÷ valor faturado no período, contando pagamento e abatimento por adiantamento. O Painel inicial mostra só o pago em dinheiro.</li>
          <li><b>Inadimplência</b> = vencido ÷ em aberto. <b>Prazo médio de atraso</b> = média dos dias de atraso ponderada pelo saldo vencido.</li>
          <li><b>Vencido recuperado</b>: baixas do período (pagamento ou adiantamento) em faturas que já estavam vencidas na véspera do período ÷ saldo vencido naquele dia.</li>
          <li><b>Evolução</b> e <b>variação em 30 dias</b>: o saldo no passado é reconstruído pelas datas das baixas; faturas canceladas ou contestadas hoje não entram (o sistema não guarda quando isso ocorreu).</li>
          <li><b>Valores não se somam entre categorias</b>: cada fatura está em uma só (em aberto, contestada, quitada ou cancelada).</li>
          <li>Data de referência dos cálculos: <b>{br(hoje)}</b>. Pagamentos com data futura não entram na posição de hoje.</li>
        </ul>
      </details>
    </div>
  );
};
