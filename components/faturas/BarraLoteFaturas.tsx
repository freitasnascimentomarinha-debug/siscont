import React, { useState } from 'react';
import { marcarFaturas, marcarSiplad } from '../../services/faturamentoService';
import { hojeISO } from '../../utils/datas';
import { notify } from '../../utils/notify';
import { Button } from '../ui/Button';

/** Barra que aparece com faturas selecionadas: marca SIPLAD, envio, certificação e SIAFI de uma vez. */
export const BarraLoteFaturas: React.FC<{
  selecionadas: string[]; totalFiltradas: number; selecionouTodas: boolean;
  onSelecionarFiltradas: () => void; onLimpar: () => void; onFeito: () => Promise<void> | void;
}> = ({ selecionadas, totalFiltradas, selecionouTodas, onSelecionarFiltradas, onLimpar, onFeito }) => {
  const [ocupado, setOcupado] = useState<string | null>(null);
  if (!selecionadas.length) return null;

  const rodar = async (rotulo: string, f: () => Promise<void>) => {
    setOcupado(rotulo);
    try { await f(); notify.success(`${selecionadas.length} fatura(s): ${rotulo}.`); onLimpar(); await onFeito(); }
    catch (e) { notify.fail(`Erro: ${rotulo}`, e); } finally { setOcupado(null); }
  };
  const hoje = hojeISO();
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 p-3 rounded-lg border border-primary-200 bg-primary-50 text-sm" role="region" aria-label="Ações em lote">
      <b>{selecionadas.length} selecionada(s)</b>
      {!selecionouTodas && totalFiltradas > selecionadas.length && <button type="button" className="text-primary-700 underline" onClick={onSelecionarFiltradas}>selecionar as {totalFiltradas} do filtro</button>}
      <span className="flex-1" />
      <Button size="sm" variant="secondary" isLoading={ocupado === 'SIPLAD lançado'} onClick={() => rodar('SIPLAD lançado', () => marcarSiplad(selecionadas, true))}>SIPLAD: lançado</Button>
      <Button size="sm" variant="secondary" isLoading={ocupado === 'SIPLAD pendente'} onClick={() => rodar('SIPLAD pendente', () => marcarSiplad(selecionadas, false))}>SIPLAD: pendente</Button>
      <Button size="sm" variant="secondary" isLoading={ocupado === 'marcadas como enviadas'} onClick={() => rodar('marcadas como enviadas', () => marcarFaturas(selecionadas, 'enviada_em', hoje))}>Enviadas hoje</Button>
      <Button size="sm" variant="secondary" isLoading={ocupado === 'marcadas como certificadas'} onClick={() => rodar('marcadas como certificadas', () => marcarFaturas(selecionadas, 'certificada_em', hoje))}>Certificadas hoje</Button>
      <Button size="sm" variant="secondary" isLoading={ocupado === 'registradas no SIAFI'} onClick={() => rodar('registradas no SIAFI', () => marcarFaturas(selecionadas, 'siafi_em', hoje))}>SIAFI hoje</Button>
      <Button size="sm" variant="ghost" onClick={onLimpar} disabled={!!ocupado}>Limpar seleção</Button>
    </div>
  );
};
