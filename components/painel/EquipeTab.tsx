import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import { atividadeUsuarios } from '../../services/painelService';
import { AtividadeUsuario, LinhaAtividade, agregarAtividade, fimDoMes, inicioDoMes, mesDe } from '../../utils/painelGerencial';
import { Secao, Vazio, br, brl, mesBR, qtdBR } from './comum';
import { CtxPainel } from './tipos';

const SERIES: { k: keyof AtividadeUsuario; nome: string; cor: string }[] = [
  { k: 'faturasEmitidas', nome: 'Faturas emitidas', cor: '#2a78d6' }, { k: 'baixas', nome: 'Baixas lançadas', cor: '#eb6834' }, { k: 'documentos', nome: 'ALTCRED/GRU registrados', cor: '#0d9488' },
  { k: 'contestacoes', nome: 'Contestações (ações)', cor: '#d97706' }, { k: 'faturasAlteradas', nome: 'Faturas alteradas', cor: '#94a3b8' },
];
const dataHora = (iso?: string | null) => (iso ? `${br(iso)} ${iso.slice(11, 16)}` : '—');

export const EquipeTab: React.FC<{ ctx: CtxPainel }> = ({ ctx }) => {
  const { periodo, hoje } = ctx;
  const de = inicioDoMes(periodo.de), ate = fimDoMes(periodo.ate) < hoje ? fimDoMes(periodo.ate) : hoje;
  const [linhas, setLinhas] = useState<LinhaAtividade[] | null | undefined>(undefined); // undefined = carregando; null = script 025 pendente
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    setLinhas(undefined); setErro('');
    atividadeUsuarios(de, ate).then(l => { if (vivo) setLinhas(l); }).catch(e => { if (vivo) { setErro(e?.message || 'Não foi possível consultar a atividade.'); setLinhas([]); } });
    return () => { vivo = false; };
  }, [de, ate]);
  const ativ = useMemo(() => agregarAtividade(linhas || []), [linhas]);
  const nomeados = ativ.filter(a => !a.semUsuario);
  const semUsuario = ativ.find(a => a.semUsuario);

  // cobranças registradas no período, por quem registrou
  const cobr = useMemo(() => {
    const m = new Map<string, { quem: string; qtd: number; faturas: number; valor: number }>();
    ctx.cobrancas.filter(c => mesDe(c.enviadaEm) >= periodo.de && mesDe(c.enviadaEm) <= periodo.ate).forEach(c => {
      const k = c.enviadaPor || 'não informado'; const x = m.get(k) || { quem: k, qtd: 0, faturas: 0, valor: 0 };
      x.qtd++; x.faturas += c.faturas.length; x.valor += c.valor; m.set(k, x);
    });
    return [...m.values()].sort((a, b) => a.quem.localeCompare(b.quem, 'pt-BR'));
  }, [ctx.cobrancas, periodo]);

  // contestações: ações registradas no histórico por usuário
  const contest = useMemo(() => {
    const m = new Map<string, { quem: string; acoes: number; ids: Set<string>; decisoes: number }>();
    ctx.contest.forEach(x => x.c.historico.forEach(h => {
      if (mesDe(h.em) < periodo.de || mesDe(h.em) > periodo.ate) return;
      const k = h.por || 'não informado'; const a = m.get(k) || { quem: k, acoes: 0, ids: new Set<string>(), decisoes: 0 };
      a.acoes++; a.ids.add(x.c.id); if (['RATIFICADA', 'RETIFICADA', 'CANCELADA'].includes(h.acao)) a.decisoes++; m.set(k, a);
    }));
    return [...m.values()].sort((a, b) => a.quem.localeCompare(b.quem, 'pt-BR'));
  }, [ctx.contest, periodo]);

  const rotulo = periodo.de === periodo.ate ? mesBR(periodo.de) : `${mesBR(periodo.de)} a ${mesBR(periodo.ate)}`;
  return (
    <div className="space-y-5">
      <div className="flex gap-3 p-3 rounded-xl border border-blue-200 bg-blue-50 text-sm text-blue-900" role="note">
        <Info size={18} className="shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p><b>Esta aba mostra atividade registrada no sistema, não avaliação de desempenho.</b> Quantidade de registros não mede qualidade, complexidade nem resultado — por isso não há ranking: a ordem é alfabética.</p>
          <p className="text-xs">Para medir <b>demandas por responsável, prazos cumpridos, tempo de tratamento e % de conclusão no prazo</b>, o sistema precisaria guardar: (1) responsável por OM ou fatura, (2) as providências a fazer, com prazo e data de conclusão, e (3) a cobrança vinculada a cada fatura com o resultado. Esses registros ainda não existem; nenhum número inventado é mostrado no lugar.</p>
        </div>
      </div>

      <Secao titulo="Atividade registrada por usuário" subtitulo={`Registros gravados entre ${br(de)} e ${br(ate)} (trilha de auditoria).`}
        dica="Conta inclusões e alterações de faturas, baixas, ALTCRED/GRU, contestações, lotes e saídas, feitas por cada usuário logado.">
        {linhas === undefined ? <Vazio>Carregando…</Vazio> : linhas === null ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">Falta executar o script <code>supabase/migrations/025_painel_encarregado.sql</code> no Supabase para ler a atividade por usuário.</p>
        ) : (
          <>
            {erro && <p className="text-sm text-red-700 mb-2">{erro}</p>}
            {nomeados.length === 0 ? (
              <Vazio>{ativ.length ? `Nenhuma atividade de usuário identificado no período. Há ${qtdBR(semUsuario?.total ?? 0)} registro(s) sem usuário (importações e scripts), mostrados abaixo.` : 'Nenhum registro de atividade no período.'}</Vazio>
            ) : (
              <div className="h-60 mb-3" role="img" aria-label="Gráfico da atividade por usuário">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={nomeados.map(a => ({ ...a, nome: a.usuario.split('@')[0] }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e2e8f0" /><XAxis dataKey="nome" tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={36} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                    {SERIES.map(s => <Bar key={s.k} dataKey={s.k} name={s.nome} stackId="a" fill={s.cor} maxBarSize={56} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            {ativ.length > 0 && <div className="overflow-x-auto"><table className="min-w-full text-xs" aria-label="Atividade por usuário">
              <thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Usuário</th><th className="px-2 text-right">Faturas emitidas</th><th className="px-2 text-right hidden md:table-cell">Faturas alteradas</th><th className="px-2 text-right">Baixas</th><th className="px-2 text-right hidden md:table-cell">ALTCRED/GRU</th><th className="px-2 text-right hidden md:table-cell">Contestações</th><th className="px-2 text-right hidden lg:table-cell">Lotes</th><th className="px-2 text-right hidden lg:table-cell">Saídas</th><th className="px-2 text-right">Total</th><th className="px-2 text-left hidden md:table-cell">Última atividade</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ativ.map(a => (
                  <tr key={a.usuario} className={a.semUsuario ? 'bg-slate-50 text-slate-500' : ''}>
                    <td className="px-2 py-1.5 font-medium">{a.usuario}{a.semUsuario && <div className="text-[10px] font-normal">não atribuído a pessoa: importação de planilhas e correções em lote</div>}</td>
                    <td className="px-2 text-right tabular-nums">{qtdBR(a.faturasEmitidas)}</td><td className="px-2 text-right tabular-nums hidden md:table-cell">{qtdBR(a.faturasAlteradas)}</td>
                    <td className="px-2 text-right tabular-nums">{qtdBR(a.baixas)}</td><td className="px-2 text-right tabular-nums hidden md:table-cell">{qtdBR(a.documentos)}</td>
                    <td className="px-2 text-right tabular-nums hidden md:table-cell">{qtdBR(a.contestacoes)}</td><td className="px-2 text-right tabular-nums hidden lg:table-cell">{qtdBR(a.lotes)}</td><td className="px-2 text-right tabular-nums hidden lg:table-cell">{qtdBR(a.saidas)}</td>
                    <td className="px-2 text-right tabular-nums font-bold">{qtdBR(a.total)}</td><td className="px-2 hidden md:table-cell whitespace-nowrap">{dataHora(a.ultima)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>}
          </>
        )}
      </Secao>

      <div className="grid xl:grid-cols-2 gap-4">
        <Secao titulo="Cobranças registradas" subtitulo={`Mensagens marcadas como enviadas em ${rotulo}, por quem registrou.`}>
          {cobr.length === 0 ? <Vazio>{ctx.cobrancas.length === 0 ? 'Nenhuma cobrança foi registrada no sistema ainda. Em Cobrança › Mensagens, use "Enviada — registrar" ao enviar cada mensagem: assim o painel passa a mostrar o histórico e os alertas de "sem cobrança".' : 'Nenhuma cobrança registrada no período.'}</Vazio> : (
            <table className="min-w-full text-xs" aria-label="Cobranças registradas"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Registrado por</th><th className="px-2 text-right">Cobranças</th><th className="px-2 text-right">Faturas</th><th className="px-2 text-right">Valor cobrado</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{cobr.map(c => <tr key={c.quem}><td className="px-2 py-1.5">{c.quem}</td><td className="px-2 text-right">{c.qtd}</td><td className="px-2 text-right">{c.faturas}</td><td className="px-2 text-right tabular-nums">{brl(c.valor)}</td></tr>)}</tbody></table>
          )}
        </Secao>
        <Secao titulo="Contestações: andamento registrado" subtitulo={`Ações no histórico das contestações em ${rotulo}, por usuário.`}>
          {contest.length === 0 ? <Vazio>Nenhuma ação registrada nas contestações no período.</Vazio> : (
            <table className="min-w-full text-xs" aria-label="Ações em contestações"><thead className="bg-slate-50 text-slate-500 uppercase"><tr><th className="px-2 py-2 text-left">Usuário</th><th className="px-2 text-right">Ações</th><th className="px-2 text-right">Contestações</th><th className="px-2 text-right">Decisões</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{contest.map(c => <tr key={c.quem}><td className="px-2 py-1.5">{c.quem}</td><td className="px-2 text-right">{c.acoes}</td><td className="px-2 text-right">{c.ids.size}</td><td className="px-2 text-right">{c.decisoes}</td></tr>)}</tbody></table>
          )}
        </Secao>
      </div>
    </div>
  );
};
