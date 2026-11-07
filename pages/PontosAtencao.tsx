import React, { useEffect, useMemo, useState } from 'react';
import { Auditoria } from './Auditoria';
import { Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { db } from '../services/db';
import { notify } from '../utils/notify';
import { Gravidade, PontoAtencao, TIPOS_PONTO } from '../utils/pontosAtencao';
import { AlvoPontos, COR_GRAVIDADE, PontoIcone, PontosModal } from '../components/PontosAtencao';
import { Button } from '../components/ui/Button';

interface Linha {
  alvo: 'fatura' | 'documento'; id: string; numero: string; cliente: string; detalhe: string;
  ponto: PontoAtencao; todos: PontoAtencao[];
}

const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';

const PontosLista: React.FC = () => {
  const { user } = useAuth();
  const podeEditar = user?.role !== UserRole.READ_ONLY;
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [fGrav, setFGrav] = useState<'' | Gravidade>('');
  const [fTipo, setFTipo] = useState('');
  const [fAlvo, setFAlvo] = useState('');
  const [fSituacao, setFSituacao] = useState<'pendentes' | 'resolvidos' | 'todos'>('pendentes');
  const [busca, setBusca] = useState('');
  const [alvo, setAlvo] = useState<AlvoPontos | null>(null);
  const [limite, setLimite] = useState(200);

  const carregar = async () => {
    setCarregando(true);
    try {
      const [faturas, docs] = await Promise.all([db.getInvoices(), db.getDocuments()]);
      const out: Linha[] = [];
      faturas.forEach(f => (f.pontos || []).forEach(p => out.push({
        alvo: 'fatura', id: f.id, numero: f.invoiceNumber, cliente: `${f.ug ? f.ug + ' ' : ''}${f.client}`,
        detalhe: [f.type, f.competence].filter(Boolean).join(' · '), ponto: p, todos: f.pontos || [],
      })));
      docs.forEach(d => (d.pontos || []).forEach(p => out.push({
        alvo: 'documento', id: d.id, numero: d.documentNumber, cliente: d.client, detalhe: `${d.documentType} · ${d.operation}`, ponto: p, todos: d.pontos || [],
      })));
      setLinhas(out);
      return { faturas, docs };
    } catch (e) {
      notify.fail('Erro ao carregar pontos de atenção', e);
      return null;
    } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  const pendentesTodas = linhas.filter(l => !l.ponto.resolvido);
  const contagem = (g: Gravidade) => pendentesTodas.filter(l => l.ponto.gravidade === g).length;
  const registrosComPendencia = new Set(pendentesTodas.map(l => l.alvo + l.id)).size;

  const porTipo = useMemo(() => {
    const m = new Map<string, number>();
    pendentesTodas.forEach(l => m.set(l.ponto.tipo, (m.get(l.ponto.tipo) || 0) + 1));
    const peso = { alta: 0, media: 1, baixa: 2 };
    return [...m.entries()].sort((a, b) => peso[(TIPOS_PONTO[a[0]]?.gravidade || 'media')] - peso[(TIPOS_PONTO[b[0]]?.gravidade || 'media')] || b[1] - a[1]);
  }, [linhas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const peso = { alta: 0, media: 1, baixa: 2 };
    return linhas.filter(l =>
      (fSituacao === 'todos' || (fSituacao === 'pendentes' ? !l.ponto.resolvido : !!l.ponto.resolvido))
      && (!fGrav || l.ponto.gravidade === fGrav) && (!fTipo || l.ponto.tipo === fTipo) && (!fAlvo || l.alvo === fAlvo)
      && (!q || `${l.numero} ${l.cliente} ${l.ponto.mensagem}`.toLowerCase().includes(q)))
      .sort((a, b) => peso[a.ponto.gravidade] - peso[b.ponto.gravidade] || a.ponto.tipo.localeCompare(b.ponto.tipo) || a.numero.localeCompare(b.numero));
  }, [linhas, fGrav, fTipo, fAlvo, fSituacao, busca]);

  const exportar = () => {
    const esc = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
    const cab = ['Gravidade', 'Ponto', 'Registro', 'Número', 'Cliente', 'Detalhe', 'Descrição', 'Como corrigir', 'Origem', 'Situação', 'Justificativa'];
    const rows = filtradas.map(l => [
      COR_GRAVIDADE[l.ponto.gravidade].rotulo, l.ponto.titulo, l.alvo === 'fatura' ? 'Fatura' : 'Documento', l.numero, l.cliente, l.detalhe,
      l.ponto.mensagem, l.ponto.comoCorrigir, l.ponto.automatico ? 'Automático' : 'Migração',
      l.ponto.resolvido ? `${l.ponto.automatico ? 'Ciente' : 'Resolvido'} ${l.ponto.resolvido.por || ''} ${l.ponto.resolvido.em || ''}`.trim() : 'Pendente',
      l.ponto.resolvido?.justificativa || '',
    ].map(esc).join(';'));
    const blob = new Blob(['﻿' + [cab.join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pontos_de_atencao_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const abrir = (l: Linha) => setAlvo({ alvo: l.alvo, id: l.id, titulo: l.numero, subtitulo: `${l.cliente} · ${l.detalhe}`, pontos: l.todos });

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Pontos de Atenção</h2>
          <p className="text-slate-500 text-sm max-w-3xl">
            Inconsistências que o sistema encontra sozinho em faturas e documentos (pago a maior, crédito usado a mais, vencimento inválido,
            número repetido...) e as anotadas na migração das planilhas. As automáticas somem quando o dado é corrigido; as demais ficam até
            alguém marcá-las como resolvidas, com justificativa.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={exportar} disabled={!filtradas.length}><Download size={14} className="mr-1" /> Exportar CSV</Button>
          <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-lg border border-slate-200 bg-white">
          <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">Registros com pendência</div>
          <div className="text-2xl font-bold text-slate-900 tabular-nums">{registrosComPendencia.toLocaleString('pt-BR')}</div>
        </div>
        {(['alta', 'media', 'baixa'] as Gravidade[]).map(g => (
          <button key={g} onClick={() => { setFGrav(fGrav === g ? '' : g); setFSituacao('pendentes'); }}
            className={`p-3 rounded-lg border text-left ${fGrav === g ? 'ring-2 ring-primary-500' : ''} ${COR_GRAVIDADE[g].fundo}`}>
            <div className="text-[11px] uppercase tracking-wide font-semibold">Gravidade {COR_GRAVIDADE[g].rotulo}</div>
            <div className="text-2xl font-bold tabular-nums">{contagem(g).toLocaleString('pt-BR')}</div>
          </button>
        ))}
      </div>

      {porTipo.length > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Pendências por tipo</h3>
          <div className="flex flex-wrap gap-2">
            {porTipo.map(([t, n]) => {
              const d = TIPOS_PONTO[t];
              const g = d?.gravidade || 'media';
              return (
                <button key={t} onClick={() => { setFTipo(fTipo === t ? '' : t); setFSituacao('pendentes'); }}
                  className={`text-xs px-2.5 py-1 rounded-full border ${COR_GRAVIDADE[g].fundo} ${fTipo === t ? 'ring-2 ring-primary-500' : ''}`}>
                  {d?.titulo || t} <b className="tabular-nums">{n}</b>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-wrap gap-2 items-end">
        <label className="flex-1 min-w-[200px] text-xs text-slate-600">Busca
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Número, cliente ou descrição..." className={`${sel} w-full mt-1`} />
        </label>
        <label className="text-xs text-slate-600">Situação
          <select value={fSituacao} onChange={e => setFSituacao(e.target.value as any)} className={`${sel} block mt-1`}>
            <option value="pendentes">Pendentes</option><option value="resolvidos">Resolvidos / ciente</option><option value="todos">Todos</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">Gravidade
          <select value={fGrav} onChange={e => setFGrav(e.target.value as any)} className={`${sel} block mt-1`}>
            <option value="">Todas</option><option value="alta">Alta</option><option value="media">Média</option><option value="baixa">Baixa</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">Tipo
          <select value={fTipo} onChange={e => setFTipo(e.target.value)} className={`${sel} block mt-1 max-w-[220px]`}>
            <option value="">Todos</option>
            {Object.entries(TIPOS_PONTO).map(([k, d]) => <option key={k} value={k}>{d.titulo}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Registro
          <select value={fAlvo} onChange={e => setFAlvo(e.target.value)} className={`${sel} block mt-1`}>
            <option value="">Faturas e documentos</option><option value="fatura">Faturas</option><option value="documento">ALTCRED / GRU</option>
          </select>
        </label>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {['', 'Ponto', 'Registro', 'Cliente', 'Descrição', 'Situação', ''].map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtradas.slice(0, limite).map((l, i) => (
                <tr key={`${l.alvo}${l.id}${i}`} className={l.ponto.resolvido ? 'bg-slate-50 text-slate-500' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2"><PontoIcone pontos={[{ ...l.ponto, resolvido: undefined }]} onClick={() => abrir(l)} /></td>
                  <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{l.ponto.titulo}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="font-mono text-xs">{l.numero || '(sem número)'}</div>
                    <div className="text-[11px] text-slate-500">{[l.alvo === 'fatura' ? 'Fatura' : 'Documento', l.detalhe].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={l.cliente}>{l.cliente}</td>
                  <td className="px-3 py-2 min-w-[280px]">{l.ponto.mensagem}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {l.ponto.resolvido
                      ? <span className="text-emerald-700" title={l.ponto.resolvido.justificativa}>{l.ponto.automatico ? 'Ciente' : 'Resolvido'}</span>
                      : <span className="text-slate-600">{l.ponto.automatico ? 'Pendente (automático)' : 'Pendente'}</span>}
                  </td>
                  <td className="px-3 py-2 text-right"><button className="text-xs font-semibold text-primary-700 hover:underline" onClick={() => abrir(l)}>Ver / resolver</button></td>
                </tr>
              ))}
              {!filtradas.length && !carregando && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Nenhum ponto de atenção com esses filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {filtradas.length > limite && (
          <div className="p-3 border-t border-slate-100 text-center">
            <Button size="sm" variant="ghost" onClick={() => setLimite(limite + 500)}>Mostrar mais ({filtradas.length - limite} restantes)</Button>
          </div>
        )}
      </div>

      <PontosModal alvo={alvo} onClose={() => setAlvo(null)} podeEditar={podeEditar} usuario={user?.name || user?.email || ''}
        onAlterado={async () => {
          const r = await carregar();
          if (!r) return;
          const novo = alvo?.alvo === 'fatura' ? r.faturas.find(f => f.id === alvo.id)?.pontos : r.docs.find(d => d.id === alvo?.id)?.pontos;
          setAlvo(a => (a ? { ...a, pontos: novo || [] } : a));
        }} />
    </div>
  );
};

/** Pontos de Atenção: inconsistências encontradas automaticamente + histórico de alterações (trilha de auditoria). */
export const PontosAtencaoPage: React.FC<{ abaInicial?: 'pontos' | 'historico' }> = ({ abaInicial = 'pontos' }) => {
  const [aba, setAba] = useState<'pontos' | 'historico'>(abaInicial);
  return (
    <div className="space-y-4">
      <div className="flex space-x-1 border-b border-slate-200" role="tablist">
        {([['pontos', 'Inconsistências a corrigir'], ['historico', 'Histórico de alterações (quem alterou o quê)']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${aba === k ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{l}</button>
        ))}
      </div>
      {aba === 'pontos' ? <PontosLista /> : <Auditoria embutido />}
    </div>
  );
};
