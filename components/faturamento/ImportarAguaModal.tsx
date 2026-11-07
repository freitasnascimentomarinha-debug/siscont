import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Droplets, Link2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { OM } from '../../types';
import { acharNavio } from '../../utils/importMedicoes';
import { acharPorNome } from '../../utils/taxaCondominialImport';
import {
  AvisoAgua, LinhaAgua, PlanilhaAgua, RegraObservacao, aplicarObservacoes, conferirTotais, ligarLinhaAgua,
} from '../../utils/importAgua';
import { Aviso, br, brl } from './comum';

export interface GrupoAgua { omId: string; consumo: number; valor: number; linhas: LinhaAgua[] }
export interface ResultadoAgua { competencia: string | null; grupos: GrupoAgua[]; conta: number; relatorio: string[]; lembrar: { omId: string; nome: string }[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const m3 = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const porNome = (nome: string, oms: OM[]) => acharPorNome(nome, oms.filter(o => o.ativo)) ?? acharNavio(nome, oms) ?? undefined;

/**
 * Conferência da planilha de água e esgoto antes de lançar nas medições: totais × contas da concessionária,
 * regras das observações (ex.: HCM), pontos de atenção e a OM do cadastro de cada linha.
 */
export const ImportarAguaModal: React.FC<{
  planilha: PlanilhaAgua | null; regras: RegraObservacao[]; avisos: AvisoAgua[]; arquivo: string; oms: OM[]; competenciaTela: string;
  onFechar: () => void; onLancar: (r: ResultadoAgua) => void;
}> = ({ planilha, regras, avisos, arquivo, oms, competenciaTela, onFechar, onLancar }) => {
  const [aplicar, setAplicar] = useState<Record<number, boolean>>({});
  const [escolha, setEscolha] = useState<Record<number, string>>({});   // linha → omId ('' = não lançar)
  const [lembrar, setLembrar] = useState(true);
  const [so, setSo] = useState<'todas' | 'conferir'>('todas');

  const usar = (g: RegraObservacao) => aplicar[g.linha] ?? true;   // regra da observação: aplicada por padrão
  const linhas = useMemo(() => (planilha ? aplicarObservacoes(planilha.linhas, regras.filter(usar)) : []), [planilha, regras, aplicar]);
  const auto = useMemo(() => new Map(linhas.map(l => [l.linha, ligarLinhaAgua(l, oms, porNome)])), [linhas, oms]);
  const omDe = (l: LinhaAgua) => (l.linha in escolha ? escolha[l.linha] || null : auto.get(l.linha)?.omId ?? null);
  const tot = useMemo(() => (planilha ? conferirTotais(planilha, linhas) : null), [planilha, linhas]);
  if (!planilha || !tot) return null;

  const omPor = new Map(oms.map(o => [o.id, o]));
  const pendentes = linhas.filter(l => !omDe(l));
  const conferir = linhas.filter(l => !(l.linha in escolha) && auto.get(l.linha)?.como === 'codigo_diferente');
  const visiveis = so === 'todas' ? linhas : linhas.filter(l => !omDe(l) || conferir.includes(l));
  const contaTotal = r2(tot.rateio.conta.valor + tot.fora.conta.valor);
  const lancado = r2(linhas.filter(omDe).reduce((s, l) => s + l.valor, 0));
  const confere = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
  const opcoes = [...oms].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));

  const lancar = () => {
    const m = new Map<string, GrupoAgua>();
    linhas.forEach(l => {
      const id = omDe(l);
      if (!id) return;
      const g = m.get(id) || { omId: id, consumo: 0, valor: 0, linhas: [] };
      g.consumo = Math.round((g.consumo + l.consumo) * 10000) / 10000; g.valor = r2(g.valor + l.valor); g.linhas.push(l);
      m.set(id, g);
    });
    const rel = [
      `Planilha de água ${arquivo}${planilha.competencia ? ` (medição ${planilha.competencia.slice(5)}/${planilha.competencia.slice(0, 4)})` : ''}: ${m.size} OM, ${brl(lancado)}.`,
      ...regras.filter(g => usar(g) && Math.abs(g.diferencaM3) > 0.0001).map(g => `Regra da observação aplicada (${g.nome}): ${m3(g.consumoPlanilha)} → ${m3(g.consumoRegra)} m³; ${brl(g.diferencaValor)} voltaram para os não hidrometrados.`),
      ...pendentes.map(l => `Não lançado: linha ${l.linha} ${l.consumidor || 'sem nome'} ${l.hidrometro} — ${brl(l.valor)}.`),
    ];
    const memo = lembrar ? Object.entries(escolha).filter(([, id]) => id).map(([ln, id]) => ({ omId: id, nome: linhas.find(l => l.linha === Number(ln))?.consumidor || '' }))
      .filter(x => x.nome && !/^\*+$/.test(x.nome) && !/sem conex/i.test(x.nome)) : [];
    onLancar({ competencia: planilha.competencia, grupos: [...m.values()], conta: contaTotal, relatorio: rel, lembrar: memo });
  };

  const Linha: React.FC<{ rotulo: string; a: { valor: number; volume: number }; b: { valor: number; volume: number } }> = ({ rotulo, a, b }) => {
    const ok = confere(a.valor, b.valor, 0.05 + 0.01 * linhas.length) && confere(a.volume, b.volume, 0.01);
    return (
      <tr className="border-t border-slate-100">
        <td className="py-1 pr-2">{rotulo}</td>
        <td className="text-right px-2">{brl(b.valor)}<div className="text-[11px] text-slate-500">{m3(b.volume)} m³</div></td>
        <td className="text-right px-2">{brl(a.valor)}<div className="text-[11px] text-slate-500">{m3(a.volume)} m³</div></td>
        <td className="px-2">{ok ? <span className="text-emerald-700 font-semibold flex items-center gap-1"><CheckCircle2 size={14} />Confere{Math.abs(a.valor - b.valor) >= 0.005 ? ` (arredondamento ${brl(r2(a.valor - b.valor))})` : ''}</span>
          : <span className="text-red-700 font-semibold">Diferença {brl(r2(a.valor - b.valor))} · {m3(Math.round((a.volume - b.volume) * 10000) / 10000)} m³</span>}</td>
      </tr>
    );
  };

  return (
    <Modal isOpen onClose={onFechar} title="Conferir planilha de água e esgoto" maxWidth="max-w-6xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <span className="text-sm text-slate-600">Lançar <b>{brl(lancado)}</b> em {new Set(linhas.map(omDe).filter(Boolean)).size} OM{pendentes.length ? <span className="text-amber-700"> · {pendentes.length} linha(s) sem OM ({brl(r2(pendentes.reduce((s, l) => s + l.valor, 0)))}) ficam de fora</span> : ''}</span>
          <div className="flex gap-2"><Button variant="secondary" onClick={onFechar}>Cancelar</Button><Button onClick={lancar}><Droplets size={16} className="mr-2" />Lançar nas medições</Button></div>
        </div>
      }>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
          <span><b>{arquivo}</b></span>
          <span>Medição: <b>{planilha.competencia ? `${planilha.competencia.slice(5)}/${planilha.competencia.slice(0, 4)}` : '—'}</b></span>
          <span>Leituras: {br(planilha.leituraAnterior)} → {br(planilha.leituraAtual)}</span>
          <span>Vencimento na planilha: {br(planilha.vencimento) || '—'}</span>
          {planilha.precoM3 !== null && <span>m³: {brl(planilha.precoM3)} · com esgoto e taxa {((planilha.taxa ?? 0) * 100).toLocaleString('pt-BR')}%: <b>{brl(planilha.precoM3 * 2 * (1 + (planilha.taxa ?? 0)))}</b></span>}
        </div>
        {planilha.competencia && planilha.competencia !== competenciaTela && <Aviso>A planilha é da medição <b>{planilha.competencia.slice(5)}/{planilha.competencia.slice(0, 4)}</b>; a tela está em {competenciaTela.slice(5)}/{competenciaTela.slice(0, 4)}. Ao lançar, a tela passa para a competência da planilha.</Aviso>}

        <section>
          <h4 className="font-semibold mb-1">1. Totais × contas da concessionária</h4>
          <table className="w-full text-sm"><thead className="text-xs text-slate-500"><tr><th className="text-left">Conta</th><th className="text-right px-2">Concessionária</th><th className="text-right px-2">Planilha</th><th className="text-left px-2">Situação</th></tr></thead>
            <tbody>
              <Linha rotulo={`Rateio (${planilha.contas.filter(c => !c.foraDoRateio).map(c => c.matricula).join(' + ')})`} a={tot.rateio.planilha} b={tot.rateio.conta} />
              {(tot.fora.conta.valor > 0 || tot.fora.planilha.valor > 0) && <Linha rotulo={`Fora do rateio (${planilha.contas.filter(c => c.foraDoRateio).map(c => `${c.descricao} ${c.matricula}`).join(', ')})`} a={tot.fora.planilha} b={tot.fora.conta} />}
            </tbody>
          </table>
          {tot.naoHidrometrados.length > 0 && <p className="text-xs text-slate-500 mt-1">Consumidores não hidrometrados ficam com o que sobra da conta: {tot.naoHidrometrados.map(l => `${l.consumidor} ${m3(l.consumo)} m³ = ${brl(l.valor)}`).join(' · ')}.</p>}
        </section>

        {regras.length > 0 && (
          <section>
            <h4 className="font-semibold mb-1">2. Regras da observação da planilha</h4>
            {regras.map(g => {
              const dif = Math.abs(g.diferencaM3) > 0.0001;
              return (
                <div key={g.linha} className={`p-3 rounded-lg border ${dif ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                  <p className="text-xs text-slate-600 mb-1">Observação: “{g.texto}”</p>
                  <p>{g.consumidor} (linha {g.linha}): planilha <b>{m3(g.consumoPlanilha)} m³</b> · pela observação ({g.entrada} − {g.descontar.join(' − ')}) <b>{m3(g.consumoRegra)} m³</b>
                    {dif ? <> · diferença <b>{m3(g.diferencaM3)} m³ = {brl(g.diferencaValor)}</b></> : <span className="text-emerald-700 font-semibold"> · confere</span>}</p>
                  {g.faltam.length > 0 && <p className="text-xs text-red-700">Hidrômetros da observação não achados na planilha: {g.faltam.join(', ')} (contados como zero).</p>}
                  {dif && <label className="flex items-start gap-2 mt-2"><input type="checkbox" className="mt-1" checked={usar(g)} onChange={e => setAplicar(p => ({ ...p, [g.linha]: e.target.checked }))} />
                    <span>Aplicar a regra da observação: {g.consumidor} paga {m3(g.consumoRegra)} m³ ({brl(r2((planilha.linhas.find(l => l.linha === g.linha)?.valor ?? 0) - g.diferencaValor))}) e a diferença de {brl(g.diferencaValor)} volta para os consumidores não hidrometrados, na mesma proporção. O total continua igual à conta.<span className="block text-xs text-slate-500">Desmarque para lançar exatamente o valor da planilha.</span></span></label>}
                </div>
              );
            })}
          </section>
        )}

        {avisos.length > 0 && (
          <section>
            <h4 className="font-semibold mb-1 flex items-center gap-1"><AlertTriangle size={15} className="text-amber-600" />{regras.length ? 3 : 2}. Pontos de atenção ({avisos.length})</h4>
            <ul className="list-disc pl-5 text-xs space-y-0.5">{avisos.map((a, i) => <li key={i} className={a.tipo === 'sem_dono' || a.tipo === 'sem_leitura' ? 'text-amber-800' : 'text-slate-700'}>{a.linha ? `Linha ${a.linha}: ` : ''}{a.texto}</li>)}</ul>
          </section>
        )}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h4 className="font-semibold">{(regras.length ? 3 : 2) + (avisos.length ? 1 : 0)}. OM do cadastro de cada linha</h4>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={lembrar} onChange={e => setLembrar(e.target.checked)} />lembrar as ligações feitas à mão (nome alternativo no cadastro)</label>
              <select className="border border-slate-300 rounded px-1 py-0.5" value={so} onChange={e => setSo(e.target.value as any)} aria-label="Mostrar linhas">
                <option value="todas">Todas as linhas ({linhas.length})</option><option value="conferir">Só sem OM ou a conferir ({pendentes.length + conferir.length})</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[40vh] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr><th className="px-2 py-1 text-left">Linha</th><th className="px-2 py-1 text-left">Consumidor / código</th><th className="px-2 py-1 text-left">Hidrômetro</th><th className="px-2 py-1 text-right">m³</th><th className="px-2 py-1 text-right">R$</th><th className="px-2 py-1 text-left">OM do cadastro</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {visiveis.map(l => {
                  const lig = auto.get(l.linha);
                  const id = omDe(l);
                  const manual = l.linha in escolha;
                  return (
                    <tr key={l.linha} className={!id ? 'bg-red-50/60' : !manual && lig?.como === 'codigo_diferente' ? 'bg-amber-50/60' : ''}>
                      <td className="px-2 py-1 text-slate-400">{l.linha}</td>
                      <td className="px-2 py-1"><div className="font-medium">{l.consumidor || '—'}</div><div className="text-[11px] text-slate-500">{l.codigo || 'sem código'} · {l.secao || 'OM apoiadas'}{l.tipo === 'FORA_RATEIO' ? ' · fora do rateio' : l.tipo === 'NAO_HIDROMETRADO' ? ' · não hidrometrado' : ''}</div></td>
                      <td className="px-2 py-1">{l.hidrometro}{l.dias !== null ? <div className="text-[11px] text-slate-500">{l.dias} dia(s)</div> : null}</td>
                      <td className="px-2 py-1 text-right">{m3(l.consumo)}</td>
                      <td className="px-2 py-1 text-right">{brl(l.valor)}</td>
                      <td className="px-2 py-1 min-w-[260px]">
                        <select className="w-full border border-slate-300 rounded px-1 py-0.5" value={id || ''} aria-label={`OM da linha ${l.linha}`} onChange={e => setEscolha(p => ({ ...p, [l.linha]: e.target.value }))}>
                          <option value="">— não lançar —</option>
                          {opcoes.map(o => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}{o.ativo ? '' : ' (desativada)'}</option>)}
                        </select>
                        <div className="text-[11px] mt-0.5">
                          {!id ? <span className="text-red-700">Escolha a OM ou deixe "não lançar"</span>
                            : manual ? <span className="text-primary-700 flex items-center gap-1"><Link2 size={10} />escolhida à mão</span>
                              : lig?.como === 'codigo_diferente' ? <span className="text-amber-700">{lig.nota} Confira.</span>
                                : <span className="text-emerald-700">ligada pelo {lig?.como === 'nome' ? 'nome' : 'código'}: {omPor.get(id)?.nome}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Modal>
  );
};
