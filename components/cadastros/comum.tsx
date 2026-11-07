import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { formatarDataBR } from '../../utils/diasUteis';

export const hoje = () => new Date().toISOString().slice(0, 10);

export const Situacao: React.FC<{ ativo: boolean; desde?: string | null; motivo?: string | null }> = ({ ativo, desde, motivo }) =>
  ativo ? (
    <span className="inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">Ativo</span>
  ) : (
    <span className="inline-flex whitespace-nowrap px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-600" title={motivo || undefined}>
      Desativado{desde ? ` em ${formatarDataBR(desde)}` : ''}
    </span>
  );

export const Busca: React.FC<{ value: string; onChange: (v: string) => void; placeholder?: string }> = ({ value, onChange, placeholder }) => (
  <div className="relative">
    <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder || 'Buscar'}
      aria-label={placeholder || 'Buscar'}
      className="pl-8 pr-3 h-8 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 w-64 max-w-full"
    />
  </div>
);

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th className={`px-3 py-2.5 text-${right ? 'right' : 'left'} text-[11px] font-semibold text-slate-500 uppercase tracking-wide`}>{children}</th>
);

export const Td: React.FC<{ children?: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`px-3 py-2.5 text-sm text-slate-700 align-top ${className}`}>{children}</td>
);

export const Filtro: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }> = ({ label, value, onChange, options }) => (
  <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="h-8 text-sm rounded-md border border-slate-300 px-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
    {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
);

/** Pede data e motivo para desativar (o registro e o histórico são mantidos). */
export const DesativarModal: React.FC<{
  aberto: boolean;
  titulo: string;
  descricao: React.ReactNode;
  onCancelar: () => void;
  onConfirmar: (data: string, motivo: string) => Promise<void>;
}> = ({ aberto, titulo, descricao, onCancelar, onConfirmar }) => {
  const [data, setData] = useState(hoje());
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setData(hoje()); setMotivo(''); setErro(null); } }, [aberto]);
  const confirmar = async () => {
    if (!data) return setErro('Informe a data de desativação.');
    setSalvando(true);
    try { await onConfirmar(data, motivo.trim()); } catch (e: any) { setErro(e?.message || 'Erro ao desativar.'); } finally { setSalvando(false); }
  };
  return (
    <Modal isOpen={aberto} onClose={() => !salvando && onCancelar()} title={titulo}>
      <div className="space-y-4">
        <div className="text-sm text-slate-600">{descricao}</div>
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded p-2">O cadastro e todo o histórico (faturas, dias atracados, médias) são mantidos. A partir da data, o registro deixa de aparecer nas listas de emissão e no rateio.</p>
        {erro && <div className="p-2 text-xs rounded bg-red-50 text-red-700 border border-red-100" role="alert">{erro}</div>}
        <Input label="Data de desativação" type="date" value={data} onChange={e => setData(e.target.value)} disabled={salvando} />
        <Input label="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: Baixa do serviço ativo" disabled={salvando} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
          <Button variant="danger" onClick={confirmar} isLoading={salvando}>Desativar</Button>
        </div>
      </div>
    </Modal>
  );
};
