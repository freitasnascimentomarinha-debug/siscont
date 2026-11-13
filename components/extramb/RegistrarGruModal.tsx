import React, { useEffect, useMemo, useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { CurrencyInput, Input, Select } from '../ui/Input';
import { FaturasParaPagar, SelecaoPagamento } from '../recebimentos/FaturasParaPagar';
import { db } from '../../services/db';
import { DocumentType, Invoice, OM, OperationType, ReceivedDocument } from '../../types';
import { distribuirPagamento, resumoPagamento, saldoDaFatura } from '../../utils/pagamentoDocumento';
import { hojeISO } from '../../utils/datas';
import { notify } from '../../utils/notify';

const r2 = (n: number) => Math.round(n * 100) / 100;
const VAZIO = { omId: '', numero: '', valor: undefined as number | undefined, data: '', autenticacao: '', obs: '' };

/**
 * Registrar uma GRU (pagamento de cliente Extra-Marinha) já pela página Extra-Marinha: cliente, número, valor, data e
 * autenticação do pagamento, e as faturas que ela paga. É o mesmo documento (tipo GRU) e as mesmas baixas dos Recebimentos.
 */
export const RegistrarGruModal: React.FC<{ aberto: boolean; onClose: () => void; clientes: OM[]; onSalvo: () => void }> = ({ aberto, onClose, clientes, onSalvo }) => {
  const [f, setF] = useState(VAZIO);
  const [selecao, setSelecao] = useState<SelecaoPagamento>({ ids: [], manuais: {} });
  const [faturas, setFaturas] = useState<Invoice[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) { setF({ ...VAZIO, data: hojeISO() }); setSelecao({ ids: [], manuais: {} }); setErro(null); db.getInvoices().then(setFaturas).catch(() => setFaturas([])); } }, [aberto]);

  const om = useMemo(() => clientes.find(o => o.id === f.omId) || null, [clientes, f.omId]);
  const idsExtra = useMemo(() => new Set(clientes.map(c => c.id)), [clientes]);
  // só faturas de clientes Extra-MB (o seletor "todas" mostra os outros clientes Extra-MB, para uma GRU que paga fatura de outro)
  const abertas = useMemo(() => faturas.filter(x => !x.isCanceled && !!x.omId && idsExtra.has(x.omId)), [faturas, idsExtra]);
  const valor = Number(f.valor) || 0;

  const salvar = async () => {
    setErro(null);
    if (!om) return setErro('Escolha o cliente Extra-Marinha.');
    if (!f.numero.trim()) return setErro('Informe o número da GRU.');
    if (!(valor > 0)) return setErro('Informe o valor da GRU.');
    if (!f.data) return setErro('Informe a data do pagamento.');
    setSalvando(true);
    try {
      const docs = await db.getDocuments();
      if (docs.some(d => d.documentNumber.trim().toUpperCase() === f.numero.trim().toUpperCase())) { setErro(`IMPEDIMENTO: o número "${f.numero.trim()}" já está cadastrado.`); return; }
      const escolhidas = selecao.ids.map(id => faturas.find(i => i.id === id)).filter(Boolean) as Invoice[];
      const itens = distribuirPagamento(valor, escolhidas.map(x => ({ id: x.id, saldo: saldoDaFatura(x) })), selecao.manuais).filter(i => i.valor > 0.005);
      if (resumoPagamento(valor, itens).excedeu) return setErro('O valor a pagar nas faturas escolhidas passa do valor da GRU. Ajuste os valores.');
      const doc: ReceivedDocument = {
        id: uuidv4(), ug: om.codigo, sector: 'EXTRA-MB', command: 'EXTRA-MARINHA', client: om.nome, documentNumber: f.numero.trim(), documentType: DocumentType.GRU,
        totalValue: r2(valor), availableValue: r2(valor), date: f.data, informedAdvance: false, operation: OperationType.PAGAMENTO, observation: f.obs,
        omId: om.id, ...(om.comandoId ? { comandoId: om.comandoId } : {}), gruAutenticacao: f.autenticacao.trim() || null, gruDataPagamento: f.data,
      } as ReceivedDocument;
      await db.saveDocument(doc);
      let baixas = 0;
      try {
        for (const it of itens) {
          await db.saveAllocation({ id: uuidv4(), documentId: doc.id, invoiceId: it.id, amount: it.valor, date: f.data, siscontSettled: false, siscontDueDate: '', observation: '', serviceType: faturas.find(i => i.id === it.id)?.type || '', tipoBaixa: 'PAGAMENTO' });
          baixas++;
        }
      } catch (e) { notify.fail(`GRU salva, mas houve erro depois de ${baixas} baixa(s); complete pela página Recebimentos (Pagar faturas)`, e); }
      notify.success(baixas ? `GRU ${doc.documentNumber} registrada e ${baixas} fatura(s) baixada(s).` : `GRU ${doc.documentNumber} registrada. Sem fatura escolhida: o valor fica como crédito do cliente.`);
      onClose(); onSalvo();
    } catch (e) { setErro(`Erro ao salvar: ${e instanceof Error ? e.message : String(e)}`); } finally { setSalvando(false); }
  };

  return (
    <Modal isOpen={aberto} onClose={onClose} title="Registrar GRU (cliente Extra-Marinha)" maxWidth="max-w-3xl"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button><Button onClick={salvar} isLoading={salvando}>{selecao.ids.length ? `Salvar e baixar ${selecao.ids.length} fatura(s)` : 'Salvar GRU'}</Button></div>}>
      {erro && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded flex items-start gap-2 text-red-700"><AlertOctagon size={20} className="shrink-0 mt-0.5" /><span className="font-semibold text-sm">{erro}</span></div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select label="Cliente Extra-Marinha" required options={[{ label: 'Escolha...', value: '' }, ...clientes.filter(c => c.ativo).map(c => ({ label: `${c.nome}${c.codigo ? ` (${c.codigo})` : ''}`, value: c.id }))]} value={f.omId} onChange={e => { setF({ ...f, omId: e.target.value }); setSelecao({ ids: [], manuais: {} }); }} />
        <Input label="Número da GRU" required value={f.numero} onChange={e => setF({ ...f, numero: e.target.value })} />
        <CurrencyInput label="Valor" value={f.valor} onChange={v => setF({ ...f, valor: v })} />
        <Input label="Data do pagamento" type="date" required value={f.data} onChange={e => setF({ ...f, data: e.target.value })} />
        <Input label="Autenticação bancária" value={f.autenticacao} onChange={e => setF({ ...f, autenticacao: e.target.value })} />
        <Input label="Observação" value={f.obs} onChange={e => setF({ ...f, obs: e.target.value })} />
      </div>
      <p className="text-xs text-slate-500 mt-2">A GRU não entra no Fluxo de Caixa nem na lista de Recebimentos (só ALTCRED). Ela baixa as faturas do cliente; se não escolher nenhuma, o valor fica como crédito de GRU do cliente.</p>
      {om && <FaturasParaPagar faturas={abertas} omId={om.id} nomeOM={om.nome} valorDoc={valor} selecao={selecao} onChange={setSelecao} />}
    </Modal>
  );
};
