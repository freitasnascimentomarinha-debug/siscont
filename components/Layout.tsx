
import React, { useEffect, useState } from 'react';
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
  UserCog,
  Building2,
  AlertTriangle,
  Scale,
  Receipt,
  MessageSquareWarning,
  Megaphone,
  Gauge,
  Landmark,
  DatabaseBackup,
  Briefcase,
  Coins,
  GraduationCap,
} from 'lucide-react';
import { ultimoBackup } from '../services/auditoriaService';
import { backupAtrasado, diasSemBackup } from '../utils/auditoria';
import { PageID } from '../App';
import { ROLE_LABELS, UserRole, podeVerPagina } from '../types';
import { definirTreinoDoUsuario, modoTreino, podeAlternarTreino, totalLancamentosDeTeste, zerarTreino } from '../services/treino';
import { db } from '../services/db';
import { AccountModal } from './AccountModal';

interface LayoutProps {
  children: React.ReactNode;
  currentPage: PageID;
  onPageChange: (page: PageID) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, currentPage, onPageChange }) => {
  const { user, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);

  /**
   * Menu por FUNÇÃO, na ordem em que o trabalho acontece. Cada item diz o que faz (dica ao passar o mouse).
   *  Visão geral (Encarregado) → Faturamento (emitir e acompanhar faturas) → Acompanhamento contábil (receber, conciliar, cobrar)
   *  → Contabilidade de custos (fluxo de caixa e taxa anual) → Configuração.
   */
  type Item = { id: PageID; label: string; icon: React.ElementType; dica: string };
  const todosGrupos: { titulo: string; itens: Item[] }[] = [
    { titulo: 'Visão geral', itens: [
      { id: 'dashboard', label: 'Painel inicial', icon: LayoutDashboard, dica: 'Resumo geral do sistema' },
      { id: 'painel', label: 'Painel do Encarregado', icon: Gauge, dica: 'Indicadores de cobrança, saldos parados e adiantamentos' },
      { id: 'pontos', label: 'Pontos de Atenção', icon: AlertTriangle, dica: 'Inconsistências encontradas automaticamente e histórico de alterações (quem alterou o quê)' },
    ] },
    { titulo: 'Faturamento', itens: [
      { id: 'faturamento', label: 'Emitir faturas do mês', icon: Receipt, dica: 'Medições, atracação, preços, lote mensal, OND e correção por atraso' },
      { id: 'invoices', label: 'Faturas emitidas', icon: FileText, dica: 'Consultar, retificar, contestar, cancelar e ver o histórico das faturas' },
      { id: 'contestacoes', label: 'Contestações', icon: MessageSquareWarning, dica: 'Contestações abertas pelas OM e respostas' },
    ] },
    { titulo: 'Acompanhamento contábil', itens: [
      { id: 'received', label: 'Recebimentos', icon: Wallet, dica: 'Importar ALTCRED do SIPLAD, GRU, baixas e adiantamentos' },
      { id: 'conciliacao', label: 'Extrato de conciliação', icon: Scale, dica: 'Conferência faturado × recebido por OM' },
      { id: 'cobranca', label: 'Cobrança', icon: Megaphone, dica: 'Faturas em aberto e mensagens de cobrança' },
      { id: 'extramb', label: 'Extra-Marinha', icon: Briefcase, dica: 'Clientes de fora da Marinha: faturas, GRU, extrato por cliente e e-mail de envio' },
    ] },
    { titulo: 'Contabilidade de custos', itens: [
      { id: 'gastos', label: 'Gastos da BNIC', icon: Coins, dica: 'Previsto, empenhado, consumo da base e fornecedores, por grupo de gasto' },
      { id: 'cashflow', label: 'Fluxo de caixa', icon: ArrowLeftRight, dica: 'Saídas (NE), saldo mensal, condomínio por rubrica e disponível' },
      { id: 'taxa', label: 'Taxa condominial e diárias', icon: Landmark, dica: 'Rotina anual: proposta da taxa, média trienal e diárias de atracação' },
    ] },
    { titulo: 'Configuração', itens: [
      { id: 'cadastros', label: 'Cadastros', icon: Building2, dica: 'OM, comandos, setores, classes de navio, serviços, parâmetros e feriados' },
      { id: 'admin', label: 'Administração', icon: Users, dica: 'Usuários, backup e restauração' },
    ] },
  ];
  // cada perfil vê só as páginas dele (ver PAGINAS_DO_PERFIL em types.ts)
  const grupos = todosGrupos.map(g => ({ ...g, itens: g.itens.filter(i => podeVerPagina(user?.role, i.id)) })).filter(g => g.itens.length > 0);

  // Lembrete de backup (administrador): mais de 7 dias sem backup completo
  const [diasBackup, setDiasBackup] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (user?.role !== UserRole.ADMIN) return;
    ultimoBackup().then(u => setDiasBackup(diasSemBackup(u))).catch(() => undefined);
  }, [user?.role, currentPage === 'admin']);
  const lembrarBackup = user?.role === UserRole.ADMIN && diasBackup !== undefined && backupAtrasado(diasBackup) && currentPage !== 'admin';

  // Perfil Treinamento: aviso fixo e botão para apagar os lançamentos de teste
  const treinando = modoTreino();                                  // perfil Treinamento, ou operador que ligou o modo
  const operadorPodeAlternar = podeAlternarTreino(user?.role);
  const alternarTreino = (ligar: boolean) => {
    if (!user) return;
    definirTreinoDoUsuario(user.id, ligar); db.invalidateCache(); window.location.reload();
  };
  const [, atualizarTeste] = useState(0);
  useEffect(() => { if (!treinando) return; const t = setInterval(() => atualizarTeste(n => n + 1), 1500); return () => clearInterval(t); }, [treinando]);
  const zerarTestes = () => {
    if (!window.confirm('Apagar todos os lançamentos de teste feitos por você? Os dados reais não são afetados.')) return;
    zerarTreino(); db.invalidateCache(); window.location.reload();
  };

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
          <div className="px-4 py-3 text-center border-b border-slate-800/50 shrink-0">
            <div className="flex justify-center mb-1">
              <img
                src="/emblema-siscont.png"
                alt="SISCONT"
                className="h-14 w-14 drop-shadow-xl"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
            <h1 className="font-black text-xl tracking-tight text-white">SIS<span className="text-amber-400">CONT</span></h1>
            <p className="text-[10px] text-slate-400 font-medium italic">Base Naval da Ilha das Cobras</p>
          </div>

          {/* User Profile */}
          <div className="px-4 py-2 shrink-0">
            <button
              onClick={() => { setIsAccountOpen(true); setIsMobileMenuOpen(false); }}
              className="w-full text-left px-3 py-2 bg-slate-800/40 rounded-xl border border-slate-700/30 hover:bg-slate-800 transition-colors group"
              title="Minha Conta: alterar nome e senha"
            >
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Usuário</p>
                <UserCog size={14} className="text-slate-500 group-hover:text-primary-400" />
              </div>
              <p className="font-semibold text-sm truncate text-white">{user?.name}</p>
              <p className="text-[10px] text-primary-400 font-bold uppercase tracking-widest">{user ? ROLE_LABELS[user.role] : ''}</p>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 min-h-0 px-4 space-y-1 overflow-y-auto custom-scrollbar pb-4">
            {grupos.map(g => (
              <div key={g.titulo} className="pt-1.5 first:pt-0">
                <p className="px-4 pb-1 text-[10px] uppercase tracking-widest font-bold text-slate-500">{g.titulo}</p>
                {g.itens.map(item => (
                  <button
                    key={item.id}
                    onClick={() => navigateTo(item.id)}
                    title={item.dica}
                    aria-current={currentPage === item.id ? 'page' : undefined}
                    className={`
                      w-full flex items-center gap-3 px-4 py-1.5 rounded-xl transition-all duration-200 group
                      ${currentPage === item.id
                        ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/40 font-semibold'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
                    `}
                  >
                    <item.icon size={17} className={currentPage === item.id ? 'text-white' : 'group-hover:text-primary-400'} />
                    <span className="text-sm text-left leading-tight">{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Footer Actions */}
          <div className="px-4 py-2 border-t border-slate-800/50 shrink-0">
            {operadorPodeAlternar && !treinando && (
              <button onClick={() => alternarTreino(true)} title="Pratique o sistema com lançamentos de teste: nada é gravado de verdade e você continua com o seu perfil"
                className="w-full flex items-center gap-3 px-4 py-2 mb-1 rounded-xl text-fuchsia-300 hover:bg-fuchsia-500/10 hover:text-fuchsia-200 transition-all duration-200 text-sm font-medium">
                <GraduationCap size={18} />
                <span>Entrar no modo treinamento</span>
              </button>
            )}
            <button
              onClick={logout}
              className="w-full flex items-center gap-3 px-4 py-2 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200 text-sm font-medium"
            >
              <LogOut size={18} />
              <span>Encerrar Sessão</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden relative">
        {treinando && (
          <div className="shrink-0 bg-fuchsia-700 text-white text-sm px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1" role="status" data-testid="faixa-treinamento">
            <b className="uppercase tracking-wide">Modo treinamento</b>
            <span className="flex-1 min-w-[260px]">Você vê os dados reais, mas tudo o que lançar é <b>só de teste</b>: fica neste navegador e <b>nada é gravado no sistema</b>.</span>
            <span className="tabular-nums">{totalLancamentosDeTeste()} lançamento(s) de teste</span>
            <button onClick={zerarTestes} className="px-3 py-1 rounded bg-white/20 hover:bg-white/30 font-semibold">Zerar meus testes</button>
            {operadorPodeAlternar && <button onClick={() => alternarTreino(false)} className="px-3 py-1 rounded bg-white text-fuchsia-800 hover:bg-fuchsia-50 font-bold">Sair do treinamento</button>}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          <div className="max-w-7xl mx-auto h-full">
            {lembrarBackup && (
              <div className="mb-4 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm flex flex-wrap items-center gap-3" role="status">
                <DatabaseBackup size={18} className="shrink-0" />
                <span className="flex-1">{diasBackup === null ? 'Nenhum backup completo registrado.' : `Último backup completo há ${diasBackup} dias.`} Recomenda-se um backup por semana.</span>
                <button onClick={() => navigateTo('admin')} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700">Fazer backup agora</button>
              </div>
            )}
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <AccountModal isOpen={isAccountOpen} onClose={() => setIsAccountOpen(false)} />
    </div>
  );
};
