import React, { useMemo, useRef, useState } from 'react';
import { Download, FileUp } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Aviso, Campo, brl, entrada, lerArquivo } from '../faturamento/comum';
import { notify } from '../../utils/notify';
import { DadosProposta, salvarLotacoes, salvarMatriz, salvarRubricasProposta } from '../../services/taxaCondominialService';
import { ResultadoRateio, comparativo } from '../../utils/taxaCondominial';
import { LotacaoLida, RubricaLida, LinhaMatriz, lerAbas, lerProposta, ligarOMs } from '../../utils/taxaCondominialImport';
import { acharNavio } from '../../utils/importMedicoes';

const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

// ================================================================== Resultado
export const AbaResultado: React.FC<{ ano: number; dados: DadosProposta; resultado: ResultadoRateio; anterior: Map<string, number> }> = ({ ano, dados, resultado, anterior }) => {
  const [omExtrato, setOmExtrato] = useState('');
  const comp = useMemo(() => comparativo(resultado.oms, anterior), [resultado, anterior]);
  const compDe = new Map(comp.map(c => [c.omId, c]));
  const rub = new Map(dados.rubricas.map(r => [r.numero, r]));
  const totalVig = resultado.valorRubricas.reduce((s, r) => s + r.valor, 0);
  const semPart = resultado.valorRubricas.filter(r => r.semParticipante);
  const semHist = resultado.oms.filter(o => o.regraDiaria === 'SEM_HISTORICO');
  const descontos = resultado.oms.reduce((s, o) => s + o.descontos, 0);
  const sel = resultado.oms.find(o => o.omId === omExtrato);

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    const add = (nome: string, aoa: any[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nome);
    add('TAXA CONDOMINIAL', [[`TAXA CONDOMINIAL ${ano}`], ['OM', 'ANUAL', 'MENSAL', '%'], ...resultado.oms.filter(o => o.tipo === 'TERRA').map(o => [o.nome, o.anual, o.mensal, o.percentual])]);
    add('DIARIAS', [[`DIÁRIA DE ATRACAÇÃO ${ano}`, `custo por militar-dia: ${resultado.custoMilitarDia}`], ['NAVIO', 'LOTAÇÃO', 'DIAS/MÊS', 'ANUAL', 'DIÁRIA', 'REGRA'],
      ...resultado.oms.filter(o => o.tipo === 'NAVIO').map(o => [o.nome, o.lotacao, o.dias, o.anual, o.diaria, o.regraDiaria === 'SEM_HISTORICO' ? 'classe sem histórico' : 'custo militar-dia × lotação'])]);
    add('COMPARATIVO', [[`ANEXO B — COMPARATIVO ${ano - 1} × ${ano}`], ['OM', `ANUAL ${ano - 1}`, `MENSAL ${ano - 1}`, `ANUAL ${ano}`, `MENSAL ${ano}`, 'VARIAÇÃO %'], ...comp.map(c => [c.nome, c.anteriorAnual, c.anteriorMensal, c.propostaAnual, c.propostaMensal, c.variacao])]);
    add('EXTRATO', [['OM', 'RUBRICA', 'DESPESA', 'PARCELA', 'DESCONTO', 'LÍQUIDO'], ...resultado.oms.flatMap(o => o.parcelas.map(p => [o.nome, p.rubrica, rub.get(p.rubrica)?.descricao || '', p.bruto, p.desconto, p.liquido]))]);
    add('RUBRICAS', [['Nº', 'DESPESA', 'PREVISTO', 'DESCONTO GERAL', 'VIGENTE', 'RATEADO', 'JUSTIFICATIVA'], ...dados.rubricas.map(r => [r.numero, r.descricao, r.valorPrevisto, r.descontoGeral, resultado.valorRubricas.find(v => v.numero === r.numero)?.valor ?? 0, resultado.valorRubricas.find(v => v.numero === r.numero)?.distribuido ?? 0, r.justificativa || ''])]);
    add('DESCONTOS', [['OM', 'RUBRICA', 'TIPO', 'VALOR', 'JUSTIFICATIVA'], ...dados.descontos.map(d => [dados.oms.find(o => o.id === d.omId)?.nome || '', d.rubrica ?? 'TOTAL', d.tipo, d.valor, d.justificativa])]);
    XLSX.writeFile(wb, `taxa_condominial_${ano}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Valor das rubricas (vigente)', brl(totalVig)], ['Total rateado', brl(resultado.total)], ['Descontos por OM', brl(descontos)], ['Custo por militar-dia (navios)', `R$ ${resultado.custoMilitarDia.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}`]].map(([t, v]) => (
          <div key={t} className="p-3 rounded-lg border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500">{t}</div><div className="font-bold text-slate-800">{v}</div></div>
        ))}
      </div>
      {semPart.length > 0 && <Aviso tom="red"><b>Rubricas com valor e sem OM participante</b> (não rateadas): {semPart.map(r => `${r.numero} – ${rub.get(r.numero)?.descricao} (${brl(r.valor)})`).join('; ')}. Marque as OM na aba Lotação e matriz ou zere o valor.</Aviso>}
      {semHist.length > 0 && <Aviso>
        <b>Navios de classe sem histórico de atracação:</b> {semHist.map(o => o.nome).join(', ')}. Ficam fora do rateio e recebem a diária alternativa = (média das diárias dos navios com histórico ÷ média da lotação desses navios) × lotação do navio.
      </Aviso>}
      {!resultado.oms.length && <Aviso>Nenhuma OM com lotação no ano. Preencha a aba Lotação e matriz ou importe a proposta.</Aviso>}
      <div className="flex flex-wrap gap-2 justify-end"><Button variant="secondary" onClick={exportar} disabled={!resultado.oms.length}><Download size={16} className="mr-1" />Exportar Excel (taxa, diárias, Anexo B, extrato)</Button></div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
            <th className="px-2 py-2 text-left">OM</th><th className="px-2 text-right">Lotação</th><th className="px-2 text-right">Dias</th><th className="px-2 text-right">Peso</th><th className="px-2 text-right">Anual bruto</th><th className="px-2 text-right">Descontos</th>
            <th className="px-2 text-right">Anual</th><th className="px-2 text-right">Mensal (TC)</th><th className="px-2 text-right">%</th><th className="px-2 text-right">Diária (DA)</th><th className="px-2 text-right">Mensal {ano - 1}</th><th className="px-2 text-right">Variação</th>
          </tr></thead>
          <tbody>
            {resultado.oms.map(o => {
              const c = compDe.get(o.omId);
              return (
                <tr key={o.omId} className={`border-t border-slate-100 cursor-pointer hover:bg-primary-50/40 ${omExtrato === o.omId ? 'bg-primary-50' : ''}`} onClick={() => setOmExtrato(o.omId)}>
                  <td className="px-2 py-1">{o.nome}{o.tipo === 'NAVIO' && <span className="text-slate-400"> · navio</span>}</td>
                  <td className="px-2 text-right">{o.lotacao}</td><td className="px-2 text-right">{o.dias}</td><td className="px-2 text-right">{o.peso.toLocaleString('pt-BR')}</td>
                  <td className="px-2 text-right">{brl(o.parcelas.reduce((s, p) => s + p.bruto, 0))}</td><td className="px-2 text-right text-emerald-700">{o.descontos ? `− ${brl(o.descontos)}` : ''}</td>
                  <td className="px-2 text-right font-semibold">{brl(o.anual)}</td><td className="px-2 text-right font-semibold">{o.tipo === 'TERRA' ? brl(o.mensal) : '—'}</td><td className="px-2 text-right">{o.percentual}</td>
                  <td className="px-2 text-right font-semibold" title={o.regraDiaria === 'SEM_HISTORICO' ? 'classe sem histórico: diária alternativa' : undefined}>{o.diaria !== undefined ? `${brl(o.diaria)}${o.regraDiaria === 'SEM_HISTORICO' ? ' *' : ''}` : '—'}</td>
                  <td className="px-2 text-right text-slate-500">{c?.anteriorMensal ? brl(c.anteriorMensal) : '—'}</td>
                  <td className={`px-2 text-right ${c?.variacao && c.variacao > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{pct(c?.variacao ?? null)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-2">
        <Campo rotulo="Extrato da OM (como a OM chegou ao valor)">
          <select className={entrada} value={omExtrato} onChange={e => setOmExtrato(e.target.value)} aria-label="OM do extrato">
            <option value="">escolher (ou clique na linha acima)...</option>{resultado.oms.map(o => <option key={o.omId} value={o.omId}>{o.nome}</option>)}
          </select>
        </Campo>
        {sel && (
          <table className="w-full text-xs border border-slate-200 rounded-lg">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2 py-1.5 text-left">Rubrica</th><th className="px-2 text-right">Valor da rubrica</th><th className="px-2 text-right">Participação</th><th className="px-2 text-right">Parcela</th><th className="px-2 text-right">Desconto</th><th className="px-2 text-right">Líquido</th></tr></thead>
            <tbody>
              {sel.parcelas.map(p => { const v = resultado.valorRubricas.find(x => x.numero === p.rubrica); return (
                <tr key={p.rubrica} className="border-t border-slate-100">
                  <td className="px-2 py-1">{p.rubrica} – {rub.get(p.rubrica)?.descricao}</td><td className="px-2 text-right">{brl(v?.valor || 0)}</td>
                  <td className="px-2 text-right">{v?.valor ? pct(Math.round((p.bruto / v.valor) * 1000000) / 10000) : '—'}</td>
                  <td className="px-2 text-right">{brl(p.bruto)}</td><td className="px-2 text-right text-emerald-700">{p.desconto ? `− ${brl(p.desconto)}` : ''}</td><td className="px-2 text-right font-semibold">{brl(p.liquido)}</td>
                </tr>
              ); })}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold"><tr><td className="px-2 py-1.5" colSpan={5}>Anual {sel.anualBruto !== sel.anual ? `(após desconto no total: − ${brl(sel.anualBruto - sel.anual)})` : ''} · mensal {brl(sel.mensal)}</td><td className="px-2 text-right">{brl(sel.anual)}</td></tr></tfoot>
          </table>
        )}
      </div>
    </div>
  );
};

// ================================================================== Importar proposta (planilha)
export const ImportarProposta: React.FC<{ ano: number; dados: DadosProposta; aberto: boolean; fechar: () => void; gravado: () => void }> = ({ ano, dados, aberto, fechar, gravado }) => {
  const [lido, setLido] = useState<{ rubricas: RubricaLida[]; matriz: LinhaMatriz[]; lotacoes: LotacaoLida[]; avisos: string[]; arquivo: string } | null>(null);
  const [lig, setLig] = useState<Map<string, string | null>>(new Map());
  const [gravando, setGravando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const ler = async (f?: File) => {
    if (!f) return;
    try {
      const p = lerProposta(lerAbas(await lerArquivo(f)));
      const nomes = [...p.lotacoes.map(l => ({ nome: l.nome, navio: l.navio })), ...p.matriz.map(m => ({ nome: m.nome, navio: false }))];
      setLig(ligarOMs(nomes, dados.oms, acharNavio));
      setLido({ ...p, arquivo: f.name });
    } catch (e) { notify.fail('Erro ao ler a proposta', e); }
    if (ref.current) ref.current.value = '';
  };
  const pendentes = [...lig.entries()].filter(([, id]) => !id).map(([n]) => n);
  const gravar = async () => {
    if (!lido) return;
    setGravando(true);
    try {
      if (lido.rubricas.length) {
        const atuais = new Map(dados.rubricas.map(r => [r.numero, r]));
        await salvarRubricasProposta(ano, lido.rubricas.map(r => ({ ...r, descontoGeral: atuais.get(r.numero)?.descontoGeral ?? 0, justificativa: atuais.get(r.numero)?.justificativa ?? null })));
      }
      if (lido.lotacoes.length) {
        const ls = new Map<string, { omId: string; lotacao: number; lotacaoAnterior: number | null; dias: number | null }>();
        lido.lotacoes.forEach(l => { const id = lig.get(l.nome); if (id) ls.set(id, { omId: id, lotacao: l.lotacao, lotacaoAnterior: l.lotacaoAnterior, dias: l.navio ? l.dias : null }); });
        await salvarLotacoes(ano, [...ls.values()]);
      }
      if (lido.matriz.length) {
        const m = new Set<string>();
        lido.matriz.forEach(x => { const id = lig.get(x.nome); if (id) x.rubricas.forEach(r => m.add(`${r}|${id}`)); });
        // navios: entram só na(s) rubrica(s) "Navios" (valor destinado às diárias), como nas abas (1)…(n) e TAXA CONDOMINIAL
        const rubNavios = lido.rubricas.filter(r => /\bNAVIOS?\b/i.test(r.descricao)).map(r => r.numero);
        lido.lotacoes.filter(l => l.navio).forEach(l => { const id = lig.get(l.nome); if (id) rubNavios.forEach(r => m.add(`${r}|${id}`)); });
        if (!rubNavios.length && lido.lotacoes.some(l => l.navio)) notify.error('Nenhuma rubrica "Navios" na planilha: marque na matriz a rubrica que custeia as diárias dos navios.');
        await salvarMatriz(ano, m);
      }
      notify.success('Proposta importada. Confira as abas e o resultado.');
      setLido(null); fechar(); gravado();
    } catch (e) { notify.fail('Erro ao gravar a importação', e); } finally { setGravando(false); }
  };
  return (
    <Modal isOpen={aberto} onClose={() => { setLido(null); fechar(); }} title={`Importar proposta da planilha (${ano})`} maxWidth="max-w-3xl">
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Lê a planilha da proposta (abas <b>Despesas_NOVO</b>, <b>Matriz_NOVO</b> e <b>RATEIO MODELO TÉCNICO</b> ou <b>(1)</b>). Grava rubricas (valor previsto e gasto do ano anterior), lotação/lotação anterior/dias dos navios e a matriz OM × rubrica. <b>Descontos não são importados</b>: lance-os nas abas Rubricas (geral) e Descontos (por OM), com justificativa.</p>
        <input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" aria-label="Arquivo da proposta" onChange={e => ler(e.target.files?.[0])} />
        <Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-1" />Escolher arquivo</Button>
        {lido && <>
          <Aviso tom="slate">
            <b>{lido.arquivo}</b>: {lido.rubricas.length} rubricas ({brl(lido.rubricas.reduce((s, r) => s + r.valorPrevisto, 0))}), {lido.lotacoes.length} OM/navios com lotação, {lido.matriz.length} OM na matriz.
            {lido.avisos.map(a => <div key={a} className="text-amber-800">{a}</div>)}
          </Aviso>
          {dados.rubricas.length > 0 && <Aviso>Já existem dados de {ano}: rubricas e lotações com o mesmo número/OM serão atualizadas e a matriz será substituída.</Aviso>}
          {pendentes.length > 0 && <Aviso>
            <b>{pendentes.length} nome(s) não encontrados no cadastro</b> — escolha a OM (ou deixe em branco para ignorar):
            <div className="max-h-56 overflow-y-auto mt-1">
              {pendentes.map(n => (
                <div key={n} className="flex items-center gap-2 mt-1 text-xs">
                  <span className="w-72 truncate" title={n}>{n}</span>
                  <select className={`${entrada} text-xs`} defaultValue="" aria-label={`OM de ${n}`} onChange={e => setLig(m => new Map(m).set(n, e.target.value || null))}>
                    <option value="">ignorar</option>{[...dados.oms].sort((a, b) => a.nome.localeCompare(b.nome)).map(o => <option key={o.id} value={o.id}>{o.nome}{o.ativo ? '' : ' (desativada)'}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Aviso>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setLido(null)}>Cancelar</Button><Button onClick={gravar} isLoading={gravando}>Gravar importação</Button></div>
        </>}
      </div>
    </Modal>
  );
};

