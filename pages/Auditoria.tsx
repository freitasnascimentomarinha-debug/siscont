import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Campo, entrada } from '../components/faturamento/comum';
import { ListaAlteracoes } from '../components/auditoria/Historico';
import { Fase7NaoInstaladaError, FiltroAuditoria, listarAuditoria } from '../services/auditoriaService';
import { ACOES, RegistroAuditoria, TABELAS_AUDITADAS, resumo } from '../utils/auditoria';

const POR = 50;

/** Trilha de auditoria: quem alterou o quê e quando (gravada por gatilhos no banco, não pode ser editada pela aplicação). */
export const Auditoria: React.FC<{ embutido?: boolean }> = ({ embutido }) => {
  const [f, setF] = useState<FiltroAuditoria>({});
  const [pagina, setPagina] = useState(0);
  const [dados, setDados] = useState<{ linhas: RegistroAuditoria[]; total: number } | null>(null);
  const [aberto, setAberto] = useState<number | null>(null);
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = async (p = pagina) => {
    setCarregando(true); setErro(null);
    try { setDados(await listarAuditoria({ ...f, pagina: p, porPagina: POR })); setNaoInstalado(false); }
    catch (e: any) { if (e instanceof Fase7NaoInstaladaError) setNaoInstalado(true); else setErro(e?.message || 'Erro ao carregar.'); }
    finally { setCarregando(false); }
  };
  useEffect(() => { setPagina(0); carregar(0); }, [f]);
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / POR)) : 1;
  const ir = (p: number) => { setPagina(p); carregar(p); };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          {!embutido && <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><ShieldCheck size={24} className="text-primary-600" />Auditoria</h2>}
          <p className="text-slate-500 text-sm max-w-3xl">Toda inclusão, alteração e exclusão em faturas, baixas, ALTCRED/GRU, saídas, contestações, lotes, preços, parâmetros, taxa condominial e usuários fica registrada aqui com usuário, data/hora e o valor anterior e o novo. O registro é feito pelo próprio banco e não pode ser apagado pela aplicação.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => carregar()} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Recarregar</Button>
      </div>
      {naoInstalado && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-3" role="alert">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div><p className="font-bold">Auditoria ainda não instalada no banco</p><p>Execute o script <code className="bg-amber-100 px-1 rounded">supabase/migrations/010_rotinas_anuais_auditoria.sql</code> no Supabase e clique em Recarregar. O registro começa a partir da instalação.</p></div>
        </div>
      )}
      {erro && <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{erro}</div>}
      <div className="flex flex-wrap gap-3 items-end bg-white p-3 rounded-xl border border-slate-200">
        <Campo rotulo="O quê"><select className={entrada} value={f.tabela || ''} onChange={e => setF({ ...f, tabela: e.target.value || undefined })} aria-label="Tabela">
          <option value="">tudo</option>{Object.entries(TABELAS_AUDITADAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></Campo>
        <Campo rotulo="Ação"><select className={entrada} value={f.acao || ''} onChange={e => setF({ ...f, acao: e.target.value || undefined })} aria-label="Ação">
          <option value="">todas</option>{Object.entries(ACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></Campo>
        <Campo rotulo="Usuário (e-mail)"><input className={entrada} defaultValue={f.usuario} onBlur={e => setF({ ...f, usuario: e.target.value.trim() || undefined })} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Usuário" /></Campo>
        <Campo rotulo="Registro (id)"><input className={`${entrada} w-72`} defaultValue={f.registroId} onBlur={e => setF({ ...f, registroId: e.target.value.trim() || undefined })} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} aria-label="Registro" /></Campo>
        <Campo rotulo="De"><input type="date" className={entrada} value={f.de || ''} onChange={e => setF({ ...f, de: e.target.value || undefined })} aria-label="Data inicial" /></Campo>
        <Campo rotulo="Até"><input type="date" className={entrada} value={f.ate || ''} onChange={e => setF({ ...f, ate: e.target.value || undefined })} aria-label="Data final" /></Campo>
      </div>
      {dados && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs"><tr><th className="px-3 py-2 text-left">Quando</th><th className="px-3 text-left">Usuário</th><th className="px-3 text-left">O quê</th><th className="px-3 text-left">Ação</th><th className="px-3 text-left">Alterações</th></tr></thead>
            <tbody>
              {dados.linhas.map(l => (
                <React.Fragment key={l.id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setAberto(aberto === l.id ? null : l.id)}>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(l.em).toLocaleString('pt-BR')}</td>
                    <td className="px-3 text-xs">{l.usuarioEmail || 'sistema'}</td>
                    <td className="px-3 text-xs">{TABELAS_AUDITADAS[l.tabela] || l.tabela}{(l.depois?.invoice_number || l.antes?.invoice_number) && <span className="text-slate-500"> · {l.depois?.invoice_number || l.antes?.invoice_number}</span>}</td>
                    <td className="px-3 text-xs">{ACOES[l.acao]}</td>
                    <td className="px-3 text-xs text-slate-600">{resumo(l)}</td>
                  </tr>
                  {aberto === l.id && <tr><td colSpan={5} className="px-3 pb-3"><ListaAlteracoes linhas={[l]} mostrarRegistro /></td></tr>}
                </React.Fragment>
              ))}
              {!dados.linhas.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Nenhum registro.</td></tr>}
            </tbody>
          </table>
          <div className="flex justify-between items-center px-3 py-2 border-t border-slate-100 text-xs text-slate-500">
            <span>{dados.total} registro(s)</span>
            <div className="flex gap-2 items-center">
              <Button size="sm" variant="ghost" disabled={pagina === 0} onClick={() => ir(pagina - 1)}>Anterior</Button>
              <span>{pagina + 1} / {paginas}</span>
              <Button size="sm" variant="ghost" disabled={pagina + 1 >= paginas} onClick={() => ir(pagina + 1)}>Próxima</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
