import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '../ui/Button';
import { Aviso, entrada } from '../faturamento/comum';
import { AnaliseOM, Causa, NOME_CAUSA } from '../../utils/analiseVariacao';
import { baixarRelatorio } from '../../utils/pdfRelatorio';
import { relatorioVariacoes, sinalV, brlV, totaisVariacao } from '../../utils/relatorioVariacao';
import { hojeISO, dataBR } from '../../utils/datas';

const CAUSAS = Object.keys(NOME_CAUSA) as Causa[];
type Filtro = 'TODAS' | 'AUMENTO' | 'REDUCAO' | 'NOVAS' | 'IGUAIS';
const cor = (n: number) => (n > 0.005 ? 'text-red-700' : n < -0.005 ? 'text-emerald-700' : 'text-slate-400');

export function exportarExcelVariacoes(analise: AnaliseOM[], ano: number) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['OM', 'SITUAÇÃO', `LOTAÇÃO ${ano - 1}`, `LOTAÇÃO ${ano}`, `ANUAL ${ano - 1}`, `ANUAL ${ano}`, 'VARIAÇÃO (R$)', 'VARIAÇÃO (%)', 'JUSTIFICATIVA'],
    ...analise.map(o => [o.nome, o.situacao === 'NOVA' ? 'Nova na taxa' : o.situacao === 'SAIU' ? 'Saiu da taxa' : 'Mantida', o.lotacaoAnterior ?? '', o.lotacaoAtual ?? '', o.anualAnterior, o.anualAtual, o.diferenca, o.percentual ?? '', o.resumo]),
  ]), 'Resumo por OM');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['OM', 'RUBRICA', 'DESCRIÇÃO', `${ano - 1} (R$)`, `${ano} (R$)`, 'VARIAÇÃO (R$)', 'CAUSA', 'EFEITO (R$)', 'DETALHE'],
    ...analise.flatMap(o => o.rubricas.flatMap(l => l.efeitos.map((e, i) => [o.nome, l.numero, l.descricao, i ? '' : l.anterior, i ? '' : l.atual, i ? '' : l.diferenca, NOME_CAUSA[e.causa], e.valor, e.detalhe]))),
  ]), 'Detalhe por rubrica');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['OM', 'VARIAÇÃO TOTAL (R$)', ...CAUSAS.map(c => NOME_CAUSA[c])],
    ...analise.map(o => [o.nome, o.diferenca, ...CAUSAS.map(c => o.porCausa[c] ?? 0)]),
  ]), 'Causas por OM');
  XLSX.writeFile(wb, `justificativa_variacoes_taxa_${ano}.xlsx`);
}
export const baixarPdfVariacoes = (analise: AnaliseOM[], ano: number) => baixarRelatorio(relatorioVariacoes(analise, ano, dataBR(hojeISO())));

/**
 * Justificativa das variações (dentro do Resultado da taxa): por que a taxa de cada OM mudou em relação ao ano anterior.
 * Resumo geral, causas que mais pesam, e um cartão por OM com a explicação em palavras e, abrindo, rubrica por rubrica.
 */
export const PainelVariacoes: React.FC<{ ano: number; analise: AnaliseOM[]; temAnterior: boolean; carregando: boolean; erro: string; destaque?: string }> = ({ ano, analise, temAnterior, carregando, erro, destaque }) => {
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('TODAS');
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const t = useMemo(() => totaisVariacao(analise), [analise]);
  // OM clicada na tabela do resultado: abre e rola até o cartão dela
  useEffect(() => {
    if (!destaque || !analise.some(o => o.omId === destaque)) return;
    setFiltro('TODAS'); setBusca(''); setAbertas(s => new Set(s).add(destaque));
    setTimeout(() => refs.current[destaque]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }), 50);
  }, [destaque]);
  const lista = useMemo(() => analise.filter(o => {
    if (busca.trim() && !o.nome.toLowerCase().includes(busca.trim().toLowerCase())) return false;
    switch (filtro) {
      case 'AUMENTO': return o.situacao === 'MANTIDA' && o.diferenca > 0.005;
      case 'REDUCAO': return o.situacao === 'MANTIDA' && o.diferenca < -0.005;
      case 'NOVAS': return o.situacao !== 'MANTIDA';
      case 'IGUAIS': return o.situacao === 'MANTIDA' && Math.abs(o.diferenca) <= 0.005;
      default: return o.situacao !== 'MANTIDA' || Math.abs(o.diferenca) >= 0.005 || !!busca.trim();
    }
  }), [analise, busca, filtro]);
  const alterna = (id: string) => setAbertas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const maxCausa = Math.max(1, ...t.causas.map(c => Math.abs(c.valor)));

  return (
    <section className="space-y-3 border-t border-slate-200 pt-4" data-testid="painel-variacoes" aria-label="Justificativa das variações">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold text-slate-800">Por que a taxa de cada OM mudou em relação a {ano - 1}</h3>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" disabled={!analise.length} onClick={() => exportarExcelVariacoes(analise, ano)}><Download size={14} className="mr-1" />Excel</Button>
        <Button size="sm" variant="secondary" disabled={!analise.length} onClick={() => baixarPdfVariacoes(analise, ano)}><FileText size={14} className="mr-1" />PDF das justificativas</Button>
      </div>
      {erro && <Aviso tom="red">{erro}</Aviso>}
      {carregando && !erro && <p className="text-sm text-slate-500">Calculando as variações…</p>}
      {!carregando && !erro && !temAnterior && <Aviso tom="amber">Não há proposta de {ano - 1} (rubricas e lotação) cadastrada para comparar. Importe ou cadastre o exercício anterior para ver as justificativas.</Aviso>}
      {!carregando && !erro && temAnterior && (<>
        <p className="text-xs text-slate-500">Cada diferença é explicada em R$ por causas que se somam e fecham com a variação da OM: valor da rubrica, lotação da própria OM, outras OM que entram ou saem da divisão, participação da OM nas rubricas e descontos.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500">Total {ano - 1} → {ano}</div><div className="font-bold text-slate-800 text-sm">{brlV(t.anterior)} → {brlV(t.atual)}</div></div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500">Variação total</div><div className={`font-bold ${cor(t.diferenca)}`}>{sinalV(t.diferenca)}{t.percentual !== null ? ` (${t.percentual > 0 ? '+' : ''}${t.percentual.toLocaleString('pt-BR')}%)` : ''}</div></div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500">OM com aumento · redução · igual</div><div className="font-bold text-slate-800"><span className="text-red-700">{t.aumentaram}</span> · <span className="text-emerald-700">{t.diminuiram}</span> · {t.iguais}</div></div>
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500">OM novas · fora da taxa</div><div className="font-bold text-slate-800">{t.novas} · {t.saíram}</div></div>
        </div>
        {t.causas.length > 0 && (
          <div className="border border-slate-200 rounded-lg p-3">
            <div className="text-xs font-semibold text-slate-600 mb-2">O que mais explica as variações (soma de todas as OM)</div>
            <div className="space-y-1.5">
              {t.causas.map(c => (
                <div key={c.causa} className="flex items-center gap-2 text-xs">
                  <div className="w-56 shrink-0 text-slate-700">{c.nome} <span className="text-slate-400">({c.oms} OM)</span></div>
                  <div className="flex-1 h-3 bg-slate-100 rounded relative overflow-hidden"><div className={`h-3 ${c.valor > 0 ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${Math.max(2, (Math.abs(c.valor) / maxCausa) * 100)}%` }} /></div>
                  <div className={`w-32 text-right tabular-nums font-semibold ${cor(c.valor)}`}>{sinalV(c.valor)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input className={`${entrada} w-52`} placeholder="Buscar OM…" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar OM nas justificativas" />
          {([['TODAS', 'Com variação'], ['AUMENTO', 'Aumentaram'], ['REDUCAO', 'Diminuíram'], ['NOVAS', 'Novas / fora'], ['IGUAIS', 'Sem variação']] as [Filtro, string][]).map(([id, rot]) => (
            <button key={id} onClick={() => setFiltro(id)} className={`px-2.5 py-1 rounded-full border ${filtro === id ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>{rot}</button>
          ))}
          <span className="text-slate-500">{lista.length} OM</span>
        </div>
        <div className="space-y-2">
          {lista.map(o => {
            const aberta = abertas.has(o.omId);
            const chips = (Object.entries(o.porCausa) as [Causa, number][]).filter(([, v]) => Math.abs(v) >= 0.5).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
            return (
              <div key={o.omId} ref={el => { refs.current[o.omId] = el; }} className={`border rounded-lg ${destaque === o.omId ? 'border-primary-400 ring-1 ring-primary-200' : 'border-slate-200'}`}>
                <button className="w-full text-left p-3 flex gap-3 items-start hover:bg-slate-50 rounded-lg" onClick={() => alterna(o.omId)} aria-expanded={aberta} aria-label={`Justificativa de ${o.nome}`}>
                  <span className="mt-1 text-slate-400">{aberta ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
                  <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <b className="text-sm text-slate-800">{o.nome}</b>
                      {o.situacao !== 'MANTIDA' && <span className="px-1.5 rounded bg-sky-100 text-sky-800 text-[11px]">{o.situacao === 'NOVA' ? 'nova na taxa' : 'fora da taxa'}</span>}
                      <span className="text-xs text-slate-500">lotação {o.lotacaoAnterior ?? '—'} → {o.lotacaoAtual ?? '—'}</span>
                    </span>
                    <span className="block text-xs text-slate-500 mt-0.5">{o.situacao === 'NOVA' ? 'sem dados do ano anterior' : brlV(o.anualAnterior)} → <b className="text-slate-700">{brlV(o.anualAtual)}</b> por ano</span>
                    <span className="block text-xs text-slate-700 mt-1.5 leading-relaxed">{o.resumo}</span>
                    {chips.length > 0 && <span className="flex flex-wrap gap-1.5 mt-1.5">{chips.map(([c, v]) => <span key={c} className={`px-2 py-0.5 rounded-full text-[11px] border ${v > 0 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>{NOME_CAUSA[c]} {sinalV(v)}</span>)}</span>}
                  </span>
                  <span className="text-right shrink-0"><span className={`block font-bold tabular-nums ${cor(o.diferenca)}`}>{o.situacao === 'NOVA' ? '' : sinalV(o.diferenca)}</span>{o.percentual !== null && Math.abs(o.diferenca) >= 0.005 && <span className={`block text-xs ${cor(o.diferenca)}`}>{o.percentual > 0 ? '+' : ''}{o.percentual.toLocaleString('pt-BR')}%</span>}</span>
                </button>
                {aberta && (
                  <div className="px-3 pb-3 space-y-2">
                    {o.motivoSemAnterior && <div className="rounded border border-sky-200 bg-sky-50 text-sky-900 px-2 py-1.5 text-xs"><b>Sem dados de {ano - 1}:</b> {o.motivoSemAnterior}.</div>}
                    <table className="w-full text-[11px] border border-slate-200 rounded">
                      <thead className="bg-slate-50 text-slate-600"><tr><th className="text-left px-2 py-1">Rubrica</th><th className="text-right px-2">{ano - 1}</th><th className="text-right px-2">{ano}</th><th className="text-right px-2">Variação</th><th className="text-left px-2">Por quê</th></tr></thead>
                      <tbody>
                        {o.rubricas.map(l => (
                          <tr key={l.numero} className="border-t border-slate-100 align-top">
                            <td className="px-2 py-1"><b>{l.numero}</b> · {l.descricao}</td>
                            <td className="text-right px-2 tabular-nums">{l.anterior ? brlV(l.anterior) : '—'}</td><td className="text-right px-2 tabular-nums">{l.atual ? brlV(l.atual) : '—'}</td>
                            <td className={`text-right px-2 tabular-nums font-semibold ${cor(l.diferenca)}`}>{sinalV(l.diferenca)}</td>
                            <td className="px-2 py-1"><ul className="space-y-0.5">{l.efeitos.map((e, i) => <li key={i}><span className={`font-semibold ${cor(e.valor)}`}>{NOME_CAUSA[e.causa]} {sinalV(e.valor)}</span> — {e.detalhe}</li>)}</ul></td>
                          </tr>
                        ))}
                        {!o.rubricas.length && <tr><td colSpan={5} className="px-2 py-2 text-slate-500">Sem diferença em nenhuma rubrica.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
          {!lista.length && <p className="text-sm text-slate-500 text-center py-4">Nenhuma OM com esse filtro.</p>}
        </div>
      </>)}
    </section>
  );
};
