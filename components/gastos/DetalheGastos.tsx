import React from 'react';
import { Download } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { SaidaGasto, CATEGORIAS_SEM_RUBRICA } from '../../utils/gastosBNIC';
import { brl, br } from '../painel/comum';

export interface Detalhe {
  titulo: string; subtitulo?: string; cabecalho: string[]; direita?: number[];
  linhas: (string | number | React.ReactNode)[][]; total?: { rotulo: string; valor: number; coluna: number };
  excel?: { nome: string; aoa: (string | number)[][] };
}

/** Janela de detalhe (somente consulta): a lista de empenhos ou de medições que formam um número da página. */
export const DetalheGastos: React.FC<{ d: Detalhe; onClose: () => void }> = ({ d, onClose }) => (
  <Modal isOpen onClose={onClose} title={d.titulo} maxWidth="max-w-4xl">
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-slate-500 flex-1 min-w-[200px]">{d.subtitulo || 'Somente consulta.'}</p>
        {d.excel && <Button size="sm" variant="secondary" onClick={() => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(d.excel!.aoa), 'Detalhe'); XLSX.writeFile(wb, `${d.excel!.nome}.xlsx`); }}><Download size={14} className="mr-1" />Excel</Button>}
      </div>
      <div className="max-h-[60vh] overflow-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs" aria-label="Detalhe">
          <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>{d.cabecalho.map((c, i) => <th key={c} className={`px-2 py-2 ${(d.direita || []).includes(i) ? 'text-right' : 'text-left'}`}>{c}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {d.linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j} className={`px-2 py-1.5 ${(d.direita || []).includes(j) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}
            {!d.linhas.length && <tr><td colSpan={d.cabecalho.length} className="px-2 py-6 text-center text-slate-400">Nada neste recorte.</td></tr>}
            {d.total && d.linhas.length > 0 && <tr className="bg-slate-100 font-bold">{d.cabecalho.map((_, j) => <td key={j} className={`px-2 py-2 ${(d.direita || []).includes(j) ? 'text-right tabular-nums' : ''}`}>{j === 0 ? d.total!.rotulo : j === d.total!.coluna ? brl(d.total!.valor) : ''}</td>)}</tr>}
          </tbody>
        </table>
      </div>
    </div>
  </Modal>
);

/** Monta o detalhe de uma lista de empenhos (NE). */
export function detalheEmpenhos(titulo: string, subtitulo: string, saidas: SaidaGasto[], nomeArquivo: string): Detalhe {
  const ord = [...saidas].sort((a, b) => a.date.localeCompare(b.date) || a.documentNumber.localeCompare(b.documentNumber));
  const rotRub = (s: SaidaGasto) => (s.rubricaNumero ? `R${s.rubricaNumero}` : CATEGORIAS_SEM_RUBRICA[s.categoria || ''] || 'sem indicação');
  return {
    titulo, subtitulo, cabecalho: ['Data', 'Nota de empenho', 'Fornecedor', 'Rubrica / categoria', 'Valor'], direita: [4],
    linhas: ord.map(s => [br(s.date), <span key="n" className="font-mono">{s.documentNumber}</span>, s.client || '—', rotRub(s), <span key="v" className={s.value < 0 ? 'text-red-700' : ''}>{brl(s.value)}</span>]),
    total: { rotulo: `${ord.length} empenho(s)`, valor: ord.reduce((t, s) => t + s.value, 0), coluna: 4 },
    excel: { nome: nomeArquivo, aoa: [['Data', 'Nota de empenho', 'Fornecedor', 'Rubrica / categoria', 'Valor'], ...ord.map(s => [br(s.date), s.documentNumber, s.client, rotRub(s), s.value])] },
  };
}
