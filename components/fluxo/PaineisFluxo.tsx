import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BaixarModelo } from '../ui/BaixarModelo';
import { modeloProposta } from '../../utils/modelos';
import { FileSpreadsheet, FileUp, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  Fase5NaoInstaladaError, Saida, baixasComSigla, carregarBase, listarRubricas, listarSaidas, salvarRubricas, salvarSaidas, tcRecebida,
} from '../../services/relatoriosService';
import {
  CATEGORIAS, Categoria, Rubrica, categoriaDaSaida, classificarRubrica, condominioPorRubrica, entradasPorCategoria, lerNE, percentuais, saldoMensal,
} from '../../utils/relatorios';
import { chave, limpar } from '../../utils/cadastroImport';
import { numero, data as dataCelula } from '../../utils/faturasImport';
import { referencia } from '../../utils/faturamento';
import { notify } from '../../utils/notify';
import { v4 as uuidv4 } from 'uuid';
import { DocumentType } from '../../types';
import { Button } from '../ui/Button';

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
        <p className="text-xs text-slate-500 pb-2">O saldo final de cada mês é transportado para o seguinte, inclusive na virada do exercício. Entradas = ALTCRED/GRU recebidas; saídas = notas de empenho não anuladas.</p></div>
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
  const { base, saidas, rubricas, naoInstalado } = useDados(ano);
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
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Rubrica', 'Descrição', `Valor vigente ${ano}`, '%RUB', 'TC recebida (receita da rubrica)', 'Empenhado', '% executado', 'Saldo em conta', 'A receber'],
      ...dados.linhas.map(l => [l.numero, l.descricao, l.valorVigente, l.percentual / 100, l.tcRecebida, l.empenhado, l.execucao / 100, l.saldoEmConta, l.aReceber]),
      ['TOTAL', '', dados.total.valorVigente, dados.total.percentual / 100, dados.total.tcRecebida, dados.total.empenhado, dados.total.execucao / 100, dados.total.saldoEmConta, dados.total.aReceber]]), `Condomínio ${ano}`);
    XLSX.writeFile(wb, `condominio_por_rubrica_${ano}.xlsx`);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">Exercício<input type="number" className={`${sel} block mt-1 w-24`} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício do condomínio" /></label>
        <Button variant="secondary" onClick={exportar} disabled={!dados?.linhas.length}><FileSpreadsheet size={16} className="mr-1" />Excel</Button>
        {dados && <p className="text-sm text-slate-600 pb-2">Taxa condominial recebida em {ano}: <b>{brl(dados.tc)}</b> (baixas em faturas TC, pela data da baixa), distribuída pelo %RUB de cada rubrica.</p>}
      </div>
      {!rubricas.length && <p className="text-sm text-amber-700">Cadastre ou importe as rubricas de {ano} na aba Rubricas.</p>}
      {dados && rubricas.length > 0 && (
        <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 uppercase text-slate-500"><tr>{['Nº', 'Rubrica', 'Valor vigente', '%RUB', 'TC recebida', 'Empenhado', '% exec.', 'Saldo em conta', 'A receber'].map(x => <th key={x} className={`px-2 py-2 ${x === 'Rubrica' || x === 'Nº' ? 'text-left' : 'text-right'}`}>{x}</th>)}</tr></thead>
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
export const Rubricas: React.FC<{ podeEditar: boolean }> = ({ podeEditar }) => {
  const [ano, setAno] = useState(new Date().getFullYear());
  const { rubricas, naoInstalado, recarregar } = useDados(ano);
  const [lista, setListaBruta] = useState<Rubrica[]>([]);
  const [sujo, setSujo] = useState(false);
  const setLista = (l: Rubrica[]) => { setListaBruta(l); setSujo(true); };
  const [gravando, setGravando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  // o banco só substitui a lista quando não há alteração por gravar (evita apagar uma importação)
  useEffect(() => { if (!sujo) setListaBruta(rubricas); }, [rubricas]);
  useEffect(() => { setSujo(false); }, [ano]);
  if (naoInstalado) return <Aviso009 />;
  const pct = percentuais(lista);
  const total = lista.reduce((s, r) => s + r.valorAnual, 0);

  /** Proposta anual da taxa condominial (aba Despesas_NOVO): nº de ordem, conta, despesa, valor (atualizado). */
  const importar = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const wb = XLSX.read(new Uint8Array(await lerArquivo(files[0])), { dense: true, cellFormula: false, cellStyles: false });
      const aba = wb.SheetNames.find(n => /despesas/i.test(n)) ?? wb.SheetNames[0];
      const m = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null }) as any[][];
      const h = m.findIndex(r => (r || []).some(c => chave(c).startsWith('ndeordem')));
      if (h < 0) throw new Error('Não achei a coluna "Nº DE ORDEM".');
      const col = (...p: string[]) => m[h].findIndex((c: any) => p.some(x => chave(c).startsWith(x)));
      const iN = col('ndeordem'), iConta = col('contacontabil'), iDesp = col('despesas'), iAtual = col('valorrubricaatua'), iValor = col('valorpara');
      const novas: Rubrica[] = [];
      let contaAtual = '';
      m.slice(h + 1).forEach(r => {
        const n = Number(limpar(r?.[iN]));
        if (!Number.isInteger(n) || n < 1 || n > 99) return;
        if (limpar(r?.[iConta])) contaAtual = limpar(r[iConta]);
        const v = numero(r?.[iAtual >= 0 ? iAtual : iValor]) ?? numero(r?.[iValor]) ?? 0;
        novas.push({ ano, numero: n, descricao: limpar(r?.[iDesp]) || `Rubrica ${n}`, contaContabil: contaAtual || null, valorAnual: Math.round(v * 100) / 100, percentual: null });
      });
      if (!novas.length) throw new Error('Nenhuma rubrica encontrada.');
      setLista(novas);
      notify.success(`${novas.length} rubricas lidas (aba ${aba}). Confira e grave.`);
    } catch (e) { notify.fail('Erro ao ler a proposta', e); } finally { if (ref.current) ref.current.value = ''; }
  };
  const gravar = async () => {
    setGravando(true);
    try { await salvarRubricas(lista.map(r => ({ ...r, ano }))); notify.success('Rubricas gravadas.'); setSujo(false); recarregar(); } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-600">Exercício<input type="number" className={`${sel} block mt-1 w-24`} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício das rubricas" /></label>
        {podeEditar && <>
          <input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" onChange={e => importar(e.target.files)} />
          <Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-1" />Importar proposta (Despesas)</Button>
          <BaixarModelo modelo={() => modeloProposta(ano)} />
          <Button variant="secondary" onClick={() => setLista([...lista, { ano, numero: (Math.max(0, ...lista.map(r => r.numero)) + 1), descricao: '', valorAnual: 0, percentual: null }])}>Nova rubrica</Button>
          <Button onClick={gravar} isLoading={gravando} disabled={!lista.length}><Save size={16} className="mr-1" />Gravar</Button>
        </>}
        <p className="text-xs text-slate-500 pb-2">Total vigente: <b>{brl(total)}</b>. %RUB = participação da rubrica no total (ou o valor informado).</p>
      </div>
      <table className="min-w-full text-sm bg-white border border-slate-200 rounded-lg">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-2 py-2 text-left w-14">Nº</th><th className="px-2 py-2 text-left">Descrição</th><th className="px-2 py-2 text-left">Conta contábil</th><th className="px-2 py-2 text-right">Valor vigente</th><th className="px-2 py-2 text-right">%RUB</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {lista.sort((a, b) => a.numero - b.numero).map((r, i) => (
            <tr key={r.numero}>
              <td className="px-2 py-1">{r.numero}</td>
              <td className="px-2 py-1"><input disabled={!podeEditar} className="w-full border border-slate-200 rounded px-1" value={r.descricao} onChange={e => setLista(lista.map((x, k) => (k === i ? { ...x, descricao: e.target.value } : x)))} aria-label={`Descrição da rubrica ${r.numero}`} /></td>
              <td className="px-2 py-1 text-xs text-slate-500">{r.contaContabil}</td>
              <td className="px-2 py-1 text-right"><input disabled={!podeEditar} type="number" step="0.01" className="w-36 text-right border border-slate-200 rounded px-1" value={r.valorAnual} onChange={e => setLista(lista.map((x, k) => (k === i ? { ...x, valorAnual: Number(e.target.value) || 0 } : x)))} aria-label={`Valor da rubrica ${r.numero}`} /></td>
              <td className="px-2 py-1 text-right tabular-nums">{(pct.get(r.numero) || 0).toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ------------------------------------------------------------------ importação de notas de empenho
/** Lê planilha de NE (formato das abas mensais do fluxo de caixa: DATA, ALTCRED/NE, CLIENTE, ENTRADA, SAÍDA, RUBRICA, DESCRIÇÃO). */
export async function lerPlanilhaNE(f: File): Promise<{ saidas: Saida[]; ignoradas: string[] }> {
  const wb = XLSX.read(new Uint8Array(await lerArquivo(f)), { dense: true, cellFormula: false, cellStyles: false });
  const saidas: Saida[] = [], ignoradas: string[] = [];
  wb.SheetNames.forEach(aba => {
    const m = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null }) as any[][];
    const h = m.findIndex(r => (r || []).some(c => /^(altcred\/?ne|ne|notadeempenho|numerodane)$/.test(chave(c))));
    if (h < 0) return;
    const col = (...p: string[]) => m[h].findIndex((c: any) => p.includes(chave(c)));
    const iData = col('data'), iNe = col('altcredne', 'ne', 'notadeempenho', 'numerodane'), iCli = col('cliente', 'favorecido'), iSai = col('saida', 'valor'), iRub = col('rubrica'), iDesc = col('descricao');
    m.slice(h + 1).forEach(r => {
      const ne = limpar(r?.[iNe]).replace(/\s/g, '').toUpperCase(), v = numero(r?.[iSai]);
      if (!ne || !v || v <= 0) return;
      if (!lerNE(ne)) { ignoradas.push(`${aba}: ${ne} (não é nº de NE)`); return; }
      const cls = classificarRubrica(limpar(r?.[iRub]));
      saidas.push({
        id: uuidv4(), date: dataCelula(r?.[iData]) || new Date().toISOString().slice(0, 10), documentNumber: ne, documentType: DocumentType.EMPENHO,
        client: limpar(r?.[iCli]), value: Math.round(v * 100) / 100, rubric: limpar(r?.[iRub]), description: limpar(r?.[iDesc]), observation: `Importada de ${f.name} › ${aba}`,
        isCanceled: false, rubricaNumero: cls.rubricaNumero, categoria: cls.categoria,
      });
    });
  });
  return { saidas, ignoradas };
}

export async function importarNE(f: File, existentes: string[]) {
  const { saidas, ignoradas } = await lerPlanilhaNE(f);
  const ja = new Set(existentes.map(x => x.trim().toUpperCase()));
  const novas = saidas.filter(s => !ja.has(s.documentNumber));
  if (novas.length) await salvarSaidas(novas);
  return { novas: novas.length, repetidas: saidas.length - novas.length, ignoradas };
}
