import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Invoice, PaymentAllocation, ReceivedDocument } from '../../types';
import { listaAdiantamentos, resumoPorCliente } from '../../utils/adiantamentos';
import { Button } from '../ui/Button';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

/** Resumo de adiantamentos por cliente (saldo disponível) e faturas que usaram cada adiantamento. */
export const ResumoAdiantamentos: React.FC<{ documentos: ReceivedDocument[]; baixas: PaymentAllocation[]; faturas: Invoice[] }> = ({ documentos, baixas, faturas }) => {
  const [soComSaldo, setSoComSaldo] = useState(false);
  const [busca, setBusca] = useState('');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (k: string) => setAbertos(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const linhas = useMemo(() => listaAdiantamentos(documentos, baixas, faturas), [documentos, baixas, faturas]);
  const grupos = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return resumoPorCliente(linhas.filter(l => (!soComSaldo || l.saldo > 0.005)
      && (!q || `${l.cliente} ${l.comando} ${l.numero} ${l.usos.map(u => u.fatura).join(' ')}`.toLowerCase().includes(q))));
  }, [linhas, soComSaldo, busca]);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const tot = grupos.reduce((t, g) => ({ enviado: r2(t.enviado + g.enviado), utilizado: r2(t.utilizado + g.utilizado), saldo: r2(t.saldo + g.saldo) }), { enviado: 0, utilizado: 0, saldo: 0 });
  const negativos = linhas.filter(l => l.saldo < -0.005);

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Data de situação', 'Comando', 'Cliente', 'Nº ALTCRED', 'Origem', 'Valor ALTCRED', 'Enviado p/ adiantamento', 'Valor utilizado', 'Saldo'],
      ...linhas.map(l => [br(l.data), l.comando, l.cliente, l.numero, l.origem === 'SOBRA' ? 'Sobra de pagamento' : 'Adiantamento', l.valorAltcred, l.enviado, l.utilizado, l.saldo]),
    ]), 'ADIANTAMENTOS');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['Comando', 'Cliente', 'Enviado', 'Utilizado', 'Saldo disponível'],
      ...resumoPorCliente(linhas).map(g => [g.comando, g.cliente, g.enviado, g.utilizado, g.saldo]),
      [], ['Data', 'Comando', 'Cliente', 'ALTCRED', 'Fatura', 'Valor', 'Tipo'],
      ...linhas.flatMap(l => l.usos.map(u => [br(u.data), l.comando, l.cliente, l.numero, u.fatura, u.valor, u.tipo || ''])),
    ]), 'RESUMO ADIANTAMENTO');
    XLSX.writeFile(wb, `adiantamentos_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <section className="bg-white rounded-lg border border-slate-200 overflow-hidden" data-testid="resumo-adiantamentos">
      <div className="p-4 border-b border-slate-200 flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-800">Resumo de adiantamentos por cliente</h3>
          <p className="text-xs text-slate-500">ALTCRED encaminhadas para adiantamento (inteiras ou a sobra de um pagamento), quanto já foi usado e o saldo disponível. Clique no cliente para ver as ALTCRED e as faturas que usaram o saldo.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Cliente, ALTCRED ou fatura..." aria-label="Buscar no resumo de adiantamentos"
            className="text-sm border border-slate-300 rounded-md px-2 py-1.5 w-56" />
          <label className="text-sm flex items-center gap-1.5"><input type="checkbox" checked={soComSaldo} onChange={e => setSoComSaldo(e.target.checked)} className="h-4 w-4 accent-primary-600" /> Só com saldo</label>
          <Button size="sm" variant="secondary" onClick={exportar} disabled={!linhas.length}><FileSpreadsheet size={14} className="mr-1" /> Excel</Button>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-slate-200 border-b border-slate-200 text-center">
        {[['Enviado para adiantamento', tot.enviado], ['Utilizado em faturas', tot.utilizado], ['Saldo disponível', tot.saldo]].map(([r, v]) => (
          <div key={r as string} className="p-3"><div className="text-[11px] uppercase text-slate-500 font-semibold">{r}</div><div className="text-lg font-bold tabular-nums text-slate-900">{brl(v as number)}</div></div>
        ))}
      </div>
      {negativos.length > 0 && (
        <p className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">
          {negativos.length} adiantamento(s) usado(s) além do valor enviado: {negativos.map(n => n.numero).join(', ')}. Veja em Pontos de Atenção.
        </p>
      )}
      <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0 z-10">
            <tr><th className="px-3 py-2 text-left w-8"></th><th className="px-3 py-2 text-left">Comando</th><th className="px-3 py-2 text-left">Cliente / ALTCRED</th><th className="px-3 py-2 text-right">Enviado</th><th className="px-3 py-2 text-right">Utilizado</th><th className="px-3 py-2 text-right">Saldo</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {grupos.map(g => {
              const kg = `${g.comando}|${g.cliente}`;
              const ag = abertos.has(kg);
              return (
                <React.Fragment key={kg}>
                  <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => alternar(kg)}>
                    <td className="px-3 py-2 text-slate-400">{ag ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-600">{g.comando}</td>
                    <td className="px-3 py-2 font-medium text-slate-900">{g.cliente} <span className="text-xs text-slate-500">({g.linhas.length})</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(g.enviado)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(g.utilizado)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-bold ${g.saldo > 0.005 ? 'text-emerald-700' : g.saldo < -0.005 ? 'text-red-600' : 'text-slate-400'}`}>{brl(g.saldo)}</td>
                  </tr>
                  {ag && g.linhas.map(l => {
                    const ka = `alt|${l.docId}`;
                    const aa = abertos.has(ka);
                    return (
                      <React.Fragment key={ka}>
                        <tr className="bg-slate-50/70 hover:bg-slate-100 cursor-pointer" onClick={() => alternar(ka)}>
                          <td></td>
                          <td className="px-3 py-1.5 text-xs text-slate-500">{br(l.data)}</td>
                          <td className="px-3 py-1.5 pl-6">
                            <span className="font-mono text-xs">{l.numero}</span>
                            <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${l.origem === 'SOBRA' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>{l.origem === 'SOBRA' ? `sobra de pagamento (ALTCRED ${brl(l.valorAltcred)})` : 'adiantamento'}</span>
                            <span className="ml-2 text-xs text-primary-700">{aa ? 'ocultar faturas' : `${l.usos.length} fatura(s)`}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-xs">{brl(l.enviado)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-xs">{brl(l.utilizado)}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums text-xs font-semibold ${l.saldo < -0.005 ? 'text-red-600' : ''}`}>{brl(l.saldo)}</td>
                        </tr>
                        {aa && (l.usos.length ? l.usos.map(u => (
                          <tr key={u.baixaId} className="text-xs text-slate-600">
                            <td></td><td className="px-3 py-1">{br(u.data)}</td>
                            <td className="px-3 py-1 pl-12"><span className="font-mono">{u.fatura}</span> <span className="text-slate-400">{u.cliente}{u.tipo ? ` · ${u.tipo}` : ''}</span></td>
                            <td></td><td className="px-3 py-1 text-right tabular-nums">{brl(u.valor)}</td><td></td>
                          </tr>
                        )) : <tr className="text-xs text-slate-400"><td></td><td></td><td className="px-3 py-1 pl-12 italic" colSpan={4}>Nenhuma fatura usou este adiantamento ainda.</td></tr>)}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
            {!grupos.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Nenhum adiantamento{soComSaldo ? ' com saldo' : ''}.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
};
