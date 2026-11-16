import React, { useState } from 'react';
import { Invoice } from '../../types';
import { LIMITE_ANEXO_MB, anexarArquivosFatura, linkAnexoContestacao, removerAnexoFatura } from '../../services/fase4Service';
import { notify } from '../../utils/notify';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

const kb = (n?: number) => (n ? `${Math.max(1, Math.round(n / 1024)).toLocaleString('pt-BR')} KB` : '');

/** Arquivos anexados à fatura (ofício, e-mail, leitura do medidor...). Saem junto com o PDF da fatura (PDF e imagens). */
export const AnexosFaturaModal: React.FC<{ fatura: Invoice | null; onClose: () => void; onMudou: () => Promise<void>; podeEditar: boolean }> = ({ fatura, onClose, onMudou, podeEditar }) => {
  const [arqs, setArqs] = useState<File[]>([]);
  const [chave, setChave] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  if (!fatura) return null;
  const lista = (fatura.anexos || []).filter(a => a.caminho);
  const executar = async (fn: () => Promise<void>, ok: string) => {
    setOcupado(true);
    try { await fn(); notify.success(ok); await onMudou(); } catch (e) { notify.fail('Não foi possível concluir', e); } finally { setOcupado(false); }
  };
  return (
    <Modal isOpen onClose={onClose} title={`Anexos da fatura ${fatura.invoiceNumber}`} maxWidth="max-w-xl">
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">{fatura.client} · {fatura.type} · {fatura.competence}. Os anexos em PDF e imagem (PNG/JPG) saem nas páginas seguintes ao imprimir o PDF da fatura. Os arquivos anexados na contestação também.</p>
        {lista.length === 0 ? <p className="text-slate-400">Nenhum arquivo anexado a esta fatura.</p> : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {lista.map(a => (
              <li key={a.caminho} className="flex items-center gap-2 px-3 py-2">
                <button type="button" className="text-primary-700 underline text-left flex-1 truncate" title="Abrir o arquivo"
                  onClick={async () => { try { window.open(await linkAnexoContestacao(a.caminho!), '_blank', 'noopener'); } catch (e) { notify.fail('Não foi possível abrir o arquivo', e); } }}>📎 {a.nome}</button>
                <span className="text-xs text-slate-400">{kb(a.tamanho)}</span>
                {podeEditar && <button type="button" className="text-xs text-red-700 underline disabled:opacity-40" disabled={ocupado}
                  onClick={() => { if (window.confirm(`Remover o anexo "${a.nome}" da fatura?`)) executar(() => removerAnexoFatura(fatura, a), 'Anexo removido.'); }}>remover</button>}
              </li>
            ))}
          </ul>
        )}
        {podeEditar && (
          <div className="p-3 rounded-lg border border-slate-200 space-y-2">
            <div className="text-xs font-semibold text-slate-600">Anexar arquivos (PDF, imagem, e-mail; até {LIMITE_ANEXO_MB} MB cada)</div>
            <div className="flex flex-wrap gap-2 items-center">
              <input key={chave} type="file" multiple aria-label="Anexar arquivos à fatura" className="text-xs" onChange={e => setArqs(Array.from(e.target.files || []))} />
              <Button variant="secondary" disabled={!arqs.length || ocupado} isLoading={ocupado}
                onClick={() => executar(async () => { await anexarArquivosFatura(fatura, arqs); setArqs([]); setChave(k => k + 1); }, 'Arquivo(s) anexado(s) à fatura.')}>Anexar{arqs.length > 1 ? ` (${arqs.length})` : ''}</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
