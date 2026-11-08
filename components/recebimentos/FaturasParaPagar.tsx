import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Invoice } from '../../types';
import { dataBR } from '../../utils/datas';
import { distribuirPagamento, resumoPagamento, saldoDaFatura } from '../../utils/pagamentoDocumento';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export interface SelecaoPagamento { ids: string[]; manuais: Record<string, number | undefined> }

/**
 * Na inclusão da ALTCRED/GRU: escolher as faturas em aberto que ela paga. Mostra primeiro as faturas da OM do
 * documento; "todas" serve para quem paga por outras OM (ex.: RT DGMM pagando o Arsenal).
 */
export const FaturasParaPagar: React.FC<{
  faturas: Invoice[]; omId: string | null; nomeOM?: string; valorDoc: number; selecao: SelecaoPagamento; onChange: (s: SelecaoPagamento) => void; adiantamento?: boolean;
}> = ({ faturas, omId, nomeOM, valorDoc, selecao, onChange, adiantamento }) => {
  const [todas, setTodas] = useState(false);
  const [busca, setBusca] = useState('');
  const abertas = useMemo(() => faturas.filter(f => saldoDaFatura(f) > 0.005), [faturas]);
  const daOM = useMemo(() => (omId ? abertas.filter(f => f.omId === omId) : []), [abertas, omId]);
  const base = omId && !todas ? daOM : abertas;
  const q = busca.trim().toLowerCase();
  const visiveis = useMemo(() => base
    .filter(f => !q || `${f.invoiceNumber} ${f.client} ${f.type}`.toLowerCase().includes(q))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || '') || a.invoiceNumber.localeCompare(b.invoiceNumber))
    .slice(0, 300), [base, q]);
  const porId = useMemo(() => new Map(abertas.map(f => [f.id, f])), [abertas]);
  const escolhidas = selecao.ids.map(id => porId.get(id)).filter(Boolean) as Invoice[];
  const itens = distribuirPagamento(valorDoc || 0, escolhidas.map(f => ({ id: f.id, saldo: saldoDaFatura(f) })), selecao.manuais);
  const valorDe = new Map(itens.map(i => [i.id, i.valor]));
  const r = resumoPagamento(valorDoc || 0, itens);
  const alternar = (id: string) => onChange(selecao.ids.includes(id)
    ? { ids: selecao.ids.filter(x => x !== id), manuais: { ...selecao.manuais, [id]: undefined } }
    : { ...selecao, ids: [...selecao.ids, id] });

  return (
    <section className="mt-4 border border-primary-200 rounded-lg bg-primary-50/30 p-3 space-y-2" aria-label="Faturas a pagar com este documento">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="font-semibold text-slate-800 text-sm">{adiantamento ? 'Faturas que este adiantamento abate' : 'Faturas a pagar com este documento'} <span className="font-normal text-slate-500">(opcional)</span></h4>
        <div className="flex-1" />
        {omId && <label className="text-xs flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={todas} onChange={e => setTodas(e.target.checked)} /> Mostrar faturas de todas as OM</label>}
        <label className="relative"><Search size={13} className="absolute left-2 top-2 text-slate-400" /><input className="pl-7 pr-2 py-1 text-xs border border-slate-300 rounded-md w-48" placeholder="Buscar fatura..." value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar fatura em aberto" /></label>
      </div>
      <p className="text-xs text-slate-500">
        {omId && !todas ? <>Faturas em aberto de <b>{nomeOM}</b> ({daOM.length}). </> : <>Todas as faturas em aberto ({abertas.length}). </>}
        Marque na ordem em que devem ser pagas; o valor é distribuído até o saldo de cada fatura e pode ser ajustado.
        {!omId && ' Escolha o cliente acima para ver primeiro as faturas dele.'}
      </p>
      <div className="max-h-64 overflow-y-auto border border-slate-200 rounded bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr><th className="px-2 py-1.5 w-8"></th><th className="px-2 py-1.5 text-left">Fatura</th><th className="px-2 py-1.5 text-left">Cliente</th><th className="px-2 py-1.5 text-center">Vencimento</th><th className="px-2 py-1.5 text-right">Saldo</th><th className="px-2 py-1.5 text-right">Pagar</th></tr></thead>
          <tbody>
            {visiveis.map(f => {
              const marcada = selecao.ids.includes(f.id);
              return (
                <tr key={f.id} className={`border-t border-slate-100 ${marcada ? 'bg-primary-50' : 'hover:bg-slate-50'}`}>
                  <td className="px-2 py-1"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={marcada} onChange={() => alternar(f.id)} aria-label={`Pagar a fatura ${f.invoiceNumber}`} /></td>
                  <td className="px-2 py-1 font-mono whitespace-nowrap">{f.invoiceNumber}{f.contestada && <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 rounded px-1 font-sans">contestada</span>}</td>
                  <td className="px-2 py-1 max-w-[200px] truncate" title={f.client}>{f.client}</td>
                  <td className="px-2 py-1 text-center whitespace-nowrap">{dataBR(f.dueDate)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{brl(saldoDaFatura(f))}</td>
                  <td className="px-2 py-1 text-right">
                    {marcada ? <input type="number" step="0.01" min="0" aria-label={`Valor a pagar da fatura ${f.invoiceNumber}`}
                      className="w-28 text-right border border-primary-300 rounded px-1 py-0.5 tabular-nums"
                      value={selecao.manuais[f.id] ?? valorDe.get(f.id) ?? 0}
                      onChange={e => onChange({ ...selecao, manuais: { ...selecao.manuais, [f.id]: e.target.value === '' ? undefined : Math.round(Number(e.target.value) * 100) / 100 } })} /> : ''}
                  </td>
                </tr>
              );
            })}
            {!visiveis.length && <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400">Nenhuma fatura em aberto{omId && !todas ? ' desta OM' : ''}.</td></tr>}
          </tbody>
        </table>
      </div>
      {selecao.ids.length > 0 && (
        <div className={`text-xs flex flex-wrap gap-x-4 gap-y-1 ${r.excedeu ? 'text-red-700' : 'text-slate-700'}`} aria-live="polite">
          <span>{selecao.ids.length} fatura(s) · a pagar <b>{brl(r.selecionado)}</b></span>
          <span>valor do documento <b>{brl(valorDoc || 0)}</b></span>
          {r.excedeu ? <b>passa do valor do documento em {brl(-r.sobra)}</b> : <span>fica disponível no documento <b>{brl(r.sobra)}</b></span>}
        </div>
      )}
    </section>
  );
};
