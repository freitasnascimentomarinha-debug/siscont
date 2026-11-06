
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { Client, ServiceDefinition } from '../types';
import { UsersPanel } from '../components/admin/UsersPanel';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
// @ts-ignore
import * as XLSX from 'xlsx';
import { Trash2, Edit, Upload, Plus, Save, Shield, Database, Cloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';


type AdminTab = 'users' | 'clients' | 'services' | 'backup';

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // --- STATE: DATA ---
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<ServiceDefinition[]>([]);

  // --- STATE: MODALS ---
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // --- STATE: FORMS ---
  const [clientFormData, setClientFormData] = useState<Partial<Client>>({});
  const [serviceFormData, setServiceFormData] = useState<Partial<ServiceDefinition>>({});

  // --- STATE: HELPERS ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [systemMsg, setSystemMsg] = useState<{ type: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [isSystemBusy, setIsSystemBusy] = useState(false);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const backupInputRef = useRef<HTMLInputElement>(null);

  const refresh = async (force = false) => {
    setIsRefreshing(true);
    try {
      if (force) {
        db.invalidateCache();
        console.log("[Admin] Cache limpo manualmente.");
      }
      const [clnts, svcs] = await Promise.all([
        db.getClients(),
        db.getServices()
      ]);
      setPageError(null);
      setClients(clnts);
      setServices(svcs);
      setLastUpdated(new Date());
    } catch (err: any) {
      console.error("[Admin] Erro ao atualizar dados:", err);
      setPageError(`Falha ao carregar cadastros: ${err?.message || 'verifique a conexão.'}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // --- CRUD ACTIONS ---

  const handleSaveClient = async () => {
    setClientError(null);
    if (!clientFormData.name || !clientFormData.ug || !clientFormData.sector || !clientFormData.command) {
      setClientError("Preencha todos os campos do cliente.");
      return;
    }
    // Códigos de OM/UG usados no faturamento da BNIC têm 5 dígitos (ex.: 40002, 91645); aceita 5 ou 6
    if (!/^\d{5,6}$/.test(String(clientFormData.ug).trim())) {
      setClientError("O código da OM/UG deve ter 5 ou 6 dígitos numéricos (ex.: 40002).");
      return;
    }

    const duplicate = clients.find(c =>
      c.id !== editingId && (String(c.ug).trim() === String(clientFormData.ug).trim())
    );

    if (duplicate) {
      setClientError(`Já existe um cliente com esta UG (${duplicate.ug}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Client = {
        id: editingId || uuidv4(),
        ug: String(clientFormData.ug).trim(),
        name: clientFormData.name.trim(),
        sector: clientFormData.sector.trim(),
        command: clientFormData.command.trim()
      };
      await db.saveClient(payload);
      closeModals();
      await refresh();
    } catch (err: any) {
      console.error(err);
      setClientError(`Erro ao salvar cliente: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveService = async () => {
    setServiceError(null);
    if (!serviceFormData.name || !serviceFormData.unitMeasure || !serviceFormData.acronym) {
      setServiceError("Preencha todos os campos do serviço.");
      return;
    }
    const dupService = services.find(s => s.id !== editingId && s.acronym.trim().toUpperCase() === serviceFormData.acronym!.trim().toUpperCase());
    if (dupService) {
      setServiceError(`Já existe um serviço com a sigla ${dupService.acronym} (${dupService.name}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: ServiceDefinition = {
        id: editingId || uuidv4(),
        name: serviceFormData.name,
        unitMeasure: serviceFormData.unitMeasure,
        acronym: serviceFormData.acronym
      };
      await db.saveService(payload);
      closeModals();
      await refresh();
    } catch (err: any) {
      console.error(err);
      setServiceError(`Erro ao salvar serviço: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      if (activeTab === 'clients') await db.deleteClient(deleteId);
      if (activeTab === 'services') await db.deleteService(deleteId);
      setPageError(null);
    } catch (err: any) {
      setPageError(`Não foi possível excluir: ${err?.message || 'erro desconhecido'}`);
    } finally {
      setIsDeleteModalOpen(false);
      setDeleteId(null);
      await refresh();
    }
  };

  const closeModals = () => {
    setIsClientModalOpen(false);
    setIsServiceModalOpen(false);
    setIsDeleteModalOpen(false);
    setClientFormData({});
    setServiceFormData({});
    setEditingId(null);
    setClientError(null);
    setServiceError(null);
  };

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
      XLSX.writeFile(wb, `SISCONT_BACKUP_${new Date().toISOString().split('T')[0]}.xlsx`);
      setSystemMsg({
        type: 'ok',
        text: `Backup gerado: ${data.invoices.length} faturas, ${data.documents.length} documentos, ${data.allocations.length} alocações, ${data.exits.length} saídas, ${data.clients.length} clientes, ${data.services.length} serviços.`
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
        await refresh(true);
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
      await refresh(true);
    } catch (err: any) {
      setSystemMsg({ type: 'error', text: `Erro na migração: ${err?.message}` });
    } finally {
      setIsSystemBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Administração</h2>
          <p className="text-slate-500 text-sm">Controle de acessos, cadastros base e sistema</p>
        </div>
        <div className="flex gap-2 items-center">
          {lastUpdated && (
            <span className="text-[10px] text-slate-400 font-medium hidden sm:inline-block">
              Atualizado: {lastUpdated.toLocaleTimeString('pt-BR')}
            </span>
          )}
          <Button size="sm" variant="secondary" onClick={handleSystemBackup} isLoading={isSystemBusy}>
            {!isSystemBusy && <Save className="mr-2 h-4 w-4" />} Backup (XLSX)
          </Button>
          {(activeTab === 'clients' || activeTab === 'services') && (
            <Button size="sm" onClick={() => {
              setEditingId(null);
              if (activeTab === 'clients') setIsClientModalOpen(true);
              if (activeTab === 'services') setIsServiceModalOpen(true);
            }}>
              <Plus className="mr-2 h-4 w-4" /> Incluir {activeTab === 'clients' ? 'Cliente' : 'Serviço'}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto">
        {(['users', 'clients', 'services', 'backup'] as AdminTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab
              ? 'border-primary-600 text-primary-700 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
          >
            {tab === 'users' ? 'Usuários' : tab === 'clients' ? 'Clientes (UG)' : tab === 'services' ? 'Tipos de Serviço' : 'Sistema'}
          </button>
        ))}
      </div>

      {pageError && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {pageError}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* --- USERS TAB --- */}
        {activeTab === 'users' && <UsersPanel />}

        {/* --- CLIENTS TAB --- */}
        {activeTab === 'clients' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">UG</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Cliente / OM</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Setor</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Comando</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clients.map(c => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-bold text-primary-700">{c.ug}</td>
                    <td className="px-6 py-4 text-sm text-slate-900 font-medium">{c.name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{c.sector}</td>
                    <td className="px-6 py-4 text-sm text-slate-500">{c.command}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setEditingId(c.id); setClientFormData(c); setIsClientModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-primary-600 transition-colors"><Edit size={16} /></button>
                        <button onClick={() => { setDeleteId(c.id); setIsDeleteModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {clients.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400 italic">Nenhum cliente cadastrado. Use o botão Incluir para começar.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* --- SERVICES TAB --- */}
        {activeTab === 'services' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Sigla</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Serviço</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Unid. Medida</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {services.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-black text-slate-800 uppercase">{s.acronym}</td>
                    <td className="px-6 py-4 text-sm text-slate-900 font-medium">{s.name}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">{s.unitMeasure}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setEditingId(s.id); setServiceFormData(s); setIsServiceModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-primary-600 transition-colors"><Edit size={16} /></button>
                        <button onClick={() => { setDeleteId(s.id); setIsDeleteModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {services.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-400 italic">Nenhum serviço cadastrado. Use o botão Incluir para começar.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

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

      {/* --- MODALS --- */}

      {/* CLIENT MODAL */}
      <Modal isOpen={isClientModalOpen} onClose={closeModals} title={editingId ? "Editar Cliente" : "Novo Cliente (UG)"}>
        <div className="space-y-4">
          {clientError && <div className="p-2 bg-red-50 text-red-600 text-xs rounded border border-red-100 font-bold">{clientError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Código OM/UG" inputMode="numeric" maxLength={6} value={clientFormData.ug || ''} onChange={e => setClientFormData({ ...clientFormData, ug: e.target.value.replace(/\D/g, '') })} placeholder="Ex: 40002" />
            <Input label="Comando" value={clientFormData.command || ''} onChange={e => setClientFormData({ ...clientFormData, command: e.target.value })} placeholder="ex: BNIC" />
          </div>
          <Input label="Nome da OM / Cliente" value={clientFormData.name || ''} onChange={e => setClientFormData({ ...clientFormData, name: e.target.value })} placeholder="Ex: Base Naval..." />
          <Input label="Setor" value={clientFormData.sector || ''} onChange={e => setClientFormData({ ...clientFormData, sector: e.target.value })} placeholder="Ex: Logística / Finanças" />

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={closeModals} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={handleSaveClient} isLoading={isSubmitting}>Salvar Cliente</Button>
          </div>
        </div>
      </Modal>

      {/* SERVICE MODAL */}
      <Modal isOpen={isServiceModalOpen} onClose={closeModals} title={editingId ? "Editar Serviço" : "Novo Tipo de Serviço"}>
        <div className="space-y-4">
          {serviceError && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium">{serviceError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Sigla" value={serviceFormData.acronym || ''} onChange={e => setServiceFormData({ ...serviceFormData, acronym: e.target.value.toUpperCase() })} placeholder="Ex: AE" disabled={isSubmitting} />
            <Input label="Unid. Medida" value={serviceFormData.unitMeasure || ''} onChange={e => setServiceFormData({ ...serviceFormData, unitMeasure: e.target.value.toUpperCase() })} placeholder="Ex: M³ / UN" disabled={isSubmitting} />
          </div>
          <Input label="Nome do Serviço" value={serviceFormData.name || ''} onChange={e => setServiceFormData({ ...serviceFormData, name: e.target.value })} placeholder="Ex: Água e Esgoto" disabled={isSubmitting} />

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={closeModals} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={handleSaveService} isLoading={isSubmitting}>Salvar Serviço</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleDelete} title="Excluir Registro" message="Tem certeza? Esta ação removerá o registro permanentemente." />
    </div>
  );
};
