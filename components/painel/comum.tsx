import React, { useMemo, useState } from 'react';
import { Download, HelpCircle, Search } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FaturaGer, Prioridade, ROTULO_PRIORIDADE, atrasoDe } from '../../utils/painelGerencial';

export const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const compacto = (n: number) => { const a = Math.abs(n); const s = n < 0 ? '−' : ''; return a >= 1e6 ? `${s}${(a / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi` : a >= 1e3 ? `${s}${Math.round(a / 1e3)} mil` : `${s}${Math.round(a)}`; };
export const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const mesBR = (ym: string) => (/^\d{4}-\d{2}$/.test(ym) ? `${ym.slice(5)}/${ym.slice(2, 4)}` : ym);
export const qtdBR = (n: number) => n.toLocaleString('pt-BR');

// cores padronizadas: gravidade (vermelho > laranja > azul > verde) e idade da dívida (do verde ao vermelho-escuro)
export const COR_PRIO: Record<Prioridade | 'regular', { fundo: string; borda: string; texto: string; ponto: string }> = {
  critico: { fundo: 'bg-red-50', borda: 'border-red-300', texto: 'text-red-800', ponto: '#dc2626' },
  atencao: { fundo: 'bg-orange-50', borda: 'border-orange-300', texto: 'text-orange-800', ponto: '#ea580c' },
  info: { fundo: 'bg-blue-50', borda: 'border-blue-300', texto: 'text-blue-800', ponto: '#2563eb' },
  regular: { fundo: 'bg-emerald-50', borda: 'border-emerald-300', texto: 'text-emerald-800', ponto: '#16a34a' },
};
export const COR_FAIXA: Record<string, string> = {
  'A vencer': '#16a34a', '1–30 dias': '#93c5fd', '31–90 dias': '#3b82f6', '91–180 dias': '#f59e0b', '181–365 dias': '#dc2626', 'Mais de 365 dias': '#7f1d1d',
};
export const COR = { faturado: '#2a78d6', recebido: '#eb6834', vencido: '#d03b3b', grade: '#e2e8f0', eixo: '#64748b' };

export const Selo: React.FC<{ prioridade: Prioridade | 'regular'; children?: React.ReactNode }> = ({ prioridade, children }) => {
  const c = COR_PRIO[prioridade];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${c.fundo} ${c.borda} ${c.texto}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: c.ponto }} />{children ?? (prioridade === 'regular' ? 'Regular' : ROTULO_PRIORIDADE[prioridade])}</span>;
};

export const Dica: React.FC<{ texto: string }> = ({ texto }) => (
  <span className="relative group inline-flex align-middle" tabIndex={0} aria-label={texto}>
    <HelpCircle size={13} className="text-slate-400" />
    <span role="tooltip" className="pointer-events-none absolute z-30 left-1/2 -translate-x-1/2 top-5 w-60 rounded-lg bg-slate-800 text-white text-xs font-normal normal-case tracking-normal p-2 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity shadow-lg">{texto}</span>
  </span>
);

/** Indicador: número grande, detalhe pequeno, clicável quando há lista por trás. */
export const Kpi: React.FC<{ rotulo: string; valor: string; detalhe?: string; dica?: string; cor?: string; onClick?: () => void; destaque?: boolean; alerta?: boolean }> = ({ rotulo, valor, detalhe, dica, cor = '#475569', onClick, destaque, alerta }) => (
  <button type="button" onClick={onClick} disabled={!onClick} aria-label={`${rotulo}: ${valor}${detalhe ? `, ${detalhe}` : ''}`}
    className={`text-left bg-white rounded-xl border p-3 shadow-sm transition-all ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : 'cursor-default'} ${alerta ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'}`}
    style={{ borderTop: `4px solid ${cor}` }}>
    <div className="flex items-start gap-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wide"><span className="flex-1 leading-tight">{rotulo}</span>{dica && <Dica texto={dica} />}</div>
    <div className={`mt-1 font-bold tabular-nums whitespace-nowrap ${alerta ? 'text-red-700' : 'text-slate-900'} ${destaque ? 'text-[17px] sm:text-2xl' : 'text-base sm:text-xl'}`}>{valor}</div>
    {detalhe && <div className="text-xs text-slate-500 mt-0.5">{detalhe}</div>}
    {onClick && <div className="mt-1 text-[11px] font-semibold text-primary-700">Ver detalhes →</div>}
  </button>
);

export const Grupo: React.FC<{ titulo: string; children: React.ReactNode; cols?: string }> = ({ titulo, children, cols = 'grid-cols-2 md:grid-cols-3' }) => (
  <section aria-label={titulo}>
    <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">{titulo}</h3>
    <div className={`grid gap-3 ${cols}`}>{children}</div>
  </section>
);

export const Secao: React.FC<{ titulo: string; subtitulo?: string; dica?: string; acoes?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }> = ({ titulo, subtitulo, dica, acoes, children, className = '', id }) => (
  <section id={id} className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 ${className}`}>
    <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
      <div><h3 className="font-bold text-slate-800 flex items-center gap-1.5">{titulo}{dica && <Dica texto={dica} />}</h3>{subtitulo && <p className="text-xs text-slate-500">{subtitulo}</p>}</div>
      {acoes}
    </div>
    {children}
  </section>
);

export const Vazio: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="text-sm text-slate-400 py-6 text-center">{children}</p>;

/** Lista de faturas (somente consulta), com busca, ordenação e Excel. */
export const ListaFaturas: React.FC<{ titulo: string; faturas: FaturaGer[]; hoje: string; onClose: () => void }> = ({ titulo, faturas, hoje, onClose }) => {
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<{ campo: 'numero' | 'cliente' | 'vencimento' | 'atraso' | 'saldo' | 'total'; asc: boolean }>({ campo: 'saldo', asc: false });
  const itens = useMemo(() => {
    const q = busca.trim().toLowerCase(), dir = ordem.asc ? 1 : -1;
    return faturas.filter(f => !q || `${f.numero} ${f.cliente} ${f.comando} ${f.tipo}`.toLowerCase().includes(q)).sort((a, b) => dir * (
      ordem.campo === 'numero' ? a.numero.localeCompare(b.numero) : ordem.campo === 'cliente' ? a.cliente.localeCompare(b.cliente, 'pt-BR')
      : ordem.campo === 'vencimento' ? (a.vencimento || '').localeCompare(b.vencimento || '') : ordem.campo === 'atraso' ? atrasoDe(a, hoje) - atrasoDe(b, hoje) : ordem.campo === 'total' ? a.total - b.total : a.saldo - b.saldo));
  }, [faturas, busca, ordem, hoje]);
  const soma = itens.reduce((s, f) => s + f.saldo, 0);
  const exportar = () => {
    const ws = XLSX.utils.aoa_to_sheet([['Setor', 'Comando', 'OM', 'Fatura', 'Serviço', 'Competência', 'Emissão', 'Vencimento', 'Dias de atraso', 'Valor original', 'Saldo pendente', 'Situação'],
      ...itens.map(f => [f.setor, f.comando, f.cliente, f.numero, f.tipo, `${String(f.mes).padStart(2, '0')}/${f.ano}`, br(f.emissao), br(f.vencimento), f.saldo > 0 ? atrasoDe(f, hoje) : 0, f.total, f.saldo, f.cancelada ? 'cancelada' : f.contestada ? 'em contestação' : f.saldo > 0.009 ? 'em aberto' : 'quitada'])]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Faturas');
    XLSX.writeFile(wb, `painel_${titulo.replace(/[^\wÀ-ú]+/g, '_').slice(0, 40)}_${hoje}.xlsx`);
  };
  const Cab: React.FC<{ c: typeof ordem.campo; rot: string; al?: string }> = ({ c, rot, al = '' }) => (
    <th className={`px-2 py-2 ${al}`}><button type="button" className="font-semibold hover:text-primary-700" title="Clique para ordenar" onClick={() => setOrdem(o => ({ campo: c, asc: o.campo === c ? !o.asc : c === 'numero' || c === 'cliente' }))}>{rot}{ordem.campo === c ? (ordem.asc ? ' ▲' : ' ▼') : ''}</button></th>
  );
  return (
    <Modal isOpen onClose={onClose} title={titulo} maxWidth="max-w-5xl">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm text-slate-600"><b>{itens.length}</b> fatura(s) · saldo pendente <b>{brl(soma)}</b></div>
          <div className="flex-1" />
          <label className="relative"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><input className="pl-7 pr-2 py-1.5 text-sm border border-slate-300 rounded-md" placeholder="Buscar fatura, OM..." value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar na lista" /></label>
          <Button size="sm" variant="secondary" onClick={exportar}><Download size={14} className="mr-1" />Excel</Button>
        </div>
        <div className="max-h-[60vh] overflow-auto border border-slate-200 rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
              <Cab c="numero" rot="Fatura" al="text-left" /><Cab c="cliente" rot="OM" al="text-left" /><th className="px-2 text-left hidden md:table-cell">Serviço</th>
              <Cab c="vencimento" rot="Vencimento" /><Cab c="atraso" rot="Atraso" al="text-right" /><Cab c="total" rot="Valor" al="text-right" /><Cab c="saldo" rot="Saldo" al="text-right" />
            </tr></thead>
            <tbody>
              {itens.slice(0, 500).map(f => { const a = f.saldo > 0.009 ? atrasoDe(f, hoje) : 0; return (
                <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-2 py-1.5 font-mono whitespace-nowrap">{f.numero}{f.contestada && <span className="ml-1 text-[10px] bg-amber-100 text-amber-800 rounded px-1">contestada</span>}{f.cancelada && <span className="ml-1 text-[10px] bg-slate-200 text-slate-700 rounded px-1">cancelada</span>}</td>
                  <td className="px-2 max-w-[240px] truncate" title={f.cliente}>{f.cliente}</td><td className="px-2 hidden md:table-cell">{f.tipo}</td>
                  <td className="px-2 text-center">{br(f.vencimento)}</td>
                  <td className={`px-2 text-right ${a ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>{a ? `${a} dias` : '—'}</td>
                  <td className="px-2 text-right tabular-nums">{brl(f.total)}</td><td className="px-2 text-right tabular-nums font-semibold">{brl(f.saldo)}</td>
                </tr>); })}
              {!itens.length && <tr><td colSpan={7} className="px-2 py-6 text-center text-slate-400">Nenhuma fatura.</td></tr>}
            </tbody>
          </table>
        </div>
        {itens.length > 500 && <p className="text-xs text-slate-500">Mostrando as 500 primeiras; o Excel traz todas.</p>}
      </div>
    </Modal>
  );
};
