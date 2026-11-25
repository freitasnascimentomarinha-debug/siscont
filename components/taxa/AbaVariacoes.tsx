import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Download, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '../ui/Button';
import { Aviso, brl, entrada } from '../faturamento/comum';
import { notify } from '../../utils/notify';
import { analiseDeVariacoes } from '../../services/taxaCondominialService';
import { AnaliseOM, Causa, NOME_CAUSA } from '../../utils/analiseVariacao';
import { baixarRelatorio } from '../../utils/pdfRelatorio';
import { hojeISO, dataBR as dataBr } from '../../utils/datas';

const sinal = (n: number) => (Math.abs(n) < 0.005 ? '—' : `${n < 0 ? '−' : '+'}${brl(Math.abs(n))}`);
const CAUSAS = Object.keys(NOME_CAUSA) as Causa[];

/**
 * Justificativa das variações: por que a taxa de cada OM mudou em relação ao ano anterior (valor das rubricas, lotação da OM,
 * entrada/saída de outras OM, participação nas rubricas, descontos). Cada diferença é explicada em R$ e a soma fecha com o total.
 */
export const AbaVariacoes: React.FC<{ ano: number; versao: unknown }> = ({ ano, versao }) => {
  const [dados, setDados] = useState<{ temAnterior: boolean; analise: AnaliseOM[]; statusAnterior: string } | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [soVaria, setSoVaria] = useState(true);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  useEffect(() => {
    let vivo = true; setDados(null); setErro('');
    analiseDeVariacoes(ano).then(d => { if (vivo) setDados(d); }).catch(e => { if (vivo) setErro(e?.message || 'Não foi possível calcular as variações.'); });
    return () => { vivo = false; };
  }, [ano, versao]);

  const lista = useMemo(() => (dados?.analise || []).filter(o => (!soVaria || Math.abs(o.diferenca) >= 0.005 || o.situacao !== 'MANTIDA')
    && (!busca.trim() || o.nome.toLowerCase().includes(busca.trim().toLowerCase()))), [dados, soVaria, busca]);
  const total = useMemo(() => lista.reduce((t, o) => ({ ant: t.ant + o.anualAnterior, atu: t.atu + o.anualAtual }), { ant: 0, atu: 0 }), [lista]);

  const excel = () => {
    if (!dados) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['OM', 'SITUAÇÃO', `LOTAÇÃO ${ano - 1}`, `LOTAÇÃO ${ano}`, `ANUAL ${ano - 1}`, `ANUAL ${ano}`, 'VARIAÇÃO (R$)', 'VARIAÇÃO (%)', 'JUSTIFICATIVA'],
      ...dados.analise.map(o => [o.nome, o.situacao === 'NOVA' ? 'Nova na taxa' : o.situacao === 'SAIU' ? 'Saiu da taxa' : 'Mantida', o.lotacaoAnterior ?? '', o.lotacaoAtual ?? '', o.anualAnterior, o.anualAtual, o.diferenca, o.percentual ?? '', o.resumo]),
    ]), 'Resumo por OM');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['OM', 'RUBRICA', 'DESCRIÇÃO', `${ano - 1} (R$)`, `${ano} (R$)`, 'VARIAÇÃO (R$)', 'CAUSA', 'EFEITO (R$)', 'DETALHE'],
      ...dados.analise.flatMap(o => o.rubricas.flatMap(l => (l.efeitos.length ? l.efeitos : [{ causa: 'AJUSTE' as Causa, valor: 0, detalhe: l.texto }]).map((e, i) => [o.nome, l.numero, l.descricao, i ? '' : l.anterior, i ? '' : l.atual, i ? '' : l.diferenca, NOME_CAUSA[e.causa], e.valor, e.detalhe]))),
    ]), 'Detalhe por rubrica');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['OM', 'VARIAÇÃO TOTAL (R$)', ...CAUSAS.map(c => NOME_CAUSA[c])],
      ...dados.analise.map(o => [o.nome, o.diferenca, ...CAUSAS.map(c => o.porCausa[c] ?? 0)]),
    ]), 'Causas por OM');
    XLSX.writeFile(wb, `justificativa_variacoes_taxa_${ano}.xlsx`);
  };
  const pdf = () => {
    if (!dados) return;
    const mostrar = dados.analise.filter(o => o.situacao !== 'MANTIDA' || Math.abs(o.diferenca) >= 0.005);
    baixarRelatorio({
      titulo: `Justificativa das variações da taxa condominial ${ano} × ${ano - 1}`, arquivo: `justificativa_variacoes_taxa_${ano}.pdf`, orientacao: 'l',
      linhas: [`Gerado em ${dataBr(hojeISO())}. Cada variação é explicada pelas causas abaixo; a soma das causas fecha com a diferença de cada OM.`,
        'Causas: valor da rubrica · lotação da própria OM · outras OM que entraram/saíram da rubrica · lotação das demais OM · participação da OM nas rubricas · descontos.'],
      tabelas: [
        { titulo: 'Resumo por OM', head: ['OM', 'Lotação', `Anual ${ano - 1}`, `Anual ${ano}`, 'Variação', 'Justificativa'],
          body: mostrar.map(o => [o.nome, `${o.lotacaoAnterior ?? '-'} → ${o.lotacaoAtual ?? '-'}`, brl(o.anualAnterior), brl(o.anualAtual), `${sinal(o.diferenca)}${o.percentual !== null ? ` (${o.percentual}%)` : ''}`, o.resumo]),
          direita: [2, 3, 4], larguras: [48, 22, 28, 28, 36, 120] },
        ...mostrar.map(o => ({ titulo: `${o.nome} — rubrica por rubrica`, head: ['Nº', 'Rubrica', ano - 1, ano, 'Variação', 'Por quê'].map(String),
          body: o.rubricas.map(l => [l.numero, l.descricao, brl(l.anterior), brl(l.atual), sinal(l.diferenca), l.texto]), direita: [2, 3, 4], larguras: [10, 50, 26, 26, 28, 130] })),
      ],
    });
  };
  const alterna = (id: string) => setAbertas(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (erro) return <Aviso tom="red">{erro}</Aviso>;
  if (!dados) return <p className="text-sm text-slate-500">Calculando as variações…</p>;
  if (!dados.temAnterior) return <Aviso tom="amber">Não há proposta de {ano - 1} (rubricas e lotação) cadastrada para comparar. Importe ou cadastre o exercício anterior para ver as justificativas.</Aviso>;
  return (
    <div className="space-y-3" data-testid="aba-variacoes">
      <p className="text-xs text-slate-500">Compara a taxa de {ano} com a de {ano - 1}, OM por OM. Cada diferença é explicada em R$ pelas causas (valor da rubrica, lotação da OM, outras OM que entram ou saem, participação nas rubricas e descontos); a soma das causas fecha com a variação total. Clique numa OM para ver rubrica por rubrica.</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <input className={`${entrada} w-56`} placeholder="Buscar OM…" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar OM" />
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={soVaria} onChange={e => setSoVaria(e.target.checked)} />Só OM com variação</label>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={excel}><Download size={14} className="mr-1" />Excel</Button>
        <Button size="sm" variant="secondary" onClick={pdf}><FileText size={14} className="mr-1" />PDF</Button>
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600"><tr>
            <th className="w-6" /><th className="px-2 py-2 text-left">OM</th><th className="px-2 text-right">Lotação</th><th className="px-2 text-right">Anual {ano - 1}</th><th className="px-2 text-right">Anual {ano}</th><th className="px-2 text-right">Variação</th><th className="px-2 text-left">Justificativa</th>
          </tr></thead>
          <tbody>
            {lista.map(o => (
              <React.Fragment key={o.omId}>
                <tr className="border-t border-slate-100 align-top cursor-pointer hover:bg-slate-50" onClick={() => alterna(o.omId)}>
                  <td className="px-1 py-2">{abertas.has(o.omId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  <td className="px-2 py-2 font-semibold">{o.nome}{o.situacao !== 'MANTIDA' && <span className="ml-1 px-1.5 rounded bg-sky-100 text-sky-800 font-normal">{o.situacao === 'NOVA' ? 'nova' : 'saiu'}</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{o.lotacaoAnterior ?? '—'} → {o.lotacaoAtual ?? '—'}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{brl(o.anualAnterior)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{brl(o.anualAtual)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${o.diferenca > 0 ? 'text-red-700' : o.diferenca < 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{sinal(o.diferenca)}{o.percentual !== null && Math.abs(o.diferenca) >= 0.005 ? <div className="font-normal">{o.percentual > 0 ? '+' : ''}{o.percentual.toLocaleString('pt-BR')}%</div> : null}</td>
                  <td className="px-2 py-2 text-slate-700 min-w-[320px]">{o.resumo}</td>
                </tr>
                {abertas.has(o.omId) && (
                  <tr className="bg-slate-50"><td /><td colSpan={6} className="px-2 py-2">
                    {o.motivoSemAnterior && <div className="mb-2 rounded border border-sky-200 bg-sky-50 text-sky-900 px-2 py-1.5 text-xs"><b>Sem dados de {ano - 1}:</b> {o.motivoSemAnterior}.</div>}
                    <table className="w-full text-[11px]">
                      <thead className="text-slate-500"><tr><th className="text-left">Nº · Rubrica</th><th className="text-right px-2">{ano - 1}</th><th className="text-right px-2">{ano}</th><th className="text-right px-2">Variação</th><th className="text-left px-2">Por quê</th></tr></thead>
                      <tbody>
                        {o.rubricas.map(l => (
                          <tr key={l.numero} className="border-t border-slate-200 align-top">
                            <td className="py-1 pr-2"><b>{l.numero}</b> · {l.descricao}</td>
                            <td className="text-right px-2 tabular-nums">{brl(l.anterior)}</td><td className="text-right px-2 tabular-nums">{brl(l.atual)}</td>
                            <td className={`text-right px-2 tabular-nums font-semibold ${l.diferenca > 0 ? 'text-red-700' : l.diferenca < 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{sinal(l.diferenca)}</td>
                            <td className="px-2"><ul className="list-disc ml-4">{l.efeitos.map((e, i) => <li key={i}><b>{NOME_CAUSA[e.causa]}</b> {sinal(e.valor)} — {e.detalhe}</li>)}</ul></td>
                          </tr>
                        ))}
                        {!o.rubricas.length && <tr><td colSpan={5} className="py-2 text-slate-500">Sem diferença em nenhuma rubrica.</td></tr>}
                      </tbody>
                    </table>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {!lista.length && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-500">Nenhuma OM com esse filtro.</td></tr>}
          </tbody>
          {lista.length > 0 && <tfoot className="bg-slate-50 font-semibold"><tr><td /><td className="px-2 py-2">Total ({lista.length} OM)</td><td /><td className="px-2 text-right tabular-nums">{brl(total.ant)}</td><td className="px-2 text-right tabular-nums">{brl(total.atu)}</td><td className="px-2 text-right tabular-nums">{sinal(total.atu - total.ant)}</td><td /></tr></tfoot>}
        </table>
      </div>
    </div>
  );
};
