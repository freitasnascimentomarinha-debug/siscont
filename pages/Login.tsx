
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { ShieldCheck, UserPlus, ArrowLeft, Info } from 'lucide-react';

export const Login: React.FC = () => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError('');
    setSuccessMsg('');
    setIsSubmitting(true);

    try {
      if (isRegistering) {
        if (!name || !email || !password) {
          setError('Preencha todos os campos obrigatórios.');
          setIsSubmitting(false);
          return;
        }
        await register(name, email, password);
        setSuccessMsg('Cadastro realizado! Se solicitado, verifique seu e-mail para confirmar a conta.');
        setIsRegistering(false);
        setName('');
        setPassword('');
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Erro de conexão com o Supabase.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
      <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-primary-600"></div>

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 text-primary-600 mb-4 shadow-inner">
            <ShieldCheck size={40} />
          </div>
          <h2 className="text-3xl font-black text-slate-800 tracking-tighter">SISCONT</h2>
          <p className="text-slate-500 text-sm font-medium uppercase tracking-widest mt-1">Sist. de Controle de Faturas</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {isRegistering && (
            <Input
              label="Nome Completo"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: 3ºSG-AD Tamara"
              disabled={isSubmitting}
              required
            />
          )}

          <Input
            label="E-mail de Acesso"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="admin@siscont.com"
            disabled={isSubmitting}
            required
          />
          <Input
            label="Senha"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Digite sua senha"
            disabled={isSubmitting}
            required
          />

          {error && (
            <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 flex items-center gap-2">
              <Info size={14} /> {error}
            </div>
          )}

          {successMsg && (
            <div className="text-xs text-green-600 bg-green-50 p-3 rounded-lg border border-green-100 flex items-center gap-2">
              <Info size={14} /> {successMsg}
            </div>
          )}

          <Button type="submit" className="w-full shadow-lg h-12 text-base" size="lg" isLoading={isSubmitting}>
            {isRegistering ? 'Criar Minha Conta' : 'Entrar no Sistema'}
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-100">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => { setIsRegistering(!isRegistering); setError(''); setSuccessMsg(''); }}
            className="w-full text-sm text-slate-500 hover:text-primary-600 transition-colors flex items-center justify-center gap-2 font-semibold"
          >
            {isRegistering ? (
              <><ArrowLeft size={16} /> Já tenho conta, quero entrar</>
            ) : (
              <><UserPlus size={16} /> Não tem acesso? Cadastre-se</>
            )}
          </button>
        </div>

        <div className="mt-8 text-center">
          <p className="text-[10px] text-slate-400 font-bold uppercase">Base Naval da Ilha das Cobras</p>
        </div>
      </div>
    </div>
  );
};
