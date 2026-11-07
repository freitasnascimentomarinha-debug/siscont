import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BaixarModelo } from '../ui/BaixarModelo';
import { modeloMapaAtracacao } from '../../utils/modelos';
import { FileUp, Save } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ContextoFaturamento, listarAtracacoes, salvarAtracacoes } from '../../services/faturamentoService';
import { diasNoMes, referencia } from '../../utils/faturamento';
import { acharNavio, lerMapaAtracacao } from '../../utils/importMedicoes';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Aviso, Campo, entrada, lerArquivo } from './comum';
import { ResponsavelServico } from './ResponsavelServico';

const CICLO: Record<string, string> = { '': 'A', A: 'D', D: '' };
const COR: Record<string, string> = { A: 'bg-emerald-500 text-white', D: 'bg-amber-400 text-slate-900', '': 'bg-white text-slate-300' };

export const AtracacaoTab: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean; comp: string; setComp: (c: string) => void; recarregarCtx: () => Promise<void> | void }> = ({ ctx, podeEditar, comp, setComp, recarregarCtx }) => {
  const [previsao, setPrevisao] = useState(false);
  const [grade, setGrade] = useState<Record<string, string[]>>({});
  const [salvo, setSalvo] = useState<Record<string, string[]>>({});
  const [gerencia, setGerencia] = useState<Record<string, string>>({});
  const [pendentes, setPendentes] = useState<{ nome: string; dias: string[]; arquivo: string; gerencia: string }[]>([]);
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');
  // só aparecem os navios com mapa lançado (ou escolhidos aqui): a lista de todos os ativos passa de 50 linhas quase vazias
  const [extras, setExtras] = useState<Set<string>>(new Set());
  const [todos, setTodos] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const n = diasNoMes(comp);

  const carregar = async () => {
    try {
      const at = (await listarAtracacoes([comp])).filter(a => a.previsao === previsao);
      const g: Record<string, string[]> = {}, ge: Record<string, string> = {};
      at.forEach(a => { g[a.omId] = Array.from({ length: n }, (_, i) => a.dias[i] || ''); if (a.gerencia) ge[a.omId] = a.gerencia; });
      setGrade(prev => ({ ...g, ...prev })); setSalvo(g); setGerencia(p => ({ ...ge, ...p })); setPendentes([]); // preserva o digitado durante a carga
    } catch (e) { notify.fail('Erro ao carregar o mapa', e); }
  };
  useEffect(() => { setGrade({}); setSalvo({}); setGerencia({}); setExtras(new Set()); carregar(); }, [comp, previsao]);

  const naviosAtivos = useMemo(() => ctx.omsFat.filter(o => o.tipo === 'NAVIO' && o.ativo).sort((a, b) => a.nome.localeCompare(b.nome)), [ctx.omsFat]);
  const navios = useMemo(() => ctx.omsFat.filter(o => (o.tipo === 'NAVIO' && o.ativo && (todos || extras.has(o.id))) || grade[o.id])
    .filter(o => !busca || o.nome.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => Number(!grade[a.id]) - Number(!grade[b.id]) || a.nome.localeCompare(b.nome)), [ctx.omsFat, grade, busca, extras, todos]);
  const foraDaGrade = naviosAtivos.filter(o => !grade[o.id] && !extras.has(o.id));
  const alterados = Object.keys(grade).filter(k => JSON.stringify(grade[k]) !== JSON.stringify(salvo[k]));

  const clicar = (id: string, d: number) => {
    if (!podeEditar) return;
    setGrade(p => { const l = [...(p[id] || Array(n).fill(''))]; l[d] = CICLO[l[d] || '']; return { ...p, [id]: l }; });
  };
  const preencher = (id: string, v: string) => setGrade(p => ({ ...p, [id]: Array(n).fill(v) }));

  const importar = async (files: FileList | null) => {
    if (!files?.length) return;
    const novos = { ...grade }, ge = { ...gerencia };
    const sem: typeof pendentes = [];
    const msgs: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const wb = XLSX.read(new Uint8Array(await lerArquivo(f)), { dense: true, cellFormula: false, cellStyles: false });
        const mapa = lerMapaAtracacao(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }) as any);
        if (mapa.competencia && mapa.competencia !== comp) msgs.push(`${f.name}: o mapa é de ${referencia(mapa.competencia)}, diferente da competência escolhida (${referencia(comp)}).`);
        mapa.navios.forEach(nv => {
          const om = acharNavio(nv.nome, ctx.omsFat);
          const dias = Array.from({ length: n }, (_, i) => nv.dias[i] || '');
          if (!om) { if (nv.atracado + nv.docado) sem.push({ nome: nv.nome, dias, arquivo: f.name, gerencia: mapa.gerencia }); return; }
          novos[om.id] = dias; ge[om.id] = mapa.gerencia;
        });
      } catch (e: any) { msgs.push(`${f.name}: ${e?.message || 'erro ao ler'}`); }
    }
    setGrade(novos); setGerencia(ge); setPendentes(sem);
    msgs.forEach(m => notify.error(m));
    notify.success(`Mapas lidos${sem.length ? `; ${sem.length} navio(s) com atracação não encontrados no cadastro` : ''}. Confira e grave.`);
    if (ref.current) ref.current.value = '';
  };

  const ligar = (k: number, omId: string) => {
    const p = pendentes[k];
    setGrade(g => ({ ...g, [omId]: p.dias })); setGerencia(g => ({ ...g, [omId]: p.gerencia }));
    setPendentes(pendentes.filter((_, i) => i !== k));
  };

  const gravar = async () => {
    setGravando(true);
    try {
      await salvarAtracacoes(alterados.map(id => ({ competencia: comp, omId: id, previsao, dias: grade[id], gerencia: gerencia[id] ?? null })));
      notify.success(`${alterados.length} navio(s) gravado(s).`);
      await carregar();
    } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };

  return (
    <div className="space-y-4">
      <ResponsavelServico ctx={ctx} sigla="DA" podeEditar={podeEditar} onSalvo={recarregarCtx} />
      <div className="flex flex-wrap gap-3 items-end">
        <Campo rotulo="Competência"><input className={entrada} type="month" value={comp} onChange={e => setComp(e.target.value)} aria-label="Competência do mapa" /></Campo>
        <Campo rotulo="Mapa">
          <select className={entrada} value={previsao ? 'P' : 'R'} onChange={e => setPrevisao(e.target.value === 'P')} aria-label="Tipo de mapa">
            <option value="R">Realizado (mapa do mês)</option><option value="P">Previsão (lote OND: OUT–DEZ)</option>
          </select>
        </Campo>
        <Campo rotulo="Buscar navio"><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} /></Campo>
        {podeEditar && !todos && (
          <Campo rotulo="Adicionar navio à grade">
            <select className={entrada} value="" aria-label="Adicionar navio à grade" onChange={e => { const id = e.target.value; if (id) setExtras(p => new Set(p).add(id)); }}>
              <option value="">escolher... ({foraDaGrade.length})</option>
              {foraDaGrade.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </Campo>
        )}
        <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={todos} onChange={e => setTodos(e.target.checked)} /> Mostrar todos os navios ativos ({naviosAtivos.length})</label>
        {podeEditar && <>
          <input ref={ref} type="file" multiple accept=".xlsx,.xls,.ods" className="hidden" onChange={e => importar(e.target.files)} />
          <Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-2" />Importar mapas (G1…G6)</Button>
          <BaixarModelo modelo={() => modeloMapaAtracacao(comp, ctx.omsFat.filter(o => o.tipo === 'NAVIO' && o.ativo).map(o => o.nome).sort())} />
          <Button onClick={gravar} isLoading={gravando} disabled={!alterados.length}><Save size={16} className="mr-2" />Gravar ({alterados.length})</Button>
        </>}
      </div>
      <p className="text-xs text-slate-500">Clique no dia para alternar: <span className="px-1 rounded bg-emerald-500 text-white">A</span> atracado (paga diária) · <span className="px-1 rounded bg-amber-400">D</span> docado (não paga) · vazio. {referencia(comp)} tem {n} dias.</p>
      {pendentes.length > 0 && (
        <Aviso>
          <b>Navios do mapa não encontrados no cadastro</b> — escolha a OM de cada um:
          {pendentes.map((p, k) => (
            <div key={k} className="flex items-center gap-2 mt-1 text-xs">
              <span className="w-56 truncate">{p.nome} ({p.gerencia}, {p.dias.filter(d => d === 'A').length} A / {p.dias.filter(d => d === 'D').length} D)</span>
              <select className={`${entrada} text-xs`} defaultValue="" onChange={e => e.target.value && ligar(k, e.target.value)} aria-label={`OM do navio ${p.nome}`}>
                <option value="">escolher...</option>
                {ctx.omsFat.filter(o => o.tipo === 'NAVIO').sort((a, b) => a.nome.localeCompare(b.nome)).map(o => <option key={o.id} value={o.id}>{o.nome}{o.ativo ? '' : ' (desativado)'}</option>)}
              </select>
            </div>
          ))}
        </Aviso>
      )}
      {!navios.length && <Aviso tom="slate">Nenhum navio com mapa lançado em {referencia(comp)}. Importe os mapas (G1…G6) ou escolha um navio em "Adicionar navio à grade".</Aviso>}
      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
        <table className="text-xs">
          <thead className="bg-slate-50 sticky top-0 z-10">
            <tr><th className="px-2 py-1 text-left sticky left-0 bg-slate-50 min-w-[220px]">Navio</th>{Array.from({ length: n }, (_, i) => <th key={i} className="w-6 text-center font-medium text-slate-500">{i + 1}</th>)}<th className="px-2">A</th><th className="px-2">D</th><th></th></tr>
          </thead>
          <tbody>
            {navios.map(o => {
              const l = grade[o.id] || Array(n).fill('');
              const mudou = alterados.includes(o.id);
              return (
                <tr key={o.id} className={`border-t border-slate-100 ${mudou ? 'bg-primary-50/40' : ''}`}>
                  <td className="px-2 py-1 sticky left-0 bg-white truncate max-w-[220px]" title={o.nome}>{o.nome}{gerencia[o.id] ? <span className="text-slate-400"> · {gerencia[o.id]}</span> : ''}</td>
                  {l.map((d, i) => (
                    <td key={i} className="p-0.5"><button aria-label={`${o.nome} dia ${i + 1}`} onClick={() => clicar(o.id, i)} className={`w-5 h-5 rounded text-[10px] font-bold border border-slate-200 ${COR[d]}`}>{d || '·'}</button></td>
                  ))}
                  <td className="px-2 text-center font-semibold text-emerald-700">{l.filter(d => d === 'A').length}</td>
                  <td className="px-2 text-center font-semibold text-amber-700">{l.filter(d => d === 'D').length}</td>
                  <td className="px-2 whitespace-nowrap">{podeEditar && <><button className="text-primary-700 underline" onClick={() => preencher(o.id, 'A')}>todo A</button> <button className="text-slate-500 underline ml-1" onClick={() => preencher(o.id, '')}>limpar</button></>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
