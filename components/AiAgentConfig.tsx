
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';

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

const DEFAULT_PROMPT = 'Você é o assistente oficial da Barbearia. Use um tom amigável, moderno e focado na conversão de agendamentos. Pergunte o que o cliente deseja e guie-o até a confirmação de horário, profissional e serviço.';
const DEFAULT_AGENT_NAME = 'Agente Inteligente AgendeZap';

const AiAgentConfig: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [active, setActive] = useState(false);
  const [aiLeadActive, setAiLeadActive] = useState(true);
  const [aiProfessionalActive, setAiProfessionalActive] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_PROMPT);
  const [agentName, setAgentName] = useState(DEFAULT_AGENT_NAME);
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [msgBufferSecs, setMsgBufferSecs] = useState(30);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingPrompt, setSavingPrompt] = useState(false);

  useEffect(() => {
    const load = async () => {
      const settings = await db.getSettings(tenantId);
      setActive(settings.aiActive);
      setAiLeadActive(settings.aiLeadActive !== false);
      setAiProfessionalActive(!!settings.aiProfessionalActive);
      setSystemPrompt(settings.systemPrompt || DEFAULT_PROMPT);
      setAgentName(settings.agentName || DEFAULT_AGENT_NAME);
      setOpenaiApiKey(settings.openaiApiKey || '');
      setMsgBufferSecs(settings.msgBufferSecs ?? 30);
      setLoadingSettings(false);
    };
    load();
  }, [tenantId]);

  const toggleAi = async () => {
    const newState = !active;
    setActive(newState);
    await db.updateSettings(tenantId, { aiActive: newState });
  };

  const handleToggleLead = async (val: boolean) => {
    setAiLeadActive(val);
    await db.updateSettings(tenantId, { aiLeadActive: val });
  };

  const handleToggleProfessional = async (val: boolean) => {
    setAiProfessionalActive(val);
    await db.updateSettings(tenantId, { aiProfessionalActive: val });
  };

  const handleSavePrompt = async () => {
    setSavingPrompt(true);
    await db.updateSettings(tenantId, { systemPrompt, agentName, openaiApiKey, msgBufferSecs });
    setSavingPrompt(false);
  };

  if (loadingSettings) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO CONFIGURAÇÕES...</div>;

  const usingOpenAI = openaiApiKey.trim().startsWith('sk-');

  return (
    <div className="space-y-10 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Agente IA</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
          Configurações de inteligência artificial
          {usingOpenAI
            ? <span className="ml-2 bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full text-[9px] font-black uppercase">GPT-4o Mini</span>
            : <span className="ml-2 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[9px] font-black uppercase">Gemini Flash</span>
          }
        </p>
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
              className={`w-full py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                active ? 'bg-black text-white hover:bg-red-500' : 'bg-orange-500 text-white shadow-xl shadow-orange-100'
              }`}
            >
              {active ? 'Desligar Agente' : 'Ativar Sistema'}
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

          {/* Buffer configurável */}
          <div className="bg-white p-8 rounded-[32px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-5">
            <div>
              <h3 className="font-black text-black text-xs uppercase tracking-widest">Buffer de Mensagens</h3>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">Aguarda este tempo de silêncio antes de responder</p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-400 uppercase">Espera</span>
                <span className="text-2xl font-black text-orange-500">{msgBufferSecs}s</span>
              </div>
              <input
                type="range"
                min={5}
                max={120}
                step={5}
                value={msgBufferSecs}
                onChange={e => setMsgBufferSecs(Number(e.target.value))}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-[9px] font-black text-slate-300 uppercase">
                <span>5s</span>
                <span>Rápido ←→ Paciente</span>
                <span>120s</span>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Right column: prompt + API key config ─── */}
        <div className="flex-1 bg-white p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-10">
          <div className="space-y-3">
            <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Personalidade do Atendente</label>
            <input value={agentName} onChange={e => setAgentName(e.target.value)} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-sm uppercase tracking-tight focus:border-orange-500 transition-all" />
          </div>

          <div className="space-y-3">
            <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">Contexto e Comportamento (System Prompt)</label>
            <textarea
              rows={8}
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              className="w-full p-8 bg-slate-50 border-2 border-slate-100 rounded-[30px] outline-none focus:border-orange-500 transition-all text-sm font-bold leading-relaxed text-black"
            />
          </div>

          {/* API Key section */}
          <div className="space-y-4 border-t-2 border-slate-50 pt-8">
            <div>
              <label className="text-[10px] font-black text-black uppercase tracking-[0.2em] ml-2">OpenAI API Key (GPT-4o Mini)</label>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-2 mt-0.5">
                Cole sua chave da OpenAI para usar GPT-4o Mini. Deixe vazio para manter Gemini Flash.
              </p>
            </div>
            <div className="relative">
              <input
                type="password"
                value={openaiApiKey}
                onChange={e => setOpenaiApiKey(e.target.value)}
                placeholder="sk-proj-..."
                className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-mono text-sm focus:border-emerald-500 transition-all pr-32"
              />
              <span className={`absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black uppercase px-3 py-1.5 rounded-xl ${
                usingOpenAI ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'
              }`}>
                {usingOpenAI ? '✓ GPT-4o Mini' : 'Gemini Flash'}
              </span>
            </div>
            {usingOpenAI && (
              <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-2xl">
                <p className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">
                  ✓ Usando GPT-4o Mini — conversas mais naturais e precisas
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4">
            <button onClick={handleSavePrompt} disabled={savingPrompt} className="bg-black text-white px-12 py-5 rounded-[24px] font-black text-xs uppercase tracking-[0.2em] shadow-xl hover:bg-orange-500 transition-all disabled:opacity-50">
              {savingPrompt ? 'Salvando...' : 'Salvar IA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiAgentConfig;
