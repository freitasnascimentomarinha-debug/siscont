import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Invoice, OM, PaymentAllocation, ReceivedDocument } from '../../types';
import { ItemProposta, proporBaixa, validarBaixa } from '../../utils/baixaAssistida';
import { extrairCitacoesParciais, extrairFaturas, sufixoDaFatura } from '../../utils/altcredSiplad';
import { db } from '../../services/db';
import { OperationType } from '../../types';
import { faturasCandidatas, gravarBaixaAssistida } from '../../services/recebimentosService';
import { notify } from '../../utils/notify';
import { classificarSituacao, motivoBloqueio } from '../../utils/situacaoSiplad';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const GRUPO = { CITADA: 'Indicada pelo cliente', OM_DESTINADA: 'OM indicada', COMANDO: 'Do comando' };

/** Propõe e grava as baixas de uma ALTCRED/GRU nas faturas do cliente (mais antigas primeiro). */
export const BaixaAssistidaModal: React.FC<{
  doc: ReceivedDocument | null; onClose: () => void; invoices: Invoice[]; documentos: ReceivedDocument[];
  baixas: PaymentAllocation[]; oms: OM[]; onGravado: () => Promise<void>; usuario?: string;
}> = ({ doc, onClose, invoices, documentos, baixas, oms, onGravado, usuario = '' }) => {
  const [itens, setItens] = useState<ItemProposta[]>([]);
  const [incluirContestadas, setIncluirContestadas] = useState(false);
  const [enviarSobra, setEnviarSobra] = useState(true);
  const [motivoFora, setMotivoFora] = useState('');
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');

  const candidatas = useMemo(() => (doc ? faturasCandidatas(invoices, documentos, baixas, oms) : []), [doc, invoices, documentos, baixas, oms]);
  const citadas = useMemo(() => extrairFaturas(`${doc?.observacaoSolicitante || ''} ${doc?.observation || ''}`), [doc]);
  // o que foi digitado na busca pode ser um ou VÁRIOS números de fatura (hooks sempre antes do return antecipado)
  const pedidosCompletos = useMemo(() => extrairFaturas(busca), [busca]);
  const pedidosParciais = useMemo(() => extrairCitacoesParciais(busca), [busca]);
  const citadasParciais = useMemo(() => extrairCitacoesParciais(`${doc?.observacaoSolicitante || ''} ${doc?.observation || ''}`), [doc]);
  const existentes = useMemo(() => new Set(invoices.map(i => (i.invoiceNumber || '').trim().toUpperCase())), [invoices]);
  const citadasInexistentes = useMemo(() => [...new Set([...citadas, ...(doc?.destinacao || []).filter(d => d.tipo === 'FATURA').map(d => d.valor.trim().toUpperCase())])].filter(n => !existentes.has(n)), [citadas, doc, existentes]);

  useEffect(() => {
    if (!doc) return;
    const p = proporBaixa({
      saldo: doc.availableValue, ug: doc.ug, ugClienteCodigo: doc.ugCliente?.match(/\d{5}/)?.[0], comandoId: doc.comandoId,
      destinacao: doc.destinacao, faturasCitadas: citadas, faturasCitadasParciais: citadasParciais,
    }, candidatas, { incluirContestadas });
    setItens(p.itens);
  }, [doc, candidatas, citadas, citadasParciais, incluirContestadas]);

  if (!doc) return null;
  const usado = Math.round(itens.reduce((s, i) => s + (i.valor > 0 ? i.valor : 0), 0) * 100) / 100;
  const sobra = Math.round((doc.availableValue - usado) * 100) / 100;
  const erros = validarBaixa(itens, doc.availableValue);
  // a OM indicou faturas? (destinação gravada, números na observação — mesmo mal formatados — ou alguma fatura da própria indicação na lista)
  const temDestinacao = !!doc.destinacao?.length || citadas.length > 0 || citadasParciais.length > 0 || itens.some(i => i.grupo !== 'COMANDO');
  const indicadas = new Set([...(doc.destinacao || []).filter(d => d.tipo === 'FATURA').map(d => d.valor.trim().toUpperCase()), ...citadas]);
  const sufixosIndicados = new Set(citadasParciais.map(p => p.sufixo));
  const foiIndicada = (numero: string) => indicadas.has(numero.trim().toUpperCase()) || sufixosIndicados.has(sufixoDaFatura(numero));
  const foraUsadas = itens.filter(i => i.foraDestinacao && i.valor > 0);
  const ehPagamento = doc.operation !== 'ADIANTAMENTO';
  const bloqueio = motivoBloqueio(doc.situacaoSiplad);

  const alterar = (k: number, valor: number) => setItens(itens.map((x, n) => (n === k ? { ...x, valor: Math.max(0, Math.round(valor * 100) / 100) } : x)));
  // outras faturas em aberto (de qualquer cliente) que podem receber esta baixa, escolhidas à mão
  const q = busca.trim().toLowerCase();
  const soAlfaNum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  // o que foi digitado pode ser um ou VÁRIOS números de fatura, completos ou mal formatados ("RB10-2026-002-0", "fat 71000-AE-09-2026-008-0")
  const sufixosPedidos = new Set(pedidosParciais.map(p => p.sufixo));
  const porNumero = pedidosCompletos.length + pedidosParciais.length > 0;
  const casaPedido = (numero: string) => pedidosCompletos.includes(numero.trim().toUpperCase()) || sufixosPedidos.has(sufixoDaFatura(numero));
  const livres = candidatas.filter(c => !itens.some(i => i.faturaId === c.id));
  const extras = (porNumero
    ? livres.filter(c => casaPedido(c.numero))
    : q.length < 2 ? [] : livres.filter(c => `${c.numero} ${c.cliente} ${c.ug} ${c.tipo || ''}`.toLowerCase().includes(q) || (soAlfaNum(q).length >= 4 && soAlfaNum(c.numero).includes(soAlfaNum(q)))))
    .filter(c => incluirContestadas || !c.contestada || porNumero)
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || '') || a.numero.localeCompare(b.numero)).slice(0, porNumero ? 30 : 8);
  // números digitados que não viraram opção: diz POR QUÊ (já quitada, cancelada, não existe...)
  const naoAchadas = !porNumero ? [] : [
    ...pedidosCompletos.filter(n => !extras.some(c => c.numero.trim().toUpperCase() === n)).map(n => ({ rotulo: n, filtro: (x: string) => x.trim().toUpperCase() === n })),
    ...pedidosParciais.filter(p => !extras.some(c => sufixoDaFatura(c.numero) === p.sufixo)).map(p => ({ rotulo: p.original, filtro: (x: string) => sufixoDaFatura(x) === p.sufixo })),
  ].map(p => {
    const todas = invoices.filter(i => p.filtro(i.invoiceNumber || ''));
    if (!todas.length) return { rotulo: p.rotulo, motivo: 'não existe no sistema (confira o número com a OM)' };
    const i = todas[0];
    if (i.isCanceled) return { rotulo: `${i.invoiceNumber}`, motivo: 'fatura cancelada' };
    if (i.quitacaoExterna) return { rotulo: `${i.invoiceNumber}`, motivo: 'quitada fora do sistema' };
    const c = candidatas.find(x => x.id === i.id);
    if (!c) return { rotulo: `${i.invoiceNumber}`, motivo: 'já está quitada (não tem saldo em aberto)' };
    if (itens.some(x => x.faturaId === i.id)) return { rotulo: `${i.invoiceNumber}`, motivo: 'já está na lista acima' };
    return { rotulo: `${i.invoiceNumber}`, motivo: c.contestada ? 'está contestada: marque "Incluir faturas contestadas"' : 'não pôde ser adicionada' };
  });
  const adicionar = (c: (typeof candidatas)[number]) => {
    const resta = Math.max(0, doc.availableValue - itens.reduce((t, x) => t + x.valor, 0));
    setItens([...itens, { faturaId: c.id, numero: c.numero, cliente: c.cliente, vencimento: c.vencimento, saldoFatura: c.saldo, valor: Math.round(Math.min(c.saldo, resta) * 100) / 100,
      grupo: 'COMANDO', foraDestinacao: temDestinacao && !foiIndicada(c.numero), contestada: !!c.contestada }]);
    setBusca('');
  };
  /** várias de uma vez: cada uma recebe o que ainda resta do saldo da ALTCRED (no máximo o saldo da fatura) */
  const adicionarTodas = (lista: typeof extras) => {
    let resta = Math.max(0, doc.availableValue - itens.reduce((t, x) => t + x.valor, 0));
    const novos = lista.map(c => {
      const valor = Math.round(Math.min(c.saldo, resta) * 100) / 100; resta = Math.round((resta - valor) * 100) / 100;
      return { faturaId: c.id, numero: c.numero, cliente: c.cliente, vencimento: c.vencimento, saldoFatura: c.saldo, valor, grupo: 'COMANDO' as const, foraDestinacao: temDestinacao && !foiIndicada(c.numero), contestada: !!c.contestada };
    });
    setItens([...itens, ...novos]); setBusca('');
  };
  // ALTCRED sem fatura para pagar: vira adiantamento (só se ainda não pagou nada com ela)
  const temBaixas = baixas.some(b => b.documentId === doc.id);
  const virarAdiantamento = async () => {
    if (!window.confirm(`Transformar a ${doc.documentNumber} em ADIANTAMENTO? O saldo de ${brl(doc.availableValue)} fica guardado para as próximas faturas do cliente.`)) return;
    try {
      await db.saveDocument({ ...doc, operation: OperationType.ADIANTAMENTO, informedAdvance: true, aguardando: false, sobraAdiantamento: false });
      notify.success(`${doc.documentNumber} agora é adiantamento.`);
      await onGravado(); onClose();
    } catch (e) { notify.fail('Erro ao transformar em adiantamento', e); }
  };
  const preencher = (k: number) => {
    const outros = itens.reduce((s, x, n) => s + (n === k ? 0 : x.valor), 0);
    alterar(k, Math.min(itens[k].saldoFatura, Math.max(0, doc.availableValue - outros)));
  };

  const gravar = async () => {
    setGravando(true);
    try {
      const r = await gravarBaixaAssistida(doc, itens, invoices, { enviarSobra: enviarSobra && ehPagamento, data, motivoFora: foraUsadas.length ? motivoFora : '', usuario });
      notify.success(`${r.baixas} baixa(s) gravada(s)${r.sobra > 0.005 && enviarSobra && ehPagamento ? `; sobra de ${brl(r.sobra)} enviada para adiantamento` : ''}.`);
      await onGravado();
      onClose();
    } catch (e) { notify.fail('Erro ao gravar as baixas', e); } finally { setGravando(false); }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Baixa assistida — ${doc.documentNumber}`} maxWidth="max-w-5xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-700">
            Saldo {brl(doc.availableValue)} · usar <b>{brl(usado)}</b> · sobra <b className={sobra < -0.005 ? 'text-red-600' : ''}>{brl(sobra)}</b>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={gravando}>Cancelar</Button>
            <Button onClick={gravar} isLoading={gravando} disabled={!!bloqueio || erros.length > 0 || usado <= 0 || (foraUsadas.length > 0 && !motivoFora.trim())} title={bloqueio || (temDestinacao && foraUsadas.length > 0 && !motivoFora.trim() ? 'Informe o motivo de a baixa sair fora do que a OM indicou' : undefined)}>Gravar baixas</Button>
          </div>
        </div>
      }>
      <div className="space-y-4 text-sm">
        {doc.situacaoSiplad && !classificarSituacao(doc.situacaoSiplad).recebido && (
          <p className="p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 flex gap-2" role="alert">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <span>Situação no SIPLAD: <b>{classificarSituacao(doc.situacaoSiplad).rotulo}</b>. {classificarSituacao(doc.situacaoSiplad).explicacao} <b>Baixa bloqueada até o SIPLAD processar.</b></span>
          </p>
        )}
        <div className="grid md:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-[11px] uppercase text-slate-500 font-semibold">Cliente</div>
            <div className="font-medium">{doc.client}</div>
            <div className="text-xs text-slate-500">{doc.ugCliente || doc.command}</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 md:col-span-2">
            <div className="text-[11px] uppercase text-slate-500 font-semibold">Destinação / observação do solicitante</div>
            <div className="text-xs text-slate-700">
              {doc.destinacao?.length ? doc.destinacao.map(d => d.valor).join(', ') : citadas.length ? citadas.join(', ') : 'Nenhuma fatura indicada: proposta com as faturas do comando, mais antigas primeiro.'}
            </div>
            {doc.observacaoSolicitante && <div className="text-xs text-slate-500 mt-1">{doc.observacaoSolicitante}</div>}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center">
          <label className="flex items-center gap-2"><input type="checkbox" checked={incluirContestadas} onChange={e => setIncluirContestadas(e.target.checked)} className="h-4 w-4 accent-primary-600" /> Incluir faturas contestadas</label>
          {ehPagamento && (
            <label className="flex items-center gap-2"><input type="checkbox" checked={enviarSobra} onChange={e => setEnviarSobra(e.target.checked)} className="h-4 w-4 accent-primary-600" /> Enviar a sobra para adiantamento ("SALDO ENVIADO PARA ADIANTAMENTO")</label>
          )}
          <label className="flex items-center gap-2">Data da baixa <input type="date" value={data} onChange={e => setData(e.target.value)} className="border border-slate-300 rounded px-2 py-1" /></label>
        </div>

        {itens.length === 0 ? (
          <div className="p-6 text-center text-slate-500 border border-dashed border-slate-300 rounded-lg space-y-3" data-testid="sem-faturas-baixa">
            <p>Nenhuma fatura em aberto encontrada para este cliente/comando. Confira a UG e o comando do documento, procure a fatura no campo abaixo ("Adicionar outra fatura em aberto") ou guarde o saldo como adiantamento.</p>
            {ehPagamento && !temBaixas && <Button variant="secondary" onClick={virarAdiantamento}>Transformar esta ALTCRED em adiantamento</Button>}
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[50vh] overflow-y-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0">
                <tr><th className="px-3 py-2 text-left">Fatura</th><th className="px-3 py-2 text-left">Cliente</th><th className="px-3 py-2 text-left">Vencimento</th><th className="px-3 py-2 text-right">Saldo da fatura</th><th className="px-3 py-2 text-right">Baixar</th><th className="px-3 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {itens.map((i, k) => (
                  <tr key={i.faturaId} className={i.valor > 0 ? 'bg-emerald-50/40' : ''}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs">{i.numero}</div>
                      <div className="text-[11px] text-slate-500">{GRUPO[i.grupo]}{i.contestada ? ' · contestada' : ''}</div>
                      {i.citadaComo && <div className="text-[11px] text-amber-700" title="O cliente citou outro número; esta é a fatura do mesmo serviço e mês">citada como {i.citadaComo}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={i.cliente}>{i.cliente}</td>
                    <td className={`px-3 py-2 text-xs ${i.vencimento < data ? 'text-red-600' : ''}`}>{br(i.vencimento)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(i.saldoFatura)}</td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="0.01" min={0} aria-label={`Valor para ${i.numero}`} value={i.valor || ''} placeholder="0,00"
                        onChange={e => alterar(k, Number(e.target.value) || 0)}
                        className={`w-32 text-right border rounded px-2 py-1 ${i.valor > i.saldoFatura + 0.005 ? 'border-red-400' : 'border-slate-300'}`} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button className="text-xs text-primary-700 hover:underline mr-2" onClick={() => preencher(k)}>máximo</button>
                      {i.valor > 0 && <button className="text-xs text-slate-500 hover:underline" onClick={() => alterar(k, 0)}>zerar</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60 space-y-2">
          <label className="block text-xs font-semibold text-slate-600">Adicionar outra fatura em aberto (qualquer cliente)
            <input aria-label="Buscar fatura para adicionar" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Número(s) da fatura (pode colar vários, até mal formatados, ex.: RB10-2026-002-0), a UG ou o nome do cliente"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-normal bg-white" /></label>
          {q.length >= 2 && !extras.length && !naoAchadas.length && <p className="text-xs text-slate-500">Nenhuma outra fatura em aberto encontrada.</p>}
          {naoAchadas.map(n => <p key={n.rotulo} className="text-xs text-amber-800 flex gap-1" data-testid="fatura-nao-achada"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span><span className="font-mono">{n.rotulo}</span>: {n.motivo}.</span></p>)}
          {porNumero && extras.length > 1 && <button type="button" onClick={() => adicionarTodas(extras)} className="text-xs font-semibold text-primary-700 hover:underline">Adicionar as {extras.length} faturas encontradas</button>}
          {extras.map(c => (
            <button key={c.id} type="button" onClick={() => adicionar(c)} aria-label={`Adicionar a fatura ${c.numero}`}
              className="w-full flex flex-wrap items-center justify-between gap-2 text-left text-xs bg-white border border-slate-200 hover:border-primary-400 rounded px-2 py-1.5">
              <span><span className="font-mono">{c.numero}</span> · {c.cliente}{c.contestada ? ' · contestada' : ''}</span>
              <span className="tabular-nums text-slate-600">venc. {br(c.vencimento)} · saldo {brl(c.saldo)}</span>
            </button>
          ))}
        </div>

        {citadasInexistentes.length > 0 && (
          <div className="p-3 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 text-xs" role="note" data-testid="citadas-inexistentes">
            <b>∅ A OM citou {citadasInexistentes.length === 1 ? 'uma fatura' : `${citadasInexistentes.length} faturas`} que não existe(m) no sistema:</b> <span className="font-mono">{citadasInexistentes.join(', ')}</span>.
            Pode ser erro de digitação da OM. O sistema propõe a fatura parecida (mesmo cliente, serviço e mês), quando há uma só em aberto; confira com a OM antes de gravar.
          </div>
        )}
        {erros.map(e => <p key={e} className="text-red-600 flex gap-1"><AlertTriangle size={14} className="mt-0.5" />{e}</p>)}
        {foraUsadas.length > 0 && (
          <div className="p-3 rounded-lg border border-amber-300 bg-amber-50 space-y-2" data-testid="motivo-fora">
            <p className="text-amber-800 flex gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
              A OM indicou outras faturas. {foraUsadas.length} fatura(s) fora da indicação receberão baixa: <span className="font-mono">{foraUsadas.map(i => i.numero).join(', ')}</span>.
              Isso ficará marcado como ponto de atenção, já com o motivo abaixo.
            </p>
            <label className="block text-slate-700 font-medium">Motivo de pagarmos diferente do que a OM indicou (obrigatório)
              <textarea rows={2} className="mt-1 w-full border border-amber-300 rounded-md p-2 text-sm bg-white font-normal" aria-label="Motivo da baixa fora da indicação" value={motivoFora} onChange={e => setMotivoFora(e.target.value)}
                placeholder="Ex.: a OM confirmou por telefone que o pagamento é da fatura 010; a 008 já estava quitada" />
            </label>
          </div>
        )}
        {sobra > 0.005 && ehPagamento && !enviarSobra && <p className="text-slate-600">A sobra de {brl(sobra)} continua disponível neste documento.</p>}
      </div>
    </Modal>
  );
};
