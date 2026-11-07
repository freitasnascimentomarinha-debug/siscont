import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Link2, Plus, RotateCcw, Wrench } from 'lucide-react';
import { Button } from '../ui/Button';
import { cadastroService } from '../../services/cadastroService';
import { notify } from '../../utils/notify';
import { lerAbas } from '../../utils/taxaCondominialImport';
import { NavioLista, compararNavios, lerListaNavios } from '../../utils/listaNavios';
import { ClienteModal } from '../taxa/ClienteModal';
import { DadosCadastro } from './useCadastros';

const ler = (f: File) => new Promise<ArrayBuffer>((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result as ArrayBuffer); r.onerror = () => erro(r.error); r.readAsArrayBuffer(f); });

/**
 * Confere a aba LISTA DE NAVIOS do Histórico Trienal com o cadastro: classes que faltam, navios que faltam, navios com
 * classe diferente e navios ativos que não estão na lista. Cada diferença tem uma ação (criar, ligar, corrigir).
 * A classe do navio é o que liga o navio à média trienal (dias atracados) da taxa condominial e das diárias.
 */
export const ListaNaviosTab: React.FC<{ dados: DadosCadastro; podeEditar: boolean; recarregar: () => Promise<void> | void }> = ({ dados, podeEditar, recarregar }) => {
  const [lista, setLista] = useState<NavioLista[] | null>(null);
  const [arquivo, setArquivo] = useState('');
  const [ligar, setLigar] = useState<NavioLista | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const cmp = useMemo(() => (lista ? compararNavios(lista, dados.oms, dados.classes) : null), [lista, dados.oms, dados.classes]);
  const classePorNome = (nome: string) => dados.classes.find(c => c.nome.trim().toLowerCase() === nome.trim().toLowerCase());

  const abrir = async (f?: File) => {
    if (!f) return;
    try {
      const l = lerListaNavios(lerAbas(await ler(f)));
      if (!l.length) { notify.error('Não encontrei a aba LISTA DE NAVIOS (colunas CLASSE NAVIO e NAVIO).'); return; }
      setLista(l); setArquivo(f.name);
    } catch (e) { notify.fail('Erro ao ler a planilha', e); }
    if (ref.current) ref.current.value = '';
  };
  const executar = async (rotulo: string, f: () => Promise<number | void>) => {
    setTrabalhando(true);
    try { const n = await f(); notify.success(`${rotulo}${typeof n === 'number' ? `: ${n}` : ''}.`); await recarregar(); }
    catch (e) { notify.fail(`Erro: ${rotulo}`, e); } finally { setTrabalhando(false); }
  };
  const criarClasses = (nomes: string[]) => executar('Classes criadas', async () => { for (const n of nomes) await cadastroService.saveClasse({ nome: n.trim(), ativo: true }); return nomes.length; });
  const criarNavios = (itens: NavioLista[]) => executar('Navios incluídos no cadastro', async () => {
    let n = 0;
    for (const it of itens) {
      const cl = classePorNome(it.classe);
      await cadastroService.criarOM({ nome: it.navio!, tipo: 'NAVIO', classeId: cl?.id ?? null, ativo: true, lotacao: it.lotacao ?? null, observacao: 'Incluído pela lista de navios do Histórico Trienal — completar código (UG) e comando' });
      n++;
    }
    return n;
  });
  const reativar = (itens: { navio: { id: string } }[]) => executar('Navios reativados', async () => {
    let n = 0;
    for (const it of itens) {
      const om = dados.oms.find(o => o.id === it.navio.id);
      if (om && !om.ativo) { await cadastroService.saveOM({ ...om, ativo: true, desativadoEm: null, motivoDesativacao: null }); n++; }
    }
    return n;
  });
  const corrigirClasses = (itens: { navio: { id: string }; classeLista: { id: string } | null }[]) => executar('Classes corrigidas', async () => {
    let n = 0;
    for (const it of itens) {
      const om = dados.oms.find(o => o.id === it.navio.id);
      if (om && it.classeLista) { await cadastroService.saveOM({ ...om, classeId: it.classeLista.id }); n++; }
    }
    return n;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <div className="flex-1 min-w-[260px] text-sm text-slate-600">
          <p className="font-semibold text-slate-800">Conferir com a lista de navios do Histórico Trienal</p>
          <p>Selecione a planilha <b>Histórico Trienal</b> (aba <b>LISTA DE NAVIOS</b>; a aba DIARIAS completa lotação e diária, se houver). O sistema mostra o que falta ou está diferente no cadastro. A classe do navio é o que liga o navio à média trienal usada na taxa condominial e nas diárias.</p>
        </div>
        <input ref={ref} type="file" accept=".xlsx,.xls,.ods" className="hidden" aria-label="Planilha do histórico trienal" onChange={e => abrir(e.target.files?.[0])} />
        <Button onClick={() => ref.current?.click()}><FileUp size={16} className="mr-2" />Selecionar planilha</Button>
      </div>

      {cmp && lista && <>
        <div className="text-sm text-slate-700"><b>{arquivo}</b>: {lista.filter(x => x.navio).length} navios em {new Set(lista.map(x => x.classe)).size} classes.
          {' '}<span className="text-emerald-700">{cmp.conferem.length} conferem</span> · {cmp.classesNovas.length} classe(s) a criar · {cmp.naviosNovos.length} navio(s) fora do cadastro · {cmp.classeDiferente.length} com classe diferente · {cmp.foraDaLista.length} ativo(s) no cadastro fora da lista · <span className="text-amber-700">{cmp.desativadosNaLista.length} desativado(s) que estão na lista</span> · {cmp.desativadosForaDaLista.length} desativado(s) fora da lista.</div>

        {cmp.desativadosNaLista.length > 0 && (
          <section className="border border-emerald-200 bg-emerald-50/40 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><h4 className="font-semibold">Navios desativados que constam na lista trienal</h4>
              {podeEditar && <Button size="sm" onClick={() => reativar(cmp.desativadosNaLista)} isLoading={trabalhando}><RotateCcw size={14} className="mr-1" />Reativar todos ({cmp.desativadosNaLista.length})</Button>}</div>
            <p className="text-xs text-slate-500 mb-2">Estão na lista, portanto não foram desativados fisicamente. Os desativados que <b>não</b> estão na lista continuam desativados ({cmp.desativadosForaDaLista.length}).</p>
            <table className="w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left">Navio</th><th className="text-left">Classe na lista</th><th className="text-left">Desativado em</th><th className="text-left">Motivo</th><th></th></tr></thead>
              <tbody>{cmp.desativadosNaLista.map(x => {
                const om = dados.oms.find(o => o.id === x.navio.id);
                return (
                  <tr key={x.navio.id} className="border-t border-emerald-100">
                    <td className="py-1">{x.navio.nome}</td><td>{x.lista.classe}</td><td>{om?.desativadoEm || ''}</td><td>{om?.motivoDesativacao || ''}</td>
                    <td className="text-right">{podeEditar && <button className="text-primary-700 underline" onClick={() => reativar([x])}>reativar</button>}</td>
                  </tr>);
              })}</tbody>
            </table>
          </section>
        )}

        {cmp.classesNovas.length > 0 && (
          <section className="border border-amber-200 bg-amber-50/40 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2"><h4 className="font-semibold">1. Classes da lista que não existem no cadastro</h4>
              {podeEditar && <Button size="sm" onClick={() => criarClasses(cmp.classesNovas)} isLoading={trabalhando}><Plus size={14} className="mr-1" />Criar todas ({cmp.classesNovas.length})</Button>}</div>
            <div className="flex flex-wrap gap-1">{cmp.classesNovas.map(c => <span key={c} className="text-xs px-2 py-1 rounded-full bg-white border border-amber-200">{c}</span>)}</div>
          </section>
        )}

        {cmp.naviosNovos.length > 0 && (
          <section className="border border-amber-200 bg-amber-50/40 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap"><h4 className="font-semibold">2. Navios da lista que não estão no cadastro</h4>
              {podeEditar && <Button size="sm" onClick={() => criarNavios(cmp.naviosNovos)} isLoading={trabalhando} disabled={cmp.classesNovas.length > 0} title={cmp.classesNovas.length ? 'Crie as classes primeiro (item 1)' : undefined}><Plus size={14} className="mr-1" />Incluir todos ({cmp.naviosNovos.length})</Button>}</div>
            <p className="text-xs text-slate-500 mb-2">Se o navio já existe com outro nome (ex.: "NPa Gurupi" × "Gurupi"), use <b>ligar</b>: o nome da lista vira nome alternativo e a classe é ajustada. Navio incluído entra com o código 40015 e precisa ter código (UG) e comando completados em OM / Clientes.</p>
            <table className="w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left">Navio</th><th className="text-left">Classe</th><th className="text-right">Lotação</th><th></th></tr></thead>
              <tbody>{cmp.naviosNovos.map(n => (
                <tr key={`${n.classe}|${n.navio}`} className="border-t border-amber-100">
                  <td className="py-1">{n.navio}</td><td>{n.classe}</td><td className="text-right">{n.lotacao ?? ''}</td>
                  <td className="text-right whitespace-nowrap">{podeEditar && <>
                    <button className="text-primary-700 underline mr-2" onClick={() => setLigar(n)}><Link2 size={11} className="inline" /> ligar</button>
                    <button className="text-primary-700 underline" disabled={!classePorNome(n.classe)} onClick={() => criarNavios([n])} title={classePorNome(n.classe) ? undefined : 'Crie a classe primeiro'}>incluir</button>
                  </>}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}

        {cmp.classeDiferente.length > 0 && (
          <section className="border border-amber-200 bg-amber-50/40 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2"><h4 className="font-semibold">3. Navios com classe diferente da lista</h4>
              {podeEditar && <Button size="sm" onClick={() => corrigirClasses(cmp.classeDiferente.filter(x => x.classeLista))} isLoading={trabalhando}><Wrench size={14} className="mr-1" />Corrigir todas pela lista</Button>}</div>
            <table className="w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left">Navio (cadastro)</th><th className="text-left">Classe no cadastro</th><th className="text-left">Classe na lista</th><th></th></tr></thead>
              <tbody>{cmp.classeDiferente.map(x => (
                <tr key={x.navio.id} className="border-t border-amber-100">
                  <td className="py-1">{x.navio.nome}</td><td>{x.classeAtual || <span className="text-red-700">sem classe</span>}</td><td>{x.lista.classe}{!x.classeLista && <span className="text-amber-700"> (criar a classe no item 1)</span>}</td>
                  <td className="text-right">{podeEditar && x.classeLista && <button className="text-primary-700 underline" onClick={() => corrigirClasses([x])}>corrigir</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        )}

        {cmp.foraDaLista.length > 0 && (
          <section className="border border-slate-200 rounded-xl p-3">
            <h4 className="font-semibold mb-1">4. Navios ativos no cadastro que não estão na lista</h4>
            <p className="text-xs text-slate-500 mb-2">Podem ter sido desativados (baixa, transferência) ou estar com o nome diferente. Confira em OM / Clientes: desative ou acrescente o nome da lista como nome alternativo.</p>
            <div className="flex flex-wrap gap-1">{cmp.foraDaLista.map(n => <span key={n.id} className="text-xs px-2 py-1 rounded-full bg-slate-100">{n.nome}{n.classeId ? '' : ' · sem classe'}</span>)}</div>
          </section>
        )}

        {!cmp.classesNovas.length && !cmp.naviosNovos.length && !cmp.classeDiferente.length && <p className="text-emerald-700 flex items-center gap-2"><CheckCircle2 size={18} />Cadastro de navios e classes confere com a lista.</p>}
      </>}

      <ClienteModal aberto={!!ligar} titulo={`Ligar "${ligar?.navio}" a um navio do cadastro`} oms={dados.oms} tipo="NAVIO" nomeSugerido={ligar?.navio || ''}
        onFechar={() => setLigar(null)}
        onEscolher={async om => {
          const it = ligar!; setLigar(null);
          await executar('Navio ligado', async () => {
            const o = dados.oms.find(x => x.id === om.id) || om;
            const cl = classePorNome(it.classe);
            await cadastroService.saveOM({ ...o, classeId: cl?.id ?? o.classeId ?? null, nomesAlternativos: [...new Set([...(o.nomesAlternativos || []), it.navio!])] });
          });
        }} />
    </div>
  );
};
