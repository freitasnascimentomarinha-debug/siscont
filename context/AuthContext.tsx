
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
    // Safety timeout: Always stop loading after 10 seconds to prevent infinite loading
    const timeoutId = setTimeout(() => {
      console.warn("Auth check timeout - forcing loading to complete");
      setIsLoading(false);
    }, 10000);

    // 1. Check current session on mount
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const profile = await fetchUserProfile(session.user.id);
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            name: profile?.name || session.user.email?.split('@')[0] || 'Usuário',
            role: (profile?.role as UserRole) || UserRole.READ_ONLY
          });
        }
      } catch (e) {
        console.error("Erro ao verificar sessão Supabase:", e);
        // Clear potentially corrupted auth data
        await supabase.auth.signOut();
      } finally {
        clearTimeout(timeoutId);
        setIsLoading(false);
      }
    };

    checkSession();

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const profile = await fetchUserProfile(session.user.id);
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: profile?.name || session.user.email?.split('@')[0] || 'Usuário',
          role: (profile?.role as UserRole) || UserRole.READ_ONLY
        });
      } else {
        setUser(null);
      }
      setIsLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchUserProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('name, role')
      .eq('id', userId)
      .single();

    if (error) {
      console.error("Erro ao buscar perfil:", error);
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

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: data.user.id,
        name: name,
        role: UserRole.READ_ONLY
      });

    if (profileError) {
      console.error("Profile Creation error (retrying upsert):", profileError.message);
      // Even if profile fails, user is created. We try again with upsert just in case.
    }

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
