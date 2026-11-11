import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, HandCoins, Plus, RefreshCw, Undo2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { veComoAdmin } from '../../types';
import { ContextoFaturamento } from '../../services/faturamentoService';
import { Fase33NaoInstaladaError, estornarMovimento, lancarAbertura, listarLivroCreditos, registrarDevolucao } from '../../services/creditosOmService';
import { MovCredito, ROTULO_MOV, creditosDaOm, estornaveisManuais, extratoDaOm, resumoCreditosOm, saldoPorOm } from '../../utils/creditosOm';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Aviso, Campo, br, brl, entrada } from './comum';

const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const num = (s: string) => { const n = Number(s.replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/**
 * Créditos da OM (livro, script 033). O crédito pertence à OM: o que sobra do acerto de um serviço abate a fatura de QUALQUER serviço
 * da mesma OM, do crédito mais antigo para o mais novo (na prévia do Lote de faturas). O livro só recebe linhas novas: erros se corrigem por estorno.
 */
export const CreditosTab: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean; usuario: string; versao: number; recarregar: () => Promise<void> }> = ({ ctx, podeEditar, versao, recarregar }) => {
  const { user } = useAuth();
  const admin = veComoAdmin(user?.role);
  const [movs, setMovs] = useState<MovCredito[]>([]);
  const [instalado, setInstalado] = useState(true);
  const [busca, setBusca] = useState('');
  const [soSaldo, setSoSaldo] = useState(true);
  const [extrato, setExtrato] = useState<string | null>(null);
  const [devolver, setDevolver] = useState<string | null>(null);
  const [abertura, setAbertura] = useState(false);
  const [form, setForm] = useState({ valor: '', data: hojeIso(), documento: '', observacao: '', omId: '', exercicio: '', servico: '' });
  const [salvando, setSalvando] = useState(false);

  const nomes = useMemo(() => new Map(ctx.omsFat.map(o => [o.id, o])), [ctx.omsFat]);
  const carregar = async () => {
    try { const r = await listarLivroCreditos(); setMovs(r.movs); setInstalado(r.instalado); }
    catch (e) { notify.fail('Erro ao carregar o livro de créditos', e); }
  };
  useEffect(() => { carregar(); }, [versao]);

  const res = resumoCreditosOm(movs);
  const saldos = useMemo(() => saldoPorOm(movs), [movs]);
  const linhas = useMemo(() => [...saldos.entries()].filter(([id, v]) => (!soSaldo || v > 0.005) && (!busca.trim() || `${nomes.get(id)?.nome || ''} ${nomes.get(id)?.codigo || ''}`.toLowerCase().includes(busca.trim().toLowerCase())))
    .map(([id, v]) => ({ id, saldo: v, om: nomes.get(id), abertos: creditosDaOm(movs, id) })).sort((a, b) => b.saldo - a.saldo), [saldos, soSaldo, busca, nomes, movs]);

  const abrirDevolucao = (omId: string) => { setDevolver(omId); setForm({ ...form, valor: String(saldos.get(omId) || 0).replace('.', ','), data: hojeIso(), documento: '', observacao: '' }); };
  const valor = num(form.valor);
  const erroDev = !devolver ? '' : valor <= 0 ? 'Informe o valor.' : valor > (saldos.get(devolver) || 0) + 0.005 ? `O valor passa do saldo da OM (${brl(saldos.get(devolver) || 0)}).` : !form.documento.trim() ? 'Informe o nº da ALTCRED/GRU da devolução.' : '';
  const erroAb = !abertura ? '' : !form.omId ? 'Escolha a OM.' : valor <= 0 ? 'Informe o valor.' : !form.documento.trim() ? 'Informe o documento de origem (ALTCRED/GRU ou planilha do acerto).' : !form.observacao.trim() ? 'Explique de onde vem este saldo.' : '';

  const gravarDevolucao = async () => {
    if (!devolver || erroDev) return;
    setSalvando(true);
    try { await registrarDevolucao(devolver, valor, form.data, form.documento, form.observacao); notify.success('Devolução registrada.'); setDevolver(null); await carregar(); await recarregar(); }
    catch (e) { notify.fail('Erro ao registrar a devolução', e); } finally { setSalvando(false); }
  };
  const gravarAbertura = async () => {
    if (!abertura || erroAb) return;
    setSalvando(true);
    try {
      await lancarAbertura({ omId: form.omId, valor, data: form.data, exercicio: form.exercicio ? Number(form.exercicio) : null, servico: form.servico || null, documento: form.documento, observacao: form.observacao });
      notify.success('Saldo de abertura lançado.'); setAbertura(false); await carregar(); await recarregar();
    } catch (e) { notify.fail('Erro ao lançar o saldo de abertura', e); } finally { setSalvando(false); }
  };
  const estornar = async (m: MovCredito) => {
    const motivo = window.prompt(`Estornar ${ROTULO_MOV[m.tipo].toLowerCase()} de ${brl(Math.abs(m.valor))}? Informe o motivo:`);
    if (!motivo?.trim()) return;
    try { await estornarMovimento(m, hojeIso(), motivo); notify.success('Movimento estornado.'); await carregar(); await recarregar(); } catch (e) { notify.fail('Erro ao estornar', e); }
  };

  const linhasExtrato = extrato ? extratoDaOm(movs, extrato) : [];
  const podeEstornar = new Set(extrato ? estornaveisManuais(movs, extrato).map(m => m.id) : []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-600 max-w-3xl">
          O <b>crédito é da OM</b>, não do serviço: o que sobra do acerto do OND (real menor que o estimado) abate a fatura de <b>qualquer serviço da mesma OM</b>, do crédito mais antigo para o mais novo, sozinho, na prévia do Lote de faturas (linha 04 da fatura).
          Nada se apaga: cada entrada e saída fica no extrato da OM; erros se corrigem por estorno.
        </p>
        <div className="flex gap-2">
          {admin && instalado && <Button size="sm" variant="secondary" onClick={() => { setAbertura(true); setForm({ valor: '', data: hojeIso(), documento: '', observacao: '', omId: '', exercicio: '', servico: '' }); }}><Plus size={14} className="mr-1" />Lançar saldo de abertura</Button>}
          <Button size="sm" variant="ghost" onClick={async () => { await recarregar(); await carregar(); }}><RefreshCw size={14} className="mr-1" />Atualizar</Button>
        </div>
      </div>
      {!instalado && <Aviso tom="red"><b>Falta executar o script 033</b> (<code>supabase/migrations/033_creditos_om.sql</code>) no Supabase para controlar os créditos das OM. Enquanto isso, nenhum crédito é compensado.</Aviso>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Créditos lançados (acertos e abertura)', res.entradas, ''], ['Já usado nas faturas', res.utilizado, ''], ['Já devolvido', res.devolvido, ''], [`Saldo a favor das OM (${res.oms} OM)`, res.saldo, 'font-bold text-emerald-700']].map(([t, v, c]) => (
          <div key={String(t)} className="p-3 rounded-xl border border-slate-200 bg-white"><div className="text-xs text-slate-500">{t}</div><div className={`text-lg tabular-nums ${c}`}>{brl(Number(v))}</div></div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Buscar OM"><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} placeholder="nome ou UG" aria-label="Buscar crédito" /></Campo>
        <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={soSaldo} onChange={e => setSoSaldo(e.target.checked)} /> Só com saldo</label>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-sm" data-testid="saldos-om">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
            <th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-left">Créditos em aberto (do mais antigo ao mais novo)</th><th className="px-2 py-2 text-right">Saldo</th><th className="px-2 py-2"></th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {linhas.map(l => (
              <tr key={l.id}>
                <td className="px-2 py-1.5 max-w-[280px]"><div className="truncate" title={l.om?.nome}>{l.om?.nome || l.id}</div><div className="text-[11px] text-slate-500">UG {l.om?.codigo}</div></td>
                <td className="px-2 py-1.5 text-xs text-slate-600">{l.abertos.length ? l.abertos.map(a => <div key={a.id}>{a.numero}{a.servico ? ` (${a.servico}${a.exercicio ? `/${a.exercicio}` : ''})` : ''}: <b>{brl(a.saldo)}</b> <span className="text-slate-400">de {brl(a.valor)}</span></div>) : '—'}</td>
                <td className={`px-2 py-1.5 whitespace-nowrap text-right tabular-nums font-semibold ${l.saldo > 0.005 ? 'text-emerald-700' : 'text-slate-400'}`}>{brl(l.saldo)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap space-x-1">
                  <Button size="sm" variant="ghost" aria-label={`Extrato de ${l.om?.nome}`} onClick={() => setExtrato(l.id)}>{extrato === l.id ? <ChevronDown size={13} className="mr-1" /> : <ChevronRight size={13} className="mr-1" />}Extrato</Button>
                  {podeEditar && l.saldo > 0.005 && instalado && <Button size="sm" variant="secondary" aria-label={`Devolver crédito de ${l.om?.nome}`} onClick={() => abrirDevolucao(l.id)}><HandCoins size={13} className="mr-1" />Registrar devolução</Button>}
                </td>
              </tr>
            ))}
            {!linhas.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">{movs.length ? 'Nenhuma OM com esse filtro.' : 'Nenhum crédito ainda. Ele surge quando uma fatura de acerto do OND fica com o consumo real abaixo do estimado, ou por saldo de abertura lançado pelo administrador.'}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal isOpen={!!extrato} onClose={() => setExtrato(null)} title={`Extrato de créditos — ${extrato ? nomes.get(extrato)?.nome || '' : ''}`} maxWidth="max-w-4xl">
        <div className="overflow-x-auto" data-testid="extrato-creditos">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 uppercase text-slate-500"><tr><th className="px-2 py-1.5 text-left">Data</th><th className="px-2 py-1.5 text-left">Movimento</th><th className="px-2 py-1.5 text-left">Origem / destino</th><th className="px-2 py-1.5 text-right">Valor</th><th className="px-2 py-1.5 text-right">Saldo</th><th className="px-2 py-1.5 text-left">Por</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {linhasExtrato.map(m => (
                <tr key={m.id}>
                  <td className="px-2 py-1 whitespace-nowrap">{br(m.data)}</td>
                  <td className="px-2 py-1">{ROTULO_MOV[m.tipo]}{m.servicoOrigem ? ` · ${m.servicoOrigem}` : ''}{m.exercicioOrigem ? `/${m.exercicioOrigem}` : ''}</td>
                  <td className="px-2 py-1 font-mono">{m.tipo === 'ENTRADA_ACERTO' ? m.origemNumero : m.tipo === 'UTILIZACAO' || (m.tipo === 'ESTORNO' && m.destinoNumero) ? m.destinoNumero : m.documento || ''}{m.observacao ? <span className="font-sans text-slate-500"> · {m.observacao}</span> : null}</td>
                  <td className={`px-2 py-1 text-right tabular-nums ${m.valor < 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{brl(m.valor)}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-semibold">{brl(m.saldoApos)}</td>
                  <td className="px-2 py-1 text-slate-500">{m.criadoPorNome || ''}</td>
                  <td className="px-2 py-1 text-right">{admin && podeEstornar.has(m.id) && <button className="text-primary-700 underline inline-flex items-center gap-0.5" onClick={() => estornar(m)}><Undo2 size={11} />estornar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal isOpen={!!devolver} onClose={() => setDevolver(null)} title="Registrar devolução do crédito" maxWidth="max-w-lg"
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDevolver(null)}>Cancelar</Button><Button onClick={gravarDevolucao} isLoading={salvando} disabled={!!erroDev}>Registrar</Button></div>}>
        {devolver && (
          <div className="space-y-3 text-sm">
            <p><b>{nomes.get(devolver)?.nome}</b><br />Saldo de crédito: <b>{brl(saldos.get(devolver) || 0)}</b>. A devolução sai do crédito mais antigo.</p>
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="Valor (R$)"><input className={entrada} value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} aria-label="Valor do uso" /></Campo>
              <Campo rotulo="Data"><input className={entrada} type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} aria-label="Data do uso" /></Campo>
            </div>
            <Campo rotulo="Nº da ALTCRED / GRU"><input className={entrada} value={form.documento} onChange={e => setForm({ ...form, documento: e.target.value })} aria-label="Documento do uso" /></Campo>
            <Campo rotulo="Observação (opcional)"><input className={entrada} value={form.observacao} onChange={e => setForm({ ...form, observacao: e.target.value })} /></Campo>
            {erroDev && <p className="text-xs text-red-700">{erroDev}</p>}
          </div>
        )}
      </Modal>

      <Modal isOpen={abertura} onClose={() => setAbertura(false)} title="Lançar saldo de abertura" maxWidth="max-w-lg"
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAbertura(false)}>Cancelar</Button><Button onClick={gravarAbertura} isLoading={salvando} disabled={!!erroAb}>Lançar</Button></div>}>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-slate-600">Use para o crédito que a OM já tinha de acertos <b>anteriores ao SISCONT</b> e ainda não usou. Só o administrador lança; um erro se corrige por estorno no extrato.</p>
          <Campo rotulo="OM"><select className={`${entrada} w-full`} value={form.omId} onChange={e => setForm({ ...form, omId: e.target.value })} aria-label="OM do saldo de abertura"><option value="">Selecione...</option>{[...ctx.omsFat].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).map(o => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}</select></Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Valor (R$)"><input className={entrada} value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} aria-label="Valor do saldo de abertura" /></Campo>
            <Campo rotulo="Data do crédito"><input className={entrada} type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} aria-label="Data do saldo de abertura" /></Campo>
            <Campo rotulo="Exercício de origem (opcional)"><input className={entrada} inputMode="numeric" maxLength={4} value={form.exercicio} onChange={e => setForm({ ...form, exercicio: e.target.value.replace(/\D/g, '') })} aria-label="Exercício de origem" /></Campo>
            <Campo rotulo="Serviço de origem (opcional)"><input className={entrada} maxLength={2} value={form.servico} onChange={e => setForm({ ...form, servico: e.target.value.toUpperCase() })} aria-label="Serviço de origem" /></Campo>
          </div>
          <Campo rotulo="Documento de origem"><input className={entrada} value={form.documento} onChange={e => setForm({ ...form, documento: e.target.value })} aria-label="Documento de origem" placeholder="ALTCRED/GRU ou fatura de acerto da planilha" /></Campo>
          <Campo rotulo="De onde vem este saldo"><input className={entrada} value={form.observacao} onChange={e => setForm({ ...form, observacao: e.target.value })} aria-label="Origem do saldo de abertura" /></Campo>
          {erroAb && <p className="text-xs text-red-700">{erroAb}</p>}
        </div>
      </Modal>
    </div>
  );
};
