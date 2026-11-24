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

/** Pontos de fatura em que o dado a corrigir é o VALOR (ou que não têm correção própria): abrem o editor de valores da fatura. */
const PONTOS_VALOR = new Set(['VALOR_DIVERGENTE_LIVRO', 'FATURA_DO_LIVRO', 'VALOR_NEGATIVO', 'STATUS_DIVERGENTE']);
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
  const [vServ, setVServ] = useState('');
  const [vAcr, setVAcr] = useState('');
  const [vDeb, setVDeb] = useState('');
  const [vVenc, setVVenc] = useState('');

  const carregar = async () => {
    const [f, d, b] = await Promise.all([db.getInvoices(), db.getDocuments(), db.getAllocations()]);
    setFaturas(f); setDocs(d); setBaixas(b);
  };
  useEffect(() => { carregar().catch(() => undefined); }, [id]);

  const fatura = alvo === 'fatura' ? faturas.find(f => f.id === id) : undefined;
  const doc = alvo === 'documento' ? docs.find(d => d.id === id) : undefined;
  useEffect(() => {
    if (fatura) { setEmissao(fatura.issueDate || ''); setVencimento(fatura.dueDate && fatura.dueDate >= (fatura.issueDate || '') ? fatura.dueDate : somarDias(fatura.issueDate || new Date().toISOString().slice(0, 10), 30)); setCliente(fatura.client); }
    if (fatura) { setVServ(String(fatura.value ?? '')); setVAcr(String(fatura.adjustmentAddition || 0)); setVDeb(String(fatura.adjustmentDeduction || 0)); setVVenc(fatura.dueDate || ''); }
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

  // editor de valores: para os pontos de valor e, na falta de uma correção própria, para qualquer ponto de fatura
  const editorValores = () => {
    if (!fatura) return;
    const n = (t: string) => Math.round((Number(String(t).replace(',', '.')) || 0) * 100) / 100;
    const total = n(vServ) + n(vAcr) - n(vDeb);
    // o ponto "valor diferente do livro de emissão" traz os valores do livro no texto: atalho para preencher
    const num = (t: string) => Number(t.replace(/\./g, '').replace(',', '.'));
    const mLivro = ponto.mensagem.match(/livro de emissão R\$ [\d.,]+ \(serviço R\$ ([\d.,]+) \+ acréscimo R\$ ([\d.,]+) − débito R\$ ([\d.,]+)\)/);
    const livro = mLivro ? { serv: num(mLivro[1]), acr: num(mLivro[2]), deb: num(mLivro[3]) } : null;
    const mudou = n(vServ) !== fatura.value || n(vAcr) !== (fatura.adjustmentAddition || 0) || n(vDeb) !== (fatura.adjustmentDeduction || 0) || (vVenc || '') !== (fatura.dueDate || '');
    const campo = 'mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white font-normal';
    acoes.push(
      <div key="valores" className="space-y-2" data-testid="editor-valores-fatura">
        <div className="text-xs font-semibold text-slate-600">Alterar o valor da fatura {fatura.invoiceNumber} (valor atual do serviço: {brl(fatura.value)})</div>
        {livro && <button type="button" className="text-xs font-semibold text-primary-700 underline" onClick={() => { setVServ(String(livro.serv)); setVAcr(String(livro.acr)); setVDeb(String(livro.deb)); }}>Usar os valores do livro de emissão (serviço {brl(livro.serv)})</button>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <label className="text-xs font-semibold text-slate-600">01 Serviço (R$)<input type="number" step="0.01" aria-label="Valor do serviço da fatura" value={vServ} onChange={e => setVServ(e.target.value)} className={campo} /></label>
          <label className="text-xs font-semibold text-slate-600">03 Acréscimo<input type="number" step="0.01" min="0" aria-label="Acréscimo da fatura" value={vAcr} onChange={e => setVAcr(e.target.value)} className={campo} /></label>
          <label className="text-xs font-semibold text-slate-600">04 Débito<input type="number" step="0.01" min="0" aria-label="Débito da fatura" value={vDeb} onChange={e => setVDeb(e.target.value)} className={campo} /></label>
          <label className="text-xs font-semibold text-slate-600">Vencimento<input type="date" aria-label="Vencimento da fatura (valores)" value={vVenc} onChange={e => setVVenc(e.target.value)} className={campo} /></label>
        </div>
        <div className="text-xs text-slate-600">Valor total da fatura: <b className="tabular-nums">{brl(total)}</b>{total < 0 && <span className="text-red-700"> — não pode ser negativo (lance o crédito como débito)</span>}</div>
        <Button size="sm" isLoading={gravando} disabled={!mudou || total < 0 || !(n(vServ) >= 0)}
          onClick={() => aplicar(`valores da fatura (serviço ${brl(fatura.value)} → ${brl(n(vServ))}${n(vAcr) !== (fatura.adjustmentAddition || 0) ? `; acréscimo ${brl(n(vAcr))}` : ''}${n(vDeb) !== (fatura.adjustmentDeduction || 0) ? `; débito ${brl(n(vDeb))}` : ''}${(vVenc || '') !== (fatura.dueDate || '') ? `; vencimento ${dataBR(vVenc)}` : ''})`,
            () => db.saveInvoice({ ...fatura, value: n(vServ), adjustmentAddition: n(vAcr), adjustmentDeduction: n(vDeb), dueDate: vVenc || fatura.dueDate }))}>Gravar a alteração</Button>
        <p className="text-xs text-slate-500">A alteração fica no histórico da fatura (quem alterou e quando). Baixas já dadas são mantidas.</p>
      </div>);
  };
  if (fatura && PONTOS_VALOR.has(ponto.tipo)) editorValores();

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

  // ponto de fatura sem correção própria: ao menos o editor de valores, para não obrigar a sair da janela
  if (!acoes.length && fatura) editorValores();
  // ponto de documento sem correção própria: editor do valor e da data do documento
  if (!acoes.length && doc) acoes.push(
    <div key="doc-geral" className="space-y-2" data-testid="editor-documento">
      <div className="text-xs font-semibold text-slate-600">Alterar o documento {doc.documentNumber}</div>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-slate-600">Valor recebido (R$)<input type="number" step="0.01" min="0" aria-label="Valor do documento" value={valor} onChange={e => setValor(e.target.value)} className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white font-normal" /></label>
        <label className="text-xs font-semibold text-slate-600">Data<input type="date" aria-label="Data do documento" value={data} onChange={e => setData(e.target.value)} className="mt-1 block w-full border border-slate-300 rounded px-2 py-1 text-sm bg-white font-normal" /></label>
      </div>
      <Button size="sm" isLoading={gravando} disabled={!(Number(valor) > 0) || !data || (Math.round(Number(valor) * 100) / 100 === doc.totalValue && data === doc.date)}
        onClick={() => aplicar(`documento (valor ${brl(Number(valor))}, data ${dataBR(data)})`, () => db.saveDocument({ ...doc, totalValue: Math.round(Number(valor) * 100) / 100, date: data }))}>Gravar a alteração</Button>
    </div>);
  if (!acoes.length) return null;
  return (
    <div className="mt-2 rounded-md border border-primary-200 bg-primary-50/50 p-2.5 space-y-2" data-testid="corrigir-agora">
      <div className="text-xs font-bold text-primary-800 flex items-center gap-1"><Wrench size={12} /> Corrigir agora, sem sair desta janela</div>
      {acoes}
    </div>
  );
};
