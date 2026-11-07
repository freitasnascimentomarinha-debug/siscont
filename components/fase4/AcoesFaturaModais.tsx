import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Invoice } from '../../types';
import { abrirContestacao, cancelarFatura, substituirFatura } from '../../services/fase4Service';
import { proximaVersao } from '../../utils/fase4';
import { notify } from '../../utils/notify';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const entrada = 'w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';
const hoje = () => new Date().toISOString().slice(0, 10);

export type AcaoFatura = { tipo: 'cancelar' | 'substituir' | 'contestar'; fatura: Invoice } | null;

/** Cancelamento (motivo obrigatório), "cancela e substitui" (nova versão) e abertura de contestação. */
export const AcoesFaturaModais: React.FC<{
  acao: AcaoFatura; onClose: () => void; onFeito: () => Promise<void>; usuario: string; numeros: string[]; baixado: (id: string) => number;
}> = ({ acao, onClose, onFeito, usuario, numeros, baixado }) => {
  const [motivo, setMotivo] = useState('');
  const [devolver, setDevolver] = useState(true);
  const [origem, setOrigem] = useState('SIPLAD');
  const [abertaEm, setAbertaEm] = useState(hoje());
  const [anexo, setAnexo] = useState('');
  const [alt, setAlt] = useState({ value: 0, adjustmentAddition: 0, adjustmentDeduction: 0, consumption: '', issueDate: '', dueDate: '', observation: '' });
  const [gravando, setGravando] = useState(false);

  useEffect(() => {
    if (!acao) return;
    const f = acao.fatura;
    setMotivo(''); setDevolver(true); setOrigem('SIPLAD'); setAbertaEm(hoje()); setAnexo('');
    setAlt({ value: f.value, adjustmentAddition: f.adjustmentAddition || 0, adjustmentDeduction: f.adjustmentDeduction || 0, consumption: f.consumption || '', issueDate: f.issueDate, dueDate: f.dueDate, observation: f.observation || '' });
  }, [acao]);
  if (!acao) return null;
  const f = acao.fatura;
  const bx = baixado(f.id);

  const executar = async () => {
    setGravando(true);
    try {
      if (acao.tipo === 'cancelar') {
        await cancelarFatura(f, motivo, devolver, usuario);
        notify.success(`Fatura ${f.invoiceNumber} cancelada.`);
      } else if (acao.tipo === 'substituir') {
        const r = await substituirFatura(f, alt, motivo, usuario, numeros);
        notify.success(`Fatura ${r.numero} emitida: cancela e substitui a ${f.invoiceNumber}.`);
      } else {
        await abrirContestacao(f, { origem, justificativa: motivo, abertaEm, anexos: anexo.trim() ? [{ nome: anexo.trim() }] : [] }, usuario);
        notify.success(`Contestação da fatura ${f.invoiceNumber} aberta. Acompanhe em Contestações.`);
      }
      await onFeito();
      onClose();
    } catch (e) { notify.fail('Não foi possível concluir', e); } finally { setGravando(false); }
  };

  let novoNumero = '';
  try { novoNumero = proximaVersao(f.invoiceNumber, numeros); } catch { novoNumero = '(sem versão)'; }
  const novoTotal = alt.value + alt.adjustmentAddition - alt.adjustmentDeduction;
  const titulo = acao.tipo === 'cancelar' ? 'Cancelar fatura' : acao.tipo === 'substituir' ? 'Retificar: cancela e substitui' : 'Abrir contestação';

  return (
    <Modal isOpen onClose={onClose} title={`${titulo} — ${f.invoiceNumber}`} maxWidth="max-w-2xl"
      footer={<div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={gravando}>Voltar</Button>
        <Button variant={acao.tipo === 'cancelar' ? 'danger' : 'primary'} onClick={executar} isLoading={gravando} disabled={!motivo.trim()}>
          {acao.tipo === 'cancelar' ? 'Cancelar fatura' : acao.tipo === 'substituir' ? `Emitir ${novoNumero}` : 'Abrir contestação'}
        </Button>
      </div>}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">{f.client} · {f.type} · {f.competence} · total {brl(f.value + (f.adjustmentAddition || 0) - (f.adjustmentDeduction || 0))}{bx ? ` · baixado ${brl(bx)}` : ''}</p>

        {acao.tipo === 'contestar' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-slate-700">Recebida por
              <select className={entrada} value={origem} onChange={e => setOrigem(e.target.value)}>
                {[['SIPLAD', 'SIPLAD (recusa/devolução)'], ['EMAIL', 'E-mail'], ['MENSAGEM', 'Mensagem'], ['OFICIO', 'Ofício'], ['TELEFONE', 'Telefone'], ['OUTRO', 'Outro']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="text-slate-700">Em<input type="date" className={entrada} value={abertaEm} onChange={e => setAbertaEm(e.target.value)} /></label>
            <label className="text-slate-700 col-span-2">Documento de apoio (opcional)<input className={entrada} value={anexo} onChange={e => setAnexo(e.target.value)} placeholder="Ex.: OMS nº 02126 do ComGptPatNavS; e-mail de 21/09/26" /></label>
          </div>
        )}

        {acao.tipo === 'substituir' && (
          <>
            <p className="p-2 rounded bg-slate-50 border border-slate-200">A nova fatura <b className="font-mono">{novoNumero}</b> recebe as baixas da atual ({brl(bx)}), que fica <b>substituída</b>. O PDF da nova trará "Esta fatura cancela e substitui a de nº {f.invoiceNumber}".</p>
            <div className="grid grid-cols-3 gap-3">
              <label className="text-slate-700">01 Serviço (R$)<input type="number" step="0.01" className={entrada} value={alt.value} onChange={e => setAlt({ ...alt, value: Number(e.target.value) || 0 })} aria-label="Novo valor do serviço" /></label>
              <label className="text-slate-700">03 Acréscimo<input type="number" step="0.01" className={entrada} value={alt.adjustmentAddition} onChange={e => setAlt({ ...alt, adjustmentAddition: Number(e.target.value) || 0 })} /></label>
              <label className="text-slate-700">04 Débito<input type="number" step="0.01" className={entrada} value={alt.adjustmentDeduction} onChange={e => setAlt({ ...alt, adjustmentDeduction: Number(e.target.value) || 0 })} /></label>
              <label className="text-slate-700">Consumo<input className={entrada} value={alt.consumption} onChange={e => setAlt({ ...alt, consumption: e.target.value })} /></label>
              <label className="text-slate-700">Emissão<input type="date" className={entrada} value={alt.issueDate} onChange={e => setAlt({ ...alt, issueDate: e.target.value })} /></label>
              <label className="text-slate-700">Data-limite<input type="date" className={entrada} value={alt.dueDate} onChange={e => setAlt({ ...alt, dueDate: e.target.value })} /></label>
              <label className="text-slate-700 col-span-3">Observação<input className={entrada} value={alt.observation} onChange={e => setAlt({ ...alt, observation: e.target.value })} /></label>
            </div>
            {bx > novoTotal + 0.005 && <p className="text-amber-700 flex gap-1"><AlertTriangle size={14} className="mt-0.5" />As baixas ({brl(bx)}) passam do novo total ({brl(novoTotal)}): a nova fatura ficará paga a maior.</p>}
          </>
        )}

        {acao.tipo === 'cancelar' && bx > 0 && (
          <label className="flex items-start gap-2 text-slate-700">
            <input type="checkbox" className="h-4 w-4 mt-0.5 accent-primary-600" checked={devolver} onChange={e => setDevolver(e.target.checked)} />
            <span>Desfazer as baixas ({brl(bx)}) e devolver o saldo às ALTCRED/GRU. Desmarque só se o valor for transferido depois para outra fatura.</span>
          </label>
        )}

        <label className="text-slate-700 block">{acao.tipo === 'contestar' ? 'Justificativa da OM' : 'Motivo (obrigatório)'}
          <textarea className={entrada} rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} aria-label="Motivo"
            placeholder={acao.tipo === 'contestar' ? 'O que a OM alega (ex.: navio docado em Niterói no período)' : acao.tipo === 'substituir' ? 'Ex.: consumo corrigido pela Divisão de Eletricidade' : 'Ex.: fatura emitida em duplicidade; cancelada por solicitação do OD'} />
        </label>
      </div>
    </Modal>
  );
};
