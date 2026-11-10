import React, { useMemo, useState } from 'react';
import { AlertTriangle, Car, Link2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { OM } from '../../types';
import { acharNavio } from '../../utils/importMedicoes';
import { acharPorNome } from '../../utils/taxaCondominialImport';
import { ligarLinhaAgua } from '../../utils/importAgua';
import { LinhaVT, PlanilhaVT } from '../../utils/importViatura';
import { Aviso, brl } from './comum';

export interface GrupoVT { omId: string; valor: number; linhas: LinhaVT[] }
export interface ResultadoVT { competencia: string | null; grupos: GrupoVT[]; relatorio: string[]; lembrar: { omId: string; nome: string }[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const porNome = (nome: string, oms: OM[]) => acharPorNome(nome, oms.filter(o => o.ativo)) ?? acharNavio(nome, oms) ?? undefined;

/** Conferência da planilha de faturas de viatura (uma aba por OM) antes de lançar nas Medições do serviço VT. */
export const ImportarViaturaModal: React.FC<{
  planilha: PlanilhaVT | null; arquivo: string; oms: OM[]; competenciaTela: string; onFechar: () => void; onLancar: (r: ResultadoVT) => void;
}> = ({ planilha, arquivo, oms, competenciaTela, onFechar, onLancar }) => {
  const [escolha, setEscolha] = useState<Record<string, string>>({});   // aba → omId ('' = não lançar)
  const [lembrar, setLembrar] = useState(true);
  const [so, setSo] = useState<'todas' | 'conferir'>('todas');
  const auto = useMemo(() => new Map((planilha?.linhas || []).map(l => {
    const r = ligarLinhaAgua({ consumidor: l.omNome, codigo: l.codigo }, oms, porNome);
    return [l.aba, r.omId ? r : ligarLinhaAgua({ consumidor: l.aba, codigo: l.codigo }, oms, porNome)] as const;
  })), [planilha, oms]);
  if (!planilha) return null;
  const omDe = (l: LinhaVT) => (l.aba in escolha ? escolha[l.aba] || null : auto.get(l.aba)?.omId ?? null);
  const pendentes = planilha.linhas.filter(l => !omDe(l));
  const conferir = planilha.linhas.filter(l => !(l.aba in escolha) && auto.get(l.aba)?.como === 'codigo_diferente');
  const visiveis = so === 'todas' ? planilha.linhas : planilha.linhas.filter(l => !omDe(l) || conferir.includes(l));
  const total = r2(planilha.linhas.reduce((s, l) => s + l.valor, 0));
  const lancado = r2(planilha.linhas.filter(omDe).reduce((s, l) => s + l.valor, 0));
  const omPor = new Map(oms.map(o => [o.id, o]));
  const opcoes = [...oms].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
  const comp = planilha.competencia;
  const rotuloComp = comp ? `${comp.slice(5)}/${comp.slice(0, 4)}` : '—';

  const lancar = () => {
    const m = new Map<string, GrupoVT>();
    planilha.linhas.forEach(l => {
      const id = omDe(l); if (!id) return;
      const g = m.get(id) || { omId: id, valor: 0, linhas: [] };
      g.valor = r2(g.valor + l.valor); g.linhas.push(l); m.set(id, g);
    });
    const rel = [
      `Planilha de viatura ${arquivo} (${rotuloComp}): ${m.size} OM, ${brl(lancado)}.`,
      ...planilha.semValor.length ? [`${planilha.semValor.length} aba(s) sem valor (sem fatura de viatura no mês): ${planilha.semValor.map(x => x.aba).join(', ')}.`] : [],
      ...pendentes.map(l => `Não lançado: aba ${l.aba} (${l.omNome}) — ${brl(l.valor)}.`),
    ];
    const memo = lembrar ? Object.entries(escolha).filter(([, id]) => id).map(([aba, id]) => ({ omId: id, nome: planilha.linhas.find(l => l.aba === aba)?.omNome || '' })).filter(x => x.nome) : [];
    onLancar({ competencia: comp, grupos: [...m.values()], relatorio: rel, lembrar: memo });
  };

  return (
    <Modal isOpen onClose={onFechar} title="Conferir planilha de faturas de viatura" maxWidth="max-w-6xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <span className="text-sm text-slate-600">Lançar <b>{brl(lancado)}</b> em {new Set(planilha.linhas.map(omDe).filter(Boolean)).size} OM{pendentes.length ? <span className="text-amber-700"> · {pendentes.length} aba(s) sem OM ({brl(r2(pendentes.reduce((s, l) => s + l.valor, 0)))}) ficam de fora</span> : ''}</span>
          <div className="flex gap-2"><Button variant="secondary" onClick={onFechar}>Cancelar</Button><Button onClick={lancar}><Car size={16} className="mr-2" />Lançar nas medições (VT)</Button></div>
        </div>
      }>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
          <span><b>{arquivo}</b></span><span>Competência: <b>{rotuloComp}</b></span><span>Abas com fatura: <b>{planilha.linhas.length}</b></span><span>Total: <b>{brl(total)}</b></span>
          {planilha.semValor.length > 0 && <span className="text-slate-500">{planilha.semValor.length} aba(s) sem valor (sem fatura no mês)</span>}
        </div>
        <p className="text-xs text-slate-500">O valor de cada OM é o <b>TOTAL SERVIÇO PRESTADO</b> da aba. A viatura é cobrada com atraso: o valor pode juntar vários meses (a tabela "Mês | Valor" da aba aparece como detalhe).</p>
        {comp && comp !== competenciaTela && <Aviso>A planilha é de <b>{rotuloComp}</b>; a tela está em {competenciaTela.slice(5)}/{competenciaTela.slice(0, 4)}. Ao lançar, a tela passa para a competência da planilha.</Aviso>}
        {planilha.avisos.length > 0 && (
          <Aviso><b className="flex items-center gap-1"><AlertTriangle size={14} />Pontos de atenção ({planilha.avisos.length})</b>
            <ul className="list-disc pl-5 text-xs mt-1 space-y-0.5">{planilha.avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></Aviso>
        )}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h4 className="font-semibold">OM do cadastro de cada aba</h4>
            <div className="flex items-center gap-3 text-xs">
              <label className="flex items-center gap-1"><input type="checkbox" checked={lembrar} onChange={e => setLembrar(e.target.checked)} />lembrar as ligações feitas à mão (nome alternativo)</label>
              <select className="border border-slate-300 rounded px-1 py-0.5" value={so} onChange={e => setSo(e.target.value as any)} aria-label="Mostrar abas">
                <option value="todas">Todas as abas ({planilha.linhas.length})</option><option value="conferir">Só sem OM ou a conferir ({pendentes.length + conferir.length})</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[45vh] overflow-y-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr><th className="px-2 py-1 text-left">Aba / fatura</th><th className="px-2 py-1 text-left">OM usuária</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-left">Meses cobrados</th><th className="px-2 py-1 text-left">OM do cadastro</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {visiveis.map(l => {
                  const lig = auto.get(l.aba), id = omDe(l), manual = l.aba in escolha;
                  return (
                    <tr key={l.aba} className={!id ? 'bg-red-50/60' : !manual && lig?.como === 'codigo_diferente' ? 'bg-amber-50/60' : ''}>
                      <td className="px-2 py-1"><div className="font-medium">{l.aba}</div><div className="font-mono text-[11px] text-slate-500">{l.numeroFatura}</div></td>
                      <td className="px-2 py-1 max-w-[240px]"><div className="truncate" title={l.omNome}>{l.omNome}</div></td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">{brl(l.valor)}</td>
                      <td className="px-2 py-1 text-[11px] text-slate-600">{l.meses.length > 1 ? l.meses.map(x => `${x.mes} ${x.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`).join(' + ') : l.meses[0]?.mes || ''}</td>
                      <td className="px-2 py-1 min-w-[260px]">
                        <select className="w-full border border-slate-300 rounded px-1 py-0.5" value={id || ''} aria-label={`OM da aba ${l.aba}`} onChange={e => setEscolha(p => ({ ...p, [l.aba]: e.target.value }))}>
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
