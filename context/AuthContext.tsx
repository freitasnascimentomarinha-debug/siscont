import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session, User as AuthUser } from '@supabase/supabase-js';
import { User, UserRole } from '../types';
import { supabase } from '../services/supabase';
import { db } from '../services/db';
import { ativarTreino, treinoAtivoPara } from '../services/treino';

export type RegisterResult = 'PENDING_CONFIRMATION' | 'PENDING_APPROVAL';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  /** Mensagem a exibir na tela de login (ex.: acesso pendente/bloqueado). */
  authNotice: string | null;
  clearAuthNotice: () => void;
  /** true quando o usuário chegou pelo link de "esqueci minha senha". */
  isPasswordRecovery: boolean;
  login: (email: string, pass: string) => Promise<void>;
  register: (name: string, email: string, pass: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  /** Troca a senha do usuário logado (ou do fluxo de recuperação). */
  updatePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  updateOwnName: (name: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

export const MIN_PASSWORD_LENGTH = 8;
const AUTH_REQUEST_TIMEOUT_MS = 12000;
const SESSION_BOOT_TIMEOUT_MS = 8000;

export const BLOCKED_MESSAGE =
  'Seu acesso está pendente de liberação ou foi bloqueado. Procure o administrador do SISCONT.';

export const withTimeout = async <T,>(promise: PromiseLike<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

/** Converte mensagens do Supabase Auth (inglês) para mensagens claras em português. */
export const translateAuthError = (err: any): Error => {
  const msg = String(err?.message || err || '');
  const low = msg.toLowerCase();
  if (low.includes('invalid login credentials')) return new Error('E-mail ou senha incorretos.');
  if (low.includes('email not confirmed')) return new Error('E-mail ainda não confirmado. Verifique sua caixa de entrada (e o spam).');
  if (low.includes('banned')) return new Error(BLOCKED_MESSAGE);
  if (low.includes('already registered') || low.includes('already exists')) return new Error('Este e-mail já está cadastrado. Use "Esqueci minha senha" se não lembrar a senha.');
  if (low.includes('rate limit') || low.includes('too many')) return new Error('Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.');
  if (low.includes('password should be') || low.includes('weak password')) return new Error(`Senha fraca: use pelo menos ${MIN_PASSWORD_LENGTH} caracteres, misturando letras e números.`);
  if (low.includes('same password') || low.includes('different from the old')) return new Error('A nova senha deve ser diferente da atual.');
  if (low.includes('failed to fetch') || low.includes('network')) return new Error('Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  return err instanceof Error ? err : new Error(msg || 'Erro inesperado.');
};

const normalizeRole = (role: unknown): UserRole =>
  role === UserRole.ADMIN || role === UserRole.USER || role === UserRole.READ_ONLY || role === UserRole.ENCARREGADO || role === UserRole.TREINAMENTO
    ? (role as UserRole)
    : UserRole.READ_ONLY;

const fallbackName = (authUser: AuthUser) =>
  (authUser.user_metadata as any)?.name || authUser.email?.split('@')[0] || 'Usuário';

/**
 * Lê o perfil do usuário. Se não existir (banco sem o gatilho de criação),
 * cria um perfil de CONSULTA sem NUNCA sobrescrever um perfil existente.
 */
async function resolveProfile(authUser: AuthUser): Promise<User> {
  const { data, error } = await withTimeout(
    supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle(),
    AUTH_REQUEST_TIMEOUT_MS,
    'Tempo limite ao carregar o perfil do usuário.'
  );
  if (error) throw error;

  let profile: any = data;
  if (!profile) {
    const payload = {
      id: authUser.id,
      name: fallbackName(authUser),
      email: authUser.email,
      role: UserRole.READ_ONLY,
    };
    const { error: insertError } = await withTimeout(
      supabase.from('profiles').upsert(payload, { onConflict: 'id', ignoreDuplicates: true }),
      AUTH_REQUEST_TIMEOUT_MS,
      'Tempo limite ao criar o perfil do usuário.'
    );
    if (insertError) console.warn('[Auth] Não foi possível criar o perfil automaticamente:', insertError.message);
    profile = payload;
  }

  return {
    id: authUser.id,
    email: authUser.email || profile.email || '',
    name: profile.name || fallbackName(authUser),
    role: normalizeRole(profile.role),
    active: profile.active !== false,
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [profileVersion, setProfileVersion] = useState(0);

  // 1. Sessão: o callback do onAuthStateChange NÃO pode chamar outras funções
  //    do Supabase (causa travamento do lock interno => "carregamento eterno").
  //    Ele apenas registra a sessão; o perfil é buscado no efeito seguinte.
  useEffect(() => {
    try {
      localStorage.removeItem('siscont-auth'); // chave legada
    } catch { /* ignore */ }

    const bootTimeout = setTimeout(() => setSessionReady(true), SESSION_BOOT_TIMEOUT_MS);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
      if (event === 'SIGNED_OUT') {
        ativarTreino(null);
        setIsPasswordRecovery(false);
        db.invalidateCache();
      }
      setSession(newSession);
      setSessionReady(true);
      clearTimeout(bootTimeout);
    });

    return () => {
      clearTimeout(bootTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // 2. Perfil: recarrega quando muda o usuário (não a cada refresh de token)
  const authUser = session?.user ?? null;
  const authUserId = authUser?.id ?? null;

  useEffect(() => {
    if (!authUser) {
      setUser(null);
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);

    resolveProfile(authUser)
      .then(profile => {
        if (cancelled) return;
        if (!profile.active) {
          setAuthNotice(BLOCKED_MESSAGE);
          setUser(null);
          supabase.auth.signOut().catch(() => undefined);
          return;
        }
        // perfil Treinamento: daqui em diante as escritas vão para a cópia de teste, nunca para o banco
        ativarTreino(treinoAtivoPara(profile.role, profile.id) ? profile.id : null);
        db.invalidateCache();
        setUser(profile);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('[Auth] Erro ao carregar perfil:', err);
        // Falha transitória: entra como CONSULTA (o banco ainda protege a escrita)
        setUser({
          id: authUser.id,
          email: authUser.email || '',
          name: fallbackName(authUser),
          role: UserRole.READ_ONLY,
          active: true,
        });
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUserId, profileVersion]);

  const login = useCallback(async (email: string, pass: string) => {
    setAuthNotice(null);
    const { error } = await withTimeout(
      supabase.auth.signInWithPassword({ email: email.trim(), password: pass }),
      AUTH_REQUEST_TIMEOUT_MS,
      'Tempo de login excedido. Verifique sua conexão e tente novamente.'
    );
    if (error) throw translateAuthError(error);
  }, []);

  const register = useCallback(async (name: string, email: string, pass: string): Promise<RegisterResult> => {
    if (pass.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    const { data, error } = await withTimeout(
      supabase.auth.signUp({
        email: email.trim(),
        password: pass,
        options: { data: { name: name.trim() }, emailRedirectTo: window.location.origin },
      }),
      AUTH_REQUEST_TIMEOUT_MS,
      'Tempo de cadastro excedido. Verifique sua conexão e tente novamente.'
    );
    if (error) throw translateAuthError(error);

    // Supabase devolve usuário sem identidades quando o e-mail já existe
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('Este e-mail já está cadastrado. Use "Esqueci minha senha" se não lembrar a senha.');
    }

    db.invalidateCache('users');
    return data.session ? 'PENDING_APPROVAL' : 'PENDING_CONFIRMATION';
  }, []);

  const logout = useCallback(async () => {
    try {
      await withTimeout(supabase.auth.signOut(), AUTH_REQUEST_TIMEOUT_MS, 'Tempo limite ao sair.');
    } catch (e) {
      console.warn('[Auth] signOut falhou, limpando sessão local:', e);
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
    db.invalidateCache();
    setUser(null);
    setSession(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await withTimeout(
      supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin }),
      AUTH_REQUEST_TIMEOUT_MS,
      'Tempo limite ao solicitar redefinição de senha.'
    );
    if (error) throw translateAuthError(error);
  }, []);

  const updatePassword = useCallback(async (newPassword: string, currentPassword?: string) => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`A senha deve ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    if (currentPassword !== undefined) {
      const email = session?.user?.email;
      if (!email) throw new Error('Sessão expirada. Entre novamente.');
      const { error: checkError } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password: currentPassword }),
        AUTH_REQUEST_TIMEOUT_MS,
        'Tempo limite ao validar a senha atual.'
      );
      if (checkError) throw new Error('Senha atual incorreta.');
    }
    const { error } = await withTimeout(
      supabase.auth.updateUser({ password: newPassword }),
      AUTH_REQUEST_TIMEOUT_MS,
      'Tempo limite ao alterar a senha.'
    );
    if (error) throw translateAuthError(error);
    setIsPasswordRecovery(false);
  }, [session?.user?.email]);

  const updateOwnName = useCallback(async (name: string) => {
    if (!user) return;
    const clean = name.trim();
    if (!clean) throw new Error('Informe o nome.');
    const { error } = await supabase.from('profiles').update({ name: clean }).eq('id', user.id);
    if (error) throw error;
    await supabase.auth.updateUser({ data: { name: clean } }).catch(() => undefined);
    setUser(prev => (prev ? { ...prev, name: clean } : prev));
    db.invalidateCache('users');
  }, [user]);

  const refreshProfile = useCallback(async () => {
    setProfileVersion(v => v + 1);
  }, []);

  // Com sessão mas sem perfil resolvido ainda => carregando (evita "piscar" a tela de login)
  const isLoading = !sessionReady || (!!authUser && !user && !authNotice);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        authNotice,
        clearAuthNotice: () => setAuthNotice(null),
        isPasswordRecovery,
        login,
        register,
        logout,
        requestPasswordReset,
        updatePassword,
        updateOwnName,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
