
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { TenantStatus, Tenant } from '../types';
import { evolutionService } from '../services/evolutionService';

const SuperAdminView: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'stats' | 'tenants' | 'sql'>('stats');
  const [stats, setStats] = useState<any>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [successData, setSuccessData] = useState<{ email: string; pass: string; slug: string } | null>(null);
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [monthlyFee, setMonthlyFee] = useState('0');
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);

  const COLORS = ['#f97316', '#000000', '#94a3b8'];

  const load = async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        db.getGlobalStats(),
        db.getAllTenants()
      ]);
      setStats(s);
      setTenants([...t].reverse());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateCompany = async () => {
    if (!name.trim()) return;
    setCreatingInstance(true);
    
    try {
      const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      
      const finalEmail = email.trim() || `${slug}@agendezap.com`;
      const finalPass = password.trim() || `Zap@${Math.floor(1000 + Math.random() * 9000)}`;

      const newTenant = await db.addTenant({
        name: name, 
        slug: slug, 
        email: finalEmail,
        password: finalPass,
        plan: 'BASIC', 
        status: TenantStatus.ACTIVE, 
        monthlyFee: parseFloat(monthlyFee) || 0
      });
      
      try {
        // Tenta criar instância no Evolution, mas não deixa travar o processo principal
        await Promise.race([
          evolutionService.createAndFetchQr(slug),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout Evolution')), 15000))
        ]);
      } catch (e) {
        console.error("Falha ao criar instância Evolution (ou timeout):", e);
      }

      setTenants([newTenant, ...tenants]);
      setSuccessData({ 
        email: finalEmail, 
        pass: finalPass,
        slug: slug
      });
      
      // Limpa os campos
      setName('');
      setEmail('');
      setPassword('');
      setMonthlyFee('0');
      
      load();
    } catch (e) {
      console.error("Erro ao criar unidade:", e);
      alert("Erro ao criar unidade. Verifique o console.");
    } finally {
      setCreatingInstance(false);
    }
  };

  const handleUpdateTenant = async () => {
    if (!editingTenant) return;
    setCreatingInstance(true);
    try {
      await db.updateTenant(editingTenant.id, {
        status: editingTenant.status,
        monthlyFee: editingTenant.monthlyFee,
        email: editingTenant.email,
        password: editingTenant.password
      });
      setEditingTenant(null);
      load();
    } catch (e) {
      console.error(e);
      alert("Erro ao atualizar barbearia");
    } finally {
      setCreatingInstance(false);
    }
  };

  const sqlScript = `
-- SCRIPT DE REPARO E ATUALIZAÇÃO AGENDEZAP --

-- Este script garante que todas as colunas necessárias existam na tabela 'tenants'
DO $$ 
BEGIN 
    -- Coluna email
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='email') THEN
        ALTER TABLE tenants ADD COLUMN email TEXT;
    END IF;
    
    -- Coluna password
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='password') THEN
        ALTER TABLE tenants ADD COLUMN password TEXT;
    END IF;

    -- Coluna plan
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='plan') THEN
        ALTER TABLE tenants ADD COLUMN plan TEXT DEFAULT 'BASIC';
    END IF;

    -- Coluna status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='status') THEN
        ALTER TABLE tenants ADD COLUMN status TEXT DEFAULT 'ATIVA';
    END IF;

    -- Coluna mensalidade (monthlyFee no código)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='mensalidade') THEN
        ALTER TABLE tenants ADD COLUMN mensalidade NUMERIC DEFAULT 0;
    END IF;

    -- Coluna nome (name no código)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='nome') THEN
        ALTER TABLE tenants ADD COLUMN nome TEXT;
    END IF;

    -- REMOVER RESTRIÇÃO DE NOT NULL DA COLUNA evolution_instance (se existir)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='evolution_instance') THEN
        ALTER TABLE tenants ALTER COLUMN evolution_instance DROP NOT NULL;
    END IF;

    -- REPARO TABELA PROFESSIONALS
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='professionals') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='professionals' AND column_name='phone') THEN
            ALTER TABLE professionals ADD COLUMN phone TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='professionals' AND column_name='nome') THEN
            ALTER TABLE professionals ADD COLUMN nome TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='professionals' AND column_name='especialidade') THEN
            ALTER TABLE professionals ADD COLUMN especialidade TEXT;
        END IF;
    END IF;

    -- REPARO TABELA SERVICES
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='services') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='preco') THEN
            ALTER TABLE services ADD COLUMN preco NUMERIC;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='duracao_minutos') THEN
            ALTER TABLE services ADD COLUMN duracao_minutos INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='services' AND column_name='nome') THEN
            ALTER TABLE services ADD COLUMN nome TEXT;
        END IF;
    END IF;

    -- REPARO TABELA CUSTOMERS
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='customers') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='telefone') THEN
            ALTER TABLE customers ADD COLUMN telefone TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='nome') THEN
            ALTER TABLE customers ADD COLUMN nome TEXT;
        END IF;
    END IF;

    -- REPARO TABELA APPOINTMENTS (AGENDAMENTOS)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='appointments') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='inicio') THEN
            ALTER TABLE appointments ADD COLUMN inicio TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='fim') THEN
            ALTER TABLE appointments ADD COLUMN fim TIMESTAMPTZ;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='payment_method') THEN
            ALTER TABLE appointments ADD COLUMN payment_method TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='appointments' AND column_name='amount_paid') THEN
            ALTER TABLE appointments ADD COLUMN amount_paid NUMERIC DEFAULT 0;
        END IF;
    END IF;

    -- REPARO TABELA EXPENSES (CAIXA/DESPESAS)
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='expenses') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='category') THEN
            ALTER TABLE expenses ADD COLUMN category TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expenses' AND column_name='date') THEN
            ALTER TABLE expenses ADD COLUMN date TIMESTAMPTZ DEFAULT now();
        END IF;
    END IF;
END $$;

-- Recriar as outras tabelas se não existirem
CREATE TABLE IF NOT EXISTS professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  nome TEXT,
  phone TEXT NOT NULL,
  especialidade TEXT,
  ativo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  nome TEXT,
  preco NUMERIC,
  duracao_minutos INTEGER,
  ativo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  nome TEXT,
  telefone TEXT NOT NULL,
  ativo BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  follow_up JSONB,
  operating_hours JSONB,
  ai_active BOOLEAN DEFAULT false,
  theme_color TEXT DEFAULT '#f97316'
);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  customer_id UUID REFERENCES customers(id),
  professional_id UUID REFERENCES professionals(id),
  service_id UUID REFERENCES services(id),
  inicio TIMESTAMPTZ,
  fim TIMESTAMPTZ,
  status TEXT DEFAULT 'PENDING',
  origem TEXT DEFAULT 'WEB',
  payment_method TEXT,
  amount_paid NUMERIC,
  extra_note TEXT,
  extra_value NUMERIC
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id),
  description TEXT,
  amount NUMERIC,
  category TEXT,
  professional_id UUID REFERENCES professionals(id),
  date TIMESTAMPTZ DEFAULT now()
);
`.trim();

  if (loading || !stats) return <div className="p-20 text-center font-black animate-pulse">SINCRONIZANDO PAINEL MESTRE...</div>;

  return (
    <div className="space-y-12 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-black text-black uppercase tracking-tight italic">SuperAdmin</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">Visão do Ecossistema</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-orange-500 text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-orange-100 hover:scale-105 transition-all">
          + Nova Barbearia
        </button>
      </div>

      <div className="flex bg-white p-2 rounded-[30px] shadow-sm border-2 border-slate-50">
        <button onClick={() => setActiveSubTab('stats')} className={`flex-1 py-4 rounded-[24px] text-[10px] font-black uppercase tracking-widest transition-all ${activeSubTab === 'stats' ? 'bg-black text-white' : 'text-slate-400 hover:text-black'}`}>📊 Estatísticas</button>
        <button onClick={() => setActiveSubTab('tenants')} className={`flex-1 py-4 rounded-[24px] text-[10px] font-black uppercase tracking-widest transition-all ${activeSubTab === 'tenants' ? 'bg-black text-white' : 'text-slate-400 hover:text-black'}`}>🏢 Clientes SaaS</button>
        <button onClick={() => setActiveSubTab('sql')} className={`flex-1 py-4 rounded-[24px] text-[10px] font-black uppercase tracking-widest transition-all ${activeSubTab === 'sql' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-black'}`}>⚙️ Configurar Banco (SQL)</button>
      </div>

      {activeSubTab === 'stats' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
          <GlobalCard title="Empresas" val={stats.totalTenants.toString()} icon="🏢" />
          <GlobalCard title="Receita MRR" val={`R$ ${stats.mrr.toLocaleString()}`} icon="💰" color="text-orange-500" />
          <GlobalCard title="Volume Global" val={`R$ ${stats.globalVolume.toLocaleString()}`} icon="💹" highlight={true} />
          <GlobalCard title="WhatsApp On" val={stats.activeTenants.toString()} icon="📱" />
          <GlobalCard title="Faltas Evitadas" val="12K+" icon="🛡️" />
        </div>
      )}

      {activeSubTab === 'tenants' && (
        <div className="bg-white p-12 rounded-[50px] border-2 border-slate-100 shadow-xl overflow-hidden h-[600px] flex flex-col">
           <div className="flex-1 overflow-y-auto">
             <table className="w-full text-left">
               <thead>
                 <tr className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] border-b-2 border-slate-50">
                   <th className="pb-6">UNIDADE</th>
                   <th className="pb-6">ACESSO</th>
                   <th className="pb-6">STATUS</th>
                   <th className="pb-6 text-right">MENSALIDADE</th>
                   <th className="pb-6 text-right">AÇÕES</th>
                 </tr>
               </thead>
               <tbody className="divide-y-2 divide-slate-50">
                 {tenants.map(t => (
                   <tr key={t.id} className="group hover:bg-slate-50 transition-colors">
                     <td className="py-6 flex items-center space-x-4">
                       <div className="w-12 h-12 bg-black text-white rounded-2xl flex items-center justify-center font-black text-lg group-hover:bg-orange-500 transition-all">{t.name[0]}</div>
                       <div>
                         <p className="font-black text-black text-sm uppercase tracking-tight">{t.name}</p>
                         <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Slug: {t.slug}</p>
                       </div>
                     </td>
                     <td className="py-6">
                       <p className="text-[10px] font-black text-black">{t.email || 'N/A'}</p>
                       <p className="text-[9px] font-bold text-slate-400 font-mono">{t.password || 'N/A'}</p>
                     </td>
                     <td className="py-6">
                        <span className={`text-[9px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest ${
                          t.status === TenantStatus.ACTIVE ? 'bg-orange-100 text-orange-600' : 
                          t.status === TenantStatus.PENDING_PAYMENT ? 'bg-red-100 text-red-600' :
                          'bg-slate-100 text-slate-400'
                        }`}>
                          {t.status}
                        </span>
                     </td>
                     <td className="py-6 text-right font-black text-black text-lg">R$ {t.monthlyFee.toLocaleString()}</td>
                      <td className="py-6 text-right">
                        <button 
                          onClick={() => setEditingTenant({ ...t })}
                          className="text-[10px] font-black text-orange-500 uppercase tracking-widest hover:underline"
                        >
                          Editar
                        </button>
                      </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        </div>
      )}

      {activeSubTab === 'sql' && (
        <div className="bg-slate-900 p-12 rounded-[50px] shadow-2xl space-y-8 animate-scaleUp">
          <div className="flex items-start space-x-6">
             <div className="text-4xl">🚀</div>
             <div>
               <h3 className="text-xl font-black text-white uppercase italic">Configuração do Supabase</h3>
               <p className="text-slate-400 text-xs font-bold leading-relaxed mt-2 uppercase tracking-widest">
                 Se o sistema não estiver puxando dados, execute este script no SQL EDITOR do Supabase.
               </p>
             </div>
          </div>
          <div className="relative group">
            <textarea 
              readOnly 
              value={sqlScript}
              className="w-full h-96 bg-black/50 border-2 border-slate-800 rounded-[30px] p-8 font-mono text-[11px] text-orange-500 outline-none custom-scrollbar"
            />
            <button 
              onClick={() => { navigator.clipboard.writeText(sqlScript); alert("Script SQL Copiado!"); }}
              className="absolute top-6 right-6 bg-orange-500 text-white px-6 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-white hover:text-orange-500 transition-all shadow-xl"
            >
              COPIAR SCRIPT
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[50px] w-full max-w-md p-12 space-y-10 animate-scaleUp border-4 border-black">
             {!successData ? (
               <>
                 <h2 className="text-3xl font-black text-black uppercase tracking-tight italic">Nova Unidade</h2>
                 <div className="space-y-6">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome da Barbearia</label>
                      <input value={name} onChange={e=>setName(e.target.value)} placeholder="EX: BARBER SHOP" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">E-mail de Acesso</label>
                      <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="EMAIL@EXEMPLO.COM" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Senha de Acesso</label>
                      <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="SENHA123" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Valor da Mensalidade (R$)</label>
                      <input type="number" value={monthlyFee} onChange={e=>setMonthlyFee(e.target.value)} placeholder="0.00" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500" />
                    </div>
                 </div>
                 <div className="flex gap-4">
                    <button onClick={() => setShowModal(false)} className="flex-1 py-5 font-black text-slate-400 uppercase text-xs tracking-widest" disabled={creatingInstance}>Cancelar</button>
                    <button onClick={handleCreateCompany} className="flex-1 py-5 bg-black text-white rounded-[24px] font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50" disabled={creatingInstance}>
                      {creatingInstance ? 'CRIANDO...' : 'Ativar Acesso'}
                    </button>
                 </div>
               </>
             ) : (
               <div className="text-center space-y-10">
                  <div className="w-24 h-24 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center text-5xl mx-auto shadow-xl">✓</div>
                  <h2 className="text-2xl font-black text-black uppercase tracking-tight">Licença Ativada!</h2>
                  <div className="bg-slate-50 p-8 rounded-[35px] text-left border-2 border-slate-100 space-y-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Acesso:</p>
                    <p className="text-sm font-black text-black break-all">{successData.email}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase mt-4 mb-1">Senha:</p>
                    <p className="text-lg font-black text-orange-500 font-mono">{successData.pass}</p>
                  </div>
                  <button onClick={() => {setShowModal(false); setSuccessData(null);}} className="w-full py-5 bg-black text-white rounded-[24px] font-black uppercase text-xs tracking-widest">Finalizar</button>
               </div>
             )}
          </div>
        </div>
      )}

      {editingTenant && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[50px] w-full max-w-md p-12 space-y-10 animate-scaleUp border-4 border-orange-500">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight italic">Editar Unidade</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">E-mail de Acesso</label>
                <input 
                  type="email" 
                  value={editingTenant.email || ''} 
                  onChange={e => setEditingTenant({ ...editingTenant, email: e.target.value })}
                  className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Senha</label>
                <input 
                  type="text" 
                  value={editingTenant.password || ''} 
                  onChange={e => setEditingTenant({ ...editingTenant, password: e.target.value })}
                  className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Status da Licença</label>
                <select 
                  value={editingTenant.status} 
                  onChange={e => setEditingTenant({ ...editingTenant, status: e.target.value as TenantStatus })}
                  className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500"
                >
                  {Object.values(TenantStatus).map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Valor Mensalidade (R$)</label>
                <input 
                  type="number" 
                  value={editingTenant.monthlyFee} 
                  onChange={e => setEditingTenant({ ...editingTenant, monthlyFee: parseFloat(e.target.value) || 0 })}
                  className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-xs uppercase tracking-widest focus:border-orange-500"
                />
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setEditingTenant(null)} className="flex-1 py-5 font-black text-slate-400 uppercase text-xs tracking-widest" disabled={creatingInstance}>Cancelar</button>
              <button onClick={handleUpdateTenant} className="flex-1 py-5 bg-black text-white rounded-[24px] font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50" disabled={creatingInstance}>
                {creatingInstance ? 'SALVANDO...' : 'Salvar Alterações'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const GlobalCard = ({ title, val, icon, color, highlight }: any) => (
  <div className={`bg-white p-8 rounded-[40px] border-2 shadow-xl transition-all ${highlight ? 'border-orange-500 shadow-orange-100/50 scale-105' : 'border-slate-100 shadow-slate-100/50 hover:border-black'}`}>
    <div className="text-3xl mb-4">{icon}</div>
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
    <p className={`text-2xl font-black ${color || 'text-black'}`}>{val}</p>
  </div>
);

export default SuperAdminView;
