
import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { supabase } from '../services/supabase';

interface AuthContextType {
  user: User | null;
  login: (email: string, pass: string) => Promise<boolean>;
  register: (name: string, email: string, pass: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Legacy session cleanup: Remove old custom storage keys that might cause conflicts on desktop
    try {
      if (localStorage.getItem('siscont-auth')) {
        console.warn("Legacy session key 'siscont-auth' detected. Clearing for stability.");
        localStorage.removeItem('siscont-auth');
      }
    } catch (e) {
      console.error("Failed to clear legacy session key:", e);
    }

    // Safety timeout: Always stop loading after 8 seconds to prevent infinite loading
    const timeoutId = setTimeout(() => {
      if (isMounted) {
        console.warn("Auth check timeout - forcing loading to complete");
        setIsLoading(false);
      }
    }, 8000);

    // 1. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT') {
        setUser(null);
        setIsLoading(false);
        clearTimeout(timeoutId);
        return;
      }

      if (session?.user) {
        try {
          const profile = await fetchUserProfile(session.user.id);
          if (isMounted) {
            console.log("Perfil carregado:", profile?.name, "Role:", profile?.role);
            setUser({
              id: session.user.id,
              email: session.user.email || '',
              name: profile?.name || session.user.email?.split('@')[0] || 'Usuário',
              role: (profile?.role as UserRole) || UserRole.READ_ONLY
            });
          }
        } catch (e) {
          console.error("Erro ao buscar perfil (onAuthStateChange):", e);
          // Still set user even if profile fetch fails — DON'T destroy session
          if (isMounted) {
            setUser({
              id: session.user.id,
              email: session.user.email || '',
              name: session.user.email?.split('@')[0] || 'Usuário',
              role: UserRole.READ_ONLY
            });
          }
        }
      } else if (event !== 'INITIAL_SESSION') {
        setUser(null);
      }

      if (isMounted) {
        setIsLoading(false);
        clearTimeout(timeoutId);
      }
    });

    // 2. Check current session on mount
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isMounted) return;

        if (session?.user) {
          try {
            const profile = await fetchUserProfile(session.user.id);
            if (isMounted) {
              setUser({
                id: session.user.id,
                email: session.user.email || '',
                name: profile?.name || session.user.email?.split('@')[0] || 'Usuário',
                role: (profile?.role as UserRole) || UserRole.READ_ONLY
              });
            }
          } catch (profileErr) {
            console.error("Erro ao buscar perfil:", profileErr);
            // Set user without profile — DON'T sign out
            if (isMounted) {
              setUser({
                id: session.user.id,
                email: session.user.email || '',
                name: session.user.email?.split('@')[0] || 'Usuário',
                role: UserRole.READ_ONLY
              });
            }
          }
        }
      } catch (e) {
        console.error("Erro ao verificar sessão Supabase:", e);
        // DO NOT call signOut() here — it destroys valid sessions
        // The session token may still be valid even if this check had an error
      } finally {
        if (isMounted) {
          clearTimeout(timeoutId);
          setIsLoading(false);
        }
      }
    };

    checkSession();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserProfile = async (userId: string) => {
    // Try fetching with email first
    let { data, error } = await supabase
      .from('profiles')
      .select('name, role, email')
      .eq('id', userId)
      .single();

    // If it fails (likely missing email column), try without email
    if (error && (error.message.includes('email') || error.code === 'PGRST100' || error.message.includes('column'))) {
      console.warn("Retrying profile fetch without 'email' column...");
      const retry = await supabase
        .from('profiles')
        .select('name, role')
        .eq('id', userId)
        .single();
      
      if (retry.data) {
        // Return a shape that includes email: null to satisfy types
        return { ...retry.data, email: null };
      }
      error = retry.error;
    }

    if (error) {
      console.error("Erro crítico ao buscar perfil:", error.message);
      return null;
    }
    return data;
  };

  const login = async (email: string, pass: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: pass
    });

    if (error) {
      throw error;
    }
    return true;
  };

  const register = async (name: string, email: string, pass: string) => {
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password: pass
    });

    if (authError) {
      throw authError;
    }

    if (!data.user) {
      throw new Error("Erro desconhecido ao realizar cadastro.");
    }

    // Create profile record
    const profilePayload: any = {
      id: data.user.id,
      name: name,
      role: UserRole.READ_ONLY,
      email: email
    };

    let { error: profileError } = await supabase
      .from('profiles')
      .upsert(profilePayload);

    // If it fails (likely missing email column), try without email
    if (profileError && (profileError.message.includes('email') || profileError.message.includes('column'))) {
      console.warn("Retrying profile upsert without 'email' field in register...");
      const { email: _, ...payloadWithoutEmail } = profilePayload;
      const retry = await supabase
        .from('profiles')
        .upsert(payloadWithoutEmail);
      profileError = retry.error;
    }

    if (profileError) {
      console.error("Erro ao criar perfil após cadastro:", profileError.message);
      throw new Error(`Cadastro parcial: Conta criada, mas dados do perfil falharam. Erro: ${profileError.message}`);
    }

    // New: Invalidate cache so Admin sees the new user immediately
    const { db } = await import('../services/db');
    db.invalidateCache('users');

    return true;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
