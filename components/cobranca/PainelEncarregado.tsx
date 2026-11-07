import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FAIXAS, CampoDivida, FaturaAberta, chaveDaOM, diasAtraso, dividaPorCondomino, faturasDaFaixa, faturasDaOM, filtrarDivida, totalPorFaixa } from '../../utils/relatorios';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const compacto = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} mi` : n >= 1e3 ? `${Math.round(n / 1e3)} mil` : String(Math.round(n)));
const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
// verde = no prazo; azuis cada vez mais escuros = vencida há mais tempo (mesmas cores do gráfico da página inicial)
const COR_FAIXA: Record<string, string> = { 'A vencer': '#16a34a', '1–30 dias': '#93c5fd', '31–90 dias': '#60a5fa', '91–180 dias': '#3b82f6', '181–365 dias': '#1d4ed8', 'Mais de 1 ano': '#1e3a8a' };

type Doc = { id: string; documentNumber: string; client: string; availableValue: number };
export interface PainelProps {
  abertas: FaturaAberta[]; hoje: string; diasParado: number; contestacoesAbertas: number | null;
  parados: { doc: Doc; dias: number }[]; adiantamentos: { cliente: string; saldo: number }[];
}
type Lista = { titulo: string; faturas: FaturaAberta[] };

const Card: React.FC<{ rotulo: string; valor: string; detalhe?: string; dica: string; onClick?: () => void; alerta?: boolean }> = ({ rotulo, valor, detalhe, dica, onClick, alerta }) => (
  <button type="button" onClick={onClick} disabled={!onClick} title={dica}
    className={`text-left bg-white rounded-xl border p-3 shadow-sm transition-all ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'} ${alerta ? 'border-red-200' : 'border-slate-200'}`}>
    <div className="text-[11px] uppercase font-semibold text-slate-500">{rotulo}</div>
    <div className={`text-lg font-bold tabular-nums ${alerta ? 'text-red-700' : 'text-slate-900'}`}>{valor}</div>
    {detalhe && <div className="text-xs text-slate-500">{detalhe}</div>}
    {onClick && <div className="mt-1 text-[11px] font-semibold text-primary-700">Ver detalhes →</div>}
  </button>
);

/** Painel do Encarregado: indicadores, gráficos e tabela de dívida que abrem a lista de faturas ao clicar. */
export const PainelEncarregado: React.FC<PainelProps> = ({ abertas, hoje, diasParado, contestacoesAbertas, parados, adiantamentos }) => {
  const [lista, setLista] = useState<Lista | null>(null);
  const [buscaLista, setBuscaLista] = useState('');
  const [ordemLista, setOrdemLista] = useState<{ campo: 'numero' | 'cliente' | 'vencimento' | 'atraso' | 'saldo'; asc: boolean }>({ campo: 'saldo', asc: false });
  const [busca, setBusca] = useState('');
  const [soVencidas, setSoVencidas] = useState(false);
  const [ordem, setOrdem] = useState<{ campo: CampoDivida; asc: boolean }>({ campo: 'total', asc: false });
  const [todosParados, setTodosParados] = useState(false);
  const [todosAdiant, setTodosAdiant] = useState(false);

  const abrir = (titulo: string, faturas: FaturaAberta[]) => { setBuscaLista(''); setOrdemLista({ campo: 'saldo', asc: false }); setLista({ titulo, faturas }); };
  const soma = (fs: FaturaAberta[]) => fs.reduce((s, f) => s + f.saldo, 0);
  const vencidas = useMemo(() => abertas.filter(f => f.vencimento < hoje), [abertas, hoje]);
  const contestadas = useMemo(() => abertas.filter(f => f.contestada), [abertas]);
  const porFaixa = useMemo(() => totalPorFaixa(abertas, hoje), [abertas, hoje]);
  const divida = useMemo(() => dividaPorCondomino(abertas, hoje), [abertas, hoje]);
  const linhas = useMemo(() => filtrarDivida(divida, { busca, soVencidas, ...ordem }), [divida, busca, soVencidas, ordem]);
  const maiores = useMemo(() => filtrarDivida(divida, { busca: '', soVencidas: true, campo: 'vencido', asc: false }).slice(0, 8)
    .map(l => ({ chave: l.chave, nome: l.cliente.length > 32 ? `${l.cliente.slice(0, 31)}…` : l.cliente, cliente: l.cliente, valor: Math.round((l.total - (l.porFaixa['A vencer'] || 0)) * 100) / 100 })), [divida]);
  const ordenar = (campo: CampoDivida) => setOrdem(o => ({ campo, asc: o.campo === campo ? !o.asc : campo === 'cliente' || campo === 'maisAntiga' }));
  const seta = (c: CampoDivida) => (ordem.campo === c ? (ordem.asc ? ' ▲' : ' ▼') : '');

  const itens = useMemo(() => {
    if (!lista) return [];
    const q = buscaLista.trim().toLowerCase();
    const atraso = (f: FaturaAberta) => Math.max(0, diasAtraso(f.vencimento, hoje));
    const dir = ordemLista.asc ? 1 : -1;
    return lista.faturas.filter(f => !q || `${f.numero} ${f.cliente} ${f.comando} ${f.tipo}`.toLowerCase().includes(q)).sort((a, b) => dir * (
      ordemLista.campo === 'numero' ? a.numero.localeCompare(b.numero) : ordemLista.campo === 'cliente' ? a.cliente.localeCompare(b.cliente, 'pt-BR')
      : ordemLista.campo === 'vencimento' ? a.vencimento.localeCompare(b.vencimento) : ordemLista.campo === 'atraso' ? atraso(a) - atraso(b) : a.saldo - b.saldo));
  }, [lista, buscaLista, ordemLista, hoje]);
  const exportar = () => {
    if (!lista) return;
    const ws = XLSX.utils.aoa_to_sheet([['Setor', 'Comando', 'Cliente', 'Fatura', 'Serviço', 'Competência', 'Vencimento', 'Dias de atraso', 'Saldo em aberto', 'Contestada'],
      ...itens.map(f => [f.setor, f.comando, f.cliente, f.numero, f.tipo, `${String(f.mes).padStart(2, '0')}/${f.ano}`, br(f.vencimento), Math.max(0, diasAtraso(f.vencimento, hoje)), f.saldo, f.contestada ? 'SIM' : ''])]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Faturas');
    XLSX.writeFile(wb, `painel_${lista.titulo.replace(/[^\w]+/g, '_').slice(0, 40)}_${hoje}.xlsx`);
  };

  const adiantPorCliente = useMemo(() => Object.entries(adiantamentos.reduce<Record<string, number>>((m, a) => ({ ...m, [a.cliente]: (m[a.cliente] || 0) + a.saldo }), {})).sort((a, b) => b[1] - a[1]), [adiantamentos]);
  const totalParado = parados.reduce((s, p) => s + p.doc.availableValue, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card rotulo="Em aberto" valor={brl(soma(abertas))} detalhe={`${abertas.length} fatura(s)`} dica="Clique para ver todas as faturas em aberto" onClick={() => abrir('Faturas em aberto', abertas)} />
        <Card rotulo="Vencido" valor={brl(soma(vencidas))} detalhe={`${vencidas.length} fatura(s)`} alerta={vencidas.length > 0} dica="Clique para ver as faturas vencidas" onClick={() => abrir('Faturas vencidas', vencidas)} />
        <Card rotulo="Em contestação" valor={brl(soma(contestadas))} detalhe={contestacoesAbertas != null ? `${contestacoesAbertas} contestação(ões) aberta(s)` : undefined} dica="Clique para ver as faturas contestadas" onClick={contestadas.length ? () => abrir('Faturas em contestação', contestadas) : undefined} />
        <Card rotulo="Adiantamentos disponíveis" valor={brl(adiantamentos.reduce((s, a) => s + a.saldo, 0))} detalhe={`${adiantPorCliente.length} cliente(s)`} dica="Clique para ir à lista de adiantamentos por cliente" onClick={adiantPorCliente.length ? () => document.getElementById('painel-adiantamentos')?.scrollIntoView({ behavior: 'smooth' }) : undefined} />
        <Card rotulo="ALTCRED com saldo parado" valor={`${parados.length} · ${brl(totalParado)}`} detalhe={`mais de ${diasParado} dias sem movimento`} dica="Clique para ir à lista de saldos parados" onClick={parados.length ? () => document.getElementById('painel-parados')?.scrollIntoView({ behavior: 'smooth' }) : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-800">Idade da dívida</h3>
          <p className="text-xs text-slate-500 mb-2">Quanto tempo o valor em aberto está vencido. <b>Clique numa barra</b> para ver as faturas da faixa.</p>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porFaixa} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}
                onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) { const x = porFaixa[Number(i)]; abrir(`Em aberto: ${x.faixa}`, faturasDaFaixa(abertas, x.faixa, hoje)); } }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="faixa" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={compacto} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={64} />
                <Tooltip formatter={(v: any, _n: any, p: any) => [`${brl(Number(v))} (${p?.payload?.qtd ?? 0} fatura(s))`, 'Em aberto']} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="valor" name="Em aberto" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={48}>{porFaixa.map(x => <Cell key={x.faixa} fill={COR_FAIXA[x.faixa]} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="bg-white rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-800">Maiores valores vencidos por OM</h3>
          <p className="text-xs text-slate-500 mb-2">As 8 OM que mais devem em faturas vencidas. <b>Clique numa barra</b> para ver as faturas da OM.</p>
          {maiores.length === 0 ? <p className="text-sm text-slate-400 py-10 text-center">Nenhuma fatura vencida.</p> : (
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={maiores} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}
                  onClick={(e: any) => { const i = e?.activeTooltipIndex ?? e?.activeIndex; if (i !== undefined && i !== null) { const m = maiores[Number(i)]; abrir(`Faturas de ${m.cliente}`, faturasDaOM(abertas, m.chave)); } }}>
                  <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={compacto} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="nome" width={190} tick={{ fontSize: 10, fill: '#334155' }} axisLine={false} tickLine={false} interval={0} />
                  <Tooltip formatter={(v: any) => [brl(Number(v)), 'Vencido']} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="valor" name="Vencido" fill="#1d4ed8" radius={[0, 4, 4, 0]} cursor="pointer" maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>

      <section className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-200 flex flex-wrap items-center gap-3">
          <h3 className="font-semibold text-slate-800">Dívida por condômino e idade (dias após a data-limite)</h3>
          <div className="flex-1" />
          <label className="relative"><Search size={14} className="absolute left-2 top-2 text-slate-400" /><input className="pl-7 pr-2 py-1 text-sm border border-slate-300 rounded-md w-56" placeholder="Buscar OM, comando ou setor..." value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar na dívida" /></label>
          <label className="text-sm flex items-center gap-1.5"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={soVencidas} onChange={e => setSoVencidas(e.target.checked)} /> Só com vencidas</label>
        </div>
        <p className="px-4 pt-2 text-xs text-slate-500">Clique numa <b>linha</b> para ver as faturas da OM, num <b>valor de faixa</b> para ver só aquela faixa, ou no <b>título da coluna</b> para ordenar. {linhas.length} de {divida.length} OM.</p>
        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase sticky top-0"><tr>
              <th className="px-3 py-2 text-left"><button type="button" className="font-semibold uppercase" onClick={() => ordenar('cliente')}>OM{seta('cliente')}</button></th>
              <th className="px-3 py-2 text-left">Comando</th>
              {FAIXAS.map(f => <th key={f.rotulo} className="px-3 py-2 text-right">{f.rotulo}</th>)}
              <th className="px-3 py-2 text-right"><button type="button" className="font-semibold uppercase" onClick={() => ordenar('total')}>Total{seta('total')}</button></th>
              <th className="px-3 py-2 text-left"><button type="button" className="font-semibold uppercase" onClick={() => ordenar('maisAntiga')}>Mais antiga{seta('maisAntiga')}</button></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.map(d => (
                <tr key={d.chave} className="hover:bg-primary-50/40 cursor-pointer" onClick={() => abrir(`Faturas de ${d.cliente}`, faturasDaOM(abertas, d.chave))}>
                  <td className="px-3 py-1.5 font-medium max-w-[220px] truncate" title={d.cliente}>{d.cliente}{d.contestado > 0 && <span className="ml-1 text-amber-700">(contest. {brl(d.contestado)})</span>}</td>
                  <td className="px-3 py-1.5 max-w-[200px] truncate text-slate-500" title={d.comando}>{d.comando}</td>
                  {FAIXAS.map((f, i) => (
                    <td key={f.rotulo} className={`px-3 py-1.5 text-right tabular-nums ${i >= 4 && d.porFaixa[f.rotulo] ? 'text-red-700 font-semibold' : ''}`}>
                      {d.porFaixa[f.rotulo] ? <button type="button" className="hover:underline" title={`Ver faturas — ${f.rotulo}`}
                        onClick={e => { e.stopPropagation(); abrir(`${d.cliente}: ${f.rotulo}`, faturasDaFaixa(faturasDaOM(abertas, d.chave), f.rotulo, hoje)); }}>{brl(d.porFaixa[f.rotulo])}</button> : ''}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold">{brl(d.total)}</td>
                  <td className="px-3 py-1.5">{br(d.maisAntiga)}</td>
                </tr>
              ))}
              {!linhas.length && <tr><td colSpan={FAIXAS.length + 4} className="px-3 py-6 text-center text-slate-400">Nenhuma OM.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <section id="painel-parados" className="bg-white rounded-xl border border-slate-200">
          <h3 className="px-4 py-2 font-semibold text-slate-800 border-b border-slate-200">ALTCRED/GRU com saldo parado (mais de {diasParado} dias)</h3>
          <table className="min-w-full text-xs"><tbody className="divide-y divide-slate-100">
            {(todosParados ? parados : parados.slice(0, 10)).map(p => <tr key={p.doc.id}><td className="px-3 py-1.5 font-mono">{p.doc.documentNumber}</td><td className="px-3 py-1.5 truncate max-w-[180px]" title={p.doc.client}>{p.doc.client}</td><td className="px-3 py-1.5 text-right tabular-nums font-semibold">{brl(p.doc.availableValue)}</td><td className="px-3 py-1.5 text-slate-500">{p.dias} dias</td></tr>)}
            {!parados.length && <tr><td className="px-3 py-4 text-center text-slate-400">Nenhum.</td></tr>}
          </tbody></table>
          {parados.length > 10 && <button type="button" className="m-2 text-xs font-semibold text-primary-700" onClick={() => setTodosParados(!todosParados)}>{todosParados ? 'Mostrar só os 10 maiores' : `Ver todos os ${parados.length}`}</button>}
        </section>
        <section id="painel-adiantamentos" className="bg-white rounded-xl border border-slate-200">
          <h3 className="px-4 py-2 font-semibold text-slate-800 border-b border-slate-200">Adiantamentos disponíveis por cliente</h3>
          <table className="min-w-full text-xs"><tbody className="divide-y divide-slate-100">
            {(todosAdiant ? adiantPorCliente : adiantPorCliente.slice(0, 10)).map(([c, v]) => <tr key={c}><td className="px-3 py-1.5 truncate max-w-[260px]" title={c}>{c}</td><td className="px-3 py-1.5 text-right tabular-nums font-semibold text-emerald-700">{brl(v)}</td></tr>)}
            {!adiantPorCliente.length && <tr><td className="px-3 py-4 text-center text-slate-400">Nenhum.</td></tr>}
          </tbody></table>
          {adiantPorCliente.length > 10 && <button type="button" className="m-2 text-xs font-semibold text-primary-700" onClick={() => setTodosAdiant(!todosAdiant)}>{todosAdiant ? 'Mostrar só os 10 maiores' : `Ver todos os ${adiantPorCliente.length}`}</button>}
        </section>
      </div>

      <Modal isOpen={!!lista} onClose={() => setLista(null)} title={lista?.titulo || ''} maxWidth="max-w-5xl">
        {lista && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm text-slate-600"><b>{itens.length}</b> fatura(s) · em aberto <b>{brl(soma(itens))}</b></div>
              <div className="flex-1" />
              <label className="relative"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><input className="pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-md" placeholder="Buscar fatura, cliente..." value={buscaLista} onChange={e => setBuscaLista(e.target.value)} aria-label="Buscar na lista" /></label>
              <Button size="sm" variant="secondary" onClick={exportar}><Download size={14} className="mr-1" />Excel</Button>
            </div>
            <div className="max-h-[60vh] overflow-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
                  {([['numero', 'Fatura', 'text-left'], ['cliente', 'Cliente', 'text-left'], [null, 'Serviço', 'text-left'], ['vencimento', 'Vencimento', ''], ['atraso', 'Atraso', 'text-right'], ['saldo', 'Em aberto', 'text-right']] as const).map(([c, rot, al]) => (
                    <th key={rot} className={`px-2 py-2 ${al}`}>{c ? <button type="button" className="font-semibold hover:text-primary-700" title="Clique para ordenar" onClick={() => setOrdemLista(o => ({ campo: c, asc: o.campo === c ? !o.asc : c !== 'saldo' && c !== 'atraso' }))}>{rot}{ordemLista.campo === c ? (ordemLista.asc ? ' ▲' : ' ▼') : ''}</button> : rot}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {itens.slice(0, 500).map(f => { const a = Math.max(0, diasAtraso(f.vencimento, hoje)); return (
                    <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-mono whitespace-nowrap">{f.numero}{f.contestada && <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 rounded px-1">contestada</span>}</td>
                      <td className="px-2 max-w-[260px] truncate" title={f.cliente}>{f.cliente}</td><td className="px-2">{f.tipo}</td>
                      <td className="px-2 text-center">{br(f.vencimento)}</td>
                      <td className={`px-2 text-right ${a ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>{a ? `${a} dias` : '—'}</td>
                      <td className="px-2 text-right tabular-nums font-semibold">{brl(f.saldo)}</td>
                    </tr>); })}
                  {!itens.length && <tr><td colSpan={6} className="px-2 py-6 text-center text-slate-400">Nenhuma fatura.</td></tr>}
                </tbody>
              </table>
            </div>
            {itens.length > 500 && <p className="text-xs text-slate-500">Mostrando as 500 primeiras; o Excel traz todas.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
};
