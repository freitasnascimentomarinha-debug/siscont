
import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Invoices } from './pages/Invoices';
import { ReceivedBalances } from './pages/ReceivedBalances';
import { CashFlow } from './pages/CashFlow';
import { Admin } from './pages/Admin';
import { cleanupCorruptedLocalStorage } from './utils/localStorageCleanup';
import { ErrorBoundary } from './components/ErrorBoundary';

export type PageID = 'dashboard' | 'invoices' | 'received' | 'cashflow' | 'admin';

const AuthenticatedApp = () => {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState<PageID>('dashboard');

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard />;
      case 'invoices': return <Invoices />;
      case 'received': return <ReceivedBalances />;
      case 'cashflow': return <CashFlow />;
      case 'admin':
        return user?.role === 'ADMIN' ? <Admin /> : <Dashboard />;
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
  const { user, isLoading } = useAuth();

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
        </AuthProvider>
      </ErrorBoundary>
    </div>
  );
};

export default App;
