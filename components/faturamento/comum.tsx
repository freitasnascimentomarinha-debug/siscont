import React from 'react';
import { pad } from '../../utils/faturamento';

export const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const entrada = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';
export const compAtual = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };

export const Campo: React.FC<{ rotulo: string; children: React.ReactNode; className?: string }> = ({ rotulo, children, className }) => (
  <label className={`text-xs text-slate-600 flex flex-col gap-1 ${className || ''}`}>{rotulo}{children}</label>
);

export const lerArquivo = (f: File) => new Promise<ArrayBuffer>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as ArrayBuffer);
  r.onerror = () => rej(new Error(`Não foi possível ler ${f.name}.`));
  r.readAsArrayBuffer(f);
});

export const Aviso: React.FC<{ tom?: 'amber' | 'red' | 'slate' | 'emerald'; children: React.ReactNode }> = ({ tom = 'amber', children }) => {
  const c = { amber: 'border-amber-200 bg-amber-50 text-amber-900', red: 'border-red-200 bg-red-50 text-red-800', slate: 'border-slate-200 bg-slate-50 text-slate-700', emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800' }[tom];
  return <div className={`p-3 rounded-lg border text-sm ${c}`}>{children}</div>;
};
