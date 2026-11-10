import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Edit, Eye, EyeOff, Key, Lock, MailWarning, Plus,
  RefreshCw, Search, ShieldCheck, Trash2, Unlock, UserCheck, Users, Wand2,
} from 'lucide-react';
import { adminApi, AdminApiError } from '../../services/adminApi';
import { db } from '../../services/db';
import { useAuth, MIN_PASSWORD_LENGTH } from '../../context/AuthContext';
import { ManagedUser, ROLE_LABELS, UserRole } from '../../types';
import { Button } from '../ui/Button';
import { Input, Select } from '../ui/Input';
import { Modal } from '../ui/Modal';

const ROLE_OPTIONS = [
  { label: 'Administrador — vê todas as páginas, inclusive esta tela', value: UserRole.ADMIN },
  { label: 'Operador — todas as páginas, exceto Administração; inclui, edita e exclui lançamentos', value: UserRole.USER },
  { label: 'Consulta — só o Painel inicial (visualiza e exporta)', value: UserRole.READ_ONLY },
  { label: 'Encarregado — Painel inicial e Painel do Encarregado (visualiza e exporta)', value: UserRole.ENCARREGADO },
  { label: 'Treinamento — vê todas as páginas (menos Administração) e pode lançar, mas só em dados de TESTE: nada chega ao banco', value: UserRole.TREINAMENTO },
];

const ROLE_BADGE: Record<UserRole, string> = {
  [UserRole.ADMIN]: 'bg-indigo-100 text-indigo-700',
  [UserRole.USER]: 'bg-emerald-100 text-emerald-700',
  [UserRole.READ_ONLY]: 'bg-slate-100 text-slate-600',
  [UserRole.ENCARREGADO]: 'bg-amber-100 text-amber-800',
  [UserRole.TREINAMENTO]: 'bg-fuchsia-100 text-fuchsia-800',
};

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/** Gera senha aleatória legível (sem caracteres ambíguos). */
export const generatePassword = (length = 12) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const digits = '23456789';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  let pwd = Array.from(arr, n => chars[n % chars.length]).join('');
  // garante ao menos um dígito
  if (!/\d/.test(pwd)) pwd = pwd.slice(0, -1) + digits[arr[0] % digits.length];
  return pwd;
};

const PasswordField: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  allowGenerate?: boolean;
}> = ({ label, value, onChange, disabled, allowGenerate }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <Input
            label={label}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            autoComplete="new-password"
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setVisible(v => !v)}
            className="absolute right-2 bottom-2 text-slate-400 hover:text-slate-600"
            title={visible ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {allowGenerate && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => { onChange(generatePassword()); setVisible(true); }}
            disabled={disabled}
            title="Gerar senha aleatória"
          >
            <Wand2 size={16} />
          </Button>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-1">Mínimo de {MIN_PASSWORD_LENGTH} caracteres. Informe a senha ao usuário por canal seguro.</p>
    </div>
  );
};

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: ManagedUser }
  | { kind: 'password'; user: ManagedUser }
  | { kind: 'toggle'; user: ManagedUser }
  | { kind: 'delete'; user: ManagedUser }
  | null;

export const UsersPanel: React.FC = () => {
  const { user: me, refreshProfile } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState(true);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'' | UserRole | 'BLOCKED'>('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [form, setForm] = useState({ name: '', email: '', role: UserRole.USER as UserRole, password: '', confirm: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const showFlash = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(null), 5000);
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const list = await adminApi.listUsers();
      setUsers(list);
      setApiAvailable(true);
      setApiMessage(null);
    } catch (err: any) {
      if (err instanceof AdminApiError && err.notConfigured) {
        // Modo limitado: lê os perfis direto do banco
        setApiAvailable(false);
        setApiMessage(err.message);
        try {
          db.invalidateCache('users');
          const profiles = await db.getUsers();
          setUsers(
            profiles
              .map(p => ({
                ...p,
                role: (p.role as UserRole) || UserRole.READ_ONLY,
                active: (p as any).active !== false,
                createdAt: (p as any).created_at || null,
                lastSignInAt: null,
                emailConfirmed: true,
              }))
              .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'))
          );
        } catch (e: any) {
          setLoadError(`Não foi possível carregar os usuários: ${e.message}`);
        }
      } else {
        setLoadError(err?.message || 'Erro ao carregar usuários.');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pending = useMemo(() => users.filter(u => !u.active && !u.lastSignInAt), [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(u => {
      if (roleFilter === 'BLOCKED' && u.active) return false;
      if (roleFilter && roleFilter !== 'BLOCKED' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
    });
  }, [users, search, roleFilter]);

  const counts = useMemo(() => ({
    total: users.length,
    admin: users.filter(u => u.role === UserRole.ADMIN).length,
    user: users.filter(u => u.role === UserRole.USER).length,
    readOnly: users.filter(u => u.role === UserRole.READ_ONLY).length,
    encarregado: users.filter(u => u.role === UserRole.ENCARREGADO).length,
    treinamento: users.filter(u => u.role === UserRole.TREINAMENTO).length,
    blocked: users.filter(u => !u.active).length,
  }), [users]);

  const open = (d: Dialog) => {
    setFormError(null);
    if (d?.kind === 'create') setForm({ name: '', email: '', role: UserRole.USER, password: generatePassword(), confirm: '' });
    if (d?.kind === 'edit') setForm({ name: d.user.name, email: d.user.email, role: d.user.role, password: '', confirm: '' });
    if (d?.kind === 'password') setForm(f => ({ ...f, password: '', confirm: '' }));
    setDialog(d);
  };
  const close = () => { if (!isSubmitting) setDialog(null); };

  const run = async (fn: () => Promise<any>, success: string) => {
    setIsSubmitting(true);
    setFormError(null);
    try {
      await fn();
      setDialog(null);
      showFlash(success);
      db.invalidateCache('users');
      await load();
    } catch (err: any) {
      const msg = err?.message || 'Erro inesperado.';
      // Ações rápidas (sem diálogo aberto) mostram o erro no topo
      if (dialog) setFormError(msg);
      else setLoadError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitCreate = () => {
    if (!form.name.trim()) return setFormError('Informe o nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setFormError('Informe um e-mail válido.');
    if (form.password.length < MIN_PASSWORD_LENGTH) return setFormError(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    run(
      () => adminApi.createUser({ name: form.name.trim(), email: form.email.trim(), password: form.password, role: form.role }),
      `Usuário ${form.name.trim()} criado. Ele já pode entrar com o e-mail e a senha definidos.`
    );
  };

  const submitEdit = (u: ManagedUser) => {
    if (!form.name.trim()) return setFormError('Informe o nome.');
    const isSelf = u.id === me?.id;
    if (isSelf && u.role === UserRole.ADMIN && form.role !== UserRole.ADMIN) {
      return setFormError('Você não pode remover o seu próprio perfil de administrador.');
    }
    run(async () => {
      if (apiAvailable) {
        await adminApi.updateUser({
          id: u.id,
          name: form.name.trim(),
          role: form.role,
          ...(form.email.trim().toLowerCase() !== (u.email || '').toLowerCase() ? { email: form.email.trim() } : {}),
        });
      } else {
        await db.updateProfile({ id: u.id, name: form.name.trim(), role: form.role });
      }
      if (isSelf) await refreshProfile();
    }, 'Usuário atualizado.');
  };

  const submitPassword = (u: ManagedUser) => {
    if (form.password.length < MIN_PASSWORD_LENGTH) return setFormError(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (form.password !== form.confirm) return setFormError('A confirmação não confere com a nova senha.');
    run(() => adminApi.setPassword(u.id, form.password), `Senha de ${u.name} redefinida.`);
  };

  const submitToggle = (u: ManagedUser, role?: UserRole) => {
    const activate = !u.active;
    run(async () => {
      if (apiAvailable) {
        if (activate && role && role !== u.role) await adminApi.updateUser({ id: u.id, role });
        await adminApi.setActive(u.id, activate);
      } else {
        await db.updateProfile({ id: u.id, active: activate, ...(role ? { role } : {}) });
      }
    }, activate ? `Acesso de ${u.name} liberado.` : `Acesso de ${u.name} bloqueado.`);
  };

  const submitDelete = (u: ManagedUser) => run(() => adminApi.deleteUser(u.id), `Usuário ${u.name} excluído.`);

  const needsApi = (label: string) => (apiAvailable ? undefined : `${label} requer a API de usuários configurada no servidor`);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {!apiAvailable && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm flex gap-3">
          <AlertTriangle className="shrink-0 mt-0.5" size={18} />
          <div className="space-y-1">
            <p className="font-bold">Modo limitado: API de usuários não configurada</p>
            <p>{apiMessage}</p>
            <p>
              Neste modo é possível apenas editar nome/perfil e liberar/bloquear pelo cadastro. Para <b>criar logins,
              redefinir senhas e excluir usuários</b>, cadastre a variável <code className="bg-amber-100 px-1 rounded">SUPABASE_SERVICE_ROLE_KEY</code> na
              Vercel (Settings → Environment Variables) e faça um novo deploy. Veja <code className="bg-amber-100 px-1 rounded">docs/CONFIGURACAO.md</code>.
            </p>
          </div>
        </div>
      )}

      {flash && (
        <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm flex items-center gap-2" role="status">
          <CheckCircle2 size={16} /> {flash}
        </div>
      )}

      {loadError && (
        <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {loadError}
        </div>
      )}

      {/* Pendentes de liberação */}
      {pending.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4">
          <p className="text-sm font-bold text-orange-900 flex items-center gap-2 mb-3">
            <Clock size={16} /> {pending.length} cadastro(s) aguardando liberação
          </p>
          <div className="space-y-2">
            {pending.map(u => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-lg border border-orange-100 px-3 py-2">
                <div className="text-sm">
                  <span className="font-semibold text-slate-800">{u.name}</span>
                  <span className="text-slate-500"> · {u.email}</span>
                  {!u.emailConfirmed && <span className="ml-2 text-[10px] text-orange-600 font-bold uppercase">e-mail não confirmado</span>}
                  <span className="text-slate-400 text-xs"> · solicitado em {fmtDateTime(u.createdAt)}</span>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => submitToggle(u, UserRole.READ_ONLY)} disabled={isSubmitting}>Liberar como Consulta</Button>
                  <Button size="sm" onClick={() => submitToggle(u, UserRole.USER)} disabled={isSubmitting}><UserCheck size={14} className="mr-1" /> Liberar como Operador</Button>
                  <button onClick={() => open({ kind: 'delete', user: u })} disabled={!apiAvailable} title={needsApi('Recusar') || 'Recusar e excluir cadastro'} className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Barra de ferramentas */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2 text-xs">
          {[
            { key: '' as const, label: `Todos (${counts.total})` },
            { key: UserRole.ADMIN, label: `Administradores (${counts.admin})` },
            { key: UserRole.USER, label: `Operadores (${counts.user})` },
            { key: UserRole.READ_ONLY, label: `Consulta (${counts.readOnly})` },
            { key: UserRole.ENCARREGADO, label: `Encarregado (${counts.encarregado})` },
            { key: UserRole.TREINAMENTO, label: `Treinamento (${counts.treinamento})` },
            { key: 'BLOCKED' as const, label: `Bloqueados/Pendentes (${counts.blocked})` },
          ].map(f => (
            <button
              key={f.key || 'all'}
              onClick={() => setRoleFilter(f.key)}
              className={`px-3 py-1.5 rounded-full border font-semibold transition-colors ${roleFilter === f.key ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar nome ou e-mail"
              className="pl-8 pr-3 h-8 text-sm rounded-md border border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary-500 w-56"
            />
          </div>
          <Button size="sm" variant="ghost" onClick={load} isLoading={isLoading} title="Recarregar lista">
            {!isLoading && <RefreshCw size={14} className="mr-1" />} Recarregar
          </Button>
          <Button size="sm" className="whitespace-nowrap" onClick={() => open({ kind: 'create' })} disabled={!apiAvailable} title={needsApi('Criar usuário')}>
            <Plus size={14} className="mr-1" /> Novo Usuário
          </Button>
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full divide-y divide-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Nome</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">E-mail</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Perfil</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Situação</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Último acesso</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {filtered.map(u => {
              const isSelf = u.id === me?.id;
              return (
                <tr key={u.id} className={`hover:bg-slate-50 ${!u.active ? 'opacity-70' : ''}`}>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-slate-100 rounded-full text-slate-600"><Users size={14} /></div>
                      <span>{u.name}</span>
                      {isSelf && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 font-bold uppercase">você</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {u.email || <span className="text-orange-500 italic text-xs">sem e-mail no perfil</span>}
                    {u.email && !u.emailConfirmed && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-orange-600 font-bold" title="O usuário ainda não confirmou o e-mail">
                        <MailWarning size={12} /> não confirmado
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${ROLE_BADGE[u.role]}`}>{ROLE_LABELS[u.role]}</span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {u.active ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold"><ShieldCheck size={14} /> Ativo</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-600 text-xs font-semibold"><Lock size={14} /> {u.lastSignInAt ? 'Bloqueado' : 'Pendente'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{apiAvailable ? fmtDateTime(u.lastSignInAt) : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => open({ kind: 'edit', user: u })} className="p-1.5 text-slate-400 hover:text-primary-600" title="Editar"><Edit size={16} /></button>
                      <button onClick={() => open({ kind: 'password', user: u })} disabled={!apiAvailable} className="p-1.5 text-slate-400 hover:text-orange-600 disabled:opacity-30" title={needsApi('Redefinir senha') || 'Redefinir senha'}><Key size={16} /></button>
                      <button
                        onClick={() => open({ kind: 'toggle', user: u })}
                        disabled={isSelf}
                        className={`p-1.5 text-slate-400 disabled:opacity-30 ${u.active ? 'hover:text-red-600' : 'hover:text-emerald-600'}`}
                        title={isSelf ? 'Você não pode bloquear a si mesmo' : u.active ? 'Bloquear acesso' : 'Liberar acesso'}
                      >
                        {u.active ? <Lock size={16} /> : <Unlock size={16} />}
                      </button>
                      <button onClick={() => open({ kind: 'delete', user: u })} disabled={isSelf || !apiAvailable} className="p-1.5 text-slate-400 hover:text-red-600 disabled:opacity-30" title={isSelf ? 'Você não pode excluir a si mesmo' : needsApi('Excluir') || 'Excluir usuário'}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!isLoading && filtered.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400 italic text-sm">Nenhum usuário encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --- Diálogos --- */}
      <Modal isOpen={dialog?.kind === 'create'} onClose={close} title="Novo Usuário">
        <div className="space-y-4">
          {formError && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium">{formError}</div>}
          <Input label="Nome (posto/graduação e nome de guerra)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: 1ºSG-AD Silva" disabled={isSubmitting} />
          <Input label="E-mail" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="nome@marinha.mil.br" disabled={isSubmitting} />
          <Select label="Perfil de Acesso" options={ROLE_OPTIONS} value={form.role} onChange={e => setForm({ ...form, role: e.target.value as UserRole })} disabled={isSubmitting} />
          <PasswordField label="Senha inicial" value={form.password} onChange={v => setForm({ ...form, password: v })} disabled={isSubmitting} allowGenerate />
          <p className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded border border-slate-100">O login é criado já confirmado e ativo. Oriente o usuário a trocar a senha em <b>Minha Conta</b> no primeiro acesso.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={close} disabled={isSubmitting}>Cancelar</Button>
            <Button onClick={submitCreate} isLoading={isSubmitting}>Criar Usuário</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={dialog?.kind === 'edit'} onClose={close} title="Editar Usuário">
        {dialog?.kind === 'edit' && (
          <div className="space-y-4">
            {formError && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium">{formError}</div>}
            <Input label="Nome" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} disabled={isSubmitting} />
            <Input
              label="E-mail (login)"
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              disabled={isSubmitting || !apiAvailable}
              title={needsApi('Alterar e-mail')}
            />
            <Select
              label="Perfil de Acesso"
              options={ROLE_OPTIONS}
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value as UserRole })}
              disabled={isSubmitting}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close} disabled={isSubmitting}>Cancelar</Button>
              <Button onClick={() => submitEdit(dialog.user)} isLoading={isSubmitting}>Salvar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={dialog?.kind === 'password'} onClose={close} title="Redefinir Senha">
        {dialog?.kind === 'password' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Nova senha para <b>{dialog.user.name}</b> ({dialog.user.email}).</p>
            {formError && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium">{formError}</div>}
            <PasswordField label="Nova senha" value={form.password} onChange={v => setForm({ ...form, password: v, confirm: '' })} disabled={isSubmitting} allowGenerate />
            <Input label="Confirmar nova senha" type="password" value={form.confirm} onChange={e => setForm({ ...form, confirm: e.target.value })} disabled={isSubmitting} autoComplete="new-password" />
            <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => setForm(f => ({ ...f, confirm: f.password }))}>Usar a senha gerada como confirmação</button>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close} disabled={isSubmitting}>Cancelar</Button>
              <Button onClick={() => submitPassword(dialog.user)} isLoading={isSubmitting}>Redefinir Senha</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={dialog?.kind === 'toggle'} onClose={close} title={dialog?.kind === 'toggle' && dialog.user.active ? 'Bloquear Acesso' : 'Liberar Acesso'}>
        {dialog?.kind === 'toggle' && (
          <div className="space-y-4">
            {formError && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium">{formError}</div>}
            <p className="text-sm text-slate-600">
              {dialog.user.active
                ? <>O usuário <b>{dialog.user.name}</b> não conseguirá mais entrar no sistema. Os lançamentos feitos por ele são mantidos. Você pode liberar o acesso depois.</>
                : <>O usuário <b>{dialog.user.name}</b> voltará a acessar o sistema com o perfil <b>{ROLE_LABELS[dialog.user.role]}</b>.</>}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close} disabled={isSubmitting}>Cancelar</Button>
              <Button variant={dialog.user.active ? 'danger' : 'primary'} onClick={() => submitToggle(dialog.user)} isLoading={isSubmitting}>
                {dialog.user.active ? 'Bloquear' : 'Liberar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={dialog?.kind === 'delete'} onClose={close} title="Excluir Usuário">
        {dialog?.kind === 'delete' && (
          <div className="space-y-4">
            {formError && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium">{formError}</div>}
            <p className="text-sm text-slate-600">
              Excluir definitivamente o login de <b>{dialog.user.name}</b> ({dialog.user.email})? Esta ação não pode ser desfeita.
              Se a intenção for apenas impedir o acesso temporariamente, prefira <b>Bloquear</b>.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={close} disabled={isSubmitting}>Cancelar</Button>
              <Button variant="danger" onClick={() => submitDelete(dialog.user)} isLoading={isSubmitting}>Excluir</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
