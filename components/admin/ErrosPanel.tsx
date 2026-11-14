import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, CheckCircle2, Trash2, AlertTriangle } from 'lucide-react';
import { ErroSistema, errosService } from '../../services/errosService';
import { Button } from '../ui/Button';

/** Administração › Erros: o que deu errado na tela dos usuários (registrado sozinho pelo sistema). */
export const ErrosPanel: React.FC = () => {
  const [lista, setLista] = useState<ErroSistema[] | null>(null);
  const [problema, setProblema] = useState('');
  const [verResolvidos, setVerResolvidos] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setProblema('');
    try { setLista(await errosService.listar()); }
    catch (e) {
      const m = String((e as { message?: string })?.message || e);
      setProblema(/erros_sistema|does not exist|relation/i.test(m) ? 'O registro de erros ainda não foi ativado no banco (rode o script 037 no SQL Editor do Supabase).' : 'Não consegui ler os erros: ' + m);
      setLista([]);
    }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);

  const visiveis = useMemo(() => (lista || []).filter(e => verResolvidos || !e.resolvido), [lista, verResolvidos]);
  const abertos = (lista || []).filter(e => !e.resolvido).length;
  const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  const alternar = async (e: ErroSistema) => { try { await errosService.marcarResolvido(e.id, !e.resolvido); await carregar(); } catch { setProblema('Não consegui atualizar o erro.'); } };
  const limpar = async () => { if (!window.confirm('Apagar todos os erros já marcados como resolvidos?')) return; try { await errosService.apagarResolvidos(); await carregar(); } catch { setProblema('Não consegui apagar.'); } };

  return (
    <div className="p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600 flex-1 min-w-[16rem]">O sistema anota sozinho os erros que aparecem na tela dos usuários (página, quem e quando). Marque como resolvido quando tratar.</p>
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={verResolvidos} onChange={ev => setVerResolvidos(ev.target.checked)} /> Mostrar resolvidos</label>
        <Button size="sm" variant="secondary" onClick={carregar}><RefreshCw className="mr-2 h-4 w-4" />Atualizar</Button>
        <Button size="sm" variant="secondary" onClick={limpar}><Trash2 className="mr-2 h-4 w-4" />Apagar resolvidos</Button>
      </div>
      {problema && <div role="alert" className="p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800 text-sm flex gap-2"><AlertTriangle size={16} className="shrink-0 mt-0.5" />{problema}</div>}
      {lista && !problema && (
        <p className="text-sm font-semibold text-slate-700">{abertos === 0 ? 'Nenhum erro em aberto.' : `${abertos} erro(s) em aberto.`}</p>
      )}
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
        {visiveis.map(e => (
          <li key={e.id} className={`p-3 text-sm ${e.resolvido ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex-1 min-w-[14rem]">
                <p className="font-semibold text-slate-800 break-words">{e.mensagem}</p>
                <p className="text-xs text-slate-500">{quando(e.criado_em)} · {e.email || 'usuário não identificado'} · página: {e.pagina || '—'}</p>
              </div>
              {e.detalhe && <button className="text-xs text-primary-700 underline" onClick={() => setAberto(aberto === e.id ? null : e.id)}>{aberto === e.id ? 'Ocultar detalhe' : 'Ver detalhe'}</button>}
              <button className="text-xs flex items-center gap-1 text-emerald-700" onClick={() => alternar(e)}><CheckCircle2 size={14} />{e.resolvido ? 'Reabrir' : 'Marcar resolvido'}</button>
            </div>
            {aberto === e.id && e.detalhe && <pre className="mt-2 p-2 bg-slate-50 rounded text-xs whitespace-pre-wrap break-words max-h-48 overflow-auto">{e.detalhe}</pre>}
          </li>
        ))}
        {lista && !visiveis.length && <li className="p-4 text-sm text-slate-500">Nada para mostrar.</li>}
      </ul>
    </div>
  );
};
