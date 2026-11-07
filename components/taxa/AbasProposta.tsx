import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Aviso, Campo, brl, entrada, lerArquivo } from '../faturamento/comum';
import { notify } from '../../utils/notify';
import {
  DadosProposta, Lotacao, RubricaProposta, diasDoBnic35, excluirDesconto, salvarAtracacaoAnual, salvarDesconto,
  salvarLotacoes, salvarMatriz, salvarRubricasProposta,
} from '../../services/taxaCondominialService';
import { AnoClasse, Desconto, MediaClasse, ResultadoRateio, mediaTrienal, naviosAtivos, valorVigente } from '../../utils/taxaCondominial';
import { acharPorNome, lerAbas, lerHistorico } from '../../utils/taxaCondominialImport';

const n2 = (v: string) => (v.trim() === '' ? null : Number(v.replace(/\./g, '').replace(',', '.')));
const fmt = (v: number | null | undefined, casas = 2) => (v === null || v === undefined ? '' : String(Math.round(v * 10 ** casas) / 10 ** casas));
const pct = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);

interface AbaProps { ano: number; dados: DadosProposta; podeEditar: boolean; recarregar: () => void }

// ================================================================== Rubricas
export const AbaRubricas: React.FC<AbaProps> = ({ ano, dados, podeEditar, recarregar }) => {
  const [linhas, setLinhas] = useState<RubricaProposta[]>(dados.rubricas);
  const [sujo, setSujo] = useState(false);
  const [gravando, setGravando] = useState(false);
  useEffect(() => { if (!sujo) setLinhas(dados.rubricas); }, [dados]);
  const mudar = (i: number, p: Partial<RubricaProposta>) => { setSujo(true); setLinhas(ls => ls.map((l, k) => (k === i ? { ...l, ...p } : l))); };
  const erros = useMemo(() => {
    const e: string[] = [];
    const nums = linhas.map(l => l.numero);
    if (new Set(nums).size !== nums.length) e.push('Há rubricas com o mesmo número.');
    linhas.forEach(l => {
      if (!l.descricao.trim()) e.push(`Rubrica ${l.numero}: falta a descrição.`);
      if (l.descontoGeral > l.valorPrevisto) e.push(`Rubrica ${l.numero}: o desconto é maior que o valor previsto.`);
      if (l.descontoGeral > 0 && !l.justificativa?.trim()) e.push(`Rubrica ${l.numero}: informe a justificativa do desconto.`);
    });
    return e;
  }, [linhas]);
  const total = linhas.reduce((s, l) => s + l.valorPrevisto, 0), totalVig = linhas.reduce((s, l) => s + valorVigente(l), 0);
  const gravar = async () => {
    setGravando(true);
    try { await salvarRubricasProposta(ano, linhas); setSujo(false); notify.success('Rubricas gravadas.'); recarregar(); }
    catch (e) { notify.fail('Erro ao gravar rubricas', e); } finally { setGravando(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Valor previsto de cada despesa para {ano}. O <b>desconto geral</b> reduz a rubrica para todas as OM (ex.: parte custeada por outra fonte) e exige justificativa. Descontos de uma OM específica ficam na aba Descontos.</p>
      {erros.length > 0 && <Aviso tom="red">{erros.map(e => <div key={e}>{e}</div>)}</Aviso>}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600"><tr>
            <th className="px-2 py-2">Nº</th><th className="px-2 text-left">Despesa</th><th className="px-2 text-left">Conta contábil</th><th className="px-2 text-right">Previsto {ano} (R$)</th>
            <th className="px-2 text-right">Desconto geral</th><th className="px-2 text-left">Justificativa</th><th className="px-2 text-right">Gasto {ano - 1}</th><th className="px-2 text-right">Variação</th><th className="px-2 text-right">Vigente</th><th></th>
          </tr></thead>
          <tbody>
            {linhas.map((l, i) => {
              const varia = l.gastoAnterior ? Math.round(((l.valorPrevisto - l.gastoAnterior) / l.gastoAnterior) * 10000) / 100 : null;
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-14 text-xs`} type="number" value={l.numero} onChange={e => mudar(i, { numero: Number(e.target.value) })} aria-label={`Número da rubrica ${i + 1}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-64 text-xs`} value={l.descricao} onChange={e => mudar(i, { descricao: e.target.value })} aria-label={`Descrição da rubrica ${l.numero}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-32 text-xs`} value={l.contaContabil || ''} onChange={e => mudar(i, { contaContabil: e.target.value })} aria-label={`Conta da rubrica ${l.numero}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-28 text-xs text-right`} inputMode="decimal" value={fmt(l.valorPrevisto)} onChange={e => mudar(i, { valorPrevisto: n2(e.target.value) ?? 0 })} aria-label={`Valor previsto da rubrica ${l.numero}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-24 text-xs text-right`} inputMode="decimal" value={fmt(l.descontoGeral) === '0' ? '' : fmt(l.descontoGeral)} placeholder="0" onChange={e => mudar(i, { descontoGeral: n2(e.target.value) ?? 0 })} aria-label={`Desconto geral da rubrica ${l.numero}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-48 text-xs`} value={l.justificativa || ''} onChange={e => mudar(i, { justificativa: e.target.value })} aria-label={`Justificativa do desconto da rubrica ${l.numero}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-28 text-xs text-right`} inputMode="decimal" value={fmt(l.gastoAnterior)} onChange={e => mudar(i, { gastoAnterior: n2(e.target.value) })} aria-label={`Gasto anterior da rubrica ${l.numero}`} /></td>
                  <td className={`px-2 text-right ${varia !== null && varia > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{pct(varia)}</td>
                  <td className="px-2 text-right font-semibold whitespace-nowrap">{brl(valorVigente(l))}</td>
                  <td className="px-1">{podeEditar && <button aria-label={`Excluir rubrica ${l.numero}`} className="text-slate-400 hover:text-red-600" onClick={() => { setSujo(true); setLinhas(ls => ls.filter((_, k) => k !== i)); }}><Trash2 size={14} /></button>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-slate-50 font-semibold"><tr><td colSpan={3} className="px-2 py-2">{linhas.length} rubricas</td><td className="px-2 text-right">{brl(total)}</td><td colSpan={4}></td><td className="px-2 text-right">{brl(totalVig)}</td><td></td></tr></tfoot>
        </table>
      </div>
      {podeEditar && <div className="flex gap-2">
        <Button variant="secondary" onClick={() => { setSujo(true); setLinhas(ls => [...ls, { numero: Math.max(0, ...ls.map(l => l.numero)) + 1, descricao: '', valorPrevisto: 0, descontoGeral: 0 }]); }}><Plus size={16} className="mr-1" />Rubrica</Button>
        <Button onClick={gravar} isLoading={gravando} disabled={!sujo || erros.length > 0}><Save size={16} className="mr-1" />Gravar rubricas</Button>
        {sujo && <span className="text-xs text-amber-700 self-center">Alterações não gravadas.</span>}
      </div>}
    </div>
  );
};

// ================================================================== Lotação e matriz
export const AbaLotacao: React.FC<AbaProps & { medias: Map<string, number> }> = ({ ano, dados, podeEditar, recarregar, medias }) => {
  type L = { lotacao: string; anterior: string; dias: string };
  const inicial = () => {
    const m: Record<string, L> = {};
    dados.lotacoes.forEach(l => { m[l.omId] = { lotacao: String(l.lotacao), anterior: l.lotacaoAnterior === null ? '' : String(l.lotacaoAnterior), dias: l.dias === null ? '' : String(l.dias) }; });
    return m;
  };
  const [lot, setLot] = useState<Record<string, L>>(inicial);
  const [matriz, setMatriz] = useState<Set<string>>(new Set(dados.matriz));
  const [sujo, setSujo] = useState(false);
  const [busca, setBusca] = useState('');
  const [so, setSo] = useState(true);
  const [gravando, setGravando] = useState(false);
  useEffect(() => { if (!sujo) { setLot(inicial()); setMatriz(new Set(dados.matriz)); } }, [dados]);
  const rubs = dados.rubricas.map(r => r.numero).sort((a, b) => a - b);
  const participa = (id: string) => rubs.some(r => matriz.has(`${r}|${id}`)) || !!lot[id]?.lotacao;
  const linhas = dados.oms.filter(o => o.ativo || lot[o.id])
    .filter(o => !so || participa(o.id))
    .filter(o => !busca || `${o.nome} ${o.sigla || ''}`.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => Number(a.tipo === 'NAVIO') - Number(b.tipo === 'NAVIO') || a.nome.localeCompare(b.nome));
  const set = (id: string, p: Partial<L>) => { setSujo(true); setLot(m => ({ ...m, [id]: { lotacao: '', anterior: '', dias: '', ...m[id], ...p } })); };
  const marcar = (r: number, id: string, v: boolean) => { setSujo(true); setMatriz(s => { const n = new Set(s); v ? n.add(`${r}|${id}`) : n.delete(`${r}|${id}`); return n; }); };
  const coluna = (r: number) => { const todos = linhas.every(o => matriz.has(`${r}|${o.id}`)); linhas.forEach(o => marcar(r, o.id, !todos)); };
  const semLotacao = [...new Set([...matriz].map(k => k.split('|')[1]))].filter(id => !(Number(lot[id]?.lotacao) > 0));
  const nomeDe = (id: string) => dados.oms.find(o => o.id === id)?.nome || id;

  const gravar = async () => {
    setGravando(true);
    try {
      const ls: Lotacao[] = Object.entries(lot).filter(([, v]) => Number(v.lotacao) > 0).map(([omId, v]) => ({ omId, lotacao: Number(v.lotacao), lotacaoAnterior: n2(v.anterior), dias: n2(v.dias) }));
      const removidas = dados.lotacoes.map(l => l.omId).filter(id => !ls.some(l => l.omId === id));
      await salvarLotacoes(ano, ls, removidas);
      await salvarMatriz(ano, matriz);
      setSujo(false); notify.success(`Lotação de ${ls.length} OM e matriz gravadas.`); recarregar();
    } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Lotação (TLA + DLA) de cada OM e as despesas de que ela participa (X). Peso no rateio = lotação × dias: OM de terra 30 dias; navio usa a média mensal trienal da classe (aba Média trienal) ou os dias informados aqui. Navios participam só da rubrica "Navios" (valor destinado às diárias).</p>
      {!rubs.length && <Aviso>Cadastre as rubricas primeiro (aba Rubricas ou "Importar proposta").</Aviso>}
      {semLotacao.length > 0 && <Aviso tom="red">Marcadas na matriz mas sem lotação (ficam fora do rateio): {semLotacao.map(nomeDe).join(', ')}.</Aviso>}
      <div className="flex flex-wrap gap-3 items-end">
        <Campo rotulo="Buscar OM"><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} /></Campo>
        <label className="text-sm flex items-center gap-2 pb-1.5"><input type="checkbox" checked={so} onChange={e => setSo(e.target.checked)} /> só participantes</label>
        {podeEditar && <Button onClick={gravar} isLoading={gravando} disabled={!sujo}><Save size={16} className="mr-1" />Gravar lotação e matriz</Button>}
        {sujo && <span className="text-xs text-amber-700 pb-1.5">Alterações não gravadas.</span>}
      </div>
      <div className="overflow-auto border border-slate-200 rounded-lg max-h-[62vh]">
        <table className="text-xs">
          <thead className="bg-slate-50 sticky top-0 z-10"><tr>
            <th className="px-2 py-1 text-left sticky left-0 bg-slate-50 min-w-[220px]">OM</th><th className="px-1">Lotação</th><th className="px-1">Lot. ant.</th><th className="px-1" title="Navio: vazio = média trienal da classe">Dias/mês</th>
            {rubs.map(r => <th key={r} className="w-6 text-center"><button disabled={!podeEditar} onClick={() => coluna(r)} title={dados.rubricas.find(x => x.numero === r)?.descricao} className="text-slate-600 hover:text-primary-700">{r}</button></th>)}
          </tr></thead>
          <tbody>
            {linhas.map(o => {
              const v = lot[o.id] || { lotacao: '', anterior: '', dias: '' };
              const navio = o.tipo === 'NAVIO';
              const media = navio && o.classeId ? medias.get(o.classeId) ?? 0 : 30;
              return (
                <tr key={o.id} className="border-t border-slate-100">
                  <td className="px-2 py-0.5 sticky left-0 bg-white truncate max-w-[220px]" title={o.nome}>{o.nome}{navio && <span className="text-slate-400"> · navio</span>}</td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right`} inputMode="numeric" value={v.lotacao} onChange={e => set(o.id, { lotacao: e.target.value })} aria-label={`Lotação de ${o.nome}`} /></td>
                  <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right`} inputMode="numeric" value={v.anterior} onChange={e => set(o.id, { anterior: e.target.value })} aria-label={`Lotação anterior de ${o.nome}`} /></td>
                  <td className="px-1">{navio ? <input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right`} inputMode="decimal" placeholder={fmt(media)} value={v.dias} onChange={e => set(o.id, { dias: e.target.value })} aria-label={`Dias de ${o.nome}`} /> : <span className="text-slate-400 px-2">30</span>}</td>
                  {rubs.map(r => <td key={r} className="text-center"><input type="checkbox" disabled={!podeEditar} checked={matriz.has(`${r}|${o.id}`)} onChange={e => marcar(r, o.id, e.target.checked)} aria-label={`${o.nome} participa da rubrica ${r}`} /></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">Clique no número da rubrica para marcar/desmarcar a coluna inteira (OMs visíveis).</p>
    </div>
  );
};

// ================================================================== Média trienal
export const AbaMedia: React.FC<AbaProps> = ({ ano, dados, podeEditar, recarregar }) => {
  const anos = [ano - 3, ano - 2, ano - 1];
  type C = { dias: string; navios: string };
  const inicial = () => {
    const m: Record<string, C> = {};
    dados.atracacaoAnual.forEach(a => { m[`${a.ano}|${a.classeId}`] = { dias: String(a.dias), navios: String(a.navios) }; });
    return m;
  };
  const [cel, setCel] = useState<Record<string, C>>(inicial);
  const [alterados, setAlterados] = useState<Set<string>>(new Set());
  const [pend, setPend] = useState<{ ano: number; classe: string; dias: number; navios: number | null }[]>([]);
  const [anoBnic, setAnoBnic] = useState(ano - 1);
  const [gravando, setGravando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!alterados.size) setCel(inicial()); }, [dados]);
  const classes = dados.classes.filter(c => c.ativo || anos.some(a => cel[`${a}|${c.id}`]));
  const navAtivos = (cid: string, a: number) => naviosAtivos(dados.oms, cid, a);
  const valor = (a: number, cid: string): C => cel[`${a}|${cid}`] || { dias: '', navios: String(navAtivos(cid, a)) };
  const set = (a: number, cid: string, p: Partial<C>) => {
    const k = `${a}|${cid}`;
    setCel(m => ({ ...m, [k]: { ...valor(a, cid), ...p } })); setAlterados(s => new Set(s).add(k));
  };
  const dadosAtuais: AnoClasse[] = classes.flatMap(c => anos.map(a => { const v = valor(a, c.id); return { ano: a, classeId: c.id, dias: Number(v.dias) || 0, navios: Number(v.navios) || 0 }; }));
  const medias: MediaClasse[] = mediaTrienal(dadosAtuais, ano, classes.map(c => c.id));

  const importar = async (f?: File) => {
    if (!f) return;
    try {
      const h = lerHistorico(lerAbas(await lerArquivo(f)));
      const sem: typeof pend = [];
      let n = 0;
      h.forEach(x => {
        const c = acharPorNome(x.classe, dados.classes);
        if (!c) { if (x.dias > 0) sem.push(x); return; }
        set(x.ano, c.id, { dias: String(x.dias), navios: String(x.navios ?? navAtivos(c.id, x.ano)) }); n++;
      });
      setPend(sem);
      const lidos = [...new Set(h.map(x => x.ano))].sort();
      notify.success(`Histórico lido: anos ${lidos.join(', ')}; ${n} classe(s)/ano ligadas${sem.length ? `; ${sem.length} sem classe no cadastro` : ''}. Confira e grave.`);
      const faltam = anos.filter(a => !lidos.includes(a));
      if (faltam.length) notify.error(`O arquivo não tem aba para ${faltam.join(', ')}. Informe esses anos à mão ou puxe do BNIC-35.`);
    } catch (e) { notify.fail('Erro ao ler o histórico', e); }
    if (ref.current) ref.current.value = '';
  };
  const puxarBnic = async () => {
    try {
      const m = await diasDoBnic35(anoBnic, dados.oms);
      if (!m.size) { notify.error(`Não há mapa de atracação (BNIC-35) realizado gravado em ${anoBnic}.`); return; }
      dados.classes.forEach(c => set(anoBnic, c.id, { dias: String(m.get(c.id) || 0), navios: String(navAtivos(c.id, anoBnic)) }));
      notify.success(`Dias de ${anoBnic} calculados pelos mapas BNIC-35 (${m.size} classe(s) com atracação). Confira e grave.`);
    } catch (e) { notify.fail('Erro ao ler os mapas', e); }
  };
  const gravar = async () => {
    setGravando(true);
    try {
      const linhas = [...alterados].map(k => { const [a, cid] = k.split('|'); const v = cel[k]; return { ano: Number(a), classeId: cid, dias: Number(v.dias) || 0, navios: Number(v.navios) || 0 }; });
      await salvarAtracacaoAnual(linhas, 'tela');
      setAlterados(new Set()); notify.success(`${linhas.length} registro(s) gravado(s).`); recarregar();
    } catch (e) { notify.fail('Erro ao gravar', e); } finally { setGravando(false); }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Para {ano}: em cada ano de {anos[0]} a {anos[2]}, dias atracados ("A") da classe ÷ navios da classe naquele ano; a soma ÷ 3 é a média anual e ÷ 12 a média mensal, que entra como "dias" do navio no rateio. Navios = ativos no cadastro (pode ajustar).</p>
      {podeEditar && <div className="flex flex-wrap gap-3 items-end">
        <input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" onChange={e => importar(e.target.files?.[0])} />
        <Button variant="secondary" onClick={() => ref.current?.click()}><FileUp size={16} className="mr-1" />Importar histórico trienal</Button>
        <Campo rotulo="Ano">
          <select className={entrada} value={anoBnic} onChange={e => setAnoBnic(Number(e.target.value))} aria-label="Ano a calcular pelos mapas">{anos.map(a => <option key={a}>{a}</option>)}</select>
        </Campo>
        <Button variant="secondary" onClick={puxarBnic}>Calcular pelos mapas BNIC-35</Button>
        <Button onClick={gravar} isLoading={gravando} disabled={!alterados.size}><Save size={16} className="mr-1" />Gravar ({alterados.size})</Button>
      </div>}
      {pend.length > 0 && <Aviso>
        <b>Classes do histórico não encontradas no cadastro</b> — escolha a classe correspondente:
        {pend.map((p, k) => (
          <div key={k} className="flex items-center gap-2 mt-1 text-xs">
            <span className="w-72 truncate">{p.ano} · {p.classe} ({p.dias} dias)</span>
            <select className={`${entrada} text-xs`} defaultValue="" aria-label={`Classe de ${p.classe} ${p.ano}`} onChange={e => { const cid = e.target.value; if (!cid) return; set(p.ano, cid, { dias: String(p.dias), navios: String(p.navios ?? navAtivos(cid, p.ano)) }); setPend(pend.filter((_, i) => i !== k)); }}>
              <option value="">escolher...</option>{dados.classes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
        ))}
      </Aviso>}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr><th rowSpan={2} className="px-2 text-left">Classe</th>{anos.map(a => <th key={a} colSpan={3} className="px-2 py-1 border-l border-slate-200">{a}</th>)}<th rowSpan={2} className="px-2 border-l border-slate-200">Total</th><th rowSpan={2} className="px-2">Média anual</th><th rowSpan={2} className="px-2">Média mensal</th></tr>
            <tr>{anos.map(a => <React.Fragment key={a}><th className="px-1 border-l border-slate-200">dias</th><th className="px-1">navios</th><th className="px-1">por navio</th></React.Fragment>)}</tr>
          </thead>
          <tbody>
            {classes.map(c => {
              const m = medias.find(x => x.classeId === c.id)!;
              return (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="px-2 py-0.5 max-w-[260px] truncate" title={c.nome}>{c.nome}</td>
                  {anos.map((a, i) => { const v = valor(a, c.id); return (
                    <React.Fragment key={a}>
                      <td className="px-1 border-l border-slate-100"><input disabled={!podeEditar} className={`${entrada} w-16 text-xs text-right ${alterados.has(`${a}|${c.id}`) ? 'bg-primary-50' : ''}`} inputMode="numeric" value={v.dias} onChange={e => set(a, c.id, { dias: e.target.value })} aria-label={`Dias ${c.nome} ${a}`} /></td>
                      <td className="px-1"><input disabled={!podeEditar} className={`${entrada} w-12 text-xs text-right`} inputMode="numeric" value={v.navios} onChange={e => set(a, c.id, { navios: e.target.value })} aria-label={`Navios ${c.nome} ${a}`} /></td>
                      <td className="px-1 text-right text-slate-600">{m.anos[i].porNavio || ''}</td>
                    </React.Fragment>
                  ); })}
                  <td className="px-2 text-right border-l border-slate-100">{m.total || ''}</td>
                  <td className="px-2 text-right">{m.mediaAnual || ''}</td>
                  <td className="px-2 text-right font-semibold">{m.mediaMensal || ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">A planilha antiga arredondava a média mensal para cima (ARREDONDAR.PARA.CIMA); o sistema usa duas casas decimais, como as abas de rateio da proposta.</p>
    </div>
  );
};

// ================================================================== Descontos por OM
export const AbaDescontos: React.FC<AbaProps & { resultado: ResultadoRateio }> = ({ ano, dados, podeEditar, recarregar, resultado }) => {
  const vazio: Desconto = { id: '', omId: null, rubrica: null, tipo: 'PERCENTUAL', valor: 0, justificativa: '' };
  const [novo, setNovo] = useState<Desconto>(vazio);
  const [valorTxt, setValorTxt] = useState('');
  const [gravando, setGravando] = useState(false);
  const participantes = resultado.oms;
  const nomeOM = (id: string | null) => dados.oms.find(o => o.id === id)?.nome || '—';
  const efeito = (d: Desconto) => {
    const o = resultado.oms.find(x => x.omId === d.omId);
    if (!o) return null;
    if (d.rubrica === null) return o.anualBruto - o.anual;
    return o.parcelas.find(p => p.rubrica === d.rubrica)?.desconto ?? 0;
  };
  const erro = !novo.omId ? 'Escolha a OM.' : !(Number(n2(valorTxt)) > 0) ? 'Informe o valor.' : novo.tipo === 'PERCENTUAL' && Number(n2(valorTxt)) > 100 ? 'Percentual acima de 100%.' : !novo.justificativa.trim() ? 'A justificativa é obrigatória.' : '';
  const gravar = async () => {
    setGravando(true);
    try { await salvarDesconto(ano, { ...novo, valor: Number(n2(valorTxt)) }); setNovo(vazio); setValorTxt(''); notify.success('Desconto gravado.'); recarregar(); }
    catch (e) { notify.fail('Erro ao gravar desconto', e); } finally { setGravando(false); }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">Desconto concedido a uma OM (ex.: SecNSNQ — parte do edifício mantida pela própria OM), numa rubrica ou no total da taxa. O valor descontado não é redistribuído às demais OM. Desconto que vale para todas as OM fica na aba Rubricas (desconto geral).</p>
      {podeEditar && (
        <div className="flex flex-wrap gap-2 items-end p-3 rounded-lg border border-slate-200 bg-slate-50">
          <Campo rotulo="OM"><select className={entrada} value={novo.omId || ''} onChange={e => setNovo({ ...novo, omId: e.target.value || null })} aria-label="OM do desconto">
            <option value="">escolher...</option>{participantes.map(o => <option key={o.omId} value={o.omId}>{o.nome}</option>)}
          </select></Campo>
          <Campo rotulo="Aplicar em"><select className={entrada} value={novo.rubrica ?? ''} onChange={e => setNovo({ ...novo, rubrica: e.target.value ? Number(e.target.value) : null })} aria-label="Rubrica do desconto">
            <option value="">Total da taxa da OM</option>{dados.rubricas.map(r => <option key={r.numero} value={r.numero}>{r.numero} – {r.descricao}</option>)}
          </select></Campo>
          <Campo rotulo="Tipo"><select className={entrada} value={novo.tipo} onChange={e => setNovo({ ...novo, tipo: e.target.value as Desconto['tipo'] })} aria-label="Tipo do desconto"><option value="PERCENTUAL">%</option><option value="VALOR">R$ (anual)</option></select></Campo>
          <Campo rotulo={novo.tipo === 'PERCENTUAL' ? 'Percentual' : 'Valor anual (R$)'}><input className={`${entrada} w-28 text-right`} inputMode="decimal" value={valorTxt} onChange={e => setValorTxt(e.target.value)} aria-label="Valor do desconto" /></Campo>
          <Campo rotulo="Justificativa" className="flex-1 min-w-[220px]"><input className={`${entrada} w-full`} value={novo.justificativa} onChange={e => setNovo({ ...novo, justificativa: e.target.value })} aria-label="Justificativa do desconto" /></Campo>
          <Button onClick={gravar} isLoading={gravando} disabled={!!erro} title={erro}><Plus size={16} className="mr-1" />Adicionar</Button>
          {erro && <span className="text-xs text-slate-500 w-full">{erro}</span>}
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600 text-xs"><tr><th className="px-2 py-2 text-left">OM</th><th className="px-2 text-left">Aplicado em</th><th className="px-2 text-right">Desconto</th><th className="px-2 text-right">Efeito no ano</th><th className="px-2 text-left">Justificativa</th><th></th></tr></thead>
        <tbody>
          {dados.descontos.map(d => (
            <tr key={d.id} className="border-t border-slate-100">
              <td className="px-2 py-1.5">{nomeOM(d.omId)}</td>
              <td className="px-2">{d.rubrica === null ? 'Total da taxa' : `${d.rubrica} – ${dados.rubricas.find(r => r.numero === d.rubrica)?.descricao || ''}`}</td>
              <td className="px-2 text-right">{d.tipo === 'PERCENTUAL' ? pct(d.valor) : brl(d.valor)}</td>
              <td className="px-2 text-right">{efeito(d) === null ? <span className="text-amber-700 text-xs">OM fora do rateio</span> : brl(efeito(d)!)}</td>
              <td className="px-2 text-xs text-slate-600">{d.justificativa}</td>
              <td className="px-2">{podeEditar && <button aria-label="Excluir desconto" className="text-slate-400 hover:text-red-600" onClick={async () => { try { await excluirDesconto(d.id); recarregar(); } catch (e) { notify.fail('Erro ao excluir', e); } }}><Trash2 size={14} /></button>}</td>
            </tr>
          ))}
          {!dados.descontos.length && <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400">Nenhum desconto por OM.</td></tr>}
        </tbody>
      </table>
    </div>
  );
};


