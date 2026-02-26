import React, { useState } from 'react';
import EvolutionConfig from './EvolutionConfig';
import AiAgentConfig from './AiAgentConfig';
import { db } from '../services/mockDb';

type Tab = 'whatsapp' | 'agente' | 'linkweb';

const ConexoesView: React.FC<{ tenantId: string; tenantSlug: string }> = ({ tenantId, tenantSlug }) => {
  const [tab, setTab] = useState<Tab>('whatsapp');
  const [copied, setCopied] = useState(false);
  const dbOnline = db.isOnline();

  const bookingUrl = `${window.location.origin}${window.location.pathname}#/agendar/${tenantSlug}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(bookingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Conexões</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">WhatsApp, Agente IA e link de agendamento</p>
        </div>

        {/* DB / Supabase status badge */}
        <div className={`flex items-center gap-2 px-5 py-3 rounded-2xl border-2 ${dbOnline ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
          <div className={`w-2 h-2 rounded-full ${dbOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-[10px] font-black uppercase tracking-widest ${dbOnline ? 'text-green-600' : 'text-red-600'}`}>
            Supabase: {dbOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 bg-slate-50 p-1.5 rounded-2xl w-fit border border-slate-100">
        <TabBtn active={tab === 'whatsapp'} onClick={() => setTab('whatsapp')} icon="📱" label="WhatsApp" />
        <TabBtn active={tab === 'agente'}   onClick={() => setTab('agente')}   icon="🤖" label="Agente IA" />
        <TabBtn active={tab === 'linkweb'}  onClick={() => setTab('linkweb')}  icon="🔗" label="Link Web" />
      </div>

      {/* Content */}
      <div>
        {tab === 'whatsapp' && <EvolutionConfig tenantId={tenantId} tenantSlug={tenantSlug} />}
        {tab === 'agente'   && <AiAgentConfig   tenantId={tenantId} />}
        {tab === 'linkweb'  && (
          <div className="space-y-6">
            {/* Info card */}
            <div className="bg-orange-50 border-2 border-orange-100 rounded-3xl p-6 flex gap-4 items-start">
              <span className="text-3xl mt-0.5">🔗</span>
              <div>
                <p className="font-black text-orange-700 text-sm uppercase tracking-widest">Link de Agendamento Online</p>
                <p className="text-xs text-orange-600 mt-1 leading-relaxed">
                  Compartilhe este link com seus clientes para que possam agendar sozinhos, 24h por dia.
                  Eles escolhem o serviço, dia, barbeiro e horário. O agendamento cai direto na agenda e ambos recebem confirmação no WhatsApp.
                </p>
              </div>
            </div>

            {/* URL box */}
            <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Seu link exclusivo</p>

              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-50 border border-slate-200 rounded-2xl px-5 py-3.5 font-mono text-sm text-slate-700 truncate select-all">
                  {bookingUrl}
                </div>
                <button
                  onClick={handleCopy}
                  className={`shrink-0 px-6 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${
                    copied
                      ? 'bg-green-500 text-white'
                      : 'bg-black text-white hover:bg-orange-500'
                  }`}
                >
                  {copied ? '✓ Copiado!' : 'Copiar'}
                </button>
              </div>

              <button
                onClick={() => window.open(bookingUrl, '_blank')}
                className="flex items-center gap-2 text-xs font-black text-orange-500 hover:text-orange-600 uppercase tracking-widest transition-colors"
              >
                <span>↗</span>
                <span>Abrir página de agendamento</span>
              </button>
            </div>

            {/* How it works */}
            <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Como funciona</p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { n: '1', title: 'Escolhe o serviço', desc: 'O cliente vê todos os serviços com preços e duração.' },
                  { n: '2', title: 'Seleciona o dia', desc: 'Calendário mostra apenas dias com horários disponíveis.' },
                  { n: '3', title: 'Escolhe o barbeiro', desc: 'Pode escolher um profissional específico ou qualquer um.' },
                  { n: '4', title: 'Confirma o horário', desc: 'Preenche nome e telefone e recebe confirmação no WhatsApp.' },
                ].map(s => (
                  <div key={s.n} className="flex gap-3 items-start p-4 bg-slate-50 rounded-2xl">
                    <span className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center text-xs font-black shrink-0">{s.n}</span>
                    <div>
                      <p className="font-black text-xs text-black uppercase tracking-tight">{s.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{s.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Share tips */}
            <div className="bg-white rounded-3xl border-2 border-slate-100 p-6 space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Dicas de compartilhamento</p>
              <ul className="space-y-2">
                {[
                  'Adicione o link na bio do Instagram e TikTok',
                  'Envie no grupo do WhatsApp da barbearia',
                  'Coloque um QR Code impresso na recepção',
                  'Compartilhe em posts e stories com a chamada "Agende Online 24h"',
                ].map((tip, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-500">
                    <span className="text-orange-400 font-black shrink-0">•</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const TabBtn: React.FC<{ active: boolean; onClick: () => void; icon: string; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${
      active ? 'bg-black text-white shadow-lg' : 'text-slate-500 hover:text-black'
    }`}
  >
    <span>{icon}</span>
    <span>{label}</span>
  </button>
);

export default ConexoesView;
