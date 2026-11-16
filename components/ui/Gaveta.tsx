import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/** Painel lateral (gaveta) para editar sem esconder a lista: abre à direita, fecha com Esc ou clicando fora. */
export const Gaveta: React.FC<{ aberta: boolean; onClose: () => void; titulo: string; children: React.ReactNode; rodape?: React.ReactNode; largura?: string }> = ({ aberta, onClose, titulo, children, rodape, largura = 'max-w-xl' }) => {
  useEffect(() => {
    if (!aberta) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [aberta, onClose]);
  if (!aberta) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <button type="button" aria-label="Fechar painel" className="flex-1 cursor-default" onClick={onClose} tabIndex={-1} />
      <aside role="dialog" aria-modal="true" aria-label={titulo} className={`w-full ${largura} bg-white shadow-2xl flex flex-col h-full`}>
        <div className="flex items-center justify-between p-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800">{titulo}</h3>
          <button onClick={onClose} aria-label="Fechar (Esc)" title="Fechar (Esc)" className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">{children}</div>
        {rodape && <div className="p-4 border-t border-slate-100 bg-slate-50">{rodape}</div>}
      </aside>
    </div>
  );
};
