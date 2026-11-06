import React, { useState } from 'react';
import { useAuth, MIN_PASSWORD_LENGTH } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ShieldCheck, UserPlus, ArrowLeft, Info, KeyRound, CheckCircle2 } from 'lucide-react';

type Mode = 'login' | 'register' | 'forgot';

export const Login: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, register, requestPasswordReset, authNotice, clearAuthNotice } = useAuth();

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setSuccessMsg('');
    setPassword('');
    setConfirm('');
    clearAuthNotice();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError('');
    setSuccessMsg('');
    clearAuthNotice();

    if (mode === 'register') {
      if (!name.trim() || !email.trim() || !password) return setError('Preencha todos os campos obrigatórios.');
      if (password.length < MIN_PASSWORD_LENGTH) return setError(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      if (password !== confirm) return setError('A confirmação não confere com a senha.');
    }

    setIsSubmitting(true);
    try {
      if (mode === 'register') {
        const result = await register(name, email, password);
        switchMode('login');
        setSuccessMsg(
          result === 'PENDING_CONFIRMATION'
            ? 'Cadastro enviado! Confirme seu e-mail pelo link recebido e aguarde a liberação do acesso pelo administrador.'
            : 'Cadastro enviado! Aguarde a liberação do acesso pelo administrador do SISCONT.'
        );
        setName('');
      } else if (mode === 'forgot') {
        if (!email.trim()) { setError('Informe o e-mail cadastrado.'); return; }
        await requestPasswordReset(email);
        switchMode('login');
        setSuccessMsg('Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Verifique também o spam.');
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Erro de conexão com o servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const title = mode === 'register' ? 'Solicitar Acesso' : mode === 'forgot' ? 'Recuperar Senha' : null;
  const submitLabel = mode === 'register' ? 'Enviar Solicitação' : mode === 'forgot' ? 'Enviar Link de Recuperação' : 'Entrar no Sistema';

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans overflow-y-auto">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1.5 bg-primary-600"></div>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 text-primary-600 mb-4 shadow-inner">
            {mode === 'forgot' ? <KeyRound size={40} /> : <ShieldCheck size={40} />}
          </div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter">SISCONT</h2>
          <p className="text-slate-500 text-sm font-medium uppercase tracking-widest mt-1">Sist. de Controle de Faturas</p>
          {title && <p className="mt-3 text-sm font-bold text-primary-700">{title}</p>}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          {mode === 'register' && (
            <Input
              label="Nome (posto/graduação e nome de guerra)"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: 3ºSG-AD Tamara"
              autoComplete="name"
              disabled={isSubmitting}
              required
            />
          )}

          <Input
            label="E-mail de Acesso"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="nome@marinha.mil.br"
            autoComplete="username"
            disabled={isSubmitting}
            required
          />

          {mode !== 'forgot' && (
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres` : 'Digite sua senha'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              disabled={isSubmitting}
              required
            />
          )}

          {mode === 'register' && (
            <Input
              label="Confirmar Senha"
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={isSubmitting}
              required
            />
          )}

          {mode === 'login' && (
            <div className="text-right -mt-2">
              <button type="button" onClick={() => switchMode('forgot')} className="text-xs text-primary-600 hover:underline font-semibold" disabled={isSubmitting}>
                Esqueci minha senha
              </button>
            </div>
          )}

          {(error || authNotice) && (
            <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 flex items-start gap-2" role="alert">
              <Info size={14} className="shrink-0 mt-0.5" /> <span>{error || authNotice}</span>
            </div>
          )}

          {successMsg && (
            <div className="text-xs text-green-700 bg-green-50 p-3 rounded-lg border border-green-100 flex items-start gap-2" role="status">
              <CheckCircle2 size={14} className="shrink-0 mt-0.5" /> <span>{successMsg}</span>
            </div>
          )}

          <Button type="submit" className="w-full shadow-lg h-12 text-base" size="lg" isLoading={isSubmitting}>
            {submitLabel}
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100">
          {mode === 'login' ? (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => switchMode('register')}
              className="w-full text-sm text-slate-500 hover:text-primary-600 transition-colors flex items-center justify-center gap-2 font-semibold"
            >
              <UserPlus size={16} /> Não tem acesso? Solicite seu cadastro
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => switchMode('login')}
              className="w-full text-sm text-slate-500 hover:text-primary-600 transition-colors flex items-center justify-center gap-2 font-semibold"
            >
              <ArrowLeft size={16} /> Voltar para o login
            </button>
          )}
          {mode === 'register' && (
            <p className="text-[11px] text-slate-400 text-center mt-3">
              Novos cadastros entram com perfil <b>Consulta</b> e só acessam o sistema após liberação do administrador.
            </p>
          )}
        </div>

        <div className="mt-8 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase">Base Naval da Ilha das Cobras</p>
        </div>
      </div>
    </div>
  );
};
