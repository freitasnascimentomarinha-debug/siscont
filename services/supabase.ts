
import { createClient } from '@supabase/supabase-js';
import { criarFetchTreino } from './treino';

const env = import.meta.env as Record<string, string | undefined>;

const supabaseUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
        'Credenciais do Supabase ausentes. Defina no .env.local: ' +
        'VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (ou VITE_SUPABASE_PUBLISHABLE_KEY).'
    );
}

/** false quando o deploy não tem as variáveis do Supabase (o App mostra tela de configuração). */
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// URL de reserva evita que createClient('') lance erro na importação (tela branca)
export const supabase = createClient(supabaseUrl || 'https://supabase-nao-configurado.invalid', supabaseAnonKey || 'nao-configurado', {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
    },
    // perfil Treinamento: as escritas vão para uma cópia de teste no navegador (services/treino.ts); para os demais perfis não muda nada
    global: { fetch: criarFetchTreino((entrada, init) => globalThis.fetch(entrada, init)) },
});
