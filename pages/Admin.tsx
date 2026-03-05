
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/db';
import { User, UserRole, Client, ServiceDefinition } from '../types';
import { Button } from '../components/ui/Button';
import { Input, Select } from '../components/ui/Input';
import { Modal, ConfirmModal } from '../components/ui/Modal';
// Added missing Database import
// @ts-ignore
import * as XLSX from 'xlsx';
import { Trash2, Edit, Key, Users, Upload, Plus, Building2, Wrench, Save, UserCheck, Shield, Database, Cloud } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';


type AdminTab = 'users' | 'clients' | 'services' | 'backup';

export const Admin: React.FC = () => {
  const [activeTab, setActiveTab] = useState<AdminTab>('users');

  // --- STATE: DATA ---
  const [users, setUsers] = useState<User[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<ServiceDefinition[]>([]);

  // --- STATE: MODALS ---
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [isServiceModalOpen, setIsServiceModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // --- STATE: FORMS ---
  const [userFormData, setUserFormData] = useState<Partial<User>>({});
  const [clientFormData, setClientFormData] = useState<Partial<Client>>({});
  const [serviceFormData, setServiceFormData] = useState<Partial<ServiceDefinition>>({});
  const [passwordData, setPasswordData] = useState({ id: '', newPassword: '' });

  // --- STATE: HELPERS ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const backupInputRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const [usrs, clnts, svcs] = await Promise.all([
      db.getUsers(),
      db.getClients(),
      db.getServices()
    ]);
    setUsers(usrs);
    setClients(clnts);
    setServices(svcs);
  };

  useEffect(() => { refresh(); }, []);

  // --- CRUD ACTIONS ---

  const handleSaveUser = async () => {
    setUserError(null);
    const missing = [];
    if (!userFormData.name) missing.push("Nome");
    if (!userFormData.email) missing.push("E-mail");
    if (!editingId && !userFormData.password) missing.push("Senha");

    if (missing.length > 0) {
      setUserError(`Campos obrigatórios: ${missing.join(', ')}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: User = {
        id: editingId || uuidv4(),
        name: userFormData.name || '',
        email: userFormData.email || '',
        role: (userFormData.role as UserRole) || UserRole.USER,
        password: userFormData.password || (editingId ? users.find(u => u.id === editingId)?.password : '123')
      };
      await db.saveUser(payload);
      closeModals();
      await refresh();
    } catch (err: any) {
      console.error(err);
      setUserError(`Erro ao salvar usuário: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveClient = async () => {
    setClientError(null);
    if (!clientFormData.name || !clientFormData.ug || !clientFormData.sector || !clientFormData.command) {
      setClientError("Preencha todos os campos do cliente.");
      return;
    }

    const duplicate = clients.find(c =>
      c.id !== editingId && (c.ug === clientFormData.ug)
    );

    if (duplicate) {
      setClientError(`Já existe um cliente com esta UG (${duplicate.ug}).`);
      return;
    }

    setIsSubmitting(true);
    try {
      const payload: Client = {
        id: editingId || uuidv4(),
        ug: clientFormData.ug,
        name: clientFormData.name,
        sector: clientFormData.sector,
        command: clientFormData.command
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
    if (deleteId) {
      if (activeTab === 'users') await db.deleteUser(deleteId);
      if (activeTab === 'clients') await db.deleteClient(deleteId);
      if (activeTab === 'services') await db.deleteService(deleteId);
      setIsDeleteModalOpen(false);
      setDeleteId(null);
      await refresh();
    }
  };

  const handleChangePassword = async () => {
    // Note: Changing passwords for other users typically requires administrative privileges via Supabase Auth API
    // or a custom edge function. For now, we update the profile metadata if it exists.
    if (!passwordData.id || !passwordData.newPassword) return;
    alert('A alteração de senha de outros usuários deve ser feita diretamente no painel do Supabase Auth por segurança.');
    setIsPasswordModalOpen(false);
  };

  const closeModals = () => {
    setIsUserModalOpen(false);
    setIsClientModalOpen(false);
    setIsServiceModalOpen(false);
    setIsPasswordModalOpen(false);
    setIsDeleteModalOpen(false);
    setUserFormData({});
    setClientFormData({});
    setServiceFormData({});
    setEditingId(null);
    setClientError(null);
    setUserError(null);
    setServiceError(null);
  };

  // --- BACKUP ACTIONS ---
  const handleSystemBackup = () => {
    const data = db.getAllData();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.invoices), "Faturas");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.documents), "Documentos");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.allocations), "Alocacoes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.clients), "Clientes");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.services), "Servicos");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.users), "Usuarios");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.exits), "Saidas");
    XLSX.writeFile(wb, `SISCONT_BACKUP_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleSystemRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const backupData: any = {};
        if (workbook.Sheets["Faturas"]) backupData.invoices = XLSX.utils.sheet_to_json(workbook.Sheets["Faturas"]);
        if (workbook.Sheets["Documentos"]) backupData.documents = XLSX.utils.sheet_to_json(workbook.Sheets["Documentos"]);
        if (workbook.Sheets["Alocacoes"]) backupData.allocations = XLSX.utils.sheet_to_json(workbook.Sheets["Alocacoes"]);
        if (workbook.Sheets["Clientes"]) backupData.clients = XLSX.utils.sheet_to_json(workbook.Sheets["Clientes"]);
        if (workbook.Sheets["Servicos"]) backupData.services = XLSX.utils.sheet_to_json(workbook.Sheets["Servicos"]);
        if (workbook.Sheets["Usuarios"]) backupData.users = XLSX.utils.sheet_to_json(workbook.Sheets["Usuarios"]);
        if (workbook.Sheets["Saidas"]) backupData.exits = XLSX.utils.sheet_to_json(workbook.Sheets["Saidas"]);

        if (window.confirm('Atenção: Restaurar o sistema substituirá TODOS os dados atuais. Deseja continuar?')) {
          db.restoreBackup(backupData);
          alert('Sistema restaurado com sucesso. A página será reiniciada.');
          window.location.reload();
        }
      } catch (err) {
        alert('Erro ao processar arquivo de backup.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSupabaseSync = async () => {
    if (window.confirm('Deseja enviar todos os dados locais para o Supabase? Isso pode sobrescrever dados com o mesmo ID.')) {
      try {
        await db.syncToSupabase();
        alert('Sincronização concluída com sucesso!');
      } catch (err) {
        console.error(err);
        alert('Erro ao sincronizar dados.');
      }
    }
  };

  const handleSupabasePull = async () => {
    if (window.confirm('Atenção: Isso substituirá os dados locais pelos dados do Supabase. Deseja continuar?')) {
      try {
        await db.pullFromSupabase();
        alert('Dados baixados com sucesso! Reiniciando a página...');
        window.location.reload();
      } catch (err) {
        console.error(err);
        alert('Erro ao baixar dados do Supabase.');
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Administração</h2>
          <p className="text-slate-500 text-sm">Controle de acessos, cadastros base e sistema</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={handleSystemBackup}>
            <Save className="mr-2 h-4 w-4" /> Backup (XLSX)
          </Button>
          <Button size="sm" onClick={() => {
            setEditingId(null);
            if (activeTab === 'users') setIsUserModalOpen(true);
            if (activeTab === 'clients') setIsClientModalOpen(true);
            if (activeTab === 'services') setIsServiceModalOpen(true);
          }}>
            <Plus className="mr-2 h-4 w-4" /> Incluir {activeTab === 'users' ? 'Usuário' : activeTab === 'clients' ? 'Cliente' : 'Serviço'}
          </Button>
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* --- USERS TAB --- */}
        {activeTab === 'users' && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nome</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">E-mail</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Perfil</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900 flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 rounded-full text-slate-600"><Users size={14} /></div>
                      {u.name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{u.email}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${u.role === UserRole.ADMIN ? 'bg-indigo-100 text-indigo-700' :
                        u.role === UserRole.USER ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                        }`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setEditingId(u.id); setUserFormData(u); setIsUserModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-primary-600 transition-colors"><Edit size={16} /></button>
                        <button onClick={() => { setPasswordData({ id: u.id, newPassword: '' }); setIsPasswordModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-orange-600 transition-colors" title="Trocar Senha"><Key size={16} /></button>
                        <button onClick={() => { setDeleteId(u.id); setIsDeleteModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-red-600 transition-colors"><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
              </tbody>
            </table>
          </div>
        )}

        {/* --- BACKUP / SYSTEM TAB --- */}
        {activeTab === 'backup' && (
          <div className="p-8 max-w-2xl mx-auto space-y-8">
            <div className="bg-blue-50/50 p-6 rounded-2xl border border-blue-100 flex items-start gap-4">
              <div className="p-3 bg-blue-100 rounded-xl text-blue-600"><Database size={24} /></div>
              <div>
                <h3 className="text-lg font-bold text-blue-900">Gerar Backup do Sistema</h3>
                <p className="text-sm text-blue-700 mb-4">Exporta todas as faturas, adiantamentos e cadastros para um arquivo Excel protegido.</p>
                <Button onClick={handleSystemBackup} className="shadow-blue-200"><Save className="mr-2 h-4 w-4" /> Baixar Planilha de Backup</Button>
              </div>
            </div>

            <div className="bg-red-50/50 p-6 rounded-2xl border border-red-100 flex items-start gap-4">
              <div className="p-3 bg-red-100 rounded-xl text-red-600"><Upload size={24} /></div>
              <div>
                <h3 className="text-lg font-bold text-red-900">Restaurar Dados</h3>
                <p className="text-sm text-red-700 mb-4">Carrega um backup anterior do SISCONT. Isso apagará todos os dados atuais permanentemente.</p>
                <input type="file" ref={backupInputRef} onChange={handleSystemRestore} accept=".xlsx" className="hidden" />
                <Button variant="danger" onClick={() => backupInputRef.current?.click()} className="shadow-red-200"><Shield className="mr-2 h-4 w-4" /> Importar do Excel</Button>
              </div>
            </div>

            <div className="bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 flex items-start gap-4">
              <div className="p-3 bg-emerald-100 rounded-xl text-emerald-600"><Cloud size={24} /></div>
              <div>
                <h3 className="text-lg font-bold text-emerald-900">Nuvem Supabase</h3>
                <p className="text-sm text-emerald-700 mb-4">Sincronize seus dados locais com o servidor Supabase configurado.</p>
                <div className="flex gap-4">
                  <Button variant="secondary" onClick={handleSupabaseSync} className="shadow-emerald-200"><Save className="mr-2 h-4 w-4" /> Enviar para Nuvem</Button>
                  <Button variant="ghost" onClick={handleSupabasePull} className="text-emerald-700 hover:bg-emerald-100"><Upload className="mr-2 h-4 w-4" /> Baixar da Nuvem</Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* --- MODALS --- */}

      {/* USER MODAL */}
      <Modal isOpen={isUserModalOpen} onClose={closeModals} title={editingId ? "Editar Usuário" : "Novo Usuário"}>
        <div className="space-y-4">
          {userError && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium">{userError}</div>}
          <Input label="Nome Completo" value={userFormData.name || ''} onChange={e => setUserFormData({ ...userFormData, name: e.target.value })} placeholder="Ex: 1ºSG-AD Silva" disabled={isSubmitting} />
          <Input label="E-mail" type="email" value={userFormData.email || ''} onChange={e => setUserFormData({ ...userFormData, email: e.target.value })} placeholder="nome@siscont.com" disabled={isSubmitting} />
          {!editingId && <Input label="Senha Inicial" type="password" value={userFormData.password || ''} onChange={e => setUserFormData({ ...userFormData, password: e.target.value })} disabled={isSubmitting} />}
          <Select label="Perfil de Acesso" options={[{ label: 'Administrador', value: UserRole.ADMIN }, { label: 'Operador', value: UserRole.USER }, { label: 'Consulta', value: UserRole.READ_ONLY }]} value={userFormData.role || ''} onChange={e => setUserFormData({ ...userFormData, role: e.target.value as UserRole })} disabled={isSubmitting} />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={closeModals} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={handleSaveUser} isLoading={isSubmitting}>Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* CLIENT MODAL */}
      <Modal isOpen={isClientModalOpen} onClose={closeModals} title={editingId ? "Editar Cliente" : "Novo Cliente (UG)"}>
        <div className="space-y-4">
          {clientError && <div className="p-2 bg-red-50 text-red-600 text-xs rounded border border-red-100 font-bold">{clientError}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="UG (6 dígitos)" value={clientFormData.ug || ''} onChange={e => setClientFormData({ ...clientFormData, ug: e.target.value })} placeholder="789XXX" />
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

      {/* PASSWORD MODAL */}
      <Modal isOpen={isPasswordModalOpen} onClose={closeModals} title="Redefinir Senha">
        <div className="space-y-4">
          <Input label="Nova Senha" type="password" value={passwordData.newPassword} onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })} />
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={closeModals}>Cancelar</Button>
            <Button onClick={handleChangePassword}>Atualizar Senha</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal isOpen={isDeleteModalOpen} onClose={() => setIsDeleteModalOpen(false)} onConfirm={handleDelete} title="Excluir Registro" message="Tem certeza? Esta ação removerá o registro permanentemente." />
    </div>
  );
};
