
import React, { useState, useEffect } from 'react';
import { db } from '../services/db';
import { Invoice, ReceivedDocument, InvoiceStatus, InvoiceType } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Download, Filter, TrendingUp, AlertCircle, CheckCircle, Wallet, FileText } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Button } from '../components/ui/Button';
import { Select, Input } from '../components/ui/Input';

const COLORS = ['#0ea5e9', '#22c55e', '#ef4444', '#eab308', '#8b5cf6', '#ec4899', '#f97316', '#64748b'];

export const Dashboard: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [documents, setDocuments] = useState<ReceivedDocument[]>([]);

  // Filters
  const [filterSector, setFilterSector] = useState('');
  const [filterCommand, setFilterCommand] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadData = async () => {
    const [invs, docs] = await Promise.all([
      db.getInvoices(),
      db.getDocuments()
    ]);
    setInvoices(invs);
    setDocuments(docs);
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Filtering Logic ---
  // GLOBAL RULE: Dashboard ignores canceled invoices for calculations
  const filteredInvoices = invoices.filter(inv => {
    if (inv.isCanceled) return false;

    const matchesSector = !filterSector || inv.sector === filterSector;
    const matchesCommand = !filterCommand || inv.command === filterCommand;
    const matchesClient = !filterClient || inv.client === filterClient;

    let matchesDate = true;
    if (startDate && endDate) {
      matchesDate = inv.issueDate >= startDate && inv.issueDate <= endDate;
    }

    return matchesSector && matchesCommand && matchesClient && matchesDate;
  });

  const filteredDocs = documents.filter(doc => {
    return (!filterSector || doc.sector === filterSector) &&
      (!filterCommand || doc.command === filterCommand) &&
      (!filterClient || doc.client === filterClient);
  });

  // --- KPI Calculations ---
  // Helper to get Total Invoice Value (Base + Adj)
  const getInvoiceTotal = (i: Invoice) => i.value + (i.adjustmentAddition || 0) - (i.adjustmentDeduction || 0);

  const totalValue = filteredInvoices.reduce((acc, curr) => acc + getInvoiceTotal(curr), 0);
  const totalPaid = filteredInvoices.reduce((acc, curr) => acc + curr.paidAmount, 0);

  const totalOpen = filteredInvoices
    .filter(i => i.status !== InvoiceStatus.PAID)
    .reduce((acc, curr) => acc + (getInvoiceTotal(curr) - curr.paidAmount), 0);

  const totalOverdue = filteredInvoices
    .filter(i => i.status === InvoiceStatus.OVERDUE)
    .reduce((acc, curr) => acc + (getInvoiceTotal(curr) - curr.paidAmount), 0);

  const sumOpenAndOverdue = totalOpen;

  // --- Matrix Calculation (Sector vs Type) ---
  const invoiceTypes = Object.values(InvoiceType);
  const sectorsUnique = Array.from(new Set(filteredInvoices.map(i => i.sector))).sort();

  const matrixData = sectorsUnique.map(sector => {
    const row: any = { sector };
    let sectorTotalDebt = 0;

    invoiceTypes.forEach(type => {
      const debt = filteredInvoices
        .filter(i => i.sector === sector && i.type === type && i.status !== InvoiceStatus.PAID)
        .reduce((sum, i) => sum + (getInvoiceTotal(i) - i.paidAmount), 0);
      row[type] = debt;
      sectorTotalDebt += debt;
    });
    row.total = sectorTotalDebt;
    return row;
  });

  // Calculate Totals per Column (Type)
  const columnTotals: Record<string, number> = {};
  let grandTotal = 0;
  invoiceTypes.forEach(t => columnTotals[t] = 0);

  matrixData.forEach(row => {
    invoiceTypes.forEach(t => {
      columnTotals[t] += (row[t] || 0);
    });
    grandTotal += row.total;
  });

  // --- Overdue Table Data ---
  const overdueInvoices = filteredInvoices.filter(i => i.status === InvoiceStatus.OVERDUE);

  // --- PDF Exports ---
  const exportDebtSummaryPDF = () => {
    const doc = new jsPDF('l');
    doc.text("Resumo de Dívidas (Aberto + Vencido) por Setor e Tipo - SISCONT", 14, 15);
    doc.setFontSize(10);
    doc.text(`Filtros: ${filterSector || 'Todos'} | ${filterCommand || 'Todos'} | ${filterClient || 'Todos'}`, 14, 22);

    const head = [['Setor', ...invoiceTypes, 'TOTAL']];
    const body = matrixData.map(row => [
      row.sector,
      ...invoiceTypes.map(t => `R$ ${row[t]?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}`),
      `R$ ${row.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    // Add Totals Row to PDF
    const totalRowPDF = [
      'TOTAL GERAL',
      ...invoiceTypes.map(t => `R$ ${columnTotals[t]?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}`),
      `R$ ${grandTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ];
    body.push(totalRowPDF);

    autoTable(doc, {
      startY: 25,
      head: head,
      body: body,
      styles: { fontSize: 8 },
    });

    doc.save("resumo_dividas_siscont.pdf");
  };

  const exportBalanceExtractPDF = () => {
    const doc = new jsPDF('l');
    doc.text("Extrato de Saldos Disponíveis e Faturas em Aberto - SISCONT", 14, 15);

    // Part 1: Balances
    doc.text("Saldos Disponíveis (Documentos Recebidos)", 14, 25);
    const balanceRows = filteredDocs.filter(d => d.availableValue > 0).map(d => [
      d.sector, d.command, d.client, d.documentNumber, d.operation, `R$ ${d.availableValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    autoTable(doc, {
      startY: 30,
      head: [['Setor', 'Comando', 'Cliente', 'Doc', 'Operação', 'Saldo Disp.']],
      body: balanceRows,
    });

    // Part 2: Open Invoices
    const finalY = (doc as any).lastAutoTable.finalY + 15;
    doc.text("Faturas em Aberto (Compromissos)", 14, finalY);

    const invoiceRows = filteredInvoices.filter(i => i.status !== InvoiceStatus.PAID).map(i => [
      i.sector, i.client, i.type, i.invoiceNumber, i.competence, `R$ ${(getInvoiceTotal(i) - i.paidAmount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
    ]);

    autoTable(doc, {
      startY: finalY + 5,
      head: [['Setor', 'Cliente', 'Tipo', 'Fatura', 'Comp.', 'Valor Aberto']],
      body: invoiceRows,
    });

    doc.save("extrato_saldos_siscont.pdf");
  };

  // Dropdown options
  const sectors = Array.from(new Set(invoices.map(i => i.sector))).map(s => ({ label: s, value: s }));
  const commands = Array.from(new Set(invoices.map(i => i.command))).map(s => ({ label: s, value: s }));
  const clients = Array.from(new Set(invoices.map(i => i.client))).map(s => ({ label: s, value: s }));

  // Chart Data
  const monthlyDataMap = new Map<string, number>();
  filteredInvoices.forEach(inv => {
    const key = inv.competence;
    const current = monthlyDataMap.get(key) || 0;
    monthlyDataMap.set(key, current + getInvoiceTotal(inv));
  });
  const barChartData = Array.from(monthlyDataMap.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const pieChartData = invoiceTypes.map(type => ({
    name: type,
    value: filteredInvoices.filter(i => i.type === type).reduce((acc, c) => acc + getInvoiceTotal(c), 0)
  })).filter(d => d.value > 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800">Dashboard Analítico</h2>
          <p className="text-slate-500">Visão consolidada de indicadores contábeis</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={exportDebtSummaryPDF}>
            <FileText className="w-4 h-4 mr-2" /> Resumo Dívidas (PDF)
          </Button>
          <Button variant="secondary" size="sm" onClick={exportBalanceExtractPDF}>
            <Wallet className="w-4 h-4 mr-2" /> Extrato Saldos (PDF)
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow-sm border border-slate-200 grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
        <Select label="Setor" options={sectors} value={filterSector} onChange={e => setFilterSector(e.target.value)} />
        <Select label="Comando" options={commands} value={filterCommand} onChange={e => setFilterCommand(e.target.value)} />
        <Select label="Cliente" options={clients} value={filterClient} onChange={e => setFilterClient(e.target.value)} />
        <div className="flex gap-2 col-span-2">
          <Input label="De" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label="Até" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-blue-500">
          <p className="text-sm font-medium text-slate-500">Total Faturado</p>
          <h3 className="text-2xl font-bold text-slate-800">R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-green-500">
          <p className="text-sm font-medium text-slate-500">Total Pago</p>
          <h3 className="text-2xl font-bold text-slate-800">R$ {totalPaid.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-yellow-500">
          <p className="text-sm font-medium text-slate-500">Dívida Total (Aberto + Vencido)</p>
          <h3 className="text-2xl font-bold text-slate-800">R$ {sumOpenAndOverdue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border-l-4 border-red-500">
          <p className="text-sm font-medium text-slate-500">Somente Vencidos</p>
          <h3 className="text-2xl font-bold text-red-600">R$ {totalOverdue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
        </div>
      </div>

      {/* Matrix Table: Sectors vs Types (Debt) */}
      <div className="bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <h3 className="font-bold text-lg text-slate-800">Matriz de Dívidas (Em Aberto/Vencido) por Setor e Tipo</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-500 uppercase">Setor</th>
                {invoiceTypes.map(t => <th key={t} className="px-4 py-3 text-right font-medium text-slate-500 uppercase whitespace-nowrap">{t}</th>)}
                <th className="px-4 py-3 text-right font-bold text-slate-700 uppercase">TOTAL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {matrixData.map((row) => (
                <tr key={row.sector} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-900">{row.sector}</td>
                  {invoiceTypes.map(t => (
                    <td key={t} className="px-4 py-3 text-right text-slate-600">
                      {row[t] > 0 ? `R$ ${row[t].toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-bold text-slate-800 bg-slate-50">
                    R$ {row.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
              {/* Total Row */}
              <tr className="bg-slate-200 font-bold border-t-2 border-slate-300">
                <td className="px-4 py-3 text-slate-900 uppercase">TOTAIS</td>
                {invoiceTypes.map(t => (
                  <td key={t} className="px-4 py-3 text-right text-slate-900">
                    R$ {columnTotals[t].toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                ))}
                <td className="px-4 py-3 text-right text-slate-900">
                  R$ {grandTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow border border-slate-200">
          <h3 className="font-bold text-lg text-slate-800 mb-4">Evolução Mensal (Faturamento)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR')}`} />
                <Bar dataKey="value" fill="#0ea5e9" name="Faturado" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow border border-slate-200">
          <h3 className="font-bold text-lg text-slate-800 mb-4">Distribuição de Dívida por Tipo</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number) => `R$ ${val.toLocaleString('pt-BR')}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Overdue Specific Table */}
      {overdueInvoices.length > 0 && (
        <div className="bg-white rounded-lg shadow border border-red-200 overflow-hidden">
          <div className="p-4 bg-red-50 border-b border-red-100 flex items-center gap-2">
            <AlertCircle className="text-red-600" size={20} />
            <h3 className="font-bold text-lg text-red-800">Faturas Vencidas (Atenção Necessária)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-red-50/50">
                <tr>
                  <th className="px-4 py-3 text-left">Vencimento</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-left">Fatura</th>
                  <th className="px-4 py-3 text-right">Valor Aberto</th>
                </tr>
              </thead>
              <tbody>
                {overdueInvoices.map(inv => (
                  <tr key={inv.id} className="border-b border-red-50">
                    <td className="px-4 py-3 font-medium text-red-600">{new Date(inv.dueDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-slate-700">{inv.client}</td>
                    <td className="px-4 py-3 text-slate-500">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-700">R$ {(getInvoiceTotal(inv) - inv.paidAmount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
