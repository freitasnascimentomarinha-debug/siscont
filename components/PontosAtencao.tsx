import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, RotateCcw } from 'lucide-react';
import { Gravidade, pendentes, PontoAtencao } from '../utils/pontosAtencao';
import { db } from '../services/db';
import { notify } from '../utils/notify';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';

export const COR_GRAVIDADE: Record<Gravidade, { texto: string; fundo: string; rotulo: string }> = {
  alta: { texto: 'text-red-600', fundo: 'bg-red-50 border-red-200 text-red-700', rotulo: 'Alta' },
  media: { texto: 'text-amber-500', fundo: 'bg-amber-50 border-amber-200 text-amber-800', rotulo: 'Média' },
  baixa: { texto: 'text-sky-500', fundo: 'bg-sky-50 border-sky-200 text-sky-800', rotulo: 'Baixa' },
};

const ICONE: Record<Gravidade, React.FC<{ size?: number; className?: string }>> = { alta: AlertOctagon, media: AlertTriangle, baixa: Info };

export const piorGravidade = (p: PontoAtencao[]): Gravidade | null =>
  p.some(x => x.gravidade === 'alta') ? 'alta' : p.some(x => x.gravidade === 'media') ? 'media' : p.length ? 'baixa' : null;

const dataBR = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** Ícone na linha da tabela: cor pela pior gravidade pendente e número de pontos. Clique abre o detalhe. */
export const PontoIcone: React.FC<{ pontos?: PontoAtencao[]; onClick: () => void }> = ({ pontos, onClick }) => {
  const abertos = pendentes(pontos);
  const g = piorGravidade(abertos);
  if (!g) return null;
  const Icone = ICONE[g];
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onClick(); }} data-testid="ponto-atencao"
      className={`inline-flex items-center gap-0.5 align-middle ${COR_GRAVIDADE[g].texto} hover:opacity-80`}
      title={`Pontos de atenção:\n${abertos.map(p => `• ${p.titulo}: ${p.mensagem}`).join('\n')}`}
      aria-label={`${abertos.length} ponto(s) de atenção`}>
      <Icone size={16} />
      {abertos.length > 1 && <span className="text-[10px] font-bold">{abertos.length}</span>}
    </button>
  );
};

export interface AlvoPontos { alvo: 'fatura' | 'documento'; id: string; titulo: string; subtitulo?: string; pontos: PontoAtencao[] }

/** Janela com cada ponto: problema, como corrigir e o botão de resolver/ciente (com justificativa). */
export const PontosModal: React.FC<{
  alvo: AlvoPontos | null; onClose: () => void; podeEditar: boolean; usuario: string; onAlterado: () => void | Promise<void>;
}> = ({ alvo, onClose, podeEditar, usuario, onAlterado }) => {
  const [resolvendo, setResolvendo] = useState<number | null>(null);
  const [justificativa, setJustificativa] = useState('');
  const [gravando, setGravando] = useState(false);
  if (!alvo) return null;

  const resolver = async (p: PontoAtencao) => {
    setGravando(true);
    try {
      await db.resolverPonto(alvo.alvo, alvo.id, p, usuario, justificativa);
      notify.success(p.automatico ? 'Ponto marcado como ciente.' : 'Ponto marcado como resolvido.');
      setResolvendo(null); setJustificativa('');
      await onAlterado();
    } catch (e) { notify.fail('Não foi possível gravar', e); } finally { setGravando(false); }
  };
  const reabrirPonto = async (p: PontoAtencao) => {
    setGravando(true);
    try { await db.reabrirPonto(alvo.alvo, alvo.id, p); notify.success('Ponto reaberto.'); await onAlterado(); }
    catch (e) { notify.fail('Não foi possível reabrir', e); } finally { setGravando(false); }
  };

  return (
    <Modal isOpen onClose={() => { setResolvendo(null); onClose(); }} title={`Pontos de atenção — ${alvo.titulo}`} maxWidth="max-w-2xl">
      {alvo.subtitulo && <p className="text-sm text-slate-500 -mt-2 mb-4">{alvo.subtitulo}</p>}
      {alvo.pontos.length === 0 && <p className="text-sm text-slate-500">Nenhum ponto de atenção.</p>}
      <ul className="space-y-3">
        {alvo.pontos.map((p, i) => {
          const Icone = p.resolvido ? CheckCircle2 : ICONE[p.gravidade];
          return (
            <li key={i} className={`rounded-lg border p-3 ${p.resolvido ? 'bg-slate-50 border-slate-200' : COR_GRAVIDADE[p.gravidade].fundo}`}>
              <div className="flex items-start gap-2">
                <Icone size={18} className={`shrink-0 mt-0.5 ${p.resolvido ? 'text-emerald-600' : COR_GRAVIDADE[p.gravidade].texto}`} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">{p.titulo}</span>
                    <span className="text-[10px] uppercase font-bold tracking-wide text-slate-500">gravidade {COR_GRAVIDADE[p.gravidade].rotulo}</span>
                    <span className="text-[10px] text-slate-500">{p.automatico ? '· detectado automaticamente' : `· anotado na ${p.origem === 'migracao' ? 'migração' : 'gravação'}${p.em ? ` em ${dataBR(p.em)}` : ''}`}</span>
                  </div>
                  <p className="text-sm text-slate-800">{p.mensagem}</p>
                  <p className="text-xs text-slate-600"><b>Como corrigir:</b> {p.comoCorrigir}</p>
                  {p.automatico && !p.resolvido && <p className="text-[11px] text-slate-500">Some sozinho quando o dado for corrigido.</p>}
                  {p.resolvido && (
                    <p className="text-xs text-emerald-800">
                      {p.automatico ? 'Ciente' : 'Resolvido'}{p.resolvido.por ? ` por ${p.resolvido.por}` : ''}{p.resolvido.em ? ` em ${dataBR(p.resolvido.em)}` : ''}
                      {p.resolvido.justificativa ? ` — "${p.resolvido.justificativa}"` : ''}
                    </p>
                  )}
                  {podeEditar && !p.resolvido && resolvendo !== i && (
                    <button className="text-xs font-semibold text-primary-700 hover:underline" onClick={() => { setResolvendo(i); setJustificativa(''); }}>
                      {p.automatico ? 'Estou ciente (manter assim)' : 'Marcar como resolvido'}
                    </button>
                  )}
                  {podeEditar && p.resolvido && (
                    <button className="text-xs font-semibold text-slate-600 hover:underline inline-flex items-center gap-1" onClick={() => reabrirPonto(p)} disabled={gravando}>
                      <RotateCcw size={12} /> Reabrir
                    </button>
                  )}
                  {resolvendo === i && (
                    <div className="mt-2 space-y-2">
                      <textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} rows={2} autoFocus
                        aria-label="Justificativa"
                        placeholder={p.automatico ? 'Por que está correto assim? (ex.: excedente devolvido por GRU nº...)' : 'O que foi feito? (ex.: conferido no SIPLAD, vencimento correto)'}
                        className="w-full text-sm border border-slate-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => resolver(p)} isLoading={gravando}>Confirmar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setResolvendo(null)} disabled={gravando}>Cancelar</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
};
