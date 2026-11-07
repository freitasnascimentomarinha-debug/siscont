import React, { useState } from 'react';
import { Invoice } from '../../types';
import { marcarFaturas } from '../../services/faturamentoService';
import { dataBROuTraco, hojeISO } from '../../utils/datas';
import { notify } from '../../utils/notify';

type Campo = 'enviada_em' | 'certificada_em' | 'siafi_em';
const CAMPOS: { campo: Campo; rotulo: string; valor: (i: Invoice) => string | null | undefined }[] = [
  { campo: 'enviada_em', rotulo: 'Enviada ao comando', valor: i => i.enviadaEm },
  { campo: 'certificada_em', rotulo: 'Certificada no SIPLAD', valor: i => i.certificadaEm },
  { campo: 'siafi_em', rotulo: 'Registrada no SIAFI', valor: i => i.siafiEm },
];

/** Datas da fatura emitida: vencimento, data-limite de certificação e o andamento (envio, certificação e SIAFI). */
export const AcompanhamentoFatura: React.FC<{ inv: Invoice; podeEditar: boolean; onMudou: () => Promise<void> | void }> = ({ inv, podeEditar, onMudou }) => {
  const [ocupado, setOcupado] = useState<Campo | null>(null);
  const marcar = async (campo: Campo, data: string | null) => {
    setOcupado(campo);
    try { await marcarFaturas([inv.id], campo, data); await onMudou(); }
    catch (e) { notify.fail('Não foi possível gravar', e); } finally { setOcupado(null); }
  };
  return (
    <div className="mt-3 p-3 bg-white border border-slate-200 rounded max-w-4xl">
      <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Acompanhamento da fatura</h4>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div><div className="text-[11px] text-slate-500">Emissão</div><b>{dataBROuTraco(inv.issueDate)}</b></div>
        <div title="Prazo para a OM certificar a fatura no SIPLAD (emissão + dias úteis)"><div className="text-[11px] text-slate-500">Data-limite de certificação</div><b>{dataBROuTraco(inv.dataLimiteCertificacao)}</b></div>
        <div title="Prazo de pagamento. Faturas quitadas antes da regra de 30 dias mantêm o vencimento original"><div className="text-[11px] text-slate-500">Vencimento</div><b>{dataBROuTraco(inv.dueDate)}</b></div>
        {CAMPOS.map(c => {
          const v = c.valor(inv);
          return (
            <div key={c.campo}>
              <div className="text-[11px] text-slate-500">{c.rotulo}</div>
              {v ? <span className="font-bold text-green-700">{dataBROuTraco(v)}</span> : <span className="font-semibold text-orange-600">pendente</span>}
              {podeEditar && !inv.isCanceled && (
                <button type="button" disabled={ocupado === c.campo} className="ml-2 text-xs text-primary-700 underline disabled:opacity-50"
                  aria-label={`${v ? 'Desfazer' : 'Marcar'}: ${c.rotulo} (${inv.invoiceNumber})`}
                  onClick={() => marcar(c.campo, v ? null : hojeISO())}>{v ? 'desfazer' : 'marcar hoje'}</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
