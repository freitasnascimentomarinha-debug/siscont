import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Invoice, OM, PaymentAllocation, ReceivedDocument } from '../../types';
import { ItemProposta, proporBaixa, validarBaixa } from '../../utils/baixaAssistida';
import { RE_FATURA_TEXTO } from '../../utils/altcredSiplad';
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
  baixas: PaymentAllocation[]; oms: OM[]; onGravado: () => Promise<void>;
}> = ({ doc, onClose, invoices, documentos, baixas, oms, onGravado }) => {
  const [itens, setItens] = useState<ItemProposta[]>([]);
  const [incluirContestadas, setIncluirContestadas] = useState(false);
  const [enviarSobra, setEnviarSobra] = useState(true);
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');

  const candidatas = useMemo(() => (doc ? faturasCandidatas(invoices, documentos, baixas, oms) : []), [doc, invoices, documentos, baixas, oms]);
  const citadas = useMemo(() => [...new Set(`${doc?.observacaoSolicitante || ''} ${doc?.observation || ''}`.match(RE_FATURA_TEXTO) || [])], [doc]);

  useEffect(() => {
    if (!doc) return;
    const p = proporBaixa({
      saldo: doc.availableValue, ug: doc.ug, ugClienteCodigo: doc.ugCliente?.match(/\d{5}/)?.[0], comandoId: doc.comandoId,
      destinacao: doc.destinacao, faturasCitadas: citadas,
    }, candidatas, { incluirContestadas });
    setItens(p.itens);
  }, [doc, candidatas, citadas, incluirContestadas]);

  if (!doc) return null;
  const usado = Math.round(itens.reduce((s, i) => s + (i.valor > 0 ? i.valor : 0), 0) * 100) / 100;
  const sobra = Math.round((doc.availableValue - usado) * 100) / 100;
  const erros = validarBaixa(itens, doc.availableValue);
  const temDestinacao = itens.some(i => i.grupo !== 'COMANDO');
  const foraUsadas = itens.filter(i => i.foraDestinacao && i.valor > 0);
  const ehPagamento = doc.operation !== 'ADIANTAMENTO';
  const bloqueio = motivoBloqueio(doc.situacaoSiplad);

  const alterar = (k: number, valor: number) => setItens(itens.map((x, n) => (n === k ? { ...x, valor: Math.max(0, Math.round(valor * 100) / 100) } : x)));
  // outras faturas em aberto (de qualquer cliente) que podem receber esta baixa, escolhidas à mão
  const q = busca.trim().toLowerCase();
  const extras = q.length < 2 ? [] : candidatas
    .filter(c => !itens.some(i => i.faturaId === c.id) && (incluirContestadas || !c.contestada) && `${c.numero} ${c.cliente} ${c.ug} ${c.tipo || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || '') || a.numero.localeCompare(b.numero)).slice(0, 8);
  const adicionar = (c: (typeof candidatas)[number]) => {
    const resta = Math.max(0, doc.availableValue - itens.reduce((t, x) => t + x.valor, 0));
    setItens([...itens, { faturaId: c.id, numero: c.numero, cliente: c.cliente, vencimento: c.vencimento, saldoFatura: c.saldo, valor: Math.round(Math.min(c.saldo, resta) * 100) / 100,
      grupo: 'COMANDO', foraDestinacao: temDestinacao, contestada: !!c.contestada }]);
    setBusca('');
  };
  const preencher = (k: number) => {
    const outros = itens.reduce((s, x, n) => s + (n === k ? 0 : x.valor), 0);
    alterar(k, Math.min(itens[k].saldoFatura, Math.max(0, doc.availableValue - outros)));
  };

  const gravar = async () => {
    setGravando(true);
    try {
      const r = await gravarBaixaAssistida(doc, itens, invoices, { enviarSobra: enviarSobra && ehPagamento, data });
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
            <Button onClick={gravar} isLoading={gravando} disabled={!!bloqueio || erros.length > 0 || usado <= 0} title={bloqueio || undefined}>Gravar baixas</Button>
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
          <p className="p-6 text-center text-slate-500 border border-dashed border-slate-300 rounded-lg">
            Nenhuma fatura em aberto encontrada para este cliente/comando. Confira a UG e o comando do documento ou procure a fatura no campo abaixo ("Adicionar outra fatura em aberto").
          </p>
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
            <input aria-label="Buscar fatura para adicionar" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Digite o nº da fatura, a UG ou o nome do cliente (mín. 2 letras)"
              className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-normal bg-white" /></label>
          {q.length >= 2 && !extras.length && <p className="text-xs text-slate-500">Nenhuma outra fatura em aberto encontrada.</p>}
          {extras.map(c => (
            <button key={c.id} type="button" onClick={() => adicionar(c)} aria-label={`Adicionar a fatura ${c.numero}`}
              className="w-full flex flex-wrap items-center justify-between gap-2 text-left text-xs bg-white border border-slate-200 hover:border-primary-400 rounded px-2 py-1.5">
              <span><span className="font-mono">{c.numero}</span> · {c.cliente}{c.contestada ? ' · contestada' : ''}</span>
              <span className="tabular-nums text-slate-600">venc. {br(c.vencimento)} · saldo {brl(c.saldo)}</span>
            </button>
          ))}
        </div>

        {erros.map(e => <p key={e} className="text-red-600 flex gap-1"><AlertTriangle size={14} className="mt-0.5" />{e}</p>)}
        {temDestinacao && foraUsadas.length > 0 && (
          <p className="text-amber-700 flex gap-1"><AlertTriangle size={14} className="mt-0.5" />
            {foraUsadas.length} fatura(s) fora da destinação indicada pelo cliente receberão baixa. Isso ficará marcado como ponto de atenção.
          </p>
        )}
        {sobra > 0.005 && ehPagamento && !enviarSobra && <p className="text-slate-600">A sobra de {brl(sobra)} continua disponível neste documento.</p>}
      </div>
    </Modal>
  );
};
