
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';

const FollowUpView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [activeTab, setActiveTab] = useState<'aviso' | 'lembrete' | 'reativacao'>('aviso');
  const [localSettings, setLocalSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const settings = await db.getSettings(tenantId);
      setLocalSettings(settings.followUp);
      setLoading(false);
    };
    load();
  }, [tenantId]);

  const handleUpdate = async (data: any) => {
    const updated = { ...localSettings[activeTab], ...data };
    const newSets = { ...localSettings, [activeTab]: updated };
    setLocalSettings(newSets);
    await db.updateSettings(tenantId, { followUp: newSets });
  };

  if (loading || !localSettings) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO...</div>;

  const current = localSettings[activeTab];

  return (
    <div className="space-y-10 animate-fadeIn max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Lembretes Inteligentes</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Reduza faltas e aumente a retenção</p>
      </div>

      <div className="flex bg-slate-100 p-2 rounded-[30px] shadow-sm">
        <Tab active={activeTab === 'aviso'} onClick={() => setActiveTab('aviso')} label="Check-in Diário" icon="📢" />
        <Tab active={activeTab === 'lembrete'} onClick={() => setActiveTab('lembrete')} label="Lembrete Próximo" icon="🕒" />
        <Tab active={activeTab === 'reativacao'} onClick={() => setActiveTab('reativacao')} label="Recuperação" icon="♻️" />
      </div>

      <div className="bg-white p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-12">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
           <div className="flex items-center space-x-6">
             <div className="w-20 h-20 bg-black text-white rounded-[28px] flex items-center justify-center text-4xl shadow-xl">
               {activeTab === 'aviso' && '📢'}
               {activeTab === 'lembrete' && '🕒'}
               {activeTab === 'reativacao' && '♻️'}
             </div>
             <div>
               <h3 className="text-2xl font-black text-black uppercase tracking-tight">{activeTab === 'reativacao' ? 'Reativação de Cliente' : activeTab === 'aviso' ? 'Aviso do Dia' : 'Lembrete de Agendamento'}</h3>
               <p className={`text-[10px] font-black uppercase tracking-widest mt-1 ${current.active ? 'text-orange-500' : 'text-slate-400'}`}>
                 SISTEMA {current.active ? 'ATIVADO' : 'SUSPENSO'}
               </p>
             </div>
           </div>
           <button 
             onClick={() => handleUpdate({ active: !current.active })}
             className={`px-10 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${current.active ? 'bg-black text-white' : 'bg-orange-500 text-white shadow-xl shadow-orange-100'}`}
           >
             {current.active ? 'Desativar Módulo' : 'Ativar Agora'}
           </button>
        </div>

        <div className="space-y-4">
           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Gatilho de Envio</label>
           <div className="flex items-center space-x-6">
              {activeTab === 'aviso' ? (
                <input type="time" value={current.fixedTime || '00:01'} onChange={(e) => handleUpdate({ fixedTime: e.target.value })} className="p-5 bg-slate-50 border-2 border-slate-100 rounded-3xl font-black text-2xl text-black outline-none focus:border-orange-500 transition-all" />
              ) : activeTab === 'lembrete' ? (
                <select value={current.timing} onChange={(e) => handleUpdate({ timing: Number(e.target.value) })} className="p-5 bg-slate-50 border-2 border-slate-100 rounded-3xl font-black uppercase text-xs outline-none focus:border-black">
                  <option value={30}>30 minutos antes</option>
                  <option value={60}>1 hora antes</option>
                  <option value={120}>2 horas antes</option>
                </select>
              ) : (
                <div className="flex items-center space-x-4">
                  <input type="number" value={current.timing} onChange={(e) => handleUpdate({ timing: Number(e.target.value) })} className="w-24 p-5 bg-slate-50 border-2 border-slate-100 rounded-3xl font-black text-center text-xl" />
                  <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Dias de ausência</span>
                </div>
              )}
           </div>
        </div>

        <div className="space-y-4">
           <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Redação do WhatsApp</label>
           <textarea 
             rows={8}
             value={current.message}
             onChange={(e) => handleUpdate({ message: e.target.value })}
             className="w-full p-8 bg-slate-50 border-2 border-slate-100 rounded-[40px] outline-none focus:border-orange-500 transition-all text-sm font-bold text-black leading-relaxed"
           />
           <div className="flex flex-wrap gap-3">
              <Tag label="{nome}" /> <Tag label="{dia}" /> <Tag label="{hora}" /> <Tag label="{servico}" />
           </div>
        </div>

        <div className="pt-8 border-t-2 border-slate-50">
           <button className="w-full bg-black text-white py-6 rounded-[30px] font-black text-sm uppercase tracking-[0.3em] shadow-2xl hover:bg-orange-500 transition-all">
             Salvar Estratégia
           </button>
        </div>
      </div>
    </div>
  );
};

const Tab = ({ active, onClick, label, icon }: any) => (
  <button onClick={onClick} className={`flex-1 py-4 px-6 rounded-[24px] flex items-center justify-center space-x-3 transition-all ${active ? 'bg-white text-black shadow-xl font-black scale-105 z-10' : 'text-slate-400 font-bold hover:text-black'}`}>
    <span className="text-xl">{icon}</span>
    <span className="text-[10px] uppercase tracking-widest">{label}</span>
  </button>
);

const Tag = ({ label }: any) => (
  <span className="bg-white border-2 border-slate-100 px-4 py-2 rounded-xl text-[10px] font-black text-black tracking-widest cursor-default hover:border-orange-500 transition-all uppercase">{label}</span>
);

export default FollowUpView;
