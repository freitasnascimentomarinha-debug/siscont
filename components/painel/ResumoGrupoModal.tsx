import React, { useMemo, useState } from 'react';
import { Download, FileText, ListChecks } from 'lucide-react';
import jsPDF from 'jspdf';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { FaturaPainel } from '../../utils/painel';
import { Dimensao, LinhaGrupo, ROTULO_DIMENSAO, resumoPorDimensao } from '../../utils/painelAgrupar';
import { cabecalhoCompacto, salvarPdf, tabelaPdf, tituloRelatorio } from '../../utils/pdfCabecalho';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface ResumoAberto { titulo: string; faturas: FaturaPainel[]; metrica: 'saldo' | 'total' }

/**
 * Janela que abre ao clicar num cartão ou barra do painel: o resumo por Setor, Comando ou OM (em vez de despejar a lista de faturas).
 * Clicar numa linha mostra as faturas só daquele grupo; "Ver todas as faturas" mostra a lista inteira.
 */
export const ResumoGrupoModal: React.FC<{
  resumo: ResumoAberto | null; hoje: string; onClose: () => void;
  onVerFaturas: (dim: Dimensao | null, nome: string | null) => void;
}> = ({ resumo, hoje, onClose, onVerFaturas }) => {
  const [dim, setDim] = useState<Dimensao>('comando');
  const linhas = useMemo<LinhaGrupo[]>(() => (resumo ? resumoPorDimensao(resumo.faturas, dim, resumo.metrica, hoje) : []), [resumo, dim, hoje]);
  if (!resumo) return null;
  const ehSaldo = resumo.metrica === 'saldo';
  const rotuloValor = ehSaldo ? 'Em aberto' : 'Faturado';
  const total = linhas.reduce((s, l) => s + l.valor, 0), qtd = linhas.reduce((s, l) => s + l.qtd, 0);
  const maior = Math.max(...linhas.map(l => l.valor), 0.01);

  const excel = () => {
    const ws = XLSX.utils.json_to_sheet(linhas.map(l => ({
      [ROTULO_DIMENSAO[dim]]: l.nome, Faturas: l.qtd, [rotuloValor]: l.valor, '% do total': l.pct,
      ...(ehSaldo ? { Vencido: l.vencido, 'A vencer': l.aVencer } : { Pago: l.pago, 'Em aberto': l.emAberto }),
    })).concat([{ [ROTULO_DIMENSAO[dim]]: 'TOTAL', Faturas: qtd, [rotuloValor]: Math.round(total * 100) / 100 } as any]));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Resumo');
    XLSX.writeFile(wb, `${resumo.titulo.replace(/[^\wÀ-ú]+/g, '_')}_por_${dim}.xlsx`);
  };
  const pdf = () => {
    const doc = new jsPDF('l'); cabecalhoCompacto(doc);
    const y = tituloRelatorio(doc, `${resumo.titulo} — por ${ROTULO_DIMENSAO[dim].toLowerCase()}`, `Posição em ${hoje.split('-').reverse().join('/')}`, 26);
    tabelaPdf(doc, {
      startY: y, head: [[ROTULO_DIMENSAO[dim], 'Faturas', rotuloValor, '% do total', ehSaldo ? 'Vencido' : 'Pago', ehSaldo ? 'A vencer' : 'Em aberto']],
      body: [...linhas.map(l => [l.nome, String(l.qtd), brl(l.valor), `${l.pct.toLocaleString('pt-BR')}%`, brl(ehSaldo ? l.vencido : l.pago), brl(ehSaldo ? l.aVencer : l.emAberto)]),
        ['TOTAL', String(qtd), brl(total), '100%', '', '']],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    });
    salvarPdf(doc, `${resumo.titulo.replace(/[^\wÀ-ú]+/g, '_')}_por_${dim}.pdf`);
  };

  return (
    <Modal isOpen onClose={onClose} title={resumo.titulo} maxWidth="max-w-4xl">
      <div className="space-y-3" data-testid="resumo-grupo">
        <div className="flex flex-wrap items-end gap-3">
          <fieldset>
            <legend className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">Agrupar por</legend>
            <div role="radiogroup" aria-label="Agrupar por" className="inline-flex rounded-md border border-slate-300 overflow-hidden bg-white">
              {(['setor', 'comando', 'cliente'] as Dimensao[]).map((d, i) => (
                <button key={d} type="button" role="radio" aria-checked={dim === d} onClick={() => setDim(d)}
                  className={`px-3 py-1.5 text-sm ${dim === d ? 'bg-primary-600 text-white' : 'text-slate-700 hover:bg-slate-50'} ${i ? 'border-l border-slate-300' : ''}`}>{ROTULO_DIMENSAO[d]}</button>
              ))}
            </div>
          </fieldset>
          <p className="flex-1 min-w-[12rem] text-sm text-slate-600"><b>{qtd}</b> fatura(s) · <b className="tabular-nums">{brl(total)}</b> · {linhas.length} {dim === 'cliente' ? 'OM' : dim === 'setor' ? (linhas.length === 1 ? 'setor' : 'setores') : (linhas.length === 1 ? 'comando' : 'comandos')}</p>
          <Button size="sm" variant="secondary" onClick={() => onVerFaturas(null, null)}><ListChecks size={14} className="mr-1" />Ver todas as faturas</Button>
          <Button size="sm" variant="secondary" onClick={excel}><Download size={14} className="mr-1" />Excel</Button>
          <Button size="sm" variant="secondary" onClick={pdf}><FileText size={14} className="mr-1" />PDF</Button>
        </div>
        <div className="overflow-auto max-h-[55vh] border border-slate-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 sticky top-0">
              <tr><th className="text-left p-2">{ROTULO_DIMENSAO[dim]}</th><th className="text-right p-2">Faturas</th><th className="text-right p-2">{rotuloValor}</th>
                <th className="p-2 w-40">Proporção</th><th className="text-right p-2">%</th>
                {ehSaldo ? <><th className="text-right p-2">Vencido</th><th className="text-right p-2">A vencer</th></> : <><th className="text-right p-2">Pago</th><th className="text-right p-2">Em aberto</th></>}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {linhas.map(l => (
                <tr key={l.nome} className="hover:bg-slate-50">
                  <td className="p-2"><button className="text-left text-primary-700 hover:underline font-medium" title="Ver as faturas deste grupo" onClick={() => onVerFaturas(dim, l.nome)}>{l.nome}</button></td>
                  <td className="p-2 text-right tabular-nums">{l.qtd}</td>
                  <td className="p-2 text-right tabular-nums font-semibold">{brl(l.valor)}</td>
                  <td className="p-2"><div className="h-2.5 rounded bg-slate-100"><div className="h-full rounded bg-primary-500" style={{ width: `${Math.max(2, (l.valor / maior) * 100)}%` }} /></div></td>
                  <td className="p-2 text-right tabular-nums text-slate-500">{l.pct.toLocaleString('pt-BR')}%</td>
                  <td className="p-2 text-right tabular-nums text-slate-600">{brl(ehSaldo ? l.vencido : l.pago)}</td>
                  <td className="p-2 text-right tabular-nums text-slate-600">{brl(ehSaldo ? l.aVencer : l.emAberto)}</td>
                </tr>
              ))}
              {!linhas.length && <tr><td colSpan={7} className="p-6 text-center text-slate-500">Nada para mostrar.</td></tr>}
            </tbody>
            {linhas.length > 0 && <tfoot className="bg-slate-50 font-semibold"><tr><td className="p-2">Total</td><td className="p-2 text-right tabular-nums">{qtd}</td><td className="p-2 text-right tabular-nums">{brl(total)}</td><td colSpan={4} /></tr></tfoot>}
          </table>
        </div>
      </div>
    </Modal>
  );
};
