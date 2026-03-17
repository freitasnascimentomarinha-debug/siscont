
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

// Global flag to prevent deadlocks between register() and onAuthStateChange() triggering fetchUserProfile
let isRegisteringInProgress = false;
// Global set to prevent concurrent auto-recoveries for the same user if onAuthStateChange fires multiple times
const recoveringProfiles = new Set<string>();

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
          const profile = await fetchUserProfile(session.user);
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
            const profile = await fetchUserProfile(session.user);
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

  const fetchUserProfile = async (authUser: any) => {
    const userId = authUser.id;

    // Prevent deadlocks if registration is concurrently creating the profile
    if (isRegisteringInProgress) {
      console.log(`[Auth] Registro em andamento. Ignorando fetch inicial para evitar deadlock.`);
      return {
        id: userId,
        name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'Novo Usuário',
        role: UserRole.READ_ONLY,
        email: authUser.email
      };
    }

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
        return { ...retry.data, email: null };
      }
      error = retry.error;
    }

    // SCENARIO 2: Profile is missing entirely (e.g. Tamara Nascimento) - Auto-heal!
    if (!data && (!error || error.code === 'PGRST116')) {
        if (recoveringProfiles.has(userId)) {
             console.log(`[Auth] Recuperação já em andamento para ${userId}. Ignorando chamada duplicada.`);
             return null;
        }

        recoveringProfiles.add(userId);
        try {
            console.warn(`Profile missing for user ${userId}. Attempting auto-recovery...`);
            const newProfile: any = {
                id: userId,
                name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'Novo Usuário',
                role: UserRole.READ_ONLY,
                email: authUser.email
            };
            
            let { error: createError } = await supabase.from('profiles').upsert(newProfile);
            
            // Resilience: if email column is missing in DB during recovery
            if (createError && (createError.message.includes('email') || createError.message.includes('column'))) {
                const { email: _, ...payloadWithoutEmail } = newProfile;
                const retryCreate = await supabase.from('profiles').upsert(payloadWithoutEmail);
                createError = retryCreate.error;
            }
            
            if (!createError) {
                console.log("Profile auto-recovered successfully.");
                return newProfile;
            }
        } finally {
            recoveringProfiles.delete(userId);
        }
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
    if (isRegisteringInProgress) return false;
    isRegisteringInProgress = true;
    
    console.log(`[Auth] Iniciando registro para: ${email}`);
    try {
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password: pass,
        options: {
          data: { name }
        }
      });

      if (authError) throw authError;
      if (!data.user) throw new Error("Erro desconhecido ao realizar cadastro.");

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

      // Invalidate cache so Admin sees the new user immediately
      const { db } = await import('../services/db');
      db.invalidateCache('users');
      console.log(`[Auth] Registro concluído e cache invalidado para: ${email}`);

      return true;
    } finally {
      isRegisteringInProgress = false;
    }
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
