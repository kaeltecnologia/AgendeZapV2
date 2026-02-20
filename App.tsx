
import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import EvolutionConfig from './components/EvolutionConfig';
import AIChatSimulator from './components/AIChatSimulator';
import AppointmentsView from './components/AppointmentsView';
import ServicesView from './components/ServicesView';
import ProfessionalsView from './components/ProfessionalsView';
import CustomersView from './components/CustomersView';
import AiAgentConfig from './components/AiAgentConfig';
import StoreProfile from './components/StoreProfile';
import FinancialView from './components/FinancialView';
import GeneralSettings from './components/GeneralSettings';
import FollowUpView from './components/FollowUpView';
import SuperAdminView from './components/SuperAdminView';
import Login from './components/Login';
import AiPollingManager from './components/AiPollingManager';
import { db } from './services/mockDb';
import { TenantStatus } from './types';

enum View {
  DASHBOARD = 'DASHBOARD',
  AGENDAMENTOS = 'AGENDAMENTOS',
  SERVICOS = 'SERVICOS',
  PROFISSIONAIS = 'PROFISSIONAIS',
  CLIENTES = 'CLIENTES',
  AGENTE_AI = 'AGENTE_AI',
  PERFIL = 'PERFIL',
  FINANCEIRO = 'FINANCEIRO',
  CONNECT_WA = 'CONNECT_WA',
  FOLLOW_UP = 'FOLLOW_UP',
  LINK_WEB = 'LINK_WEB',
  TEST_WA = 'TEST_WA',
  CONFIGURACOES = 'CONFIGURACOES',
  SUPERADMIN_DASHBOARD = 'SUPERADMIN_DASHBOARD'
}

type Role = 'TENANT' | 'SUPERADMIN';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState<Role>('TENANT');
  const [currentView, setCurrentView] = useState<View>(View.DASHBOARD);
  const [tenantId, setTenantId] = useState<string>('');
  const [tenantSlug, setTenantSlug] = useState<string>('');
  const [tenantName, setTenantName] = useState<string>('Carregando...');
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      try {
        await db.checkConnection();
      } catch (err) {
        console.warn("Utilizando Local Storage como fallback.");
      } finally {
        setIsReady(true);
      }
    };
    init();
  }, []);

  const handleLogin = async (selectedRole: Role, userSlug?: string) => {
    console.log(`Tentativa de login: ${selectedRole}, Slug: ${userSlug}`);
    try {
      if (selectedRole === 'SUPERADMIN') {
        setRole('SUPERADMIN');
        setIsAuthenticated(true);
        setCurrentView(View.SUPERADMIN_DASHBOARD);
        return;
      }

      if (userSlug) {
        const targetSlug = userSlug.toLowerCase().trim();
        console.log(`Buscando barbearia: ${targetSlug}`);
        const tenants = await db.getAllTenants();
        let myTenant = tenants.find(t => t.slug === targetSlug);

        if (!myTenant) {
          console.warn(`Barbearia não encontrada: ${targetSlug}`);
          alert("Barbearia não encontrada. Verifique o e-mail ou cadastre-se.");
          return;
        }

        if (myTenant) {
          console.log(`Login bem-sucedido: ${myTenant.name}`);
          setTenantId(myTenant.id);
          setTenantSlug(myTenant.slug);
          setTenantName(myTenant.name);
          setRole('TENANT');
          setIsAuthenticated(true);
          setCurrentView(View.DASHBOARD);
        }
      }
    } catch (err) {
      console.error("Login Error:", err);
      alert("Falha crítica na conexão com o Supabase.");
    }
  };

  const handleRegister = async (storeName: string, email: string, pass: string) => {
    try {
      const slug = email.split('@')[0].toLowerCase().trim();
      const tenants = await db.getAllTenants();
      const exists = tenants.find(t => t.slug === slug);

      if (exists) {
        throw new Error("Este e-mail/slug já está cadastrado.");
      }

      const newTenant = await db.addTenant({
        name: storeName,
        slug: slug,
        plan: 'BASIC',
        status: TenantStatus.ACTIVE,
        monthlyFee: 0
      });

      if (newTenant) {
        await db.updateSettings(newTenant.id, {
          themeColor: '#f97316',
          aiActive: false
        });

        setTenantId(newTenant.id);
        setTenantSlug(newTenant.slug);
        setTenantName(newTenant.name);
        setRole('TENANT');
        setIsAuthenticated(true);
        setCurrentView(View.DASHBOARD);
      }
    } catch (err: any) {
      throw err;
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setRole('TENANT');
    setTenantId('');
    setTenantSlug('');
    setCurrentView(View.DASHBOARD);
  };

  if (!isReady) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin"></div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Estabelecendo Conexão Supabase...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} onRegister={handleRegister} />;
  }

  const renderView = () => {
    if (role === 'SUPERADMIN') return <SuperAdminView />;

    switch (currentView) {
      case View.DASHBOARD: return <Dashboard tenantId={tenantId} />;
      case View.AGENDAMENTOS: return <AppointmentsView tenantId={tenantId} />;
      case View.SERVICOS: return <ServicesView tenantId={tenantId} />;
      case View.PROFISSIONAIS: return <ProfessionalsView tenantId={tenantId} />;
      case View.CLIENTES: return <CustomersView tenantId={tenantId} />;
      case View.AGENTE_AI: return <AiAgentConfig tenantId={tenantId} />;
      case View.PERFIL: return <StoreProfile tenantId={tenantId} />;
      case View.FINANCEIRO: return <FinancialView tenantId={tenantId} />;
      case View.CONNECT_WA: return <EvolutionConfig tenantId={tenantId} tenantSlug={tenantSlug} />;
      case View.FOLLOW_UP: return <FollowUpView tenantId={tenantId} />;
      case View.TEST_WA: return <AIChatSimulator tenantId={tenantId} />;
      case View.CONFIGURACOES: return <GeneralSettings tenantId={tenantId} />;
      default: return <Dashboard tenantId={tenantId} />;
    }
  };

  const dbOnline = db.isOnline();

  return (
    <div className="flex min-h-screen bg-slate-50/30">
      {tenantId && <AiPollingManager tenantId={tenantId} />}

      <aside className="w-64 bg-white flex flex-col sticky top-0 h-screen shrink-0 border-r border-slate-200 z-50">
        <div className="p-8 flex flex-col space-y-2">
          <h1 className="text-2xl font-black text-black tracking-tighter uppercase italic">AgendeZap</h1>
          {role === 'SUPERADMIN' && <span className="bg-orange-500 text-white text-[8px] font-black px-2 py-0.5 rounded-full w-fit tracking-widest uppercase">SUPER ADMIN</span>}
        </div>

        <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto custom-scrollbar">
          {role === 'SUPERADMIN' ? (
            <NavItem active={true} onClick={() => {}} icon={<IconDashboard />} label="Painel Mestre" />
          ) : (
            <>
              <NavItem active={currentView === View.DASHBOARD} onClick={() => setCurrentView(View.DASHBOARD)} icon={<IconDashboard />} label="Início" />
              <NavItem active={currentView === View.AGENDAMENTOS} onClick={() => setCurrentView(View.AGENDAMENTOS)} icon={<IconCalendar />} label="Agenda" />
              <NavItem active={currentView === View.SERVICOS} onClick={() => setCurrentView(View.SERVICOS)} icon={<IconScissors />} label="Serviços" />
              <NavItem active={currentView === View.PROFISSIONAIS} onClick={() => setCurrentView(View.PROFISSIONAIS)} icon={<IconUsers />} label="Equipe" />
              <NavItem active={currentView === View.CLIENTES} onClick={() => setCurrentView(View.CLIENTES)} icon={<IconUserCircle />} label="Clientes" />
              <NavItem active={currentView === View.FINANCEIRO} onClick={() => setCurrentView(View.FINANCEIRO)} icon={<IconFinance />} label="Caixa" />
              
              <div className="pt-6 pb-2 mt-4 border-t border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-3 px-4">Integração</p>
                <NavItem active={currentView === View.CONNECT_WA} onClick={() => setCurrentView(View.CONNECT_WA)} icon={<IconWhatsapp />} label="WhatsApp" color="text-green-600" />
                <NavItem active={currentView === View.AGENTE_AI} onClick={() => setCurrentView(View.AGENTE_AI)} icon={<IconRobot />} label="Agente IA" />
                <NavItem active={currentView === View.FOLLOW_UP} onClick={() => setCurrentView(View.FOLLOW_UP)} icon={<IconClock />} label="Lembretes" />
              </div>
            </>
          )}

          <div className="pt-4 border-t border-slate-100 mt-4 space-y-1">
            <NavItem active={currentView === View.CONFIGURACOES} onClick={() => setCurrentView(View.CONFIGURACOES)} icon={<IconSettings />} label="Ajustes" />
            <NavItem active={currentView === View.TEST_WA} onClick={() => setCurrentView(View.TEST_WA)} icon={<IconTerminal />} label="Terminal IA" />
          </div>
        </nav>

        <div className="p-6 border-t border-slate-100 bg-slate-50/50 space-y-4">
          <div className="flex items-center space-x-3">
             <div className={`w-2 h-2 rounded-full ${dbOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
             <span className={`text-[8px] font-black uppercase tracking-widest ${dbOnline ? 'text-green-600' : 'text-red-600'}`}>
               Supabase: {dbOnline ? 'ONLINE' : 'OFFLINE'}
             </span>
          </div>
          <button onClick={handleLogout} className="flex items-center space-x-3 w-full text-slate-400 hover:text-red-500 transition-all font-bold text-xs uppercase tracking-widest">
            <IconLogout /> <span>Sair</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto h-screen relative">
        <header className="px-10 py-8 flex items-center justify-between sticky top-0 bg-white/80 backdrop-blur-md z-40 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-black text-black tracking-tight uppercase">{role === 'SUPERADMIN' ? 'Gestão Global do SaaS' : tenantName}</h2>
          </div>
          {!dbOnline && (
            <div className="bg-red-50 border border-red-100 px-4 py-2 rounded-xl flex items-center space-x-3">
              <span className="text-[10px] font-black text-red-600 uppercase">Modo Offline (Cache Local)</span>
              <button onClick={() => window.location.reload()} className="text-[9px] font-black text-red-500 underline uppercase">Reconectar</button>
            </div>
          )}
        </header>
        <div className="p-10">{renderView()}</div>
      </main>
    </div>
  );
};

const NavItem = ({ active, onClick, icon, label, color }: any) => (
  <button onClick={onClick} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all group ${active ? 'bg-black text-white shadow-xl scale-105' : `text-slate-500 hover:bg-slate-100 ${color || ''}`}`}>
    <span className={`text-xl mr-3 ${active ? 'text-orange-500' : 'text-slate-400 group-hover:text-black'}`}>{icon}</span>
    <span className={`font-black text-[10px] uppercase tracking-widest ${active ? 'text-white' : ''}`}>{label}</span>
  </button>
);

const IconDashboard = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>;
const IconCalendar = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>;
const IconScissors = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" y1="4" x2="8.12" y2="15.88"></line><line x1="14.47" y1="14.48" x2="20" y2="20"></line><line x1="8.12" y1="8.12" x2="12" y2="12"></line></svg>;
const IconUsers = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>;
const IconUserCircle = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="10" r="3"></circle><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"></path></svg>;
const IconRobot = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>;
const IconFinance = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>;
const IconWhatsapp = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-11.7 8.38 8.38 0 0 1 3.8.9L21 3z"></path></svg>;
const IconClock = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>;
const IconSettings = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>;
const IconTerminal = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>;
const IconLogout = () => <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>;

export default App;
