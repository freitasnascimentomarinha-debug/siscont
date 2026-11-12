import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calculator, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Send } from 'lucide-react';
import * as XLSX from 'xlsx';
import { linhasPrevia } from '../../utils/resumoFaturamento';
import {
  ContextoFaturamento, adiantamentosDisponiveis, dataEmissaoPadrao, dataLimite, dataVencimento, emitirLote, montarDados, listarMedicoes, listarAtracacoes,
} from '../../services/faturamentoService';
import { textoConsumo, descreverBase,
  DocAdiantDisp, ItemLote, TipoLote, adiantamentoDoCliente, aplicarAdiantamentos, saldosRestantes, apurarOnd, calcularMes, calcularOnd, estimativasJaEmitidas, foraDoOnd, ApuracaoLinha, mesesDoAno, numerar, participaDoOnd, partes, pad, referencia, totaisLote,
} from '../../utils/faturamento';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { CreditoAberto, aplicarCreditosOm, creditosDaOm } from '../../utils/creditosOm';
import { listarLivroCreditos } from '../../services/creditosOmService';
import { marcarSemMovimento, registrarApuracoes } from '../../services/encerramentoService';
import { Aviso, Campo, br, brl, entrada } from './comum';

const MEDIDOS = ['AE', 'EL', 'TL', 'VT', 'RB', 'CR'];

export const LoteTab: React.FC<{ ctx: ContextoFaturamento; usuario: string; podeEditar: boolean; onEmitido: () => Promise<void>; comp: string; setComp: (c: string) => void }> = ({ ctx, usuario, podeEditar, onEmitido, comp, setComp }) => {
  const [tipo, setTipo] = useState<TipoLote>('MENSAL');
  const [anoOnd, setAnoOnd] = useState(String(new Date().getFullYear() - (new Date().getMonth() < 9 ? 1 : 0)));
  const [emissao, setEmissao] = useState('');
  const [limite, setLimite] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [siglas, setSiglas] = useState<Set<string>>(new Set(ctx.servicos.map(s => s.sigla)));
  const [divisor, setDivisor] = useState<'PERIODO' | 'MESES_FATURADOS'>('PERIODO');
  const [abater, setAbater] = useState(true);
  const [compensar, setCompensar] = useState(true);
  const [creditos, setCreditos] = useState<CreditoAberto[]>([]);
  const [itens, setItens] = useState<ItemLote[] | null>(null);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [ajustes, setAjustes] = useState<Record<string, number>>({});
  const [adiant, setAdiant] = useState<DocAdiantDisp[]>([]);
  // abatimentos de adiantamento escolhidos à mão na prévia (valem para ALTCRED de qualquer comando)
  const [manuais, setManuais] = useState<Record<string, { docId: string; valor: number }[]>>({});
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [calculando, setCalculando] = useState(false);
  const [emitindo, setEmitindo] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [apuracoes, setApuracoes] = useState<Omit<ApuracaoLinha, 'id'>[]>([]);
  const [marcando, setMarcando] = useState(false);
  // outubro: o vencimento de TODAS as faturas é o de fim de exercício (= data-limite de certificação). Nas que não são OND é opcional.
  const [vencFim, setVencFim] = useState(true);
  const [vencFimNaoOnd, setVencFimNaoOnd] = useState(true);

  // competência do lote: OND = outubro; acerto = a escolhida (normalmente JAN do ano seguinte)
  const compLote = tipo === 'OND' ? `${comp.slice(0, 4)}-10` : comp;
  const outubro = tipo === 'MENSAL' && partes(compLote).mes === 10;
  useEffect(() => {
    const e = dataEmissaoPadrao(compLote, ctx.diaEmissao);
    setEmissao(e); setLimite(dataLimite(e, ctx)); setVencimento(dataVencimento(e, ctx, tipo === 'OND'));
    setItens(null);
  }, [compLote, tipo]);

  const calcular = async () => {
    setCalculando(true); setFora(new Set()); setAjustes({}); setManuais({});
    try {
      const base = tipo === 'ACERTO' ? `${anoOnd}-10` : compLote;
      const d = { ...(await montarDados(ctx, tipo, base)), siglas: [...siglas], divisorOnd: divisor };
      const apur = tipo === 'ACERTO' ? apurarOnd({ ...d, anoOnd: Number(anoOnd) }) : null;
      setApuracoes(apur ? apur.apuracoes : []);
      const lista = (tipo === 'MENSAL' ? calcularMes(d, compLote) : tipo === 'OND' ? calcularOnd(d) : apur!.itens)
        .map(i => ({ ...i, ond: participaDoOnd(d, i.omId, i.sigla, partes(compLote).ano) }));
      // OM emissora (BNIC): o valor dela no rateio é só controle e contabilidade de custos — não gera fatura
      const emi = ctx.emissora.omId;
      const daEmissora = emi ? lista.filter(i => i.omId === emi) : [];
      const aFaturar = emi ? lista.filter(i => i.omId !== emi) : lista;
      setAdiant(tipo === 'ACERTO' ? [] : await adiantamentosDisponiveis(ctx.oms));
      // crédito da OM (livro, só no lote mensal): abate as faturas de qualquer serviço da mesma OM
      let cred: CreditoAberto[] = [];
      if (tipo === 'MENSAL') { try { cred = creditosDaOm((await listarLivroCreditos()).movs); } catch { cred = []; } }
      setCreditos(cred);
      setItens(aFaturar);   // a prévia só aparece com adiantamentos e créditos já carregados (sem o valor mudar depois)
      // pendências do mês
      const p: string[] = [];
      if (daEmissora.length) p.push(`${ctx.emissora.nome} é a OM emissora: ${brl(daEmissora.reduce((s, i) => s + i.valor, 0))} de rateio (${[...new Set(daEmissora.map(i => i.sigla))].join(', ')}) ficam só para controle e contabilidade de custos — não geram fatura.`);
      if (tipo === 'OND') {
        const ja = estimativasJaEmitidas(d);
        if (ja.length) p.push(`A estimativa de outubro de ${partes(compLote).ano} já foi emitida para ${ja.length} OM/serviço(s) (${[...new Set(ja.map(x => x.sigla))].join(', ')}): eles não entram de novo, para não duplicar.`);
        const f = foraDoOnd(d);
        if (f.length) p.push(`Fora da estimativa pelo regime de fim de exercício (Cadastros › Regimes OND): ${f.map(x => `${x.sigla} — ${x.qtd} OM (${x.regime === 2 ? 'fatura mensal normal' : 'não participa'})`).join('; ')}.`);
      }
      if (apur) {
        if (apur.jaApuradas.length) p.push(`${apur.jaApuradas.length} acerto(s) de ${anoOnd} já foram apurados e não entram de novo.`);
        if (apur.semDiferenca.length) p.push(`${apur.semDiferenca.length} OM/serviço(s) sem diferença entre estimado e real: não geram fatura; a apuração é registrada como "sem diferença" (botão abaixo).`);
      }
      if (tipo !== 'ACERTO') {
        const [med, atr] = await Promise.all([listarMedicoes([compLote]), listarAtracacoes([compLote])]);
        MEDIDOS.filter(s => siglas.has(s)).forEach(s => { if (!med.some(m => m.sigla === s)) p.push(`Nenhuma medição de ${s} lançada para ${referencia(compLote)}.`); });
        if (siglas.has('DA') && tipo === 'MENSAL' && !atr.some(a => !a.previsao)) p.push(`Mapa de atracação de ${referencia(compLote)} não lançado${ctx.servicos.find(x => x.sigla === 'DA')?.responsavel ? ` (responsável: ${ctx.servicos.find(x => x.sigla === 'DA')!.responsavel})` : ''}.`);
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
    const venceNaLimite = (i: ItemLote) => outubro && vencFim && (i.ond || vencFimNaoOnd);
    const inc = itens.filter(i => !fora.has(i.chave)).map(i => ({ ...i, venceNaLimite: venceNaLimite(i) })).map(i => (ajustes[i.chave] !== undefined ? { ...i, valor: ajustes[i.chave], base: { ...i.base, ajusteManual: true, valorCalculado: i.valor } } : i));
    const comCredito = compensar && tipo === 'MENSAL' ? aplicarCreditosOm(inc, creditos) : inc;
    const num = numerar(comCredito, ctx.invoices.map(i => i.invoiceNumber), compLote);
    return tipo !== 'ACERTO' ? aplicarAdiantamentos(num, adiant, { automatico: abater, manuais }) : num;
  }, [itens, fora, ajustes, adiant, manuais, abater, compensar, creditos, compLote, ctx.invoices, tipo, vencFim, vencFimNaoOnd]);
  const tot = totaisLote(final);
  const bloqueados = final.filter(i => i.bloqueio);
  const soSemDiferenca = apuracoes.filter(a => a.resultado === 'SEM_DIFERENCA');

  /** Marca como "sem movimento" os meses que faltam nesta linha (a estimativa ou o acerto passa a contá-los como zero). */
  const marcarFaltantes = async (lista: ItemLote[]) => {
    const ano = tipo === 'ACERTO' ? Number(anoOnd) : partes(compLote).ano;
    const marcas = lista.flatMap(i => (((i.base as any).mesesFaltantes || []) as number[]).map(mes => ({ omId: i.omId, sigla: i.sigla, ano, mes })));
    if (!marcas.length) return;
    if (!window.confirm(`Confirma que ${lista.length === 1 ? 'esta OM não teve' : `estas ${lista.length} OM/serviços não tiveram`} consumo nos meses que faltam (${[...new Set(marcas.map(m => mesesDoAno[m.mes - 1]))].join(', ')})? Eles passam a valer ZERO no cálculo.`)) return;
    setMarcando(true);
    try { await marcarSemMovimento(marcas, 'Marcado na prévia do lote'); notify.success('Meses marcados como sem movimento.'); await calcular(); }
    catch (e) { notify.fail('Erro ao marcar os meses', e); } finally { setMarcando(false); }
  };
  const registrarSemDiferenca = async () => {
    setMarcando(true);
    try { await registrarApuracoes(soSemDiferenca, null); notify.success(`${soSemDiferenca.length} apuração(ões) sem diferença registrada(s).`); await calcular(); }
    catch (e) { notify.fail('Erro ao registrar a apuração', e); } finally { setMarcando(false); }
  };

  const emitir = async () => {
    setEmitindo('Iniciando...');
    try {
      const r = await emitirLote(final, { tipo, competencia: compLote, emissao, limite, vencimento, usuario, apuracoes: tipo === 'ACERTO' ? apuracoes : undefined }, setEmitindo);
      notify.success(`Lote emitido: ${r.faturas} faturas (${brl(r.total)} a pagar); ${r.adiantamentos} abatimento(s) de adiantamento.`);
      setItens(null); setConfirmar(false);
      await onEmitido();
    } catch (e) { notify.fail('Erro ao emitir o lote', e); } finally { setEmitindo(null); }
  };

  const [gerandoPdf, setGerandoPdf] = useState(false);
  /** PDF único com a capa-resumo e todas as faturas do lote (com anexos), com marca d'água de PRÉVIA em todas as páginas. */
  const previaPdf = async () => {
    setGerandoPdf(true);
    try {
      const [{ carregarContextoFr172 }, { pdfPreviaLote }] = await Promise.all([import('../../services/fr172Service'), import('../../utils/previaFr172')]);
      const c = await carregarContextoFr172();
      const pdf = pdfPreviaLote(final, { tipo, competencia: compLote, emissao, limite, vencimento, servicos: c.servicos, params: c.params });
      pdf.save(`PREVIA_faturas_${compLote}_${tipo}.pdf`);
      notify.success(`Prévia em PDF gerada (${final.length} fatura(s)). Todas as páginas levam a marca d'água PRÉVIA.`);
    } catch (e) { notify.fail('Erro ao gerar a prévia em PDF', e); } finally { setGerandoPdf(false); }
  };
  const exportarPrevia = () => {
    const ws = XLSX.utils.aoa_to_sheet(linhasPrevia(final));
    ws['!cols'] = [30, 8, 46, 24, 12, 8, 14, 16, 14, 12, 14, 50].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Prévia');
    XLSX.writeFile(wb, `previa_lote_${tipo}_${compLote}.xlsx`);
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
        <Campo rotulo="Emissão"><input className={entrada} type="date" value={emissao} onChange={e => { setEmissao(e.target.value); setLimite(dataLimite(e.target.value, ctx)); setVencimento(dataVencimento(e.target.value, ctx, tipo === 'OND')); }} aria-label="Data de emissão" /></Campo>
        <Campo rotulo={`Certificação SIPLAD (+${ctx.prazo} dias úteis)`}><input className={entrada} type="date" value={limite} onChange={e => { setLimite(e.target.value); if (tipo === 'OND') setVencimento(e.target.value); }} aria-label="Data-limite de certificação" /></Campo>
        <Campo rotulo={tipo === 'OND' ? 'Vencimento (OND = certificação)' : `Vencimento (+${ctx.prazoVencimento} dias corridos)`}><input className={entrada} type="date" value={vencimento} disabled={tipo === 'OND'} onChange={e => setVencimento(e.target.value)} aria-label="Vencimento" /></Campo>
        {tipo === 'OND' && (
          <Campo rotulo="Média JAN–AGO dividida por">
            <select className={entrada} value={divisor} onChange={e => setDivisor(e.target.value as any)}>
              <option value="PERIODO">8 meses (regra)</option><option value="MESES_FATURADOS">meses com fatura</option>
            </select>
          </Campo>
        )}
        {tipo !== 'ACERTO' && <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={abater} onChange={e => setAbater(e.target.checked)} /> Abater adiantamento disponível</label>}
        {tipo === 'MENSAL' && creditos.length > 0 && <label className="text-sm flex items-center gap-1.5 pb-2" title="Crédito que a OM tem (acerto do OND ou saldo de abertura): abate as faturas de qualquer serviço dela, do crédito mais antigo para o mais novo."><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={compensar} onChange={e => setCompensar(e.target.checked)} /> Compensar créditos da OM ({brl(creditos.reduce((s, c) => s + c.saldo, 0))})</label>}
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
          {tipo !== 'ACERTO' && adiant.length > 0 && (() => {
            const sobra = saldosRestantes(adiant, final);
            return sobra.length ? (
              <details className="p-2 rounded border border-slate-200 bg-white text-sm">
                <summary className="cursor-pointer"><b>{sobra.length}</b> ALTCRED com saldo de adiantamento que <b>não foi usado</b> neste lote (R$ {sobra.reduce((t, d) => t + d.restante, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}). Para usar em outra OM, abra a fatura (seta) e escolha a ALTCRED.</summary>
                <ul className="mt-1 text-xs space-y-0.5">{sobra.map(d => <li key={d.id}>{d.numero} — {d.cliente || d.comandoNome || d.ug} — saldo {brl(d.restante)}</li>)}</ul>
              </details>
            ) : null;
          })()}
          {outubro && (
            <div className="p-2 rounded border border-slate-200 bg-white text-sm space-y-1">
              <label className="flex items-center gap-2"><input type="checkbox" checked={vencFim} onChange={e => setVencFim(e.target.checked)} className="h-4 w-4 accent-primary-600" aria-label="Vencimento de fim de exercício" />
                <span>Vencimento de fim de exercício: as faturas de outubro vencem na data-limite de certificação (<b>{br(limite)}</b>) em vez de emissão + {ctx.prazoVencimento} dias.</span></label>
              <label className={`flex items-center gap-2 pl-6 ${vencFim ? '' : 'opacity-50'}`}><input type="checkbox" checked={vencFimNaoOnd} disabled={!vencFim} onChange={e => setVencFimNaoOnd(e.target.checked)} className="h-4 w-4 accent-primary-600" aria-label="Também nas faturas que não são OND" />
                <span>Aplicar também às faturas que <b>não são OND</b> ({final.filter(i => !i.ond).length} no lote{final.some(i => !i.ond) ? `: ${[...new Set(final.filter(i => !i.ond).map(i => i.sigla))].join(', ')}` : ''}). Desmarque para que essas vençam em {br(vencimento)}.</span></label>
            </div>
          )}
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
                      <tr className={i.bloqueio ? 'bg-red-50' : i.avisos.length ? 'bg-amber-50/50' : ''}>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <input type="checkbox" checked aria-label={`Incluir ${i.numero}`} onChange={() => setFora(p => new Set(p).add(i.chave))} className="h-4 w-4 accent-primary-600 mr-1" />
                          <button onClick={() => alternar(i.chave)} className="text-slate-400 align-middle" aria-label="Ver base de cálculo">{aberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
                        </td>
                        <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">{i.numero}{i.avisos.length > 0 && <AlertTriangle size={12} className={`inline ml-1 ${i.bloqueio ? 'text-red-600' : 'text-amber-600'}`} />}{i.bloqueio && <span className="ml-1 text-[10px] font-sans font-bold text-red-700">BLOQUEADA</span>}</td>
                        <td className="px-2 py-1.5 max-w-[240px]"><div className="truncate" title={i.om.nome}>{i.om.nome}</div><div className="text-[11px] text-slate-500 truncate">{i.servico}</div></td>
                        <td className="px-2 py-1.5 text-xs whitespace-nowrap">{textoConsumo(i)}</td>
                        <td className="px-2 py-1.5 text-right">
                          {tipo === 'ACERTO' ? <span className="tabular-nums">{brl(i.valor)}</span> : (
                            <input type="number" step="0.01" aria-label={`Valor de ${i.numero}`} disabled={!podeEditar}
                              className={`w-32 text-right border rounded px-1 py-0.5 tabular-nums ${ajustes[i.chave] !== undefined ? 'border-primary-400 bg-primary-50' : 'border-slate-200'}`}
                              value={ajustes[i.chave] ?? i.valor} onChange={e => setAjustes({ ...ajustes, [i.chave]: Math.round((Number(e.target.value) || 0) * 100) / 100 })} />
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-orange-700" title={(i.adiantamentos || []).map(a => `${a.numero}: ${brl(a.valor)}`).join('\n')}>{ad ? brl(ad) : '-'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-xs" title={i.acertoDe ? 'Linha 04: estimado já faturado' : (i.creditos || []).length ? 'Linha 04: crédito de acerto compensado' : undefined}>{i.acrescimo ? `+${brl(i.acrescimo)}` : i.debito ? `−${brl(i.debito)}` : '-'}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${i.valor - ad + i.acrescimo - i.debito < 0 ? 'text-emerald-700' : ''}`} title={i.valor - ad + i.acrescimo - i.debito < 0 ? 'Valor negativo = crédito da OM' : undefined}>{brl(i.valor - ad + i.acrescimo - i.debito)}</td>
                      </tr>
                      {aberto && (
                        <tr className="bg-slate-50 text-xs text-slate-600"><td></td><td colSpan={7} className="px-2 py-2">
                          <div><b>Base de cálculo:</b> {String(i.base.regra)}</div>
                          {descreverBase(i.base, i.sigla).map(l => <div key={l}>{l}</div>)}
                          {(i.adiantamentos || []).map(a => (
                            <div key={a.docId}>Baixa na ALTCRED {a.numero}: {brl(a.valor)}{a.manual && <span className="text-primary-700"> (escolhida à mão)</span>}
                              {a.manual && podeEditar && <button type="button" className="ml-2 text-red-700 underline" onClick={() => setManuais(p => ({ ...p, [i.chave]: (p[i.chave] || []).filter(m => m.docId !== a.docId) }))}>remover</button>}</div>
                          ))}
                          {podeEditar && tipo !== 'ACERTO' && <AbaterManual item={i} docs={saldosRestantes(adiant, final)} onAplicar={(docId, valor) => setManuais(p => ({ ...p, [i.chave]: [...(p[i.chave] || []).filter(m => m.docId !== docId), { docId, valor }] }))} />}
                          {(i.creditos || []).map(c => <div key={c.chave} className="text-orange-700">Compensação do crédito do acerto nº {c.numero}: {brl(c.valor)} (linha 04)</div>)}
                          {i.acertoDe && (i.base as any).tipo !== 'CORRECAO' && (
                            <div className={Number((i.base as any).credito) > 0 ? 'text-emerald-700 font-semibold' : ''}>
                              Consumo real {brl(i.valor)}; estimado já faturado {brl(Number((i.base as any).estimado) || i.debito)}; débito na linha 04: {brl(i.debito)}. {Number((i.base as any).credito) > 0 ? `Total a pagar R$ 0,00 — a diferença de ${brl(Number((i.base as any).credito))} é crédito da OM.` : `Diferença a pagar: ${brl(i.valor - i.debito)}.`}
                            </div>
                          )}
                          {i.avisos.map(a => <div key={a} className="text-amber-700">{a}</div>)}
                          {i.bloqueio && (
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-red-700 font-semibold" role="alert">Bloqueado: {i.bloqueio}.
                              {podeEditar && ((i.base as any).mesesFaltantes || []).length > 0 && <Button size="sm" variant="secondary" isLoading={marcando} onClick={() => marcarFaltantes([i])}>Marcar meses sem movimento</Button>}
                              <button className="underline font-normal" onClick={() => setFora(p => new Set(p).add(i.chave))}>ou tirar do lote</button>
                            </div>
                          )}
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {!final.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Nada a faturar com esses dados. Lance as medições, o mapa de atracação e os preços do ano.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2"><Button size="sm" variant="secondary" onClick={previaPdf} isLoading={gerandoPdf} disabled={!final.length}><FileText size={14} className="mr-1" />Prévia em PDF ({final.length})</Button><Button size="sm" variant="secondary" onClick={exportarPrevia} disabled={!final.length}><FileSpreadsheet size={14} className="mr-1" />Prévia em Excel ({final.length})</Button></div>
          {fora.size > 0 && <p className="text-xs text-slate-500">{fora.size} fatura(s) retirada(s) da prévia. <button className="text-primary-700 underline" onClick={() => setFora(new Set())}>Recolocar</button></p>}
          {podeEditar && bloqueados.length > 0 && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800 flex flex-wrap items-center gap-3" role="alert">
              <span className="flex-1"><b>{bloqueados.length}</b> fatura(s) bloqueada(s): faltam dados. Marque os meses sem movimento, lance o que falta ou tire-as do lote para poder emitir.</span>
              {bloqueados.some(i => ((i.base as any).mesesFaltantes || []).length) && <Button size="sm" variant="secondary" isLoading={marcando} onClick={() => marcarFaltantes(bloqueados)}>Marcar todos como sem movimento</Button>}
            </div>
          )}
          {podeEditar && tipo === 'ACERTO' && soSemDiferenca.length > 0 && (
            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-sm flex flex-wrap items-center gap-3">
              <span className="flex-1"><b>{soSemDiferenca.length}</b> OM/serviço(s) sem diferença: não geram fatura. Registre a apuração para constar como concluída.</span>
              <Button size="sm" variant="secondary" isLoading={marcando} onClick={registrarSemDiferenca}>Registrar apuração sem diferença</Button>
            </div>
          )}
          {podeEditar && final.length > 0 && bloqueados.length === 0 && (
            <div className="p-3 rounded-lg border border-primary-200 bg-primary-50/50 flex flex-wrap items-center gap-3">
              <span className="text-sm text-slate-700 flex-1">Emitir <b>{final.length}</b> faturas de {referencia(compLote)} com emissão em <b>{br(emissao)}</b>, certificação no SIPLAD até <b>{br(limite)}</b> e vencimento em <b>{br(tipo === 'OND' ? limite : vencimento)}</b>{outubro && final.some(i => i.venceNaLimite) ? <> (<b>{final.filter(i => i.venceNaLimite).length}</b> de {final.length} vencem na data-limite, {br(limite)}, pelo fim do exercício)</> : null}. A numeração segue a ordem acima, sem lacunas.</span>
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

/** Escolha à mão da ALTCRED que abate esta fatura (inclusive de outro comando, com aviso). */
const AbaterManual: React.FC<{ item: ItemLote; docs: (DocAdiantDisp & { restante: number })[]; onAplicar: (docId: string, valor: number) => void }> = ({ item, docs, onAplicar }) => {
  const [docId, setDocId] = useState('');
  const [valor, setValor] = useState('');
  const resta = Math.round((item.valor + item.acrescimo - item.debito - (item.adiantamentos || []).reduce((s, a) => s + a.valor, 0)) * 100) / 100;
  if (resta <= 0.005) return null;
  const d = docs.find(x => x.id === docId);
  const outro = !!d && !adiantamentoDoCliente(item.om, d);
  const max = d ? Math.round(Math.min(d.restante, resta) * 100) / 100 : 0;
  return (
    <div className="mt-1 p-2 rounded border border-slate-200 bg-white flex flex-wrap items-center gap-2" data-testid="abater-manual">
      <span className="font-semibold">Abater adiantamento:</span>
      <select className="border border-slate-300 rounded px-1 py-0.5 max-w-[360px]" value={docId} aria-label={`ALTCRED para ${item.numero}`} onChange={e => { setDocId(e.target.value); const x = docs.find(y => y.id === e.target.value); setValor(x ? String(Math.min(x.restante, resta)) : ''); }}>
        <option value="">— escolher ALTCRED com saldo —</option>
        {docs.map(x => <option key={x.id} value={x.id}>{x.numero} · {x.cliente || x.comandoNome || x.ug} · saldo {brl(x.restante)}{adiantamentoDoCliente(item.om, x) ? '' : ' · OUTRO COMANDO'}</option>)}
      </select>
      <input type="number" step="0.01" min="0" max={max || undefined} className="w-28 text-right border border-slate-300 rounded px-1 py-0.5" value={valor} aria-label={`Valor a abater em ${item.numero}`} onChange={e => setValor(e.target.value)} />
      <button type="button" disabled={!d || !(Number(valor) > 0)} className="px-2 py-0.5 rounded bg-primary-600 text-white disabled:opacity-40" onClick={() => { onAplicar(docId, Math.min(Number(valor), max)); setDocId(''); setValor(''); }}>Aplicar</button>
      {outro && <span className="text-amber-700">Atenção: esta ALTCRED não é do mesmo comando/UG desta OM. Só use se a OM autorizou (fica registrado na baixa).</span>}
      <span className="text-slate-500">falta abater {brl(resta)}</span>
    </div>
  );
};
