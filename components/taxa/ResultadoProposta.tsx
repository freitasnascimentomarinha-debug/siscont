import React, { useRef, useState } from 'react';
import { obterNormas } from '../../utils/normas';
import { BaixarModelo } from '../ui/BaixarModelo';
import { modeloProposta } from '../../utils/modelos';
import { Download, FileUp } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Aviso, Campo, brl, entrada, lerArquivo } from '../faturamento/comum';
import { notify } from '../../utils/notify';
import { DadosProposta, importarDescontos, salvarConferencia, salvarLotacoes, salvarMatriz, salvarPendentes, salvarProposta, salvarRubricasProposta } from '../../services/taxaCondominialService';
import { ClienteModal } from './ClienteModal';
import { ResultadoRateio } from '../../utils/taxaCondominial';
import { lerAbas, lerProposta, ligarOMs } from '../../utils/taxaCondominialImport';
import { acharNavio } from '../../utils/importMedicoes';
import { baixarRelatorio } from '../../utils/pdfRelatorio';
import { relatorioTaxa } from '../../utils/relatoriosPdf';
import { hojeISO } from '../../utils/datas';

const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

// ================================================================== Resultado (taxa condominial ou diárias)
export const AbaResultado: React.FC<{ ano: number; dados: DadosProposta; resultado: ResultadoRateio; anterior: Map<string, number>; modo: 'TC' | 'DA' }> = ({ ano, dados, resultado, anterior, modo }) => {
  const [omExtrato, setOmExtrato] = useState('');
  const da = modo === 'DA';
  const rub = new Map(dados.rubricas.map(r => [r.numero, r]));
  const totalVig = resultado.valorRubricas.reduce((s, r) => s + r.valor, 0);
  // composição do total da taxa: rubricas (1 a 33) e outros gastos (34 a 37), já sem os descontos das OM
  const liqPor = (dest: 'TC' | 'OG') => Math.round(resultado.oms.reduce((s, o) => s + o.parcelas.filter(p => rub.get(p.rubrica)?.destino === dest).reduce((t, p) => t + p.liquido, 0), 0) * 100) / 100;
  const semPart = resultado.valorRubricas.filter(r => r.semParticipante);
  const semHist = resultado.oms.filter(o => o.regraDiaria === 'SEM_HISTORICO');
  const descontos = resultado.oms.reduce((s, o) => s + o.descontos, 0);
  const sel = resultado.oms.find(o => o.omId === omExtrato);
  // comparativo com o ano anterior: TC mensal (Anexo B) ou diária
  const atual = (o: ResultadoRateio['oms'][number]) => (da ? o.diaria ?? 0 : o.mensal);
  // conferência com a planilha importada (valor fechado da aba PROPOSTA e extratos por cliente)
  const fechados = new Map(dados.fechados.filter(f => (f.tipo || 'TC') === modo && f.omId).map(f => [f.omId!, f]));
  const planilha = (o: ResultadoRateio['oms'][number]) => { const f = fechados.get(o.omId); return f ? (da ? f.atualizada : f.mensal) : null; };
  const confere = (o: ResultadoRateio['oms'][number]) => { const p = planilha(o); return p == null ? null : Math.abs(p - atual(o)) < 0.02; };
  const conferidos = resultado.oms.filter(o => confere(o) !== null), divergem = conferidos.filter(o => confere(o) === false);
  const antDe = (o: ResultadoRateio['oms'][number]) => anterior.get(o.omId) ?? fechados.get(o.omId)?.anteriorMensal ?? undefined;
  const variacao = (o: ResultadoRateio['oms'][number]) => { const a = antDe(o); return a ? Math.round(((atual(o) - a) / a) * 10000) / 100 : null; };
  const extratoPlanilha = (omId: string, rub: number) => dados.extratos.find(e => e.omId === omId && e.rubrica === rub);

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    const add = (nome: string, aoa: any[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), nome);
    if (da) {
      add('DIARIAS', [[`DIÁRIA DE ATRACAÇÃO ${ano}`, `custo por militar-dia: ${resultado.custoMilitarDia}`], ['NAVIO', 'LOTAÇÃO', 'DIAS/MÊS', 'VALOR ANUAL ESTIMADO', 'VALOR ESTIMADO MÊS', `DIÁRIA ${ano - 1}`, `DIÁRIA ${ano}`, 'VARIAÇÃO %', 'REGRA'],
        ...resultado.oms.map(o => [o.nome, o.lotacao, o.dias, o.anual, o.mensal, anterior.get(o.omId) ?? '', o.diaria, variacao(o), o.regraDiaria === 'SEM_HISTORICO' ? 'classe sem histórico (lotação)' : 'custo militar-dia × lotação'])]);
    } else {
      add('TAXA CONDOMINIAL', [[`TAXA CONDOMINIAL ${ano}`], ['OM', 'ANUAL', 'MENSAL', '%'], ...resultado.oms.map(o => [o.nome, o.anual, o.mensal, o.percentual])]);
      add('COMPARATIVO', [[`ANEXO B — COMPARATIVO ${ano - 1} × ${ano}`], ['OM', `ANUAL ${ano - 1}`, `MENSAL ${ano - 1}`, `PROPOSTA ${ano} (A)`, 'DESCONTOS ANUAL', 'PROPOSTA ATUALIZADA', 'MENSAL', 'VARIAÇÃO %'],
        ...resultado.oms.map(o => { const a = anterior.get(o.omId) || 0; return [o.nome, Math.round(a * 1200) / 100, a, Math.round(o.parcelas.reduce((s, p) => s + p.bruto, 0) * 100) / 100, o.descontos, o.anual, o.mensal, variacao(o)]; })]);
      add('EXTRATO', [['OM', 'RUBRICA', 'DESPESA', 'PARCELA', 'DESCONTO', 'LÍQUIDO'], ...resultado.oms.flatMap(o => o.parcelas.map(p => [o.nome, p.rubrica, rub.get(p.rubrica)?.descricao || '', p.bruto, p.desconto, p.liquido]))]);
      add('DESCONTOS', [['OM', 'RUBRICA', 'TIPO', 'VALOR', 'JUSTIFICATIVA'], ...dados.descontos.map(d => [dados.oms.find(o => o.id === d.omId)?.nome || '', d.rubrica ?? 'TOTAL', d.tipo, d.valor, d.justificativa])]);
    }
    add('RUBRICAS', [['Nº', 'DESPESA', 'PREVISTO', 'DESCONTO GERAL', 'VIGENTE', 'RATEADO', 'JUSTIFICATIVA'], ...dados.rubricas.filter(r => (modo === 'TC' ? r.destino === 'TC' || r.destino === 'OG' : r.destino === modo)).map(r => [r.numero, r.descricao, r.valorPrevisto, r.descontoGeral, resultado.valorRubricas.find(v => v.numero === r.numero)?.valor ?? 0, resultado.valorRubricas.find(v => v.numero === r.numero)?.distribuido ?? 0, r.justificativa || ''])]);
    XLSX.writeFile(wb, da ? `diarias_atracacao_${ano}.xlsx` : `taxa_condominial_${ano}.xlsx`);
  };

  /** PDF para anexar a processo: cartões, Anexo B (ou diárias por navio), rubricas e descontos. */
  const exportarPdf = () => {
    const bruto = (o: ResultadoRateio['oms'][number]) => Math.round(o.parcelas.reduce((s, p) => s + p.bruto, 0) * 100) / 100;
    const rubricasPdf = da
      ? resultado.valorRubricas.filter(v => v.valor > 0).map(v => ({ numero: v.numero, descricao: rub.get(v.numero)?.descricao || '', previsto: v.valor, descontoGeral: 0, vigente: v.valor }))
      : dados.rubricas.filter(r => r.destino === 'TC' || r.destino === 'OG').map(r => ({ numero: r.numero, descricao: r.descricao, previsto: r.valorPrevisto, descontoGeral: r.descontoGeral, vigente: Math.round((r.valorPrevisto - r.descontoGeral) * 100) / 100 }));
    baixarRelatorio(relatorioTaxa({
      ano, modo, status: dados.proposta.status || 'PROPOSTA', hoje: hojeISO(), cartoes, custoMilitarDia: resultado.custoMilitarDia,
      oms: resultado.oms.map(o => ({ nome: o.nome, lotacao: o.lotacao, dias: o.dias ?? null, anual: o.anual, mensal: o.mensal, percentual: o.percentual, bruto: bruto(o), descontos: o.descontos, diaria: o.diaria ?? null, semHistorico: o.regraDiaria === 'SEM_HISTORICO', anteriorMensal: antDe(o) ?? null, variacao: variacao(o) })),
      rubricas: rubricasPdf, descontos: dados.descontos.map(d => ({ om: dados.oms.find(o => o.id === d.omId)?.nome || '', rubrica: d.rubrica === null ? 'Total' : `${d.rubrica} – ${rub.get(d.rubrica)?.descricao || ''}`, tipo: d.tipo, valor: d.valor, justificativa: d.justificativa })),
    }));
  };
  const cartoes: [string, string][] = da
    ? [['Valor destinado às diárias', brl(totalVig)], ['Navios', String(resultado.oms.length)], ['Custo por militar-dia', `R$ ${resultado.custoMilitarDia.toLocaleString('pt-BR', { minimumFractionDigits: 4 })}`], ['Diárias (soma de 1 dia de cada navio)', brl(resultado.oms.reduce((s, o) => s + (o.diaria || 0), 0))]]
    : [['Taxas condominiais (rubricas)', brl(liqPor('TC'))], ['Outros gastos', brl(liqPor('OG'))], ['Total rateado entre as OM', brl(resultado.total)], ['Descontos por OM', brl(descontos)], ['Taxa mensal (todas as OM)', brl(resultado.oms.reduce((s, o) => s + o.mensal, 0))]];
  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 ${da ? 'md:grid-cols-4' : 'md:grid-cols-5'} gap-3`}>
        {cartoes.map(([t, v]) => (<div key={t} className="p-3 rounded-lg border border-slate-200 bg-slate-50"><div className="text-xs text-slate-500">{t}</div><div className="font-bold text-slate-800">{v}</div></div>))}
      </div>
      {conferidos.length > 0 && (divergem.length
        ? <Aviso><b>Conferência com a planilha:</b> {conferidos.length - divergem.length} de {conferidos.length} conferem. Diferentes: {divergem.map(o => `${o.nome} (sistema ${brl(atual(o))} × planilha ${brl(planilha(o) || 0)})`).join('; ')}.</Aviso>
        : <Aviso tom="emerald"><b>Conferência com a planilha:</b> os {conferidos.length} valores {da ? 'de diária' : 'mensais'} conferem com a aba PROPOSTA da planilha importada.</Aviso>)}
      {semPart.length > 0 && <Aviso tom="red"><b>Rubricas com valor e sem participante</b> (não rateadas): {semPart.map(r => `${r.numero} – ${rub.get(r.numero)?.descricao} (${brl(r.valor)})`).join('; ')}. {da ? 'Inclua os navios na aba Navios.' : 'Marque as OM na aba Clientes e matriz ou zere o valor.'}</Aviso>}
      {da && !totalVig && <Aviso>Nenhuma linha da taxa com parte dos navios. Defina no quadro "Valor destinado aos navios" da aba 5. Navios.</Aviso>}
      {semHist.length > 0 && <Aviso>
        <b>Navios sem dias de atracação no histórico:</b> {semHist.map(o => o.nome).join(', ')}. Recebem a diária pela lotação = custo por militar-dia × lotação (como a "diária a ser considerada com base na lotação" da planilha).
      </Aviso>}
      {!resultado.oms.length && <Aviso>{da ? 'Nenhum navio com lotação no ano. Preencha a aba Navios ou importe a proposta.' : 'Nenhuma OM com lotação no ano. Preencha a aba Clientes e matriz ou importe a proposta.'}</Aviso>}
      <div className="flex flex-wrap gap-2 justify-end"><Button variant="secondary" onClick={exportarPdf} disabled={!resultado.oms.length}><Download size={16} className="mr-1" />PDF {da ? '(diárias)' : '(proposta e resultado)'}</Button><Button variant="secondary" onClick={exportar} disabled={!resultado.oms.length}><Download size={16} className="mr-1" />{da ? 'Exportar Excel (diárias)' : `Exportar Excel (taxa, ${obterNormas().anexoTC}, extrato)`}</Button></div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600 sticky top-0"><tr>
            <th className="px-2 py-2 text-left">{da ? 'Navio' : 'OM'}</th><th className="px-2 text-right">Lotação</th><th className="px-2 text-right">{da ? 'Dias/mês' : 'Dias'}</th><th className="px-2 text-right">Peso</th>
            {!da && <><th className="px-2 text-right">Anual bruto</th><th className="px-2 text-right">Descontos</th></>}
            <th className="px-2 text-right">{da ? 'Valor anual estimado' : 'Anual'}</th><th className="px-2 text-right">{da ? 'Valor estimado mês' : 'Mensal (TC)'}</th><th className="px-2 text-right">%</th>
            {da && <th className="px-2 text-right">Diária {ano}</th>}
            <th className="px-2 text-right" title="valor da aba PROPOSTA da planilha importada">Planilha</th>
            <th className="px-2 text-right">{da ? `Diária ${ano - 1}` : `Mensal ${ano - 1}`}</th><th className="px-2 text-right">Variação</th>
          </tr></thead>
          <tbody>
            {resultado.oms.map(o => {
              const v = variacao(o);
              return (
                <tr key={o.omId} className={`border-t border-slate-100 cursor-pointer hover:bg-primary-50/40 ${omExtrato === o.omId ? 'bg-primary-50' : ''}`} onClick={() => setOmExtrato(o.omId)}>
                  <td className="px-2 py-1">{o.nome}</td>
                  <td className="px-2 text-right">{o.lotacao}</td><td className="px-2 text-right">{o.dias}</td><td className="px-2 text-right">{o.peso.toLocaleString('pt-BR')}</td>
                  {!da && <><td className="px-2 text-right">{brl(o.parcelas.reduce((s, p) => s + p.bruto, 0))}</td><td className="px-2 text-right text-emerald-700">{o.descontos ? `− ${brl(o.descontos)}` : ''}</td></>}
                  <td className="px-2 text-right font-semibold">{brl(o.anual)}</td><td className="px-2 text-right font-semibold">{brl(o.mensal)}</td><td className="px-2 text-right">{o.percentual}</td>
                  {da && <td className="px-2 text-right font-semibold" title={o.regraDiaria === 'SEM_HISTORICO' ? 'sem histórico: diária pela lotação' : undefined}>{o.diaria !== undefined ? `${brl(o.diaria)}${o.regraDiaria === 'SEM_HISTORICO' ? ' *' : ''}` : '—'}</td>}
                  <td className="px-2 text-right whitespace-nowrap">{planilha(o) == null ? <span className="text-slate-300">—</span> : <>{brl(planilha(o)!)} {confere(o) ? <span className="text-emerald-700" title="confere">✓</span> : <span className="text-amber-700" title={`diferença ${brl(Math.round((atual(o) - planilha(o)!) * 100) / 100)}`}>⚠</span>}</>}</td>
                  <td className="px-2 text-right text-slate-500">{antDe(o) ? brl(antDe(o)!) : '—'}</td>
                  <td className={`px-2 text-right ${v && v > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{pct(v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!da && <div className="space-y-2">
        <Campo rotulo="Extrato da OM (como a OM chegou ao valor)">
          <select className={entrada} value={omExtrato} onChange={e => setOmExtrato(e.target.value)} aria-label="OM do extrato">
            <option value="">escolher (ou clique na linha acima)...</option>{resultado.oms.map(o => <option key={o.omId} value={o.omId}>{o.nome}</option>)}
          </select>
        </Campo>
        {sel && (
          <table className="w-full text-xs border border-slate-200 rounded-lg">
            <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2 py-1.5 text-left">Rubrica</th><th className="px-2 text-right">Valor da rubrica</th><th className="px-2 text-right">Participação</th><th className="px-2 text-right">Parcela</th><th className="px-2 text-right">Desconto</th><th className="px-2 text-right">Líquido</th><th className="px-2 text-right" title="extrato do cliente na planilha importada">Extrato da planilha</th></tr></thead>
            <tbody>
              {sel.parcelas.map(p => { const v = resultado.valorRubricas.find(x => x.numero === p.rubrica); return (
                <tr key={p.rubrica} className="border-t border-slate-100">
                  <td className="px-2 py-1">{p.rubrica} – {rub.get(p.rubrica)?.descricao}</td><td className="px-2 text-right">{brl(v?.valor || 0)}</td>
                  <td className="px-2 text-right">{v?.valor ? pct(Math.round((p.bruto / v.valor) * 1000000) / 10000) : '—'}</td>
                  <td className="px-2 text-right">{brl(p.bruto)}</td><td className="px-2 text-right text-emerald-700">{p.desconto ? `− ${brl(p.desconto)}` : ''}</td><td className="px-2 text-right font-semibold">{brl(p.liquido)}</td>
                  <td className="px-2 text-right whitespace-nowrap">{(() => { const e = extratoPlanilha(sel.omId, p.rubrica); if (!e) return <span className="text-slate-300">—</span>; const ok = Math.abs(e.bruto - p.bruto) < 0.02 && Math.abs(e.desconto - p.desconto) < 0.02; return <>{brl(e.liquido)} {ok ? <span className="text-emerald-700" title="confere">✓</span> : <span className="text-amber-700" title={`planilha: parcela ${brl(e.bruto)}, desconto ${brl(e.desconto)}`}>⚠</span>}</>; })()}</td>
                </tr>
              ); })}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold"><tr><td className="px-2 py-1.5" colSpan={6}>Anual {sel.anualBruto !== sel.anual ? `(após desconto no total: − ${brl(sel.anualBruto - sel.anual)})` : ''} · mensal {brl(sel.mensal)}</td><td className="px-2 text-right">{brl(sel.anual)}</td></tr></tfoot>
          </table>
        )}
      </div>}
    </div>
  );
};

// ================================================================== Importar proposta (planilha)
type Escolha = { tipo: 'OM'; omId: string } | { tipo: 'DEPOIS' } | { tipo: 'IGNORAR' };

export const ImportarProposta: React.FC<{ ano: number; dados: DadosProposta; aberto: boolean; fechar: () => void; gravado: () => void }> = ({ ano, dados, aberto, fechar, gravado }) => {
  const [lido, setLido] = useState<(ReturnType<typeof lerProposta> & { arquivo: string }) | null>(null);
  const [esc, setEsc] = useState<Map<string, Escolha>>(new Map());
  const [navioDe, setNavioDe] = useState<Map<string, boolean>>(new Map());
  const [oms, setOms] = useState(dados.oms);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const [autoLigados, setAutoLigados] = useState<Set<string>>(new Set());
  const [gravando, setGravando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const ler = async (f?: File) => {
    if (!f) return;
    try {
      const p = lerProposta(lerAbas(await lerArquivo(f)));
      const nomes = [...p.lotacoes.map(l => ({ nome: l.nome, navio: l.navio })), ...p.matriz.map(m => ({ nome: m.nome, navio: false })), ...p.descontos.map(d => ({ nome: d.nome, navio: false }))];
      const navio = new Map<string, boolean>(); nomes.forEach(n => navio.set(n.nome, navio.get(n.nome) || n.navio));
      // nomes alternativos guardados no cadastro também valem
      const comApelidos = dados.oms.flatMap(o => [o, ...(o.nomesAlternativos || []).map(a => ({ ...o, nome: a }))]);
      const lig = ligarOMs(nomes, comApelidos, acharNavio);
      setNavioDe(navio);
      setAutoLigados(new Set([...lig.entries()].filter(([, id]) => id).map(([n]) => n)));
      setEsc(new Map([...lig.entries()].map(([n, id]) => [n, id ? { tipo: 'OM', omId: id } : { tipo: 'DEPOIS' }] as [string, Escolha])));
      setOms(dados.oms);
      setLido({ ...p, arquivo: f.name });
    } catch (e) { notify.fail('Erro ao ler a proposta', e); }
    if (ref.current) ref.current.value = '';
  };
  // nomes que a leitura não conseguiu ligar sozinha (continuam listados mesmo depois de escolhidos)
  const naoLigados = [...esc.entries()].filter(([n]) => !autoLigados.has(n));
  const nomeOM = (id: string) => oms.find(o => o.id === id)?.nome || '';

  const gravar = async () => {
    if (!lido) return;
    setGravando(true);
    try {
      const idDe = (nome: string) => { const e = esc.get(nome); return e?.tipo === 'OM' ? e.omId : null; };
      const depois = (nome: string) => esc.get(nome)?.tipo === 'DEPOIS';
      const rubDA = new Set(lido.rubricas.filter(r => r.destino === 'DA').map(r => r.numero));
      // rubricas depois da última da matriz (34 a 37) servem só para o PAR; "Navios" é a linha das diárias
      const ultimaMatriz = Math.max(0, ...lido.matriz.flatMap(m => m.rubricas));
      const parcela = new Map(lido.navios.map(n => [n.numero, n.valor]));
      // sem a aba NAVIOS, vale a linha NAVIOS da matriz (100% da rubrica)
      const navMatriz = new Set(lido.matrizNavios);
      // descontos por OM: os de OM ligadas viram descontos; os de pendentes ficam na pendência
      const descLig = lido.descontos.filter(d => idDe(d.nome)).map(d => ({ omId: idDe(d.nome)!, rubrica: d.rubrica, valor: d.valor }));
      const porRub = new Map<number, number>(); lido.descontos.forEach(d => porRub.set(d.rubrica, (porRub.get(d.rubrica) || 0) + d.valor));
      if (lido.rubricas.length) {
        const atuais = new Map(dados.rubricas.map(r => [r.numero, r]));
        // a linha "Navios" da Despesas_NOVO não é rubrica: é o total do grupo dos navios (guardado só para conferência)
        const linhaNavios = lido.rubricas.find(r => r.destino === 'DA');
        if (linhaNavios) await salvarProposta({ ...dados.proposta, ano, naviosPlanilha: linhaNavios.valorPrevisto });
        await salvarRubricasProposta(ano, lido.rubricas.filter(r => r.destino !== 'DA').map(r => {
          // desconto geral = coluna DESCONTOS − soma dos descontos por OM daquela rubrica (ex.: rubrica 5, R$ 180.000)
          const geral = r.descontoPlanilha != null ? Math.max(0, Math.round((r.descontoPlanilha - (porRub.get(r.numero) || 0)) * 100) / 100) : atuais.get(r.numero)?.descontoGeral ?? 0;
          // depois da última linha da matriz (34 a 37): outros gastos, rateados entre todas as OM da taxa
          const destino = r.destino === 'TC' && ultimaMatriz > 0 && r.numero > ultimaMatriz ? 'OG' as const : r.destino;
          const pn = destino === 'TC' || destino === 'OG' ? parcela.get(r.numero) ?? (navMatriz.has(r.numero) && !lido.navios.length ? r.valorPrevisto : null) : null;
          const pctNav = pn && r.valorPrevisto ? Math.round((pn / r.valorPrevisto) * 1e6) / 1e4 : 0;
          // rubrica que as OM não pagam (na planilha: DESCONTOS = valor inteiro) e os navios pagam: OM 0%, navios 100%
          const soNavios = geral > 0 && Math.abs(geral - r.valorPrevisto) < 0.01 && pctNav >= 99.99;
          const at = atuais.get(r.numero);
          // parte dos navios: igual ao valor sugerido da linha = integral; senão, o valor fixo da planilha
          const naviosModo = !pn ? 'NAO' as const : Math.abs(pn - r.valorPrevisto) < 0.01 ? 'INTEGRAL' as const : 'FIXO' as const;
          return { numero: r.numero, descricao: r.descricao, contaContabil: r.contaContabil, valorPrevisto: r.valorPrevisto, gastoAnterior: r.gastoAnterior, destino,
            naviosModo, valorNavios: naviosModo === 'FIXO' ? pn : null, rateioTodas: destino === 'OG' ? true : at?.rateioTodas ?? false,
            descontoPlanilha: r.descontoPlanilha, descontoGeral: soNavios ? 0 : geral, parcelaNavios: pn, percentualNavios: pctNav, percentualOM: soNavios ? 0 : (at?.percentualOM ?? 100),
            criterio: at?.criterio || 'LOTACAO', modoNavios: at?.modoNavios || 'SEPARADO', justificativaValor: at?.justificativaValor ?? null,
            justificativa: !soNavios && geral > 0 ? (at?.justificativa || 'Desconto geral da planilha (coluna DESCONTOS da Despesas_NOVO)') : soNavios ? null : at?.justificativa ?? null };
        }));
      }
      if (lido.lotacoes.length) {
        const ls = new Map<string, { omId: string; lotacao: number; lotacaoAnterior: number | null; dias: number | null }>();
        lido.lotacoes.forEach(l => { const id = idDe(l.nome); if (id) ls.set(id, { omId: id, lotacao: l.lotacao, lotacaoAnterior: l.lotacaoAnterior, dias: l.navio ? l.dias : null }); });
        await salvarLotacoes(ano, [...ls.values()]);
      }
      if (lido.matriz.length) {
        const m = new Set<string>();
        lido.matriz.forEach(x => { const id = idDe(x.nome); if (id) x.rubricas.filter(r => !rubDA.has(r)).forEach(r => m.add(`${r}|${id}`)); });
        await salvarMatriz(ano, m);
      }
      if (lido.descontos.length) await importarDescontos(ano, descLig);
      // conferência: valores fechados (PROPOSTA CONDOMINIO) e extratos por cliente
      if (lido.fechados.length || lido.extratos.length) {
        const comApelidos = oms.flatMap(o => [o, ...(o.nomesAlternativos || []).map(a => ({ ...o, nome: a }))]);
        const idPorNome = (n: string) => idDe(n) || ligarOMs([{ nome: n, navio: false }], comApelidos, acharNavio).get(n) || ligarOMs([{ nome: n, navio: true }], comApelidos, acharNavio).get(n) || null;
        await salvarConferencia(ano,
          lido.fechados.map(f => ({ ...f, omId: idPorNome(f.nome) })),
          lido.extratos.flatMap(e => { const id = idPorNome(e.aba.replace(/_/g, ' ')) || idPorNome(e.nome); return e.linhas.map(l => ({ nome: e.aba, omId: id, rubrica: l.numero, bruto: l.bruto, desconto: l.desconto, liquido: l.liquido })); }));
      }
      const nomesDepois = [...esc.keys()].filter(depois);
      await salvarPendentes(ano, nomesDepois.map(nome => {
        const l = lido.lotacoes.find(x => x.nome === nome);
        return { nome, tipo: navioDe.get(nome) ? 'NAVIO' as const : 'TERRA' as const, lotacao: l?.lotacao ?? null, lotacaoAnterior: l?.lotacaoAnterior ?? null, dias: l?.navio ? l.dias : null,
          rubricas: (lido.matriz.find(x => x.nome === nome)?.rubricas || []).filter(r => !rubDA.has(r)), descontos: lido.descontos.filter(d => d.nome === nome).map(d => ({ rubrica: d.rubrica, valor: d.valor })) };
      }));
      notify.success(`Proposta importada.${nomesDepois.length ? ` ${nomesDepois.length} nome(s) ficaram pendentes para escolher o correspondente nas abas Clientes/Navios.` : ''}`);
      setLido(null); fechar(); gravado();
    } catch (e) { notify.fail('Erro ao gravar a importação', e); } finally { setGravando(false); }
  };
  return (
    <Modal isOpen={aberto} onClose={() => { setLido(null); fechar(); }} title={`Importar proposta da planilha (${ano})`} maxWidth="max-w-3xl">
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Lê as abas <b>Despesas_NOVO</b> (rubricas, valor do ano anterior, descontos), <b>Matriz_NOVO</b>, <b>RATEIO MODELO TÉCNICO</b> (ou <b>(1)</b>), <b>PROPOSTA CONDOMINIO</b> (descontos de cada OM por rubrica e valor fechado de cada OM), <b>NAVIOS</b> (parte de cada rubrica paga pelos navios) e os <b>extratos de cada cliente</b> (para conferência). Rubricas depois da 33 (34 a 37) ficam como <b>só PAR</b>, fora da taxa. A diferença entre a coluna DESCONTOS e os descontos por OM vira desconto geral da rubrica.</p>
        <input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" aria-label="Arquivo da proposta" onChange={e => ler(e.target.files?.[0])} />
        <div className="flex items-center gap-4"><Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-1" />Escolher arquivo</Button><BaixarModelo modelo={() => modeloProposta(ano)} /></div>
        {lido && <>
          <Aviso tom="slate">
            <b>{lido.arquivo}</b>: {lido.rubricas.length} rubricas ({brl(lido.rubricas.reduce((s, r) => s + r.valorPrevisto, 0))}; {lido.rubricas.filter(r => r.destino === 'DA').length} para diárias), {lido.lotacoes.filter(l => !l.navio).length} OM e {lido.lotacoes.filter(l => l.navio).length} navios com lotação, {lido.matriz.length} OM na matriz, {lido.descontos.length} desconto(s) por OM.
            {lido.avisos.map(a => <div key={a} className="text-amber-800">{a}</div>)}
          </Aviso>
          {dados.rubricas.length > 0 && <Aviso>Já existem dados de {ano}: rubricas e lotações com o mesmo número/OM serão atualizadas, a matriz será substituída e os descontos importados antes serão trocados pelos novos (os lançados à mão ficam).</Aviso>}
          {naoLigados.length > 0 && <Aviso>
            <b>{naoLigados.length} nome(s) sem correspondente automático.</b> Para cada um: escolha o cliente do cadastro (ou crie um novo), deixe <b>para decidir depois</b> (fica guardado e aparece nas abas Clientes/Navios) ou ignore.
            <div className="max-h-64 overflow-y-auto mt-2 space-y-1">
              {naoLigados.map(([n, e]) => (
                <div key={n} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="w-64 truncate" title={n}>{navioDe.get(n) ? '⚓ ' : ''}{n}</span>
                  <select className={`${entrada} text-xs`} value={e.tipo} aria-label={`O que fazer com ${n}`}
                    onChange={ev => { const v = ev.target.value; if (v === 'ESCOLHER') setEscolhendo(n); else setEsc(m => new Map(m).set(n, { tipo: v as 'DEPOIS' | 'IGNORAR' })); }}>
                    <option value="DEPOIS">decidir depois</option><option value="ESCOLHER">escolher / criar cliente…</option><option value="IGNORAR">ignorar</option>
                    {e.tipo === 'OM' && <option value="OM">{nomeOM(e.omId)}</option>}
                  </select>
                  {e.tipo === 'OM' && <span className="text-emerald-700">→ {nomeOM(e.omId)}</span>}
                </div>
              ))}
            </div>
          </Aviso>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setLido(null)}>Cancelar</Button><Button onClick={gravar} isLoading={gravando}>Gravar importação</Button></div>
        </>}
      </div>
      <ClienteModal aberto={!!escolhendo} titulo="Escolher correspondente" oms={oms} tipo={escolhendo && navioDe.get(escolhendo) ? 'NAVIO' : undefined} nomeSugerido={escolhendo || ''}
        onFechar={() => setEscolhendo(null)}
        onEscolher={om => { if (!oms.some(o => o.id === om.id)) setOms(l => [...l, om]); setEsc(m => new Map(m).set(escolhendo!, { tipo: 'OM', omId: om.id })); setEscolhendo(null); }} />
    </Modal>
  );
};
