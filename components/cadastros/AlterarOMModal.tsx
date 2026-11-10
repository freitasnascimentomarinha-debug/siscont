import React, { useEffect, useMemo, useState } from 'react';
import { History, Info } from 'lucide-react';
import { OM, OMHistorico } from '../../types';
import { cadastroService } from '../../services/cadastroService';
import { db } from '../../services/db';
import { criarResolvedor } from '../../utils/documentosOM';
import { ROTULO_CAMPO, mudancasAgrupadas } from '../../utils/historicoOM';
import { hojeISO, dataBR } from '../../utils/datas';
import { notify, friendlyError } from '../../utils/notify';
import { Modal } from '../ui/Modal';
import { Input, Select } from '../ui/Input';
import { Button } from '../ui/Button';
import { DadosCadastro } from './useCadastros';

const brl = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Mudou de nome, de UG ou de comando? Registra a mudança com a data em que passou a valer (operador e administrador).
 * Fatura já emitida não é alterada: o número e o texto da época ficam como saíram. O nome e a UG antigos continuam
 * reconhecidos nas planilhas, nas ALTCRED/GRU e no PDF do SIPLAD.
 */
export const AlterarOMModal: React.FC<{ om: OM | null; dados: DadosCadastro; onClose: () => void; onFeito: () => Promise<void> }> = ({ om, dados, onClose, onFeito }) => {
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [comandoId, setComandoId] = useState('');
  const [setorId, setSetorId] = useState('');
  const [sigla, setSigla] = useState('');
  const [vigencia, setVigencia] = useState(hojeISO());
  const [ato, setAto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [historico, setHistorico] = useState<OMHistorico[]>([]);
  const [impacto, setImpacto] = useState<{ faturas: number; saldoFaturas: number; docs: number; saldoDocs: number } | null>(null);

  useEffect(() => {
    if (!om) return;
    setNome(''); setCodigo(''); setComandoId(''); setSetorId(''); setSigla(''); setVigencia(hojeISO()); setAto(''); setMotivo(''); setErro(null); setImpacto(null);
    cadastroService.listarHistoricoOM(om.id).then(setHistorico).catch(() => setHistorico([]));
    Promise.all([db.getInvoices(), db.getDocuments()]).then(([invs, docs]) => {
      const res = criarResolvedor(dados.oms, dados.comandos, dados.setores);
      const fs = invs.filter(i => i.omId === om.id && !i.isCanceled && (i.saldoAPagar ?? 0) > 0.005);
      const ds = docs.filter(d => d.availableValue > 0.005 && res.omDoDocumento(d)?.id === om.id);
      setImpacto({ faturas: fs.length, saldoFaturas: fs.reduce((s, i) => s + (i.saldoAPagar ?? 0), 0), docs: ds.length, saldoDocs: ds.reduce((s, d) => s + d.availableValue, 0) });
    }).catch(() => setImpacto(null));
  }, [om, dados.oms, dados.comandos, dados.setores]);

  const cmd = useMemo(() => new Map(dados.comandos.map(c => [c.id, c])), [dados.comandos]);
  const set = useMemo(() => new Map(dados.setores.map(s => [s.id, s])), [dados.setores]);
  const rotCmd = (id?: string | null) => { const c = id ? cmd.get(id) : undefined; return c ? `${c.codigo ? c.codigo + ' - ' : ''}${c.nome}` : '—'; };
  if (!om) return null;

  const mudancas: { campo: string; de: string; para: string }[] = [];
  if (nome.trim() && nome.trim() !== om.nome) mudancas.push({ campo: 'Nome', de: om.nome, para: nome.trim() });
  if (codigo.trim() && codigo.trim() !== om.codigo) mudancas.push({ campo: 'UG', de: om.codigo, para: codigo.trim() });
  if (comandoId && comandoId !== om.comandoId) mudancas.push({ campo: 'Comando', de: rotCmd(om.comandoId), para: rotCmd(comandoId) });
  if (setorId && setorId !== om.setorId) mudancas.push({ campo: 'Setor', de: (om.setorId && set.get(om.setorId)?.sigla) || '—', para: set.get(setorId)?.sigla || '' });
  if (sigla.trim() && sigla.trim() !== (om.sigla || '')) mudancas.push({ campo: 'Sigla', de: om.sigla || '—', para: sigla.trim() });

  const registrar = async () => {
    setErro(null);
    if (!mudancas.length) return setErro('Informe pelo menos uma mudança: novo nome, UG, comando, setor ou sigla.');
    if (codigo.trim() && !/^\d{4,6}$/.test(codigo.trim())) return setErro('A UG deve ter de 4 a 6 dígitos.');
    if (!vigencia) return setErro('Informe a data em que a mudança passou a valer.');
    if (vigencia > hojeISO()) return setErro('A data de vigência não pode ser futura: registre quando a mudança entrar em vigor.');
    setSalvando(true);
    try {
      await cadastroService.alterarDadosOM({ omId: om.id, nome: nome.trim(), codigo: codigo.trim(), comandoId, setorId, sigla: sigla.trim(), vigencia, motivo, ato });
      notify.success(`Mudança registrada em ${om.nome}, valendo desde ${dataBR(vigencia)}.`);
      db.invalidateCache('clients', 'raw_invoices', 'raw_documents');
      await onFeito();
      onClose();
    } catch (e) { setErro(friendlyError(e)); } finally { setSalvando(false); }
  };

  const grupos = mudancasAgrupadas(historico);

  return (
    <Modal isOpen onClose={() => !salvando && onClose()} title={`Alterar dados com vigência — ${om.codigo} · ${om.nome}`} maxWidth="max-w-3xl"
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose} disabled={salvando}>Cancelar</Button><Button onClick={registrar} isLoading={salvando} disabled={!mudancas.length}>Registrar mudança</Button></div>}>
      <div className="space-y-4 text-sm">
        <p className="p-3 rounded-lg bg-sky-50 border border-sky-200 text-sky-900 flex gap-2"><Info size={16} className="shrink-0 mt-0.5" />
          <span>Faturas já emitidas <b>não mudam</b>: o número e o texto da época ficam como saíram. A mudança vale para o que for emitido a partir da data de vigência. O nome e a UG antigos continuam reconhecidos nas planilhas, nas ALTCRED/GRU e no PDF do SIPLAD. A sequência das faturas continua a mesma.</span></p>
        {erro && <div className="p-2 text-xs rounded bg-red-50 text-red-700 border border-red-100" role="alert">{erro}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Novo nome" value={nome} onChange={e => setNome(e.target.value)} placeholder={om.nome} />
          <Input label="Nova UG (4 a 6 dígitos)" inputMode="numeric" maxLength={6} value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))} placeholder={om.codigo} />
          <Select label="Novo comando (subordinação)" value={comandoId} onChange={e => setComandoId(e.target.value)}
            options={[{ value: '', label: `Continua: ${rotCmd(om.comandoId)}` }, ...dados.comandos.filter(c => c.ativo).sort((a, b) => (a.codigo || 'zz').localeCompare(b.codigo || 'zz')).map(c => ({ value: c.id, label: `${c.codigo ? c.codigo + ' - ' : ''}${c.nome}` }))]} />
          <Select label="Novo setor" value={setorId} onChange={e => setSetorId(e.target.value)}
            options={[{ value: '', label: `Continua: ${(om.setorId && set.get(om.setorId)?.sigla) || 'o do comando'}` }, ...dados.setores.map(s => ({ value: s.id, label: s.sigla }))]} />
          <Input label="Nova sigla" value={sigla} onChange={e => setSigla(e.target.value)} placeholder={om.sigla || ''} />
          <Input label="Data de vigência (a partir de quando vale)" type="date" max={hojeISO()} value={vigencia} onChange={e => setVigencia(e.target.value)} />
          <Input label="Ato (portaria, BONO, ordem...)" value={ato} onChange={e => setAto(e.target.value)} placeholder="Ex.: Portaria nº 29/2026" />
          <Input label="Motivo" value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ex.: reestruturação da organização" />
        </div>

        {mudancas.length > 0 && (
          <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 space-y-1" data-testid="resumo-mudancas">
            <div className="text-xs font-semibold uppercase text-emerald-800">O que vai mudar (desde {dataBR(vigencia)})</div>
            {mudancas.map(m => <div key={m.campo}><b>{m.campo}:</b> {m.de} <span className="text-slate-400">→</span> <b>{m.para}</b></div>)}
            {impacto && <div className="text-xs text-slate-600 pt-1">Impacto: {impacto.faturas} fatura(s) em aberto ({brl(impacto.saldoFaturas)}) mantêm o número e continuam ligadas à OM; {impacto.docs} ALTCRED/GRU com saldo ({brl(impacto.saldoDocs)}) continuam ligadas pelo nome e pela UG antigos.</div>}
          </div>
        )}

        <div>
          <h4 className="font-semibold text-slate-700 flex items-center gap-1.5 mb-1"><History size={14} /> Linha do tempo desta OM</h4>
          {grupos.length === 0 ? <p className="text-xs text-slate-500">Nenhuma mudança registrada ainda.</p> : (
            <ul className="space-y-1.5" data-testid="linha-do-tempo">
              {grupos.map(g => (
                <li key={g.chave} className="text-xs border-l-2 border-primary-300 pl-2">
                  <div className="font-semibold text-slate-700">Desde {dataBR(g.vigenteDesde)}{g.ato ? ` · ${g.ato}` : ''}{g.motivo ? ` · ${g.motivo}` : ''}</div>
                  {g.campos.map(c => <div key={c.id} className="text-slate-600">{ROTULO_CAMPO[c.campo]}: {c.rotuloAnterior || '—'} → {c.rotuloNovo || '—'}</div>)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
};
