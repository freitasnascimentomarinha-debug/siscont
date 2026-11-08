import { numeroDigitado } from '../../utils/numeroDigitado';
import React, { useEffect, useMemo, useState } from 'react';
import { obterNormas } from '../../utils/normas';
import { Copy, Save } from 'lucide-react';
import { ContextoFaturamento, listarPrecos, salvarPrecos } from '../../services/faturamentoService';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Aviso, Campo, brl, entrada } from './comum';

type Valores = Record<string, string>; // chave = omId ou '' (valor geral)
const r2 = (n: number) => Math.round(n * 100) / 100;
const parse = (s: string) => numeroDigitado(s);
const fmt = (n: number) => String(n).replace('.', ',');

export const PrecosTab: React.FC<{ ctx: ContextoFaturamento; podeEditar: boolean; comp: string; setComp: (c: string) => void }> = ({ ctx, podeEditar, comp, setComp }) => {
  // o ano dos preços acompanha a competência escolhida (as outras abas usam a mesma)
  const ano = Number(comp.slice(0, 4)) || new Date().getFullYear();
  const [anoTxt, setAnoTxt] = useState(String(ano));
  useEffect(() => { setAnoTxt(String(ano)); }, [ano]);
  const setAno = (t: string) => { setAnoTxt(t); const a = Number(t); if (/^\d{4}$/.test(t) && a >= 2000 && a <= 2100) setComp(`${a}-${comp.slice(5, 7) || '01'}`); };
  const [sigla, setSigla] = useState('TC');
  const [vals, setVals] = useState<Valores>({});
  const [salvo, setSalvo] = useState<Valores>({});
  const [reajuste, setReajuste] = useState('0');
  const [gravando, setGravando] = useState(false);
  const [busca, setBusca] = useState('');

  const carregar = async () => {
    try {
      const ps = (await listarPrecos([ano])).filter(p => p.sigla === sigla);
      const v: Valores = {};
      ps.forEach(p => { v[p.omId ?? ''] = fmt(p.valor); });
      setVals(prev => ({ ...v, ...prev })); setSalvo(v); // preserva o que foi digitado durante a carga
    } catch (e) { notify.fail('Erro ao carregar os preços', e); }
  };
  useEffect(() => { setVals({}); setSalvo({}); carregar(); }, [ano, sigla]);

  const porOm = sigla === 'TC' || sigla === 'DA';
  // TC e diária: calculadas e publicadas SÓ pela página Taxa condominial e diárias; aqui é só consulta
  const daTaxa = porOm;
  const editavel = podeEditar && !daTaxa;
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
        <Campo rotulo="Ano"><input className={`${entrada} w-24`} type="number" value={anoTxt} onChange={e => setAno(e.target.value)} aria-label="Ano dos preços" /></Campo>
        <Campo rotulo="Serviço">
          <select className={entrada} value={sigla} onChange={e => setSigla(e.target.value)} aria-label="Serviço dos preços">{ctx.servicos.map(s => <option key={s.sigla} value={s.sigla}>{s.sigla} — {s.nome}</option>)}</select>
        </Campo>
        <Campo rotulo="Buscar OM"><input className={entrada} value={busca} onChange={e => setBusca(e.target.value)} /></Campo>
        {editavel && <>
          <Campo rotulo="Reajuste (%)"><input className={`${entrada} w-20`} value={reajuste} onChange={e => setReajuste(e.target.value)} /></Campo>
          <Button variant="secondary" onClick={copiarAnterior}><Copy size={16} className="mr-2" />Copiar de {ano - 1}</Button>
          <Button onClick={gravar} isLoading={gravando} disabled={!alterados.length}><Save size={16} className="mr-2" />Gravar ({alterados.length})</Button>
        </>}
      </div>
      {daTaxa
        ? <Aviso tom="slate"><b>{sigla === 'TC' ? 'Taxa condominial' : 'Diária de atracação'}: só consulta.</b> Estes valores são calculados na página <b>Taxa condominial e diárias</b> e gravados aqui quando você clica em <b>Publicar</b> lá. Para incluir, excluir ou alterar o valor de uma OM, ajuste a proposta e publique de novo. O lote usa sempre o que está publicado aqui.</Aviso>
        : <Aviso tom="slate">Valores dos demais serviços: confira, ajuste, copie do ano anterior e grave. O lote usa sempre o que está gravado aqui. (TC e diária são publicadas pela página <b>Taxa condominial e diárias</b>.)</Aviso>}
      {porOm && <Aviso tom="slate">{sigla === 'TC' ? `Soma mensal: ${brl(total)} · anual: ${brl(total * 12)}.` : `Diária de cada navio no ano (${obterNormas().anexoDiaria}: lotação × média trienal da classe).`} OM sem valor não recebe fatura deste serviço.</Aviso>}
      {!porOm && (
        <div className="p-3 rounded-lg border border-slate-200 bg-white flex items-center gap-3 text-sm">
          <span className="font-semibold">Valor geral do serviço {sigla} em {ano}:</span>
          <input disabled={!editavel} className={`${entrada} w-36 text-right`} value={vals[''] ?? ''} onChange={e => setVals({ ...vals, '': e.target.value })} aria-label="Valor geral" />
          <span className="text-xs text-slate-500">Usado quando a medição não traz o valor em R$ (quantidade × valor). Abaixo, valores próprios de alguma OM, se houver.</span>
        </div>
      )}
      <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[60vh] overflow-y-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 sticky top-0"><tr><th className="px-2 py-2 text-left">OM</th><th className="px-2 py-2 text-right">{rotulo}</th>{sigla === 'TC' && <th className="px-2 py-2 text-right">Anual</th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lista.map(o => (
              <tr key={o.id} className={vals[o.id] !== salvo[o.id] ? 'bg-primary-50/40' : ''}>
                <td className="px-2 py-1">{o.codigo} · {o.nome}<span className="text-[11px] text-slate-500"> {o.setor}</span></td>
                <td className="px-2 py-1 text-right">{daTaxa ? <span className="tabular-nums" aria-label={`${sigla} ${o.nome}`}>{parse(vals[o.id] ?? '') !== null ? brl(parse(vals[o.id])!) : <span className="text-slate-400">—</span>}</span>
                  : <input disabled={!editavel} aria-label={`${sigla} ${o.nome}`} className="w-32 text-right border border-slate-200 rounded px-1 py-0.5" value={vals[o.id] ?? ''} onChange={e => setVals({ ...vals, [o.id]: e.target.value })} />}</td>
                {sigla === 'TC' && <td className="px-2 py-1 text-right tabular-nums text-slate-500">{parse(vals[o.id] ?? '') ? brl((parse(vals[o.id])! * 12)) : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
