import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, Copy, FileArchive, Mail } from 'lucide-react';
import { ContextoFaturamento, Lote, listarLotes, marcarFaturas } from '../../services/faturamentoService';
import { baixarZipFr172 } from '../../services/fr172Service';
import { referencia } from '../../utils/faturamento';
import { notify } from '../../utils/notify';
import { Invoice } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { br, brl } from './comum';

const TIPO = { MENSAL: 'Mensal', OND: 'Estimado OND', ACERTO: 'Acerto do OND' };
const hoje = () => new Date().toISOString().slice(0, 10);
const totalFatura = (i: Invoice) => i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0);

/** Texto da mensagem de envio por comando (modelo editável). */
export function mensagemEnvio(cmd: { codigo?: string | null; nome: string; indicativo?: string | null }, faturas: Invoice[], lote: Lote, saldo: (i: Invoice) => number) {
  const linhas = faturas.map((f, k) => `${String(k + 1).padStart(2, '0')}) ${f.invoiceNumber} - ${f.client} - ${f.type.toUpperCase()} - ${brl(saldo(f))}`);
  return [
    `PARA: ${cmd.indicativo || `[indicativo de ${cmd.nome}]`}`,
    'DE: BNIC',
    'BT',
    `ENVIO DE FATURAS - REFERÊNCIA ${referencia(lote.competencia)}${lote.tipo === 'OND' ? ' (ESTIMADO OUT-DEZ)' : lote.tipo === 'ACERTO' ? ' (ACERTO DO OND)' : ''}`,
    `ALFA - INFORMO QUE ESTÃO DISPONÍVEIS NO SIPLAD AS FATURAS DE SERVIÇOS DE APOIO ABAIXO, EMITIDAS EM ${br(lote.dataEmissao)}, CUJA DATA-LIMITE PARA CERTIFICAÇÃO É ${br(lote.dataLimite)}:`,
    ...linhas,
    `BRAVO - TOTAL A PAGAR: ${brl(faturas.reduce((s, f) => s + saldo(f), 0))}.`,
    'CHARLIE - SOLICITO A CERTIFICAÇÃO NO SIPLAD ATÉ A DATA-LIMITE E O ENVIO DA ALTCRED CORRESPONDENTE, INDICANDO NA OBSERVAÇÃO OS NÚMEROS DAS FATURAS.',
    'BT',
  ].join('\n');
}

export const LotesEmitidos: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean; versao: number; recarregar: () => Promise<void> }> = ({ ctx, podeEditar, versao, recarregar }) => {
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ titulo: string; texto: string; ids: string[] } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  useEffect(() => { listarLotes().then(setLotes).catch(() => setLotes([])); }, [versao]);

  const lote = lotes.find(l => l.id === aberto);
  const faturas = useMemo(() => (aberto ? ctx.invoices.filter(i => i.loteId === aberto) : []), [aberto, ctx.invoices]);
  const saldo = (i: Invoice) => i.saldoAPagar ?? Math.max(0, totalFatura(i) - i.paidAmount);
  const porComando = useMemo(() => {
    const m = new Map<string, Invoice[]>();
    faturas.forEach(f => { const k = f.command || 'Sem comando'; m.set(k, [...(m.get(k) || []), f]); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [faturas]);

  const cmdDe = (texto: string) => {
    const cod = texto.match(/^\d{4,5}/)?.[0];
    const c = cod ? ctx.comandos.find(x => x.codigo === cod) : undefined;
    return { codigo: cod, nome: c?.nome ?? texto, indicativo: c?.indicativoNaval };
  };

  const marcar = async (ids: string[], campo: 'enviada_em' | 'certificada_em' | 'siafi_em', rotulo: string) => {
    setOcupado(rotulo);
    try { await marcarFaturas(ids, campo, hoje()); notify.success(`${ids.length} fatura(s) marcada(s): ${rotulo}.`); await recarregar(); }
    catch (e) { notify.fail('Erro ao marcar', e); } finally { setOcupado(null); }
  };

  const zip = async (invs: Invoice[], nome: string) => {
    setOcupado('PDF');
    try { await baixarZipFr172(invs, nome); } catch (e) { notify.fail('Erro ao gerar os PDF', e); } finally { setOcupado(null); }
  };

  if (!lotes.length) return null;
  return (
    <section className="space-y-3">
      <h3 className="font-semibold text-slate-800">Lotes emitidos</h3>
      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
        {lotes.map(l => (
          <div key={l.id}>
            <button className="w-full flex flex-wrap items-center gap-3 px-3 py-2 text-sm text-left hover:bg-slate-50" onClick={() => setAberto(aberto === l.id ? null : l.id)} aria-expanded={aberto === l.id}>
              <span className="font-semibold w-20">{referencia(l.competencia)}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-slate-100">{TIPO[l.tipo]}</span>
              <span>{l.qtd} faturas · {brl(l.total)} a pagar</span>
              <span className="text-slate-500 text-xs">emissão {br(l.dataEmissao)} · data-limite {br(l.dataLimite)}{l.criadoPor ? ` · ${l.criadoPor}` : ''}</span>
            </button>
            {aberto === l.id && lote && (
              <div className="p-3 bg-slate-50 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => zip(faturas, `faturas_${referencia(l.competencia)}_${l.tipo}`)} isLoading={ocupado === 'PDF'}><FileArchive size={14} className="mr-1" />PDF FR-172 (ZIP por comando)</Button>
                  {podeEditar && <>
                    <Button size="sm" variant="secondary" onClick={() => marcar(faturas.map(f => f.id), 'enviada_em', 'enviadas')} isLoading={ocupado === 'enviadas'}><CheckSquare size={14} className="mr-1" />Marcar todas enviadas</Button>
                    <Button size="sm" variant="secondary" onClick={() => marcar(faturas.map(f => f.id), 'siafi_em', 'registradas no SIAFI')} isLoading={ocupado === 'registradas no SIAFI'}>Registradas no SIAFI</Button>
                  </>}
                </div>
                <table className="min-w-full text-xs bg-white border border-slate-200 rounded">
                  <thead className="bg-slate-100 text-slate-600"><tr><th className="px-2 py-1 text-left">Comando</th><th className="px-2 py-1 text-right">Faturas</th><th className="px-2 py-1 text-right">A pagar</th><th className="px-2 py-1 text-left">Situação</th><th className="px-2 py-1"></th></tr></thead>
                  <tbody>
                    {porComando.map(([cmd, fs]) => {
                      const c = cmdDe(cmd);
                      const env = fs.filter(f => f.enviadaEm).length, cert = fs.filter(f => f.certificadaEm).length;
                      return (
                        <tr key={cmd} className="border-t border-slate-100">
                          <td className="px-2 py-1">{cmd}{c.indicativo ? <span className="text-slate-500"> · {c.indicativo}</span> : <span className="text-amber-700"> · sem indicativo</span>}</td>
                          <td className="px-2 py-1 text-right">{fs.length}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{brl(fs.reduce((s, f) => s + saldo(f), 0))}</td>
                          <td className="px-2 py-1">{env}/{fs.length} enviadas · {cert}/{fs.length} certificadas</td>
                          <td className="px-2 py-1 whitespace-nowrap text-right">
                            <button className="text-primary-700 underline mr-2" onClick={() => setMsg({ titulo: cmd, texto: mensagemEnvio(c, fs, lote, saldo), ids: fs.map(f => f.id) })}><Mail size={12} className="inline mr-0.5" />mensagem</button>
                            <button className="text-primary-700 underline mr-2" onClick={() => zip(fs, `faturas_${referencia(l.competencia)}_${c.codigo || 'comando'}`)}>PDF</button>
                            {podeEditar && <button className="text-slate-600 underline" onClick={() => marcar(fs.map(f => f.id), 'certificada_em', 'certificadas no SIPLAD')}>certificadas</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
      <Modal isOpen={!!msg} onClose={() => setMsg(null)} title={`Mensagem de envio — ${msg?.titulo ?? ''}`} maxWidth="max-w-3xl"
        footer={<div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(msg!.texto); notify.success('Mensagem copiada.'); }}><Copy size={14} className="mr-1" />Copiar</Button>
          {podeEditar && <Button onClick={async () => { await marcar(msg!.ids, 'enviada_em', 'enviadas'); setMsg(null); }}>Copiada e enviada — marcar faturas</Button>}
        </div>}>
        <p className="text-xs text-slate-500 mb-2">Modelo editável: ajuste ao padrão de mensagens da OM antes de enviar.</p>
        <textarea className="w-full h-80 font-mono text-xs border border-slate-300 rounded p-2" value={msg?.texto ?? ''} onChange={e => setMsg(m => (m ? { ...m, texto: e.target.value } : m))} aria-label="Texto da mensagem" />
      </Modal>
    </section>
  );
};
