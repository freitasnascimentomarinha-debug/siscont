import React, { useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
// @ts-ignore - pacote xlsx sem tipos completos no build
import * as XLSX from 'xlsx';
import { Button } from '../ui/Button';
import { MultiFiltro } from '../ui/MultiFiltro';
import { notify } from '../../utils/notify';
import { TIPO_OM_LABELS } from '../../types';
import { DadosCadastro } from './useCadastros';
import { FILTRO_VAZIO, FiltroOM, Situacao, filtrarOMs, linhasClasses, linhasComandos, linhasOMs, linhasServicos, linhasSetores, nomeClasse, nomeComando, nomeSetor } from '../../utils/exportarCadastros';

type Planilha = 'oms' | 'comandos' | 'setores' | 'classes' | 'servicos';
const PLANILHAS: { id: Planilha; label: string; aba: string }[] = [
  { id: 'oms', label: 'OM / Clientes (inclui navios)', aba: 'OM_CLIENTES' },
  { id: 'comandos', label: 'Comandos', aba: 'COMANDOS' },
  { id: 'setores', label: 'Setores', aba: 'SETORES' },
  { id: 'classes', label: 'Classes de navio', aba: 'CLASSES' },
  { id: 'servicos', label: 'Serviços', aba: 'SERVICOS' },
];

/** Exporta os cadastros para .xlsx. Os filtros valem para OM / Clientes; a situação vale para todas as planilhas. */
export const ExportarTab: React.FC<{ dados: DadosCadastro }> = ({ dados }) => {
  const [sel, setSel] = useState<Set<Planilha>>(new Set(['oms']));
  const [f, setF] = useState<FiltroOM>(FILTRO_VAZIO);
  const set = (p: Partial<FiltroOM>) => setF(x => ({ ...x, ...p }));
  const e = useMemo(() => ({ setores: dados.setores, comandos: dados.comandos, classes: dados.classes }), [dados]);
  const omsFiltradas = useMemo(() => filtrarOMs(dados.oms, e, f), [dados.oms, e, f]);
  const uniq = (l: string[]) => [...new Set(l)].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const opTipos = Object.values(TIPO_OM_LABELS);
  const opSetores = useMemo(() => uniq(dados.oms.map(o => nomeSetor(e, o.setorId))), [dados.oms, e]);
  const opComandos = useMemo(() => uniq(dados.oms.map(o => nomeComando(e, o.comandoId))), [dados.oms, e]);
  const opClasses = useMemo(() => uniq(dados.oms.filter(o => o.tipo === 'NAVIO').map(o => nomeClasse(e, o.classeId))), [dados.oms, e]);
  const alternar = (id: Planilha) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const filtrado = f.situacao !== 'TODAS' || f.busca || f.foraDaIlha !== 'TODAS' || f.tiposExcluidos.size || f.setoresExcluidos.size || f.comandosExcluidos.size || f.classesExcluidas.size;

  const exportar = () => {
    try {
      const wb = XLSX.utils.book_new();
      const add = (nome: string, linhas: any[][]) => {
        const ws = XLSX.utils.aoa_to_sheet(linhas);
        ws['!cols'] = linhas[0].map((_: any, i: number) => ({ wch: Math.min(60, Math.max(10, ...linhas.slice(0, 200).map(l => String(l[i] ?? '').length))) }));
        XLSX.utils.book_append_sheet(wb, ws, nome);
      };
      if (sel.has('oms')) add('OM_CLIENTES', linhasOMs(omsFiltradas, e));
      if (sel.has('comandos')) add('COMANDOS', linhasComandos(e, f.situacao));
      if (sel.has('setores')) add('SETORES', linhasSetores(e, f.situacao));
      if (sel.has('classes')) add('CLASSES', linhasClasses(e, dados.oms, f.situacao));
      if (sel.has('servicos')) add('SERVICOS', linhasServicos(dados.servicos, f.situacao));
      if (!wb.SheetNames.length) { notify.error('Marque pelo menos uma planilha para exportar.'); return; }
      XLSX.writeFile(wb, `cadastros_siscont_${new Date().toISOString().slice(0, 10)}.xlsx`);
      notify.success(`Planilha gerada${sel.has('oms') ? ` com ${omsFiltradas.length} OM/clientes` : ''}.`);
    } catch (err) { notify.fail('Erro ao gerar a planilha', err); }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Escolha o que exportar e, se quiser, filtre. Cada cadastro vira uma aba da planilha .xlsx.</p>
      <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
        <legend className="text-xs font-semibold text-slate-600 mb-1">Planilhas (abas)</legend>
        {PLANILHAS.map(p => (
          <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.has(p.id)} onChange={() => alternar(p.id)} />{p.label}</label>
        ))}
      </fieldset>

      <div className="flex flex-wrap items-end gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
        <label className="text-xs font-semibold text-slate-600">Situação (todas as planilhas)
          <select className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={f.situacao} onChange={ev => set({ situacao: ev.target.value as Situacao })}>
            <option value="TODAS">Ativos e desativados</option><option value="ATIVAS">Só ativos</option><option value="DESATIVADAS">Só desativados</option>
          </select></label>
        {sel.has('oms') && <>
          <MultiFiltro rotulo="Tipo" opcoes={opTipos} excluidos={f.tiposExcluidos} onChange={x => set({ tiposExcluidos: x })} largura="w-56" />
          <MultiFiltro rotulo="Setor" opcoes={opSetores} excluidos={f.setoresExcluidos} onChange={x => set({ setoresExcluidos: x })} />
          <MultiFiltro rotulo="Comando" opcoes={opComandos} excluidos={f.comandosExcluidos} onChange={x => set({ comandosExcluidos: x })} largura="w-96" />
          <MultiFiltro rotulo="Classe (navios)" opcoes={opClasses} excluidos={f.classesExcluidas} onChange={x => set({ classesExcluidas: x })} largura="w-96" />
          <label className="text-xs font-semibold text-slate-600">Fora da Ilha
            <select className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white" value={f.foraDaIlha} onChange={ev => set({ foraDaIlha: ev.target.value as FiltroOM['foraDaIlha'] })}>
              <option value="TODAS">Todas</option><option value="SIM">Só fora da Ilha</option><option value="NAO">Só dentro da Ilha</option>
            </select></label>
          <label className="text-xs font-semibold text-slate-600">Buscar (nome, código, sigla)
            <input className="mt-1 block text-sm font-normal border border-slate-300 rounded-md px-2 py-1.5 bg-white w-56" value={f.busca} onChange={ev => set({ busca: ev.target.value })} /></label>
        </>}
        {filtrado ? <button type="button" className="text-sm text-primary-700 underline pb-2" onClick={() => setF(FILTRO_VAZIO)}>limpar filtros</button> : null}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <Button onClick={exportar} disabled={!sel.size}><FileDown size={16} className="mr-2" />Exportar planilha (.xlsx)</Button>
        {sel.has('oms') && <span className="text-sm text-slate-600"><b>{omsFiltradas.length}</b> de {dados.oms.length} OM/clientes{filtrado ? ' (com filtros)' : ''} serão exportados.</span>}
      </div>
    </div>
  );
};
