import React, { useRef, useState } from 'react';
import { AlertTriangle, FileUp } from 'lucide-react';
import { ReceivedDocument } from '../../types';
import { FINALIDADES } from '../../utils/relatorios';
import { itensDoPdf, lerSolicitacoesDetalhado, SolicitacaoAltcred } from '../../utils/altcredSiplad';
import { AcaoImportacao, carregarCadastro, comPendencia, comoAdiantamentoImportado, comoRecebimentoOutros, gravarImportacaoSiplad, ItemImportacao, planejarImportacaoSiplad } from '../../services/recebimentosService';
import { notify } from '../../utils/notify';
import { classificarSituacao } from '../../utils/situacaoSiplad';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

const ROTULO: Record<AcaoImportacao, string> = {
  NOVA: 'Cadastrar nova', COMPLETAR: 'Completar a já cadastrada', ESTORNO: 'Estornar da ALTCRED de origem', IGNORAR: 'Não importar',
};

const lerArquivo = (f: File) => new Promise<ArrayBuffer>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as ArrayBuffer);
  r.onerror = () => rej(new Error(`Não foi possível ler ${f.name}.`));
  r.readAsArrayBuffer(f);
});

/** Lê o PDF "Solicitações de Alteração de Crédito" do SIPLAD e cadastra/completa as ALTCRED. */
export const ImportarSipladModal: React.FC<{ aberto: boolean; onClose: () => void; documentos: ReceivedDocument[]; onGravado: () => Promise<void> }> = ({ aberto, onClose, documentos, onGravado }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [itens, setItens] = useState<ItemImportacao[]>([]);
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [semSolicitacao, setSemSolicitacao] = useState<string[]>([]);
  const [descartadas, setDescartadas] = useState<SolicitacaoAltcred[]>([]);
  const [ignorados, setIgnorados] = useState<Set<number>>(new Set());
  // destino escolhido por linha: o padrão (pagar faturas) não precisa de escolha; adiantamento ou outros serviços (não paga fatura, com finalidade opcional)
  const [destino, setDestino] = useState<Record<number, 'ADIANTAMENTO' | 'OUTROS'>>({});
  const [finalidade, setFinalidade] = useState<Record<number, string>>({});
  // pendência por linha (algo a verificar): a ALTCRED é registrada, mas só entra no saldo e no fluxo depois de resolvida
  const [pendencia, setPendencia] = useState<Record<number, string | undefined>>({});

  const ler = async (files: FileList | null) => {
    if (!files?.length) return;
    setLendo(true); setSemSolicitacao([]);
    try {
      const sols: SolicitacaoAltcred[] = [];
      const fora: SolicitacaoAltcred[] = [];
      const vazios: string[] = [];
      for (const f of Array.from(files)) {
        const lido = lerSolicitacoesDetalhado(await itensDoPdf(await lerArquivo(f)));
        if (!lido.lidas.length && !lido.descartadas.length) vazios.push(f.name);
        sols.push(...lido.lidas); fora.push(...lido.descartadas);
      }
      setSemSolicitacao(vazios); setDescartadas(fora);
      const plano = planejarImportacaoSiplad(sols, documentos, await carregarCadastro());
      setItens(plano); setDestino({}); setFinalidade({}); setPendencia({});
      // devolvida, cancelada e não processada não são recebimento: já vêm como "Não importar" (dá para trocar)
      setIgnorados(new Set(plano.map((p, k) => (classificarSituacao(p.sol.situacao).importarPadrao ? -1 : k)).filter(k => k >= 0)));
    } catch (e) {
      notify.fail('Não foi possível ler o PDF', e);
    } finally {
      setLendo(false);
      if (ref.current) ref.current.value = '';
    }
  };

  const gravar = async () => {
    setGravando(true);
    try {
      const semTexto = itens.findIndex((_, k) => !ignorados.has(k) && pendencia[k] !== undefined && !pendencia[k]!.trim());
      if (semTexto >= 0) { notify.error(`Informe o que verificar na pendência da ${itens[semTexto].sol.numero}.`); setGravando(false); return; }
      const n = await gravarImportacaoSiplad(itens.map((i, k) => {
        if (ignorados.has(k)) return { ...i, acao: 'IGNORAR' as const };
        const base = destino[k] === 'OUTROS' ? comoRecebimentoOutros(i, (finalidade[k] || null) as any) : destino[k] === 'ADIANTAMENTO' ? comoAdiantamentoImportado(i) : i;
        return pendencia[k] !== undefined ? comPendencia(base, pendencia[k]!) : base;
      }));
      notify.success(`${n} ALTCRED gravada(s) a partir do SIPLAD.`);
      setItens([]); setDescartadas([]);
      await onGravado();
      onClose();
    } catch (e) {
      notify.fail('Erro ao gravar', e);
    } finally { setGravando(false); }
  };

  const fechar = () => { setItens([]); setSemSolicitacao([]); setDescartadas([]); setIgnorados(new Set()); setDestino({}); setFinalidade({}); setPendencia({}); onClose(); };

  return (
    <Modal isOpen={aberto} onClose={fechar} title="Importar ALTCRED do SIPLAD (PDF)" maxWidth="max-w-5xl"
      footer={itens.length > 0 ? (
        <div className="flex justify-between items-center gap-2">
          <span className="text-xs text-slate-500">Nada é gravado antes de confirmar.</span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={fechar} disabled={gravando}>Cancelar</Button>
            <Button onClick={gravar} isLoading={gravando} disabled={ignorados.size >= itens.length}>Gravar</Button>
          </div>
        </div>
      ) : undefined}>
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col md:flex-row gap-3 md:items-center">
          <p className="text-sm text-slate-600 flex-1">
            No SIPLAD, gere o relatório <b>Solicitações de Alteração de Crédito</b> (uma solicitação por página) e selecione o PDF.
            O sistema lê número, datas, tipo, UG cliente, situação, observação do solicitante, células de débito/crédito (PTRES, FR, ND, PI) e valor;
            liga ao comando pelo código da UG e guarda as faturas citadas na observação como <b>destinação</b>.
            ALTCRED que já existe (por exemplo, migrada da planilha) é <b>completada</b> com esses dados, sem mudar valor nem baixas.
          </p>
          <input ref={ref} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={e => ler(e.target.files)} />
          <Button onClick={() => ref.current?.click()} isLoading={lendo}>{!lendo && <FileUp size={16} className="mr-2" />}Selecionar PDF</Button>
        </div>
        {semSolicitacao.length > 0 && (
          <p className="text-sm text-amber-700">Nenhuma solicitação encontrada em: {semSolicitacao.join(', ')}.</p>
        )}
        {descartadas.length > 0 && (
          <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600" role="note">
            <b>{descartadas.length} solicitação(ões) do relatório não creditam a BNIC</b> (ex.: compras no exterior, pagamentos da BNIC a outras UG) e não são recebimentos: ignoradas.
            <div className="font-mono mt-1 break-words">{descartadas.map(d => `${d.numero} (${d.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`).join(' · ')}</div>
          </div>
        )}
        {itens.length > 0 && (() => {
          const cont = new Map<string, number>();
          itens.forEach(i => { const r = classificarSituacao(i.sol.situacao).rotulo; cont.set(r, (cont.get(r) || 0) + 1); });
          return <p className="text-sm text-slate-700" data-testid="resumo-situacoes"><b>{itens.length}</b> solicitação(ões) no PDF: {[...cont.entries()].map(([r, n]) => `${n} ${r.toLowerCase()}`).join(' · ')}. Só as <b>processadas</b> já são crédito recebido; devolvidas, canceladas e não processadas vêm marcadas como "Não importar".</p>;
        })()}
        {itens.length > 0 && (
          <p className="text-xs text-slate-600" role="note">
            <b>O que fazer com cada ALTCRED:</b> "Cadastrar nova" deixa o crédito para pagar faturas (se a OM não citou fatura, ele fica aguardando e vocês escolhem as faturas depois).
            Escolha <b>"Adiantamento"</b> se o valor fica guardado para faturas futuras, ou <b>"Outros serviços"</b> se o crédito foi recebido na R.901.16 para outro fim e não paga fatura: ele fica fora das baixas e do saldo a destinar (e continua no Fluxo de caixa, como toda ALTCRED).
          </p>
        )}
        {itens.length > 0 && (
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="min-w-full text-sm divide-y divide-slate-200">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr><th className="px-3 py-2 text-left">ALTCRED</th><th className="px-3 py-2 text-left">Cliente (UG)</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2 text-left">Situação</th><th className="px-3 py-2 text-left">Destinação</th><th className="px-3 py-2 text-left">O que fazer</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map((i, n) => (
                  <tr key={n} className="align-top">
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs font-semibold">{i.sol.numero}</div>
                      <div className="text-[11px] text-slate-500">{i.sol.tipoAlteracao}</div>
                      <div className="text-[11px] text-slate-500">criada {br(i.sol.dataCriacao)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div>{i.doc.client}</div>
                      <div className="text-[11px] text-slate-500">{i.doc.command}</div>
                      <div className="mt-1 space-y-0.5 text-[11px] text-slate-600" aria-label={`UGR e UGE de ${i.sol.numero}`}>
                        {(['DEBITO', 'CREDITO'] as const).map(t => {
                          const cs = (i.sol.celulas || []).filter(c => c.tipo === t);
                          return (
                            <div key={t}>
                              <span className="font-semibold text-slate-500">{t === 'DEBITO' ? 'CDD (débito)' : 'CDC (crédito)'}:</span>{' '}
                              {cs.length ? cs.map((c, j) => <span key={j} className="mr-2 whitespace-nowrap">UGR <b>{c.ugr || '—'}</b> · UGE <b>{c.uge || '—'}</b></span>) : <span className="text-slate-400">não lida</span>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(i.sol.valor)}</td>
                    <td className="px-3 py-2 text-xs">
                      {(() => { const st = classificarSituacao(i.sol.situacao); return <span className={`inline-block px-2 py-0.5 rounded font-semibold ${st.classe}`} title={st.explicacao}>{st.rotulo}</span>; })()}
                      <div className="text-slate-500">{br(i.sol.dataSituacao)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs min-w-[260px] max-w-[420px]">
                      {i.doc.destinacao?.length ? i.doc.destinacao.map(d => <div key={d.valor} className="font-mono">{d.valor}</div>) : <span className="text-slate-500">Nenhuma fatura citada{i.acao === 'NOVA' && !i.doc.aguardando ? '' : ' — fica "aguardando destinação"'}</span>}
                      {i.sol.observacao && <div className="text-slate-600 mt-1 break-words" aria-label={`Observação da ${i.sol.numero}`}><span className="font-semibold text-slate-500">Observação: </span>{i.sol.observacao}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <select aria-label={`Ação para ${i.sol.numero}`} value={ignorados.has(n) ? 'IGNORAR' : destino[n] ?? i.acao}
                        onChange={e => {
                          const v = e.target.value;
                          setIgnorados(prev => { const s2 = new Set(prev); if (v === 'IGNORAR') s2.add(n); else s2.delete(n); return s2; });
                          setDestino(prev => { const d2 = { ...prev }; if (v === 'ADIANTAMENTO' || v === 'OUTROS') d2[n] = v; else delete d2[n]; return d2; });
                        }}
                        className="border border-slate-300 rounded px-1 py-1 bg-white">
                        <option value={i.acao}>{i.acao === 'NOVA' ? 'Cadastrar nova (pagar faturas)' : ROTULO[i.acao]}</option>
                        {i.acao !== 'ESTORNO' && <option value="ADIANTAMENTO">Cadastrar como adiantamento</option>}
                        {i.acao !== 'ESTORNO' && <option value="OUTROS">Cadastrar como outros serviços (não paga fatura)</option>}
                        <option value="IGNORAR">{ROTULO.IGNORAR}</option>
                      </select>
                      {!ignorados.has(n) && destino[n] === 'OUTROS' && (
                        <label className="mt-1 block text-slate-600">Finalidade
                          <select aria-label={`Finalidade de ${i.sol.numero}`} value={finalidade[n] || ''} onChange={e => setFinalidade(prev => ({ ...prev, [n]: e.target.value }))} className="ml-1 border border-slate-300 rounded px-1 py-1 bg-white">
                            <option value="">Sem indicação</option>
                            {FINALIDADES.map(f => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
                          </select>
                        </label>
                      )}
                      {!ignorados.has(n) && destino[n] === 'OUTROS' && !classificarSituacao(i.sol.situacao).recebido && classificarSituacao(i.sol.situacao).codigo !== 'AGUARDANDO' && classificarSituacao(i.sol.situacao).codigo !== 'EM_ANALISE' && (
                        <div className="mt-1 text-amber-700 flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />Situação no SIPLAD: {classificarSituacao(i.sol.situacao).rotulo.toLowerCase()}. Confira se o crédito realmente entrou na R.901.16.</div>
                      )}
                      {!ignorados.has(n) && i.acao !== 'ESTORNO' && (
                        <div className="mt-2">
                          <label className="flex items-center gap-1 text-slate-700">
                            <input type="checkbox" className="h-3.5 w-3.5 accent-amber-600" checked={pendencia[n] !== undefined} aria-label={`Com pendência: ${i.sol.numero}`}
                              onChange={e => setPendencia(p => { const x = { ...p }; if (e.target.checked) x[n] = ''; else delete x[n]; return x; })} />
                            Registrar com pendência (verificar algo)
                          </label>
                          {pendencia[n] !== undefined && (
                            <div className="mt-1">
                              <input className="w-full border border-amber-300 rounded px-2 py-1 bg-amber-50" placeholder="O que falta verificar? (ex.: confirmar a OM com o cliente)" aria-label={`O que verificar na ${i.sol.numero}`}
                                value={pendencia[n] || ''} onChange={e => setPendencia(p => ({ ...p, [n]: e.target.value }))} />
                              <div className="text-amber-800 mt-0.5">Fica registrada com alerta e <b>fora do saldo, das baixas e do fluxo de caixa</b> até a pendência ser resolvida.</div>
                            </div>
                          )}
                        </div>
                      )}
                      {i.acao === 'ESTORNO' && i.existente && <div className="mt-1 text-slate-600">{i.existente.documentNumber}: {brl(i.existente.totalValue)} → {brl(i.doc.totalValue)}</div>}
                      {i.avisos.map(a => <div key={a} className="mt-1 text-amber-700 flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{a}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
};
