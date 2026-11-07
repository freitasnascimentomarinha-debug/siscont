import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, Save, Send } from 'lucide-react';
import { ContextoFaturamento, dataEmissaoPadrao, dataLimite, dataVencimento } from '../../services/faturamentoService';
import { CandidatoCorrecao, Fase4NaoInstaladaError, candidatosCorrecao, emitirCorrecoes, listarTaxas, salvarTaxas } from '../../services/fase4Service';
import { cadastroService } from '../../services/cadastroService';
import { db } from '../../services/db';
import { pad, referencia } from '../../utils/faturamento';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Aviso, Campo, br, brl, compAtual, entrada } from './comum';

/** OI 40-04, 6.2: fatura da diferença entre o valor pago com atraso e o valor corrigido (taxa diária da poupança). */
export const CorrecaoTab: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean; usuario: string; onEmitido: () => Promise<void> }> = ({ ctx, podeEditar, usuario, onEmitido }) => {
  const [taxas, setTaxas] = useState<Record<string, string>>({});
  const [salvas, setSalvas] = useState<Record<string, string>>({});
  const salvasRef = React.useRef<Record<string, string>>({});
  const [anoTaxas, setAnoTaxas] = useState(new Date().getFullYear());
  const [base, setBase] = useState(30);
  const [cands, setCands] = useState<CandidatoCorrecao[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [desde, setDesde] = useState(`${new Date().getFullYear()}-01-01`);
  const [comp, setComp] = useState(compAtual());
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregarTaxas = async () => {
    try {
      const [t, par] = await Promise.all([listarTaxas(), cadastroService.listParametros()]);
      const m = Object.fromEntries(t.map(x => [x.mes, String(x.taxa).replace('.', ',')]));
      // preserva o que foi digitado e ainda não gravado (o carregamento pode terminar depois da digitação)
      setTaxas(prev => ({ ...m, ...Object.fromEntries(Object.entries(prev).filter(([k, v]) => v !== (salvasRef.current[k] ?? undefined) && v.trim() !== '')) }));
      salvasRef.current = m; setSalvas(m); setBase(Number(par.find(p => p.chave === 'correcao_base_dias')?.valor) || 30);
    } catch (e) { if (e instanceof Fase4NaoInstaladaError) setNaoInstalado(true); else notify.fail('Erro ao carregar taxas', e); }
  };
  useEffect(() => { carregarTaxas(); }, []);

  const mapa = useMemo(() => new Map(Object.entries(salvas).map(([k, v]) => [k, Number(v.replace(',', '.'))])), [salvas]);
  const alteradas = Object.keys(taxas).filter(k => taxas[k] !== salvas[k] && taxas[k].trim() !== '');

  const gravarTaxas = async () => {
    setOcupado('taxas');
    try { await salvarTaxas(alteradas.map(mes => ({ mes, taxa: Number(taxas[mes].replace(',', '.')), fonte: 'Digitada' }))); notify.success('Taxas gravadas.'); await carregarTaxas(); }
    catch (e) { notify.fail('Erro ao gravar taxas', e); } finally { setOcupado(null); }
  };

  const calcular = async () => {
    setOcupado('calc');
    try {
      const [inv, bx, docs] = await Promise.all([db.getInvoices(), db.getAllocations(), db.getDocuments()]);
      const c = candidatosCorrecao(inv.filter(i => i.dueDate >= desde), bx, docs, mapa, base);
      setCands(c); setSel(new Set(c.filter(x => !x.jaCorrigida && !x.correcao.semTaxa.length && x.correcao.total >= 0.01).map(x => x.fatura.id)));
    } catch (e) { notify.fail('Erro ao calcular', e); } finally { setOcupado(null); }
  };

  const emitir = async () => {
    const escolhidos = (cands || []).filter(c => sel.has(c.fatura.id));
    setOcupado('emitir');
    try {
      const emissao = dataEmissaoPadrao(comp, ctx.diaEmissao);
      const r = await emitirCorrecoes(escolhidos, ctx, { competencia: comp, emissao, limite: dataLimite(emissao, ctx), vencimento: dataVencimento(emissao, ctx), usuario });
      notify.success(`${r.faturas} fatura(s) de correção emitida(s), total ${brl(r.total)}.`);
      setCands(null);
      await onEmitido();
    } catch (e) { notify.fail('Erro ao emitir', e); } finally { setOcupado(null); }
  };

  if (naoInstalado) return <Aviso>Execute o script <code>supabase/migrations/008_contestacao_fase4.sql</code> no Supabase para usar a correção por atraso.</Aviso>;
  const totalSel = (cands || []).filter(c => sel.has(c.fatura.id)).reduce((s, c) => s + c.correcao.total, 0);
  return (
    <div className="space-y-5">
      <Aviso tom="slate">
        <b>OI 40-04, 6.1 e 6.2:</b> nos 10 dias úteis após a apresentação da fatura é proibido corrigir o valor; paga depois da data-limite, a BNIC pode
        emitir nova fatura com a diferença até a data do pagamento, pela <b>taxa diária equivalente à taxa mensal da poupança</b> (rendimento do 1º dia de
        cada mês). Cálculo: cada pagamento feito após a data-limite × [∏ (1 + taxa do mês)^(1/{base}) − 1], dia a dia.
      </Aviso>

      <section className="space-y-2">
        <div className="flex flex-wrap gap-3 items-end">
          <h3 className="font-semibold text-slate-800 mr-2">Taxas mensais da poupança (% a.m.)</h3>
          <Campo rotulo="Ano"><input className={`${entrada} w-24`} type="number" value={anoTaxas} onChange={e => setAnoTaxas(Number(e.target.value))} /></Campo>
          {podeEditar && <Button size="sm" onClick={gravarTaxas} isLoading={ocupado === 'taxas'} disabled={!alteradas.length}><Save size={14} className="mr-1" />Gravar ({alteradas.length})</Button>}
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-12 gap-2">
          {Array.from({ length: 12 }, (_, i) => `${anoTaxas}-${pad(i + 1)}`).map(m => (
            <label key={m} className="text-[11px] text-slate-600 min-w-0">{referencia(m)}
              <input disabled={!podeEditar} aria-label={`Taxa ${referencia(m)}`} className={`${entrada} w-full min-w-0 text-right ${taxas[m] !== salvas[m] ? 'border-primary-400 bg-primary-50' : ''}`} value={taxas[m] ?? ''} placeholder="0,5000" onChange={e => setTaxas({ ...taxas, [m]: e.target.value })} />
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <h3 className="font-semibold text-slate-800 mr-2">Faturas pagas com atraso</h3>
          <Campo rotulo="Data-limite a partir de"><input className={entrada} type="date" value={desde} onChange={e => setDesde(e.target.value)} /></Campo>
          <Button onClick={calcular} isLoading={ocupado === 'calc'}>{ocupado !== 'calc' && <Calculator size={16} className="mr-2" />}Calcular correções</Button>
        </div>
        {cands && (
          <>
            <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[55vh] overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0"><tr><th className="px-2 py-2"></th><th className="px-2 py-2 text-left">Fatura</th><th className="px-2 py-2 text-left">Data-limite</th><th className="px-2 py-2 text-left">Pagamentos com atraso</th><th className="px-2 py-2 text-right">Correção</th><th className="px-2 py-2 text-left">Situação</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {cands.map(c => (
                    <tr key={c.fatura.id} className={c.jaCorrigida ? 'text-slate-400' : ''}>
                      <td className="px-2 py-1.5"><input type="checkbox" className="h-4 w-4 accent-primary-600" disabled={!!c.jaCorrigida || !podeEditar} checked={sel.has(c.fatura.id)} aria-label={`Corrigir ${c.fatura.invoiceNumber}`}
                        onChange={() => setSel(p => { const n = new Set(p); n.has(c.fatura.id) ? n.delete(c.fatura.id) : n.add(c.fatura.id); return n; })} /></td>
                      <td className="px-2 py-1.5"><div className="font-mono text-xs">{c.fatura.invoiceNumber}</div><div className="text-[11px] text-slate-500 truncate max-w-[220px]">{c.fatura.client}</div></td>
                      <td className="px-2 py-1.5 text-xs">{br(c.fatura.dueDate)}</td>
                      <td className="px-2 py-1.5 text-xs">{c.correcao.pagamentos.map(p => <div key={p.data + p.valor}>{br(p.data)}: {brl(p.valor)} · {p.dias} dias · +{brl(p.correcao)}</div>)}</td>
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{brl(c.correcao.total)}</td>
                      <td className="px-2 py-1.5 text-xs">{c.jaCorrigida ? `já corrigida (${c.jaCorrigida})` : c.correcao.semTaxa.length ? <span className="text-amber-700">sem taxa: {c.correcao.semTaxa.map(referencia).join(', ')}</span> : ''}</td>
                    </tr>
                  ))}
                  {!cands.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Nenhuma fatura paga depois da data-limite no período.</td></tr>}
                </tbody>
              </table>
            </div>
            {podeEditar && sel.size > 0 && (
              <div className="p-3 rounded-lg border border-primary-200 bg-primary-50/50 flex flex-wrap items-center gap-3">
                <span className="text-sm flex-1">Emitir <b>{sel.size}</b> fatura(s) de correção (linha 03, acréscimo) somando <b>{brl(totalSel)}</b>, competência</span>
                <input className={entrada} type="month" value={comp} onChange={e => setComp(e.target.value)} aria-label="Competência das faturas de correção" />
                <Button onClick={emitir} isLoading={ocupado === 'emitir'}><Send size={14} className="mr-1" />Emitir correções</Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
