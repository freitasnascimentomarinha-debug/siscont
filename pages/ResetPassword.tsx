import React, { useState } from 'react';
import { KeyRound, Info } from 'lucide-react';
import { useAuth, MIN_PASSWORD_LENGTH } from '../context/AuthContext';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';

/** Exibida quando o usuário abre o link de "Esqueci minha senha" recebido por e-mail. */
export const ResetPassword: React.FC = () => {
  const { updatePassword, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    if (password !== confirm) return setError('A confirmação não confere com a senha.');
    setBusy(true);
    try {
      await updatePassword(password);
      // Limpa o token de recuperação da URL
      window.history.replaceState(null, '', window.location.pathname);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md space-y-5" noValidate>
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-100 text-primary-600 mb-3"><KeyRound size={32} /></div>
          <h2 className="text-2xl font-black text-slate-800">Criar nova senha</h2>
          <p className="text-sm text-slate-500 mt-1">Defina a nova senha de acesso ao SISCONT.</p>
        </div>
        <Input label="Nova senha" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres`} disabled={busy} />
        <Input label="Confirmar nova senha" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" disabled={busy} />
        {error && <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 flex items-center gap-2" role="alert"><Info size={14} /> {error}</div>}
        <Button type="submit" className="w-full h-12" isLoading={busy}>Salvar nova senha</Button>
        <button type="button" onClick={logout} className="w-full text-xs text-slate-400 hover:text-slate-600">Cancelar e voltar ao login</button>
      </form>
    </div>
  );
};
