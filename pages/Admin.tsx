import React, { useState, useRef } from 'react';
import { db } from '../services/db';
import { TABELAS_BACKUP_EXTRAS, exportarTabela, registrarBackup } from '../services/auditoriaService';
import { Button } from '../components/ui/Button';
import { UsersPanel } from '../components/admin/UsersPanel';
import { ErrosPanel } from '../components/admin/ErrosPanel';
// @ts-ignore
import * as XLSX from 'xlsx';
import { Upload, Save, Shield, Database, Cloud, AlertTriangle, CheckCircle2 } from 'lucide-react';

type AdminTab = 'users' | 'backup' | 'erros';

/** Administração: usuários e rotinas do sistema. Clientes, serviços e parâmetros ficam em "Cadastros". */
export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  const [systemMsg, setSystemMsg] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [isSystemBusy, setIsSystemBusy] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);

  // --- BACKUP ACTIONS (dados lidos/gravados no Supabase) ---
  const legacy = db.getLegacyLocalData();

  const handleSystemBackup = async () => {
    setIsSystemBusy(true);
    setSystemMsg({ type: 'info', text: 'Gerando backup a partir do servidor...' });
    try {
      const data = await db.getAllData();
      const wb = XLSX.utils.book_new();
      const add = (rows: any[], name: string) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
      add(data.invoices, "Faturas");
      add(data.documents, "Documentos");
      add(data.allocations, "Alocacoes");
      add(data.clients, "Clientes");
      add(data.services, "Servicos");
      add(data.users, "Usuarios");
      add(data.exits, "Saidas");
      // Cadastros da Fase 1 (somente exportação; restauram-se pela tela Cadastros)
      add(data.oms, "OMs");
      add(data.comandos, "Comandos");
      add(data.setores, "Setores");
      add(data.classes, "ClassesNavio");
      add(data.parametros, "Parametros");
      add(data.feriados, "Feriados");
      // Fases 2 a 6 (faturamento, contestações, rubricas, taxa condominial...): exportadas como estão no banco
      const extras: string[] = [];
      for (const t of TABELAS_BACKUP_EXTRAS) {
        const rows = await exportarTabela(t);
        if (rows === null) continue;
        add(rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v]))), t.slice(0, 31));
        extras.push(`${t} ${rows.length}`);
      }
      XLSX.writeFile(wb, `SISCONT_BACKUP_${new Date().toISOString().split('T')[0]}.xlsx`);
      await registrarBackup().catch(() => undefined);
      setSystemMsg({
        type: 'ok',
        text: `Backup gerado: ${data.invoices.length} faturas, ${data.documents.length} documentos, ${data.allocations.length} alocações, ${data.exits.length} saídas, ${data.oms.length} OM, ${data.comandos.length} comandos, ${data.services.length} serviços${extras.length ? `; ${extras.join(', ')}` : ''}.`
      });
    } catch (err: any) {
      setSystemMsg({ type: 'error', text: `Erro ao gerar backup: ${err?.message || 'verifique a conexão.'}` });
    } finally {
      setIsSystemBusy(false);
    }
  };

  const handleSystemRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = (n: string) => workbook.Sheets[n] ? XLSX.utils.sheet_to_json(workbook.Sheets[n], { defval: null }) as any[] : undefined;
        const backupData = {
          invoices: sheet("Faturas"),
          documents: sheet("Documentos"),
          allocations: sheet("Alocacoes"),
          clients: sheet("Clientes"),
          services: sheet("Servicos"),
          exits: sheet("Saidas"),
        };
        const resumo = Object.entries(backupData).filter(([, v]) => v).map(([k, v]) => `${k}: ${v!.length}`).join(', ');
        if (!resumo) {
          setSystemMsg({ type: 'error', text: 'O arquivo não contém abas de backup do SISCONT.' });
          return;
        }
        if (!window.confirm(`Restaurar backup "${file.name}"?\n\n${resumo}\n\nRegistros com o mesmo ID serão SOBRESCRITOS no servidor. Registros que não estão no arquivo serão mantidos. Usuários não são alterados.`)) return;
        setIsSystemBusy(true);
        const summary = await db.restoreBackup(backupData, msg => setSystemMsg({ type: 'info', text: `Restaurando... ${msg}` }));
        setSystemMsg({ type: 'ok', text: `Restauração concluída: ${Object.entries(summary).map(([k, v]) => `${k} ${v}`).join(', ')}.` });
        db.invalidateCache();
      } catch (err: any) {
        setSystemMsg({ type: 'error', text: `Erro ao restaurar: ${err?.message || 'arquivo inválido.'}` });
      } finally {
        setIsSystemBusy(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleLegacyMigration = async () => {
    if (!window.confirm(`Enviar ${legacy.total} registro(s) salvos neste navegador (versão antiga do SISCONT) para o servidor? Registros com o mesmo ID serão sobrescritos.`)) return;
    setIsSystemBusy(true);
    try {
      const summary = await db.restoreBackup(legacy.data, msg => setSystemMsg({ type: 'info', text: `Migrando... ${msg}` }));
      setSystemMsg({ type: 'ok', text: `Migração concluída: ${Object.entries(summary).map(([k, v]) => `${k} ${v}`).join(', ')}.` });
      db.invalidateCache();
    } catch (err: any) {
      setSystemMsg({ type: 'error', text: `Erro na migração: ${err?.message}` });
    } finally {
      setIsSystemBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Administração</h2>
          <p className="text-slate-500 text-sm">Usuários, backup e restauração. Clientes, serviços e parâmetros ficam em <b>Cadastros</b>.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={handleSystemBackup} isLoading={isSystemBusy}>
          {!isSystemBusy && <Save className="mr-2 h-4 w-4" />} Backup (XLSX)
        </Button>
      </div>

      <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto">
        {(['users', 'backup', 'erros'] as AdminTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab ? 'border-primary-600 text-primary-700 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {tab === 'users' ? 'Usuários' : tab === 'erros' ? 'Erros' : 'Sistema'}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {activeTab === 'users' && <UsersPanel />}
        {activeTab === 'erros' && <ErrosPanel />}

        {/* --- BACKUP / SYSTEM TAB --- */}
        {activeTab === 'backup' && (
          <div className="p-8 max-w-2xl mx-auto space-y-8">
            {systemMsg && (
              <div className={`p-3 rounded-lg border text-sm flex items-start gap-2 ${systemMsg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : systemMsg.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                {systemMsg.type === 'error' ? <AlertTriangle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
                <span>{systemMsg.text}</span>
              </div>
            )}

            <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 flex items-start gap-4">
              <div className="p-3 bg-blue-100 rounded-xl text-blue-600"><Database size={24} /></div>
              <div>
                <h3 className="text-lg font-bold text-blue-900">Gerar Backup do Sistema</h3>
                <p className="text-sm text-blue-700 mb-4">Exporta do servidor todas as faturas, documentos, alocações, saídas e cadastros para uma planilha Excel (uma aba por tabela).</p>
                <Button onClick={handleSystemBackup} isLoading={isSystemBusy} className="shadow-blue-200">{!isSystemBusy && <Save className="mr-2 h-4 w-4" />} Baixar Planilha de Backup</Button>
              </div>
            </div>

            <div className="bg-red-50/50 p-6 rounded-2xl border border-red-100 flex items-start gap-4">
              <div className="p-3 bg-red-100 rounded-xl text-red-600"><Upload size={24} /></div>
              <div>
                <h3 className="text-lg font-bold text-red-900">Restaurar Backup</h3>
                <p className="text-sm text-red-700 mb-4">Carrega uma planilha de backup do SISCONT e grava no servidor. Registros com o mesmo ID são sobrescritos; os demais são mantidos. Usuários não são alterados.</p>
                <input type="file" ref={backupInputRef} onChange={handleSystemRestore} accept=".xlsx" className="hidden" />
                <Button variant="danger" onClick={() => backupInputRef.current?.click()} disabled={isSystemBusy} className="shadow-red-200"><Shield className="mr-2 h-4 w-4" /> Importar do Excel</Button>
              </div>
            </div>

            {legacy.total > 0 && (
              <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 flex items-start gap-4">
                <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600"><Cloud size={24} /></div>
                <div>
                  <h3 className="text-lg font-bold text-emerald-900">Dados locais da versão antiga</h3>
                  <p className="text-sm text-emerald-700 mb-4">Encontrados {legacy.total} registro(s) salvos neste navegador pela versão anterior do SISCONT. Envie-os para o servidor para não perdê-los.</p>
                  <Button variant="secondary" onClick={handleLegacyMigration} disabled={isSystemBusy}><Cloud className="mr-2 h-4 w-4" /> Enviar para o Servidor</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
