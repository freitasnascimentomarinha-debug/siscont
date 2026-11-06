import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { notify, Toast } from '../../utils/notify';

const STYLES = {
  error: 'bg-red-50 border-red-200 text-red-800',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};
const ICONS = { error: AlertTriangle, success: CheckCircle2, info: Info };

export const Toaster: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => notify.subscribe(t => {
    setToasts(prev => [...prev.slice(-3), t]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), t.type === 'error' ? 9000 : 4500);
  }), []);

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)]" aria-live="polite">
      {toasts.map(t => {
        const Icon = ICONS[t.type];
        return (
          <div key={t.id} className={`flex items-start gap-2 p-3 rounded-lg border shadow-lg text-sm ${STYLES[t.type]}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <Icon size={16} className="shrink-0 mt-0.5" />
            <span className="flex-1">{t.text}</span>
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} className="opacity-60 hover:opacity-100"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
};
