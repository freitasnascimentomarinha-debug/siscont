import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, FileText, Paperclip, Plus, Trash2, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Aviso, brl, entrada } from '../faturamento/comum';
import { notify } from '../../utils/notify';
import { CRITERIOS, Criterio } from '../../utils/taxaCondominial';
import { Anexo, RubricaProposta, Subsidio, enviarAnexo, excluirAnexo, excluirSubsidio, linkAnexo, salvarSubsidio } from '../../services/taxaCondominialService';

const n2 = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
const kb = (b: number | null) => (b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

const Passo: React.FC<{ n: number; titulo: string; ajuda: string; children: React.ReactNode; ok?: boolean }> = ({ n, titulo, ajuda, children, ok }) => (
  <section className="border border-slate-200 rounded-xl p-4">
    <h4 className="font-bold text-slate-800 flex items-center gap-2">
      <span className={`w-6 h-6 rounded-full text-xs flex items-center justify-center text-white ${ok ? 'bg-emerald-600' : 'bg-primary-600'}`}>{ok ? '✓' : n}</span>{titulo}
    </h4>
    <p className="text-xs text-slate-500 mb-3 ml-8">{ajuda}</p>
    <div className="ml-8">{children}</div>
  </section>
);

/**
 * Ficha da rubrica, em passos: valor e justificativa → composição do valor (subsídios) → contratos e documentos →
 * destino, descontos e parte dos navios. Subsídios e documentos são gravados na hora; valor, justificativa e
 * descontos são gravados com "Gravar e fechar".
 */
export const FichaRubrica: React.FC<{
  ano: number; rubrica: RubricaProposta | null; subsidios: Subsidio[]; anexos: Anexo[]; usuario: string; podeEditar: boolean;
  onMudar: (p: Partial<RubricaProposta>) => void; onGravar: () => Promise<void>; onFechar: () => void; recarregar: () => void;
}> = ({ ano, rubrica, subsidios, anexos, usuario, podeEditar, onMudar, onGravar, onFechar, recarregar }) => {
  const [novo, setNovo] = useState({ descricao: '', documento: '', valor: '', observacao: '' });
  const [descArq, setDescArq] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [gravando, setGravando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  if (!rubrica) return null;
  const r = rubrica;
  const soma = Math.round(subsidios.reduce((s, x) => s + x.valor, 0) * 100) / 100;
  const confere = subsidios.length > 0 && Math.abs(soma - r.valorPrevisto) < 0.01;

  const incluirSubsidio = async () => {
    const valor = n2(novo.valor);
    if (!novo.descricao.trim() || valor === null) { notify.error('Informe a descrição e o valor.'); return; }
    try {
      await salvarSubsidio({ ano, rubrica: r.numero, descricao: novo.descricao, documento: novo.documento || null, valor, observacao: novo.observacao || null, criadoPor: usuario });
      setNovo({ descricao: '', documento: '', valor: '', observacao: '' }); recarregar();
    } catch (e) { notify.fail('Erro ao gravar o subsídio', e); }
  };
  const enviar = async (files: FileList | null) => {
    if (!files?.length) return;
    setEnviando(true);
    try {
      for (const f of Array.from(files)) await enviarAnexo(ano, r.numero, f, descArq, usuario);
      notify.success(`${files.length} arquivo(s) anexado(s).`); setDescArq(''); recarregar();
    } catch (e) { notify.fail('Erro ao anexar', e); } finally { setEnviando(false); if (ref.current) ref.current.value = ''; }
  };
  const abrir = async (a: Anexo) => { try { window.open(await linkAnexo(a.caminho), '_blank', 'noopener'); } catch (e) { notify.fail('Erro ao abrir o arquivo', e); } };

  return (
    <Modal isOpen onClose={onFechar} title={`Rubrica ${r.numero} — ${r.descricao || 'nova'}`} maxWidth="max-w-3xl">
      <div className="space-y-4 text-sm">
        <Passo n={1} titulo={`Quanto esta despesa vai custar em ${ano}?`} ajuda="Valor previsto para o ano e, se quiser, o motivo desse valor (opcional; fica registrado para conferência)." ok={r.valorPrevisto > 0 && !!r.justificativaValor?.trim()}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">Valor previsto (R$)
              <input disabled={!podeEditar} className={`${entrada} w-full text-right`} inputMode="decimal" value={fmt(r.valorPrevisto)} onChange={e => onMudar({ valorPrevisto: n2(e.target.value) ?? 0 })} aria-label="Valor previsto da rubrica" />
            </label>
            <label className="block">Gasto em {ano - 1} (R$)
              <input disabled={!podeEditar} className={`${entrada} w-full text-right`} inputMode="decimal" value={fmt(r.gastoAnterior)} onChange={e => onMudar({ gastoAnterior: n2(e.target.value) })} aria-label="Gasto no ano anterior" />
            </label>
            <div className="text-xs text-slate-500 self-end pb-2">{r.gastoAnterior ? `Variação: ${(((r.valorPrevisto - r.gastoAnterior) / r.gastoAnterior) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : ''}</div>
          </div>
          <label className="block mt-3">Por que este valor? <span className="text-slate-400">(ex.: "contrato nº X, 12 meses de R$ Y + reajuste de 4%")</span>
            <textarea disabled={!podeEditar} rows={3} className={`${entrada} w-full`} value={r.justificativaValor || ''} onChange={e => onMudar({ justificativaValor: e.target.value })} aria-label="Justificativa do valor" />
          </label>
        </Passo>

        <Passo n={2} titulo="Como esse valor foi formado (subsídios — opcional)" ajuda="Uma linha para cada parte do valor: contrato, aditivo, pesquisa de preços, estimativa. Se usar, a soma é comparada com o valor previsto." ok={confere}>
          <table className="w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left">Descrição</th><th className="text-left">Documento</th><th className="text-right">Valor</th><th className="text-left pl-2">Observação</th><th></th></tr></thead>
            <tbody>
              {subsidios.map(s => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-1">{s.descricao}</td><td>{s.documento || '—'}</td><td className="text-right tabular-nums">{brl(s.valor)}</td><td className="pl-2 text-slate-500">{s.observacao}</td>
                  <td className="text-right">{podeEditar && <button aria-label={`Excluir subsídio ${s.descricao}`} className="text-slate-400 hover:text-red-600" onClick={async () => { try { await excluirSubsidio(s.id); recarregar(); } catch (e) { notify.fail('Erro ao excluir', e); } }}><Trash2 size={14} /></button>}</td>
                </tr>
              ))}
              {!subsidios.length && <tr><td colSpan={5} className="py-2 text-slate-400">Nenhum subsídio ainda.</td></tr>}
            </tbody>
            {subsidios.length > 0 && <tfoot><tr className="border-t border-slate-200 font-semibold"><td colSpan={2} className="py-1">Soma</td><td className="text-right tabular-nums">{brl(soma)}</td><td colSpan={2} className="pl-2">
              {confere ? <span className="text-emerald-700 flex items-center gap-1"><CheckCircle2 size={13} />fecha com o valor previsto</span>
                : <span className="text-amber-700">diferença de {brl(Math.round((r.valorPrevisto - soma) * 100) / 100)} {podeEditar && <button className="underline ml-1" onClick={() => onMudar({ valorPrevisto: soma })}>usar a soma como valor</button>}</span>}
            </td></tr></tfoot>}
          </table>
          {podeEditar && (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 mt-2 items-end">
              <input className={`${entrada} sm:col-span-4`} placeholder="Descrição *" value={novo.descricao} onChange={e => setNovo({ ...novo, descricao: e.target.value })} aria-label="Descrição do subsídio" />
              <input className={`${entrada} sm:col-span-3`} placeholder="Contrato / processo" value={novo.documento} onChange={e => setNovo({ ...novo, documento: e.target.value })} aria-label="Documento do subsídio" />
              <input className={`${entrada} sm:col-span-2 text-right`} placeholder="Valor *" inputMode="decimal" value={novo.valor} onChange={e => setNovo({ ...novo, valor: e.target.value })} aria-label="Valor do subsídio" />
              <input className={`${entrada} sm:col-span-2`} placeholder="Observação" value={novo.observacao} onChange={e => setNovo({ ...novo, observacao: e.target.value })} aria-label="Observação do subsídio" />
              <Button size="sm" className="sm:col-span-1" onClick={incluirSubsidio} aria-label="Incluir subsídio"><Plus size={14} /></Button>
            </div>
          )}
        </Passo>

        <Passo n={3} titulo="Contratos e documentos (opcional)" ajuda="Anexe, se quiser, os contratos, aditivos, pesquisas de preços ou planilhas que comprovam o valor (PDF, imagem, Excel ou Word; até 50 MB cada)." ok={anexos.length > 0}>
          <ul className="space-y-1">
            {anexos.map(a => (
              <li key={a.id} className="flex items-center gap-2 text-xs border border-slate-100 rounded-lg px-2 py-1.5">
                <FileText size={14} className="text-slate-500 shrink-0" />
                <span className="flex-1 truncate" title={a.nomeArquivo}><b>{a.nomeArquivo}</b>{a.descricao ? ` — ${a.descricao}` : ''} <span className="text-slate-400">· {kb(a.tamanho)}{a.enviadoPor ? ` · ${a.enviadoPor}` : ''}{a.createdAt && !isNaN(Date.parse(a.createdAt)) ? ` · ${new Date(a.createdAt).toLocaleDateString('pt-BR')}` : ''}</span></span>
                <button className="text-primary-700 flex items-center gap-1" onClick={() => abrir(a)}><Download size={13} />abrir</button>
                {podeEditar && <button aria-label={`Excluir ${a.nomeArquivo}`} className="text-slate-400 hover:text-red-600" onClick={async () => { if (!window.confirm(`Excluir o arquivo ${a.nomeArquivo}?`)) return; try { await excluirAnexo(a); recarregar(); } catch (e) { notify.fail('Erro ao excluir', e); } }}><Trash2 size={13} /></button>}
              </li>
            ))}
            {!anexos.length && <li className="text-xs text-slate-400">Nenhum documento anexado.</li>}
          </ul>
          {podeEditar && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <input className={`${entrada} flex-1 min-w-[200px]`} placeholder="Descrição (opcional), ex.: Contrato 12/2026" value={descArq} onChange={e => setDescArq(e.target.value)} aria-label="Descrição do documento" />
              <input ref={ref} type="file" multiple className="hidden" accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.ods,.doc,.docx,.odt" aria-label="Arquivo do contrato" onChange={e => enviar(e.target.files)} />
              <Button size="sm" variant="secondary" onClick={() => ref.current?.click()} isLoading={enviando}>{!enviando && <Upload size={14} className="mr-1" />}Anexar arquivo</Button>
            </div>
          )}
        </Passo>

        <Passo n={4} titulo="Como esta despesa é dividida" ajuda="Quem paga e por qual critério. O padrão (planilha 2026) é: 100% entre as OM por pessoa, e os navios pagam a sua parte à parte.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">Esta rubrica é
              <select disabled={!podeEditar} className={`${entrada} w-full`} value={r.destino} onChange={e => onMudar({ destino: e.target.value as any })} aria-label="Destino da rubrica">
                <option value="TC">da taxa condominial</option>
                <option value="PAR">só para o PAR (fora da taxa)</option>
              </select>
            </label>
            {r.destino === 'TC' && <label className="block">Critério para dividir entre as OM
              <select disabled={!podeEditar} className={`${entrada} w-full`} value={r.criterio || 'LOTACAO'} onChange={e => onMudar({ criterio: e.target.value as Criterio })} aria-label="Critério de rateio">
                {(Object.keys(CRITERIOS) as Criterio[]).map(c => <option key={c} value={c}>{CRITERIOS[c]}</option>)}
              </select>
              <span className="text-[11px] text-slate-500">{{ LOTACAO: 'Quem tem mais gente paga mais (lotação × 30 dias).', AREA: 'Informe a área (m²) de cada OM na aba Clientes e matriz.', IGUAL: 'Todas as OM marcadas pagam o mesmo valor.', PESO: 'Informe o peso de cada OM na aba Clientes e matriz (ex.: nº de pontos, consumo, tamanho).' }[r.criterio || 'LOTACAO']}</span>
            </label>}
          </div>
          {r.destino === 'TC' && <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
              <label className="block">% do valor para as OM
                <input disabled={!podeEditar} className={`${entrada} w-full text-right`} inputMode="decimal" value={fmt(r.percentualOM ?? 100)} onChange={e => onMudar({ percentualOM: Math.min(100, Math.max(0, n2(e.target.value) ?? 0)) })} aria-label="Percentual das OM" />
                <span className="text-[11px] text-slate-500">100 = integral; menos = parcial. As OM pagam {brl(Math.round(Math.max(0, r.valorPrevisto - r.descontoGeral) * (r.percentualOM ?? 100)) / 100)}.</span>
              </label>
              <label className="block">% do valor para os navios
                <input disabled={!podeEditar} className={`${entrada} w-full text-right`} inputMode="decimal" placeholder="0" value={(r.percentualNavios ?? 0) ? fmt(r.percentualNavios) : ''} onChange={e => onMudar({ percentualNavios: Math.min(100, Math.max(0, n2(e.target.value) ?? 0)) })} aria-label="Percentual dos navios" />
                <span className="text-[11px] text-slate-500">{(r.percentualNavios ?? 0) ? `Grupo NAVIOS paga ${brl(Math.round(r.valorPrevisto * (r.percentualNavios ?? 0)) / 100)}.` : 'Os navios não participam desta despesa.'}</span>
              </label>
              <fieldset className="block" disabled={!podeEditar || !(r.percentualNavios ?? 0)}>
                <legend>Os navios pagam</legend>
                <label className="flex items-start gap-2 text-xs mt-1"><input type="radio" name="modoNavios" checked={(r.modoNavios || 'SEPARADO') === 'SEPARADO'} onChange={() => onMudar({ modoNavios: 'SEPARADO' })} /><span><b>à parte</b> — não diminui o que as OM pagam (como hoje: garante o contrato mesmo se os navios não atracarem)</span></label>
                <label className="flex items-start gap-2 text-xs mt-1"><input type="radio" name="modoNavios" checked={r.modoNavios === 'CONJUNTO'} onChange={() => onMudar({ modoNavios: 'CONJUNTO' })} /><span><b>junto com as OM</b> — o valor é dividido entre OM e navios pela lotação; a parte dos navios diminui a das OM</span></label>
              </fieldset>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <label className="block">Desconto geral (R$, vale para todas as OM)
                <input disabled={!podeEditar} className={`${entrada} w-full text-right`} inputMode="decimal" placeholder="0" value={fmt(r.descontoGeral) === '0' ? '' : fmt(r.descontoGeral)} onChange={e => onMudar({ descontoGeral: n2(e.target.value) ?? 0 })} aria-label="Desconto geral" />
              </label>
              <label className="block">Motivo do desconto geral
                <input disabled={!podeEditar} className={`${entrada} w-full`} value={r.justificativa || ''} onChange={e => onMudar({ justificativa: e.target.value })} aria-label="Motivo do desconto geral" />
              </label>
            </div>
          </>}
          {r.destino === 'TC' && r.descontoGeral > 0 && !r.justificativa?.trim() && <Aviso tom="red">Informe o motivo do desconto geral.</Aviso>}
        </Passo>

        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <span className="text-xs text-slate-500 flex items-center gap-1"><Paperclip size={13} />Subsídios e documentos já ficam gravados. Valor, justificativa e descontos são gravados no botão ao lado.</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onFechar}>Fechar</Button>
            {podeEditar && <Button isLoading={gravando} onClick={async () => { setGravando(true); try { await onGravar(); onFechar(); } finally { setGravando(false); } }}>Gravar e fechar</Button>}
          </div>
        </div>
      </div>
    </Modal>
  );
};
