import React, { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAuth, MIN_PASSWORD_LENGTH } from '../context/AuthContext';
import { ROLE_LABELS } from '../types';
import { Modal } from './ui/Modal';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

/** "Minha Conta": o próprio usuário altera o nome e a senha. */
export const AccountModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { user, updateOwnName, updatePassword } = useAuth();
  const [name, setName] = useState('');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<'name' | 'password' | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName(user?.name || '');
      setCurrent(''); setNext(''); setConfirm('');
      setError(null); setSuccess(null);
    }
  }, [isOpen, user?.name]);

  const saveName = async () => {
    setError(null); setSuccess(null); setBusy('name');
    try {
      await updateOwnName(name);
      setSuccess('Nome atualizado.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const savePassword = async () => {
    setError(null); setSuccess(null);
    if (!current) return setError('Informe a senha atual.');
    if (next.length < MIN_PASSWORD_LENGTH) return setError(`A nova senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (next !== confirm) return setError('A confirmação não confere com a nova senha.');
    setBusy('password');
    try {
      await updatePassword(next, current);
      setCurrent(''); setNext(''); setConfirm('');
      setSuccess('Senha alterada com sucesso.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={() => !busy && onClose()} title="Minha Conta">
      <div className="space-y-6">
        <div className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 border border-slate-100">
          <p><span className="text-slate-400">E-mail:</span> <b>{user?.email}</b></p>
          <p><span className="text-slate-400">Perfil:</span> <b>{user ? ROLE_LABELS[user.role] : ''}</b></p>
        </div>

        {error && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 font-medium" role="alert">{error}</div>}
        {success && <div className="p-3 bg-emerald-50 text-emerald-700 text-xs rounded-lg border border-emerald-100 font-medium flex items-center gap-2" role="status"><CheckCircle2 size={14} /> {success}</div>}

        <div className="space-y-3">
          <Input label="Nome" value={name} onChange={e => setName(e.target.value)} disabled={!!busy} />
          <div className="flex justify-end">
            <Button size="sm" variant="secondary" onClick={saveName} isLoading={busy === 'name'} disabled={!name.trim() || name.trim() === user?.name}>Salvar nome</Button>
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-slate-100">
          <p className="text-sm font-semibold text-slate-700">Alterar senha</p>
          <Input label="Senha atual" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" disabled={!!busy} />
          <Input label="Nova senha" type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`} disabled={!!busy} />
          <Input label="Confirmar nova senha" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" disabled={!!busy} />
          <div className="flex justify-end">
            <Button size="sm" onClick={savePassword} isLoading={busy === 'password'}>Alterar senha</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
