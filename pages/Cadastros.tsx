import React, { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { Button } from '../components/ui/Button';
import { useCadastros } from '../components/cadastros/useCadastros';
import { OmsTab } from '../components/cadastros/OmsTab';
import { ClassesTab, ComandosTab, SetoresTab } from '../components/cadastros/EstruturaTabs';
import { ParametrosTab, ServicosTab } from '../components/cadastros/ConfigTabs';
import { ImportarTab } from '../components/cadastros/ImportarTab';
import { MigrarFaturasTab } from '../components/cadastros/MigrarFaturasTab';

type Aba = 'oms' | 'comandos' | 'setores' | 'classes' | 'servicos' | 'parametros' | 'importar' | 'migrar';

const ABAS: { id: Aba; label: string; admin?: boolean }[] = [
  { id: 'oms', label: 'OM / Clientes' },
  { id: 'comandos', label: 'Comandos' },
  { id: 'setores', label: 'Setores' },
  { id: 'classes', label: 'Classes de navio' },
  { id: 'servicos', label: 'Serviços' },
  { id: 'parametros', label: 'Parâmetros e feriados' },
  { id: 'importar', label: 'Importar planilhas', admin: true },
  { id: 'migrar', label: 'Migrar faturas', admin: true },
];

export const Cadastros: React.FC = () => {
  const { user } = useAuth();
  const admin = user?.role === UserRole.ADMIN;
  const [aba, setAba] = useState<Aba>('oms');
  const { dados, carregando, erro, naoInstalado, recarregar } = useCadastros();

  const ativas = dados.oms.filter(o => o.ativo).length;
  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Cadastros</h2>
          <p className="text-slate-500 text-sm">
            Setor → Comando → OM, classes de navio, serviços da OI 40-04, parâmetros e feriados.
            {!carregando && !naoInstalado && <> {ativas} OM ativas de {dados.oms.length} · {dados.comandos.length} comandos · {dados.classes.length} classes.</>}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={recarregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Recarregar</Button>
      </div>

      {naoInstalado && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-3" role="alert">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div>
            <p className="font-bold">Cadastros da Fase 1 ainda não instalados no banco</p>
            <p>Um administrador precisa executar o script <code className="bg-amber-100 px-1 rounded">supabase/migrations/002_cadastros_fase1.sql</code> no Supabase (SQL Editor → New query → colar → Run). Enquanto isso, as telas de faturas continuam usando a lista antiga de clientes.</p>
          </div>
        </div>
      )}
      {erro && <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{erro}</div>}

      {!naoInstalado && (
        <>
          <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto">
            {ABAS.filter(a => !a.admin || admin).map(a => (
              <button key={a.id} onClick={() => setAba(a.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${aba === a.id ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {a.label}
              </button>
            ))}
          </div>
          {!admin && <p className="text-xs text-slate-500">Somente administradores alteram os cadastros.</p>}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
            {aba === 'oms' && <OmsTab dados={dados} podeEditar={admin} recarregar={recarregar} />}
            {aba === 'comandos' && <ComandosTab dados={dados} podeEditar={admin} recarregar={recarregar} />}
            {aba === 'setores' && <SetoresTab dados={dados} podeEditar={admin} recarregar={recarregar} />}
            {aba === 'classes' && <ClassesTab dados={dados} podeEditar={admin} recarregar={recarregar} />}
            {aba === 'servicos' && <ServicosTab dados={dados} podeEditar={admin} recarregar={recarregar} />}
            {aba === 'parametros' && <ParametrosTab podeEditar={admin} />}
            {aba === 'importar' && admin && <ImportarTab dados={dados} podeEditar={admin} recarregar={recarregar} />}
            {aba === 'migrar' && admin && <MigrarFaturasTab dados={dados} podeEditar={admin} />}
          </div>
        </>
      )}
    </div>
  );
};
