import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  Fase5NaoInstaladaError, Saida, baixasComSigla, carregarBase, listarRubricas, listarSaidas, salvarSaidas, tcRecebida,
} from '../../services/relatoriosService';
import {
  CATEGORIAS, Categoria, Rubrica, categoriaDaSaida, classificarRubrica, condominioPorRubrica, entradasPorCategoria, lerNE, saldoMensal,
} from '../../utils/relatorios';
import { chave, limpar } from '../../utils/cadastroImport';
import { numero, data as dataCelula } from '../../utils/faturasImport';
import { referencia } from '../../utils/faturamento';
import { notify } from '../../utils/notify';
import { v4 as uuidv4 } from 'uuid';
import { DocumentType } from '../../types';
import { Button } from '../ui/Button';
import { rubricasConsolidadas } from '../../services/taxaCondominialService';

const brl = (n: number) => `R$ ${(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white';
const lerArquivo = (f: File) => new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(new Error('Falha ao ler')); r.readAsArrayBuffer(f); });
type Base = Awaited<ReturnType<typeof carregarBase>>;

function useDados(ano: number) {
  const [base, setBase] = useState<Base | null>(null);
  const [saidas, setSaidas] = useState<Saida[]>([]);
  const [rubricas, setRubricas] = useState<Rubrica[]>([]);
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    (async () => {
      try {
        const [b, s, r] = await Promise.all([carregarBase(), listarSaidas(), listarRubricas(ano)]);
        setBase(b); setSaidas(s); setRubricas(r); setNaoInstalado(false);
      } catch (e) { if (e instanceof Fase5NaoInstaladaError) setNaoInstalado(true); else notify.fail('Erro ao carregar', e); }
    })();
  }, [ano, versao]);
  return { base, saidas, rubricas, naoInstalado, recarregar: () => setVersao(v => v + 1) };
}

const Aviso009 = () => <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm">Execute o script <code>supabase/migrations/009_relatorios_fase5.sql</code> no Supabase.</div>;
const ativa = (s: Saida) => !s.isCanceled && !s.anuladaEm;

// ------------------------------------------------------------------ saldo mensal
export const SaldoMensal: React.FC = () => {
  const [ano, setAno] = useState(new Date().getFullYear());
  const { base, saidas, naoInstalado } = useDados(ano);
  const linhas = useMemo(() => {
    if (!base) return [];
    const movs = [...base.docs.map(d => ({ data: d.date, tipo: 'ENTRADA' as const, valor: d.totalValue })), ...saidas.filter(ativa).map(s => ({ data: s.date, tipo: 'SAIDA' as const, valor: s.value }))];
    return saldoMensal(movs, `${ano}-01`, `${ano}-12`);
  }, [base, saidas, ano]);
  if (naoInstalado) return <Aviso009 />;
  const tot = linhas.reduce((t, l) => ({ e: t.e + l.entradas, s: t.s + l.saidas }), { e: 0, s: 0 });
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3"><label className="text-xs text-slate-600">Exercício<input type="number" className={`${sel} block mt-1 w-24`} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício do saldo mensal" /></label>
        <p className="text-xs text-slate-500 pb-2">O exercício começa zerado em janeiro e termina em dezembro: o saldo final de cada mês passa para o seguinte e, na virada do ano, recomeça do zero. Entradas = ALTCRED/GRU recebidas; saídas = notas de empenho não anuladas.</p></div>
      <table className="min-w-full text-sm bg-white border border-slate-200 rounded-lg">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Mês', 'Saldo anterior', 'Entradas', 'Saídas', 'Saldo'].map(x => <th key={x} className={`px-3 py-2 ${x === 'Mês' ? 'text-left' : 'text-right'}`}>{x}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {linhas.map(l => (
            <tr key={l.mes}><td className="px-3 py-1.5 font-medium">{referencia(l.mes)}</td><td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{brl(l.saldoAnterior)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{brl(l.entradas)}</td><td className="px-3 py-1.5 text-right tabular-nums text-red-700">{brl(l.saidas)}</td>
              <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${l.saldo < 0 ? 'text-red-700' : ''}`}>{brl(l.saldo)}</td></tr>
          ))}
          {linhas.length > 0 && <tr className="bg-slate-100 font-bold"><td className="px-3 py-1.5">Exercício {ano}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(linhas[0].saldoAnterior)}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(tot.e)}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(tot.s)}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(linhas[linhas.length - 1].saldo)}</td></tr>}
        </tbody>
      </table>
    </div>
  );
};

// ------------------------------------------------------------------ condomínio por rubrica + receita por rubrica
export const CondominioRubrica: React.FC = () => {
  const [ano, setAno] = useState(new Date().getFullYear());
  const { base, saidas, rubricas: rubricasVigentes, naoInstalado } = useDados(ano);
  // valores da rubrica consolidada da Taxa condominial (depois dos descontos das OM); sem rateio no ano, o vigente
  const [consolidadas, setConsolidadas] = useState<Rubrica[] | null>(null);
  useEffect(() => {
    setConsolidadas(null);
    rubricasConsolidadas(ano).then(c => setConsolidadas(c.semRateio ? null : c.rubricas.map(r => ({ ano, numero: r.numero, descricao: r.descricao, contaContabil: r.contaContabil, valorAnual: r.omLiquido, percentual: null }))))
      .catch(() => setConsolidadas(null));
  }, [ano]);
  const rubricas = consolidadas || rubricasVigentes;
  const dados = useMemo(() => {
    if (!base) return null;
    const emp = new Map<number, number>();
    saidas.filter(s => ativa(s) && s.rubricaNumero && s.date.startsWith(String(ano))).forEach(s => emp.set(s.rubricaNumero!, (emp.get(s.rubricaNumero!) || 0) + s.value));
    const tc = tcRecebida(base, ano);
    return { tc, ...condominioPorRubrica(rubricas, tc, emp), outrosEmpenhos: saidas.filter(s => ativa(s) && !s.rubricaNumero && categoriaDaSaida(s) === 'CONDOMINIO' && s.date.startsWith(String(ano))).reduce((x, s) => x + s.value, 0) };
  }, [base, saidas, rubricas, ano]);
  if (naoInstalado) return <Aviso009 />;
  const exportar = () => {
    if (!dados) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Rubrica', 'Descrição', `Valor consolidado ${ano}`, '%RUB', 'TC recebida (receita da rubrica)', 'Empenhado', '% executado', 'Saldo em conta', 'A receber'],
      ...dados.linhas.map(l => [l.numero, l.descricao, l.valorVigente, l.percentual / 100, l.tcRecebida, l.empenhado, l.execucao / 100, l.saldoEmConta, l.aReceber]),
      ['TOTAL', '', dados.total.valorVigente, dados.total.percentual / 100, dados.total.tcRecebida, dados.total.empenhado, dados.total.execucao / 100, dados.total.saldoEmConta, dados.total.aReceber]]), `Condomínio ${ano}`);
    XLSX.writeFile(wb, `condominio_por_rubrica_${ano}.xlsx`);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">Exercício<input type="number" className={`${sel} block mt-1 w-24`} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício do condomínio" /></label>
        <Button variant="secondary" onClick={exportar} disabled={!dados?.linhas.length}><FileSpreadsheet size={16} className="mr-1" />Excel</Button>
        {dados && <p className="text-sm text-slate-600 pb-2">Taxa condominial recebida em {ano}: <b>{brl(dados.tc)}</b> (baixas em faturas TC, pela data da baixa), distribuída pelo %RUB de cada rubrica. {consolidadas ? 'Valores: rubrica consolidada da Taxa condominial (parte das OM, depois dos descontos).' : 'Proposta sem rateio no ano: usando o valor vigente das rubricas.'}</p>}
      </div>
      {!rubricas.length && <p className="text-sm text-amber-700">Cadastre ou importe as rubricas de {ano} na aba Rubricas.</p>}
      {dados && rubricas.length > 0 && (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 uppercase text-slate-500"><tr>{['Nº', 'Rubrica', 'Valor consolidado', '%RUB', 'TC recebida', 'Empenhado', '% exec.', 'Saldo em conta', 'A receber'].map(x => <th key={x} className={`px-2 py-2 ${x === 'Rubrica' || x === 'Nº' ? 'text-left' : 'text-right'}`}>{x}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...dados.linhas, dados.total].map(l => (
                <tr key={l.numero} className={l.numero === 0 ? 'bg-slate-100 font-bold' : ''}>
                  <td className="px-2 py-1">{l.numero || ''}</td><td className="px-2 py-1 max-w-[260px] truncate" title={l.descricao}>{l.descricao}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{brl(l.valorVigente)}</td><td className="px-2 py-1 text-right tabular-nums">{l.percentual.toFixed(2)}%</td>
                  <td className="px-2 py-1 text-right tabular-nums text-emerald-700">{brl(l.tcRecebida)}</td><td className="px-2 py-1 text-right tabular-nums text-red-700">{brl(l.empenhado)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{l.execucao.toFixed(2)}%</td>
                  <td className={`px-2 py-1 text-right tabular-nums font-semibold ${l.saldoEmConta < 0 ? 'text-red-700' : ''}`}>{brl(l.saldoEmConta)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{brl(l.aReceber)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dados.outrosEmpenhos > 0 && <p className="px-3 py-2 text-xs text-slate-500">Outros empenhos de condomínio/diária/viatura sem rubrica: {brl(dados.outrosEmpenhos)}.</p>}
        </div>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ disponível R.901.16
export const Disponivel: React.FC = () => {
  const [ano, setAno] = useState(new Date().getFullYear());
  const { base, saidas, naoInstalado } = useDados(ano);
  const dados = useMemo(() => {
    if (!base) return null;
    const docs = base.docs.filter(d => (d.exercicio ?? Number(d.date.slice(0, 4))) === ano).map(d => ({ id: d.id, valor: d.totalValue }));
    const ent = entradasPorCategoria(docs, baixasComSigla(base));
    const sai: Record<Categoria, number> = { ENERGIA: 0, AGUA: 0, TELEFONIA: 0, CONDOMINIO: 0, SEM_INDICACAO: 0 };
    saidas.filter(s => ativa(s) && s.date.startsWith(String(ano))).forEach(s => { const c = categoriaDaSaida(s); sai[c] = Math.round((sai[c] + s.value) * 100) / 100; });
    return { ent, sai };
  }, [base, saidas, ano]);
  if (naoInstalado) return <Aviso009 />;
  const soma = (r: Record<Categoria, number>) => Object.values(r).reduce((s, v) => s + v, 0);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3"><label className="text-xs text-slate-600">Exercício<input type="number" className={`${sel} block mt-1 w-24`} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício do disponível" /></label>
        <p className="text-xs text-slate-500 pb-2">Crédito disponível na AI R.901.16 por categoria. Entradas: ALTCRED/GRU do exercício, divididas pelos serviços das faturas que pagaram (o não usado fica "sem indicação"). Saídas: notas de empenho pela rubrica/categoria.</p></div>
      {dados && (
        <table className="min-w-full text-sm bg-white border border-slate-200 rounded-lg">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-2 text-left"></th>{CATEGORIAS.map(c => <th key={c.id} className="px-3 py-2 text-right">{c.rotulo}</th>)}<th className="px-3 py-2 text-right">Total</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            <tr><td className="px-3 py-2 font-semibold">Entradas</td>{CATEGORIAS.map(c => <td key={c.id} className="px-3 py-2 text-right tabular-nums text-emerald-700">{brl(dados.ent[c.id])}</td>)}<td className="px-3 py-2 text-right tabular-nums font-semibold">{brl(soma(dados.ent))}</td></tr>
            <tr><td className="px-3 py-2 font-semibold">Saídas</td>{CATEGORIAS.map(c => <td key={c.id} className="px-3 py-2 text-right tabular-nums text-red-700">{brl(dados.sai[c.id])}</td>)}<td className="px-3 py-2 text-right tabular-nums font-semibold">{brl(soma(dados.sai))}</td></tr>
            <tr className="bg-slate-100 font-bold"><td className="px-3 py-2">Saldo</td>{CATEGORIAS.map(c => { const v = dados.ent[c.id] - dados.sai[c.id]; return <td key={c.id} className={`px-3 py-2 text-right tabular-nums ${v < 0 ? 'text-red-700' : ''}`}>{brl(v)}</td>; })}<td className="px-3 py-2 text-right tabular-nums">{brl(soma(dados.ent) - soma(dados.sai))}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ rubricas (catálogo do ano)
/**
 * Rubricas do Fluxo de caixa: SÓ CONSULTA. Mostra a rubrica consolidada da Taxa condominial — o valor final de cada
 * rubrica, depois dos descontos das OM — e o %RUB calculado sobre ele. Inclusão e valores são feitos na Taxa condominial.
 */
export const Rubricas: React.FC<{ podeEditar?: boolean }> = () => {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [dados, setDados] = useState<Awaited<ReturnType<typeof rubricasConsolidadas>> | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setDados(null); setErro('');
    rubricasConsolidadas(ano).then(setDados).catch(e => setErro(e?.message || 'Erro ao carregar a taxa condominial.'));
  }, [ano]);
  const lista = dados?.rubricas || [];
  const total = lista.reduce((s, r) => s + r.final, 0);
  // %RUB sobre a parte das OM (a taxa recebida vem só das faturas TC; os navios pagam por diária)
  const totalOM = lista.reduce((s, r) => s + r.omLiquido, 0);
  const pctDe = (r: { omLiquido: number }) => (totalOM ? (r.omLiquido / totalOM) * 100 : 0);
  const temNavios = lista.some(r => r.navios > 0.005);
  const exportar = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nº', 'Rubrica', 'Conta contábil', 'Valor final consolidado', '%RUB'],
      ...lista.map(r => [r.numero, r.descricao, r.contaContabil || '', r.final, Math.round(pctDe(r) * 10000) / 10000]), ['TOTAL', '', '', Math.round(total * 100) / 100, totalOM ? 100 : 0]]), `Rubricas ${ano}`);
    XLSX.writeFile(wb, `rubricas_consolidadas_${ano}.xlsx`);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">Exercício<input type="number" className={`${sel} block mt-1 w-24`} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício das rubricas" /></label>
        <Button variant="secondary" onClick={exportar} disabled={!lista.length}><FileSpreadsheet size={16} className="mr-1" />Excel</Button>
        <p className="text-xs text-slate-500 pb-2 max-w-2xl">Rubrica consolidada da <b>Taxa condominial e diárias</b>: valor final de cada rubrica, já descontados os descontos das OM. Só consulta: para incluir rubricas ou mudar valores, use a tela da Taxa condominial. %RUB = participação da rubrica no que as OM pagam (faturas TC){temNavios ? '; a parte dos navios (diárias) entra no valor final, mas não no %RUB' : ''}.</p>
      </div>
      {erro && <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{erro}</div>}
      {!dados && !erro && <p className="text-sm text-slate-500">Carregando...</p>}
      {dados?.semRateio && <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm" role="alert">A proposta de {ano} ainda não tem OM com lotação na Taxa condominial: não há valor consolidado. Complete a proposta em <b>Taxa condominial e diárias</b>.</div>}
      {dados && !dados.semRateio && (
        <table className="min-w-full text-sm bg-white border border-slate-200 rounded-lg" aria-label="Rubricas consolidadas">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
            <th className="px-3 py-2 text-left w-14">Nº</th><th className="px-3 py-2 text-left">Rubrica</th><th className="px-3 py-2 text-left">Conta contábil</th>
            <th className="px-3 py-2 text-right">Valor final consolidado</th><th className="px-3 py-2 text-right">%RUB</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map(r => (
              <tr key={r.numero} className={r.final > 0.005 ? '' : 'text-slate-400'}>
                <td className="px-3 py-1.5">{r.numero}</td>
                <td className="px-3 py-1.5">{r.descricao}{r.semParticipante && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800" title="Tem valor na proposta, mas nenhuma OM participa (não é cobrada)">sem participante</span>}</td>
                <td className="px-3 py-1.5 text-xs text-slate-500">{r.contaContabil || ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold" title={`Vigente ${brl(r.vigente)} − descontos das OM ${brl(r.descontosOM)}${r.navios ? ` + navios ${brl(r.navios)}` : ''}`}>{brl(r.final)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{pctDe(r).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</td>
              </tr>
            ))}
            <tr className="bg-slate-100 font-bold"><td className="px-3 py-1.5" colSpan={3}>Total consolidado {ano}</td><td className="px-3 py-1.5 text-right tabular-nums">{brl(total)}</td><td className="px-3 py-1.5 text-right">{totalOM ? '100,00%' : '—'}</td></tr>
          </tbody>
        </table>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ importação de notas de empenho
/** Lê planilha de NE (formato das abas mensais do fluxo de caixa: DATA, ALTCRED/NE, CLIENTE, ENTRADA, SAÍDA, RUBRICA, DESCRIÇÃO). */
/** Linha da planilha de NE na prévia da importação. */
export interface ItemNE { saida: Saida; situacao: 'NOVA' | 'JA_EXISTE' | 'REPETIDA_NA_PLANILHA'; avisos: string[] }
export interface PreviaNE { arquivo: string; itens: ItemNE[]; ignoradas: { aba: string; linha: number; motivo: string }[] }

/**
 * Lê a planilha de NE e monta a PRÉVIA (nada é gravado aqui). Pula, com o motivo: linhas de entrada (ALTCRED), linha de
 * EXEMPLO do modelo, número que não é de NE, valor zerado ou negativo (anulação) e linha sem data.
 * NE com número já cadastrado (ou repetido na própria planilha) aparece como "já existe" e não é gravada.
 */
export async function lerPlanilhaNE(f: File, existentes: string[] = [], rubricasDoAno: number[] = []): Promise<PreviaNE> {
  const wb = XLSX.read(new Uint8Array(await lerArquivo(f)), { dense: true, cellFormula: false, cellStyles: false });
  const itens: ItemNE[] = [], ignoradas: PreviaNE['ignoradas'] = [];
  const ja = new Set(existentes.map(x => x.trim().toUpperCase()));
  const vistos = new Set<string>();
  const rubs = new Set(rubricasDoAno);
  wb.SheetNames.forEach(aba => {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null }) as any[][];
    const h = m.findIndex(r => (r || []).some(c => /^(altcred\/?ne|ne|notadeempenho|numerodane)$/.test(chave(c))));
    if (h < 0) return;
    const col = (...p: string[]) => m[h].findIndex((c: any) => p.includes(chave(c)));
    const iData = col('data'), iNe = col('altcredne', 'ne', 'notadeempenho', 'numerodane'), iCli = col('cliente', 'favorecido'), iSai = col('saida', 'valor'), iRub = col('rubrica'), iDesc = col('descricao');
    m.slice(h + 1).forEach((r, k) => {
      const linha = h + k + 2;
      const ne = limpar(r?.[iNe]).replace(/\s/g, '').toUpperCase(), v = numero(r?.[iSai]);
      if (!ne) return;
      if (!lerNE(ne)) { if (v) ignoradas.push({ aba, linha, motivo: `${ne}: não é número de NE (linha de entrada/ALTCRED ou número incompleto)` }); return; }
      if (/^exemplo/i.test(limpar(r?.[iCli])) || /^exemplo/i.test(limpar(r?.[iDesc]))) { ignoradas.push({ aba, linha, motivo: `${ne}: linha de EXEMPLO do modelo` }); return; }
      if (v === null || v === 0) { ignoradas.push({ aba, linha, motivo: `${ne}: sem valor de saída` }); return; }
      if (v < 0) { ignoradas.push({ aba, linha, motivo: `${ne}: valor negativo (${brl(v)}) — anulação de empenho: registre a anulação na própria NE (Lançamentos)` }); return; }
      const dt = dataCelula(r?.[iData]);
      if (!dt) { ignoradas.push({ aba, linha, motivo: `${ne}: sem data` }); return; }
      const rubTxt = limpar(r?.[iRub]);
      const cls = classificarRubrica(rubTxt);
      const avisos: string[] = [];
      if (!rubTxt) avisos.push('sem rubrica/categoria');
      else if (cls.categoria === 'OUTROS') avisos.push(`rubrica "${rubTxt}" não reconhecida (fica em Outros)`);
      else if (cls.rubricaNumero && rubs.size && !rubs.has(cls.rubricaNumero)) avisos.push(`rubrica ${cls.rubricaNumero} não existe na taxa condominial de ${dt.slice(0, 4)}`);
      const situacao: ItemNE['situacao'] = ja.has(ne) ? 'JA_EXISTE' : vistos.has(ne) ? 'REPETIDA_NA_PLANILHA' : 'NOVA';
      vistos.add(ne);
      itens.push({
        situacao, avisos,
        saida: {
          id: uuidv4(), date: dt, documentNumber: ne, documentType: DocumentType.EMPENHO,
          client: limpar(r?.[iCli]), value: Math.round(v * 100) / 100, rubric: rubTxt, description: limpar(r?.[iDesc]), observation: `Importada de ${f.name} › ${aba}`,
          isCanceled: false, rubricaNumero: cls.rubricaNumero, categoria: cls.categoria,
        },
      });
    });
  });
  return { arquivo: f.name, itens, ignoradas };
}

/** Grava só as NE novas da prévia. */
export async function gravarPreviaNE(p: PreviaNE) {
  const novas = p.itens.filter(i => i.situacao === 'NOVA').map(i => i.saida);
  if (novas.length) await salvarSaidas(novas);
  return novas.length;
}
