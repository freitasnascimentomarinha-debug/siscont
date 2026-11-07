import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, FileSpreadsheet, Upload } from 'lucide-react';
import { TIPO_OM_LABELS, TipoOM } from '../../types';
import {
  analisarCadastro, AvisoSaneamento, chave, formatarCompetencia, LinhaFatura, planejarImportacao, PropostaCadastro,
} from '../../utils/cadastroImport';
import { lerPlanilhaParaCadastro } from '../../utils/planilhaImport';
import { aplicarImportacao, ResultadoImportacao } from '../../services/cadastroImportService';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { Filtro, Td, Th } from './comum';
import { DadosCadastro } from './useCadastros';

const ROTULO_AVISO: Record<AvisoSaneamento['tipo'], { titulo: string; grave: boolean }> = {
  MESMO_CODIGO_VARIOS_CLIENTES: { titulo: 'Mesmo código com mais de um cliente', grave: true },
  CODIGO_CORRIGIDO: { titulo: 'Códigos digitados errado, corrigidos', grave: false },
  USA_CODIGO_DO_COMANDO: { titulo: 'Clientes sem código próprio', grave: false },
  SETOR_CONVERTIDO: { titulo: 'Siglas de setor convertidas', grave: false },
  NAVIO_AMBIGUO: { titulo: 'Navio do histórico com mais de um cliente', grave: true },
  SETOR_DESCONHECIDO: { titulo: 'Setor fora da lista', grave: true },
  COMANDO_SEM_CODIGO: { titulo: 'Comando sem código', grave: true },
  GRAFIA_UNIFICADA: { titulo: 'Grafias unificadas', grave: false },
  COMANDO_VARIOS_NOMES: { titulo: 'Comando com nomes diferentes', grave: false },
  OM_MUDOU_DE_COMANDO: { titulo: 'OM que mudou de comando', grave: false },
  SEM_FATURA_RECENTE: { titulo: 'Sem fatura recente', grave: false },
  NAVIO_SEM_OM: { titulo: 'Navio do histórico sem cliente', grave: false },
  FATURA_FORA_DO_PADRAO: { titulo: 'Número de fatura fora do padrão', grave: false },
  CODIGO_COMPLETADO: { titulo: 'Código completado com zero', grave: false },
};

const lerArquivo = (f: File) => new Promise<ArrayBuffer>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as ArrayBuffer);
  r.onerror = () => rej(new Error(`Não foi possível ler ${f.name}.`));
  r.readAsArrayBuffer(f);
});

const pausa = () => new Promise(r => setTimeout(r, 30)); // deixa a tela atualizar entre arquivos grandes

export const ImportarTab: React.FC<{ dados: DadosCadastro; podeEditar: boolean; recarregar: () => Promise<void> }> = ({ dados, podeEditar, recarregar }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState<string | null>(null);
  const [proposta, setProposta] = useState<PropostaCadastro | null>(null);
  const [arquivos, setArquivos] = useState<string[]>([]);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [tipos, setTipos] = useState<Record<string, TipoOM>>({});
  const [desativarAntigas, setDesativarAntigas] = useState(true);
  const [filtro, setFiltro] = useState('');
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [gravando, setGravando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const processar = async (files: FileList | null) => {
    if (!files?.length) return;
    setResultado(null); setConfirmando(false);
    const linhas: LinhaFatura[] = [], pares: { classe: string; navio: string }[] = [], abas: string[] = [];
    try {
      for (const f of Array.from(files)) {
        setLendo(`Lendo ${f.name}...`);
        await pausa();
        const r = lerPlanilhaParaCadastro(await lerArquivo(f), f.name);
        linhas.push(...r.linhas); pares.push(...r.pares); abas.push(...r.abasLidas);
      }
      setLendo('Analisando...');
      await pausa();
      if (!linhas.length) throw new Error('Nenhuma aba com as colunas Comando, Cliente e Fatura foi encontrada nos arquivos.');
      const p = analisarCadastro(linhas, pares, abas);
      setProposta(p);
      setArquivos(Array.from(files).map(f => f.name));
      setSelecionadas(new Set(p.oms.map(o => o.chave)));
      setTipos({});
      setAbertos(new Set());
    } catch (e: any) {
      notify.error(e?.message || 'Erro ao ler as planilhas.');
    } finally {
      setLendo(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const existentes = useMemo(() => new Set(dados.oms.map(o => `${o.codigo}|${chave(o.nome)}`)), [dados.oms]);
  const limiteRecente = useMemo(() => {
    const c = proposta?.estatisticas.competenciaMaisRecente || 0;
    if (!c) return 0;
    let y = Math.floor(c / 100), m = (c % 100) - 12; while (m <= 0) { m += 12; y--; } return y * 100 + m;
  }, [proposta]);

  const plano = useMemo(() => {
    if (!proposta) return null;
    const p = { ...proposta, oms: proposta.oms.map(o => (tipos[o.chave] ? { ...o, tipo: tipos[o.chave] } : o)) };
    return planejarImportacao(p, {
      setores: dados.setores, comandos: dados.comandos, classes: dados.classes,
      oms: dados.oms.map(o => ({ id: o.id, codigo: o.codigo, nome: o.nome, classeId: o.classeId, tipo: o.tipo })),
    }, { selecionadas, desativarSemFaturaRecente: desativarAntigas });
  }, [proposta, dados, selecionadas, desativarAntigas, tipos]);

  const cmdNome = useMemo(() => new Map((proposta?.comandos || []).map(c => [c.chave, `${c.codigo ? c.codigo + ' - ' : ''}${c.nome}`])), [proposta]);

  const lista = (proposta?.oms || []).filter(o => {
    if (filtro === 'SEM_CODIGO') return !o.codigoProprio;
    if (filtro === 'ANTIGAS') return limiteRecente && o.ultimaCompetencia < limiteRecente;
    if (filtro === 'EXISTENTES') return existentes.has(`${o.codigo}|${chave(o.nome)}`);
    if (filtro === 'NOVAS') return !existentes.has(`${o.codigo}|${chave(o.nome)}`);
    if (filtro === 'DESMARCADAS') return !selecionadas.has(o.chave);
    if (filtro) return (tipos[o.chave] || o.tipo) === filtro;
    return true;
  });

  const alternar = (k: string) => setSelecionadas(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const marcarVisiveis = (v: boolean) => setSelecionadas(prev => { const n = new Set(prev); lista.forEach(o => (v ? n.add(o.chave) : n.delete(o.chave))); return n; });

  const gravar = async () => {
    if (!plano) return;
    setGravando('Iniciando...');
    try {
      const r = await aplicarImportacao(plano, setGravando);
      setResultado(r);
      notify.success(`Cadastro importado: ${r.oms} OM, ${r.comandos} comandos, ${r.classes} classes.`);
      setProposta(null);
      await recarregar();
    } catch (e) {
      notify.fail('Erro na importação', e);
    } finally {
      setGravando(null); setConfirmando(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col md:flex-row gap-4 md:items-center">
        <div className="p-3 rounded-lg bg-white border border-slate-200 text-primary-700 self-start"><FileSpreadsheet size={26} /></div>
        <div className="flex-1 text-sm text-slate-600 space-y-1">
          <p className="font-semibold text-slate-800">Importar o cadastro a partir das planilhas</p>
          <p>Selecione um ou mais arquivos: <b>Pagamento 2026</b>, <b>Faturamento</b>, <b>Faturas em Aberto</b> (setor, comando, cliente e o código da OM tirado do número da fatura) e o <b>Histórico Trienal</b> (classes de navio). Nada é gravado antes da sua confirmação, e cadastros que já existem não são alterados.</p>
        </div>
        <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.ods" className="hidden" onChange={e => processar(e.target.files)} />
        <Button onClick={() => inputRef.current?.click()} isLoading={!!lendo} disabled={!!gravando}>{!lendo && <Upload size={16} className="mr-2" />}{lendo || 'Selecionar planilhas'}</Button>
      </div>

      {resultado && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm flex gap-2" role="status">
          <CheckCircle2 size={18} className="shrink-0" />
          <div>Importação concluída: <b>{resultado.oms}</b> OM, <b>{resultado.comandos}</b> comandos, <b>{resultado.setores}</b> setores e <b>{resultado.classes}</b> classes criados; classe associada a <b>{resultado.classesAplicadas}</b> navios já cadastrados. Confira nas abas ao lado.</div>
        </div>
      )}

      {proposta && plano && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ['Faturas lidas', proposta.estatisticas.linhasLidas.toLocaleString('pt-BR')],
              ['Clientes encontrados', `${proposta.oms.length}`],
              ['Comandos', `${proposta.comandos.length}`],
              ['Classes de navio', `${proposta.classes.length}`],
              ['Fatura mais recente', formatarCompetencia(proposta.estatisticas.competenciaMaisRecente)],
            ].map(([l, v]) => (
              <div key={l} className="p-3 rounded-lg border border-slate-200 bg-white"><div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{l}</div><div className="text-xl font-bold text-slate-900 tabular-nums">{v}</div></div>
            ))}
          </div>
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{proposta.estatisticas.abasLidas.length} abas lidas de {arquivos.length} arquivo(s)</summary>
            <ul className="mt-2 grid md:grid-cols-2 gap-x-6 list-disc pl-5">{proposta.estatisticas.abasLidas.map(a => <li key={a}>{a}</li>)}</ul>
          </details>

          <section className="space-y-2">
            <h3 className="font-semibold text-slate-800">Relatório de saneamento</h3>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
              {proposta.avisos
                .map((a, i) => ({ a, i }))
                .sort((x, y) => Number(ROTULO_AVISO[y.a.tipo].grave) - Number(ROTULO_AVISO[x.a.tipo].grave))
                .map(({ a, i }) => {
                  const r = ROTULO_AVISO[a.tipo];
                  const aberto = abertos.has(i);
                  return (
                    <div key={i} className="p-3">
                      <button className="w-full flex items-start gap-2 text-left" onClick={() => setAbertos(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })} aria-expanded={aberto}>
                        {aberto ? <ChevronDown size={16} className="mt-0.5 text-slate-400" /> : <ChevronRight size={16} className="mt-0.5 text-slate-400" />}
                        <span className={`mt-0.5 shrink-0 ${r.grave ? 'text-amber-600' : 'text-slate-400'}`}><AlertTriangle size={15} /></span>
                        <span className="text-sm"><b className="text-slate-800">{r.titulo}.</b> <span className="text-slate-600">{a.mensagem}</span></span>
                      </button>
                      {aberto && a.exemplos && (
                        <ul className="mt-2 ml-12 text-xs text-slate-600 space-y-0.5 list-disc pl-4">{a.exemplos.map(e => <li key={e} className="break-words">{e}</li>)}</ul>
                      )}
                    </div>
                  );
                })}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-slate-800">Clientes a importar</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Filtro label="Mostrar" value={filtro} onChange={setFiltro} options={[
                  { value: '', label: 'Todos' }, { value: 'NOVAS', label: 'Ainda não cadastrados' }, { value: 'EXISTENTES', label: 'Já cadastrados' },
                  { value: 'SEM_CODIGO', label: 'Sem código próprio' }, { value: 'ANTIGAS', label: 'Sem fatura há 12 meses' }, { value: 'DESMARCADAS', label: 'Desmarcados' },
                  { value: 'TERRA', label: 'OM de terra' }, { value: 'NAVIO', label: 'Navios' }, { value: 'EXTRA_MB', label: 'Extra-MB' },
                ]} />
                <Button size="sm" variant="ghost" onClick={() => marcarVisiveis(true)}>Marcar visíveis</Button>
                <Button size="sm" variant="ghost" onClick={() => marcarVisiveis(false)}>Desmarcar visíveis</Button>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[28rem] overflow-y-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50 sticky top-0 z-10"><tr><Th> </Th><Th>Código</Th><Th>Nome</Th><Th>Tipo</Th><Th>Comando</Th><Th>Setor</Th><Th>Classe</Th><Th>Faturas</Th><Th>Última</Th><Th>Situação</Th></tr></thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {lista.map(o => {
                    const existe = existentes.has(`${o.codigo}|${chave(o.nome)}`);
                    const antiga = limiteRecente && o.ultimaCompetencia && o.ultimaCompetencia < limiteRecente;
                    const marcado = selecionadas.has(o.chave);
                    return (
                      <tr key={o.chave} className={!marcado ? 'bg-slate-50 text-slate-400' : ''}>
                        <Td><input type="checkbox" checked={marcado} onChange={() => alternar(o.chave)} aria-label={`Importar ${o.nome}`} className="h-4 w-4 accent-primary-600" /></Td>
                        <Td className="font-mono text-xs font-semibold">
                          {o.codigo}
                          {!o.codigoProprio && <div className="font-sans font-normal text-[10px] text-slate-500 whitespace-nowrap">{o.tipo === 'EXTRA_MB' ? 'código da BNIC' : 'código do comando'}</div>}
                        </Td>
                        <Td>
                          <div className="font-medium text-slate-900">{o.nome}</div>
                          {o.variantes.length > 0 && <div className="text-[11px] text-slate-500" title={o.variantes.join('\n')}>também: {o.variantes.slice(0, 2).join('; ')}{o.variantes.length > 2 ? '…' : ''}</div>}
                        </Td>
                        <Td>
                          <select aria-label={`Tipo de ${o.nome}`} value={tipos[o.chave] || o.tipo} onChange={e => setTipos({ ...tipos, [o.chave]: e.target.value as TipoOM })} className="text-xs border border-slate-200 rounded px-1 py-0.5 bg-white" disabled={existe}>
                            {Object.entries(TIPO_OM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                          </select>
                        </Td>
                        <Td className="text-xs">{o.comandoChave ? cmdNome.get(o.comandoChave) : '—'}</Td>
                        <Td className="text-xs font-semibold">{o.setor || '—'}</Td>
                        <Td className="text-xs">{o.classe || '—'}</Td>
                        <Td className="text-xs tabular-nums">{o.qtdFaturas}</Td>
                        <Td className="text-xs tabular-nums">{formatarCompetencia(o.ultimaCompetencia)}</Td>
                        <Td className="text-xs">{existe ? <span className="text-slate-500">Já cadastrado</span> : antiga && desativarAntigas ? <span className="text-slate-600">Entra desativado</span> : <span className="text-emerald-700">Entra ativo</span>}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="p-4 rounded-xl border border-primary-200 bg-primary-50/50 space-y-3">
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={desativarAntigas} onChange={e => setDesativarAntigas(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary-600" />
              <span>Importar <b>já desativados</b> os clientes sem fatura nos últimos 12 meses (antes de {formatarCompetencia(limiteRecente)}). A data de desativação será o fim do mês seguinte à última fatura; o histórico fica preservado.</span>
            </label>
            <div className="text-sm text-slate-700">
              Serão criados: <b>{plano.oms.length}</b> OM/clientes (<b>{plano.oms.filter(o => !o.ativo).length}</b> já desativados), <b>{plano.comandos.length}</b> comandos, <b>{plano.setores.length}</b> setores{plano.setores.length ? ` (${plano.setores.join(', ')})` : ''} e <b>{plano.classes.length}</b> classes de navio{plano.classesEmOMExistentes.length ? `; classe associada a ${plano.classesEmOMExistentes.length} navio(s) já cadastrados` : ''}.
              <span className="text-slate-500"> Ignorados: {plano.ignorados.omsExistentes} já cadastrados, {plano.ignorados.naoSelecionadas} desmarcados.</span>
            </div>
            {podeEditar ? (
              <div className="flex flex-wrap gap-2 items-center">
                {!confirmando ? (
                  <Button onClick={() => setConfirmando(true)} disabled={!!gravando || (plano.oms.length + plano.comandos.length + plano.classes.length + plano.classesEmOMExistentes.length === 0)}>Gravar no cadastro</Button>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-slate-800">Confirma a gravação?</span>
                    <Button onClick={gravar} isLoading={!!gravando}>{gravando || 'Sim, gravar'}</Button>
                    <Button variant="ghost" onClick={() => setConfirmando(false)} disabled={!!gravando}>Voltar</Button>
                  </>
                )}
              </div>
            ) : <p className="text-xs text-slate-500">Somente administradores gravam o cadastro.</p>}
          </section>
        </>
      )}
    </div>
  );
};
