import React from 'react';
import { History } from 'lucide-react';
import { anoCorrente, exercicio, useExercicio } from '../../services/exercicio';

/**
 * Quantos anos de faturas as telas carregam. "Todos os anos" é o padrão (tudo como sempre foi).
 * Com uma janela, entram as faturas dos anos escolhidos E as que ainda têm saldo em aberto ou contestação (de qualquer ano),
 * mais os documentos e baixas ligados a elas: o que vale dinheiro nunca some. Fica guardado só neste navegador.
 */
export const SeletorExercicio: React.FC = () => {
  const desde = useExercicio();
  const a = anoCorrente();
  const opcoes = [a - 1, a - 2, a - 3];
  if (desde !== null && !opcoes.includes(desde)) opcoes.push(desde);
  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2 text-xs text-slate-600" data-testid="seletor-exercicio">
      <History size={14} className="text-slate-400" aria-hidden />
      <label className="flex items-center gap-1.5">Anos carregados
        <select aria-label="Anos carregados" value={desde === null ? 'todos' : String(desde)} onChange={e => exercicio.set(e.target.value === 'todos' ? null : Number(e.target.value))}
          className="border border-slate-300 rounded-md px-2 py-1 bg-white text-slate-700"
          title="Carregar menos anos deixa o sistema mais rápido. Faturas ainda em aberto ou contestadas aparecem sempre, de qualquer ano.">
          <option value="todos">Todos os anos</option>
          {opcoes.sort((x, y) => y - x).map(o => <option key={o} value={o}>{`Desde ${o} (${o}–${a})`}</option>)}
        </select>
      </label>
      {desde !== null && (
        <span className="text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5" role="status">
          Mostrando de {desde} em diante, mais tudo o que está em aberto ou contestado. Faturas antigas já pagas ficam fora.
          {' '}<button type="button" className="underline font-semibold" onClick={() => exercicio.set(null)}>Mostrar todos os anos</button>
        </span>
      )}
    </div>
  );
};
