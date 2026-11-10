import React, { useEffect, useMemo, useState } from 'react';
import { Wrench } from 'lucide-react';
import { Invoice, PaymentAllocation, ReceivedDocument } from '../../types';
import { db } from '../../services/db';
import { lerFatura } from '../../utils/cadastroImport';
import { somarDias } from '../../utils/cobrancaMensagem';
import { PontoAtencao } from '../../utils/pontosAtencao';
import { notify } from '../../utils/notify';
import { SeletorCliente } from '../ui/SeletorCliente';
import { Button } from '../ui/Button';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBR = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

const PONTOS_DATAS = new Set(['VENCIMENTO_INVALIDO', 'VENCIMENTO_CORRIGIDO', 'EMISSAO_CORRIGIDA']);
const PONTOS_BAIXAS = new Set(['PAGO_A_MAIOR', 'ADIANTAMENTO_MAIOR', 'CANCELADA_COM_BAIXA', 'BAIXA_SEM_DOCUMENTO', 'STATUS_DIVERGENTE',
  'ALTCRED_ESTOURADA', 'BAIXA_FORA_DESTINACAO', 'ALTCRED_DIVERGENTE', 'ADIANTAMENTO_DIVERGENTE', 'ADIANTAMENTO_NAO_ENVIADO', 'ALTCRED_NAO_IDENTIFICADA',
  'ALTCRED_CRIADA', 'BAIXA_SEM_FATURA', 'CREDITO_DE_FATURA_CANCELADA']);

/**
 * "Corrigir agora": a correção do ponto de atenção feita na própria janela, sem sair da tela.
 * Ponto automático some sozinho quando o dado é corrigido; ponto anotado pela migração é marcado como resolvido, com o que foi feito.
 */
export const CorrigirAgora: React.FC<{
  alvo: 'fatura' | 'documento'; id: string; ponto: PontoAtencao; usuario: string; onFeito: () => Promise<void> | void;
}> = ({ alvo, id, ponto, usuario, onFeito }) => {
  const [faturas, setFaturas] = useState<Invoice[]>([]);
  const [docs, setDocs] = useState<ReceivedDocument[]>([]);
  const [baixas, setBaixas] = useState<PaymentAllocation[]>([]);
  const [gravando, setGravando] = useState(false);
  const [emissao, setEmissao] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [valor, setValor] = useState('');
  const [data, setData] = useState('');
  const [cliente, setCliente] = useState('');

  const carregar = async () => {
    const [f, d, b] = await Promise.all([db.getInvoices(), db.getDocuments(), db.getAllocations()]);
    setFaturas(f); setDocs(d); setBaixas(b);
  };
  useEffect(() => { carregar().catch(() => undefined); }, [id]);

  const fatura = alvo === 'fatura' ? faturas.find(f => f.id === id) : undefined;
  const doc = alvo === 'documento' ? docs.find(d => d.id === id) : undefined;
  useEffect(() => {
    if (fatura) { setEmissao(fatura.issueDate || ''); setVencimento(fatura.dueDate && fatura.dueDate >= (fatura.issueDate || '') ? fatura.dueDate : somarDias(fatura.issueDate || new Date().toISOString().slice(0, 10), 30)); setCliente(fatura.client); }
    if (doc) { setValor(String(doc.totalValue || '')); setData(doc.date || ''); }
  }, [fatura?.id, doc?.id]);

  const faturaPorId = useMemo(() => new Map(faturas.map(f => [f.id, f])), [faturas]);
  const docPorId = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs]);
  const baixasDoAlvo = useMemo(() => baixas.filter(b => (alvo === 'fatura' ? b.invoiceId === id : b.documentId === id)), [baixas, alvo, id]);

  /** Aplica a correção; o ponto automático some sozinho e o anotado é marcado como resolvido com o que foi feito. */
  const aplicar = async (descricao: string, fazer: () => Promise<void>) => {
    setGravando(true);
    try {
      await fazer();
      if (!ponto.automatico) await db.resolverPonto(alvo, id, ponto, usuario, `Corrigido na própria janela: ${descricao}`);
      notify.success(`Corrigido: ${descricao}.`);
      await carregar(); await onFeito();
    } catch (e) { notify.fail('Não foi possível corrigir', e); } finally { setGravando(false); }
  };

  const acoes: React.ReactNode[] = [];

  // ---------------------------------------------------------------- faturas
  if (fatura && PONTOS_DATAS.has(ponto.tipo)) acoes.push(
    <div key="datas" className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-slate-600">Emissão<input type="date" aria-label="Emissão da fatura" value={emissao} onChange={e => setEmissao(e.target.value)} className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm font-normal bg-white" /></label>
        <label className="text-xs font-semibold text-slate-600">Vencimento<input type="date" aria-label="Vencimento da fatura" value={vencimento} onChange={e => setVencimento(e.target.value)} className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm font-normal bg-white" /></label>
      </div>
      <Button size="sm" isLoading={gravando} disabled={!emissao || !vencimento || vencimento < emissao}
        onClick={() => aplicar(`emissão ${dataBR(emissao)} e vencimento ${dataBR(vencimento)}`, () => db.saveInvoice({ ...fatura, issueDate: emissao, dueDate: vencimento }))}>Gravar as datas</Button>
      {vencimento && emissao && vencimento < emissao && <p className="text-xs text-red-700">O vencimento não pode ser antes da emissão.</p>}
    </div>);

  if (fatura && ponto.tipo === 'SEM_CADASTRO') acoes.push(
    <div key="om" className="space-y-2">
      <SeletorCliente valor={cliente} omId={fatura.omId} onTexto={setCliente}
        onEscolher={c => aplicar(`ligada à OM ${c.client}`, () => db.saveInvoice({ ...fatura, omId: c.omId, client: c.client, ug: c.ug, sector: c.sector || fatura.sector, command: c.command || fatura.command }))} />
      <p className="text-xs text-slate-500">Escolha a OM na lista: a fatura é ligada ao cadastro na hora.</p>
    </div>);

  if (fatura && ponto.tipo === 'COMPETENCIA_DIVERGENTE') {
    const n = lerFatura(fatura.invoiceNumber);
    if (n && n.competencia) {
      const mes = n.competencia % 100, ano = Math.floor(n.competencia / 100), comp = `${String(mes).padStart(2, '0')}/${ano}`;
      acoes.push(<Button key="comp" size="sm" isLoading={gravando} onClick={() => aplicar(`competência ajustada para ${comp} (a do número)`, () => db.saveInvoice({ ...fatura, monthCompetence: mes, yearCompetence: ano, competence: comp }))}>Ajustar a competência para {comp} (a do número)</Button>);
    }
  }
  if (fatura && ponto.tipo === 'SERVICO_DIVERGENTE') {
    const n = lerFatura(fatura.invoiceNumber);
    if (n) acoes.push(<Button key="serv" size="sm" isLoading={gravando} onClick={() => aplicar(`serviço ajustado para ${n.sigla} (o do número)`, () => db.saveInvoice({ ...fatura, serviceAcronym: n.sigla }))}>Ajustar o serviço para {n.sigla} (o do número)</Button>);
  }

  // ---------------------------------------------------------------- documentos
  if (doc && ponto.tipo === 'DOC_VALOR_INVALIDO') acoes.push(
    <div key="valor" className="flex items-end gap-2">
      <label className="text-xs font-semibold text-slate-600">Valor recebido (R$)<input type="number" step="0.01" min="0" aria-label="Valor do documento" value={valor} onChange={e => setValor(e.target.value)} className="mt-1 block w-40 border border-slate-300 rounded px-2 py-1 text-sm font-normal bg-white" /></label>
      <Button size="sm" isLoading={gravando} disabled={!(Number(valor) > 0)} onClick={() => aplicar(`valor do documento ${brl(Number(valor))}`, () => db.saveDocument({ ...doc, totalValue: Math.round(Number(valor) * 100) / 100 }))}>Gravar o valor</Button>
    </div>);
  if (doc && ponto.tipo === 'DATA_A_VERIFICAR') acoes.push(
    <div key="data" className="flex items-end gap-2">
      <label className="text-xs font-semibold text-slate-600">Data do documento<input type="date" aria-label="Data do documento" value={data} onChange={e => setData(e.target.value)} className="mt-1 block border border-slate-300 rounded px-2 py-1 text-sm font-normal bg-white" /></label>
      <Button size="sm" isLoading={gravando} disabled={!data} onClick={() => aplicar(`data do documento ${dataBR(data)}`, () => db.saveDocument({ ...doc, date: data }))}>Gravar a data</Button>
    </div>);

  // ---------------------------------------------------------------- baixas (fatura ou documento)
  if (PONTOS_BAIXAS.has(ponto.tipo) && baixasDoAlvo.length) acoes.push(
    <div key="baixas" className="space-y-1">
      <div className="text-xs font-semibold text-slate-600">{alvo === 'fatura' ? 'Baixas desta fatura' : 'Baixas deste documento'} — remova a que estiver errada:</div>
      <div className="border border-slate-200 rounded bg-white divide-y divide-slate-100 max-h-48 overflow-y-auto">
        {baixasDoAlvo.map(b => {
          const f = faturaPorId.get(b.invoiceId), d = docPorId.get(b.documentId);
          return (
            <div key={b.id} className="flex items-center gap-2 px-2 py-1.5 text-xs">
              <span className="flex-1 min-w-0">
                <span className="font-mono">{alvo === 'fatura' ? (d?.documentNumber ?? '(documento inexistente)') : (f?.invoiceNumber ?? '(fatura inexistente)')}</span>
                <span className="text-slate-500"> · {dataBR(b.date)}{b.tipoBaixa === 'ADIANTAMENTO' ? ' · adiantamento' : ''}</span>
              </span>
              <span className="tabular-nums font-semibold">{brl(b.amount)}</span>
              <button className="text-red-700 hover:underline font-semibold" disabled={gravando} aria-label={`Remover a baixa de ${brl(b.amount)}`}
                onClick={() => { if (window.confirm(`Remover esta baixa de ${brl(b.amount)}? O saldo volta ao documento e à fatura.`)) aplicar(`baixa de ${brl(b.amount)} removida`, () => db.deleteAllocation(b.id)); }}>remover</button>
            </div>
          );
        })}
      </div>
    </div>);

  if (!acoes.length) return null;
  return (
    <div className="mt-2 rounded-md border border-primary-200 bg-primary-50/50 p-2.5 space-y-2" data-testid="corrigir-agora">
      <div className="text-xs font-bold text-primary-800 flex items-center gap-1"><Wrench size={12} /> Corrigir agora, sem sair desta janela</div>
      {acoes}
    </div>
  );
};
