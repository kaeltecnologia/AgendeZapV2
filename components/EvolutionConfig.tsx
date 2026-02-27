
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { evolutionService } from '../services/evolutionService';
import { db } from '../services/mockDb';

interface LogEntry {
  timestamp: string;
  type: 'POLLING' | 'GEMINI' | 'SUCCESS' | 'ERROR' | 'INFO';
  message: string;
}

const EvolutionConfig: React.FC<{ tenantId: string; tenantSlug?: string }> = ({ tenantId, tenantSlug }) => {
  const [instanceStatus, setInstanceStatus] = useState<'open' | 'close' | 'connecting' | 'idle'>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [instanceName, setInstanceName] = useState('');
  
  const logContainerRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((type: LogEntry['type'], message: string) => {
    const newLog: LogEntry = {
      timestamp: new Date().toLocaleTimeString('pt-BR'),
      type,
      message
    };
    setLogs(prev => [newLog, ...prev].slice(0, 50));
  }, []);

  const refreshInstanceInfo = useCallback(async () => {
    try {
      // Prioriza o slug passado via props (que vem do login/registro)
      if (tenantSlug) {
        const name = evolutionService.getInstanceName(tenantSlug);
        setInstanceName(name);
        return name;
      }

      const tenants = await db.getAllTenants();
      const tenant = tenants.find(t => t.id === tenantId || t.slug === tenantId);
      
      if (tenant) {
        const name = evolutionService.getInstanceName(tenant.slug);
        setInstanceName(name);
        return name;
      }
      
      return '';
    } catch (e) {
      console.error("Erro ao identificar barbearia:", e);
      return '';
    }
  }, [tenantId, tenantSlug]);

  const handleConnect = useCallback(async (forceReset: boolean = false) => {
    if (loading) return;
    
    setLoading(true);
    setError(null);
    setQrCode(null);
    
    try {
      const name = await refreshInstanceInfo();
      if (!name) {
        throw new Error("Falha Crítica: Não conseguimos identificar o slug da sua barbearia. Tente sair e entrar novamente.");
      }

      if (forceReset) {
        addLog('INFO', `Deletando instância antiga ${name} para reset...`);
        await evolutionService.deleteInstance(name);
        await new Promise(r => setTimeout(r, 3000));
      }

      addLog('INFO', `Conectando instância: ${name}`);
      const result = await evolutionService.createAndFetchQr(name);

      if (result.status === 'success') {
        // Always disable the external webhook right after connect/restart,
        // since Evolution API may restore the previously configured webhook URL.
        evolutionService.disableWebhook(name).catch(() => {});
        addLog('INFO', 'Webhook externo desativado — usando polling local.');

        if (result.qrcode) {
          setQrCode(result.qrcode);
          setInstanceStatus('connecting');
          addLog('SUCCESS', "QR Code gerado! Abra o WhatsApp e escaneie agora.");
        } else if (result.message === 'Conectado.') {
          setInstanceStatus('open');
          addLog('SUCCESS', "Instância já estava conectada no servidor.");
        }
      } else {
        setError(result.message);
        addLog('ERROR', result.message);
      }
    } catch (e: any) {
      setError(e.message);
      addLog('ERROR', e.message || "Erro de sincronização com o servidor Evolution.");
    } finally {
      setLoading(false);
    }
  }, [loading, tenantId, addLog, refreshInstanceInfo]);

  useEffect(() => {
    let mounted = true;
    let lastStatus = '';

    const check = async () => {
      const name = await refreshInstanceInfo();
      if (!name || !mounted) return;
      const status = await evolutionService.checkStatus(name);
      if (!mounted) return;
      setInstanceStatus(status);

      // When connection (re)opens, immediately disable the external webhook.
      // Evolution API may restore a previously configured webhook URL on reconnect.
      if (status === 'open' && lastStatus !== 'open') {
        evolutionService.disableWebhook(name).catch(() => {});
      }
      lastStatus = status;
    };

    check();
    const interval = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [tenantId, refreshInstanceInfo]);

  return (
    <div className="space-y-10 animate-fadeIn max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight italic">Conexão WhatsApp</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Instância Dedicada: <span className="text-orange-500 font-black">{instanceName || 'VINCULANDO...'}</span>
          </p>
        </div>
        <div className={`px-4 py-2 rounded-xl border-2 flex items-center space-x-3 transition-all ${instanceStatus === 'open' ? 'border-green-100 bg-green-50 shadow-lg shadow-green-100/50' : 'border-slate-100 bg-white'}`}>
          <div className={`w-2 h-2 rounded-full ${instanceStatus === 'open' ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
          <span className="text-[10px] font-black uppercase text-slate-500">{instanceStatus === 'open' ? 'ESTABELECIDA' : 'DESCONECTADA'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="bg-white p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 flex flex-col items-center space-y-10">
          <div className="w-full">
            <h3 className="text-[10px] font-black text-black uppercase tracking-[0.2em] mb-4 border-b-2 border-orange-500 w-fit pb-1">Instruções de Emparelhamento</h3>
            <p className="text-xs text-slate-400 font-bold leading-relaxed">
              Abra o WhatsApp no seu celular &gt; Configurações &gt; Dispositivos Conectados &gt; Conectar um dispositivo e aponte a câmera.
            </p>
          </div>

          <div className="relative group">
            {instanceStatus === 'open' ? (
              <div className="w-56 h-56 bg-green-50 rounded-[40px] flex flex-col items-center justify-center shadow-inner border-2 border-green-100 animate-fadeIn">
                <span className="text-6xl mb-4">✅</span>
                <span className="text-[10px] font-black text-green-600 uppercase tracking-widest">Ativo</span>
              </div>
            ) : qrCode ? (
              <div className="p-5 bg-white border-4 border-black rounded-[40px] shadow-2xl animate-scaleUp">
                <img src={qrCode.startsWith('data:image') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code Evolution" className="w-48 h-48" />
              </div>
            ) : (
              <div className="w-56 h-56 bg-slate-50 rounded-[40px] flex items-center justify-center text-4xl grayscale opacity-30 border-2 border-dashed border-slate-200">
                <span className="animate-pulse">💤</span>
              </div>
            )}
            
            {loading && (
              <div className="absolute inset-0 bg-white/90 backdrop-blur-sm rounded-[40px] flex items-center justify-center z-10">
                <div className="w-10 h-10 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin"></div>
              </div>
            )}
          </div>

          <div className="w-full space-y-4">
            <button
              onClick={() => handleConnect(false)}
              disabled={loading || instanceStatus === 'open'}
              className={`w-full py-5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl active:scale-95 ${instanceStatus === 'open' ? 'bg-slate-100 text-slate-400 cursor-default' : 'bg-orange-500 text-white hover:bg-black shadow-orange-100'}`}
            >
              {loading ? 'SINCRONIZANDO...' : instanceStatus === 'open' ? 'CONEXÃO ATIVA' : 'SOLICITAR QR CODE'}
            </button>

            {tenantSlug && (
              <button
                onClick={() => {
                  const url = `${window.location.origin}${window.location.pathname}#/agendar/${tenantSlug}`;
                  window.open(url, '_blank');
                }}
                className="w-full bg-white border-2 border-slate-100 text-slate-600 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:border-orange-500 hover:text-orange-500 transition-all flex items-center justify-center gap-2"
              >
                <span>🔗</span>
                <span>Ver Link Web de Agendamento</span>
              </button>
            )}

            <button
              onClick={() => { if(confirm("Isso apagará a instância atual e criará uma nova. Deseja continuar?")) handleConnect(true); }}
              className="w-full bg-white text-slate-300 py-3 rounded-2xl font-black text-[9px] uppercase tracking-widest hover:text-red-500 hover:border-red-100 transition-all border-2 border-slate-50"
            >
              Reiniciar Instância (Limpeza Total)
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border-2 border-red-100 p-6 rounded-[30px] w-full animate-fadeIn">
              <p className="text-red-600 text-[10px] font-black uppercase text-center leading-relaxed tracking-widest">
                ⚠️ {error}
              </p>
            </div>
          )}
        </div>

        <div className="bg-black p-10 rounded-[50px] shadow-2xl flex flex-col h-[600px] border-4 border-slate-900">
           <div className="flex justify-between items-center mb-8">
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                <h3 className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em]">Console de Integração</h3>
              </div>
              <button onClick={() => setLogs([])} className="text-[9px] font-black text-slate-600 uppercase hover:text-white transition-colors">Limpar Logs</button>
           </div>
           <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
              {logs.map((log, i) => (
                <div key={i} className="font-mono text-[10px] leading-relaxed animate-fadeIn border-l-2 border-slate-800 pl-4 py-1">
                   <div className="flex justify-between mb-1">
                     <span className={log.type === 'ERROR' ? 'text-red-500 font-black' : log.type === 'SUCCESS' ? 'text-green-500 font-black' : 'text-orange-500 font-black'}>{log.type}</span>
                     <span className="text-slate-700 text-[8px]">{log.timestamp}</span>
                   </div>
                   <div className="text-slate-300 break-words">{log.message}</div>
                </div>
              ))}
              {logs.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-slate-800 opacity-50">
                   <span className="text-4xl mb-4">🖥️</span>
                   <p className="font-mono text-[9px] uppercase font-black tracking-widest text-center">Aguardando comandos do sistema...</p>
                </div>
              )}
           </div>
        </div>
      </div>
    </div>
  );
};

export default EvolutionConfig;
