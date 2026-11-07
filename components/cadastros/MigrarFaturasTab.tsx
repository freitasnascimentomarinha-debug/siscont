import React, { useEffect, useRef, useState } from 'react';
import { BaixarModelo } from '../ui/BaixarModelo';
import { modeloPlanilhaPagamento } from '../../utils/modelos';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Database, Undo2, Upload } from 'lucide-react';
import { analisarCadastro, LinhaFatura } from '../../utils/cadastroImport';
import { lerPlanilhaCompleta } from '../../utils/planilhaImport';
import { PlanilhasFaturas, PlanoMigracao, planejarMigracao, planilhasVazias } from '../../utils/faturasImport';
import {
  aplicarMigracao, carregarContexto, desfazerMigracao, gravarPontosEmExistentes, ResultadoMigracao, situacaoMigracao,
} from '../../services/faturasImportService';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';
import { DadosCadastro } from './useCadastros';

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const int = (n: number) => n.toLocaleString('pt-BR');

const lerArquivo = (f: File) => new Promise<ArrayBuffer>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result as ArrayBuffer);
  r.onerror = () => rej(new Error(`Não foi possível ler ${f.name}.`));
  r.readAsArrayBuffer(f);
});
const pausa = () => new Promise(r => setTimeout(r, 30));

type Situacao = Awaited<ReturnType<typeof situacaoMigracao>>;

const Card: React.FC<{ rotulo: string; valor: string; detalhe?: string }> = ({ rotulo, valor, detalhe }) => (
  <div className="p-3 rounded-lg border border-slate-200 bg-white">
    <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{rotulo}</div>
    <div className="text-xl font-bold text-slate-900 tabular-nums">{valor}</div>
    {detalhe && <div className="text-[11px] text-slate-500 mt-0.5">{detalhe}</div>}
  </div>
);

export const MigrarFaturasTab: React.FC<{ dados: DadosCadastro; podeEditar: boolean }> = ({ dados, podeEditar }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState<string | null>(null);
  const [plano, setPlano] = useState<PlanoMigracao | null>(null);
  const [abas, setAbas] = useState<string[]>([]);
  const [abertos, setAbertos] = useState<Set<number>>(new Set());
  const [confirmando, setConfirmando] = useState(false);
  const [gravando, setGravando] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoMigracao | null>(null);
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [confirmarDesfazer, setConfirmarDesfazer] = useState(false);
  const [planoCompleto, setPlanoCompleto] = useState<PlanoMigracao | null>(null);
  const [gravandoPontos, setGravandoPontos] = useState<string | null>(null);

  const atualizarSituacao = async () => {
    try { setSituacao(await situacaoMigracao()); } catch { setSituacao(null); }
  };
  useEffect(() => { atualizarSituacao(); }, []);

  const semCadastro = dados.oms.length === 0;

  const processar = async (files: FileList | null) => {
    if (!files?.length) return;
    setResultado(null); setConfirmando(false); setPlano(null);
    const linhas: LinhaFatura[] = [], pares: { classe: string; navio: string }[] = [], abasCad: string[] = [];
    const fat: PlanilhasFaturas = planilhasVazias();
    const lidas: string[] = [];
    try {
      for (const f of Array.from(files)) {
        setLendo(`Lendo ${f.name}...`);
        await pausa();
        const r = lerPlanilhaCompleta(await lerArquivo(f), f.name);
        linhas.push(...r.cadastro.linhas); pares.push(...r.cadastro.pares); abasCad.push(...r.cadastro.abasLidas);
        (Object.keys(fat) as (keyof PlanilhasFaturas)[]).forEach(k => fat[k].push(...r.faturas[k]));
        lidas.push(...r.abasFaturas);
      }
      if (!fat.faturas.length && !fat.pagas.length && !fat.extra.length && !fat.lancamentos.length) {
        throw new Error('Nenhuma aba de faturas ou pagamentos foi encontrada (FATURAS, Faturas Pagas, Faturas Extra-MB, ALTCRED, LANÇAMENTOS...). Selecione a planilha Pagamento 2026.');
      }
      setLendo('Ligando ao cadastro...');
      await pausa();
      const proposta = analisarCadastro(linhas, pares, abasCad);
      const { ctx } = await carregarContexto(proposta);
      setLendo('Montando a migração...');
      await pausa();
      setPlano(planejarMigracao(fat, ctx));
      // Para registros já migrados: plano sem "existentes", só para saber os pontos de atenção de cada número
      setPlanoCompleto(ctx.faturasExistentes.size || ctx.documentosExistentes.size
        ? planejarMigracao(fat, { ...ctx, faturasExistentes: new Set(), documentosExistentes: new Set() })
        : null);
      setAbas(lidas);
      setAbertos(new Set());
    } catch (e: any) {
      notify.error(e?.message || 'Erro ao ler as planilhas.');
    } finally {
      setLendo(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const gravar = async () => {
    if (!plano) return;
    setGravando('Iniciando...');
    try {
      const r = await aplicarMigracao(plano, setGravando);
      setResultado(r);
      notify.success(`Migração concluída: ${int(r.faturas)} faturas, ${int(r.documentos)} documentos e ${int(r.baixas)} baixas.`);
      setPlano(null);
      await atualizarSituacao();
    } catch (e) {
      notify.fail('Erro na migração', e);
      await atualizarSituacao();
    } finally {
      setGravando(null); setConfirmando(false);
    }
  };

  const gravarPontos = async () => {
    if (!planoCompleto) return;
    setGravandoPontos('Iniciando...');
    try {
      const n = await gravarPontosEmExistentes(planoCompleto, setGravandoPontos);
      notify.success(`Pontos de atenção gravados em ${int(n)} fatura(s)/documento(s) já existentes.`);
      setPlanoCompleto(null);
    } catch (e) {
      notify.fail('Erro ao gravar pontos de atenção', e);
    } finally { setGravandoPontos(null); }
  };

  const desfazer = async () => {
    setDesfazendo('Verificando...');
    try {
      const s = await desfazerMigracao(setDesfazendo);
      notify.success(`Migração desfeita: ${int(s.faturas)} faturas, ${int(s.documentos)} documentos e ${int(s.baixas)} baixas removidos.`);
      setResultado(null);
      await atualizarSituacao();
    } catch (e) {
      notify.fail('Não foi possível desfazer', e);
    } finally {
      setDesfazendo(null); setConfirmarDesfazer(false);
    }
  };

  const r = plano?.resumo;
  const diferenca = r ? Math.round((r.abertoFaturas - r.valorAbertoPlanilha) * 100) / 100 : 0;
  const jaMigrado = !!situacao && (situacao.faturas + situacao.documentos + situacao.baixas) > 0;

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-xl border border-slate-200 bg-slate-50/70 flex flex-col md:flex-row gap-4 md:items-center">
        <div className="p-3 rounded-lg bg-white border border-slate-200 text-primary-700 self-start"><Database size={26} /></div>
        <div className="flex-1 text-sm text-slate-600 space-y-1">
          <p className="font-semibold text-slate-800">Migrar faturas, ALTCRED e baixas das planilhas</p>
          <p>Selecione a planilha <b>Pagamento 2026</b> (abas FATURAS, Faturas Pagas, Faturas Extra-MB, ALTCRED, LANÇAMENTOS, ADIANTAMENTOS e RESUMO ADIANTAMENTO) e, se quiser, os livros de <b>Faturamento</b> (abas JAN26, FEV26... e o consolidado FATURAMENTO 2026), que completam serviço, adiantamento, acréscimo e débito. Cada fatura é ligada à OM do cadastro. Nada é gravado antes da sua confirmação, e faturas ou documentos com número já existente são ignorados.</p>
        </div>
        <input ref={inputRef} type="file" multiple accept=".xlsx,.xls,.ods" className="hidden" onChange={e => processar(e.target.files)} />
        <div className="flex flex-col items-end gap-1">
          <Button onClick={() => inputRef.current?.click()} isLoading={!!lendo} disabled={!!gravando || semCadastro}>{!lendo && <Upload size={16} className="mr-2" />}{lendo || 'Selecionar planilhas'}</Button>
          <BaixarModelo modelo={modeloPlanilhaPagamento} />
        </div>
      </div>

      {semCadastro && (
        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-2" role="alert">
          <AlertTriangle size={18} className="shrink-0" />
          <span>Importe primeiro o cadastro de OM (aba <b>Importar planilhas</b>): cada fatura precisa ser ligada a uma OM.</span>
        </div>
      )}

      {jaMigrado && (
        <div className="p-4 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 flex flex-col md:flex-row md:items-center gap-3">
          <div className="flex-1">
            Já gravados pela migração: <b>{int(situacao!.faturas)}</b> faturas, <b>{int(situacao!.documentos)}</b> documentos (ALTCRED/GRU) e <b>{int(situacao!.baixas)}</b> baixas.
            {situacao!.manuaisSobreMigrado > 0 && <span className="text-slate-500"> Há {situacao!.manuaisSobreMigrado} baixa(s) lançada(s) depois, à mão, sobre esses registros.</span>}
            <div className="text-xs text-slate-500">Uma nova leitura só acrescenta o que ainda não existe. Para refazer do zero, desfaça a migração.</div>
          </div>
          {podeEditar && (!confirmarDesfazer ? (
            <Button variant="secondary" size="sm" onClick={() => setConfirmarDesfazer(true)} disabled={!!gravando || !!desfazendo}><Undo2 size={14} className="mr-1" />Desfazer migração</Button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-red-700">Remover tudo o que a migração gravou?</span>
              <Button variant="danger" size="sm" onClick={desfazer} isLoading={!!desfazendo}>{desfazendo || 'Sim, remover'}</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmarDesfazer(false)} disabled={!!desfazendo}>Não</Button>
            </div>
          ))}
        </div>
      )}

      {resultado && (
        <div className="p-4 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm flex gap-2" role="status">
          <CheckCircle2 size={18} className="shrink-0" />
          <div>Migração concluída: <b>{int(resultado.faturas)}</b> faturas, <b>{int(resultado.documentos)}</b> documentos e <b>{int(resultado.baixas)}</b> baixas gravados. Confira em <b>Faturas</b> e <b>Documentos</b>.</div>
        </div>
      )}

      {plano && r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card rotulo="Faturas a gravar" valor={int(plano.faturas.length)} detalhe={r.ignoradasExistentes ? `${int(r.ignoradasExistentes)} já existentes ignoradas` : undefined} />
            <Card rotulo="ALTCRED / GRU" valor={int(plano.documentos.length)} />
            <Card rotulo="Baixas" valor={int(plano.baixas.length)} detalhe={r.baixasEmExistentes ? `${int(r.baixasEmExistentes)} ligadas a registros já gravados` : undefined} />
            <Card rotulo="Faturas em aberto" valor={int(r.abertas)} detalhe={brl(r.valorAberto)} />
          </div>

          <section className="grid md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-slate-200 bg-white text-sm">
              <h3 className="font-semibold text-slate-800 mb-2">Origem das faturas</h3>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(r.porOrigem).map(([o, n]) => (
                    <tr key={o}><td className="py-1 pr-2 text-slate-600">{o.replace('Planilha Pagamento 2026 › ', '')}</td><td className="py-1 text-right tabular-nums font-semibold">{int(n)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 rounded-lg border border-slate-200 bg-white text-sm">
              <h3 className="font-semibold text-slate-800 mb-2">Conferência com a planilha</h3>
              <table className="w-full text-xs">
                <tbody className="divide-y divide-slate-100">
                  <tr><td className="py-1 text-slate-600">Em aberto — aba FATURAS (sistema)</td><td className="py-1 text-right tabular-nums font-semibold">{brl(r.abertoFaturas)}</td></tr>
                  <tr><td className="py-1 text-slate-600">Em aberto — aba FATURAS (planilha)</td><td className="py-1 text-right tabular-nums">{brl(r.valorAbertoPlanilha)}</td></tr>
                  <tr><td className="py-1 text-slate-600">Diferença</td><td className={`py-1 text-right tabular-nums font-semibold ${Math.abs(diferenca) < 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>{Math.abs(diferenca) < 0.01 ? 'Confere' : brl(diferenca)}</td></tr>
                  <tr><td className="py-1 text-slate-600">Contestadas em aberto</td><td className="py-1 text-right tabular-nums">{brl(r.abertoContestadas)}</td></tr>
                  <tr><td className="py-1 text-slate-600">Extra-MB em aberto</td><td className="py-1 text-right tabular-nums">{brl(r.abertoExtraMB)}</td></tr>
                  {r.abertoOutras > 0 && <tr><td className="py-1 text-slate-600">Outras em aberto</td><td className="py-1 text-right tabular-nums">{brl(r.abertoOutras)}</td></tr>}
                  <tr><td className="py-1 text-slate-600">Saldo por fatura igual ao da planilha</td><td className="py-1 text-right tabular-nums">{int(r.conferidasFaturas)} de {int(r.conferidasFaturas + r.divergentesFaturas)}</td></tr>
                  <tr><td className="py-1 text-slate-600">Utilizado da ALTCRED igual ao da planilha</td><td className="py-1 text-right tabular-nums">{int(r.conferidasAltcred)} de {int(r.conferidasAltcred + r.divergentesAltcred)}</td></tr>
                  {r.conferidasAdiant + r.divergentesAdiant > 0 && (<>
                    <tr><td className="py-1 text-slate-600">Aba ADIANTAMENTOS: enviado, utilizado e saldo iguais</td><td className="py-1 text-right tabular-nums">{int(r.conferidasAdiant)} de {int(r.conferidasAdiant + r.divergentesAdiant)}</td></tr>
                    <tr><td className="py-1 text-slate-600">Saldo de adiantamentos (planilha × sistema)</td><td className={`py-1 text-right tabular-nums ${Math.abs(r.saldoAdiantPlanilha - r.saldoAdiantSistema) < 0.01 ? 'text-emerald-700' : 'text-amber-700'}`}>{brl(r.saldoAdiantPlanilha)} × {brl(r.saldoAdiantSistema)}</td></tr>
                  </>)}
                </tbody>
              </table>
            </div>
          </section>

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer">{abas.length} abas lidas</summary>
            <ul className="mt-2 grid md:grid-cols-2 gap-x-6 list-disc pl-5">{abas.map(a => <li key={a}>{a}</li>)}</ul>
          </details>

          {planoCompleto && r.ignoradasExistentes > 0 && podeEditar && (
            <div className="p-3 rounded-lg border border-primary-200 bg-primary-50/50 text-sm text-slate-700 flex flex-col md:flex-row md:items-center gap-2">
              <span className="flex-1">{int(r.ignoradasExistentes)} registro(s) desta planilha já estão no sistema. Para atualizar neles os pontos de atenção (ícone ⚠) e as ALTCRED cuja sobra foi para adiantamento (aba ADIANTAMENTOS):</span>
              <Button size="sm" variant="secondary" onClick={gravarPontos} isLoading={!!gravandoPontos} disabled={!!gravando}>{gravandoPontos || 'Atualizar os já migrados'}</Button>
            </div>
          )}

          {plano.avisos.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold text-slate-800">Pontos de atenção encontrados nas planilhas</h3>
              <p className="text-xs text-slate-500">Ao gravar, cada problema fica marcado na própria fatura ou ALTCRED (ícone ⚠ com a descrição e como corrigir) e reunido na tela <b>Pontos de Atenção</b>, para você corrigir depois. Os itens em destaque merecem conferência com a planilha original; os demais foram corrigidos automaticamente conforme a OI 40-04.</p>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
                {plano.avisos.map((a, i) => ({ a, i })).sort((x, y) => Number(y.a.grave) - Number(x.a.grave)).map(({ a, i }) => {
                  const aberto = abertos.has(i);
                  return (
                    <div key={i} className="p-3">
                      <button className="w-full flex items-start gap-2 text-left" aria-expanded={aberto}
                        onClick={() => setAbertos(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
                        {aberto ? <ChevronDown size={16} className="mt-0.5 text-slate-400" /> : <ChevronRight size={16} className="mt-0.5 text-slate-400" />}
                        <span className={`mt-0.5 shrink-0 ${a.grave ? 'text-amber-600' : 'text-slate-400'}`}><AlertTriangle size={15} /></span>
                        <span className="text-sm text-slate-700">{a.mensagem}</span>
                      </button>
                      {aberto && a.exemplos && (
                        <ul className="mt-2 ml-12 text-xs text-slate-600 space-y-0.5 list-disc pl-4">{a.exemplos.map(e => <li key={e} className="break-words">{e}</li>)}</ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="p-4 rounded-xl border border-primary-200 bg-primary-50/50 space-y-3">
            <div className="text-sm text-slate-700">
              Serão gravados <b>{int(plano.documentos.length)}</b> documentos, <b>{int(plano.faturas.length)}</b> faturas e <b>{int(plano.baixas.length)}</b> baixas.
              Faturas do histórico (Faturas Pagas) entram como <b>pagas fora do sistema</b>, sem baixa em ALTCRED.
            </div>
            {podeEditar ? (
              <div className="flex flex-wrap gap-2 items-center">
                {!confirmando ? (
                  <Button onClick={() => setConfirmando(true)} disabled={!!gravando || plano.faturas.length + plano.documentos.length + plano.baixas.length === 0}>Gravar migração</Button>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-slate-800">Confirma a gravação?</span>
                    <Button onClick={gravar} isLoading={!!gravando}>{gravando || 'Sim, gravar'}</Button>
                    <Button variant="ghost" onClick={() => setConfirmando(false)} disabled={!!gravando}>Voltar</Button>
                  </>
                )}
              </div>
            ) : <p className="text-xs text-slate-500">Somente administradores gravam a migração.</p>}
          </section>
        </>
      )}
    </div>
  );
};
