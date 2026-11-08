import { numeroDigitado } from '../../utils/numeroDigitado';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { obterNormas } from '../../utils/normas';
import { FileUp, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ContextoFaturamento, listarMedicoes, salvarMedicoes } from '../../services/faturamentoService';
import { MedicaoFat, pad, partes, referencia } from '../../utils/faturamento';
import { agruparRateio, lerRateio } from '../../utils/importMedicoes';
import { AvisoAgua, PlanilhaAgua, RegraObservacao, avisosAgua, conferirObservacoes, ehPlanilhaAgua, lerPlanilhaAgua } from '../../utils/importAgua';
import { cadastroService } from '../../services/cadastroService';
import { ImportarAguaModal, ResultadoAgua } from './ImportarAguaModal';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { BaixarModelo } from '../ui/BaixarModelo';
import { modeloRateio } from '../../utils/modelos';
import { ResponsavelServico } from './ResponsavelServico';
import { Aviso, Campo, brl, compAtual, entrada, lerArquivo } from './comum';

type Linha = { quantidade: string; quantidade2: string; valor: string; estimada: boolean; detalhe?: any[]; origem?: string | null };
const ROTULO2: Record<string, string> = { EL: 'Demanda (kW)', VT: 'km', TL: 'Min. móvel' };
const r2 = (n: number) => Math.round(n * 100) / 100;
const nOuNull = (s: string) => numeroDigitado(s);
const txt = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

const anteriores = (comp: string, n: number) => {
  const { ano, mes } = partes(comp);
  return Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(ano, mes - 2 - i, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; });
};

export const MedicoesTab: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean; comp: string; setComp: (c: string) => void; recarregarCtx: () => Promise<void> | void }> = ({ ctx, podeEditar, comp, setComp, recarregarCtx }) => {
  const medidos = ctx.servicos.filter(s => !['TC', 'DA'].includes(s.sigla));
  const [sigla, setSigla] = useState(medidos.find(s => s.sigla === 'EL')?.sigla || medidos[0]?.sigla || 'EL');
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});
  const [salvo, setSalvo] = useState<Record<string, Linha>>({});
  const [historico, setHistorico] = useState<(MedicaoFat & { id: string })[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');
  const [so, setSo] = useState<'todas' | 'lancadas' | 'semLeitura'>('todas');
  const [contaConcess, setContaConcess] = useState('');
  const [relImport, setRelImport] = useState<string[]>([]);
  const ref = useRef<HTMLInputElement>(null);
  const [agua, setAgua] = useState<{ planilha: PlanilhaAgua; regras: RegraObservacao[]; avisos: AvisoAgua[]; arquivo: string } | null>(null);
  // lançamento da planilha de água que espera a troca de competência/serviço terminar de carregar
  const pendente = useRef<{ linhas: Record<string, Linha>; rel: string[]; conta: string } | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const todas = await listarMedicoes([comp, ...anteriores(comp, 3)]);
      const doMes: Record<string, Linha> = {};
      todas.filter(m => m.competencia === comp && m.sigla === sigla).forEach(m => {
        doMes[m.omId] = { quantidade: txt(m.quantidade), quantidade2: txt(m.quantidade2), valor: txt(m.valor), estimada: !!m.estimada, detalhe: m.detalhe, origem: m.origem };
      });
      // preserva o que foi digitado durante a carga
      const p = pendente.current; pendente.current = null;
      setLinhas(prev => ({ ...doMes, ...prev, ...(p?.linhas || {}) })); setSalvo(doMes); setHistorico(todas.filter(m => m.sigla === sigla && m.competencia !== comp)); setRelImport(p?.rel || []);
      if (p) setContaConcess(p.conta);
    } catch (e) { notify.fail('Erro ao carregar medições', e); } finally { setCarregando(false); }
  };
  useEffect(() => { setLinhas({}); setSalvo({}); carregar(); }, [comp, sigla]);

  const oms = useMemo(() => ctx.omsFat.filter(o => o.ativo || historico.some(h => h.omId === o.id) || linhas[o.id])
    .sort((a, b) => a.setor.localeCompare(b.setor) || a.nome.localeCompare(b.nome)), [ctx.omsFat, historico, linhas]);
  const teveAntes = (id: string) => historico.some(h => h.omId === id);
  const lancada = (id: string) => !!linhas[id] && (linhas[id].quantidade !== '' || linhas[id].valor !== '');
  const visiveis = oms.filter(o => (!busca || `${o.codigo} ${o.nome}`.toLowerCase().includes(busca.toLowerCase()))
    && (so === 'todas' || (so === 'lancadas' ? lancada(o.id) : teveAntes(o.id) && !lancada(o.id))));
  const semLeitura = oms.filter(o => teveAntes(o.id) && !lancada(o.id));
  const soma = r2(Object.values(linhas).reduce((s, l) => s + (nOuNull(l.valor) || 0), 0));
  const alterados = Object.keys(linhas).filter(k => JSON.stringify(linhas[k]) !== JSON.stringify(salvo[k]));

  const set = (id: string, campo: keyof Linha, v: any) => setLinhas(p => ({ ...p, [id]: { ...(p[id] || { quantidade: '', quantidade2: '', valor: '', estimada: false }), [campo]: v } }));

  const estimar = (id: string) => {
    const ult = historico.filter(h => h.omId === id).sort((a, b) => b.competencia.localeCompare(a.competencia)).slice(0, 3);
    if (!ult.length) return;
    const media = (k: 'quantidade' | 'quantidade2' | 'valor') => { const v = ult.map(h => h[k]).filter(x => x != null) as number[]; return v.length ? r2(v.reduce((s, x) => s + x, 0) / v.length) : null; };
    setLinhas(p => ({ ...p, [id]: { quantidade: txt(media('quantidade')), quantidade2: txt(media('quantidade2')), valor: txt(media('valor')), estimada: true, origem: `Média de ${ult.length} medição(ões) anteriores (${obterNormas().anexoEstimativa})` } }));
  };

  const importar = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const wb = XLSX.read(new Uint8Array(await lerArquivo(files[0])), { dense: true, cellFormula: false, cellStyles: false });
      // planilha de água e esgoto da divisão (seções por cais, hidrômetros, observações): conferência própria
      for (const n of wb.SheetNames) {
        const mat = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) as any;
        if (!ehPlanilhaAgua(mat)) continue;
        const planilha = lerPlanilhaAgua(mat);
        if (!planilha.linhas.length) throw new Error(`A aba ${n} parece a planilha de água, mas não achei consumidores.`);
        setAgua({ planilha, regras: conferirObservacoes(mat, planilha), avisos: avisosAgua(planilha), arquivo: `${files[0].name} (aba ${n})` });
        return;
      }
      const aba = wb.SheetNames.find(n => /bnic-?41|dados/i.test(n)) ?? wb.SheetNames.find(n => lerRateio(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) as any).length) ?? wb.SheetNames[0];
      const grupos = agruparRateio(lerRateio(XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null }) as any));
      if (!grupos.length) throw new Error('Não achei as colunas CÓDIGO e CONSUMO/VALOR TOTAL na planilha.');
      const rel: string[] = [`Aba lida: ${aba} · ${grupos.length} código(s).`];
      const novas = { ...linhas };
      grupos.forEach(g => {
        const cand = ctx.oms.filter(o => o.codigo === g.codigo);
        const om = cand.find(o => o.ativo && o.codigoProprio !== false) ?? cand.find(o => o.ativo) ?? cand[0];
        if (!om) { rel.push(`Código ${g.codigo} (${g.linhas.map(l => l.sigla).join(', ')}) não está no cadastro: não importado.`); return; }
        if (cand.length > 1) rel.push(`Código ${g.codigo} é de ${cand.length} OM; lançado em ${om.nome} — confira.`);
        novas[om.id] = {
          quantidade: txt(g.consumo), quantidade2: sigla === 'EL' ? txt(g.demanda) : '', valor: txt(g.valor), estimada: false,
          detalhe: g.linhas.map(l => ({ sigla: l.sigla, dias: l.dias, consumo: l.consumo, demanda: l.demanda, valor: l.valor })), origem: `Rateio ${files[0].name}`,
        };
      });
      setLinhas(novas); setRelImport(rel);
      notify.success('Rateio lido. Confira e clique em Gravar.');
    } catch (e) { notify.fail('Erro ao ler o rateio', e); } finally { if (ref.current) ref.current.value = ''; }
  };

  const lancarAgua = async (r: ResultadoAgua) => {
    setAgua(null);
    const novas: Record<string, Linha> = {};
    r.grupos.forEach(g => {
      novas[g.omId] = {
        quantidade: txt(g.consumo), quantidade2: '', valor: txt(g.valor), estimada: false, origem: `Planilha de água ${r.competencia || ''}`.trim(),
        detalhe: g.linhas.map(l => ({ sigla: [l.consumidor, l.hidrometro].filter(Boolean).join(' · '), dias: l.dias, consumo: l.consumo, demanda: null, valor: l.valor, linha: l.linha, secao: l.secao, atual: l.atual, anterior: l.anterior })),
      };
    });
    const conta = txt(r.conta);
    const siglaAgua = medidos.find(s => s.sigla === 'AE')?.sigla ?? sigla;
    const novaComp = r.competencia || comp;
    if (novaComp !== comp || siglaAgua !== sigla) {
      pendente.current = { linhas: novas, rel: r.relatorio, conta };
      setComp(novaComp); setSigla(siglaAgua);
    } else {
      setLinhas(p => ({ ...p, ...novas })); setRelImport(r.relatorio); setContaConcess(conta);
    }
    // nomes ligados à mão viram nome alternativo da OM (a próxima planilha liga sozinha)
    let lembrados = 0;
    for (const { omId, nome } of r.lembrar) {
      const o = ctx.oms.find(x => x.id === omId);
      if (!o || (o.nomesAlternativos || []).some(n => n.trim().toLowerCase() === nome.trim().toLowerCase())) continue;
      try { await cadastroService.saveOM({ ...o, nomesAlternativos: [...(o.nomesAlternativos || []), nome] }); o.nomesAlternativos = [...(o.nomesAlternativos || []), nome]; lembrados++; } catch { /* sem permissão: segue sem lembrar */ }
    }
    notify.success(`Planilha de água lida: ${r.grupos.length} OM. Confira e clique em Gravar.${lembrados ? ` ${lembrados} nome(s) guardado(s) no cadastro.` : ''}`);
  };

  const gravar = async () => {
    setGravando(true);
    try {
      await salvarMedicoes(alterados.map(id => {
        const l = linhas[id];
        return { competencia: comp, sigla, omId: id, quantidade: nOuNull(l.quantidade), quantidade2: nOuNull(l.quantidade2), valor: nOuNull(l.valor), estimada: l.estimada, detalhe: l.detalhe, origem: l.origem ?? 'Digitado' };
      }));
      notify.success(`${alterados.length} medição(ões) gravada(s).`);
      await carregar();
    } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };

  const conta = nOuNull(contaConcess);
  return (
    <div className="space-y-4">
      <ResponsavelServico ctx={ctx} sigla={sigla} podeEditar={podeEditar} onSalvo={recarregarCtx} />
      <div className="flex flex-wrap gap-3 items-end">
        <Campo rotulo="Competência"><input className={entrada} type="month" value={comp} onChange={e => setComp(e.target.value)} aria-label="Competência das medições" /></Campo>
        <Campo rotulo="Serviço">
          <select className={entrada} value={sigla} onChange={e => setSigla(e.target.value)} aria-label="Serviço">{medidos.map(s => <option key={s.sigla} value={s.sigla}>{s.sigla} — {s.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Buscar OM"><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} placeholder="código ou nome" /></Campo>
        <Campo rotulo="Mostrar">
          <select className={entrada} value={so} onChange={e => setSo(e.target.value as any)}>
            <option value="todas">Todas as OM</option><option value="lancadas">Só lançadas</option><option value="semLeitura">Sem leitura no mês ({semLeitura.length})</option>
          </select>
        </Campo>
        {podeEditar && <>
          <input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" onChange={e => importar(e.target.files)} />
          <Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-2" />Importar rateio da divisão</Button>
          <BaixarModelo rotulo="Planilha modelo para a divisão" modelo={() => modeloRateio(sigla, comp,
            (historico.length ? ctx.omsFat.filter(o => historico.some(h => h.omId === o.id) || linhas[o.id]) : ctx.omsFat.filter(o => o.ativo && o.tipo !== 'NAVIO'))
              .sort((a, b) => a.codigo.localeCompare(b.codigo)).map(o => ({ codigo: o.codigo, nome: o.nome })),
            medidos.find(s => s.sigla === sigla)?.responsavel)} />
          <Button onClick={gravar} isLoading={gravando} disabled={!alterados.length}><Save size={16} className="mr-2" />Gravar ({alterados.length})</Button>
        </>}
      </div>
      {(() => { const sv = medidos.find(s => s.sigla === sigla); return <p className="text-xs text-slate-500">Responsável pelos dados de <b>{sv?.nome || sigla}</b>: {sv?.responsavel ? <b>{sv.responsavel}</b> : <span className="text-amber-700">não informado</span>}{sv?.telefone ? ` · ${sv.telefone}` : ''} — altere em Cadastros › Serviços. Baixe a planilha modelo, envie à divisão e importe a devolvida. A planilha de água e esgoto da divisão (seções por cais, hidrômetros e observações) também pode ser importada direto: o sistema confere com a conta da concessionária antes de lançar.</p>; })()}

      <div className="grid md:grid-cols-3 gap-3">
        <Aviso tom="slate">Soma do rateio em {referencia(comp)}: <b>{brl(soma)}</b> · {Object.keys(linhas).filter(lancada).length} OM lançadas.</Aviso>
        <div className="p-3 rounded-lg border border-slate-200 bg-white text-sm flex items-center gap-2 flex-wrap">
          Conta da concessionária (R$): <input className={`${entrada} w-36`} value={contaConcess} onChange={e => setContaConcess(e.target.value)} placeholder="1.942.777,19" />
          {conta !== null && <span className={Math.abs(conta - soma) < 0.05 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>{Math.abs(conta - soma) < 0.05 ? 'Confere' : `Diferença ${brl(r2(soma - conta))}`}</span>}
        </div>
        {semLeitura.length > 0 && <Aviso>{semLeitura.length} OM com leitura nos meses anteriores e sem leitura agora. Use "estimar" (média das 3 últimas, {obterNormas().anexoEstimativa}) ou confirme com a divisão.</Aviso>}
      </div>
      <ImportarAguaModal planilha={agua?.planilha ?? null} regras={agua?.regras ?? []} avisos={agua?.avisos ?? []} arquivo={agua?.arquivo ?? ''} oms={ctx.oms} competenciaTela={comp}
        onFechar={() => setAgua(null)} onLancar={lancarAgua} />
      {relImport.length > 0 && <Aviso tom="slate"><ul className="list-disc pl-5 text-xs">{relImport.map(r => <li key={r}>{r}</li>)}</ul></Aviso>}

      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0 z-10">
            <tr><th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-right">Quantidade ({ctx.servicos.find(s => s.sigla === sigla)?.unidade || 'un'})</th>{ROTULO2[sigla] && <th className="px-2 py-2 text-right">{ROTULO2[sigla]}</th>}<th className="px-2 py-2 text-right">Valor (R$)</th><th className="px-2 py-2 text-left">Origem</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {carregando && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Carregando...</td></tr>}
            {!carregando && visiveis.map(o => {
              const l = linhas[o.id] || { quantidade: '', quantidade2: '', valor: '', estimada: false };
              const mudou = JSON.stringify(linhas[o.id]) !== JSON.stringify(salvo[o.id]);
              return (
                <tr key={o.id} className={mudou ? 'bg-primary-50/40' : ''}>
                  <td className="px-2 py-1"><div className="font-medium">{o.codigo} · {o.nome}</div><div className="text-[11px] text-slate-500">{o.setor} {o.ativo ? '' : '· desativada'}{o.id === ctx.emissora.omId && <span className="text-sky-700 font-semibold"> · OM emissora: só controle de custos, sem fatura</span>}</div></td>
                  <td className="px-2 py-1 text-right"><input disabled={!podeEditar} aria-label={`Quantidade ${o.nome}`} className="w-28 text-right border border-slate-200 rounded px-1 py-0.5" value={l.quantidade} onChange={e => set(o.id, 'quantidade', e.target.value)} /></td>
                  {ROTULO2[sigla] && <td className="px-2 py-1 text-right"><input disabled={!podeEditar} className="w-24 text-right border border-slate-200 rounded px-1 py-0.5" value={l.quantidade2} onChange={e => set(o.id, 'quantidade2', e.target.value)} /></td>}
                  <td className="px-2 py-1 text-right"><input disabled={!podeEditar} aria-label={`Valor ${o.nome}`} className="w-32 text-right border border-slate-200 rounded px-1 py-0.5" value={l.valor} onChange={e => set(o.id, 'valor', e.target.value)} /></td>
                  <td className="px-2 py-1 text-xs text-slate-500">
                    {l.estimada && <span className="text-amber-700 font-semibold mr-1">estimada</span>}
                    {l.origem || ''}{l.detalhe && l.detalhe.length > 1 ? ` (${l.detalhe.length} linhas)` : ''}
                    {podeEditar && teveAntes(o.id) && !lancada(o.id) && <button className="ml-2 text-primary-700 underline" onClick={() => estimar(o.id)}>estimar</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
