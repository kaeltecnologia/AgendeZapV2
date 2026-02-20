
import React, { useEffect, useRef, useState } from 'react';
import { evolutionService } from '../services/evolutionService';
import { processWhatsAppMessage } from '../services/geminiService';
import { db } from '../services/mockDb';

const AiPollingManager: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [isPolling, setIsPolling] = useState(false);
  const [aiActive, setAiActive] = useState(false);
  const [dbOnline, setDbOnline] = useState(false);
  const [logs, setLogs] = useState<{msg: string, type: string}[]>([]);
  const [isTesting, setIsTesting] = useState(false);
  const [currentInstance, setCurrentInstance] = useState('');
  
  const processedIds = useRef<Set<string>>(new Set());

  const dispatchDebug = (type: string, message: string) => {
    const time = new Date().toLocaleTimeString('pt-BR');
    setLogs(prev => [{ msg: `[${time}] ${message}`, type }, ...prev].slice(0, 50));
  };

  const checkStatus = async () => {
    if (!tenantId) return false;
    const settings = await db.getSettings(tenantId);
    setAiActive(settings.aiActive);
    setDbOnline(db.isOnline());
    return settings.aiActive;
  };

  const handleTestAi = async () => {
    setIsTesting(true);
    dispatchDebug('INFO', 'Iniciando Pulso de Teste...');
    try {
      const result = await processWhatsAppMessage(tenantId, '5511999999999', 'Teste', 'Olá, quais serviços vocês oferecem?');
      if (result.replyText) {
        dispatchDebug('SUCCESS', `Gemini respondeu: "${result.replyText.substring(0, 30)}..."`);
      } else {
        dispatchDebug('ERROR', 'Gemini retornou vazio. Verifique a API_KEY.');
      }
    } catch (e: any) {
      dispatchDebug('ERROR', `Erro Gemini: ${e.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const poll = async () => {
    try {
      const active = await checkStatus();
      if (!active) {
        if (isPolling) {
          dispatchDebug('WARN', 'Monitoramento pausado (IA desligada)');
          setIsPolling(false);
        }
        return;
      }

      const tenants = await db.getAllTenants();
      // Tenta achar por ID ou Slug para ser resiliente
      const tenant = tenants.find(t => t.id === tenantId || t.slug === tenantId);
      if (!tenant) return;

      const instanceName = evolutionService.getInstanceName(tenant.slug);
      setCurrentInstance(instanceName);

      const connectionStatus = await evolutionService.checkStatus(instanceName);
      
      if (connectionStatus !== 'open') {
        if (isPolling) {
          dispatchDebug('ERROR', `Instância [${instanceName}] offline no WhatsApp`);
          setIsPolling(false);
        }
        return;
      }

      if (!isPolling) {
        setIsPolling(true);
        dispatchDebug('INFO', `Monitorando Instância: ${instanceName}`);
      }

      const messages = await evolutionService.fetchRecentMessages(instanceName, 10);
      if (!messages || !Array.isArray(messages)) return;

      const sortedMessages = [...messages].sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

      for (const msg of sortedMessages) {
        const msgId = msg.key?.id;
        const msgTimestamp = msg.messageTimestamp || msg.timestamp;

        if (!msgId || processedIds.current.has(msgId)) continue;
        
        const hourAgo = Math.floor(Date.now() / 1000) - 3600;
        if (msg.key?.fromMe || (msgTimestamp && msgTimestamp < hourAgo)) {
          processedIds.current.add(msgId);
          continue;
        }

        const text = 
          msg.message?.conversation || 
          msg.message?.extendedTextMessage?.text || 
          msg.content || 
          msg.text || 
          "";
        
        if (text && text.trim().length > 0) {
          processedIds.current.add(msgId); 
          const remoteJid = msg.key?.remoteJid || '';
          const cleanPhone = remoteJid.replace(/@.*/, '').replace(/\D/g, '');

          if (!cleanPhone) continue;

          dispatchDebug('INFO', `Mensagem de ${cleanPhone} capturada via ${instanceName}`);
          
          try {
            const result = await processWhatsAppMessage(tenantId, cleanPhone, msg.pushName || "Cliente", text);
            
            if (result.replyText && result.replyText.trim() !== "") {
              const sendResult = await evolutionService.sendToWhatsApp(instanceName, cleanPhone, result.replyText);
              if (sendResult.success) {
                dispatchDebug('SUCCESS', `IA respondeu para ${cleanPhone}`);
              } else {
                dispatchDebug('ERROR', `Erro no envio via ${instanceName}`);
              }
            }
          } catch (error: any) {
            dispatchDebug('ERROR', `Processamento Gemini: ${error.message}`);
          }
        }
      }
    } catch (err: any) {
      // Silencioso
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    checkStatus();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [tenantId]);

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col items-end space-y-4 pointer-events-none">
      <div className="group relative pointer-events-auto">
        <div className={`p-4 rounded-3xl border-2 shadow-2xl transition-all duration-500 flex items-center space-x-4 bg-black ${aiActive ? 'border-orange-500' : 'border-slate-800'}`}>
          <div className={`w-3 h-3 rounded-full ${aiActive ? 'bg-orange-500 animate-pulse' : 'bg-slate-600'}`}></div>
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-white uppercase tracking-widest">
              IA AGENDEZAP {aiActive ? 'ON' : 'OFF'}
            </span>
            <span className={`text-[8px] font-bold uppercase tracking-widest ${dbOnline ? 'text-green-500' : 'text-orange-500'}`}>
              DB: {dbOnline ? 'SUPABASE' : 'LOCAL'}
            </span>
          </div>
        </div>
        
        <div className="absolute bottom-full right-0 mb-4 w-[460px] bg-white border-2 border-black rounded-[30px] p-6 opacity-0 group-hover:opacity-100 pointer-events-none transition-all shadow-2xl translate-y-2 group-hover:translate-y-0 max-h-[500px] overflow-hidden flex flex-col">
           <div className="flex justify-between items-center mb-4 border-b-2 border-slate-50 pb-2">
              <div className="flex flex-col">
                <h4 className="text-[10px] font-black text-black uppercase tracking-widest">Logs em Tempo Real</h4>
                <p className="text-[8px] font-bold text-slate-400 uppercase">Instância: {currentInstance || '...'}</p>
              </div>
              <div className="flex items-center space-x-3 pointer-events-auto">
                <button 
                  onClick={handleTestAi} 
                  disabled={isTesting}
                  className={`text-[8px] font-black uppercase px-3 py-1.5 rounded-lg border-2 transition-all border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white`}
                >
                  {isTesting ? 'PROCESSANDO...' : 'TESTAR IA'}
                </button>
                <button onClick={() => setLogs([])} className="text-[8px] font-black text-slate-300 uppercase hover:text-red-500 transition-all">Limpar</button>
              </div>
           </div>
           <div className="space-y-2 overflow-y-auto custom-scrollbar flex-1">
              {logs.map((log, i) => (
                <div key={i} className={`p-3 rounded-xl text-[9px] font-bold border animate-fadeIn ${
                  log.type === 'ERROR' ? 'bg-red-50 text-red-600 border-red-100' : 
                  log.type === 'SUCCESS' ? 'bg-green-50 text-green-600 border-green-100' : 
                  log.type === 'WARN' ? 'bg-orange-50 text-orange-600 border-orange-100' : 
                  'bg-slate-50 text-slate-500 border-slate-100'
                }`}>
                  {log.msg}
                </div>
              ))}
              {logs.length === 0 && <p className="text-center py-10 text-slate-300 italic text-[9px] uppercase font-black">Aguardando interação no WhatsApp...</p>}
           </div>
        </div>
      </div>
    </div>
  );
};

export default AiPollingManager;
