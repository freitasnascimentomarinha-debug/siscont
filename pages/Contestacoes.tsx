import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Invoice, ServicoCatalogo, podeEditarDados } from '../types';
import { db } from '../services/db';
import { cadastroService } from '../services/cadastroService';
import { Fase4NaoInstaladaError, anotar, decidir, encaminhar, listarContestacoes, responder } from '../services/fase4Service';
import { Contestacao, Decisao, situacaoContestacao } from '../utils/fase4';
import { somarDiasUteis } from '../utils/diasUteis';
import { lerFatura } from '../utils/cadastroImport';
import { AcaoFatura, AcoesFaturaModais } from '../components/fase4/AcoesFaturaModais';
import { notify } from '../utils/notify';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';

const br = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const entrada = 'w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500';
const hoje = () => new Date().toISOString().slice(0, 10);
const STATUS: Record<string, string> = { ABERTA: 'bg-red-100 text-red-800', ENCAMINHADA: 'bg-amber-100 text-amber-800', RESPONDIDA: 'bg-sky-100 text-sky-800', ENCERRADA: 'bg-slate-100 text-slate-600' };
const DECISAO: Record<string, string> = { RATIFICADA: 'Ratificada (mantida)', RETIFICADA: 'Retificada (nova versão)', CANCELADA: 'Cancelada' };

export const Contestacoes: React.FC = () => {
  const { user } = useAuth();
  const usuario = user?.name || user?.email || '';
  const podeEditar = podeEditarDados(user?.role);
  const [lista, setLista] = useState<Contestacao[]>([]);
  const [faturas, setFaturas] = useState<Invoice[]>([]);
  const [servicos, setServicos] = useState<ServicoCatalogo[]>([]);
  const [feriados, setFeriados] = useState<string[]>([]);
  const [prazoDias, setPrazoDias] = useState(10);
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<'abertas' | 'paradas' | 'todas'>('abertas');
  const [sel, setSel] = useState<Contestacao | null>(null);
  const [acaoFatura, setAcaoFatura] = useState<AcaoFatura>(null);
  const [aguardaDecisao, setAguardaDecisao] = useState<{ c: Contestacao; decisao: Decisao } | null>(null);

  const carregar = async () => {
    setCarregando(true);
    try {
      const [c, f, s, fer, par] = await Promise.all([listarContestacoes(), db.getInvoices(), cadastroService.listServicos().catch(() => []), cadastroService.listFeriados().catch(() => []), cadastroService.listParametros().catch(() => [])]);
      setLista(c); setFaturas(f); setServicos(s); setFeriados(fer.map(x => x.data));
      setPrazoDias(Number(par.find(p => p.chave === 'prazo_contestacao_dias_uteis')?.valor) || 10);
      setNaoInstalado(false);
      return { c, f };
    } catch (e) {
      if (e instanceof Fase4NaoInstaladaError) setNaoInstalado(true); else notify.fail('Erro ao carregar contestações', e);
      return null;
    } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  // depois de retificar/cancelar a fatura pela contestação, registra a decisão
  const aposAcao = async () => {
    const r = await carregar();
    if (!aguardaDecisao || !r) return;
    const inv = r.f.find(i => i.id === aguardaDecisao.c.invoiceId);
    const feito = aguardaDecisao.decisao === 'RETIFICADA' ? inv?.substituidaPor : inv?.isCanceled;
    if (feito) {
      await decidir(aguardaDecisao.c, aguardaDecisao.decisao, usuario, inv?.cancelamentoMotivo || '', aguardaDecisao.decisao === 'RETIFICADA' ? inv?.substituidaPor ?? undefined : undefined);
      notify.success(`Contestação encerrada: ${DECISAO[aguardaDecisao.decisao]}.`);
      setSel(null);
      await carregar();
    }
    setAguardaDecisao(null);
  };

  const fat = useMemo(() => new Map(faturas.map(f => [f.id, f])), [faturas]);
  const h = hoje();
  const linhas = lista.map(c => ({ c, s: situacaoContestacao(c, h), f: fat.get(c.invoiceId) }))
    .filter(x => filtro === 'todas' || (filtro === 'abertas' ? x.s.aberta : x.s.aberta && (x.s.prazoVencido || x.s.diasParada > 30)))
    .sort((a, b) => Number(b.s.aberta) - Number(a.s.aberta) || Number(b.s.prazoVencido) - Number(a.s.prazoVencido) || b.s.diasParada - a.s.diasParada);
  const abertas = lista.filter(c => c.status !== 'ENCERRADA');
  const valorContestado = abertas.reduce((s, c) => s + (fat.get(c.invoiceId)?.saldoAPagar ?? 0), 0);
  const vencidas = abertas.filter(c => situacaoContestacao(c, h).prazoVencido).length;
  const paradas30 = abertas.filter(c => situacaoContestacao(c, h).diasParada > 30).length;
  const setorDe = (numero: string) => { const sg = lerFatura(numero)?.sigla; const sv = servicos.find(s => s.acronym.toUpperCase() === sg); return [sv?.setorResponsavel, sv?.telefoneSetor].filter(Boolean).join(' — ') || ''; };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Contestações</h2>
          <p className="text-slate-500 text-sm max-w-3xl">Fluxo: a OM contesta → encaminhamento ao setor medidor com prazo → resposta → decisão: <b>ratificar</b> (mantém), <b>retificar</b> (nova versão "-1" que cancela e substitui) ou <b>cancelar</b>. Tudo fica no histórico.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
      </div>
      {naoInstalado && <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm" role="alert">Execute o script <code>supabase/migrations/008_contestacao_fase4.sql</code> no Supabase e clique em Atualizar.</div>}
      {!naoInstalado && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['Em andamento', String(abertas.length), ''], ['Valor contestado em aberto', brl(valorContestado), ''], ['Prazo do setor vencido', String(vencidas), vencidas ? 'text-red-700' : ''], ['Paradas há mais de 30 dias', String(paradas30), paradas30 ? 'text-amber-700' : '']].map(([r, v, c]) => (
              <div key={r} className="p-3 rounded-lg border border-slate-200 bg-white"><div className="text-[11px] uppercase font-semibold text-slate-500">{r}</div><div className={`text-xl font-bold tabular-nums ${c}`}>{v}</div></div>
            ))}
          </div>
          <div className="flex gap-2 text-sm">
            {([['abertas', 'Em andamento'], ['paradas', 'Paradas / prazo vencido'], ['todas', 'Todas']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`px-3 py-1.5 rounded-md border ${filtro === k ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-slate-300 text-slate-600'}`}>{l}</button>
            ))}
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Fatura', 'OM', 'Aberta em', 'Situação', 'Parada há', 'Próximo passo', ''].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {linhas.map(({ c, s, f }) => (
                  <tr key={c.id} className={s.prazoVencido ? 'bg-red-50/60' : ''}>
                    <td className="px-3 py-2 font-mono text-xs">{c.numeroFatura}<div className="font-sans text-[11px] text-slate-500">{f ? brl(f.value + (f.adjustmentAddition || 0) - (f.adjustmentDeduction || 0)) : ''}</div></td>
                    <td className="px-3 py-2 max-w-[220px] truncate" title={f?.client}>{f?.client || '—'}</td>
                    <td className="px-3 py-2 text-xs">{br(c.abertaEm)}<div className="text-slate-500">{c.origem}</div></td>
                    <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[c.status]}`}>{c.status}</span>{c.decisao && <div className="text-[11px] text-slate-500 mt-0.5">{DECISAO[c.decisao]}</div>}{c.prazo && s.aberta && <div className={`text-[11px] ${s.prazoVencido ? 'text-red-700 font-semibold' : 'text-slate-500'}`}>prazo {br(c.prazo)}</div>}</td>
                    <td className="px-3 py-2 text-xs">{s.aberta ? <span className={s.diasParada > 30 ? 'text-amber-700 font-semibold' : ''}><Clock size={12} className="inline mr-1" />{s.diasParada} dias</span> : `${s.diasAberta} dias até decidir`}</td>
                    <td className="px-3 py-2 text-xs">{s.proximoPasso}</td>
                    <td className="px-3 py-2 text-right"><button className="text-primary-700 underline text-xs" onClick={() => setSel(c)}>abrir</button></td>
                  </tr>
                ))}
                {!linhas.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">Nenhuma contestação {filtro === 'todas' ? '' : 'neste filtro'}. Para abrir, use o botão de contestação na lista de Faturas.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
      {sel && <DetalheContestacao c={sel} f={fat.get(sel.invoiceId)} setorSugerido={setorDe(sel.numeroFatura)} prazoSugerido={somarDiasUteis(h, prazoDias, feriados)} podeEditar={podeEditar} usuario={usuario}
        onClose={() => setSel(null)}
        onAtualizar={async () => { const r = await carregar(); setSel(s => (s && r ? r.c.find(x => x.id === s.id) ?? null : s)); }}
        onDecidirComAcao={(decisao) => { const inv = fat.get(sel.invoiceId); if (!inv) return; setAguardaDecisao({ c: sel, decisao }); setAcaoFatura({ tipo: decisao === 'RETIFICADA' ? 'substituir' : 'cancelar', fatura: inv }); }} />}
      <AcoesFaturaModais acao={acaoFatura} onClose={() => { setAcaoFatura(null); setAguardaDecisao(null); }} onFeito={aposAcao} usuario={usuario}
        numeros={faturas.map(i => i.invoiceNumber)} baixado={id => { const f = fat.get(id); return f ? f.paidAmount + (f.adiantamentoUsado || 0) : 0; }} />
    </div>
  );
};

const DetalheContestacao: React.FC<{
  c: Contestacao; f?: Invoice; setorSugerido: string; prazoSugerido: string; podeEditar: boolean; usuario: string;
  onClose: () => void; onAtualizar: () => Promise<void>; onDecidirComAcao: (d: Decisao) => void;
}> = ({ c, f, setorSugerido, prazoSugerido, podeEditar, usuario, onClose, onAtualizar, onDecidirComAcao }) => {
  const [setor, setSetor] = useState(c.setorMedidor || setorSugerido);
  const [prazo, setPrazo] = useState(c.prazo || prazoSugerido);
  const [resposta, setResposta] = useState('');
  const [dataResp, setDataResp] = useState(hoje());
  const [nota, setNota] = useState('');
  const [anexo, setAnexo] = useState('');
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const fazer = async (fn: () => Promise<void>, ok: string) => {
    setOcupado(true);
    try { await fn(); notify.success(ok); await onAtualizar(); setNota(''); setAnexo(''); setResposta(''); } catch (e) { notify.fail('Não foi possível gravar', e); } finally { setOcupado(false); }
  };
  const aberta = c.status !== 'ENCERRADA';
  return (
    <Modal isOpen onClose={onClose} title={`Contestação — ${c.numeroFatura}`} maxWidth="max-w-3xl">
      <div className="space-y-4 text-sm">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="p-3 rounded bg-slate-50 border border-slate-200">
            <div className="text-[11px] uppercase text-slate-500 font-semibold">Fatura</div>
            <div>{f?.client} · {f?.type} · {f?.competence}</div>
            <div>Total {f ? brl(f.value + (f.adjustmentAddition || 0) - (f.adjustmentDeduction || 0)) : '—'} · a pagar {brl(f?.saldoAPagar ?? 0)}</div>
            {f?.substituidaPor && <div className="text-slate-600">Substituída por {f.substituidaPor}</div>}
          </div>
          <div className="p-3 rounded bg-amber-50 border border-amber-200">
            <div className="text-[11px] uppercase text-amber-700 font-semibold">Justificativa da OM ({c.origem}, {br(c.abertaEm)})</div>
            <div>{c.justificativa}</div>
            {c.anexos.length > 0 && <div className="text-xs mt-1 text-slate-600">Documentos: {c.anexos.map(a => a.nome + (a.referencia ? ` (${a.referencia})` : '')).join('; ')}</div>}
          </div>
        </div>

        {podeEditar && aberta && (
          <div className="p-3 rounded-lg border border-primary-200 bg-primary-50/40 space-y-3">
            {(c.status === 'ABERTA' || c.status === 'ENCAMINHADA') && (
              <div className="grid md:grid-cols-[1fr_160px_auto] gap-2 items-end">
                <label className="text-slate-700">Setor medidor<input className={entrada} value={setor} onChange={e => setSetor(e.target.value)} placeholder="Ex.: Divisão de Eletricidade (BNIC-34)" /></label>
                <label className="text-slate-700">Prazo da resposta<input type="date" className={entrada} value={prazo} onChange={e => setPrazo(e.target.value)} /></label>
                <Button onClick={() => fazer(() => encaminhar(c, setor, prazo, usuario), 'Encaminhada ao setor.')} isLoading={ocupado} disabled={!setor.trim() || !prazo}>{c.status === 'ENCAMINHADA' ? 'Reencaminhar' : 'Encaminhar'}</Button>
              </div>
            )}
            {c.status === 'ENCAMINHADA' && (
              <div className="grid md:grid-cols-[1fr_160px_auto] gap-2 items-end">
                <label className="text-slate-700">Resposta do setor<textarea className={entrada} rows={2} value={resposta} onChange={e => setResposta(e.target.value)} placeholder="Ex.: leitura conferida; navio esteve docado de 03 a 20/04" /></label>
                <label className="text-slate-700">Recebida em<input type="date" className={entrada} value={dataResp} onChange={e => setDataResp(e.target.value)} /></label>
                <Button onClick={() => fazer(() => responder(c, resposta, dataResp, usuario), 'Resposta registrada.')} isLoading={ocupado} disabled={!resposta.trim()}>Registrar</Button>
              </div>
            )}
            {(c.status === 'RESPONDIDA' || c.status === 'ENCAMINHADA' || c.status === 'ABERTA') && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-600">Decisão</div>
                <div className="flex flex-wrap gap-2 items-center">
                  <input className={`${entrada} md:w-80`} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Fundamento (para ratificar)" aria-label="Fundamento da decisão" />
                  <Button variant="secondary" disabled={!texto.trim() || ocupado} onClick={() => fazer(() => decidir(c, 'RATIFICADA', usuario, texto), 'Contestação encerrada: fatura ratificada.')}>Ratificar (mantém)</Button>
                  <Button variant="secondary" disabled={!f || ocupado} onClick={() => onDecidirComAcao('RETIFICADA')}>Retificar (nova versão)</Button>
                  <Button variant="danger" disabled={!f || ocupado} onClick={() => onDecidirComAcao('CANCELADA')}>Cancelar fatura</Button>
                </div>
              </div>
            )}
            <div className="grid md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="text-slate-700">Nota<input className={entrada} value={nota} onChange={e => setNota(e.target.value)} placeholder="Ex.: cobrada a resposta por telefone" /></label>
              <label className="text-slate-700">Documento (referência)<input className={entrada} value={anexo} onChange={e => setAnexo(e.target.value)} placeholder="Ex.: OMS nº 02126; e-mail de 21/09" /></label>
              <Button variant="ghost" disabled={(!nota.trim() && !anexo.trim()) || ocupado} onClick={() => fazer(() => anotar(c, nota, usuario, anexo.trim() ? { nome: anexo.trim() } : undefined), 'Registrado no histórico.')}>Registrar</Button>
            </div>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">Histórico</div>
          <ol className="border-l-2 border-slate-200 pl-4 space-y-2">
            {c.historico.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[22px] top-1 w-3 h-3 rounded-full bg-primary-500 border-2 border-white" />
                <div className="text-xs text-slate-500">{br(e.em)} · {e.por || '—'} · <b>{e.acao}</b></div>
                {e.texto && <div>{e.texto}</div>}
              </li>
            ))}
          </ol>
        </div>
        {c.status === 'ENCAMINHADA' && c.prazo && c.prazo < hoje() && <p className="text-red-700 flex gap-1"><AlertTriangle size={14} className="mt-0.5" />Prazo do setor vencido em {br(c.prazo)}. Cobre a resposta.</p>}
      </div>
    </Modal>
  );
};
