import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, RefreshCw, Send, Undo2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Parametro, UserRole } from '../types';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/Modal';
import { Campo, br, brl, entrada } from '../components/faturamento/comum';
import { AbaClientes, AbaDescontos, AbaMedia, AbaRubricas } from '../components/taxa/AbasProposta';
import { AbaResultado, ImportarProposta } from '../components/taxa/ResultadoProposta';
import { DadosProposta, Fase6NaoInstaladaError, StatusProposta, carregarProposta, publicar, salvarProposta, tcAnterior } from '../services/taxaCondominialService';
import { PorRubrica, mediaTrienal, montarParticipantes, ratearProposta } from '../utils/taxaCondominial';
import { resolverEmissora } from '../utils/emissora';
import { cadastroService } from '../services/cadastroService';
import { notify } from '../utils/notify';

type Aba = 'rubricas' | 'clientes' | 'descontos' | 'resultado' | 'navios' | 'media' | 'diarias';
const GRUPOS: { titulo: string; abas: { id: Aba; label: string; dica: string }[] }[] = [
  { titulo: 'Taxa condominial', abas: [
    { id: 'rubricas', label: '1. Rubricas', dica: 'Despesas do ano (aba Despesas_NOVO): previsto, valor anterior, descontos e valor atualizado' },
    { id: 'clientes', label: '2. Clientes e matriz', dica: 'OM que pagam a taxa: lotação e de quais despesas participam' },
    { id: 'descontos', label: '3. Descontos por OM', dica: 'Descontos concedidos a uma OM' },
    { id: 'resultado', label: '4. Resultado da taxa', dica: 'Taxa por OM, Anexo B e extrato' },
  ] },
  { titulo: 'Diária de atracação', abas: [
    { id: 'navios', label: '5. Navios', dica: 'Navios que pagam diária: lotação e dias atracados' },
    { id: 'media', label: '6. Média trienal', dica: 'Dias atracados por classe de navio (3 anos)' },
    { id: 'diarias', label: '7. Resultado das diárias', dica: 'Diária de cada navio' },
  ] },
];
const COR: Record<StatusProposta, string> = { PROPOSTA: 'bg-amber-100 text-amber-800', APROVADA: 'bg-sky-100 text-sky-800', DIVULGADA: 'bg-emerald-100 text-emerald-800' };

export const TaxaCondominial: React.FC = () => {
  const { user } = useAuth();
  const podeEditar = user?.role !== UserRole.READ_ONLY;
  const [ano, setAno] = useState(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));
  const [aba, setAba] = useState<Aba>('rubricas');
  const [dados, setDados] = useState<DadosProposta | null>(null);
  const [anterior, setAnterior] = useState<Map<string, number>>(new Map());
  const [anteriorDA, setAnteriorDA] = useState<Map<string, number>>(new Map());
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [importar, setImportar] = useState(false);
  const [confirma, setConfirma] = useState<null | 'aprovar' | 'publicarTC' | 'publicarDA' | 'reabrir'>(null);
  const [parametros, setParametros] = useState<Parametro[]>([]);
  useEffect(() => { cadastroService.listParametros().then(setParametros).catch(() => undefined); }, []);

  const carregar = async () => {
    setCarregando(true); setErro(null);
    try {
      const [d, a, b] = await Promise.all([carregarProposta(ano), tcAnterior(ano, 'TC'), tcAnterior(ano, 'DA')]);
      setDados(d); setAnterior(a); setAnteriorDA(b); setNaoInstalado(false);
    } catch (e: any) {
      if (e instanceof Fase6NaoInstaladaError) setNaoInstalado(true); else setErro(e?.message || 'Erro ao carregar.');
    } finally { setCarregando(false); }
  };
  useEffect(() => { setDados(null); carregar(); }, [ano]);

  const medias = useMemo(() => {
    if (!dados) return new Map<string, number>();
    return new Map(mediaTrienal(dados.atracacaoAnual, ano, dados.classes.map(c => c.id)).map(m => [m.classeId, m.mediaMensal]));
  }, [dados, ano]);
  // OM emissora (BNIC): participa ou não do rateio; nunca é publicada nos Preços (não é cliente de si mesma)
  const emissora = useMemo(() => (dados ? resolverEmissora(dados.oms, parametros) : null), [dados, parametros]);
  // cálculos separados: taxa condominial (OM de terra × rubricas TC) e diárias (navios × rubricas DA)
  const { resultado, resultadoDA, descontosPorOM, porRubrica } = useMemo(() => {
    if (!dados) return { resultado: null, resultadoDA: null, descontosPorOM: new Map<number, number>(), porRubrica: [] as PorRubrica[] };
    const part = montarParticipantes(dados.oms, dados.lotacoes, medias).filter(p => !(emissora?.omId === p.omId && !emissora.participaRateio));
    const rubTC = dados.rubricas.filter(r => r.destino === 'TC');
    const terra = part.filter(p => p.tipo === 'TERRA'), navios = part.filter(p => p.tipo === 'NAVIO');
    // critério de cada rubrica (lotação, área, partes iguais, peso), % das OM e % dos navios (à parte ou junto)
    const r = ratearProposta(rubTC, terra, navios, dados.matriz, dados.descontos);
    const tc = r.tc, da = r.da;
    const porOM = new Map<number, number>();
    tc.oms.forEach(o => o.parcelas.forEach(p => porOM.set(p.rubrica, Math.round(((porOM.get(p.rubrica) || 0) + p.desconto) * 100) / 100)));
    return { resultado: tc, resultadoDA: da, descontosPorOM: porOM, porRubrica: r.porRubrica };
  }, [dados, medias, emissora]);

  const status = dados?.proposta.status || 'PROPOSTA';
  const pendencias = resultado ? [
    !dados!.rubricas.length && 'sem rubricas',
    !resultado.oms.length && 'sem OM com lotação',
    resultado.valorRubricas.some(r => r.semParticipante) && 'rubrica com valor sem OM participante',
    (dados?.pendentes.length || 0) > 0 && `${dados!.pendentes.length} nome(s) da planilha sem correspondente`,
  ].filter(Boolean) as string[] : [];

  const executar = async () => {
    if (!dados || !resultado) return;
    try {
      if (confirma === 'aprovar') { await salvarProposta({ ...dados.proposta, status: 'APROVADA', aprovadaEm: new Date().toISOString().slice(0, 10) }); notify.success('Proposta aprovada.'); }
      if (confirma === 'reabrir') { await salvarProposta({ ...dados.proposta, status: 'PROPOSTA', aprovadaEm: null }); notify.success('Proposta reaberta para ajustes.'); }
      if (confirma === 'publicarTC') { const n = await publicar(ano, { ...resultado, oms: resultado.oms.filter(o => o.omId !== emissora?.omId) }, user?.name || user?.email || '', 'TC'); notify.success(`Taxa condominial ${ano} publicada: ${n} OM com TC mensal nos Preços do ano.`); }
      if (confirma === 'publicarDA' && resultadoDA) { const n = await publicar(ano, resultadoDA, user?.name || user?.email || '', 'DA'); notify.success(`Diárias ${ano} publicadas: ${n} navio(s) com DA nos Preços do ano.`); }
      carregar();
    } catch (e) { notify.fail('Erro', e); }
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Taxa condominial e diárias</h2>
          <p className="text-slate-500 text-sm max-w-3xl">Rotina anual em duas partes separadas: a <b>taxa condominial</b> (rubricas rateadas entre as OM) e a <b>diária de atracação</b> (valor destinado aos navios, pela lotação e pelos dias atracados). Confira os resultados, aprove e publique cada uma: a TC mensal de cada OM e a diária de cada navio passam a valer nos Preços do ano usados pelo Faturamento.</p>
        </div>
        <div className="flex items-end gap-2">
          <Campo rotulo="Exercício"><select className={entrada} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício da proposta">
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map(a => <option key={a} value={a}>{a}</option>)}
          </select></Campo>
          <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Recarregar</Button>
        </div>
      </div>

      {naoInstalado && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-3" role="alert">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div><p className="font-bold">Taxa condominial ainda não instalada no banco</p><p>Execute o script <code className="bg-amber-100 px-1 rounded">supabase/migrations/010_rotinas_anuais_auditoria.sql</code> no Supabase (SQL Editor → New query → colar → Run) e clique em Recarregar.</p></div>
        </div>
      )}
      {erro && <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm">{erro}</div>}

      {dados && resultado && !naoInstalado && <>
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 bg-white">
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${COR[status]}`}>{status}</span>
          <span className="text-xs text-slate-500">
            {status === 'PROPOSTA' && 'Em elaboração.'}
            {status === 'APROVADA' && `Aprovada em ${br(dados.proposta.aprovadaEm)}. Falta publicar a tabela.`}
            {status === 'DIVULGADA' && `Publicada em ${br(dados.proposta.divulgadaEm)}. Se alterar algo, publique de novo.`}
          </span>
          {pendencias.length > 0 && <span className="text-xs text-red-700">Pendências: {pendencias.join('; ')}.</span>}
          <div className="flex-1" />
          {podeEditar && <>
            <Button size="sm" variant="secondary" onClick={() => setImportar(true)}><FileUp size={14} className="mr-1" />Importar proposta (planilha)</Button>
            {status === 'PROPOSTA' && <Button size="sm" onClick={() => setConfirma('aprovar')} disabled={pendencias.length > 0}><CheckCircle2 size={14} className="mr-1" />Aprovar proposta</Button>}
            {status === 'APROVADA' && <Button size="sm" variant="ghost" onClick={() => setConfirma('reabrir')}><Undo2 size={14} className="mr-1" />Reabrir</Button>}
            {status !== 'PROPOSTA' && <>
              <Button size="sm" onClick={() => setConfirma('publicarTC')} disabled={pendencias.length > 0}><Send size={14} className="mr-1" />Publicar taxa condominial</Button>
              <Button size="sm" onClick={() => setConfirma('publicarDA')} disabled={!resultadoDA?.oms.length}><Send size={14} className="mr-1" />Publicar diárias</Button>
            </>}
          </>}
        </div>

        {emissora?.omId && (() => {
          const linha = resultado.oms.find(o => o.omId === emissora.omId);
          return (
            <div className="p-3 rounded-lg border border-sky-200 bg-sky-50 text-sky-900 text-sm">
              <b>{emissora.nome}</b> é a OM emissora das faturas.{' '}
              {emissora.participaRateio
                ? linha ? <>Participa do rateio: <b>{brl(linha.mensal)}/mês</b> ficam só para controle e contabilidade de custos — não são publicados nos Preços e não geram fatura.</> : <>Participa do rateio, mas não tem lotação/marcação na matriz neste exercício.</>
                : <>Não participa do rateio: a parte dela é dividida entre as demais OM.</>}
              <span className="text-xs text-sky-700"> Para mudar a OM emissora ou a participação: Cadastros › Parâmetros.</span>
            </div>
          );
        })()}
        <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-slate-200">
          {GRUPOS.map(g => (
            <div key={g.titulo}>
              <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 px-1">{g.titulo}</div>
              <div className="flex space-x-1 overflow-x-auto">
                {g.abas.map(a => (
                  <button key={a.id} title={a.dica} onClick={() => setAba(a.id)} className={`px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${aba === a.id ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{a.label}{a.id === 'clientes' && dados.pendentes.some(p => p.tipo !== 'NAVIO') ? ' ⚠' : a.id === 'navios' && dados.pendentes.some(p => p.tipo === 'NAVIO') ? ' ⚠' : ''}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          {aba === 'rubricas' && <AbaRubricas ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} descontosPorOM={descontosPorOM} porRubrica={porRubrica} usuario={user?.name || user?.email || ''} />}
          {aba === 'clientes' && <AbaClientes ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} medias={medias} modo="TERRA" />}
          {aba === 'descontos' && <AbaDescontos ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} resultado={resultado} />}
          {aba === 'resultado' && <AbaResultado ano={ano} dados={dados} resultado={resultado} anterior={anterior} modo="TC" />}
          {aba === 'navios' && <AbaClientes ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} medias={medias} modo="NAVIO" />}
          {aba === 'media' && <AbaMedia ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} />}
          {aba === 'diarias' && resultadoDA && <AbaResultado ano={ano} dados={dados} resultado={resultadoDA} anterior={anteriorDA} modo="DA" />}
        </div>
        <ImportarProposta ano={ano} dados={dados} aberto={importar} fechar={() => setImportar(false)} gravado={carregar} />
        <ConfirmModal isOpen={!!confirma} onClose={() => setConfirma(null)} onConfirm={executar}
          title={confirma === 'publicarTC' ? `Publicar taxa condominial ${ano}` : confirma === 'publicarDA' ? `Publicar diárias ${ano}` : confirma === 'aprovar' ? `Aprovar proposta ${ano}` : 'Reabrir proposta'}
          message={confirma === 'publicarTC'
            ? `Grava nos Preços de ${ano} a TC mensal de ${resultado.oms.length} OM, substituindo os valores atuais. As faturas já emitidas não mudam.`
            : confirma === 'publicarDA' ? `Grava nos Preços de ${ano} a diária de ${resultadoDA?.oms.length || 0} navio(s), substituindo os valores atuais. As faturas já emitidas não mudam.`
            : confirma === 'aprovar' ? 'Marca a proposta como aprovada pelo Comando. Depois disso, publique a tabela para valer no faturamento.' : 'Volta a proposta para elaboração.'} />
      </>}
    </div>
  );
};
