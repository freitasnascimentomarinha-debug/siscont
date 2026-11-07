import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileUp, RefreshCw, Send, Undo2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types';
import { Button } from '../components/ui/Button';
import { ConfirmModal } from '../components/ui/Modal';
import { Campo, br, entrada } from '../components/faturamento/comum';
import { AbaDescontos, AbaLotacao, AbaMedia, AbaRubricas } from '../components/taxa/AbasProposta';
import { AbaResultado, ImportarProposta } from '../components/taxa/ResultadoProposta';
import { DadosProposta, Fase6NaoInstaladaError, StatusProposta, carregarProposta, publicar, salvarProposta, tcAnterior } from '../services/taxaCondominialService';
import { mediaTrienal, montarParticipantes, ratear } from '../utils/taxaCondominial';
import { notify } from '../utils/notify';

type Aba = 'rubricas' | 'lotacao' | 'media' | 'descontos' | 'resultado';
const ABAS: { id: Aba; label: string; dica: string }[] = [
  { id: 'rubricas', label: '1. Rubricas', dica: 'Despesas previstas no ano e descontos gerais' },
  { id: 'lotacao', label: '2. Lotação e matriz', dica: 'Lotação de cada OM e de quais despesas participa' },
  { id: 'media', label: '3. Média trienal', dica: 'Dias atracados por classe de navio (3 anos)' },
  { id: 'descontos', label: '4. Descontos por OM', dica: 'Descontos concedidos a uma OM' },
  { id: 'resultado', label: '5. Resultado', dica: 'Taxa por OM, diárias, Anexo B e extrato' },
];
const COR: Record<StatusProposta, string> = { PROPOSTA: 'bg-amber-100 text-amber-800', APROVADA: 'bg-sky-100 text-sky-800', DIVULGADA: 'bg-emerald-100 text-emerald-800' };

export const TaxaCondominial: React.FC = () => {
  const { user } = useAuth();
  const podeEditar = user?.role !== UserRole.READ_ONLY;
  const [ano, setAno] = useState(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0));
  const [aba, setAba] = useState<Aba>('rubricas');
  const [dados, setDados] = useState<DadosProposta | null>(null);
  const [anterior, setAnterior] = useState<Map<string, number>>(new Map());
  const [naoInstalado, setNaoInstalado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [importar, setImportar] = useState(false);
  const [confirma, setConfirma] = useState<null | 'aprovar' | 'publicar' | 'reabrir'>(null);

  const carregar = async () => {
    setCarregando(true); setErro(null);
    try {
      const [d, a] = await Promise.all([carregarProposta(ano), tcAnterior(ano)]);
      setDados(d); setAnterior(a); setNaoInstalado(false);
    } catch (e: any) {
      if (e instanceof Fase6NaoInstaladaError) setNaoInstalado(true); else setErro(e?.message || 'Erro ao carregar.');
    } finally { setCarregando(false); }
  };
  useEffect(() => { setDados(null); carregar(); }, [ano]);

  const medias = useMemo(() => {
    if (!dados) return new Map<string, number>();
    return new Map(mediaTrienal(dados.atracacaoAnual, ano, dados.classes.map(c => c.id)).map(m => [m.classeId, m.mediaMensal]));
  }, [dados, ano]);
  const resultado = useMemo(() => {
    if (!dados) return null;
    return ratear(dados.rubricas, montarParticipantes(dados.oms, dados.lotacoes, medias), dados.matriz, dados.descontos);
  }, [dados, medias]);

  const status = dados?.proposta.status || 'PROPOSTA';
  const pendencias = resultado ? [
    !dados!.rubricas.length && 'sem rubricas',
    !resultado.oms.length && 'sem OM com lotação',
    resultado.valorRubricas.some(r => r.semParticipante) && 'rubrica com valor sem OM participante',
  ].filter(Boolean) as string[] : [];

  const executar = async () => {
    if (!dados || !resultado) return;
    try {
      if (confirma === 'aprovar') { await salvarProposta({ ...dados.proposta, status: 'APROVADA', aprovadaEm: new Date().toISOString().slice(0, 10) }); notify.success('Proposta aprovada.'); }
      if (confirma === 'reabrir') { await salvarProposta({ ...dados.proposta, status: 'PROPOSTA', aprovadaEm: null }); notify.success('Proposta reaberta para ajustes.'); }
      if (confirma === 'publicar') { const n = await publicar(ano, resultado, user?.name || user?.email || ''); notify.success(`Tabela ${ano} publicada: ${n} preço(s) gravados (TC mensal das OM e diária DA dos navios).`); }
      carregar();
    } catch (e) { notify.fail('Erro', e); }
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Taxa condominial e diárias</h2>
          <p className="text-slate-500 text-sm max-w-3xl">Rotina anual: monte a proposta (rubricas → lotação e matriz → média trienal → descontos), confira o resultado, aprove e publique. Ao publicar, a TC mensal de cada OM e a diária de cada navio passam a valer nos Preços do ano usados pelo Faturamento.</p>
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
            {status !== 'PROPOSTA' && <Button size="sm" onClick={() => setConfirma('publicar')} disabled={pendencias.length > 0}><Send size={14} className="mr-1" />{status === 'DIVULGADA' ? 'Publicar de novo' : 'Publicar tabela vigente'}</Button>}
          </>}
        </div>

        <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto">
          {ABAS.map(a => (
            <button key={a.id} title={a.dica} onClick={() => setAba(a.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${aba === a.id ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{a.label}</button>
          ))}
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          {aba === 'rubricas' && <AbaRubricas ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} />}
          {aba === 'lotacao' && <AbaLotacao ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} medias={medias} />}
          {aba === 'media' && <AbaMedia ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} />}
          {aba === 'descontos' && <AbaDescontos ano={ano} dados={dados} podeEditar={podeEditar} recarregar={carregar} resultado={resultado} />}
          {aba === 'resultado' && <AbaResultado ano={ano} dados={dados} resultado={resultado} anterior={anterior} />}
        </div>
        <ImportarProposta ano={ano} dados={dados} aberto={importar} fechar={() => setImportar(false)} gravado={carregar} />
        <ConfirmModal isOpen={!!confirma} onClose={() => setConfirma(null)} onConfirm={executar}
          title={confirma === 'publicar' ? `Publicar tabela ${ano}` : confirma === 'aprovar' ? `Aprovar proposta ${ano}` : 'Reabrir proposta'}
          message={confirma === 'publicar'
            ? `Grava nos Preços de ${ano} a TC mensal de ${resultado.oms.filter(o => o.tipo === 'TERRA').length} OM e a diária de ${resultado.oms.filter(o => o.tipo === 'NAVIO').length} navio(s), substituindo os valores atuais desses itens. As faturas já emitidas não mudam.`
            : confirma === 'aprovar' ? 'Marca a proposta como aprovada pelo Comando. Depois disso, publique a tabela para valer no faturamento.' : 'Volta a proposta para elaboração.'} />
      </>}
    </div>
  );
};
