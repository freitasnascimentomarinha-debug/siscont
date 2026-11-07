import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Destinacao, ReceivedDocument } from '../../types';
import { RE_FATURA_TEXTO } from '../../utils/altcredSiplad';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const br = (iso?: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');

const Campo: React.FC<{ rotulo: string; valor?: React.ReactNode }> = ({ rotulo, valor }) => (
  <div><div className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold">{rotulo}</div><div className="text-sm text-slate-800">{valor || '—'}</div></div>
);

/** Dados da Solicitação de Alteração de Crédito (SIPLAD), destinação, estorno e GRU, no detalhe do documento. */
export const DadosSiplad: React.FC<{ doc: ReceivedDocument }> = ({ doc }) => {
  const tem = doc.tipoAlteracao || doc.ugCliente || doc.celulas?.length || doc.destinacao?.length || doc.gruAutenticacao || doc.observacaoSolicitante || doc.valorEstornado;
  if (!tem) return null;
  return (
    <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50/60 space-y-3" data-testid="dados-siplad">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {doc.documentType === 'GRU' ? (
          <>
            <Campo rotulo="Autenticação bancária" valor={doc.gruAutenticacao} />
            <Campo rotulo="Data do pagamento" valor={br(doc.gruDataPagamento)} />
          </>
        ) : (
          <>
            <Campo rotulo="Tipo de alteração" valor={doc.tipoAlteracao} />
            <Campo rotulo="Criação / situação" valor={`${br(doc.dataCriacao)} · ${doc.situacaoSiplad || '—'} em ${br(doc.date)}`} />
            <Campo rotulo="UG cliente" valor={doc.ugCliente} />
            <Campo rotulo="Exercício" valor={doc.exercicio} />
          </>
        )}
        {doc.altcredOrigem && <Campo rotulo="ALTCRED de origem" valor={doc.altcredOrigem} />}
        {!!doc.valorEstornado && <Campo rotulo="Valor original / estornado" valor={`${brl(doc.valorOriginal ?? doc.totalValue + doc.valorEstornado)} / ${brl(doc.valorEstornado)}`} />}
      </div>
      {doc.observacaoSolicitante && <Campo rotulo="Observação do solicitante" valor={doc.observacaoSolicitante} />}
      {!!doc.destinacao?.length && <Campo rotulo="Destinação indicada" valor={doc.destinacao.map(d => d.valor).join(', ')} />}
      {!!doc.celulas?.length && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead><tr className="text-slate-500 text-left">{['Célula', 'PTRES', 'UO', 'FR', 'ND', 'Plano Interno', 'UGR', 'UGE', 'Valor'].map(h => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {doc.celulas.map((c, i) => (
                <tr key={i} className="border-t border-slate-200">
                  <td className="px-2 py-1">{c.tipo === 'DEBITO' ? 'Débito (CDD)' : 'Crédito (CDC)'}</td>
                  <td className="px-2 py-1">{c.ptres}</td><td className="px-2 py-1">{c.uo}</td><td className="px-2 py-1">{c.fr}</td><td className="px-2 py-1">{c.nd}</td>
                  <td className="px-2 py-1 font-mono">{c.pi}</td><td className="px-2 py-1">{c.ugr}</td><td className="px-2 py-1">{c.uge}</td><td className="px-2 py-1 text-right tabular-nums">{brl(c.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const entrada = 'w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';

/** Campos da Fase 2 no formulário do documento (seção recolhível). */
export const CamposFase2: React.FC<{ dados: Partial<ReceivedDocument>; onChange: (d: Partial<ReceivedDocument>) => void }> = ({ dados, onChange }) => {
  const [aberto, setAberto] = useState(!!(dados.destinacao?.length || dados.gruAutenticacao || dados.aguardando));
  const gru = dados.documentType === 'GRU';
  const destTexto = (dados.destinacao || []).filter(d => d.tipo === 'FATURA').map(d => d.valor).join(', ');
  const [textoDest, setTextoDest] = useState(destTexto);
  const lerDestinacao = (t: string) => {
    setTextoDest(t);
    const nums = [...new Set((t.toUpperCase().match(RE_FATURA_TEXTO) || []))];
    const outras = (dados.destinacao || []).filter(d => d.tipo !== 'FATURA');
    onChange({ destinacao: [...outras, ...nums.map(valor => ({ tipo: 'FATURA', valor }) as Destinacao)] });
  };
  return (
    <div className="mt-4 border-t border-slate-200 pt-3">
      <button type="button" className="flex items-center gap-1 text-sm font-semibold text-slate-700" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {gru ? 'Dados da GRU' : 'Destinação, adiantamento e dados do SIPLAD'}
      </button>
      {aberto && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
          {gru ? (
            <>
              <label className="text-slate-700">Autenticação bancária<input className={entrada} value={dados.gruAutenticacao || ''} onChange={e => onChange({ gruAutenticacao: e.target.value })} /></label>
              <label className="text-slate-700">Data do pagamento<input type="date" className={entrada} value={dados.gruDataPagamento || ''} onChange={e => onChange({ gruDataPagamento: e.target.value || null })} /></label>
            </>
          ) : (
            <>
              <label className="text-slate-700 md:col-span-2">Faturas indicadas pelo cliente (destinação)
                <textarea className={entrada} rows={2} value={textoDest} placeholder="Cole os números das faturas (ex.: 40030-EL-08-2026-010-0, 40030-AE-08-2026-004-0)"
                  onChange={e => lerDestinacao(e.target.value)} />
                <span className="text-xs text-slate-500">{(dados.destinacao || []).filter(d => d.tipo === 'FATURA').length} fatura(s) reconhecida(s). A baixa assistida usa estas primeiro e avisa se a baixa sair delas.</span>
              </label>
              <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={!!dados.aguardando} onChange={e => onChange({ aguardando: e.target.checked })} /> Aguardando o cliente indicar as faturas</label>
              {dados.operation !== 'ADIANTAMENTO' && (
                <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={!!dados.sobraAdiantamento} onChange={e => onChange({ sobraAdiantamento: e.target.checked })} /> Sobra enviada para adiantamento</label>
              )}
              <label className="text-slate-700">Exercício<input type="number" className={entrada} value={dados.exercicio ?? ''} onChange={e => onChange({ exercicio: e.target.value ? Number(e.target.value) : null })} /></label>
              <label className="text-slate-700">Tipo de alteração (SIPLAD)<input className={entrada} value={dados.tipoAlteracao || ''} onChange={e => onChange({ tipoAlteracao: e.target.value })} /></label>
              <label className="text-slate-700">UG cliente<input className={entrada} value={dados.ugCliente || ''} placeholder="91600 - ComForSup" onChange={e => onChange({ ugCliente: e.target.value })} /></label>
              <label className="text-slate-700">ALTCRED de origem (estorno/remanejamento)<input className={entrada} value={dados.altcredOrigem || ''} onChange={e => onChange({ altcredOrigem: e.target.value || null })} /></label>
              <label className="text-slate-700 md:col-span-2">Observação do solicitante<textarea className={entrada} rows={2} value={dados.observacaoSolicitante || ''} onChange={e => onChange({ observacaoSolicitante: e.target.value })} /></label>
            </>
          )}
        </div>
      )}
    </div>
  );
};
