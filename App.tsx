
import React, { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { UserRole, podeVerPagina } from './types';
import { cadastroService } from './services/cadastroService';
import { definirNormas, normasDe } from './utils/normas';
import { assinaturaDe, definirAssinatura } from './utils/assinatura';
import { isSupabaseConfigured } from './services/supabase';
import { cleanupCorruptedLocalStorage } from './utils/localStorageCleanup';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/Toaster';

/** Carrega a tela sob demanda; se o arquivo sumiu (nova versão publicada com a aba aberta), recarrega a página uma vez. */
function telaLazy<M>(carregar: () => Promise<M>, pegar: (m: M) => React.ComponentType<any>) {
  return lazy(async () => {
    try { return { default: pegar(await carregar()) }; }
    catch (e) {
      try { if (!sessionStorage.getItem('siscont-recarregou')) { sessionStorage.setItem('siscont-recarregou', '1'); window.location.reload(); return new Promise<never>(() => undefined); } } catch { /* sem storage */ }
      throw e;
    }
  });
}
// Cada tela é baixada só quando aberta (primeiro acesso bem mais leve)
const PontosAtencaoPage = telaLazy(() => import('./pages/PontosAtencao'), m => m.PontosAtencaoPage);
const Conciliacao = telaLazy(() => import('./pages/Conciliacao'), m => m.Conciliacao);
const Faturamento = telaLazy(() => import('./pages/Faturamento'), m => m.Faturamento);
const Contestacoes = telaLazy(() => import('./pages/Contestacoes'), m => m.Contestacoes);
const Cobranca = telaLazy(() => import('./pages/Cobranca'), m => m.Cobranca);
const PainelEncarregado = telaLazy(() => import('./pages/PainelEncarregado'), m => m.PainelEncarregado);
const GastosBNIC = telaLazy(() => import('./pages/GastosBNIC'), m => m.GastosBNIC);
const TaxaCondominial = telaLazy(() => import('./pages/TaxaCondominial'), m => m.TaxaCondominial);
const ExtraMarinha = telaLazy(() => import('./pages/ExtraMarinha'), m => m.ExtraMarinha);
const Dashboard = telaLazy(() => import('./pages/Dashboard'), m => m.Dashboard);
const Invoices = telaLazy(() => import('./pages/Invoices'), m => m.Invoices);
const ReceivedBalances = telaLazy(() => import('./pages/ReceivedBalances'), m => m.ReceivedBalances);
const CashFlow = telaLazy(() => import('./pages/CashFlow'), m => m.CashFlow);
const Admin = telaLazy(() => import('./pages/Admin'), m => m.Admin);
const Cadastros = telaLazy(() => import('./pages/Cadastros'), m => m.Cadastros);
const ResetPassword = telaLazy(() => import('./pages/ResetPassword'), m => m.ResetPassword);

export type PageID = 'dashboard' | 'painel' | 'gastos' | 'invoices' | 'faturamento' | 'received' | 'cashflow' | 'cobranca' | 'conciliacao' | 'contestacoes' | 'pontos' | 'taxa' | 'auditoria' | 'cadastros' | 'admin' | 'extramb';

const AuthenticatedApp = () => {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageID>('dashboard');
  // a norma (OI) citada nas telas e nas faturas vem dos parâmetros: carrega no início para valer em todas as páginas
  useEffect(() => { cadastroService.listParametros().then(p => { definirNormas(normasDe(p)); definirAssinatura(assinaturaDe(p)); }).catch(() => { /* sem parâmetros: valem os padrões */ }); }, []);

  // páginas pedem para abrir outra página (ex.: o resumo do painel abre os Gastos da BNIC) sem conhecer o menu
  useEffect(() => {
    const ir = (e: Event) => setCurrentPage((e as CustomEvent).detail as PageID);
    window.addEventListener('siscont:ir', ir);
    return () => window.removeEventListener('siscont:ir', ir);
  }, []);

  const renderPage = () => {
    // página que o perfil não vê: volta ao Painel inicial (todos os perfis veem)
    if (!podeVerPagina(user?.role, currentPage)) return <Dashboard />;
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'invoices': return <Invoices />;
      case 'faturamento': return <Faturamento />;
      case 'received': return <ReceivedBalances />;
      case 'cashflow': return <CashFlow />;
      case 'cobranca': return <Cobranca key="cobranca" />;
      case 'extramb': return <ExtraMarinha />;
      case 'painel': return <PainelEncarregado key="painel" />;
      case 'gastos': return <GastosBNIC key="gastos" />;
      case 'taxa': return <TaxaCondominial />;
      case 'auditoria': return <PontosAtencaoPage key="historico" abaInicial="historico" />;
      case 'conciliacao': return <Conciliacao />;
      case 'contestacoes': return <Contestacoes />;
      case 'pontos': return <PontosAtencaoPage />;
      case 'cadastros': return <Cadastros />;
      case 'admin':
        return user?.role === UserRole.ADMIN ? <Admin /> : <Dashboard />;
      default: return <Dashboard />;
    }
  };

  return (
    <Layout currentPage={currentPage} onPageChange={setCurrentPage}>
      <Suspense fallback={<div role="status" className="flex items-center justify-center py-24"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" /><span className="sr-only">Carregando…</span></div>}>
        {renderPage()}
      </Suspense>
    </Layout>
  );
};

const AppContent = () => {
  const { user, isLoading, isPasswordRecovery } = useAuth();

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="max-w-lg bg-white rounded-2xl p-8 shadow-2xl space-y-3 text-sm text-slate-700">
          <h1 className="text-xl font-bold text-slate-900">SISCONT: configuração pendente</h1>
          <p>As variáveis de conexão com o banco de dados não foram definidas neste ambiente.</p>
          <p>Cadastre na Vercel (Settings → Environment Variables) <code className="bg-slate-100 px-1 rounded">VITE_SUPABASE_URL</code> e <code className="bg-slate-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> e faça um novo deploy.</p>
        </div>
      </div>
    );
  }

  // Splash enquanto a sessão salva é restaurada (com limite de tempo no AuthContext)
  if (isLoading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-900 z-50">
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
          <span className="mt-4 text-slate-400 font-medium animate-pulse">Iniciando SISCONT...</span>
        </div>
      </div>
    );
  }

  // Link de "Esqueci minha senha": exige criar a nova senha antes de entrar
  if (isPasswordRecovery) {
    return <Suspense fallback={null}><ResetPassword /></Suspense>;
  }

  if (!user) {
    return <Login />;
  }

  return <AuthenticatedApp />;
};

const App: React.FC = () => {
  // Clean up corrupted localStorage on app start
  useEffect(() => {
    cleanupCorruptedLocalStorage();

    // Global listener for unhandled errors
    const handleError = (e: ErrorEvent | PromiseRejectionEvent) => {
      console.error('Captured global error:', e);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleError);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleError);
    };
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-slate-50">
      <ErrorBoundary>
        <AuthProvider>
          <AppContent />
          <Toaster />
        </AuthProvider>
      </ErrorBoundary>
    </div>
  );
};

export default App;
