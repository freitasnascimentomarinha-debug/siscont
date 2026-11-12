import React, { useMemo, useState } from 'react';
import { AlertTriangle, Link2, Anchor } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { OM } from '../../types';
import { acharNavio } from '../../utils/importMedicoes';
import { acharPorNome } from '../../utils/taxaCondominialImport';
import { ligarLinhaAgua } from '../../utils/importAgua';
import { DescricaoManobra } from '../../utils/importManobras';
import { Aviso, brl } from './comum';

export interface GrupoRB { omId: string; valor: number; docs: DescricaoManobra[] }
export interface ResultadoRB { competencia: string | null; grupos: GrupoRB[]; relatorio: string[]; lembrar: { omId: string; nome: string }[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
const porNome = (nome: string, oms: OM[]) => acharPorNome(nome, oms.filter(o => o.ativo)) ?? acharNavio(nome, oms) ?? undefined;
const br = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8) + '/' + iso.slice(5, 7) : iso);

/** Conferência das "Descrições de Manobra" (rebocador) antes de lançar nas Medições do serviço RB. Cada documento vai para o cliente (OM/navio) escolhido. */
export const ImportarManobrasModal: React.FC<{
  docs: DescricaoManobra[] | null; oms: OM[]; competenciaTela: string; onFechar: () => void; onLancar: (r: ResultadoRB) => void;
}> = ({ docs, oms, competenciaTela, onFechar, onLancar }) => {
  const [escolha, setEscolha] = useState<Record<string, string>>({});   // arquivo → omId ('' = não lançar)
  const [lembrar, setLembrar] = useState(true);
  const auto = useMemo(() => new Map((docs || []).map(d => [d.arquivo, ligarLinhaAgua({ consumidor: d.navio, codigo: '' }, oms, porNome)] as const)), [docs, oms]);
  if (!docs) return null;
  const omDe = (d: DescricaoManobra) => (d.arquivo in escolha ? escolha[d.arquivo] || null : auto.get(d.arquivo)?.omId ?? null);
  const pendentes = docs.filter(d => !omDe(d));
  const total = r2(docs.reduce((s, d) => s + d.total, 0));
  const lancado = r2(docs.filter(omDe).reduce((s, d) => s + d.total, 0));
  const omPor = new Map(oms.map(o => [o.id, o]));
  const opcoes = [...oms].sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
  const meses = [...new Set(docs.map(d => d.mes).filter(Boolean))] as string[];
  const comp = meses.length === 1 ? meses[0] : null;
  const avisos = [...docs.flatMap(d => d.avisos.map(a => `${d.arquivo}: ${a}`)), ...(meses.length > 1 ? [`Os arquivos são de meses diferentes (${meses.join(', ')}): importe um mês por vez.`] : [])];
  const iguais = docs.filter((d, i) => d.numero && docs.findIndex(x => x.numero === d.numero) !== i);
  if (iguais.length) avisos.push(`Número repetido: ${iguais.map(d => d.numero).join(', ')}.`);

  const lancar = () => {
    const m = new Map<string, GrupoRB>();
    docs.forEach(d => {
      const id = omDe(d); if (!id) return;
      const g = m.get(id) || { omId: id, valor: 0, docs: [] };
      g.valor = r2(g.valor + d.total); g.docs.push(d); m.set(id, g);
    });
    const rel = [
      `Descrições de manobra (${docs.length} arquivo(s)): ${m.size} cliente(s), ${brl(lancado)}.`,
      ...pendentes.map(d => `Não lançado: ${d.arquivo} (${d.navio}) — ${brl(d.total)}.`),
    ];
    const memo = lembrar ? Object.entries(escolha).filter(([, id]) => id).map(([arq, id]) => ({ omId: id, nome: docs.find(d => d.arquivo === arq)?.navio || '' })).filter(x => x.nome) : [];
    onLancar({ competencia: comp, grupos: [...m.values()], relatorio: rel, lembrar: memo });
  };
  const rotuloComp = comp ? `${comp.slice(5)}/${comp.slice(0, 4)}` : '—';

  return (
    <Modal isOpen onClose={onFechar} title="Conferir descrições de manobra (rebocador)" maxWidth="max-w-6xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <span className="text-sm text-slate-600">Lançar <b>{brl(lancado)}</b> em {new Set(docs.map(omDe).filter(Boolean)).size} cliente(s){pendentes.length ? <span className="text-amber-700"> · {pendentes.length} arquivo(s) sem cliente ({brl(r2(pendentes.reduce((s, d) => s + d.total, 0)))}) ficam de fora</span> : ''}</span>
          <div className="flex gap-2"><Button variant="secondary" onClick={onFechar}>Cancelar</Button><Button onClick={lancar} disabled={!comp}><Anchor size={16} className="mr-2" />Lançar nas medições (RB)</Button></div>
        </div>
      }>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-700">
          <span>Competência: <b>{rotuloComp}</b></span><span>Arquivos: <b>{docs.length}</b></span><span>Total: <b>{brl(total)}</b></span>
        </div>
        <p className="text-xs text-slate-500">O valor de cada fatura é a soma do <b>CUSTO</b> das manobras do cliente (o custo da linha já inclui o número de rebocadores). Cada descrição de manobra vai <b>anexa ao PDF da fatura</b>. A fatura é emitida para o <b>navio/OM usuária</b>; a "OM solicitante" aparece só como informação.</p>
        {comp && comp !== competenciaTela && <Aviso>As manobras são de <b>{rotuloComp}</b>; a tela está em {competenciaTela.slice(5)}/{competenciaTela.slice(0, 4)}. Ao lançar, a tela passa para essa competência.</Aviso>}
        {avisos.length > 0 && (
          <Aviso><b className="flex items-center gap-1"><AlertTriangle size={14} />Pontos de atenção ({avisos.length})</b>
            <ul className="list-disc pl-5 text-xs mt-1 space-y-0.5">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul></Aviso>
        )}
        <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[50vh] overflow-y-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr><th className="px-2 py-1 text-left">Documento</th><th className="px-2 py-1 text-left">Navio / meio</th><th className="px-2 py-1 text-left">OM solicitante</th><th className="px-2 py-1 text-left">Manobras</th><th className="px-2 py-1 text-right">Valor</th><th className="px-2 py-1 text-left">Cliente da fatura (cadastro)</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map(d => {
                const lig = auto.get(d.arquivo), id = omDe(d), manual = d.arquivo in escolha;
                return (
                  <tr key={d.arquivo} className={!id ? 'bg-red-50/60' : !manual && lig?.como === 'codigo_diferente' ? 'bg-amber-50/60' : ''}>
                    <td className="px-2 py-1"><div className="font-medium">Nº {d.numero || '?'}</div><div className="text-[11px] text-slate-500 max-w-[180px] truncate" title={d.arquivo}>{d.arquivo}</div></td>
                    <td className="px-2 py-1">{d.navio}</td>
                    <td className="px-2 py-1">{d.solicitante}</td>
                    <td className="px-2 py-1 text-[11px] text-slate-600">{d.linhas.length} linha(s) · {[...new Set(d.linhas.map(l => br(l.dia)))].join(', ')}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">{brl(d.total)}</td>
                    <td className="px-2 py-1 min-w-[260px]">
                      <select className="w-full border border-slate-300 rounded px-1 py-0.5" value={id || ''} aria-label={`Cliente de ${d.arquivo}`} onChange={e => setEscolha(p => ({ ...p, [d.arquivo]: e.target.value }))}>
                        <option value="">— não lançar —</option>
                        {opcoes.map(o => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}{o.ativo ? '' : ' (desativada)'}</option>)}
                      </select>
                      <div className="text-[11px] mt-0.5">
                        {!id ? <span className="text-red-700">Escolha o cliente ou deixe "não lançar"</span>
                          : manual ? <span className="text-primary-700 flex items-center gap-1"><Link2 size={10} />escolhido à mão</span>
                            : <span className="text-emerald-700">ligado pelo nome: {omPor.get(id)?.nome}</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={lembrar} onChange={e => setLembrar(e.target.checked)} />lembrar as ligações feitas à mão (nome alternativo)</label>
      </div>
    </Modal>
  );
};
