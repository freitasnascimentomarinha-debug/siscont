import React from 'react';
import { FileDown } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Modelo } from '../../utils/modelos';

/** Gera o .xlsx do modelo (com a aba INSTRUÇÕES primeiro). */
export function baixarModelo(m: Modelo) {
  const wb = XLSX.utils.book_new();
  const inst = XLSX.utils.aoa_to_sheet([[m.titulo], [''], ...m.instrucoes.map((t, i) => [`${i + 1}. ${t}`])]);
  inst['!cols'] = [{ wch: 140 }];
  XLSX.utils.book_append_sheet(wb, inst, 'INSTRUÇÕES');
  m.abas.forEach(a => {
    const ws = XLSX.utils.aoa_to_sheet(a.linhas);
    if (a.larguras) ws['!cols'] = a.larguras.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, a.nome.slice(0, 31));
  });
  XLSX.writeFile(wb, m.arquivo);
}

/** Botão "Planilha modelo" ao lado de cada importação. */
export const BaixarModelo: React.FC<{ modelo: () => Modelo; rotulo?: string; className?: string }> = ({ modelo, rotulo = 'Planilha modelo', className }) => (
  <button type="button" onClick={() => baixarModelo(modelo())} title="Baixar a planilha modelo (com instruções) no formato que o SISCONT importa"
    className={`inline-flex items-center gap-1 text-sm font-medium text-primary-700 hover:text-primary-900 underline-offset-2 hover:underline ${className || ''}`}>
    <FileDown size={15} />{rotulo}
  </button>
);
