import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileUp, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ContextoFaturamento, listarPrecos, salvarPrecos } from '../../services/faturamentoService';
import { chave, limpar } from '../../utils/cadastroImport';
import { numero } from '../../utils/faturasImport';
import { acharNavio } from '../../utils/importMedicoes';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Aviso, Campo, brl, entrada, lerArquivo } from './comum';

type Valores = Record<string, string>; // chave = omId ou '' (valor geral)
const r2 = (n: number) => Math.round(n * 100) / 100;
const parse = (s: string) => (s.trim() === '' ? null : Number(s.replace(/\./g, '').replace(',', '.')));
const fmt = (n: number) => String(n).replace('.', ',');

export const PrecosTab: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean }> = ({ ctx, podeEditar }) => {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [sigla, setSigla] = useState('TC');
  const [vals, setVals] = useState<Valores>({});
  const [salvo, setSalvo] = useState<Valores>({});
  const [reajuste, setReajuste] = useState('0');
  const [semPar, setSemPar] = useState<{ nome: string; valor: number }[]>([]);
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const carregar = async () => {
    try {
      const ps = (await listarPrecos([ano])).filter(p => p.sigla === sigla);
      const v: Valores = {};
      ps.forEach(p => { v[p.omId ?? ''] = fmt(p.valor); });
      setVals(prev => ({ ...v, ...prev })); setSalvo(v); setSemPar([]); // preserva o que foi digitado durante a carga
    } catch (e) { notify.fail('Erro ao carregar os preços', e); }
  };
  useEffect(() => { setVals({}); setSalvo({}); carregar(); }, [ano, sigla]);

  const porOm = sigla === 'TC' || sigla === 'DA';
  const lista = useMemo(() => ctx.omsFat
    .filter(o => (sigla === 'DA' ? o.tipo === 'NAVIO' : sigla === 'TC' ? o.tipo !== 'EXTRA_MB' : true) && (o.ativo || vals[o.id]))
    .filter(o => !busca || `${o.codigo} ${o.nome}`.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => Number(!vals[a.id]) - Number(!vals[b.id]) || a.nome.localeCompare(b.nome)), [ctx.omsFat, sigla, vals, busca]);
  const alterados = Object.keys(vals).filter(k => vals[k] !== salvo[k]);
  const total = Object.entries(vals).filter(([k]) => k).reduce((s, [, v]) => s + (parse(v) || 0), 0);

  const copiarAnterior = async () => {
    const ant = (await listarPrecos([ano - 1])).filter(p => p.sigla === sigla);
    if (!ant.length) { notify.error(`Não há preços de ${sigla} em ${ano - 1}.`); return; }
    const f = 1 + (Number(reajuste.replace(',', '.')) || 0) / 100;
    const v = { ...vals };
    ant.forEach(p => { v[p.omId ?? ''] = fmt(r2(p.valor * f)); });
    setVals(v);
    notify.success(`${ant.length} valor(es) copiados de ${ano - 1}${f !== 1 ? ` com reajuste de ${reajuste}%` : ''}. Confira e grave.`);
  };

  /** Tabela da taxa condominial (aba "TAXA CONDOMINIAL" da proposta: OM, ANUAL, MENSAL). */
  const importarTc = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const wb = XLSX.read(new Uint8Array(await lerArquivo(files[0])), { dense: true, cellFormula: false, cellStyles: false });
      const aba = wb.SheetNames.find(n => /taxa condominial/i.test(n)) ?? wb.SheetNames[0];
      const m = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: null }) as any[][];
      const h = m.findIndex(r => (r || []).some(c => chave(c) === 'mensal'));
      if (h < 0) throw new Error('Não achei a coluna MENSAL.');
      const iOm = m[h].findIndex((c: any) => chave(c) === 'om'), iMen = m[h].findIndex((c: any) => chave(c) === 'mensal');
      const v = { ...vals }; const sem: { nome: string; valor: number }[] = [];
      m.slice(h + 1).forEach(r => {
        const nome = limpar(r?.[iOm < 0 ? 0 : iOm]); const val = numero(r?.[iMen]);
        if (!nome || val === null || /^total/i.test(nome)) return;
        const base = nome.replace(/\(.*?\)/g, '').trim();
        const om = ctx.omsFat.find(o => chave(o.nome) === chave(base)) ?? ctx.oms.map(o => ({ o, s: chave(o.sigla) })).find(x => x.s && x.s === chave(base))?.o
          ?? acharNavio(base, ctx.omsFat.filter(o => o.tipo !== 'EXTRA_MB'));
        const alvo = om ? ctx.omsFat.find(x => x.id === om.id) : undefined;
        if (alvo) v[alvo.id] = fmt(r2(val)); else sem.push({ nome, valor: r2(val) });
      });
      setVals(v); setSemPar(sem);
      notify.success(`Tabela lida (aba ${aba}).${sem.length ? ` ${sem.length} linha(s) sem OM: escolha abaixo.` : ''} Confira e grave.`);
    } catch (e) { notify.fail('Erro ao ler a tabela', e); } finally { if (ref.current) ref.current.value = ''; }
  };

  const gravar = async () => {
    setGravando(true);
    try {
      await salvarPrecos(alterados.filter(k => parse(vals[k]) !== null).map(k => ({ ano, sigla, omId: k || null, valor: parse(vals[k])!, unidade: ctx.servicos.find(s => s.sigla === sigla)?.unidade })));
      notify.success('Preços gravados.');
      await carregar();
    } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };

  const rotulo = sigla === 'TC' ? 'Taxa condominial MENSAL (R$)' : sigla === 'DA' ? 'Diária de atracação (R$)' : 'Valor unitário (R$)';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <Campo rotulo="Ano"><input className={`${entrada} w-24`} type="number" value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Ano dos preços" /></Campo>
        <Campo rotulo="Serviço">
          <select className={entrada} value={sigla} onChange={e => setSigla(e.target.value)} aria-label="Serviço dos preços">{ctx.servicos.map(s => <option key={s.sigla} value={s.sigla}>{s.sigla} — {s.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Buscar OM"><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} /></Campo>
        {podeEditar && <>
          <Campo rotulo="Reajuste (%)"><input className={`${entrada} w-20`} value={reajuste} onChange={e => setReajuste(e.target.value)} /></Campo>
          <Button variant="secondary" onClick={copiarAnterior}><Copy size={16} className="mr-2" />Copiar de {ano - 1}</Button>
          {sigla === 'TC' && <><input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" onChange={e => importarTc(e.target.files)} />
            <Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-2" />Importar tabela da TC</Button></>}
          <Button onClick={gravar} isLoading={gravando} disabled={!alterados.length}><Save size={16} className="mr-2" />Gravar ({alterados.length})</Button>
        </>}
      </div>
      {porOm && <Aviso tom="slate">{sigla === 'TC' ? `Soma mensal: ${brl(total)} · anual: ${brl(total * 12)}.` : 'Diária de cada navio no ano (Anexo L: lotação × média trienal da classe).'} OM sem valor não recebe fatura deste serviço.</Aviso>}
      {!porOm && (
        <div className="p-3 rounded-lg border border-slate-200 bg-white flex items-center gap-3 text-sm">
          <span className="font-semibold">Valor geral do serviço {sigla} em {ano}:</span>
          <input disabled={!podeEditar} className={`${entrada} w-36 text-right`} value={vals[''] ?? ''} onChange={e => setVals({ ...vals, '': e.target.value })} aria-label="Valor geral" />
          <span className="text-xs text-slate-500">Usado quando a medição não traz o valor em R$ (quantidade × valor). Abaixo, valores próprios de alguma OM, se houver.</span>
        </div>
      )}
      {semPar.length > 0 && (
        <Aviso>
          <b>Linhas da tabela sem OM no cadastro</b> — escolha a OM:
          {semPar.map((p, k) => (
            <div key={k} className="flex items-center gap-2 mt-1 text-xs">
              <span className="w-56 truncate">{p.nome}: {brl(p.valor)}</span>
              <select className={`${entrada} text-xs`} defaultValue="" onChange={e => { if (!e.target.value) return; setVals(v => ({ ...v, [e.target.value]: fmt(p.valor) })); setSemPar(semPar.filter((_, i) => i !== k)); }}>
                <option value="">escolher...</option>
                {ctx.omsFat.filter(o => o.tipo !== 'EXTRA_MB').sort((a, b) => a.nome.localeCompare(b.nome)).map(o => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
              </select>
            </div>
          ))}
        </Aviso>
      )}
      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0"><tr><th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-right">{rotulo}</th>{sigla === 'TC' && <th className="px-2 py-2 text-right">Anual</th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map(o => (
              <tr key={o.id} className={vals[o.id] !== salvo[o.id] ? 'bg-primary-50/40' : ''}>
                <td className="px-2 py-1">{o.codigo} · {o.nome}<span className="text-[11px] text-slate-500"> {o.setor}</span></td>
                <td className="px-2 py-1 text-right"><input disabled={!podeEditar} aria-label={`${sigla} ${o.nome}`} className="w-32 text-right border border-slate-200 rounded px-1 py-0.5" value={vals[o.id] ?? ''} onChange={e => setVals({ ...vals, [o.id]: e.target.value })} /></td>
                {sigla === 'TC' && <td className="px-2 py-1 text-right tabular-nums text-slate-500">{parse(vals[o.id] ?? '') ? brl((parse(vals[o.id])! * 12)) : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
