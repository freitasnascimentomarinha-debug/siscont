import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, HandCoins, RefreshCw, Undo2 } from 'lucide-react';
import { ContextoFaturamento, Fase28NaoInstaladaError, excluirUsoCredito, listarUsosCredito, registrarUsoCredito } from '../../services/faturamentoService';
import { CreditoAcerto, TipoUsoCredito, UsoCredito, calcularCreditos, resumoCreditos } from '../../utils/creditosAcerto';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Aviso, Campo, br, brl, entrada } from './comum';

const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/**
 * Controle dos créditos que as OM têm depois do acerto do OND: a fatura de acerto traz o consumo real e abate o estimado já
 * faturado; quando o real é menor, a diferença é crédito da OM. Aqui se vê quanto cada OM tem, o que já foi compensado nas
 * faturas seguintes (automático, no Lote de faturas) ou devolvido (ALTCRED/GRU).
 */
export const CreditosTab: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean; usuario: string; versao: number; recarregar: () => Promise<void> }> = ({ ctx, podeEditar, usuario, versao, recarregar }) => {
  const [usos, setUsos] = useState<UsoCredito[]>([]);
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [busca, setBusca] = useState('');
  const [soSaldo, setSoSaldo] = useState(true);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [registrar, setRegistrar] = useState<CreditoAcerto | null>(null);
  const [form, setForm] = useState({ tipo: 'DEVOLUCAO' as TipoUsoCredito, valor: '', data: hojeIso(), documento: '', observacao: '' });
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try { setUsos(await listarUsosCredito()); setNaoInstalado(false); }
    catch (e) { if (e instanceof Fase28NaoInstaladaError) { setNaoInstalado(true); setUsos([]); } else notify.fail('Erro ao carregar os usos dos créditos', e); }
  };
  useEffect(() => { carregar(); }, [versao]);

  const creditos = useMemo(() => calcularCreditos(ctx.invoices, usos), [ctx.invoices, usos]);
  const res = resumoCreditos(creditos);
  const lista = creditos.filter(c => (!soSaldo || c.saldo > 0.005) && (!busca.trim() || `${c.cliente} ${c.numero} ${c.original} ${c.servico}`.toLowerCase().includes(busca.trim().toLowerCase())));
  const porOM = useMemo(() => {
    const m = new Map<string, number>();
    creditos.forEach(c => m.set(c.cliente, Math.round(((m.get(c.cliente) || 0) + c.saldo) * 100) / 100));
    return [...m.entries()].filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  }, [creditos]);

  const abrirRegistro = (c: CreditoAcerto) => { setRegistrar(c); setForm({ tipo: 'DEVOLUCAO', valor: String(c.saldo).replace('.', ','), data: hojeIso(), documento: '', observacao: '' }); };
  const valor = num(form.valor);
  const erroForm = !registrar ? '' : valor <= 0 ? 'Informe o valor.' : valor > registrar.saldo + 0.005 ? `O valor passa do saldo do crédito (${brl(registrar.saldo)}).` : !form.documento.trim() ? (form.tipo === 'DEVOLUCAO' ? 'Informe o nº da ALTCRED/GRU da devolução.' : 'Informe o nº da fatura em que foi compensado.') : '';
  const gravar = async () => {
    if (!registrar || erroForm) return;
    setSalvando(true);
    try {
      await registrarUsoCredito({
        chave: registrar.chave, tipo: form.tipo, valor, data: form.data, criadoPor: usuario, observacao: form.observacao,
        ...(form.tipo === 'DEVOLUCAO' ? { documento: form.documento } : { faturaNumero: form.documento.trim() }),
      });
      notify.success(form.tipo === 'DEVOLUCAO' ? 'Devolução registrada.' : 'Compensação registrada.');
      setRegistrar(null); await carregar(); await recarregar();
    } catch (e) { notify.fail('Erro ao registrar', e); } finally { setSalvando(false); }
  };
  const desfazer = async (u: UsoCredito) => {
    if (!u.id || !window.confirm(`Desfazer este registro (${u.tipo === 'DEVOLUCAO' ? 'devolução' : 'compensação'} de ${brl(u.valor)})? O valor volta para o saldo do crédito.`)) return;
    try { await excluirUsoCredito(u.id); notify.success('Registro desfeito.'); await carregar(); } catch (e) { notify.fail('Erro ao desfazer', e); }
  };
  const alternar = (k: string) => setAbertos(p => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-600 max-w-3xl">
          Depois do OND, a <b>fatura de acerto</b> traz o <b>consumo real</b> e abate o valor estimado que já foi faturado. Se o real foi menor (ex.: estimado R$ 100.000, real R$ 80.000),
          a diferença (R$ 20.000) é <b>crédito que a OM tem</b>. Ele aparece aqui, <b>é abatido sozinho nas próximas faturas da mesma OM e do mesmo serviço</b> (na prévia do Lote de faturas) ou pode ser registrado como devolvido (ALTCRED/GRU).
        </p>
        <Button size="sm" variant="ghost" onClick={async () => { await recarregar(); await carregar(); }}><RefreshCw size={14} className="mr-1" />Atualizar</Button>
      </div>
      {naoInstalado && <Aviso tom="red"><b>Falta executar o script 028</b> (<code>supabase/migrations/028_creditos_acerto.sql</code>) no Supabase para registrar compensações e devoluções. Enquanto isso, o crédito aparece inteiro, sem abatimento.</Aviso>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Crédito gerado nos acertos', res.total, ''], ['Já compensado nas faturas', res.compensado, ''], ['Já devolvido', res.devolvido, ''], ['Saldo a favor das OM', res.saldo, 'font-bold text-emerald-700']].map(([t, v, c]) => (
          <div key={String(t)} className="p-3 rounded-xl border border-slate-200 bg-white"><div className="text-xs text-slate-500">{t}</div><div className={`text-lg tabular-nums ${c}`}>{brl(Number(v))}</div></div>
        ))}
      </div>
      {porOM.length > 0 && <div className="text-xs text-slate-600"><b>Saldo por OM:</b> {porOM.map(([n, v]) => `${n}: ${brl(v)}`).join(' · ')}</div>}

      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Buscar OM ou fatura"><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} placeholder="nome, nº da fatura ou serviço" aria-label="Buscar crédito" /></Campo>
        <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={soSaldo} onChange={e => setSoSaldo(e.target.checked)} /> Só com saldo</label>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
            <th className="px-2 py-2"></th><th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-left">Fatura de acerto (e a estimada)</th>
            <th className="px-2 py-2 text-right">Crédito</th><th className="px-2 py-2 text-right">Compensado</th><th className="px-2 py-2 text-right">Devolvido</th><th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map(c => (
              <React.Fragment key={c.chave}>
                <tr>
                  <td className="px-2 py-1.5"><button className="text-slate-400" onClick={() => alternar(c.chave)} aria-label="Ver usos">{abertos.has(c.chave) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                  <td className="px-2 py-1.5 max-w-[260px]"><div className="truncate" title={c.cliente}>{c.cliente}</div><div className="text-[11px] text-slate-500">{c.servico} · emitida em {br(c.emissao)}</div></td>
                  <td className="px-2 py-1.5 font-mono text-xs whitespace-nowrap">{c.numero}<div className="text-[10px] text-slate-500">estimada: {c.original}</div></td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-right tabular-nums">{brl(c.valor)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-right tabular-nums text-orange-700">{c.compensado ? brl(c.compensado) : '-'}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap text-right tabular-nums text-sky-700">{c.devolvido ? brl(c.devolvido) : '-'}</td>
                  <td className={`px-2 py-1.5 whitespace-nowrap text-right tabular-nums font-semibold ${c.saldo > 0.005 ? 'text-emerald-700' : 'text-slate-400'}`}>{brl(c.saldo)}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">{podeEditar && c.saldo > 0.005 && !naoInstalado && <Button size="sm" variant="secondary" onClick={() => abrirRegistro(c)}><HandCoins size={13} className="mr-1" />Registrar uso</Button>}</td>
                </tr>
                {abertos.has(c.chave) && (
                  <tr className="bg-slate-50 text-xs text-slate-600"><td></td><td colSpan={7} className="px-2 py-2 space-y-1">
                    {c.usos.length === 0 && <div>Nenhum uso registrado ainda. O crédito é abatido automaticamente no próximo lote mensal (mesma OM e mesmo serviço).</div>}
                    {c.usos.map(u => (
                      <div key={u.id} className="flex flex-wrap items-center gap-2">
                        <span>{br(u.data)} · <b>{u.tipo === 'DEVOLUCAO' ? 'Devolução' : 'Compensação'}</b> de {brl(u.valor)}
                          {u.tipo === 'DEVOLUCAO' ? (u.documento ? ` · ${u.documento}` : '') : (u.faturaNumero ? ` · fatura ${u.faturaNumero}` : '')}
                          {u.observacao ? ` · ${u.observacao}` : ''}{u.criadoPor ? ` · por ${u.criadoPor}` : ''}</span>
                        {podeEditar && u.id && <button className="text-primary-700 underline inline-flex items-center gap-0.5" onClick={() => desfazer(u)}><Undo2 size={11} />desfazer</button>}
                      </div>
                    ))}
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {!lista.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">{creditos.length ? 'Nenhum crédito com esse filtro.' : 'Nenhum crédito de acerto ainda. Ele surge quando uma fatura de acerto do OND fica com o consumo real abaixo do estimado.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!registrar} onClose={() => setRegistrar(null)} title="Registrar uso do crédito" maxWidth="max-w-lg"
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRegistrar(null)}>Cancelar</Button><Button onClick={gravar} isLoading={salvando} disabled={!!erroForm}>Registrar</Button></div>}>
        {registrar && (
          <div className="space-y-3 text-sm">
            <p><b>{registrar.cliente}</b> · {registrar.servico} · acerto {registrar.numero}<br />Saldo do crédito: <b>{brl(registrar.saldo)}</b></p>
            <fieldset className="flex flex-col gap-1">
              <label className="flex items-center gap-2"><input type="radio" name="tipo-uso" checked={form.tipo === 'DEVOLUCAO'} onChange={() => setForm({ ...form, tipo: 'DEVOLUCAO' })} />Devolvido à OM (ALTCRED/GRU)</label>
              <label className="flex items-center gap-2"><input type="radio" name="tipo-uso" checked={form.tipo === 'COMPENSACAO'} onChange={() => setForm({ ...form, tipo: 'COMPENSACAO' })} />Compensado numa fatura que não foi emitida pelo lote</label>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Valor (R$)"><input className={entrada} value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} aria-label="Valor do uso" /></Campo>
              <Campo rotulo="Data"><input className={entrada} type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} aria-label="Data do uso" /></Campo>
            </div>
            <Campo rotulo={form.tipo === 'DEVOLUCAO' ? 'Nº da ALTCRED / GRU' : 'Nº da fatura em que foi compensado'}><input className={entrada} value={form.documento} onChange={e => setForm({ ...form, documento: e.target.value })} aria-label="Documento do uso" /></Campo>
            <Campo rotulo="Observação (opcional)"><input className={entrada} value={form.observacao} onChange={e => setForm({ ...form, observacao: e.target.value })} /></Campo>
            {erroForm && <p className="text-xs text-red-700">{erroForm}</p>}
          </div>
        )}
      </Modal>
    </div>
  );
};
