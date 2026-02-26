
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { evolutionService } from '../services/evolutionService';

const Toggle = ({ checked, onChange, label, description }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) => (
  <div className="flex items-center justify-between gap-4 bg-slate-50 rounded-2xl p-5">
    <div>
      <p className="text-xs font-black text-black uppercase tracking-wide">{label}</p>
      <p className="text-[10px] font-bold text-slate-400 mt-0.5">{description}</p>
    </div>
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none ${checked ? 'bg-orange-500' : 'bg-slate-200'}`}
    >
      <span className={`inline-block h-5 w-5 mt-0.5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  </div>
);

const AiAgentConfig: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [active, setActive] = useState(false);
  const [aiLeadActive, setAiLeadActive] = useState(true);
  const [aiProfessionalActive, setAiProfessionalActive] = useState(false);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [slug, setSlug] = useState('');

  useEffect(() => {
    const load = async () => {
      const tenants = await db.getAllTenants();
      const myTenant = tenants.find(t => t.id === tenantId);
      if (myTenant) setSlug(myTenant.slug);

      const settings = await db.getSettings(tenantId);
      setActive(settings.aiActive);
      setAiLeadActive(settings.aiLeadActive !== false); // default true
      setAiProfessionalActive(!!settings.aiProfessionalActive);
      setLoadingSettings(false);
    };
    load();
  }, [tenantId]);

  const toggleAi = async () => {
    const newState = !active;
    setActive(newState);
    await db.updateSettings(tenantId, { aiActive: newState });

    if (newState && slug) {
      setLoadingWebhook(true);
      const instanceName = evolutionService.getInstanceName(slug);
      const ok = await evolutionService.setWebhook(instanceName);
      if (ok) alert(`Inteligência Artificial ativada para instância: ${instanceName}`);
      setLoadingWebhook(false);
    }
  };

  const handleToggleLead = async (val: boolean) => {
    setAiLeadActive(val);
    await db.updateSettings(tenantId, { aiLeadActive: val });
  };

  const handleToggleProfessional = async (val: boolean) => {
    setAiProfessionalActive(val);
    await db.updateSettings(tenantId, { aiProfessionalActive: val });
  };

  if (loadingSettings) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO CONFIGURAÇÕES...</div>;

  return (
    <div className="space-y-10 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Agente Gemini AI</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Configurações de inteligência artificial</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-10">
        {/* ─── Left column: status + mode toggles ─── */}
        <div className="w-full lg:w-80 space-y-6">
          {/* Main on/off */}
          <div className="bg-white p-10 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 text-center flex flex-col items-center">
            <div className={`w-24 h-24 rounded-[30px] flex items-center justify-center text-5xl mb-6 transition-all shadow-xl ${active ? 'bg-orange-500 text-white animate-pulse' : 'bg-slate-50 text-slate-300'}`}>🤖</div>
            <h3 className="font-black text-black uppercase tracking-tight mb-2">Status do Robô</h3>
            <p className={`text-[10px] uppercase font-black tracking-widest mb-10 ${active ? 'text-orange-500' : 'text-slate-400'}`}>
              {active ? 'CONECTADO & OPERANTE' : 'SISTEMA DESATIVADO'}
            </p>
            <button
              onClick={toggleAi}
              disabled={loadingWebhook}
              className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                active ? 'bg-black text-white hover:bg-red-500' : 'bg-orange-500 text-white shadow-xl shadow-orange-100'
              }`}
            >
              {loadingWebhook ? 'CONFIGURANDO...' : active ? 'Desligar Agente' : 'Ativar Sistema'}
            </button>
          </div>

          {/* Mode toggles */}
          <div className="bg-white p-8 rounded-[32px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-4">
            <h3 className="font-black text-black text-xs uppercase tracking-widest mb-2">Modos de Atuação</h3>
            <Toggle
              checked={aiLeadActive}
              onChange={handleToggleLead}
              label="IA para Leads"
              description="Responde automaticamente novos contatos via WhatsApp e converte em agendamentos"
            />
            <Toggle
              checked={aiProfessionalActive}
              onChange={handleToggleProfessional}
              label="Assessor do Profissional"
              description="Notifica e interage com os profissionais sobre agenda, confirmações e cancelamentos"
            />
            {!active && (
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center pt-2">Ative o sistema acima para os modos funcionarem</p>
            )}
          </div>
        </div>

        {/* ─── Right column: prompt config ─── */}
        <div className="flex-1 bg-white p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-10">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Personalidade do Atendente</label>
            <input defaultValue="Agente Inteligente AgendeZap" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-sm uppercase tracking-tight focus:border-orange-500 transition-all" />
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Contexto e Comportamento (System Prompt)</label>
            <textarea
              rows={10}
              className="w-full p-8 bg-slate-50 border-2 border-slate-100 rounded-[30px] outline-none focus:border-orange-500 transition-all text-sm font-bold leading-relaxed text-black"
              defaultValue={`Você é o assistente oficial da Barbearia. Use um tom amigável, moderno e focado na conversão de agendamentos. Pergunte o que o cliente deseja e guie-o até a confirmação de horário, profissional e serviço.`}
            />
            <div className="bg-orange-50 p-6 rounded-2xl flex items-start space-x-4 border-l-4 border-orange-500">
               <span className="text-xl">💡</span>
               <p className="text-[10px] font-black uppercase text-orange-800 leading-normal tracking-wider">
                 DICA: O Webhook está configurado para a sua instância específica. Toda mensagem recebida lá será processada por este prompt.
               </p>
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <button className="bg-black text-white px-12 py-5 rounded-[24px] font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-orange-500 transition-all">
              Salvar IA
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiAgentConfig;
