import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, ChevronDown, ChevronRight, Send } from 'lucide-react';
import {
  ContextoFaturamento, adiantamentosDisponiveis, dataEmissaoPadrao, dataLimite, emitirLote, montarDados, listarMedicoes, listarAtracacoes,
} from '../../services/faturamentoService';
import {
  DocAdiantDisp, ItemLote, TipoLote, aplicarAdiantamentos, calcularAcerto, calcularMes, calcularOnd, numerar, partes, pad, referencia, totaisLote,
} from '../../utils/faturamento';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Aviso, Campo, br, brl, compAtual, entrada } from './comum';

const MEDIDOS = ['AE', 'EL', 'TL', 'VT', 'RB', 'CR'];

export const LoteTab: React.FC<{ ctx: ContextoFaturamento; usuario: string; podeEditar: boolean; onEmitido: () => Promise<void> }> = ({ ctx, usuario, podeEditar, onEmitido }) => {
  const [tipo, setTipo] = useState<TipoLote>('MENSAL');
  const [comp, setComp] = useState(compAtual());
  const [anoOnd, setAnoOnd] = useState(String(new Date().getFullYear() - (new Date().getMonth() < 9 ? 1 : 0)));
  const [emissao, setEmissao] = useState('');
  const [limite, setLimite] = useState('');
  const [siglas, setSiglas] = useState<Set<string>>(new Set(ctx.servicos.map(s => s.sigla)));
  const [divisor, setDivisor] = useState<'PERIODO' | 'MESES_FATURADOS'>('PERIODO');
  const [abater, setAbater] = useState(true);
  const [itens, setItens] = useState<ItemLote[] | null>(null);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [ajustes, setAjustes] = useState<Record<string, number>>({});
  const [adiant, setAdiant] = useState<DocAdiantDisp[]>([]);
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [emitindo, setEmitindo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  // competência do lote: OND = outubro; acerto = a escolhida (normalmente JAN do ano seguinte)
  const compLote = tipo === 'OND' ? `${comp.slice(0, 4)}-10` : comp;
  useEffect(() => {
    const e = dataEmissaoPadrao(compLote, ctx.diaEmissao);
    setEmissao(e); setLimite(dataLimite(e, ctx));
    setItens(null);
  }, [compLote, tipo]);

  const calcular = async () => {
    setCalculando(true); setFora(new Set()); setAjustes({});
    try {
      const base = tipo === 'ACERTO' ? `${anoOnd}-10` : compLote;
      const d = { ...(await montarDados(ctx, tipo, base)), siglas: [...siglas], divisorOnd: divisor };
      const lista = tipo === 'MENSAL' ? calcularMes(d, compLote) : tipo === 'OND' ? calcularOnd(d) : calcularAcerto({ ...d, anoOnd: Number(anoOnd) });
      setItens(lista);
      setAdiant(abater ? await adiantamentosDisponiveis() : []);
      // pendências do mês
      const p: string[] = [];
      if (tipo !== 'ACERTO') {
        const [med, atr] = await Promise.all([listarMedicoes([compLote]), listarAtracacoes([compLote])]);
        MEDIDOS.filter(s => siglas.has(s)).forEach(s => { if (!med.some(m => m.sigla === s)) p.push(`Nenhuma medição de ${s} lançada para ${referencia(compLote)}.`); });
        if (siglas.has('DA') && tipo === 'MENSAL' && !atr.some(a => !a.previsao)) p.push(`Mapa de atracação (BNIC-35) de ${referencia(compLote)} não lançado.`);
        if (tipo === 'OND' && siglas.has('DA') && !atr.some(a => a.previsao)) {
          const prev = await listarAtracacoes([10, 11, 12].map(m => `${compLote.slice(0, 4)}-${pad(m)}`));
          if (!prev.some(a => a.previsao)) p.push('Previsão de atracação de OUT–DEZ não lançada: o OND sairá sem diárias.');
        }
        const existentes = ctx.invoices.filter(i => !i.isCanceled && i.yearCompetence === partes(compLote).ano && i.monthCompetence === partes(compLote).mes);
        if (existentes.length) p.push(`Já existem ${existentes.length} fatura(s) de ${referencia(compLote)} no sistema: as novas continuam a numeração. Confira para não emitir em duplicidade.`);
      }
      setPendencias(p);
    } catch (e) { notify.fail('Erro ao calcular o lote', e); } finally { setCalculando(false); }
  };

  const final = useMemo(() => {
    if (!itens) return [];
    const inc = itens.filter(i => !fora.has(i.chave)).map(i => (ajustes[i.chave] !== undefined ? { ...i, valor: ajustes[i.chave], base: { ...i.base, ajusteManual: true, valorCalculado: i.valor } } : i));
    const num = numerar(inc, ctx.invoices.map(i => i.invoiceNumber), compLote);
    return abater && tipo !== 'ACERTO' ? aplicarAdiantamentos(num, adiant) : num;
  }, [itens, fora, ajustes, adiant, abater, compLote, ctx.invoices, tipo]);
  const tot = totaisLote(final);

  const emitir = async () => {
    setEmitindo('Iniciando...');
    try {
      const r = await emitirLote(final, { tipo, competencia: compLote, emissao, limite, usuario }, setEmitindo);
      notify.success(`Lote emitido: ${r.faturas} faturas (${brl(r.total)} a pagar); ${r.adiantamentos} abatimento(s) de adiantamento.`);
      setItens(null); setConfirmar(false);
      await onEmitido();
    } catch (e) { notify.fail('Erro ao emitir o lote', e); } finally { setEmitindo(null); }
  };

  const alternar = (k: string) => setAbertos(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Campo rotulo="Tipo de lote">
          <select className={entrada} value={tipo} onChange={e => setTipo(e.target.value as TipoLote)} aria-label="Tipo de lote">
            <option value="MENSAL">Mensal</option>
            <option value="OND">Estimado de fim de exercício (OND)</option>
            <option value="ACERTO">Acerto do OND (ano seguinte)</option>
          </select>
        </Campo>
        {tipo === 'ACERTO' && <Campo rotulo="OND a acertar (ano)"><input className={`${entrada} w-24`} type="number" value={anoOnd} onChange={e => setAnoOnd(e.target.value)} /></Campo>}
        <Campo rotulo={tipo === 'OND' ? 'Exercício (competência OUT)' : tipo === 'ACERTO' ? 'Competência das faturas de acerto' : 'Competência'}>
          <input className={entrada} type="month" value={comp} onChange={e => setComp(e.target.value)} aria-label="Competência" />
        </Campo>
        <Campo rotulo="Emissão"><input className={entrada} type="date" value={emissao} onChange={e => { setEmissao(e.target.value); setLimite(dataLimite(e.target.value, ctx)); }} /></Campo>
        <Campo rotulo={`Data-limite (+${ctx.prazo} dias úteis)`}><input className={entrada} type="date" value={limite} onChange={e => setLimite(e.target.value)} /></Campo>
        {tipo === 'OND' && (
          <Campo rotulo="Média JAN–AGO dividida por">
            <select className={entrada} value={divisor} onChange={e => setDivisor(e.target.value as any)}>
              <option value="PERIODO">8 meses (regra)</option><option value="MESES_FATURADOS">meses com fatura</option>
            </select>
          </Campo>
        )}
        {tipo !== 'ACERTO' && <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={abater} onChange={e => setAbater(e.target.checked)} /> Abater adiantamento disponível</label>}
        <Button onClick={calcular} isLoading={calculando}>{!calculando && <Calculator size={16} className="mr-2" />}Calcular prévia</Button>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-slate-500 mr-1">Serviços:</span>
        {ctx.servicos.map(s => (
          <label key={s.sigla} className={`px-2 py-1 rounded border cursor-pointer ${siglas.has(s.sigla) ? 'bg-primary-50 border-primary-300 text-primary-800' : 'bg-white border-slate-200 text-slate-400'}`} title={s.nome}>
            <input type="checkbox" className="sr-only" checked={siglas.has(s.sigla)} onChange={() => setSiglas(p => { const n = new Set(p); n.has(s.sigla) ? n.delete(s.sigla) : n.add(s.sigla); return n; })} />{s.sigla}
          </label>
        ))}
      </div>

      {itens && (
        <>
          {pendencias.length > 0 && <Aviso><b>Pendências:</b><ul className="list-disc pl-5">{pendencias.map(p => <li key={p}>{p}</li>)}</ul></Aviso>}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {[['Faturas', String(tot.qtd)], ['01 Serviço', brl(tot.servico)], ['02 Adiantamento', brl(tot.adiantamento)], ['03 Acréscimo', brl(tot.acrescimo)], ['04 Débito', brl(tot.debito)], ['A pagar', brl(tot.final)]].map(([r, v]) => (
              <div key={r} className="p-2 rounded border border-slate-200 bg-white"><div className="text-[10px] uppercase font-semibold text-slate-500">{r}</div><div className="font-bold tabular-nums">{v}</div></div>
            ))}
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0 z-10">
                <tr><th className="px-2 py-2"></th><th className="px-2 py-2 text-left">Número</th><th className="px-2 py-2 text-left">OM usuária</th><th className="px-2 py-2 text-left">Consumo</th><th className="px-2 py-2 text-right">Serviço (01)</th><th className="px-2 py-2 text-right">Adiant. (02)</th><th className="px-2 py-2 text-right">Acr./Déb.</th><th className="px-2 py-2 text-right">A pagar</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {final.map(i => {
                  const ad = (i.adiantamentos || []).reduce((s, a) => s + a.valor, 0);
                  const aberto = abertos.has(i.chave);
                  return (
                    <React.Fragment key={i.chave}>
                      <tr className={i.avisos.length ? 'bg-amber-50/50' : ''}>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <input type="checkbox" checked aria-label={`Incluir ${i.numero}`} onChange={() => setFora(p => new Set(p).add(i.chave))} className="h-4 w-4 accent-primary-600 mr-1" />
                          <button onClick={() => alternar(i.chave)} className="text-slate-400 align-middle" aria-label="Ver base de cálculo">{aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">{i.numero}{i.avisos.length > 0 && <AlertTriangle size={12} className="inline ml-1 text-amber-600" />}</td>
                        <td className="px-2 py-1.5 max-w-[240px]"><div className="truncate" title={i.om.nome}>{i.om.nome}</div><div className="text-[11px] text-slate-500 truncate">{i.servico}</div></td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">{i.quantidade != null ? `${i.quantidade.toLocaleString('pt-BR')} ${i.unidade}` : '-'}{i.quantidade2 != null ? ` / ${i.quantidade2.toLocaleString('pt-BR')} kW` : ''}</td>
                        <td className="px-2 py-1.5 text-right">
                          {tipo === 'ACERTO' ? <span className="tabular-nums">{brl(i.valor)}</span> : (
                            <input type="number" step="0.01" aria-label={`Valor de ${i.numero}`} disabled={!podeEditar}
                              className={`w-32 text-right border rounded px-1 py-0.5 tabular-nums ${ajustes[i.chave] !== undefined ? 'border-primary-400 bg-primary-50' : 'border-slate-200'}`}
                              value={ajustes[i.chave] ?? i.valor} onChange={e => setAjustes({ ...ajustes, [i.chave]: Math.round((Number(e.target.value) || 0) * 100) / 100 })} />
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-orange-700" title={(i.adiantamentos || []).map(a => `${a.numero}: ${brl(a.valor)}`).join('\n')}>{ad ? brl(ad) : '-'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-xs">{i.acrescimo ? `+${brl(i.acrescimo)}` : i.debito ? `−${brl(i.debito)}` : '-'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{brl(i.valor - ad + i.acrescimo - i.debito)}</td>
                      </tr>
                      {aberto && (
                        <tr className="bg-slate-50 text-xs text-slate-600"><td></td><td colSpan={7} className="px-2 py-2">
                          <div><b>Base de cálculo:</b> {String(i.base.regra)}</div>
                          <div className="font-mono text-[11px] break-all">{JSON.stringify(Object.fromEntries(Object.entries(i.base).filter(([k]) => k !== 'regra')))}</div>
                          {(i.adiantamentos || []).map(a => <div key={a.docId}>Baixa na ALTCRED {a.numero}: {brl(a.valor)}</div>)}
                          {i.avisos.map(a => <div key={a} className="text-amber-700">{a}</div>)}
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!final.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Nada a faturar com esses dados. Lance as medições, o mapa de atracação e os preços do ano.</td></tr>}
              </tbody>
            </table>
          </div>
          {fora.size > 0 && <p className="text-xs text-slate-500">{fora.size} fatura(s) retirada(s) da prévia. <button className="text-primary-700 underline" onClick={() => setFora(new Set())}>Recolocar</button></p>}
          {podeEditar && final.length > 0 && (
            <div className="p-3 rounded-lg border border-primary-200 bg-primary-50/50 flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-700 flex-1">Emitir <b>{final.length}</b> faturas de {referencia(compLote)} com emissão em <b>{br(emissao)}</b> e data-limite <b>{br(limite)}</b>. A numeração segue a ordem acima, sem lacunas.</span>
              {!confirmar ? <Button onClick={() => setConfirmar(true)}><Send size={16} className="mr-2" />Emitir lote</Button> : (
                <>
                  <span className="text-sm font-semibold">Confirma a emissão?</span>
                  <Button onClick={emitir} isLoading={!!emitindo}>{emitindo || 'Sim, emitir'}</Button>
                  <Button variant="ghost" onClick={() => setConfirmar(false)} disabled={!!emitindo}>Voltar</Button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
