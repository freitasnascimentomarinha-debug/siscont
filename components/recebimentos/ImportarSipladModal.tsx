import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileUp } from 'lucide-react';
import { Invoice, OM, PaymentAllocation, ReceivedDocument } from '../../types';
import { proporBaixa } from '../../utils/baixaAssistida';
import { FINALIDADES } from '../../utils/relatorios';
import { extrairCitacoesParciais, itensDoPdf, lerSolicitacoesDetalhado, ordemDeExibicao, OrdemAltcred, ordenarPorAntiguidade, ROTULO_ORDEM, SolicitacaoAltcred } from '../../utils/altcredSiplad';
import { AcaoImportacao, carregarCadastro, faturasCandidatas, comPendencia, comoAdiantamentoImportado, comoRecebimentoOutros, gravarImportacaoSiplad, ItemImportacao, planejarImportacaoSiplad } from '../../services/recebimentosService';
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
export const ImportarSipladModal: React.FC<{
  aberto: boolean; onClose: () => void; documentos: ReceivedDocument[]; onGravado: () => Promise<void>;
  /** faturas e baixas: com elas cada ALTCRED mostra se já paga faturas e a situação de cada fatura citada */
  invoices?: Invoice[]; baixas?: PaymentAllocation[]; oms?: OM[];
  /** depois de gravar, abre a baixa assistida (onde o pagamento é conferido e autorizado) para as ALTCRED marcadas */
  onPagarDepois?: (numeros: string[]) => void;
}> = ({ aberto, onClose, documentos, onGravado, invoices, baixas, oms, onPagarDepois }) => {
  const ref = useRef<HTMLInputElement>(null);
  const [itens, setItens] = useState<ItemImportacao[]>([]);
  const [pagarDepois, setPagarDepois] = useState<Record<number, boolean>>({});
  // situação de pagamento: quanto cada ALTCRED já baixou e como está cada fatura citada
  const pagamento = useMemo(() => {
    if (!invoices || !baixas) return null;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const porDoc = new Map<string, PaymentAllocation[]>();
    baixas.forEach(b => porDoc.set(b.documentId, [...(porDoc.get(b.documentId) || []), b]));
    const faturaPorId = new Map(invoices.map(i => [i.id, i]));
    const usadoPorFatura = new Map<string, number>();
    const idsDocs = new Set(documentos.map(d => d.id));
    baixas.forEach(b => { if (idsDocs.has(b.documentId)) usadoPorFatura.set(b.invoiceId, (usadoPorFatura.get(b.invoiceId) || 0) + b.amount); });
    const porNumero = new Map(invoices.map(i => [(i.invoiceNumber || '').trim().toUpperCase(), i]));
    const candidatas = faturasCandidatas(invoices, documentos, baixas, oms || []);
    return {
      candidatas,
      // faturas em aberto que esta ALTCRED poderia pagar (as citadas, as da OM indicada e as do comando/UG do cliente)
      abertasPara: (doc: ReceivedDocument) => {
        const p = proporBaixa({
          saldo: Math.max(doc.availableValue, doc.totalValue), ug: doc.ug, ugClienteCodigo: doc.ugCliente?.match(/\d{5}/)?.[0], comandoId: doc.comandoId,
          destinacao: doc.destinacao, faturasCitadas: [], faturasCitadasParciais: extrairCitacoesParciais(doc.observacaoSolicitante),
        }, candidatas, { incluirContestadas: true });
        return { itens: p.itens, total: r2(p.itens.reduce((s, x) => s + x.saldoFatura, 0)), citadas: p.itens.filter(x => x.grupo === 'CITADA').length };
      },
      baixasDe: (docId: string) => {
        const bs = porDoc.get(docId) || [];
        return { total: r2(bs.reduce((s, b) => s + b.amount, 0)), faturas: bs.map(b => ({ numero: faturaPorId.get(b.invoiceId)?.invoiceNumber || '?', valor: b.amount })) };
      },
      fatura: (numero: string) => {
        const inv = porNumero.get(numero.trim().toUpperCase());
        if (!inv) return { estado: 'AUSENTE' as const };
        if (inv.isCanceled) return { estado: 'CANCELADA' as const };
        const saldo = r2(inv.value + (inv.adjustmentAddition || 0) - (inv.adjustmentDeduction || 0) - (usadoPorFatura.get(inv.id) || 0));
        return saldo > 0.005 ? { estado: 'ABERTA' as const, saldo, vencimento: inv.dueDate } : { estado: 'QUITADA' as const };
      },
    };
  }, [invoices, baixas, oms, documentos]);
  // ordem de exibição (escolha lembrada neste navegador); a gravação segue sempre da mais antiga para a mais nova
  const [ordem, setOrdemEstado] = useState<OrdemAltcred>(() => { try { const v = localStorage.getItem('siscont.ordemAltcred') as OrdemAltcred | null; return v && v in ROTULO_ORDEM ? v : 'ANTIGO'; } catch { return 'ANTIGO'; } });
  const setOrdem = (o: OrdemAltcred) => { setOrdemEstado(o); try { localStorage.setItem('siscont.ordemAltcred', o); } catch { /* sem armazenamento: vale só agora */ } };
  const ordenados = useMemo(() => ordemDeExibicao(itens.map(i => ({ numero: i.sol.numero, dataCriacao: i.sol.dataCriacao, dataSituacao: i.sol.dataSituacao, valor: i.sol.valor, situacao: classificarSituacao(i.sol.situacao).rotulo })), ordem), [itens, ordem]);
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
  // cobertura em sequência: uma OM pode ter várias ALTCRED no mesmo PDF; cada uma só enxerga as faturas que as ANTERIORES (mais antigas) deste PDF
  // não vão pagar. Assim fica claro quando uma ALTCRED já não tem fatura para pagar (e deve virar adiantamento).
  const cobertura = useMemo(() => {
    if (!pagamento || !itens.length) return null;
    const ordemAntiga = ordemDeExibicao(itens.map(i => ({ numero: i.sol.numero, dataCriacao: i.sol.dataCriacao, dataSituacao: i.sol.dataSituacao, valor: i.sol.valor, situacao: '' })), 'ANTIGO');
    const livre = new Map(pagamento.candidatas.map(c => [c.id, c.saldo]));
    const consumidoPor = new Map<string, string[]>();
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const out: Record<number, { abertasAntes: number; restantes: number; total: number; citadas: number; anteriores: string[] }> = {};
    ordemAntiga.forEach(n => {
      const it = itens[n], d = it.doc;
      const base = { saldo: it.existente ? it.existente.availableValue : d.totalValue, ug: d.ug, ugClienteCodigo: d.ugCliente?.match(/\d{5}/)?.[0], comandoId: d.comandoId, destinacao: d.destinacao, faturasCitadas: [] as string[], faturasCitadasParciais: extrairCitacoesParciais(d.observacaoSolicitante) };
      const antes = proporBaixa(base, pagamento.candidatas, { incluirContestadas: true });
      const agora = proporBaixa(base, pagamento.candidatas.map(c => ({ ...c, saldo: r2(livre.get(c.id) ?? c.saldo) })), { incluirContestadas: true });
      const anteriores = [...new Set(antes.itens.flatMap(x => consumidoPor.get(x.faturaId) || []))];
      out[n] = { abertasAntes: antes.itens.length, restantes: agora.itens.length, total: r2(agora.itens.reduce((s, x) => s + x.saldoFatura, 0)), citadas: agora.itens.filter(x => x.grupo === 'CITADA').length, anteriores };
      // o que esta ALTCRED consumiria (só as que realmente vão pagar fatura)
      const paga = !ignorados.has(n) && destino[n] === undefined && pendencia[n] === undefined && it.acao !== 'ESTORNO' && classificarSituacao(it.sol.situacao).recebido;
      if (paga) agora.itens.forEach(x => { if (x.valor > 0.005) { livre.set(x.faturaId, r2((livre.get(x.faturaId) ?? 0) - x.valor)); consumidoPor.set(x.faturaId, [...(consumidoPor.get(x.faturaId) || []), it.sol.numero]); } });
    });
    return out;
  }, [pagamento, itens, ignorados, destino, pendencia]);

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
      // do mais antigo para o mais novo (também é a ordem em que são gravadas)
      const plano = planejarImportacaoSiplad(ordenarPorAntiguidade(sols), documentos, await carregarCadastro());
      setItens(plano); setDestino({}); setFinalidade({}); setPendencia({}); setPagarDepois({});
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
      const pagar = itens.filter((_, k) => pagarDepois[k] && !ignorados.has(k) && pendencia[k] === undefined && destino[k] !== 'OUTROS').map(i => i.sol.numero);
      setItens([]); setDescartadas([]);
      await onGravado();
      onClose();
      if (pagar.length && onPagarDepois) onPagarDepois(pagar);
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
          {itens.length > 0 ? <p className="text-sm text-slate-600 flex-1">PDF lido. Para ler outro arquivo, use <b>Selecionar PDF</b> (a lista abaixo é substituída).</p> : <p className="text-sm text-slate-600 flex-1">
            No SIPLAD, gere o relatório <b>Solicitações de Alteração de Crédito</b> (uma solicitação por página) e selecione o PDF.
            O sistema lê número, datas, tipo, UG cliente, situação, observação do solicitante, células de débito/crédito (PTRES, FR, ND, PI) e valor;
            liga ao comando pelo código da UG e guarda as faturas citadas na observação como <b>destinação</b>.
            ALTCRED que já existe (por exemplo, migrada da planilha) é <b>completada</b> com esses dados, sem mudar valor nem baixas.
          </p>}
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
        {itens.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-slate-600">Ordem da lista
            <select className="border border-slate-300 rounded px-2 py-1 text-xs bg-white" value={ordem} onChange={e => setOrdem(e.target.value as OrdemAltcred)} aria-label="Ordem da lista de ALTCRED">
              {(Object.keys(ROTULO_ORDEM) as OrdemAltcred[]).map(o => <option key={o} value={o}>{ROTULO_ORDEM[o]}</option>)}
            </select>
            <span className="text-slate-400">A gravação segue sempre da mais antiga para a mais nova.</span>
          </label>
        )}
        {itens.length > 0 && (
          <div className="space-y-3" data-testid="lista-altcred">
            {ordenados.map(n => {
              const i = itens[n];
              const st = classificarSituacao(i.sol.situacao);
              const ign = ignorados.has(n);
              return (
                <section key={n} data-testid="item-altcred" className={`border rounded-lg overflow-hidden ${ign ? 'border-slate-200 opacity-70' : 'border-slate-300'}`} aria-label={`ALTCRED ${i.sol.numero}`}>
                  {/* cabeçalho: número, tipo, datas, situação e valor — sempre visíveis, sem rolar para o lado */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 bg-slate-50 border-b border-slate-200">
                    <div className="font-mono text-sm font-bold text-slate-800" data-testid="numero-altcred">{i.sol.numero}</div>
                    <div className="text-xs text-slate-600">{i.sol.tipoAlteracao}{i.sol.dataCriacao ? ` · criada ${br(i.sol.dataCriacao)}` : ''}</div>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${st.classe}`} title={st.explicacao}>{st.rotulo}{i.sol.dataSituacao ? ` · ${br(i.sol.dataSituacao)}` : ''}</span>
                    <div className="ml-auto text-base font-bold tabular-nums text-slate-900">{brl(i.sol.valor)}</div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-x-4 gap-y-3 px-3 py-3 text-sm">
                    <div>
                      <div className="text-[11px] font-semibold uppercase text-slate-400 mb-0.5">Cliente{i.clienteCadastrado === false ? ' (como veio do extrato do SIPLAD)' : ''}</div>
                      <div className="font-medium text-slate-800" data-testid="cliente-altcred">{i.doc.client || i.clienteSiplad || '—'}{i.clienteCadastrado === false && <span className="ml-2 px-1.5 rounded bg-amber-100 text-amber-800 text-[11px] font-semibold">não cadastrado</span>}</div>
                      <div className="text-xs text-slate-500">{i.doc.command}</div>
                      <div className="mt-2 space-y-1 text-xs text-slate-600" aria-label={`UGR, UGE e Plano Interno de ${i.sol.numero}`}>
                        {(['DEBITO', 'CREDITO'] as const).map(t => {
                          const cs = (i.sol.celulas || []).filter(c => c.tipo === t);
                          return (
                            <div key={t}>
                              <span className="font-semibold text-slate-500">{t === 'DEBITO' ? 'CDD (débito)' : 'CDC (crédito)'}:</span>
                              {cs.length ? cs.map((c, j) => <div key={j} className="pl-2">UGR <b>{c.ugr || '—'}</b> · UGE <b>{c.uge || '—'}</b> · PI <b>{c.pi || '—'}</b></div>) : <span className="text-slate-400"> não lida</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase text-slate-400 mb-0.5">Destinação</div>
                      <div className="text-xs">
                        {i.doc.destinacao?.length ? i.doc.destinacao.map(d => {
                          const f = pagamento && d.tipo === 'FATURA' ? pagamento.fatura(d.valor) : null;
                          return (
                            <div key={d.valor} className="flex flex-wrap items-center gap-x-2">
                              <span className="font-mono">{d.valor}</span>
                              {f?.estado === 'ABERTA' && <span className="px-1.5 rounded bg-sky-100 text-sky-800">em aberto {brl(f.saldo)}{f.vencimento ? ` · vence ${br(f.vencimento)}` : ''}</span>}
                              {f?.estado === 'QUITADA' && <span className="px-1.5 rounded bg-emerald-100 text-emerald-800">já quitada</span>}
                              {f?.estado === 'CANCELADA' && <span className="px-1.5 rounded bg-slate-200 text-slate-700">cancelada</span>}
                              {f?.estado === 'AUSENTE' && <span className="px-1.5 rounded bg-amber-100 text-amber-800">não encontrada no sistema</span>}
                            </div>
                          );
                        }) : <span className="text-slate-500">Nenhuma fatura citada{i.acao === 'NOVA' && !i.doc.aguardando ? '' : ' — fica "aguardando destinação"'}</span>}
                      </div>
                      {i.sol.observacao && <div className="mt-2 text-xs text-slate-600 break-words" aria-label={`Observação da ${i.sol.numero}`}><span className="font-semibold text-slate-500">Observação: </span>{i.sol.observacao}</div>}
                    </div>
                  </div>
                  <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-xs space-y-2">
                    {pagamento && i.existente && (() => {
                      const b = pagamento.baixasDe(i.existente.id);
                      return b.total > 0.005
                        ? <div className="rounded border border-emerald-200 bg-emerald-50 text-emerald-900 px-2 py-1.5" data-testid="ja-paga-faturas"><b>Já está pagando faturas:</b> {brl(b.total)} baixado em {b.faturas.length} fatura(s) ({b.faturas.slice(0, 4).map(f => `${f.numero} ${brl(f.valor)}`).join(' · ')}{b.faturas.length > 4 ? ` e mais ${b.faturas.length - 4}` : ''}). Saldo disponível: <b>{brl(i.existente.availableValue)}</b>.</div>
                        : <div className="rounded border border-slate-200 bg-white text-slate-700 px-2 py-1.5" data-testid="ja-paga-faturas">Já cadastrada, mas <b>ainda não pagou nenhuma fatura</b>. Saldo disponível: <b>{brl(i.existente.availableValue)}</b>.</div>;
                    })()}
                    {pagamento && !i.existente && <div className="rounded border border-slate-200 bg-white text-slate-700 px-2 py-1.5" data-testid="ja-paga-faturas">ALTCRED nova: ainda <b>não paga nenhuma fatura</b>.</div>}
                    {cobertura && i.acao !== 'ESTORNO' && (() => {
                      const cb = cobertura[n];
                      if (!cb) return null;
                      if (cb.abertasAntes === 0) return <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1.5 flex gap-1" data-testid="sem-fatura-para-pagar"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span><b>Nenhuma fatura em aberto para pagar:</b> {i.doc.client || 'a OM'} não tem fatura em aberto no sistema (nem as citadas na observação, nem as do comando/UG). O crédito não tem o que pagar agora: fica aguardando ou como adiantamento.</span></div>;
                      if (cb.restantes === 0) return (
                        <div className="rounded border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1.5 flex flex-wrap items-center gap-2" data-testid="sem-fatura-depois-das-anteriores">
                          <AlertTriangle size={14} className="shrink-0" />
                          <span className="flex-1"><b>Sem fatura para pagar depois das anteriores:</b> as ALTCRED anteriores deste PDF ({cb.anteriores.join(', ') || 'mais antigas'}) já cobrem as {cb.abertasAntes} fatura(s) em aberto deste cliente. Esta ficaria sem o que pagar: o ideal é cadastrá-la como adiantamento.</span>
                          {destino[n] !== 'ADIANTAMENTO' && !ign && <button type="button" className="px-2 py-1 rounded bg-amber-600 text-white font-semibold hover:bg-amber-700" onClick={() => setDestino(d => ({ ...d, [n]: 'ADIANTAMENTO' }))}>Cadastrar como adiantamento</button>}
                        </div>
                      );
                      return <div className="rounded border border-sky-200 bg-sky-50 text-sky-900 px-2 py-1.5" data-testid="faturas-para-pagar"><b>{cb.restantes} fatura(s) em aberto</b> para esta OM/comando, somando {brl(cb.total)}{cb.citadas ? ` (${cb.citadas} citada(s) na observação)` : ''}{cb.anteriores.length ? ` — depois de contar as ALTCRED anteriores deste PDF (${cb.anteriores.join(', ')})` : ''}.</div>;
                    })()}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <label className="flex items-center gap-1.5 font-semibold text-slate-600">O que fazer
                        <select aria-label={`Ação para ${i.sol.numero}`} value={ign ? 'IGNORAR' : destino[n] ?? i.acao}
                          onChange={e => {
                            const v = e.target.value;
                            setIgnorados(prev => { const s2 = new Set(prev); if (v === 'IGNORAR') s2.add(n); else s2.delete(n); return s2; });
                            setDestino(prev => { const d2 = { ...prev }; if (v === 'ADIANTAMENTO' || v === 'OUTROS') d2[n] = v; else delete d2[n]; return d2; });
                          }}
                          className="border border-slate-300 rounded px-2 py-1 bg-white font-normal">
                          <option value={i.acao}>{i.acao === 'NOVA' ? 'Cadastrar nova (pagar faturas)' : ROTULO[i.acao]}</option>
                          {i.acao !== 'ESTORNO' && <option value="ADIANTAMENTO">Cadastrar como adiantamento</option>}
                          {i.acao !== 'ESTORNO' && <option value="OUTROS">Cadastrar como outros serviços (não paga fatura)</option>}
                          <option value="IGNORAR">{ROTULO.IGNORAR}</option>
                        </select>
                      </label>
                      {!ign && destino[n] === 'OUTROS' && (
                        <label className="flex items-center gap-1.5 text-slate-600">Finalidade
                          <select aria-label={`Finalidade de ${i.sol.numero}`} value={finalidade[n] || ''} onChange={e => setFinalidade(prev => ({ ...prev, [n]: e.target.value }))} className="border border-slate-300 rounded px-2 py-1 bg-white">
                            <option value="">Sem indicação</option>
                            {FINALIDADES.map(f => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
                          </select>
                        </label>
                      )}
                      {onPagarDepois && !ign && i.acao !== 'ESTORNO' && destino[n] !== 'OUTROS' && pendencia[n] === undefined && st.recebido && (!cobertura || (cobertura[n]?.restantes ?? 1) > 0) && (
                        <label className="flex items-center gap-1.5 text-primary-800 font-semibold">
                          <input type="checkbox" className="h-3.5 w-3.5 accent-primary-600" checked={!!pagarDepois[n]} aria-label={`Pagar faturas depois de gravar: ${i.sol.numero}`}
                            onChange={e => setPagarDepois(p => ({ ...p, [n]: e.target.checked }))} />
                          Depois de gravar, pagar as faturas (abre a baixa assistida para você conferir e autorizar)
                        </label>
                      )}
                      {!ign && i.acao !== 'ESTORNO' && (
                        <label className="flex items-center gap-1.5 text-slate-700">
                          <input type="checkbox" className="h-3.5 w-3.5 accent-amber-600" checked={pendencia[n] !== undefined} aria-label={`Com pendência: ${i.sol.numero}`}
                            onChange={e => setPendencia(p => { const x = { ...p }; if (e.target.checked) x[n] = ''; else delete x[n]; return x; })} />
                          Registrar com pendência (verificar algo)
                        </label>
                      )}
                    </div>
                    {!ign && destino[n] === 'OUTROS' && !st.recebido && st.codigo !== 'AGUARDANDO' && st.codigo !== 'EM_ANALISE' && (
                      <div className="text-amber-700 flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />Situação no SIPLAD: {st.rotulo.toLowerCase()}. Confira se o crédito realmente entrou na R.901.16.</div>
                    )}
                    {!ign && i.acao !== 'ESTORNO' && pendencia[n] !== undefined && (
                      <div>
                        <input className="w-full border border-amber-300 rounded px-2 py-1 bg-amber-50" placeholder="O que falta verificar? (ex.: confirmar a OM com o cliente)" aria-label={`O que verificar na ${i.sol.numero}`}
                          value={pendencia[n] || ''} onChange={e => setPendencia(p => ({ ...p, [n]: e.target.value }))} />
                        <div className="text-amber-800 mt-0.5">Fica registrada com alerta e <b>fora do saldo, das baixas e do fluxo de caixa</b> até a pendência ser resolvida.</div>
                      </div>
                    )}
                    {i.acao === 'ESTORNO' && i.existente && <div className="text-slate-600">{i.existente.documentNumber}: {brl(i.existente.totalValue)} → {brl(i.doc.totalValue)}</div>}
                    {i.avisos.map(a => <div key={a} className="text-amber-700 flex gap-1"><AlertTriangle size={12} className="shrink-0 mt-0.5" />{a}</div>)}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};
