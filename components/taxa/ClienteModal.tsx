import React, { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { entrada } from '../faturamento/comum';
import { cadastroService } from '../../services/cadastroService';
import { OM } from '../../types';
import { notify } from '../../utils/notify';
import { normalizar } from '../../utils/taxaCondominialImport';

/**
 * Escolher um cliente do cadastro (inclusive desativados e OM fora da Ilha) ou criar um novo na hora.
 * Usado para incluir clientes na taxa condominial e nas diárias e para resolver nomes da planilha sem correspondente.
 */
export const ClienteModal: React.FC<{
  aberto: boolean; titulo: string; oms: OM[]; tipo?: 'TERRA' | 'NAVIO'; nomeSugerido?: string;
  onEscolher: (om: OM) => void | Promise<void>; onFechar: () => void;
}> = ({ aberto, titulo, oms, tipo, nomeSugerido = '', onEscolher, onFechar }) => {
  const [busca, setBusca] = useState('');
  const [novo, setNovo] = useState<{ nome: string; sigla: string; codigo: string; tipo: 'TERRA' | 'NAVIO' | 'EXTRA_MB'; foraDaIlha: boolean } | null>(null);
  const [gravando, setGravando] = useState(false);
  const termo = busca || nomeSugerido;
  const lista = useMemo(() => {
    const t = normalizar(termo.replace(/\(.*?\)/g, ''));
    const palavras = t.split(' ').filter(p => p.length > 2);
    return oms
      .filter(o => !tipo || (tipo === 'NAVIO') === (o.tipo === 'NAVIO'))
      .map(o => {
        const alvo = normalizar(`${o.nome} ${o.sigla || ''} ${(o.nomesAlternativos || []).join(' ')} ${o.codigo}`);
        const pontos = !t ? 1 : palavras.filter(p => alvo.includes(p)).length + (alvo.includes(t) ? 5 : 0);
        return { o, pontos };
      })
      .filter(x => !busca || x.pontos > 0)
      .sort((a, b) => b.pontos - a.pontos || Number(b.o.ativo) - Number(a.o.ativo) || a.o.nome.localeCompare(b.o.nome))
      .slice(0, 60);
  }, [oms, termo, busca, tipo]);

  const criar = async () => {
    if (!novo?.nome.trim()) return;
    if (novo.codigo && !/^\d{4,6}$/.test(novo.codigo)) { notify.error('Código deve ter de 4 a 6 dígitos (ou deixe em branco).'); return; }
    setGravando(true);
    try {
      const om: Partial<OM> = { nome: novo.nome.trim(), sigla: novo.sigla.trim() || null, codigo: novo.codigo || undefined, tipo: novo.tipo, ativo: true, foraDaIlha: novo.foraDaIlha, observacao: 'Incluída pela tela Taxa condominial e diárias' };
      const id = await cadastroService.criarOM(om);
      notify.success(`Cliente "${om.nome}" criado no cadastro.`);
      await onEscolher({ ...(om as OM), id, codigo: novo.codigo || '40015', codigoProprio: !!novo.codigo, nomesAlternativos: [] });
      setNovo(null); setBusca('');
    } catch (e) { notify.fail('Erro ao criar o cliente', e); } finally { setGravando(false); }
  };

  return (
    <Modal isOpen={aberto} onClose={() => { setNovo(null); setBusca(''); onFechar(); }} title={titulo} maxWidth="max-w-2xl">
      {!novo ? (
        <div className="space-y-3 text-sm">
          {nomeSugerido && <p className="text-slate-600">Na planilha: <b>{nomeSugerido}</b>. Escolha o cliente correspondente ou crie um novo.</p>}
          <div className="flex gap-2">
            <label className="relative flex-1"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" />
              <input autoFocus className={`${entrada} w-full pl-7`} placeholder="Buscar por nome, sigla, código ou abreviação..." value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar cliente" />
            </label>
            <Button variant="secondary" onClick={() => setNovo({ nome: nomeSugerido.replace(/\s*\(.*?\)\s*/g, ' ').trim() || busca, sigla: '', codigo: '', tipo: tipo || 'TERRA', foraDaIlha: false })}><Plus size={14} className="mr-1" />Criar novo cliente</Button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {lista.map(({ o }) => (
              <button key={o.id} type="button" onClick={() => onEscolher(o)} className="w-full text-left px-3 py-2 hover:bg-primary-50 flex items-center gap-2">
                <span className="flex-1">
                  <span className="font-medium text-slate-800">{o.nome}</span>{o.sigla && <span className="text-slate-500"> · {o.sigla}</span>}
                  <span className="block text-[11px] text-slate-500">{o.codigo} · {o.tipo === 'NAVIO' ? 'navio' : o.tipo === 'EXTRA_MB' ? 'extra-MB' : 'terra'}{o.foraDaIlha ? ' · fora da Ilha' : ''}{(o.nomesAlternativos || []).length ? ` · também: ${o.nomesAlternativos!.join(', ')}` : ''}</span>
                </span>
                {!o.ativo && <span className="text-[10px] bg-slate-200 text-slate-700 rounded px-1.5 py-0.5">desativada</span>}
              </button>
            ))}
            {!lista.length && <div className="p-4 text-slate-400">Nenhum cliente encontrado. Use "Criar novo cliente".</div>}
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <label className="block">Nome<input className={`${entrada} w-full`} value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} aria-label="Nome do novo cliente" /></label>
          <div className="grid grid-cols-3 gap-2">
            <label>Sigla<input className={`${entrada} w-full`} value={novo.sigla} onChange={e => setNovo({ ...novo, sigla: e.target.value })} aria-label="Sigla do novo cliente" /></label>
            <label>Código (UG)<input className={`${entrada} w-full`} placeholder="vazio = 40015" value={novo.codigo} onChange={e => setNovo({ ...novo, codigo: e.target.value.replace(/\D/g, '') })} aria-label="Código do novo cliente" /></label>
            <label>Tipo<select className={`${entrada} w-full`} value={novo.tipo} onChange={e => setNovo({ ...novo, tipo: e.target.value as any })} aria-label="Tipo do novo cliente">
              <option value="TERRA">OM de terra</option><option value="NAVIO">Navio</option><option value="EXTRA_MB">Extra-Marinha</option>
            </select></label>
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={novo.foraDaIlha} onChange={e => setNovo({ ...novo, foraDaIlha: e.target.checked })} /> OM fora da Ilha das Cobras</label>
          <p className="text-xs text-slate-500">Os demais dados (comando, setor, indicativo, e-mails) podem ser completados depois em Cadastros.</p>
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setNovo(null)}>Voltar</Button><Button onClick={criar} isLoading={gravando} disabled={!novo.nome.trim()}>Criar e usar</Button></div>
        </div>
      )}
    </Modal>
  );
};
