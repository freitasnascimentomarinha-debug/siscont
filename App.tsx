
import { PontosAtencaoPage } from './pages/PontosAtencao';
import { Conciliacao } from './pages/Conciliacao';
import { Faturamento } from './pages/Faturamento';
import { Contestacoes } from './pages/Contestacoes';
import { Cobranca } from './pages/Cobranca';
import { TaxaCondominial } from './pages/TaxaCondominial';
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Invoices } from './pages/Invoices';
import { ReceivedBalances } from './pages/ReceivedBalances';
import { CashFlow } from './pages/CashFlow';
import { Admin } from './pages/Admin';
import { Cadastros } from './pages/Cadastros';
import { ResetPassword } from './pages/ResetPassword';
import { UserRole } from './types';
import { isSupabaseConfigured } from './services/supabase';
import { cleanupCorruptedLocalStorage } from './utils/localStorageCleanup';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/Toaster';

export type PageID = 'dashboard' | 'painel' | 'invoices' | 'faturamento' | 'received' | 'cashflow' | 'cobranca' | 'conciliacao' | 'contestacoes' | 'pontos' | 'taxa' | 'auditoria' | 'cadastros' | 'admin';

const AuthenticatedApp = () => {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageID>('dashboard');

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'invoices': return <Invoices />;
      case 'faturamento': return <Faturamento />;
      case 'received': return <ReceivedBalances />;
      case 'cashflow': return <CashFlow />;
      case 'cobranca': return <Cobranca key="cobranca" />;
      case 'painel': return <Cobranca key="painel" modo="painel" />;
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
      {renderPage()}
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
    return <ResetPassword />;
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
