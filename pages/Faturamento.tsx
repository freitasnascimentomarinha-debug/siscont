import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { ContextoFaturamento, Fase3NaoInstaladaError, carregarContexto, listarLotes } from '../services/faturamentoService';
import { LoteTab } from '../components/faturamento/LoteTab';
import { MedicoesTab } from '../components/faturamento/MedicoesTab';
import { AtracacaoTab } from '../components/faturamento/AtracacaoTab';
import { PrecosTab } from '../components/faturamento/PrecosTab';
import { LotesEmitidos } from '../components/faturamento/LotesEmitidos';
import { CorrecaoTab } from '../components/faturamento/CorrecaoTab';
import { Button } from '../components/ui/Button';

type Aba = 'lote' | 'medicoes' | 'atracacao' | 'precos' | 'correcao';
const ABAS: { id: Aba; label: string }[] = [
  { id: 'lote', label: 'Lote de faturas' },
  { id: 'medicoes', label: 'Medições do mês' },
  { id: 'atracacao', label: 'Atracação (BNIC-35)' },
  { id: 'precos', label: 'Preços do ano' },
  { id: 'correcao', label: 'Correção por atraso (OI 6.2)' },
];

export const Faturamento: React.FC = () => {
  const { user } = useAuth();
  const podeEditar = user?.role !== UserRole.READ_ONLY;
  const [aba, setAba] = useState<Aba>('lote');
  const [ctx, setCtx] = useState<ContextoFaturamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [versao, setVersao] = useState(0);

  const carregar = async () => {
    setCarregando(true); setErro(null);
    try {
      await listarLotes(); // confirma que o script 007 foi executado
      setCtx(await carregarContexto());
      setVersao(v => v + 1);
    } catch (e: any) {
      if (e instanceof Fase3NaoInstaladaError) setNaoInstalado(true);
      else setErro(e?.message || 'Erro ao carregar.');
    } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Faturamento</h2>
          <p className="text-slate-500 text-sm max-w-3xl">Ciclo mensal: lance as medições das divisões e o mapa de atracação, mantenha os preços do ano e emita o lote — numeração automática, emissão no dia 15, data-limite em dias úteis e abatimento do adiantamento. Também o lote estimado de fim de exercício (OND) e o acerto no ano seguinte.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Recarregar</Button>
      </div>
      {naoInstalado && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-3" role="alert">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div><p className="font-bold">Faturamento ainda não instalado no banco</p><p>Execute o script <code className="bg-amber-100 px-1 rounded">supabase/migrations/007_faturamento_fase3.sql</code> no Supabase (SQL Editor → New query → colar → Run) e clique em Recarregar.</p></div>
        </div>
      )}
      {erro && <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{erro}</div>}
      {ctx && !naoInstalado && (
        <>
          <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto">
            {ABAS.map(a => (
              <button key={a.id} onClick={() => setAba(a.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${aba === a.id ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{a.label}</button>
            ))}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 space-y-6">
            {aba === 'lote' && <>
              <LoteTab ctx={ctx} usuario={user?.name || user?.email || ''} podeEditar={podeEditar} onEmitido={carregar} />
              <LotesEmitidos ctx={ctx} podeEditar={podeEditar} versao={versao} recarregar={carregar} />
            </>}
            {aba === 'medicoes' && <MedicoesTab ctx={ctx} podeEditar={podeEditar} />}
            {aba === 'atracacao' && <AtracacaoTab ctx={ctx} podeEditar={podeEditar} />}
            {aba === 'precos' && <PrecosTab ctx={ctx} podeEditar={podeEditar} />}
            {aba === 'correcao' && <CorrecaoTab ctx={ctx} podeEditar={podeEditar} usuario={user?.name || user?.email || ''} onEmitido={carregar} />}
          </div>
        </>
      )}
    </div>
  );
};
