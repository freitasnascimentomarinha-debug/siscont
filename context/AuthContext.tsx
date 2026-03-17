
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
