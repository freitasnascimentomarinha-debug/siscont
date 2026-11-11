/** Relatórios do encerramento do exercício (funções puras): cada um devolve cabeçalho e linhas, para Excel e PDF. */
import { LinhaEncerramento, IndicadoresEncerramento, SITUACOES } from './encerramento';
import { MovCredito, ROTULO_MOV, creditosDaOm, extratoDaOm } from './creditosOm';
import { rotuloRegime } from './regimeOnd';
import { mesesDoAno } from './faturamento';

const dinheiro = (n: number | null | undefined) => (n === null || n === undefined ? '' : n);
export interface RelatorioEnc { id: string; titulo: string; head: string[]; rows: (string | number)[][]; /** colunas de valores (alinhadas à direita no PDF) */ valores: number[] }

export const RELATORIOS_ENC = [
  { id: 'participantes', rotulo: '1. OMs e serviços participantes da estimativa' },
  { id: 'estimativas', rotulo: '2. Faturas estimativas emitidas' },
  { id: 'pendentes', rotulo: '3. Subsídios reais pendentes' },
  { id: 'estimativa_real', rotulo: '4. Estimativa × consumo real' },
  { id: 'creditos', rotulo: '5. Créditos gerados por OM' },
  { id: 'extrato', rotulo: '6. Extrato de utilização de créditos' },
  { id: 'debitos', rotulo: '7. Débitos complementares' },
  { id: 'consolidado', rotulo: '8. Demonstrativo consolidado do encerramento' },
] as const;

export function montarRelatorio(id: typeof RELATORIOS_ENC[number]['id'], ano: number, ls: LinhaEncerramento[], livro: MovCredito[], nomeOm: (id: string) => string, ind: IndicadoresEncerramento): RelatorioEnc {
  const r1 = ls.filter(l => l.regime === 1);
  const sit = (l: LinhaEncerramento) => l.situacao as string;
  switch (id) {
    case 'participantes': return { id, titulo: `OMs e serviços participantes da estimativa — ${ano}`, head: ['UG', 'OM', 'Serviço', 'Regime', 'Origem da regra', 'Desde o exercício'],
      rows: r1.map(l => [l.ug, l.omNome, l.sigla, rotuloRegime(l.regime), l.regimeEfetivo.origem === 'EXCECAO' ? 'Exceção da OM' : 'Regra do serviço', l.regimeEfetivo.desde ?? '']), valores: [] };
    case 'estimativas': return { id, titulo: `Faturas estimativas emitidas — ${ano} (OUT, NOV e DEZ)`, head: ['Fatura', 'UG', 'OM', 'Serviço', 'Total JAN–AGO', 'Média mensal (÷ 8)', 'Estimado (3 × média)', 'Valor da fatura'],
      rows: r1.filter(l => l.estimativa).map(l => [l.estimativa!.numero, l.ug, l.omNome, l.sigla, l.totalJanAgo, l.mediaMensal, l.estimadoCalculado, l.estimado ?? 0]), valores: [4, 5, 6, 7] };
    case 'pendentes': return { id, titulo: `Subsídios reais pendentes — ${ano}`, head: ['UG', 'OM', 'Serviço', 'Faltam lançar', 'Situação'],
      rows: r1.filter(l => l.estimativa && l.lancados < 3 && !l.apuracao).map(l => [l.ug, l.omNome, l.sigla, l.reais.filter(r => r.valor === null).map(r => mesesDoAno[r.mes - 1]).join(', '), sit(l)]), valores: [] };
    case 'estimativa_real': return { id, titulo: `Estimativa × consumo real — ${ano}`, head: ['OM', 'Serviço', 'Estimado', 'Real OUT', 'Real NOV', 'Real DEZ', 'Total real', 'Diferença', 'Resultado'],
      rows: r1.filter(l => l.estimativa).map(l => [l.omNome, l.sigla, dinheiro(l.estimado), ...l.reais.map(r => dinheiro(r.valor)), dinheiro(l.totalReal), dinheiro(l.diferenca), l.resultado === 'DEBITO' ? 'Débito complementar' : l.resultado === 'CREDITO' ? 'Crédito' : l.resultado === 'SEM_DIFERENCA' ? 'Sem diferença' : 'Aguardando']), valores: [2, 3, 4, 5, 6, 7] };
    case 'creditos': return { id, titulo: 'Créditos gerados por OM (acertos e saldos de abertura)', head: ['OM', 'Data', 'Tipo', 'Serviço', 'Exercício', 'Origem', 'Crédito', 'Saldo atual'],
      rows: creditosDaOm(livro, undefined, true).map(c => [nomeOm(c.omId), c.data, c.tipo === 'ABERTURA' ? 'Saldo de abertura' : 'Acerto', c.servico, c.exercicio ?? '', c.numero, c.valor, c.saldo]), valores: [6, 7] };
    case 'extrato': {
      const oms = [...new Set(livro.map(m => m.omId))];
      return { id, titulo: 'Extrato de utilização de créditos', head: ['OM', 'Data', 'Movimento', 'Fatura / documento', 'Valor', 'Saldo após'],
        rows: oms.flatMap(o => extratoDaOm(livro, o).filter(m => m.tipo !== 'ENTRADA_ACERTO' && m.tipo !== 'ABERTURA').map(m => [nomeOm(o), m.data, ROTULO_MOV[m.tipo], m.destinoNumero || m.documento || '', m.valor, m.saldoApos])), valores: [4, 5] };
    }
    case 'debitos': return { id, titulo: `Débitos complementares — ${ano}`, head: ['OM', 'Serviço', 'Estimativa', 'Fatura de acerto', 'Estimado', 'Real', 'Débito'],
      rows: r1.filter(l => l.resultado === 'DEBITO' && (l.apuracao || l.situacao === 'Fatura complementar gerada')).map(l => [l.omNome, l.sigla, l.estimativa?.numero ?? '', l.apuracao?.acertoNumero ?? '', dinheiro(l.estimado), dinheiro(l.apuracao ? l.apuracao.real : l.totalReal), Math.abs(l.apuracao ? l.apuracao.diferenca : l.diferenca ?? 0)]), valores: [4, 5, 6] };
    default: {
      const conta = SITUACOES.map(s => [s as string, r1.filter(l => l.situacao === s).length] as [string, number]).filter(([, n]) => n > 0);
      return { id: 'consolidado', titulo: `Demonstrativo consolidado do encerramento — ${ano}`, head: ['Indicador', 'Valor'],
        rows: [
          ['OMs participantes da estimativa', ind.omsParticipantes], ['Serviços estimados (OM × serviço)', ind.servicosEstimados], ['Faturas estimativas emitidas', ind.faturasEstimativas], ['Valor total estimado', ind.valorEstimado],
          ['Subsídios reais pendentes (meses)', ind.subsidiosPendentes], ['Apurações concluídas', ind.apuracoesConcluidas], ['Créditos gerados', ind.creditosGerados], ['Débitos complementares', ind.debitosComplementares],
          ['Saldo total de créditos disponíveis', ind.saldoCreditos], ...conta.map(([s, n]) => [`Situação: ${s}`, n] as (string | number)[]),
        ], valores: [1] };
    }
  }
}
