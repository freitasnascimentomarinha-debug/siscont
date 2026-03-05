
import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  LayoutDashboard,
  FileText,
  Wallet,
  ArrowLeftRight,
  LogOut,
  Menu,
  X,
  Users,
  Maximize,
  Minimize
} from 'lucide-react';
import { PageID } from '../App';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: PageID;
  onPageChange: (page: PageID) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, currentPage, onPageChange }) => {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn(`Erro ao tentar ativar fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const navItems = [
    { id: 'dashboard' as PageID, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'invoices' as PageID, label: 'Faturas', icon: FileText },
    { id: 'received' as PageID, label: 'Saldos Recebidos', icon: Wallet },
    { id: 'cashflow' as PageID, label: 'Fluxo de Caixa', icon: ArrowLeftRight },
  ];

  if (user?.role === 'ADMIN') {
    navItems.push({ id: 'admin' as PageID, label: 'Administração', icon: Users });
  }

  const navigateTo = (id: PageID) => {
    onPageChange(id);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="h-screen w-screen flex flex-col md:flex-row bg-slate-50 overflow-hidden font-sans">
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b px-4 h-16 flex justify-between items-center z-30 shadow-sm shrink-0">
        <div>
          <h1 className="font-bold text-xl text-primary-700 tracking-tight">SISCONT</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-tighter font-semibold">BNIC</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleFullscreen} className="p-2 text-slate-500 hover:bg-slate-100 rounded-md" title="Alternar Tela Cheia">
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 text-slate-500 hover:bg-slate-100 rounded-md">
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-slate-900 text-white transform transition-transform duration-300 ease-in-out
        md:translate-x-0 md:static md:block border-r border-slate-800 shrink-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          {/* Logo Header */}
          <div className="p-6 text-center border-b border-slate-800/50">
            <div className="flex justify-center mb-4">
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/6/61/Logo_of_the_Brazilian_Navy_%28symbol%29.png"
                alt="Brasão Marinha"
                className="h-16 w-auto drop-shadow-2xl"
              />
            </div>
            <h1 className="font-bold text-2xl tracking-tighter text-white">SISCONT</h1>
            <p className="text-[10px] text-slate-400 mt-1 font-medium italic">Base Naval da Ilha das Cobras</p>
          </div>

          {/* User Profile */}
          <div className="px-6 py-4">
            <div className="p-4 bg-slate-800/40 rounded-xl border border-slate-700/30">
              <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1">Operador</p>
              <p className="font-semibold text-sm truncate text-white">{user?.name}</p>
              <p className="text-[10px] text-primary-400 font-bold uppercase mt-1 tracking-widest">{user?.role}</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-4 space-y-1.5 overflow-y-auto custom-scrollbar pb-6">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => navigateTo(item.id)}
                className={`
                  w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group
                  ${currentPage === item.id
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/40 font-semibold scale-[1.02]'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
                `}
              >
                <item.icon size={18} className={currentPage === item.id ? 'text-white' : 'group-hover:text-primary-400'} />
                <span className="text-sm">{item.label}</span>
              </button>
            ))}

            {/* Fullscreen Toggle Button in Nav for Desktop */}
            <button
              onClick={toggleFullscreen}
              className="w-full hidden md:flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              <span className="text-sm">{isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}</span>
            </button>
          </nav>

          {/* Footer Actions */}
          <div className="p-4 border-t border-slate-800/50">
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200 text-sm font-medium"
            >
              <LogOut size={18} />
              <span>Encerrar Sessão</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden relative">
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto h-full">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
    </div>
  );
};
