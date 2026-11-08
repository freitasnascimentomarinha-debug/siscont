import { numeroDigitado } from '../../utils/numeroDigitado';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BaixarModelo } from '../ui/BaixarModelo';
import { modeloHistorico, modeloSubsidios } from '../../utils/modelos';
import { Download, FileUp, Plus, Save, Trash2 } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { FichaRubrica } from './FichaRubrica';
import { Button } from '../ui/Button';
import { Aviso, Campo, brl, entrada, lerArquivo } from '../faturamento/comum';
import { notify } from '../../utils/notify';
import {
  DadosProposta, Destino, Lotacao, Pendente, RubricaProposta, diasDoBnic35, entraNaTaxa, salvarProposta, excluirDesconto, importarSubsidios, linkAnexo, excluirPendente, resolverPendente, salvarAtracacaoAnual, salvarDesconto,
  salvarLotacoes, salvarMatriz, salvarRubricasProposta,
} from '../../services/taxaCondominialService';
import { AREAS_CNIC, OM } from '../../types';
import { ClienteModal } from './ClienteModal';
import { AnoClasse, BaseNavios, CRITERIOS, Criterio, Desconto, MediaClasse, NAVIOS_MODOS, NaviosModo, PorRubrica, ResultadoRateio, mediaTrienal, naviosAtivos, naviosModoDe, parteNavios, valorVigente } from '../../utils/taxaCondominial';
import { acharPorNome, lerAbas, lerHistorico, lerSubsidios } from '../../utils/taxaCondominialImport';

// lê "23,65", "23.65" (valor vindo do banco) e "1.234,56": antes "23.65" virava 2365
const n2 = (v: string) => numeroDigitado(v);
const fmt = (v: number | null | undefined, casas = 2) => (v === null || v === undefined ? '' : String(Math.round(v * 10 ** casas) / 10 ** casas));
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

interface AbaProps { ano: number; dados: DadosProposta; podeEditar: boolean; recarregar: () => void }

// ================================================================== Rubricas
const TITULO_GRUPO: Record<'TC' | 'OG' | 'DA' | 'PAR', { titulo: string; ajuda: string }> = {
  TC: { titulo: 'Rubricas da taxa condominial', ajuda: 'Rubricas 1 a 33. "Critério" e "% OM" dizem como a parte das OM é dividida; "Rateio" = só as OM marcadas na matriz ou todas as OM da taxa; "Navios" = quanto da rubrica vai para o total dos navios (sobre o valor sugerido, sem os descontos das OM e sem diminuir a parte das OM). Detalhes na Ficha.' },
  OG: { titulo: 'Outros gastos — incorporados à taxa', ajuda: 'Não são rubricas (na planilha, 34 a 37), mas o valor entra no total rateado entre as OM da taxa. Em "Entra como" é possível tirar a linha da taxa (fora da taxa) ou transformá-la em rubrica; em "Rateio", ratear entre todas as OM ou só pela matriz.' },
  DA: { titulo: 'Total dos navios — diárias de atracação', ajuda: 'Soma das partes dos navios de cada linha (coluna "Navios"). Esse total é dividido entre os navios pela lotação × dias atracados e vira a diária de cada um.' },
  PAR: { titulo: 'Fora da taxa', ajuda: 'Linhas que não entram na taxa condominial nem nas diárias (só referência / PAR). Mude "Entra como" para incluí-las.' },
};

export const AbaRubricas: React.FC<AbaProps & { descontosPorOM: Map<number, number>; porRubrica: PorRubrica[]; usuario: string }> = ({ ano, dados, podeEditar, recarregar, descontosPorOM, porRubrica, usuario }) => {
  const [linhas, setLinhas] = useState<RubricaProposta[]>(dados.rubricas);
  const [sujo, setSujo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [ficha, setFicha] = useState<number | null>(null);
  const [importando, setImportando] = useState(false);
  // valor da linha usado para os navios: o valor sugerido (previsto) — padrão — ou o sugerido − desconto geral
  const [baseNavios, setBaseNavios] = useState<BaseNavios>(dados.proposta.baseNavios || 'PREVISTO');
  useEffect(() => { if (!sujo) setBaseNavios(dados.proposta.baseNavios || 'PREVISTO'); }, [dados]);
  const refSub = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!sujo) setLinhas(dados.rubricas); }, [dados]);
  const mudar = (i: number, p: Partial<RubricaProposta>) => { setSujo(true); setLinhas(ls => ls.map((l, k) => (k === i ? { ...l, ...p } : l))); };
  const erros = useMemo(() => {
    const e: string[] = [];
    const nums = linhas.map(l => l.numero);
    if (new Set(nums).size !== nums.length) e.push('Há rubricas com o mesmo número.');
    linhas.forEach(l => {
      if (!l.descricao.trim()) e.push(`Rubrica ${l.numero}: falta a descrição.`);
      if (l.descontoGeral > l.valorPrevisto) e.push(`Rubrica ${l.numero}: o desconto geral é maior que o valor previsto.`);
      if (l.descontoGeral > 0 && !l.justificativa?.trim()) e.push(`Rubrica ${l.numero}: informe o motivo do desconto geral (abra a ficha).`);
    });
    return e;
  }, [linhas]);
  const subDe = (n: number) => dados.subsidios.filter(x => x.rubrica === n);
  const anxDe = (n: number) => dados.anexos.filter(x => x.rubrica === n);
  const tc = linhas.map((l, i) => ({ l, i })).filter(x => x.l.destino === 'TC').sort((a, b) => a.l.numero - b.l.numero);
  const og = linhas.map((l, i) => ({ l, i })).filter(x => x.l.destino === 'OG').sort((a, b) => a.l.numero - b.l.numero);
  const par = linhas.map((l, i) => ({ l, i })).filter(x => x.l.destino === 'PAR').sort((a, b) => a.l.numero - b.l.numero);
  const da = linhas.map((l, i) => ({ l, i })).filter(x => x.l.destino === 'DA');
  const totalTC = tc.reduce((s, x) => s + x.l.valorPrevisto, 0);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // valores do rateio (calculados com o que está na tela: critério, % OM e parte dos navios)
  const calc = (l: RubricaProposta) => {
    const porOM = descontosPorOM.get(l.numero) || 0;
    const vig = Math.max(0, l.valorPrevisto - l.descontoGeral);
    const navios = entraNaTaxa(l) ? parteNavios(l, baseNavios) : 0;
    const baseOM = r2(vig * (l.percentualOM ?? 100) / 100);
    const atualizado = r2(baseOM - porOM);
    const descontos = r2(l.descontoGeral + porOM);
    return { porOM, descontos, atualizado, navios, rub: totalTC ? (l.valorPrevisto / totalTC) * 100 : 0,
      variacao: l.gastoAnterior ? Math.round(((l.valorPrevisto - l.gastoAnterior) / l.gastoAnterior) * 10000) / 100 : null,
      // a coluna DESCONTOS da planilha = tudo o que as OM deixam de pagar (descontos + parte não rateada entre as OM)
      confere: l.descontoPlanilha == null ? null : Math.abs(l.descontoPlanilha - (l.valorPrevisto - atualizado)) < 0.05 };
  };
  const somar = (xs: { l: RubricaProposta }[]) => xs.reduce((t, { l }) => { const c = calc(l); return { prev: t.prev + l.valorPrevisto, ant: t.ant + (l.gastoAnterior || 0), desc: t.desc + c.descontos, atu: t.atu + c.atualizado, nav: t.nav + c.navios }; }, { prev: 0, ant: 0, desc: 0, atu: 0, nav: 0 });
  const tTC = somar(tc), tOG = somar(og), tPAR = somar(par);
  const somaNavios = r2(tTC.nav + tOG.nav);
  const linhaDA = da[0]?.l;
  const referenciaNavios = dados.proposta.naviosPlanilha ?? linhaDA?.valorPrevisto ?? null;
  const valorDA = somaNavios;
  const divergentes = tc.filter(x => calc(x.l).confere === false).map(x => x.l.numero);

  const gravar = async () => {
    setGravando(true);
    try {
      await salvarRubricasProposta(ano, linhas);
      if (baseNavios !== (dados.proposta.baseNavios || 'PREVISTO')) await salvarProposta({ ...dados.proposta, ano, baseNavios });
      setSujo(false); notify.success('Rubricas gravadas.'); recarregar();
    } catch (e) { notify.fail('Erro ao gravar rubricas', e); throw e; } finally { setGravando(false); }
  };
  const importarSub = async (f?: File) => {
    if (!f) return;
    setImportando(true);
    try {
      const r = lerSubsidios(lerAbas(await lerArquivo(f)));
      const validas = new Set(linhas.map(l => l.numero));
      const fora = r.subsidios.filter(s => !validas.has(s.rubrica));
      await importarSubsidios(ano, r.subsidios.filter(s => validas.has(s.rubrica)).map(s => ({ ...s, criadoPor: usuario })));
      if (r.justificativas.length) {
        const j = new Map(r.justificativas.map(x => [x.rubrica, x.texto]));
        await salvarRubricasProposta(ano, linhas.filter(l => j.has(l.numero)).map(l => ({ ...l, justificativaValor: j.get(l.numero)! })));
      }
      notify.success(`${r.subsidios.length - fora.length} subsídio(s) e ${r.justificativas.length} justificativa(s) importados.${fora.length ? ` ${fora.length} linha(s) de rubrica inexistente ignoradas.` : ''}`);
      r.avisos.forEach(a => notify.error(a));
      setSujo(false); recarregar();
    } catch (e) { notify.fail('Erro ao importar subsídios', e); } finally { setImportando(false); if (refSub.current) refSub.current.value = ''; }
  };

  const th = 'px-2 py-2 font-semibold';
  const situacao = (l: RubricaProposta) => {
    const sb = subDe(l.numero), ax = anxDe(l.numero);
    const soma = sb.reduce((s, x) => s + x.valor, 0);
    return (
      <span className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
        <span title={l.justificativaValor || 'sem justificativa do valor'} className={l.justificativaValor?.trim() ? 'text-emerald-700' : 'text-slate-300'}>{l.justificativaValor?.trim() ? '✍ ok' : '✍ —'}</span>
        <span title={`${sb.length} subsídio(s), soma ${brl(soma)}`} className={sb.length ? (Math.abs(soma - l.valorPrevisto) < 0.01 ? 'text-emerald-700' : 'text-slate-600') : 'text-slate-300'}>Σ {sb.length}</span>
        <span title={`${ax.length} documento(s)`} className={ax.length ? 'text-emerald-700' : 'text-slate-300'}>📎 {ax.length}</span>
      </span>
    );
  };
  const linhaTabela = ({ l, i }: { l: RubricaProposta; i: number }, mostrarNavios: boolean) => {
    const c = calc(l);
    const modo = naviosModoDe(l);
    return (
      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/60">
        <td className="px-2 text-center text-slate-600">{l.numero}</td>
        <td className="px-1"><select disabled={!podeEditar} className={`${entrada} text-xs w-24`} value={l.destino} onChange={e => mudar(i, { destino: e.target.value as Destino, ...(e.target.value === 'OG' && l.destino !== 'OG' ? { rateioTodas: true } : {}) })} aria-label={`Entra como (linha ${l.numero})`} title="Rubrica da taxa, outros gastos (entra na taxa) ou fora da taxa">
          <option value="TC">Rubrica</option><option value="OG">Outros gastos</option><option value="PAR">Fora da taxa</option></select></td>
        <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-56 text-xs`} value={l.descricao} onChange={e => mudar(i, { descricao: e.target.value })} aria-label={`Descrição da rubrica ${l.numero}`} title={l.contaContabil ? `Conta contábil ${l.contaContabil}` : undefined} /></td>
        <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-28 text-xs text-right`} inputMode="decimal" value={fmt(l.valorPrevisto)} onChange={e => mudar(i, { valorPrevisto: n2(e.target.value) ?? 0 })} aria-label={`Valor previsto da rubrica ${l.numero}`} /></td>
        <td className="px-2 text-right text-slate-600">{mostrarNavios ? pct(Math.round(c.rub * 100) / 100) : ''}</td>
        <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-28 text-xs text-right`} inputMode="decimal" value={fmt(l.gastoAnterior)} onChange={e => mudar(i, { gastoAnterior: n2(e.target.value) })} aria-label={`Gasto anterior da rubrica ${l.numero}`} /></td>
        <td className={`px-2 text-right ${c.variacao !== null && c.variacao > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{pct(c.variacao)}</td>
        <td className="px-2 text-right whitespace-nowrap" title={c.porOM ? `geral ${brl(l.descontoGeral)} + por OM ${brl(c.porOM)}` : l.justificativa || undefined}>{mostrarNavios ? (c.descontos ? brl(c.descontos) : '—') : ''}{mostrarNavios && c.confere !== null && (c.confere ? <span className="text-emerald-700 ml-1" title="confere com a planilha">✓</span> : <span className="text-amber-700 ml-1 cursor-help" title={`Planilha: ${brl(l.descontoPlanilha || 0)}`}>⚠</span>)}</td>
        <td className="px-2 text-right font-semibold whitespace-nowrap">{mostrarNavios ? brl(c.atualizado) : brl(l.valorPrevisto)}</td>
        <td className="px-1">{mostrarNavios && <select disabled={!podeEditar} className={`${entrada} text-xs w-24`} value={l.criterio || 'LOTACAO'} onChange={e => mudar(i, { criterio: e.target.value as Criterio })} aria-label={`Critério da rubrica ${l.numero}`} title={CRITERIOS[l.criterio || 'LOTACAO']}>
          <option value="LOTACAO">Pessoa</option><option value="AREA">Área</option><option value="IGUAL">Iguais</option><option value="PESO">Peso</option></select>}</td>
        <td className="px-1">{mostrarNavios && <input disabled={!podeEditar} className={`${entrada} w-14 text-xs text-right`} inputMode="decimal" value={fmt(l.percentualOM ?? 100)} onChange={e => mudar(i, { percentualOM: Math.min(100, Math.max(0, n2(e.target.value) ?? 0)) })} aria-label={`Percentual das OM na rubrica ${l.numero}`} title="% do valor dividido entre as OM (100 = integral)" />}</td>
        <td className="px-1">{mostrarNavios && <select disabled={!podeEditar} className={`${entrada} text-xs w-20`} value={l.rateioTodas ? 'TODAS' : 'MATRIZ'} onChange={e => mudar(i, { rateioTodas: e.target.value === 'TODAS' })} aria-label={`Rateio da linha ${l.numero}`} title="Matriz = só as OM marcadas na matriz; Todas = todas as OM da taxa">
          <option value="MATRIZ">Matriz</option><option value="TODAS">Todas</option></select>}</td>
        <td className="px-1">{mostrarNavios && <span className="flex items-center gap-1 whitespace-nowrap">
          <select disabled={!podeEditar} className={`${entrada} text-xs w-24`} value={modo} onChange={e => mudar(i, { naviosModo: e.target.value as NaviosModo, ...(e.target.value === 'PERCENTUAL' && !(l.percentualNavios ?? 0) ? { percentualNavios: 100 } : {}) })} aria-label={`Navios na linha ${l.numero}`} title="Quanto desta linha vai para o total dos navios (sem os descontos das OM)">
            {(Object.keys(NAVIOS_MODOS) as NaviosModo[]).map(k => <option key={k} value={k}>{NAVIOS_MODOS[k]}</option>)}</select>
          {modo === 'PERCENTUAL' && <input disabled={!podeEditar} className={`${entrada} w-14 text-xs text-right`} inputMode="decimal" value={fmt(l.percentualNavios ?? 0)} onChange={e => mudar(i, { percentualNavios: Math.min(100, Math.max(0, n2(e.target.value) ?? 0)) })} aria-label={`Percentual dos navios na linha ${l.numero}`} title="% do valor da linha" />}
          {modo === 'FIXO' && <input disabled={!podeEditar} className={`${entrada} w-24 text-xs text-right`} inputMode="decimal" value={fmt(l.valorNavios ?? 0)} onChange={e => mudar(i, { valorNavios: Math.max(0, n2(e.target.value) ?? 0) })} aria-label={`Valor fixo dos navios na linha ${l.numero}`} />}
          <span className="text-slate-500">{c.navios ? brl(c.navios) : ''}</span></span>}</td>
        <td className="px-2">{situacao(l)}</td>
        <td className="px-1 whitespace-nowrap">
          <Button size="sm" variant="secondary" onClick={() => setFicha(i)} aria-label={`Ficha da rubrica ${l.numero}`}>Ficha</Button>
          {podeEditar && <button aria-label={`Excluir rubrica ${l.numero}`} className="text-slate-400 hover:text-red-600 ml-1" onClick={() => { if (window.confirm(`Excluir a rubrica ${l.numero}?`)) { setSujo(true); setLinhas(ls => ls.filter((_, k) => k !== i)); } }}><Trash2 size={14} /></button>}
        </td>
      </tr>
    );
  };
  const cabecalho = (navios: boolean) => (
    <thead className="bg-slate-50 text-slate-600"><tr>
      <th className={th}>Nº</th><th className={`${th} text-left`} title="Rubrica da taxa, outros gastos (entra na taxa) ou fora da taxa">Entra como</th><th className={`${th} text-left`}>Despesa</th><th className={`${th} text-right`}>Valor {ano} (R$)</th><th className={`${th} text-right`}>{navios ? '%RUB' : ''}</th>
      <th className={`${th} text-right`}>Valor {ano - 1} (R$)</th><th className={`${th} text-right`}>Variação</th><th className={`${th} text-right`}>{navios ? 'Descontos' : ''}</th>
      <th className={`${th} text-right`}>{navios ? 'Valor atualizado (OM)' : 'Valor'}</th><th className={`${th} text-left`} title="Como a parte das OM é dividida">{navios ? 'Critério' : ''}</th><th className={`${th} text-right`} title="% do valor dividido entre as OM">{navios ? '% OM' : ''}</th><th className={`${th} text-left`} title="Matriz = só as OM marcadas; Todas = todas as OM da taxa">{navios ? 'Rateio' : ''}</th><th className={`${th} text-left`} title="Quanto da linha vai para o total dos navios (sem os descontos das OM)">{navios ? 'Navios' : ''}</th><th className={`${th} text-left`} title="✍ justificativa do valor · Σ subsídios · 📎 documentos">Situação (opcional)</th><th></th>
    </tr></thead>
  );
  const rodape = (rot: string, t: ReturnType<typeof somar>, navios: boolean) => (
    <tfoot className="bg-slate-100 font-bold text-slate-800"><tr>
      <td colSpan={3} className="px-2 py-2">{rot}</td><td className="px-2 text-right">{brl(t.prev)}</td><td className="px-2 text-right">{navios ? '100%' : ''}</td>
      <td className="px-2 text-right">{brl(t.ant)}</td><td className="px-2 text-right">{t.ant ? pct(Math.round(((t.prev - t.ant) / t.ant) * 10000) / 100) : '—'}</td>
      <td className="px-2 text-right">{navios ? brl(t.desc) : ''}</td><td className="px-2 text-right">{navios ? brl(t.atu) : brl(t.prev)}</td><td colSpan={3}></td><td className="px-2">{navios ? brl(t.nav) : ''}</td><td colSpan={2}></td>
    </tr></tfoot>
  );
  const bloco = (g: 'TC' | 'OG' | 'DA' | 'PAR', children: React.ReactNode) => (
    <section className="space-y-1">
      <h4 className="font-bold text-slate-800">{TITULO_GRUPO[g].titulo}</h4>
      <p className="text-xs text-slate-500">{TITULO_GRUPO[g].ajuda}</p>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">{children}</div>
    </section>
  );
  const fi = ficha !== null ? linhas[ficha] : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
        <span className="flex-1 min-w-[260px]">Os valores podem ser digitados direto na tabela. Na <b>Ficha</b> de cada rubrica é possível (opcional) registrar <b>por que</b> o valor é esse, <b>como foi formado</b> e <b>anexar contratos</b>.</span>
        {podeEditar && <>
          <input ref={refSub} type="file" accept=".xlsx,.xls,.ods" className="hidden" aria-label="Planilha de subsídios" onChange={e => importarSub(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" isLoading={importando} onClick={() => refSub.current?.click()}><FileUp size={14} className="mr-1" />Importar subsídios</Button>
          <BaixarModelo modelo={() => modeloSubsidios(ano, linhas.filter(l => l.destino !== 'DA').map(l => ({ numero: l.numero, descricao: l.descricao })))} />
        </>}
        <Button size="sm" variant="secondary" onClick={() => exportarSubsidios(ano, linhas, dados, descontosPorOM).catch(e => notify.fail('Erro ao exportar', e))}><Download size={14} className="mr-1" />Pacote de subsídios (ZIP)</Button>
      </div>
      {erros.length > 0 && <Aviso tom="red">{erros.map(e => <div key={e}>{e}</div>)}</Aviso>}
      {divergentes.length > 0 && <Aviso>Descontos diferentes da planilha importada nas rubricas {divergentes.join(', ')} (passe o mouse no ⚠).</Aviso>}

      {bloco('TC', <table className="w-full text-xs">{cabecalho(true)}<tbody>{tc.map(x => linhaTabela(x, true))}</tbody>{rodape(`SOMA DAS ${tc.length} RUBRICAS DA TAXA`, tTC, true)}</table>)}

      {og.length > 0 && bloco('OG', <table className="w-full text-xs">{cabecalho(true)}<tbody>{og.map(x => linhaTabela(x, true))}</tbody>{rodape(`SOMA DOS ${og.length} OUTROS GASTOS`, tOG, true)}</table>)}

      {bloco('DA', <div className="p-3 text-xs space-y-1">
        <div className="flex flex-wrap gap-x-6 gap-y-1 items-baseline">
          <label className="flex items-center gap-1.5">Valor da linha para os navios:
            <select disabled={!podeEditar} className={`${entrada} text-xs`} value={baseNavios} onChange={e => { setSujo(true); setBaseNavios(e.target.value as BaseNavios); }} aria-label="Base do valor dos navios">
              <option value="PREVISTO">valor sugerido</option><option value="VIGENTE">valor sugerido − desconto geral</option></select></label>
          <span>Linhas de que os navios participam: <b>{[...tc, ...og].filter(x => calc(x.l).navios > 0).map(x => `${x.l.numero} (${NAVIOS_MODOS[naviosModoDe(x.l)].toLowerCase()}${naviosModoDe(x.l) === 'PERCENTUAL' ? ` ${fmt(x.l.percentualNavios ?? 0)}%` : ''})`).join(', ') || 'nenhuma'}</b></span>
          <span className="ml-auto">Total dos navios: <b className="text-base">{brl(valorDA)}</b>
            {referenciaNavios != null && (Math.abs(referenciaNavios - valorDA) < 0.01 ? <span className="text-emerald-700 ml-1" title="confere com o grupo Navios da planilha">✓</span> : <span className="text-amber-700 ml-1" title={`Planilha: ${brl(referenciaNavios)}`}>⚠ planilha {brl(referenciaNavios)}</span>)}
          </span>
        </div>
        <p className="text-slate-500">Para incluir ou tirar os navios de uma linha, use a coluna "Navios" acima ou a coluna NAVIOS da aba Clientes e matriz. A parte dos navios não diminui o que as OM pagam.</p>
      </div>)}

      {par.length > 0 && bloco('PAR', <table className="w-full text-xs">{cabecalho(false)}<tbody>{par.map(x => linhaTabela(x, false))}</tbody>{rodape('SOMA FORA DA TAXA', tPAR, false)}</table>)}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-xl border border-slate-300 bg-white text-sm" aria-label="Resumo da proposta">
        <div><div className="text-xs text-slate-500">Taxas condominiais (rubricas)</div><b className="tabular-nums">{brl(tTC.atu)}</b></div>
        <div><div className="text-xs text-slate-500">Outros gastos</div><b className="tabular-nums">{brl(tOG.atu)}</b></div>
        <div><div className="text-xs text-slate-500">Total dos navios (diárias)</div><b className="tabular-nums">{brl(valorDA)}</b></div>
        <div className="md:text-right"><div className="text-xs text-slate-500">Total</div><b className="text-base tabular-nums">{brl(tTC.atu + tOG.atu + valorDA)}</b></div>
        {par.length > 0 && <div className="col-span-2 md:col-span-4 text-xs text-slate-500">Fora da taxa (não entra no total): {brl(tPAR.prev)}.</div>}
      </div>

      {podeEditar && <div className="flex gap-2">
        <Button variant="secondary" onClick={() => { setSujo(true); setLinhas(ls => [...ls, { numero: Math.max(0, ...ls.filter(l => l.destino === 'TC').map(l => l.numero)) + 1, descricao: '', valorPrevisto: 0, descontoGeral: 0, destino: 'TC' }]); }}><Plus size={16} className="mr-1" />Rubrica</Button>
        <Button onClick={() => gravar().catch(() => undefined)} isLoading={gravando} disabled={!sujo || erros.length > 0}><Save size={16} className="mr-1" />Gravar rubricas</Button>
        {sujo && <span className="text-xs text-amber-700 self-center">Alterações não gravadas.</span>}
      </div>}
      <FichaRubrica ano={ano} rubrica={fi} subsidios={fi ? subDe(fi.numero) : []} anexos={fi ? anxDe(fi.numero) : []} usuario={usuario} podeEditar={podeEditar}
        onMudar={p => mudar(ficha!, p)} onGravar={gravar} onFechar={() => setFicha(null)} recarregar={recarregar} />
    </div>
  );
};

/** Pacote para envio dos subsídios: planilha (rubricas, justificativas, composição, documentos) + os arquivos anexados. */
async function exportarSubsidios(ano: number, linhas: RubricaProposta[], dados: DadosProposta, descontosPorOM: Map<number, number>) {
  const JSZip = (await import('jszip')).default;
  const wb = XLSX.utils.book_new();
  const destino = { TC: 'Rubrica da taxa', OG: 'Outros gastos (taxa)', DA: 'Navios (diárias)', PAR: 'Fora da taxa' } as const;
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Nº', 'DESPESA', 'ONDE ENTRA', `VALOR ${ano}`, `VALOR ${ano - 1}`, 'DESCONTOS', 'VALOR ATUALIZADO', 'NAVIOS PAGAM', 'JUSTIFICATIVA DO VALOR', 'SUBSÍDIOS (SOMA)', 'Nº DOCUMENTOS'],
    ...linhas.slice().sort((a, b) => a.numero - b.numero).map(l => {
      const desc = l.descontoGeral + (descontosPorOM.get(l.numero) || 0);
      return [l.numero, l.descricao, destino[l.destino], l.valorPrevisto, l.gastoAnterior ?? '', desc, l.valorPrevisto - desc, l.parcelaNavios ?? '', l.justificativaValor || '',
        dados.subsidios.filter(s => s.rubrica === l.numero).reduce((s, x) => s + x.valor, 0), dados.anexos.filter(a => a.rubrica === l.numero).length];
    }),
  ]), 'RUBRICAS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['RUBRICA', 'DESCRIÇÃO', 'DOCUMENTO', 'VALOR', 'OBSERVAÇÃO'], ...dados.subsidios.slice().sort((a, b) => a.rubrica - b.rubrica).map(s => [s.rubrica, s.descricao, s.documento || '', s.valor, s.observacao || ''])]), 'SUBSÍDIOS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['RUBRICA', 'ARQUIVO', 'DESCRIÇÃO', 'ENVIADO POR', 'EM'], ...dados.anexos.map(a => [a.rubrica, a.nomeArquivo, a.descricao || '', a.enviadoPor || '', a.createdAt.slice(0, 10)])]), 'DOCUMENTOS');
  const zip = new JSZip();
  zip.file(`subsidios_taxa_condominial_${ano}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  for (const a of dados.anexos) {
    try { const r = await fetch(await linkAnexo(a.caminho)); zip.file(`documentos/rubrica_${String(a.rubrica).padStart(2, '0')}/${a.nomeArquivo}`, await r.blob()); } catch { /* arquivo indisponível: fica só na lista */ }
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a'); el.href = url; el.download = `subsidios_taxa_condominial_${ano}.zip`; el.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ================================================================== Clientes (taxa condominial) e navios (diárias)
export const AbaClientes: React.FC<AbaProps & { modo: 'TERRA' | 'NAVIO'; medias: Map<string, number> }> = ({ ano, dados, podeEditar, recarregar, medias, modo }) => {
  type L = { lotacao: string; anterior: string; dias: string; area?: string; peso?: string };
  const navioModo = modo === 'NAVIO';
  const doModo = (o: OM) => (o.tipo === 'NAVIO') === navioModo;
  const inicial = () => {
    const m: Record<string, L> = {};
    dados.lotacoes.forEach(l => { m[l.omId] = { lotacao: String(l.lotacao), anterior: l.lotacaoAnterior === null ? '' : String(l.lotacaoAnterior), dias: l.dias === null ? '' : String(l.dias), area: l.area == null ? '' : String(l.area), peso: l.peso == null ? '' : String(l.peso) }; });
    return m;
  };
  const [lot, setLot] = useState<Record<string, L>>(inicial);
  // coluna NAVIOS da matriz: modo da parte dos navios em cada linha (Não entra = não participam)
  const navInicial = () => new Map(dados.rubricas.filter(entraNaTaxa).map(x => [x.numero, naviosModoDe(x)]));
  const [navModo, setNavModo] = useState<Map<number, NaviosModo>>(navInicial);
  const usaArea = dados.rubricas.some(x => entraNaTaxa(x) && x.criterio === 'AREA'), usaPeso = dados.rubricas.some(x => entraNaTaxa(x) && x.criterio === 'PESO');
  const [matriz, setMatriz] = useState<Set<string>>(new Set(dados.matriz));
  const [sujo, setSujo] = useState(false);
  const [busca, setBusca] = useState('');
  const [so, setSo] = useState(true);
  const [gravando, setGravando] = useState(false);
  const [incluir, setIncluir] = useState(false);
  const [resolver, setResolver] = useState<Pendente | null>(null);
  const [extras, setExtras] = useState<Set<string>>(new Set());
  useEffect(() => { if (!sujo) { setLot(inicial()); setMatriz(new Set(dados.matriz)); setNavModo(navInicial()); } }, [dados]);
  // colunas da matriz: linhas da taxa rateadas pela matriz (as "entre todas" não precisam de marcação)
  const rubs = dados.rubricas.filter(r => entraNaTaxa(r) && !r.rateioTodas).map(r => r.numero).sort((a, b) => a - b);
  const todasOM = dados.rubricas.filter(r => entraNaTaxa(r) && r.rateioTodas).sort((a, b) => a.numero - b.numero);
  const linhasNav = dados.rubricas.filter(entraNaTaxa).map(r => r.numero).sort((a, b) => a - b);
  const rubsDA = dados.rubricas.filter(r => r.destino === 'DA');
  const participa = (id: string) => (!navioModo && rubs.some(r => matriz.has(`${r}|${id}`))) || !!lot[id]?.lotacao || extras.has(id);
  const linhas = dados.oms.filter(doModo).filter(o => o.ativo || lot[o.id] || extras.has(o.id))
    .filter(o => !so || participa(o.id))
    .filter(o => !busca || `${o.nome} ${o.sigla || ''}`.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => Number(extras.has(b.id)) - Number(extras.has(a.id)) || a.nome.localeCompare(b.nome));
  const pendentes = dados.pendentes.filter(p => (p.tipo === 'NAVIO') === navioModo);
  const set = (id: string, p: Partial<L>) => { setSujo(true); setLot(m => ({ ...m, [id]: { lotacao: '', anterior: '', dias: '', ...m[id], ...p } })); };
  const marcar = (r: number, id: string, v: boolean) => { setSujo(true); setMatriz(s => { const n = new Set(s); v ? n.add(`${r}|${id}`) : n.delete(`${r}|${id}`); return n; }); };
  const coluna = (r: number) => { const todos = linhas.every(o => matriz.has(`${r}|${o.id}`)); linhas.forEach(o => marcar(r, o.id, !todos)); };
  const remover = (id: string) => { setSujo(true); setLot(m => { const n = { ...m }; delete n[id]; return n; }); setMatriz(s => new Set([...s].filter(k => !k.endsWith(`|${id}`)))); setExtras(e => { const n = new Set(e); n.delete(id); return n; }); };
  const semLotacao = navioModo ? [] : [...new Set([...matriz].map(k => k.split('|')[1]))].filter(id => { const o = dados.oms.find(x => x.id === id); return o && doModo(o) && !(Number(lot[id]?.lotacao) > 0); });
  const nomeDe = (id: string) => dados.oms.find(o => o.id === id)?.nome || id;

  const gravar = async () => {
    setGravando(true);
    try {
      const ls: Lotacao[] = Object.entries(lot).filter(([, v]) => Number(v.lotacao) > 0 || Number(n2(v.area || '')) > 0 || Number(n2(v.peso || '')) > 0)
        .map(([omId, v]) => ({ omId, lotacao: Number(v.lotacao) || 0, lotacaoAnterior: n2(v.anterior), dias: n2(v.dias), area: n2(v.area || ''), peso: n2(v.peso || '') }));
      const removidas = dados.lotacoes.map(l => l.omId).filter(id => !ls.some(l => l.omId === id));
      await salvarLotacoes(ano, ls, removidas);
      if (!navioModo) {
        await salvarMatriz(ano, matriz);
        const mudou = dados.rubricas.filter(x => entraNaTaxa(x) && (navModo.get(x.numero) ?? 'NAO') !== naviosModoDe(x));
        if (mudou.length) await salvarRubricasProposta(ano, mudou.map(x => ({ ...x, naviosModo: navModo.get(x.numero) ?? 'NAO' })));
      }
      setSujo(false); setExtras(new Set()); notify.success(navioModo ? 'Navios gravados.' : 'Clientes e matriz gravados.'); recarregar();
    } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };

  // linhas por área do CNIC (só para organizar a matriz); navios ficam na área 1 (parte baixa interna)
  const gruposArea = [1, 2, 3, 4, 5, 0].map(area => ({ area, oms: linhas.filter(o => (o.areaCnic || 0) === area) })).filter(g => g.oms.length || g.area === 1);
  const navRow = (

              <tr className="border-t border-slate-200 bg-sky-50/60">
                <td className="px-2 py-1 sticky left-0 bg-sky-50 font-semibold" title="Grupo de todos os navios: marque as despesas de que os navios participam">⚓ NAVIOS (grupo)</td>
                <td className="px-1 text-[10px] text-slate-500" colSpan={2 + (usaArea ? 1 : 0) + (usaPeso ? 1 : 0)}>lotação e dias na aba Navios</td>
                {rubs.map(r0 => { const m = navModo.get(r0) ?? 'NAO'; return (
                  <td key={r0} className="text-center"><input type="checkbox" disabled={!podeEditar} checked={m !== 'NAO'} title={m !== 'NAO' ? `navios participam (${NAVIOS_MODOS[m].toLowerCase()})` : 'navios não participam'}
                    onChange={e => { setSujo(true); setNavModo(mm => new Map(mm).set(r0, e.target.checked ? (naviosModoDe(dados.rubricas.find(x => x.numero === r0)!) !== 'NAO' ? naviosModoDe(dados.rubricas.find(x => x.numero === r0)!) : 'INTEGRAL') : 'NAO')); }} aria-label={`Navios participam da linha ${r0}`} /></td>
                ); })}
                <td className="px-2 text-[10px] text-slate-500 whitespace-nowrap">{todasOM.some(r => (navModo.get(r.numero) ?? 'NAO') !== 'NAO') ? `+ ${todasOM.filter(r => (navModo.get(r.numero) ?? 'NAO') !== 'NAO').map(r => r.numero).join(', ')} · ` : ''}modo na aba Rubricas</td>
              </tr>
            
  );
  return (
    <div className="space-y-3">
      {navioModo
        ? <p className="text-xs text-slate-500">Navios que pagam diária de atracação: lotação (TLA + DLA) e dias atracados por mês. Dias em branco = média trienal da classe (aba Média trienal). O valor rateado é o total dos navios: a parte dos navios de cada linha da taxa (coluna "Navios" da aba Rubricas ou coluna NAVIOS da matriz), sem os descontos das OM{rubsDA.length ? ` · total da planilha importada, para conferência: ${brl(valorVigente(rubsDA[0]))}` : ''}.</p>
        : <p className="text-xs text-slate-500">OM que pagam a taxa condominial, organizadas pela área do CNIC (cadastro da OM; navios ficam na parte baixa interna): lotação (TLA + DLA) e de quais linhas cada uma participa (X). Peso no rateio = lotação × 30 dias. Clique no número da linha para marcar/desmarcar a coluna inteira. A área (zona) só organiza a lista; a participação é marcada em cada OM.{todasOM.length ? ` Rateadas entre todas as OM da taxa (sem marcação): ${todasOM.map(r => `${r.numero} – ${r.descricao}`).join('; ')}.` : ''}</p>}
      {!navioModo && !rubs.length && <Aviso>Cadastre as rubricas primeiro (aba Rubricas ou "Importar proposta").</Aviso>}
      {navioModo && (() => { const sem = linhas.filter(o => !o.classeId && lot[o.id]?.lotacao); return sem.length ? <Aviso>{sem.length} navio(s) com lotação e <b>sem classe</b> ({sem.map(o => o.nome).join(', ')}): sem média trienal, a diária sai pela lotação. Ajuste a classe em <b>Cadastros › Lista de navios</b>.</Aviso> : null; })()}
      {semLotacao.length > 0 && <Aviso tom="red">Marcadas na matriz mas sem lotação (ficam fora do rateio): {semLotacao.map(nomeDe).join(', ')}.</Aviso>}
      {pendentes.length > 0 && (
        <Aviso>
          <b>{pendentes.length} nome(s) da planilha aguardando correspondente</b> — escolha o cliente do cadastro ou crie um novo; os dados (lotação{navioModo ? ', dias' : ', rubricas e descontos'}) entram automaticamente:
          <div className="mt-1 space-y-1">
            {pendentes.map(p => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-80 truncate" title={p.nome}><b>{p.nome}</b> · lotação {p.lotacao ?? '—'}{navioModo && p.dias != null ? ` · ${p.dias} dias` : ''}{!navioModo ? ` · ${p.rubricas.length} rubricas` : ''}{p.descontos.length ? ` · ${p.descontos.length} desconto(s)` : ''}</span>
                {podeEditar && <>
                  <Button size="sm" variant="secondary" onClick={() => setResolver(p)}>Escolher correspondente</Button>
                  <button className="text-slate-500 underline" onClick={async () => { if (window.confirm(`Descartar "${p.nome}"? Os dados dessa linha da planilha não entrarão no cálculo.`)) { try { await excluirPendente(p.id); recarregar(); } catch (e) { notify.fail('Erro', e); } } }}>descartar</button>
                </>}
              </div>
            ))}
          </div>
        </Aviso>
      )}
      <div className="flex flex-wrap gap-3 items-end">
        <Campo rotulo={navioModo ? 'Buscar navio' : 'Buscar OM'}><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} /></Campo>
        <label className="text-sm flex items-center gap-2 pb-1.5"><input type="checkbox" checked={so} onChange={e => setSo(e.target.checked)} /> só participantes</label>
        {podeEditar && <Button variant="secondary" onClick={() => setIncluir(true)}><Plus size={16} className="mr-1" />{navioModo ? 'Incluir navio' : 'Incluir cliente'}</Button>}
        {podeEditar && <Button onClick={gravar} isLoading={gravando} disabled={!sujo}><Save size={16} className="mr-1" />{navioModo ? 'Gravar navios' : 'Gravar clientes e matriz'}</Button>}
        {sujo && <span className="text-xs text-amber-700 pb-1.5">Alterações não gravadas.</span>}
      </div>
      <div className="overflow-auto border border-slate-200 rounded-lg max-h-[62vh]">
        <table className="text-xs">
          <thead className="bg-slate-50 sticky top-0 z-10"><tr>
            <th className="px-2 py-1 text-left sticky left-0 bg-slate-50 min-w-[240px]">{navioModo ? 'Navio' : 'OM'}</th><th className="px-1">Lotação</th><th className="px-1">Lot. ant.</th>
            {navioModo && <th className="px-1" title="Vazio = média trienal da classe">Dias/mês</th>}
            {!navioModo && usaArea && <th className="px-1" title="Área ocupada, para rubricas com critério por área">Área m²</th>}
            {!navioModo && usaPeso && <th className="px-1" title="Peso, para rubricas com critério por peso informado">Peso</th>}
            {!navioModo && rubs.map(r => <th key={r} className="w-6 text-center"><button disabled={!podeEditar} onClick={() => coluna(r)} title={dados.rubricas.find(x => x.numero === r)?.descricao} className="text-slate-600 hover:text-primary-700">{r}</button></th>)}
            <th></th>
          </tr></thead>
          <tbody>
            {(navioModo ? [{ area: 0, oms: linhas }] : gruposArea).map(g => (<React.Fragment key={g.area}>
              {!navioModo && <tr className="border-t-2 border-slate-300 bg-slate-100" aria-label={`Zona: ${g.area ? AREAS_CNIC[g.area] : 'sem área definida'}`}>
                {/* só zoneamento (área do CNIC no cadastro da OM): não marca participação */}
                <td className="px-2 py-1 sticky left-0 bg-slate-100 font-bold text-slate-700 whitespace-nowrap">📍 {g.area ? AREAS_CNIC[g.area] : 'Sem área definida no cadastro'} <span className="font-normal text-slate-500">({g.oms.length} OM)</span></td>
                <td colSpan={3 + (usaArea ? 1 : 0) + (usaPeso ? 1 : 0) + rubs.length} className="bg-slate-100"></td>
              </tr>}
              {!navioModo && g.area === 1 && rubs.length + linhasNav.length > 0 && navRow}
              {g.oms.map(o => {
              const v = lot[o.id] || { lotacao: '', anterior: '', dias: '' };
              const media = o.classeId ? medias.get(o.classeId) ?? 0 : 0;
              return (
                <tr key={o.id} className={`border-t border-slate-100 ${extras.has(o.id) ? 'bg-primary-50/50' : ''}`}>
                  <td className="px-2 py-0.5 sticky left-0 bg-white truncate max-w-[260px]" title={`${o.nome}${o.edificio ? ` — ${o.edificio}` : ''}`}>{o.nome}{!navioModo && o.edificio && <span className="text-slate-400"> · {o.edificio}</span>}{!o.ativo && <span className="text-slate-400"> · desativada</span>}{o.foraDaIlha && <span className="text-slate-400"> · fora da Ilha</span>}
                    {navioModo && (o.classeId ? <span className="block text-[10px] text-slate-500">{dados.classes.find(c => c.id === o.classeId)?.nome}</span> : <span className="block text-[10px] text-amber-700" title="Sem classe não há média trienal: a diária sai pela lotação. Ajuste em Cadastros › Lista de navios ou OM / Clientes.">⚠ sem classe</span>)}</td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right`} inputMode="numeric" value={v.lotacao} onChange={e => set(o.id, { lotacao: e.target.value })} aria-label={`Lotação de ${o.nome}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right`} inputMode="numeric" value={v.anterior} onChange={e => set(o.id, { anterior: e.target.value })} aria-label={`Lotação anterior de ${o.nome}`} /></td>
                  {navioModo && <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right`} inputMode="decimal" placeholder={fmt(media)} value={v.dias} onChange={e => set(o.id, { dias: e.target.value })} aria-label={`Dias de ${o.nome}`} /></td>}
                  {!navioModo && usaArea && <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-20 text-xs text-right`} inputMode="decimal" value={v.area || ''} onChange={e => set(o.id, { area: e.target.value })} aria-label={`Área de ${o.nome}`} /></td>}
                  {!navioModo && usaPeso && <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right`} inputMode="decimal" value={v.peso || ''} onChange={e => set(o.id, { peso: e.target.value })} aria-label={`Peso de ${o.nome}`} /></td>}
                  {!navioModo && rubs.map(r => <td key={r} className="text-center"><input type="checkbox" disabled={!podeEditar} checked={matriz.has(`${r}|${o.id}`)} onChange={e => marcar(r, o.id, e.target.checked)} aria-label={`${o.nome} participa da rubrica ${r}`} /></td>)}
                  <td className="px-2 whitespace-nowrap">{podeEditar && <>
                    {!navioModo && <><button className="text-primary-700 underline" onClick={() => rubs.forEach(r => marcar(r, o.id, true))}>todas</button> <button className="text-slate-500 underline" onClick={() => rubs.forEach(r => marcar(r, o.id, false))}>nenhuma</button> </>}
                    {participa(o.id) && <button className="text-red-600 underline ml-1" onClick={() => remover(o.id)}>retirar</button>}
                  </>}</td>
                </tr>
              );
            })}
            </React.Fragment>))}
            {!linhas.length && <tr><td colSpan={rubs.length + 5} className="px-3 py-6 text-center text-slate-400">Nenhum {navioModo ? 'navio' : 'cliente'} participante. Use "{navioModo ? 'Incluir navio' : 'Incluir cliente'}" ou importe a proposta.</td></tr>}
          </tbody>
        </table>
      </div>
      <ClienteModal aberto={incluir} titulo={navioModo ? 'Incluir navio nas diárias' : 'Incluir cliente na taxa condominial'} oms={dados.oms} tipo={navioModo ? 'NAVIO' : undefined}
        onFechar={() => setIncluir(false)}
        onEscolher={om => { setIncluir(false); if (om.tipo === 'NAVIO' !== navioModo) { notify.error(navioModo ? 'Escolha um navio.' : 'Navio entra pela aba Navios (diárias).'); return; }
          setExtras(e => new Set(e).add(om.id)); setSo(true); set(om.id, {}); if (!dados.oms.some(x => x.id === om.id)) { recarregar(); } notify.success(`${om.nome} incluído: informe a lotação${navioModo ? '' : ' e marque as rubricas'} e grave.`); }} />
      <ClienteModal aberto={!!resolver} titulo="Escolher correspondente" oms={dados.oms} tipo={resolver?.tipo === 'NAVIO' ? 'NAVIO' : undefined} nomeSugerido={resolver?.nome}
        onFechar={() => setResolver(null)}
        onEscolher={async om => { const p = resolver!; setResolver(null); try { await resolverPendente(p, om.id, dados.oms.find(x => x.id === om.id) ?? om); notify.success(`"${p.nome}" ligado a ${om.nome}.`); recarregar(); } catch (e) { notify.fail('Erro ao gravar', e); } }} />
    </div>
  );
};

// ================================================================== Média trienal
export const AbaMedia: React.FC<AbaProps> = ({ ano, dados, podeEditar, recarregar }) => {
  const anos = [ano - 3, ano - 2, ano - 1];
  type C = { dias: string; navios: string };
  const inicial = () => {
    const m: Record<string, C> = {};
    dados.atracacaoAnual.forEach(a => { m[`${a.ano}|${a.classeId}`] = { dias: String(a.dias), navios: String(a.navios) }; });
    return m;
  };
  const [cel, setCel] = useState<Record<string, C>>(inicial);
  const [alterados, setAlterados] = useState<Set<string>>(new Set());
  const [pend, setPend] = useState<{ ano: number; classe: string; dias: number; navios: number | null }[]>([]);
  const [anoBnic, setAnoBnic] = useState(ano - 1);
  const [gravando, setGravando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!alterados.size) setCel(inicial()); }, [dados]);
  const classes = dados.classes.filter(c => c.ativo || anos.some(a => cel[`${a}|${c.id}`]));
  const navAtivos = (cid: string, a: number) => naviosAtivos(dados.oms, cid, a);
  const valor = (a: number, cid: string): C => cel[`${a}|${cid}`] || { dias: '', navios: String(navAtivos(cid, a)) };
  const set = (a: number, cid: string, p: Partial<C>) => {
    const k = `${a}|${cid}`;
    setCel(m => ({ ...m, [k]: { ...valor(a, cid), ...p } })); setAlterados(s => new Set(s).add(k));
  };
  const dadosAtuais: AnoClasse[] = classes.flatMap(c => anos.map(a => { const v = valor(a, c.id); return { ano: a, classeId: c.id, dias: Number(v.dias) || 0, navios: Number(v.navios) || 0 }; }));
  const medias: MediaClasse[] = mediaTrienal(dadosAtuais, ano, classes.map(c => c.id));

  const importar = async (f?: File) => {
    if (!f) return;
    try {
      const h = lerHistorico(lerAbas(await lerArquivo(f)));
      const sem: typeof pend = [];
      let n = 0;
      h.forEach(x => {
        const c = acharPorNome(x.classe, dados.classes);
        if (!c) { if (x.dias > 0) sem.push(x); return; }
        set(x.ano, c.id, { dias: String(x.dias), navios: String(x.navios ?? navAtivos(c.id, x.ano)) }); n++;
      });
      setPend(sem);
      const lidos = [...new Set(h.map(x => x.ano))].sort();
      notify.success(`Histórico lido: anos ${lidos.join(', ')}; ${n} classe(s)/ano ligadas${sem.length ? `; ${sem.length} sem classe no cadastro` : ''}. Confira e grave.`);
      const faltam = anos.filter(a => !lidos.includes(a));
      if (faltam.length) notify.error(`O arquivo não tem aba para ${faltam.join(', ')}. Informe esses anos à mão ou calcule pelos mapas de atracação.`);
    } catch (e) { notify.fail('Erro ao ler o histórico', e); }
    if (ref.current) ref.current.value = '';
  };
  const puxarBnic = async () => {
    try {
      const m = await diasDoBnic35(anoBnic, dados.oms);
      if (!m.size) { notify.error(`Não há mapa de atracação realizado gravado em ${anoBnic}.`); return; }
      dados.classes.forEach(c => set(anoBnic, c.id, { dias: String(m.get(c.id) || 0), navios: String(navAtivos(c.id, anoBnic)) }));
      notify.success(`Dias de ${anoBnic} calculados pelos mapas de atracação (${m.size} classe(s) com atracação). Confira e grave.`);
    } catch (e) { notify.fail('Erro ao ler os mapas', e); }
  };
  const gravar = async () => {
    setGravando(true);
    try {
      const linhas = [...alterados].map(k => { const [a, cid] = k.split('|'); const v = cel[k]; return { ano: Number(a), classeId: cid, dias: Number(v.dias) || 0, navios: Number(v.navios) || 0 }; });
      await salvarAtracacaoAnual(linhas, 'tela');
      setAlterados(new Set()); notify.success(`${linhas.length} registro(s) gravado(s).`); recarregar();
    } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Para {ano}: em cada ano de {anos[0]} a {anos[2]}, dias atracados ("A") da classe ÷ navios da classe naquele ano; a soma ÷ 3 é a média anual e ÷ 12 a média mensal, que entra como "dias" do navio no rateio. Navios = ativos no cadastro (pode ajustar).</p>
      {podeEditar && <div className="flex flex-wrap gap-3 items-end">
        <input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" onChange={e => importar(e.target.files?.[0])} />
        <Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-1" />Importar histórico trienal</Button>
        <BaixarModelo modelo={() => modeloHistorico(ano, dados.classes.filter(c => c.ativo).map(c => c.nome))} />
        <Campo rotulo="Ano">
          <select className={entrada} value={anoBnic} onChange={e => setAnoBnic(Number(e.target.value))} aria-label="Ano a calcular pelos mapas">{anos.map(a => <option key={a}>{a}</option>)}</select>
        </Campo>
        <Button variant="secondary" onClick={puxarBnic}>Calcular pelos mapas de atracação</Button>
        <Button onClick={gravar} isLoading={gravando} disabled={!alterados.size}><Save size={16} className="mr-1" />Gravar ({alterados.size})</Button>
      </div>}
      {pend.length > 0 && <Aviso>
        <b>Classes do histórico não encontradas no cadastro</b> — escolha a classe correspondente:
        {pend.map((p, k) => (
          <div key={k} className="flex items-center gap-2 mt-1 text-xs">
            <span className="w-72 truncate">{p.ano} · {p.classe} ({p.dias} dias)</span>
            <select className={`${entrada} text-xs`} defaultValue="" aria-label={`Classe de ${p.classe} ${p.ano}`} onChange={e => { const cid = e.target.value; if (!cid) return; set(p.ano, cid, { dias: String(p.dias), navios: String(p.navios ?? navAtivos(cid, p.ano)) }); setPend(pend.filter((_, i) => i !== k)); }}>
              <option value="">escolher...</option>{dados.classes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        ))}
      </Aviso>}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th rowSpan={2} className="px-2 text-left">Classe</th>{anos.map(a => <th key={a} colSpan={3} className="px-2 py-1 border-l border-slate-200">{a}</th>)}<th rowSpan={2} className="px-2 border-l border-slate-200">Total</th><th rowSpan={2} className="px-2">Média anual</th><th rowSpan={2} className="px-2">Média mensal</th></tr>
            <tr>{anos.map(a => <React.Fragment key={a}><th className="px-1 border-l border-slate-200">dias</th><th className="px-1">navios</th><th className="px-1">por navio</th></React.Fragment>)}</tr>
          </thead>
          <tbody>
            {classes.map(c => {
              const m = medias.find(x => x.classeId === c.id)!;
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-2 py-0.5 max-w-[260px] truncate" title={c.nome}>{c.nome}</td>
                  {anos.map((a, i) => { const v = valor(a, c.id); return (
                    <React.Fragment key={a}>
                      <td className="px-1 border-l border-slate-100"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right ${alterados.has(`${a}|${c.id}`) ? 'bg-primary-50' : ''}`} inputMode="numeric" value={v.dias} onChange={e => set(a, c.id, { dias: e.target.value })} aria-label={`Dias ${c.nome} ${a}`} /></td>
                      <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-12 text-xs text-right`} inputMode="numeric" value={v.navios} onChange={e => set(a, c.id, { navios: e.target.value })} aria-label={`Navios ${c.nome} ${a}`} /></td>
                      <td className="px-1 text-right text-slate-600">{m.anos[i].porNavio || ''}</td>
                    </React.Fragment>
                  ); })}
                  <td className="px-2 text-right border-l border-slate-100">{m.total || ''}</td>
                  <td className="px-2 text-right">{m.mediaAnual || ''}</td>
                  <td className="px-2 text-right font-semibold">{m.mediaMensal || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">A planilha antiga arredondava a média mensal para cima (ARREDONDAR.PARA.CIMA); o sistema usa duas casas decimais, como as abas de rateio da proposta.</p>
    </div>
  );
};

// ================================================================== Descontos por OM
export const AbaDescontos: React.FC<AbaProps & { resultado: ResultadoRateio }> = ({ ano, dados, podeEditar, recarregar, resultado }) => {
  const vazio: Desconto = { id: '', omId: null, rubrica: null, tipo: 'PERCENTUAL', valor: 0, justificativa: '' };
  const [novo, setNovo] = useState<Desconto>(vazio);
  const [valorTxt, setValorTxt] = useState('');
  const [gravando, setGravando] = useState(false);
  const participantes = resultado.oms;
  const nomeOM = (id: string | null) => dados.oms.find(o => o.id === id)?.nome || '—';
  const efeito = (d: Desconto) => {
    const o = resultado.oms.find(x => x.omId === d.omId);
    if (!o) return null;
    if (d.rubrica === null) return o.anualBruto - o.anual;
    return o.parcelas.find(p => p.rubrica === d.rubrica)?.desconto ?? 0;
  };
  const erro = !novo.omId ? 'Escolha a OM.' : !(Number(n2(valorTxt)) > 0) ? 'Informe o valor.' : novo.tipo === 'PERCENTUAL' && Number(n2(valorTxt)) > 100 ? 'Percentual acima de 100%.' : !novo.justificativa.trim() ? 'A justificativa é obrigatória.' : '';
  const gravar = async () => {
    setGravando(true);
    try { await salvarDesconto(ano, { ...novo, valor: Number(n2(valorTxt)) }); setNovo(vazio); setValorTxt(''); notify.success('Desconto gravado.'); recarregar(); }
    catch (e) { notify.fail('Erro ao gravar desconto', e); } finally { setGravando(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Desconto concedido a uma OM (ex.: SecNSNQ — parte do edifício mantida pela própria OM), numa rubrica ou no total da taxa. O valor descontado não é redistribuído às demais OM. Desconto que vale para todas as OM fica na aba Rubricas (desconto geral).</p>
      {podeEditar && (
        <div className="flex flex-wrap gap-2 items-end p-3 rounded-lg border border-slate-200 bg-slate-50">
          <Campo rotulo="OM"><select className={entrada} value={novo.omId || ''} onChange={e => setNovo({ ...novo, omId: e.target.value || null })} aria-label="OM do desconto">
            <option value="">escolher...</option>{participantes.map(o => <option key={o.omId} value={o.omId}>{o.nome}</option>)}
          </select></Campo>
          <Campo rotulo="Aplicar em"><select className={entrada} value={novo.rubrica ?? ''} onChange={e => setNovo({ ...novo, rubrica: e.target.value ? Number(e.target.value) : null })} aria-label="Rubrica do desconto">
            <option value="">Total da taxa da OM</option>{dados.rubricas.map(r => <option key={r.numero} value={r.numero}>{r.numero} – {r.descricao}</option>)}
          </select></Campo>
          <Campo rotulo="Tipo"><select className={entrada} value={novo.tipo} onChange={e => setNovo({ ...novo, tipo: e.target.value as Desconto['tipo'] })} aria-label="Tipo do desconto"><option value="PERCENTUAL">%</option><option value="VALOR">R$ (anual)</option></select></Campo>
          <Campo rotulo={novo.tipo === 'PERCENTUAL' ? 'Percentual' : 'Valor anual (R$)'}><input className={`${entrada} w-28 text-right`} inputMode="decimal" value={valorTxt} onChange={e => setValorTxt(e.target.value)} aria-label="Valor do desconto" /></Campo>
          <Campo rotulo="Justificativa" className="flex-1 min-w-[220px]"><input className={`${entrada} w-full`} value={novo.justificativa} onChange={e => setNovo({ ...novo, justificativa: e.target.value })} aria-label="Justificativa do desconto" /></Campo>
          <Button onClick={gravar} isLoading={gravando} disabled={!!erro} title={erro}><Plus size={16} className="mr-1" />Adicionar</Button>
          {erro && <span className="text-xs text-slate-500 w-full">{erro}</span>}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs"><tr><th className="px-2 py-2 text-left">OM</th><th className="px-2 text-left">Aplicado em</th><th className="px-2 text-right">Desconto</th><th className="px-2 text-right">Efeito no ano</th><th className="px-2 text-left">Justificativa</th><th></th></tr></thead>
        <tbody>
          {dados.descontos.map(d => (
            <tr key={d.id} className="border-t border-slate-100">
              <td className="px-2 py-1.5">{nomeOM(d.omId)}</td>
              <td className="px-2">{d.rubrica === null ? 'Total da taxa' : `${d.rubrica} – ${dados.rubricas.find(r => r.numero === d.rubrica)?.descricao || ''}`}</td>
              <td className="px-2 text-right">{d.tipo === 'PERCENTUAL' ? pct(d.valor) : brl(d.valor)}</td>
              <td className="px-2 text-right">{efeito(d) === null ? <span className="text-amber-700 text-xs">OM fora do rateio</span> : brl(efeito(d)!)}</td>
              <td className="px-2 text-xs text-slate-600">{d.justificativa}</td>
              <td className="px-2">{podeEditar && <button aria-label="Excluir desconto" className="text-slate-400 hover:text-red-600" onClick={async () => { try { await excluirDesconto(d.id); recarregar(); } catch (e) { notify.fail('Erro ao excluir', e); } }}><Trash2 size={14} /></button>}</td>
            </tr>
          ))}
          {!dados.descontos.length && <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400">Nenhum desconto por OM.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};


