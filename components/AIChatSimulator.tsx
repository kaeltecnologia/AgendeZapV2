
import React, { useState, useRef, useEffect } from 'react';
import { processWhatsAppMessage } from '../services/geminiService';

const AIChatSimulator: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [messages, setMessages] = useState<any[]>([
    { role: 'ai', text: 'E aí, beleza? Sou o assistente da barbearia. O que vamos fazer hoje? Pode ser um corte, barba ou os dois?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setLoading(true);
    const result = await processWhatsAppMessage(tenantId, '5511999999999', 'Cliente Teste', userMsg);
    setMessages(prev => [...prev, { role: 'ai', text: result.replyText }]);
    setLoading(false);
  };

  return (
    <div className="max-w-2xl mx-auto h-[700px] bg-white rounded-[40px] shadow-2xl border-2 border-slate-100 flex flex-col overflow-hidden relative animate-scaleUp">
      <div className="bg-black p-8 text-white flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 rounded-2xl bg-orange-500 flex items-center justify-center text-2xl shadow-lg">🤖</div>
          <div>
            <h3 className="font-black uppercase tracking-widest text-sm">Terminal IA</h3>
            <p className="text-[10px] text-orange-500 uppercase tracking-widest font-black">Sessão Ativa</p>
          </div>
        </div>
        <div className="text-[10px] font-black uppercase text-slate-500 border border-slate-800 px-3 py-1 rounded-full tracking-[0.2em]">Debug Mode</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/50">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-5 rounded-[28px] text-sm font-bold shadow-sm ${
              m.role === 'user' 
                ? 'bg-orange-500 text-white rounded-tr-none' 
                : 'bg-white text-black border-2 border-slate-100 rounded-tl-none'
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white p-4 rounded-[20px] border-2 border-slate-100 animate-pulse text-[10px] font-black uppercase text-slate-400">
              IA está processando...
            </div>
          </div>
        )}
      </div>

      <div className="p-8 border-t-2 border-slate-100 bg-white">
        <div className="flex space-x-4">
          <input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Digite sua mensagem para o Agente..."
            className="flex-1 bg-slate-50 p-5 rounded-[24px] outline-none border-2 border-transparent focus:border-orange-500 transition-all font-bold text-sm"
          />
          <button 
            onClick={handleSend}
            disabled={loading}
            className="bg-black text-white w-14 h-14 rounded-[24px] flex items-center justify-center shadow-xl hover:bg-orange-500 transition-all disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIChatSimulator;
