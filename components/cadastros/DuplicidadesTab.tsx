import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, GitMerge, RefreshCw, XCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { cadastroService } from '../../services/cadastroService';
import { db } from '../../services/db';
import { notify } from '../../utils/notify';
import { GrupoDup, chavePar, gruposDuplicados, paresDuplicados, sugerirManter } from '../../utils/duplicidades';
import { DadosCadastro } from './useCadastros';

/**
 * Clientes cadastrados mais de uma vez (código diferente, nome abreviado, cortado ou com pequena diferença) e
 * desativados que têm um correspondente ativo. Unificar passa faturas, ALTCRED, preços, medições, lotação etc. para a
 * OM escolhida, guarda o outro nome como "nome alternativo" e desativa a duplicada (nada é apagado).
 */
export const DuplicidadesTab: React.FC<{ dados: DadosCadastro; podeEditar: boolean; recarregar: () => Promise<void> | void }> = ({ dados, podeEditar, recarregar }) => {
  const [ignorados, setIgnorados] = useState<Set<string>>(new Set());
  const [faturas, setFaturas] = useState<Map<string, number>>(new Map());
  const [manter, setManter] = useState<Record<number, string>>({});
  const [marcados, setMarcados] = useState<Record<number, Set<string>>>({});
  const [trabalhando, setTrabalhando] = useState<number | null>(null);
  const [mostrarFracos, setMostrarFracos] = useState(false);

  useEffect(() => {
    cadastroService.listarNaoDuplicadas().then(setIgnorados);
    db.getInvoices().then(invs => { const m = new Map<string, number>(); invs.forEach(i => { if (i.omId) m.set(i.omId, (m.get(i.omId) || 0) + 1); }); setFaturas(m); }).catch(() => undefined);
  }, []);

  const grupos = useMemo(() => gruposDuplicados(paresDuplicados(dados.oms, ignorados)), [dados.oms, ignorados]);
  const visiveis = grupos.filter(g => mostrarFracos || g.pontos >= 85);
  const escolhida = (k: number, g: GrupoDup) => manter[k] ?? g.membros.reduce((a, b) => (sugerirManter(a, b, faturas) === 'a' ? a : b)).id;
  const unificar = (k: number, g: GrupoDup) => marcados[k] ?? new Set(g.pontos >= 85 ? g.membros.map(m => m.id) : []);
  const cmd = new Map(dados.comandos.map(c => [c.id, c]));

  const executar = async (k: number, g: GrupoDup) => {
    const alvo = escolhida(k, g);
    const outros = g.membros.filter(m => m.id !== alvo && unificar(k, g).has(m.id));
    if (!outros.length) { notify.error('Marque ao menos uma OM para unificar.'); return; }
    const nomeAlvo = g.membros.find(m => m.id === alvo)!.nome;
    if (!window.confirm(`Unificar em "${nomeAlvo}":\n\n${outros.map(o => `• ${o.codigo} – ${o.nome}`).join('\n')}\n\nFaturas, ALTCRED, preços, medições, lotação e demais registros dessas OM passam para "${nomeAlvo}". Os nomes delas ficam guardados como nomes alternativos e elas são desativadas (nada é apagado). Continuar?`)) return;
    setTrabalhando(k);
    try {
      let movidos = 0;
      for (const o of outros) movidos += await cadastroService.unificarOMs(alvo, o.id);
      notify.success(`${outros.length} cadastro(s) unificado(s) em ${nomeAlvo}; ${movidos} registro(s) transferido(s).`);
      db.invalidateCache();
      await recarregar();
    } catch (e) { notify.fail('Erro ao unificar (o script 012 foi executado?)', e); } finally { setTrabalhando(null); }
  };
  const naoSao = async (g: GrupoDup) => {
    try {
      const pares = g.pares.map(p => chavePar(p.a.id, p.b.id));
      await cadastroService.marcarNaoDuplicadas(pares);
      setIgnorados(s => new Set([...s, ...pares]));
      notify.success('Marcado: não são a mesma OM. Não aparecerão mais aqui.');
    } catch (e) { notify.fail('Erro ao gravar (o script 012 foi executado?)', e); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-slate-600 max-w-3xl">
          Clientes que parecem ser o mesmo: mesmo nome com diferença de acento/edifício, mesma sigla, sigla × nome por extenso, nome cortado ou com códigos diferentes.
          Escolha qual cadastro <b>fica</b> e marque os que serão <b>unificados</b> nele. Tudo o que estava nos outros (faturas, ALTCRED, preços, lotação...) passa para o que fica;
          os nomes antigos ficam como nomes alternativos (as importações passam a reconhecê-los) e os cadastros unificados são desativados.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={mostrarFracos} onChange={e => setMostrarFracos(e.target.checked)} /> mostrar também os menos prováveis</label>
          <Button size="sm" variant="ghost" onClick={() => cadastroService.listarNaoDuplicadas().then(setIgnorados)}><RefreshCw size={14} className="mr-1" />Atualizar</Button>
        </div>
      </div>
      <div className="text-sm text-slate-700"><b>{visiveis.length}</b> grupo(s) {mostrarFracos ? '' : `prováveis (${grupos.length - visiveis.length} menos prováveis ocultos)`}</div>
      {!visiveis.length && <div className="p-6 text-center text-emerald-700 flex items-center justify-center gap-2"><CheckCircle2 size={18} />Nenhuma duplicidade encontrada.</div>}
      {visiveis.map(g => {
        const k = grupos.indexOf(g);
        const alvo = escolhida(k, g), marc = unificar(k, g);
        return (
          <div key={g.membros.map(m => m.id).join()} className={`border rounded-xl p-3 ${g.pontos >= 85 ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200'}`}>
            <div className="text-xs text-slate-600 mb-2"><b>{g.pontos >= 95 ? 'Muito provável' : g.pontos >= 85 ? 'Provável' : 'Possível'}</b> · {g.motivos.join(' · ')}</div>
            <table className="w-full text-sm">
              <thead className="text-[11px] text-slate-500"><tr><th className="text-left w-16">Fica</th><th className="text-left w-20">Unificar</th><th className="text-left">Código</th><th className="text-left">Nome</th><th className="text-left">Comando</th><th className="text-right">Faturas</th><th className="text-left">Situação</th></tr></thead>
              <tbody>
                {g.membros.map(m => {
                  const om = dados.oms.find(o => o.id === m.id);
                  return (
                    <tr key={m.id} className={`border-t border-slate-100 ${m.id === alvo ? 'font-semibold' : ''}`}>
                      <td><input type="radio" name={`manter-${k}`} disabled={!podeEditar} checked={m.id === alvo} onChange={() => setManter({ ...manter, [k]: m.id })} aria-label={`Manter ${m.nome} (${m.codigo})`} /></td>
                      <td>{m.id !== alvo && <input type="checkbox" disabled={!podeEditar} checked={marc.has(m.id)} onChange={e => { const n = new Set(marc); e.target.checked ? n.add(m.id) : n.delete(m.id); setMarcados({ ...marcados, [k]: n }); }} aria-label={`Unificar ${m.nome} (${m.codigo})`} />}</td>
                      <td className="font-mono">{m.codigo}</td>
                      <td>{m.nome}{m.sigla ? <span className="text-slate-500 font-normal"> · {m.sigla}</span> : ''}</td>
                      <td className="text-xs text-slate-600">{om?.comandoId ? cmd.get(om.comandoId)?.nome : '—'}</td>
                      <td className="text-right tabular-nums">{faturas.get(m.id) || 0}</td>
                      <td className="text-xs">{m.ativo ? <span className="text-emerald-700">ativa</span> : <span className="text-slate-500">desativada</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {podeEditar && <div className="flex flex-wrap gap-2 mt-2">
              <Button size="sm" onClick={() => executar(k, g)} isLoading={trabalhando === k}><GitMerge size={14} className="mr-1" />Unificar marcadas na que fica</Button>
              <Button size="sm" variant="ghost" onClick={() => naoSao(g)}><XCircle size={14} className="mr-1" />Não são a mesma OM</Button>
            </div>}
          </div>
        );
      })}
    </div>
  );
};
