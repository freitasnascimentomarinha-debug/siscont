import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, FileSpreadsheet, FileText, Mail, Pencil, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { cadastroService } from '../services/cadastroService';
import { marcarFaturas } from '../services/faturamentoService';
import { carregarExtraMB } from '../services/extraMBService';
import { useAuth } from '../context/AuthContext';
import { OM, podeEditarDados } from '../types';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { notify } from '../utils/notify';
import { dataBR, hojeISO } from '../utils/datas';
import { AlertaEx, ContratoEx, FaturaEx, GruEx, SituacaoEx, alertaGru, alertasContratos, alertasGru, atrasoEx, brlEx, fiscalTexto, emailEnvio, resumoExtraMB, siglaFatura, situacaoEx } from '../utils/extraMB';
import { TEMA, cabecalhoCompacto, fimDaTabela, salvarPdf, tabelaPdf, tituloRelatorio } from '../utils/pdfCabecalho';

type Aba = 'resumo' | 'faturas' | 'gru' | 'extrato' | 'email' | 'contratos';
const COR_GRAV: Record<AlertaEx['gravidade'], string> = { alta: 'bg-red-50 text-red-700 border-red-200', media: 'bg-amber-50 text-amber-800 border-amber-200', baixa: 'bg-sky-50 text-sky-700 border-sky-200' };
const VAZIO_CONTRATO = { id: '', omId: '', numero: '', objeto: '', servico: '', inicio: '', fim: '', valorMensal: '' as any, indiceReajuste: '', mesReajuste: '' as any, observacao: '', ativo: true, fiscalNome: '', fiscalSetor: '', fiscalEmail: '', fiscalTelefone: '' };
const sel = 'text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white';
const comp = (f: FaturaEx) => `${String(f.mes).padStart(2, '0')}/${f.ano}`;
const COR_SIT: Record<SituacaoEx, string> = {
  paga: 'bg-emerald-50 text-emerald-700', vencida: 'bg-red-50 text-red-700', 'a vencer': 'bg-sky-50 text-sky-700',
  contestada: 'bg-amber-50 text-amber-800', cancelada: 'bg-slate-100 text-slate-500',
};
const Sit: React.FC<{ s: SituacaoEx }> = ({ s }) => <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${COR_SIT[s]}`}>{s}</span>;

const Cartao: React.FC<{ titulo: string; valor: number; detalhe?: string; cor: string }> = ({ titulo, valor, detalhe, cor }) => (
  <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm" style={{ borderTop: `4px solid ${cor}` }}>
    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{titulo}</div>
    <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{brlEx(valor)}</div>
    {detalhe && <div className="text-xs text-slate-500 mt-0.5">{detalhe}</div>}
  </div>
);

/** Página dedicada aos clientes Extra-Marinha: resumo, faturas, GRU, extrato por cliente e e-mail de envio. */
export const ExtraMarinha: React.FC = () => {
  const { user } = useAuth();
  const podeEditar = podeEditarDados(user?.role);
  const hoje = hojeISO();
  const [aba, setAba] = useState<Aba>('resumo');
  const [carregando, setCarregando] = useState(true);
  const [fats, setFats] = useState<FaturaEx[]>([]);
  const [grus, setGrus] = useState<GruEx[]>([]);
  const [oms, setOms] = useState<OM[]>([]);
  const [contratos, setContratos] = useState<ContratoEx[]>([]);
  const [semTabela, setSemTabela] = useState(false);
  const [editando, setEditando] = useState<typeof VAZIO_CONTRATO | null>(null);
  const [ano, setAno] = useState(new Date().getFullYear());
  const [cliente, setCliente] = useState('');
  // faturas
  const [fSit, setFSit] = useState<'' | SituacaoEx | 'abertas'>('abertas');
  const [fBusca, setFBusca] = useState('');
  // gru
  const [gSoAlerta, setGSoAlerta] = useState(false);
  // e-mail
  const [eComp, setEComp] = useState('');
  const [eMarcadas, setEMarcadas] = useState<Set<string>>(new Set());
  const [eLista, setELista] = useState(true);
  const [eTexto, setETexto] = useState('');
  const [eAssunto, setEAssunto] = useState('');

  const carregar = async () => {
    setCarregando(true);
    try {
      const d = await carregarExtraMB();
      setFats(d.fats); setGrus(d.grus); setOms(d.oms); setContratos(d.contratos); setSemTabela(d.semTabela);
    } catch (e) { notify.fail('Erro ao carregar a Extra-Marinha', e); } finally { setCarregando(false); }
  };
  useEffect(() => { carregar(); }, []);

  const anos = useMemo(() => [...new Set([new Date().getFullYear(), ...fats.map(f => f.ano).filter(Boolean)])].sort((a, b) => b - a), [fats]);
  const resumo = useMemo(() => resumoExtraMB(fats, grus, ano, hoje), [fats, grus, ano, hoje]);
  const clientes = useMemo(() => [...new Set([...fats.map(f => f.cliente), ...grus.map(g => g.cliente)])].sort((a, b) => a.localeCompare(b, 'pt-BR')), [fats, grus]);
  const omDoCliente = (nome: string) => oms.find(o => o.nome === nome);
  const verCliente = (nome: string, destino: Aba) => { setCliente(nome); setAba(destino); };

  // ------------------------------------------------ faturas
  const fatsFiltradas = useMemo(() => {
    const b = fBusca.trim().toLowerCase();
    return fats.filter(f => (!cliente || f.cliente === cliente)
      && (!fSit || (fSit === 'abertas' ? ['vencida', 'a vencer', 'contestada'].includes(situacaoEx(f, hoje)) : situacaoEx(f, hoje) === fSit))
      && (!b || `${f.numero} ${f.cliente} ${f.tipo} ${f.grus.join(' ')}`.toLowerCase().includes(b)))
      .sort((a, b2) => b2.vencimento.localeCompare(a.vencimento) || a.numero.localeCompare(b2.numero));
  }, [fats, cliente, fSit, fBusca, hoje]);
  const excelFaturas = () => {
    const ws = XLSX.utils.json_to_sheet(fatsFiltradas.map(f => ({ Cliente: f.cliente, Fatura: f.numero, Serviço: f.tipo, Competência: comp(f), Emissão: dataBR(f.emissao), Vencimento: dataBR(f.vencimento), Valor: f.valor, Pago: f.pago, Saldo: f.saldo, Situação: situacaoEx(f, hoje), GRU: f.grus.join(', '), 'Enviada em': f.enviadaEm ? dataBR(f.enviadaEm) : '' })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Faturas Extra-MB'); XLSX.writeFile(wb, `extra_mb_faturas_${hoje}.xlsx`);
  };

  // ------------------------------------------------ GRU
  const grusFiltradas = useMemo(() => grus.filter(g => (!cliente || g.cliente === cliente) && (!gSoAlerta || !!alertaGru(g))), [grus, cliente, gSoAlerta]);
  const comAlerta = useMemo(() => grus.filter(g => alertaGru(g)).length, [grus]);
  const excelGru = () => {
    const ws = XLSX.utils.json_to_sheet(grusFiltradas.map(g => ({ Cliente: g.cliente, Documento: g.numero, Autenticação: g.autenticacao || '', 'Data do pagamento': dataBR(g.dataPagamento), Valor: g.valor, Disponível: g.disponivel, 'Faturas pagas': g.faturas.map(f => `${f.numero}${f.cancelada ? ' (cancelada)' : ''}`).join(', '), Atenção: alertaGru(g) })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'GRU Extra-MB'); XLSX.writeFile(wb, `extra_mb_gru_${hoje}.xlsx`);
  };

  // ------------------------------------------------ extrato por cliente
  const exFats = useMemo(() => fats.filter(f => f.cliente === cliente && !f.cancelada && (f.ano === ano || (f.saldo > 0.005 && f.ano < ano))).sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.numero.localeCompare(b.numero)), [fats, cliente, ano]);
  const exGrus = useMemo(() => grus.filter(g => g.cliente === cliente && (g.dataPagamento || '').startsWith(String(ano))).sort((a, b) => a.dataPagamento.localeCompare(b.dataPagamento)), [grus, cliente, ano]);
  const exTot = useMemo(() => ({
    valor: exFats.reduce((s, f) => s + f.valor, 0), pago: exFats.reduce((s, f) => s + f.pago, 0), saldo: exFats.reduce((s, f) => s + f.saldo, 0),
    gru: exGrus.reduce((s, g) => s + g.valor, 0), credito: grus.filter(g => g.cliente === cliente).reduce((s, g) => s + g.disponivel, 0),
  }), [exFats, exGrus, grus, cliente]);
  const linhasExtrato = () => exFats.map(f => [comp(f), f.numero, f.tipo, dataBR(f.vencimento), brlEx(f.valor), brlEx(f.pago), brlEx(f.saldo), situacaoEx(f, hoje), f.grus.join(', ')]);
  const pdfExtrato = () => {
    if (!cliente) return;
    const om = omDoCliente(cliente);
    const doc = new jsPDF('l');
    cabecalhoCompacto(doc);
    const y0 = tituloRelatorio(doc, `Extrato de faturas e GRU — ${cliente}`, `${om?.cnpj ? `CNPJ ${om.cnpj} · ` : ''}Exercício ${ano} (e faturas em aberto de anos anteriores) · posição em ${dataBR(hoje)}`, 26) - 6;
    tabelaPdf(doc, {
      startY: y0 + 8, head: [['Competência', 'Fatura', 'Serviço', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Situação', 'GRU']], body: linhasExtrato(),
      foot: [['TOTAL', '', '', '', brlEx(exTot.valor), brlEx(exTot.pago), brlEx(exTot.saldo), '', '']],
      styles: { fontSize: 8 },
      columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    });
    tabelaPdf(doc, {
      startY: fimDaTabela(doc) + 6, head: [['Data do pagamento', 'GRU', 'Autenticação', 'Valor', 'Faturas pagas']],
      body: exGrus.map(g => [dataBR(g.dataPagamento), g.numero, g.autenticacao || '—', brlEx(g.valor), g.faturas.map(f => f.numero).join(', ') || '—']),
      foot: [['TOTAL RECEBIDO', '', '', brlEx(exTot.gru), '']], styles: { fontSize: 8 },
      columnStyles: { 3: { halign: 'right' } },
    });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...TEMA.faixa);
    doc.text(`Saldo a pagar: ${brlEx(exTot.saldo)}${exTot.credito > 0.005 ? ` · crédito de GRU ainda não atribuído às faturas: ${brlEx(exTot.credito)} (não abatido)` : ''}`, 14, fimDaTabela(doc) + 8);
    doc.setTextColor(0);
    salvarPdf(doc, `extrato_extra_mb_${cliente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 40)}_${ano}.pdf`, { yFim: fimDaTabela(doc) + 8 });
  };
  const excelExtrato = () => {
    if (!cliente) return;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Extrato — ${cliente} — exercício ${ano}`], [], ['Competência', 'Fatura', 'Serviço', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Situação', 'GRU'],
      ...exFats.map(f => [comp(f), f.numero, f.tipo, dataBR(f.vencimento), f.valor, f.pago, f.saldo, situacaoEx(f, hoje), f.grus.join(', ')]), ['TOTAL', '', '', '', exTot.valor, exTot.pago, exTot.saldo]]), 'Faturas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Data do pagamento', 'GRU', 'Autenticação', 'Valor', 'Faturas pagas'],
      ...exGrus.map(g => [dataBR(g.dataPagamento), g.numero, g.autenticacao || '', g.valor, g.faturas.map(f => f.numero).join(', ')])]), 'GRU');
    XLSX.writeFile(wb, `extrato_extra_mb_${cliente.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').slice(0, 40)}_${ano}.xlsx`);
  };

  // ------------------------------------------------ e-mail de envio
  const eFatsCliente = useMemo(() => fats.filter(f => f.cliente === cliente && !f.cancelada), [fats, cliente]);
  const eComps = useMemo(() => [...new Set(eFatsCliente.map(comp))].sort((a, b) => b.slice(3).localeCompare(a.slice(3)) || b.localeCompare(a)), [eFatsCliente]);
  const eOpcoes = useMemo(() => eFatsCliente.filter(f => (eComp === '__abertas' ? f.saldo > 0.005 : comp(f) === eComp)).sort((a, b) => a.numero.localeCompare(b.numero)), [eFatsCliente, eComp]);
  // ao trocar de cliente: competência mais recente; ao trocar de competência: marca todas
  useEffect(() => { setEComp(eComps[0] || '__abertas'); }, [cliente, eComps.join('|')]);
  useEffect(() => { setEMarcadas(new Set(eOpcoes.map(f => f.id))); }, [eComp, cliente, eOpcoes.length]);
  const eEscolhidas = eOpcoes.filter(f => eMarcadas.has(f.id));
  useEffect(() => { const m = emailEnvio(cliente, eEscolhidas, { incluirLista: eLista }); setETexto(m.texto); setEAssunto(m.assunto); }, [cliente, eLista, eEscolhidas.map(f => f.id).join('|')]);
  const ePara = (omDoCliente(cliente)?.emails || '').split(/[;,\s]+/).filter(x => x.includes('@')).join(';');
  const abrirEmail = () => { window.location.href = `mailto:${encodeURIComponent(ePara).replace(/%3B/g, ';')}?subject=${encodeURIComponent(eAssunto)}&body=${encodeURIComponent(eTexto)}`; };
  const marcarEnviadas = async () => {
    try { await marcarFaturas(eEscolhidas.map(f => f.id), 'enviada_em', hoje); notify.success(`${eEscolhidas.length} fatura(s) marcada(s) como enviada(s) em ${dataBR(hoje)}.`); carregar(); }
    catch (e) { notify.fail('Não foi possível marcar as faturas', e); }
  };

  // ------------------------------------------------ contratos e alertas
  const omsExtra = useMemo(() => oms.filter(o => o.tipo === 'EXTRA_MB').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [oms]);
  const nomeOM = (id: string) => oms.find(o => o.id === id)?.nome || '(cliente excluído)';
  const alertas = useMemo(() => [...alertasContratos(contratos, fats, nomeOM, hoje), ...alertasGru(grus)], [contratos, fats, grus, oms, hoje]);
  const ultimoValor = (c: ContratoEx) => {
    const l = fats.filter(f => !f.cancelada && f.omId === c.omId && (!c.servico || siglaFatura(f.numero) === c.servico.toUpperCase())).sort((a, b) => b.ano - a.ano || b.mes - a.mes);
    return l.length ? `${brlEx(l[0].valor)} (${comp(l[0])})` : '—';
  };
  const gravarContrato = async () => {
    if (!editando) return;
    if (!editando.omId || !editando.numero.trim()) { notify.error('Informe o cliente e o número do contrato.'); return; }
    if (editando.inicio && editando.fim && editando.fim < editando.inicio) { notify.error('O fim da vigência é anterior ao início.'); return; }
    if (editando.fiscalEmail.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(editando.fiscalEmail.trim())) { notify.error('E-mail do fiscal inválido.'); return; }
    try { await cadastroService.saveContrato({ ...editando, id: editando.id || undefined }); notify.success('Contrato gravado.'); setEditando(null); carregar(); }
    catch (e) { notify.fail('Não foi possível gravar o contrato', e); }
  };
  const excluirContrato = async (c: ContratoEx) => {
    if (!window.confirm(`Excluir o contrato ${c.numero} de ${nomeOM(c.omId)}?`)) return;
    try { await cadastroService.deleteContrato(c.id); notify.success('Contrato excluído.'); carregar(); } catch (e) { notify.fail('Não foi possível excluir', e); }
  };
  const ListaAlertas: React.FC<{ itens: AlertaEx[] }> = ({ itens }) => (
    <div className="bg-white rounded-lg border border-slate-200 p-3 space-y-2" aria-label="Alertas da Extra-Marinha">
      <h3 className="text-sm font-semibold text-slate-800">Pontos de atenção da Extra-Marinha ({itens.length})</h3>
      {!itens.length ? <p className="text-sm text-emerald-700">Nenhum alerta: contratos em dia e GRU conferidas.</p> : (
        <ul className="space-y-1.5">
          {itens.map((a, k) => (
            <li key={k} className={`text-sm border rounded px-2 py-1.5 ${COR_GRAV[a.gravidade]}`}>
              <b>{a.tipo}</b> · {a.cliente} · {a.referencia}: {a.mensagem}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const SeletorCliente = ({ obrigatorio }: { obrigatorio?: boolean }) => (
    <label className="text-xs text-slate-600">Cliente
      <select className={`${sel} block mt-1 min-w-[260px]`} value={cliente} onChange={e => setCliente(e.target.value)} aria-label="Cliente Extra-MB">
        {!obrigatorio && <option value="">Todos os clientes</option>}
        {obrigatorio && !cliente && <option value="">Escolha o cliente…</option>}
        {clientes.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
  const SeletorAno = () => (
    <label className="text-xs text-slate-600">Exercício
      <select className={`${sel} block mt-1`} value={ano} onChange={e => setAno(Number(e.target.value))} aria-label="Exercício">
        {anos.map(a => <option key={a} value={a}>{a}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Extra-Marinha</h2>
          <p className="text-slate-500 text-sm">Clientes de fora da Marinha (bancos, empresas…): faturas, GRU recebidas, extrato por cliente e e-mail de envio. Os números são os mesmos das outras telas, só separados.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={carregar} isLoading={carregando}>{!carregando && <RefreshCw size={14} className="mr-1" />} Atualizar</Button>
      </div>
      <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto">
        {([['resumo', 'Resumo'], ['faturas', 'Faturas'], ['gru', `GRU recebidas${comAlerta ? ` (${comAlerta} ⚠)` : ''}`], ['extrato', 'Extrato por cliente'], ['email', 'E-mail de envio'], ['contratos', `Contratos${alertas.length ? ` (${alertas.length} ⚠)` : ''}`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setAba(k)} className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap ${aba === k ? 'border-amber-600 text-amber-800 font-bold' : 'border-transparent text-slate-500'}`}>{l}</button>
        ))}
      </div>
      {carregando && !fats.length && <p className="text-sm text-slate-500">Carregando...</p>}

      {aba === 'resumo' && (
        <div className="space-y-4">
          <div className="flex gap-3 items-end"><SeletorAno /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Cartao titulo={`Faturado em ${ano}`} valor={resumo.total.faturado} cor="#2a78d6" detalhe="competência do ano, sem canceladas" />
            <Cartao titulo={`Recebido em ${ano} (GRU)`} valor={resumo.total.recebido} cor="#0ca30c" detalhe="pela data do pagamento" />
            <Cartao titulo="Em aberto" valor={resumo.total.emAberto} cor="#475569" detalhe={`vencido ${brlEx(resumo.total.vencido)} · a vencer ${brlEx(resumo.total.aVencer)}`} />
            <Cartao titulo="Crédito de GRU sem fatura" valor={resumo.total.creditoGru} cor="#b45309" detalhe={resumo.total.contestado ? `em contestação: ${brlEx(resumo.total.contestado)}` : 'não abatido das faturas'} />
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="Resumo por cliente">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>
                {['Cliente', `Faturado ${ano}`, `Recebido ${ano}`, 'Em aberto', 'Vencido', 'Mais antiga', 'Crédito GRU', 'Última GRU', ''].map(x => <th key={x} className={`px-3 py-2 ${x === 'Cliente' || x === '' ? 'text-left' : 'text-right'}`}>{x}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {resumo.linhas.map(l => (
                  <tr key={l.chave} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{l.cliente}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brlEx(l.faturado)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{brlEx(l.recebido)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{brlEx(l.emAberto)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${l.vencido > 0.005 ? 'text-red-700 font-semibold' : 'text-slate-400'}`}>{brlEx(l.vencido)}</td>
                    <td className="px-3 py-2 text-right text-xs">{l.maisAntiga ? dataBR(l.maisAntiga) : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${l.creditoGru > 0.005 ? 'text-amber-800' : 'text-slate-400'}`}>{brlEx(l.creditoGru)}</td>
                    <td className="px-3 py-2 text-right text-xs">{l.ultimaGru ? dataBR(l.ultimaGru) : 'nunca'}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      <button className="text-primary-700 underline mr-2" onClick={() => verCliente(l.cliente, 'extrato')}>extrato</button>
                      <button className="text-primary-700 underline" onClick={() => verCliente(l.cliente, 'email')}>e-mail</button>
                    </td>
                  </tr>
                ))}
                {!resumo.linhas.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">Nenhum cliente Extra-MB (tipo "Extra-MB" no cadastro de OM).</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'faturas' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end bg-white p-3 rounded-lg border border-slate-200">
            <SeletorCliente />
            <label className="text-xs text-slate-600">Situação
              <select className={`${sel} block mt-1`} value={fSit} onChange={e => setFSit(e.target.value as any)} aria-label="Situação">
                <option value="abertas">Em aberto (vencidas, a vencer e contestadas)</option><option value="">Todas</option>
                <option value="vencida">Vencidas</option><option value="a vencer">A vencer</option><option value="contestada">Em contestação</option><option value="paga">Pagas</option><option value="cancelada">Canceladas</option>
              </select>
            </label>
            <label className="text-xs text-slate-600">Buscar
              <input className={`${sel} block mt-1 w-56`} value={fBusca} onChange={e => setFBusca(e.target.value)} placeholder="fatura, serviço, GRU" aria-label="Buscar faturas Extra-MB" />
            </label>
            <span className="ml-auto text-sm text-slate-600 pb-1.5">{fatsFiltradas.length} fatura(s) · saldo <b className="tabular-nums">{brlEx(fatsFiltradas.reduce((s, f) => s + f.saldo, 0))}</b></span>
            <Button variant="secondary" onClick={excelFaturas}><FileSpreadsheet size={16} className="mr-1" />Excel</Button>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Cliente', 'Fatura', 'Serviço', 'Comp.', 'Vencimento', 'Valor', 'Saldo', 'Situação', 'GRU', 'Enviada'].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {fatsFiltradas.slice(0, 500).map(f => (
                  <tr key={f.id}>
                    <td className="px-3 py-1.5 max-w-[200px] truncate" title={f.cliente}>{f.cliente}</td>
                    <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{f.numero}</td>
                    <td className="px-3 py-1.5">{f.tipo}</td>
                    <td className="px-3 py-1.5">{comp(f)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{dataBR(f.vencimento)}{atrasoEx(f, hoje) ? <span className="text-xs text-red-700"> · {atrasoEx(f, hoje)} d</span> : null}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right">{brlEx(f.valor)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-right font-semibold">{brlEx(f.saldo)}</td>
                    <td className="px-3 py-1.5"><Sit s={situacaoEx(f, hoje)} /></td>
                    <td className="px-3 py-1.5 text-xs max-w-[160px] truncate" title={f.grus.join(', ')}>{f.grus.join(', ') || '—'}</td>
                    <td className="px-3 py-1.5 text-xs">{f.enviadaEm ? dataBR(f.enviadaEm) : <span className="text-slate-400">—</span>}</td>
                  </tr>
                ))}
                {!fatsFiltradas.length && <tr><td colSpan={10} className="px-3 py-6 text-center text-slate-400">Nenhuma fatura.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'gru' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end bg-white p-3 rounded-lg border border-slate-200">
            <SeletorCliente />
            <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-amber-600" checked={gSoAlerta} onChange={e => setGSoAlerta(e.target.checked)} /> Só as que pedem atenção ({comAlerta})</label>
            <span className="ml-auto text-sm text-slate-600 pb-1.5">{grusFiltradas.length} documento(s) · recebido <b className="tabular-nums">{brlEx(grusFiltradas.reduce((s, g) => s + g.valor, 0))}</b> · disponível <b className="tabular-nums">{brlEx(grusFiltradas.reduce((s, g) => s + g.disponivel, 0))}</b></span>
            <Button variant="secondary" onClick={excelGru}><FileSpreadsheet size={16} className="mr-1" />Excel</Button>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Pagamento', 'Documento', 'Autenticação', 'Cliente', 'Valor', 'Disponível', 'Faturas pagas', 'Atenção'].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {grusFiltradas.map(g => {
                  const al = alertaGru(g);
                  return (
                    <tr key={g.id} className={al ? 'bg-amber-50/50' : ''}>
                      <td className="px-3 py-1.5 whitespace-nowrap">{dataBR(g.dataPagamento)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{g.numero}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{g.autenticacao || '—'}</td>
                      <td className="px-3 py-1.5 max-w-[200px] truncate" title={g.cliente}>{g.cliente}</td>
                      <td className="px-3 py-1.5 tabular-nums text-right">{brlEx(g.valor)}</td>
                      <td className={`px-3 py-1.5 tabular-nums text-right ${g.disponivel > 0.005 ? 'text-amber-800 font-semibold' : 'text-slate-400'}`}>{brlEx(g.disponivel)}</td>
                      <td className="px-3 py-1.5 text-xs">{g.faturas.map(f => <span key={f.numero} className={`mr-2 whitespace-nowrap ${f.cancelada ? 'line-through text-red-600' : ''}`}>{f.numero}</span>)}{!g.faturas.length && '—'}</td>
                      <td className="px-3 py-1.5 text-xs text-amber-800">{al && <><AlertTriangle size={12} className="inline mr-1" />{al}</>}</td>
                    </tr>
                  );
                })}
                {!grusFiltradas.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Nenhum documento.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'extrato' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end bg-white p-3 rounded-lg border border-slate-200">
            <SeletorCliente obrigatorio /><SeletorAno />
            <div className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={pdfExtrato} disabled={!cliente}><FileText size={16} className="mr-1" />PDF</Button>
              <Button variant="secondary" onClick={excelExtrato} disabled={!cliente}><FileSpreadsheet size={16} className="mr-1" />Excel</Button>
            </div>
          </div>
          {!cliente ? <p className="text-sm text-slate-500">Escolha o cliente para ver o extrato.</p> : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Cartao titulo="Faturado no extrato" valor={exTot.valor} cor="#2a78d6" detalhe={`${exFats.length} fatura(s)`} />
                <Cartao titulo={`GRU recebidas em ${ano}`} valor={exTot.gru} cor="#0ca30c" detalhe={`${exGrus.length} GRU`} />
                <Cartao titulo="Saldo a pagar" valor={exTot.saldo} cor="#475569" detalhe="soma das faturas em aberto" />
                <Cartao titulo="Crédito de GRU" valor={exTot.credito} cor="#b45309" detalhe="ainda não atribuído às faturas (não abatido)" />
              </div>
              <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
                <h3 className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold">Faturas — exercício {ano} (e em aberto de anos anteriores)</h3>
                <table className="min-w-full text-sm" aria-label="Faturas do extrato">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Comp.', 'Fatura', 'Serviço', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Situação', 'GRU'].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {exFats.map(f => (
                      <tr key={f.id}>
                        <td className="px-3 py-1.5">{comp(f)}</td><td className="px-3 py-1.5 font-mono text-xs">{f.numero}</td><td className="px-3 py-1.5">{f.tipo}</td>
                        <td className="px-3 py-1.5">{dataBR(f.vencimento)}</td><td className="px-3 py-1.5 text-right tabular-nums">{brlEx(f.valor)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{brlEx(f.pago)}</td><td className="px-3 py-1.5 text-right tabular-nums font-semibold">{brlEx(f.saldo)}</td>
                        <td className="px-3 py-1.5"><Sit s={situacaoEx(f, hoje)} /></td><td className="px-3 py-1.5 text-xs">{f.grus.join(', ') || '—'}</td>
                      </tr>
                    ))}
                    {!exFats.length && <tr><td colSpan={9} className="px-3 py-4 text-center text-slate-400">Nenhuma fatura no exercício.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
                <h3 className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold">GRU recebidas em {ano}</h3>
                <p className="px-4 py-1.5 text-xs text-slate-500 bg-slate-50 border-b border-slate-100">As GRU não entram no Fluxo de Caixa nem na lista de Recebimentos (que mostra só ALTCRED, exceto no Público Extra-MB). Para registrar uma GRU ou baixar faturas com ela: Recebimentos › Público Extra-MB (ou filtro "Tipo de documento" = GRU), ou Novo Documento › Tipo GRU.</p>
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Pagamento', 'GRU', 'Autenticação', 'Valor', 'Faturas pagas'].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {exGrus.map(g => <tr key={g.id}><td className="px-3 py-1.5">{dataBR(g.dataPagamento)}</td><td className="px-3 py-1.5 font-mono text-xs">{g.numero}</td><td className="px-3 py-1.5 font-mono text-xs">{g.autenticacao || '—'}</td><td className="px-3 py-1.5 text-right tabular-nums">{brlEx(g.valor)}</td><td className="px-3 py-1.5 text-xs">{g.faturas.map(f => f.numero).join(', ') || '—'}</td></tr>)}
                    {!exGrus.length && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400">Nenhuma GRU no exercício.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {aba === 'email' && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end bg-white p-3 rounded-lg border border-slate-200">
            <SeletorCliente obrigatorio />
            {cliente && <label className="text-xs text-slate-600">Faturas de
              <select className={`${sel} block mt-1`} value={eComp} onChange={e => setEComp(e.target.value)} aria-label="Competência das faturas">
                {eComps.map(c => <option key={c} value={c}>competência {c}</option>)}
                <option value="__abertas">todas em aberto</option>
              </select>
            </label>}
            <label className="text-sm flex items-center gap-1.5 pb-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={eLista} onChange={e => setELista(e.target.checked)} /> Incluir a lista das faturas no texto</label>
          </div>
          {!cliente ? <p className="text-sm text-slate-500">Escolha o cliente para montar o e-mail de envio das faturas.</p> : (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase">Faturas do e-mail ({eEscolhidas.length} de {eOpcoes.length})</p>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {eOpcoes.map(f => (
                    <label key={f.id} className="flex items-center gap-2 py-1.5 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={eMarcadas.has(f.id)} aria-label={`Fatura ${f.numero}`}
                        onChange={e => setEMarcadas(s => { const n = new Set(s); e.target.checked ? n.add(f.id) : n.delete(f.id); return n; })} />
                      <span className="font-mono text-xs flex-1">{f.numero}<span className="text-slate-500 font-sans"> · {f.tipo} · venc. {dataBR(f.vencimento)}</span></span>
                      <span className="tabular-nums">{brlEx(f.saldo > 0.005 ? f.saldo : f.valor)}</span>
                      {f.enviadaEm && <span className="text-[10px] bg-emerald-50 text-emerald-700 rounded px-1" title="Já marcada como enviada">enviada {dataBR(f.enviadaEm)}</span>}
                    </label>
                  ))}
                  {!eOpcoes.length && <p className="text-sm text-slate-400 py-3">Nenhuma fatura.</p>}
                </div>
              </div>
              <div className="lg:col-span-3 bg-white rounded-lg border border-slate-200 p-3 space-y-2">
                <div className="text-sm"><span className="text-slate-500">Para:</span> {ePara || <span className="text-amber-700">sem e-mail no cadastro do cliente (Cadastros → OM / Clientes)</span>}</div>
                <label className="text-xs text-slate-600 block">Assunto
                  <input className={`${sel} block mt-1 w-full`} value={eAssunto} onChange={e => setEAssunto(e.target.value)} aria-label="Assunto do e-mail" />
                </label>
                <textarea className="w-full h-72 text-sm border border-slate-300 rounded p-2" value={eTexto} onChange={e => setETexto(e.target.value)} aria-label="Texto do e-mail" />
                <p className="text-xs text-slate-500">Anexe as faturas e as GRU (geradas no SIPLAD) no seu programa de e-mail.</p>
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(`${eAssunto}\n\n${eTexto}`); notify.success('Assunto e texto copiados.'); }}><Copy size={14} className="mr-1" />Copiar</Button>
                  <Button variant="secondary" onClick={abrirEmail}><Mail size={14} className="mr-1" />Abrir no e-mail</Button>
                  {podeEditar && <Button onClick={marcarEnviadas} disabled={!eEscolhidas.length}><Send size={14} className="mr-1" />Marcar {eEscolhidas.length} como enviada(s)</Button>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {aba === 'contratos' && (
        <div className="space-y-3">
          {semTabela && <div className="p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm" role="alert">A tabela de contratos ainda não existe no banco: um administrador precisa executar o script <code>supabase/migrations/019_contratos_extra_mb.sql</code> no Supabase.</div>}
          <ListaAlertas itens={alertas} />
          <div className="flex justify-between items-center">
            <p className="text-sm text-slate-600">{contratos.length} contrato(s) · {contratos.filter(c => c.ativo).length} ativo(s). O valor mensal serve para conferir o faturado; o reajuste e o fim da vigência geram os avisos acima.</p>
            {podeEditar && !semTabela && <Button onClick={() => setEditando({ ...VAZIO_CONTRATO, omId: omsExtra[0]?.id || '' })}><Plus size={14} className="mr-1" />Novo contrato</Button>}
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="Contratos Extra-MB">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Cliente', 'Contrato', 'Objeto', 'Serviço', 'Vigência', 'Valor mensal', 'Última fatura', 'Reajuste', 'Fiscal', 'Situação', ''].map(x => <th key={x} className="px-3 py-2 text-left">{x}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {[...contratos].sort((a, b) => nomeOM(a.omId).localeCompare(nomeOM(b.omId), 'pt-BR') || a.numero.localeCompare(b.numero)).map(c => (
                  <tr key={c.id} className={c.ativo ? '' : 'text-slate-400'}>
                    <td className="px-3 py-1.5">{nomeOM(c.omId)}</td>
                    <td className="px-3 py-1.5 font-medium">{c.numero}</td>
                    <td className="px-3 py-1.5 max-w-[200px] truncate" title={c.objeto || ''}>{c.objeto || '—'}</td>
                    <td className="px-3 py-1.5">{c.servico || 'qualquer'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{c.inicio ? dataBR(c.inicio) : '…'} a {c.fim ? dataBR(c.fim) : '…'}</td>
                    <td className="px-3 py-1.5 tabular-nums">{c.valorMensal != null ? brlEx(c.valorMensal) : '—'}</td>
                    <td className="px-3 py-1.5 tabular-nums text-xs">{ultimoValor(c)}</td>
                    <td className="px-3 py-1.5 text-xs">{c.mesReajuste ? `${String(c.mesReajuste).padStart(2, '0')}${c.indiceReajuste ? ` · ${c.indiceReajuste}` : ''}` : '—'}</td>
                    <td className="px-3 py-1.5 text-xs max-w-[220px]">{c.fiscalNome || c.fiscalSetor ? <>
                      <div className="font-medium">{c.fiscalNome || '—'}{c.fiscalSetor ? <span className="text-slate-500"> · {c.fiscalSetor}</span> : null}</div>
                      {c.fiscalEmail && <a className="text-primary-700 underline block truncate" href={`mailto:${c.fiscalEmail}`} title={c.fiscalEmail}>{c.fiscalEmail}</a>}
                      {c.fiscalTelefone && <div className="text-slate-500">{c.fiscalTelefone}</div>}
                    </> : <span className="text-amber-700">sem fiscal</span>}</td>
                    <td className="px-3 py-1.5 text-xs">{!c.ativo ? 'desativado' : c.fim && c.fim < hoje ? <span className="text-red-700 font-semibold">vencido</span> : 'vigente'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{podeEditar && <>
                      <button className="text-blue-600 mr-2" title="Editar" aria-label={`Editar contrato ${c.numero}`} onClick={() => setEditando({ ...VAZIO_CONTRATO, ...c, objeto: c.objeto || '', servico: c.servico || '', inicio: c.inicio || '', fim: c.fim || '', valorMensal: c.valorMensal ?? '', indiceReajuste: c.indiceReajuste || '', mesReajuste: c.mesReajuste ?? '', observacao: c.observacao || '', fiscalNome: c.fiscalNome || '', fiscalSetor: c.fiscalSetor || '', fiscalEmail: c.fiscalEmail || '', fiscalTelefone: c.fiscalTelefone || '' } as any)}><Pencil size={14} /></button>
                      <button className="text-red-600" title="Excluir" aria-label={`Excluir contrato ${c.numero}`} onClick={() => excluirContrato(c)}><Trash2 size={14} /></button>
                    </>}</td>
                  </tr>
                ))}
                {!contratos.length && <tr><td colSpan={11} className="px-3 py-6 text-center text-slate-400">Nenhum contrato cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={!!editando} onClose={() => setEditando(null)} title={editando?.id ? 'Editar contrato' : 'Novo contrato'} maxWidth="max-w-2xl"
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button><Button onClick={gravarContrato}>Gravar</Button></div>}>
        {editando && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="col-span-2 text-xs text-slate-600">Cliente Extra-MB
              <select className={`${sel} block mt-1 w-full`} value={editando.omId} onChange={e => setEditando({ ...editando, omId: e.target.value })} aria-label="Cliente do contrato">
                {omsExtra.map(o => <option key={o.id} value={o.id}>{o.codigo} - {o.nome}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">Número do contrato<input className={`${sel} block mt-1 w-full`} value={editando.numero} onChange={e => setEditando({ ...editando, numero: e.target.value })} aria-label="Número do contrato" /></label>
            <label className="text-xs text-slate-600">Serviço na fatura (sigla)<input className={`${sel} block mt-1 w-full`} placeholder="ex.: AL" value={editando.servico} onChange={e => setEditando({ ...editando, servico: e.target.value.toUpperCase() })} aria-label="Serviço do contrato" /></label>
            <label className="col-span-2 text-xs text-slate-600">Objeto<input className={`${sel} block mt-1 w-full`} placeholder="ex.: aluguel da agência (sala 2)" value={editando.objeto} onChange={e => setEditando({ ...editando, objeto: e.target.value })} aria-label="Objeto do contrato" /></label>
            <label className="text-xs text-slate-600">Início da vigência<input type="date" className={`${sel} block mt-1 w-full`} value={editando.inicio} onChange={e => setEditando({ ...editando, inicio: e.target.value })} aria-label="Início da vigência" /></label>
            <label className="text-xs text-slate-600">Fim da vigência<input type="date" className={`${sel} block mt-1 w-full`} value={editando.fim} onChange={e => setEditando({ ...editando, fim: e.target.value })} aria-label="Fim da vigência" /></label>
            <label className="text-xs text-slate-600">Valor mensal (R$)<input type="number" step="0.01" min="0" className={`${sel} block mt-1 w-full`} value={editando.valorMensal} onChange={e => setEditando({ ...editando, valorMensal: e.target.value as any })} aria-label="Valor mensal" /></label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-600">Índice de reajuste<input className={`${sel} block mt-1 w-full`} placeholder="IPCA" value={editando.indiceReajuste} onChange={e => setEditando({ ...editando, indiceReajuste: e.target.value })} aria-label="Índice de reajuste" /></label>
              <label className="text-xs text-slate-600">Mês do reajuste
                <select className={`${sel} block mt-1 w-full`} value={editando.mesReajuste} onChange={e => setEditando({ ...editando, mesReajuste: e.target.value as any })} aria-label="Mês do reajuste">
                  <option value="">—</option>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{String(i + 1).padStart(2, '0')}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="col-span-2 border border-slate-200 rounded-lg p-3 grid grid-cols-2 gap-3">
              <legend className="px-1 text-xs font-semibold text-slate-600">Fiscal responsável pelo contrato</legend>
              <label className="text-xs text-slate-600">Nome<input className={`${sel} block mt-1 w-full`} placeholder="ex.: CC Fulano de Tal" value={editando.fiscalNome} onChange={e => setEditando({ ...editando, fiscalNome: e.target.value })} aria-label="Nome do fiscal" /></label>
              <label className="text-xs text-slate-600">Setor<input className={`${sel} block mt-1 w-full`} placeholder="ex.: Divisão de Patrimônio" value={editando.fiscalSetor} onChange={e => setEditando({ ...editando, fiscalSetor: e.target.value })} aria-label="Setor do fiscal" /></label>
              <label className="text-xs text-slate-600">E-mail<input type="email" className={`${sel} block mt-1 w-full`} placeholder="nome@marinha.mil.br" value={editando.fiscalEmail} onChange={e => setEditando({ ...editando, fiscalEmail: e.target.value })} aria-label="E-mail do fiscal" /></label>
              <label className="text-xs text-slate-600">Telefone<input type="tel" className={`${sel} block mt-1 w-full`} placeholder="(21) 0000-0000" value={editando.fiscalTelefone} onChange={e => setEditando({ ...editando, fiscalTelefone: e.target.value })} aria-label="Telefone do fiscal" /></label>
            </fieldset>
            <label className="col-span-2 text-xs text-slate-600">Observação<input className={`${sel} block mt-1 w-full`} value={editando.observacao} onChange={e => setEditando({ ...editando, observacao: e.target.value })} aria-label="Observação do contrato" /></label>
            <label className="col-span-2 text-sm flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={editando.ativo} onChange={e => setEditando({ ...editando, ativo: e.target.checked })} /> Contrato ativo</label>
          </div>
        )}
      </Modal>
    </div>
  );
};
