import React, { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../ui/Button';
import { Aviso, brl, entrada } from '../faturamento/comum';
import { notify } from '../../utils/notify';
import { DadosProposta, salvarRubricasProposta } from '../../services/taxaCondominialService';

const entraNaTaxa = (r: { destino?: string }) => r.destino === 'TC' || r.destino === 'OG';

/**
 * Responsáveis pelas rubricas: quem envia o subsídio e a atualização de cada uma. Mostra quem ainda não mandou
 * (rubricas sem subsídio) e agrupa por responsável, para cobrar de uma vez só.
 */
export const AbaResponsaveis: React.FC<{ ano: number; dados: DadosProposta; podeEditar: boolean; recarregar: () => void }> = ({ ano, dados, podeEditar, recarregar }) => {
  const rubricas = useMemo(() => dados.rubricas.filter(entraNaTaxa).sort((a, b) => a.numero - b.numero), [dados.rubricas]);
  const inicial = () => Object.fromEntries(rubricas.map(r => [r.numero, r.responsavel || '']));
  const [resp, setResp] = useState<Record<number, string>>(inicial);
  const inicialZero = () => Object.fromEntries(rubricas.map(r => [r.numero, !!r.zeroConfirmado]));
  const [zero, setZero] = useState<Record<number, boolean>>(inicialZero);
  const [sujo, setSujo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [filtro, setFiltro] = useState<'TODAS' | 'PENDENTES'>('TODAS');
  useEffect(() => { if (!sujo) { setResp(inicial()); setZero(inicialZero()); } }, [dados]);

  const semSub = (n: number) => !dados.subsidios.some(s => s.rubrica === n) && !zero[n]; // pendência de verdade: sem subsídio e sem "sem orçamento"
  const nomeResp = (n: number) => (resp[n] || '').trim();
  const grupos = useMemo(() => {
    const m = new Map<string, number[]>();
    rubricas.forEach(r => { const k = (resp[r.numero] || '').trim() || '(sem responsável)'; m.set(k, [...(m.get(k) || []), r.numero]); });
    return [...m.entries()].map(([nome, nums]) => ({ nome, nums, pendentes: nums.filter(semSub) })).sort((a, b) => b.pendentes.length - a.pendentes.length || a.nome.localeCompare(b.nome));
  }, [rubricas, resp, dados.subsidios]);
  const lista = rubricas.filter(r => filtro === 'TODAS' || semSub(r.numero));
  const semResp = rubricas.filter(r => !nomeResp(r.numero));

  const gravar = async () => {
    setGravando(true);
    try {
      const mudadas = rubricas.filter(r => (r.responsavel || '') !== nomeResp(r.numero) || !!r.zeroConfirmado !== !!zero[r.numero])
        .map(r => ({ ...r, responsavel: nomeResp(r.numero) || null, zeroConfirmado: !!zero[r.numero], ...(zero[r.numero] ? { valorPrevisto: 0, valorModo: 'DIGITADO' as const } : {}) }));
      if (mudadas.length) await salvarRubricasProposta(ano, mudadas);
      setSujo(false); notify.success(`Responsáveis gravados (${mudadas.length} rubrica(s) alterada(s)).`); recarregar();
    } catch (e) { notify.fail('Erro ao gravar os responsáveis', e); } finally { setGravando(false); }
  };

  return (
    <div className="space-y-4" data-testid="aba-responsaveis">
      <p className="text-xs text-slate-500">Quem envia o subsídio e a atualização de cada rubrica em {ano}. A lista vem do ano anterior; corrija o que mudou e grave. Rubricas <b>sem subsídio</b> mostram quem ainda precisa enviar; se a rubrica não terá orçamento este ano, marque <b>Sem orçamento</b> e ela deixa de ser pendência.</p>
      {semResp.length > 0 && <Aviso tom="amber">{semResp.length} rubrica(s) sem responsável: {semResp.map(r => r.numero).join(', ')}.</Aviso>}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-3 py-1.5 bg-slate-50 text-xs font-semibold text-slate-600">Por responsável (quem tem pendência vem primeiro)</div>
        <table className="w-full text-xs">
          <thead className="text-slate-500"><tr><th className="text-left px-3 py-1">Responsável</th><th className="text-left px-2">Rubricas</th><th className="text-left px-2">Aguardando subsídio</th></tr></thead>
          <tbody>
            {grupos.map(g => (
              <tr key={g.nome} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1 font-semibold">{g.nome}</td>
                <td className="px-2 py-1">{g.nums.join(', ')}</td>
                <td className="px-2 py-1">{g.pendentes.length ? <span className="px-1.5 rounded bg-amber-100 text-amber-800 font-semibold">{g.pendentes.join(', ')}</span> : <span className="text-emerald-700">tudo enviado</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {(['TODAS', 'PENDENTES'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)} className={`px-2.5 py-1 rounded-full border ${filtro === f ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>{f === 'TODAS' ? 'Todas as rubricas' : 'Só pendentes (aguardando subsídio)'}</button>
        ))}
        <span className="flex-1" />
        {sujo && <span className="text-amber-700">Alterações não gravadas.</span>}
        {podeEditar && <Button onClick={gravar} isLoading={gravando} disabled={!sujo}><Save size={16} className="mr-1" />Gravar responsáveis</Button>}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-600"><tr><th className="px-2 py-2 text-center w-10">Nº</th><th className="px-2 text-left">Despesa</th><th className="px-2 text-left">Responsável</th><th className="px-2 text-right">Valor {ano}</th><th className="px-2 text-left">Situação do subsídio</th></tr></thead>
          <tbody>
            {lista.map(r => (
              <tr key={r.numero} className="border-t border-slate-100">
                <td className="px-2 py-1 text-center text-slate-600">{r.numero}</td>
                <td className="px-2 py-1">{r.descricao}</td>
                <td className="px-2 py-1"><input disabled={!podeEditar} className={`${entrada} w-64 text-xs`} placeholder="posto (setor) nome" value={resp[r.numero] ?? ''} onChange={e => { setSujo(true); setResp(m => ({ ...m, [r.numero]: e.target.value })); }} aria-label={`Responsável pela rubrica ${r.numero}`} /></td>
                <td className="px-2 py-1 text-right tabular-nums">{brl(zero[r.numero] ? 0 : r.valorPrevisto)}</td>
                <td className="px-2 py-1">{dados.subsidios.some(s => s.rubrica === r.numero)
                  ? <span className="text-emerald-700">recebido ({dados.subsidios.filter(s => s.rubrica === r.numero).length})</span>
                  : <select disabled={!podeEditar} className={`${entrada} text-xs`} value={zero[r.numero] ? 'ZERO' : 'AGUARDA'} aria-label={`Situação da rubrica ${r.numero}`}
                      onChange={e => { setSujo(true); setZero(m => ({ ...m, [r.numero]: e.target.value === 'ZERO' })); }}>
                      <option value="AGUARDA">Aguardando subsídio</option><option value="ZERO">Sem orçamento em {ano} (valor zero)</option></select>}</td>
              </tr>
            ))}
            {!lista.length && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">Todas as rubricas têm subsídio.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};
