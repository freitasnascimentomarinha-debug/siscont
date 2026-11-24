import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, RotateCcw } from 'lucide-react';
import { DetalheBaixaFora, DetalheCitadaInexistente, Gravidade, pendentes, PontoAtencao } from '../utils/pontosAtencao';
import { db } from '../services/db';
import { notify } from '../utils/notify';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { CorrigirAgora } from './pontos/CorrigirAgora';

const brlP = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Baixa fora da destinação" explicada passo a passo: o que a OM pediu × onde demos baixa, e o que fazer. */
const DetalheBaixaForaView: React.FC<{ d: DetalheBaixaFora }> = ({ d }) => (
  <div className="space-y-3 text-sm" data-testid="detalhe-baixa-fora">
    <p className="text-slate-800">O dinheiro desta ALTCRED foi usado para pagar faturas <b>diferentes das que a OM pediu</b>. Compare as duas listas:</p>
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-sky-800 mb-1.5">1 · O que a OM pediu para pagar</div>
        <ul className="space-y-1.5">
          {d.indicadas.map(i => (
            <li key={i.numero} className="flex flex-wrap items-center justify-between gap-1">
              <span className="font-mono text-xs text-slate-900">{i.numero}</span>
              {i.inexistente
                ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-800">∅ não existe no sistema</span>
                : !i.baixada && i.outrasAltcreds?.length
                  ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-violet-100 text-violet-900" title="A fatura que a OM pediu para pagar com este crédito já recebeu baixa de outra ALTCRED">{i.quitada ? '✔ já quitada por outra ALTCRED' : '◐ já recebeu baixa de outra ALTCRED'}: {i.outrasAltcreds.map(o => `${o.numero} (${brlP(o.valor)})`).join(', ')}</span>
                : i.baixada
                  ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">✔ já recebeu baixa</span>
                  : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">⚠ ainda sem baixa</span>}
            </li>
          ))}
          {d.omsIndicadas > 0 && <li className="text-xs text-slate-700">+ todas as faturas de {d.omsIndicadas} OM indicada(s)</li>}
          {!d.indicadas.length && !d.omsIndicadas && <li className="text-xs text-slate-500">Nenhuma fatura citada.</li>}
        </ul>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-700 mb-1.5">2 · Onde nós demos baixa</div>
        <ul className="space-y-1.5">
          {d.baixas.map(b => (
            <li key={b.numero} className="flex flex-wrap items-center justify-between gap-1">
              <span><span className="font-mono text-xs text-slate-900">{b.numero}</span> <span className="text-xs text-slate-600">{brlP(b.valor)}</span></span>
              {b.indicada
                ? <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">✔ estava no pedido</span>
                : <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-800">✘ fora do pedido</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
    {d.observacao && (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">O que a OM escreveu no SIPLAD</div>
        <p className="text-xs text-slate-700 italic">“{d.observacao}”</p>
      </div>
    )}
    <div className="rounded-lg border border-amber-200 bg-white p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800 mb-1">O que fazer</div>
      <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-800">
        <li>Veja se a baixa marcada <b>✘ fora do pedido</b> está errada (ex.: engano de número da fatura).</li>
        {d.indicadas.some(i => !i.baixada && i.outrasAltcreds?.length) && <li><b>Fatura pedida já paga por outra ALTCRED</b> (selo roxo): isso explica por que este crédito foi aplicado em outra fatura. Confira se a OM não mandou o mesmo pagamento duas vezes; se sim, informe o motivo e, se o valor ficou a mais, trate como adiantamento/estorno.</li>}
        <li><b>Se está errada:</b> clique em <b>remover</b> nessa baixa (quadro abaixo) e depois dê a baixa na fatura certa, em <i>Créditos recebidos › Pagar faturas</i>.</li>
        <li><b>Se está certa</b> (a OM confirmou, ou a fatura pedida já estava paga): clique em <b>“Informar o motivo (manter assim)”</b> e escreva por que pagamos diferente.</li>
      </ol>
    </div>
  </div>
);

/** "A OM citou uma fatura que não existe no sistema": mostra a citada, as parecidas e o que fazer. */
const DetalheCitadaInexistenteView: React.FC<{ d: DetalheCitadaInexistente }> = ({ d }) => (
  <div className="space-y-3 text-sm" data-testid="detalhe-citada-inexistente">
    <p className="text-slate-800">A OM escreveu o número de uma fatura que <b>não existe no sistema</b>. Pode ser <b>erro de digitação da OM</b> ou uma fatura que ainda não foi lançada.{d.itens.some(i => i.parecidas.some(p => p.baixadoAqui > 0.005)) && <> Mesmo assim, <b>a baixa já foi dada</b> na fatura mais parecida; falta só confirmar.</>}</p>
    {d.itens.map(it => (
      <div key={it.citada} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600">A OM citou</span>
          <span className="font-mono text-xs text-slate-900">{it.citada}</span>
          <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 text-slate-800">∅ não existe no sistema</span>
        </div>
        {(() => {
          const aplicadas = it.parecidas.filter(p => p.baixadoAqui > 0.005), livres = it.parecidas.filter(p => p.baixadoAqui <= 0.005);
          if (!it.parecidas.length) return <p className="text-xs text-slate-600">Não há fatura parecida (mesmo cliente, serviço e mês) no sistema.</p>;
          return (
            <div className="space-y-2">
              {aplicadas.length > 0 && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800 mb-1">Este crédito já foi aplicado em (mesmo cliente, serviço e mês)</div>
                  <ul className="space-y-1">
                    {aplicadas.map(p => (
                      <li key={p.numero} className="flex flex-wrap items-center justify-between gap-1">
                        <span><span className="font-mono text-xs text-slate-900">{p.numero}</span> <span className="text-xs text-slate-600">valor {brlP(p.valor)}</span></span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">✔ baixa de {brlP(p.baixadoAqui)} já dada</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-700 mt-1.5">Não é uma indicação nova: o sistema já deu a baixa nessa fatura por ser a mais parecida. <b>Confirme se foi essa que a OM quis pagar.</b></p>
                </div>
              )}
              {livres.length > 0 && (
                <div className="rounded-md border border-sky-200 bg-sky-50 p-2">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-sky-800 mb-1">Outras faturas parecidas, sem baixa deste crédito</div>
                  <ul className="space-y-1">
                    {livres.map(p => (
                      <li key={p.numero} className="flex flex-wrap items-center justify-between gap-1">
                        <span><span className="font-mono text-xs text-slate-900">{p.numero}</span> <span className="text-xs text-slate-600">valor {brlP(p.valor)}</span></span>
                        <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-200 text-amber-900">⚠ sem baixa deste crédito</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    ))}
    {d.observacao && (
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1">O que a OM escreveu no SIPLAD</div>
        <p className="text-xs text-slate-700 italic">“{d.observacao}”</p>
      </div>
    )}
    <div className="rounded-lg border border-amber-200 bg-white p-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800 mb-1">O que fazer</div>
      <ol className="list-decimal pl-5 space-y-1 text-xs text-slate-800">
        {d.itens.some(i => i.parecidas.some(p => p.baixadoAqui > 0.005)) ? (
          <>
            <li><b>Se a fatura onde já demos baixa é a que a OM quis pagar</b> (ela só errou o número): clique em <b>“Informar o motivo (manter assim)”</b> e anote, por exemplo, “OM citou 008; a fatura correta é a 010”. Nada mais a fazer.</li>
            <li><b>Se a OM quis pagar outra fatura:</b> remova a baixa errada (em “Corrigir agora”) e dê a baixa na fatura certa, em <i>Créditos recebidos › Pagar faturas</i>.</li>
          </>
        ) : (
          <>
            <li><b>Se uma fatura parecida é a certa</b> (a OM só errou o número): dê a baixa nela em <i>Créditos recebidos › Pagar faturas</i> e anote o motivo em <b>“Informar o motivo (manter assim)”</b>.</li>
            <li><b>Se a fatura citada existe de verdade</b> e ainda não foi lançada: lance em <i>Emitir faturas do mês</i> ou <i>Faturas emitidas</i> e depois dê a baixa.</li>
          </>
        )}
        <li>Na dúvida, <b>confirme com a OM</b> qual fatura ela quis pagar.</li>
      </ol>
    </div>
  </div>
);

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
                  {p.detalhe?.tipo === 'BAIXA_FORA' ? <DetalheBaixaForaView d={p.detalhe} /> : p.detalhe?.tipo === 'CITADA_INEXISTENTE' ? <DetalheCitadaInexistenteView d={p.detalhe} /> : (<>
                    <p className="text-sm text-slate-800 whitespace-pre-line">{p.mensagem}</p>
                    <p className="text-xs text-slate-600"><b>Como corrigir:</b> {p.comoCorrigir}</p>
                  </>)}
                  {podeEditar && !p.resolvido && <CorrigirAgora alvo={alvo.alvo} id={alvo.id} ponto={p} usuario={usuario} onFeito={onAlterado} />}
                  {p.automatico && !p.resolvido && <p className="text-[11px] text-slate-500">Some sozinho quando o dado for corrigido.</p>}
                  {p.resolvido && (
                    <p className="text-xs text-emerald-800">
                      {p.automatico ? 'Ciente' : 'Resolvido'}{p.resolvido.por ? ` por ${p.resolvido.por}` : ''}{p.resolvido.em ? ` em ${dataBR(p.resolvido.em)}` : ''}
                      {p.resolvido.justificativa ? ` — "${p.resolvido.justificativa}"` : ''}
                    </p>
                  )}
                  {podeEditar && !p.resolvido && resolvendo !== i && (
                    <button className="text-xs font-semibold text-primary-700 hover:underline" onClick={() => { setResolvendo(i); setJustificativa(''); }}>
                      {p.tipo === 'BAIXA_FORA_DESTINACAO' || p.tipo === 'FATURA_CITADA_INEXISTENTE' ? 'Informar o motivo (manter assim)' : p.automatico ? 'Estou ciente (manter assim)' : 'Marcar como resolvido'}
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
                        placeholder={p.tipo === 'FATURA_CITADA_INEXISTENTE' ? 'O que foi apurado? (ex.: a OM citou a 008, mas a fatura correta é a 010)' : p.tipo === 'BAIXA_FORA_DESTINACAO' ? 'Por que pagamos diferente do que a OM indicou? (ex.: a OM confirmou por telefone que a fatura paga é a correta)' : p.automatico ? 'Por que está correto assim? (ex.: excedente devolvido por GRU nº...)' : 'O que foi feito? (ex.: conferido no SIPLAD, vencimento correto)'}
                        className="w-full text-sm border border-slate-300 rounded-md p-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500" />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => resolver(p)} isLoading={gravando} disabled={(p.tipo === 'BAIXA_FORA_DESTINACAO' || p.tipo === 'FATURA_CITADA_INEXISTENTE') && !justificativa.trim()}>Confirmar</Button>
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
