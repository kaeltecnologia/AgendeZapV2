import React, { useState, useEffect, useCallback, useRef } from 'react';
import { evolutionService } from '../services/evolutionService';
import { saveAdminInstance } from '../services/serperService';

interface ConvMessage {
  id: string;
  phone: string;
  pushName: string;
  text: string;
  timestamp: number;
  fromMe: boolean;
  isAudio?: boolean;
}

interface Conversation {
  phone: string;
  name: string;
  lastMessage: string;
  lastTimestamp: number;
  messages: ConvMessage[];
}

interface Props {
  instanceName: string;
  setInstanceName: (v: string) => void;
  connected: boolean;
  setConnected: (v: boolean) => void;
}

const AdminConversasPanel: React.FC<Props> = ({ instanceName, setInstanceName, connected, setConnected }) => {
  const [qr, setQr] = useState<string | null>(null);
  const [connectingQr, setConnectingQr] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newPhone, setNewPhone] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!instanceName) return;
    evolutionService.checkStatus(instanceName).then(s => setConnected(s === 'open'));
  }, [instanceName, setConnected]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedPhone, conversations]);

  const handleConnect = async () => {
    if (!instanceName.trim()) return;
    setConnectingQr(true);
    setQr(null);
    try {
      const result = await evolutionService.createAndFetchQr(instanceName.trim());
      if (result.status === 'success' && result.qrcode) {
        setQr(result.qrcode);
      } else if (result.status === 'success' && !result.qrcode) {
        setConnected(true);
        setQr(null);
      } else {
        alert(result.message || 'Erro ao gerar QR Code');
      }
    } finally {
      setConnectingQr(false);
    }
  };

  const checkStatus = async () => {
    setCheckingStatus(true);
    try {
      const s = await evolutionService.checkStatus(instanceName);
      setConnected(s === 'open');
      if (s === 'open') setQr(null);
    } finally {
      setCheckingStatus(false);
    }
  };

  const extractPhone = (msg: any): string | null => {
    const candidates = [
      msg.key?.remoteJidAlt,
      msg.key?.participantAlt,
      msg.key?.remoteJid,
      msg.participant,
      msg.key?.participant,
    ];
    for (const c of candidates) {
      if (!c) continue;
      if (c.includes('@lid') || c.includes('@g.us')) continue;
      const num = c.replace(/@.*/, '').replace(/\D/g, '');
      if (num.length >= 10 && num.length <= 13) return num;
    }
    return null;
  };

  const loadConversations = useCallback(async () => {
    if (!instanceName || !connected) return;
    setLoading(true);
    try {
      const raw = await evolutionService.fetchRecentMessages(instanceName, 80);
      if (!raw || !Array.isArray(raw)) return;

      const convMap = new Map<string, Conversation>();
      const sorted = [...raw].sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

      for (const msg of sorted) {
        const remoteJid = msg.key?.remoteJid || '';
        if (remoteJid.includes('@g.us')) continue;
        const phone = extractPhone(msg);
        if (!phone) continue;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.body || msg.text || '';
        const msgType = msg.messageType || msg.type || '';
        const isAudio =
          ['audioMessage', 'pttMessage'].includes(msgType) ||
          !!msg.message?.audioMessage ||
          !!msg.message?.pttMessage;
        if (!text.trim() && !isAudio) continue;

        const ts = msg.messageTimestamp || 0;
        const fromMe = !!msg.key?.fromMe;
        const pushName = msg.pushName || phone;
        const displayText = text.trim() || (isAudio ? '🎵 Áudio' : '');

        const newMsg: ConvMessage = {
          id: msg.key?.id || `${phone}-${ts}`,
          phone, pushName, text: displayText, timestamp: ts, fromMe,
          isAudio: isAudio && !text.trim(),
        };

        const existing = convMap.get(phone);
        if (existing) {
          existing.messages.push(newMsg);
          existing.lastMessage = displayText;
          existing.lastTimestamp = ts;
          if (!fromMe) existing.name = pushName || existing.name;
        } else {
          convMap.set(phone, {
            phone,
            name: pushName || phone,
            lastMessage: displayText,
            lastTimestamp: ts,
            messages: [newMsg],
          });
        }
      }

      setConversations(prev => {
        const next = Array.from(convMap.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        return next.map(conv => {
          const old = prev.find(c => c.phone === conv.phone);
          if (!old) return conv;
          const apiIds = new Set(conv.messages.map(m => m.id));
          const localOnly = old.messages.filter(m => !apiIds.has(m.id));
          return { ...conv, messages: [...conv.messages, ...localOnly].sort((a, b) => a.timestamp - b.timestamp) };
        });
      });
    } catch (e) {
      console.error('AdminConversas load error:', e);
    } finally {
      setLoading(false);
    }
  }, [instanceName, connected]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const selectedConv = conversations.find(c => c.phone === selectedPhone);
  const filtered = conversations.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm)
  );

  const formatTime = (ts: number) =>
    ts ? new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

  const formatDateLabel = (ts: number) => {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return formatTime(ts);
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selectedPhone || sending) return;
    setSending(true);
    const msgText = replyText.trim();
    setReplyText('');
    try {
      await evolutionService.sendMessage(instanceName, selectedPhone, msgText);
      const newMsg: ConvMessage = {
        id: `local-${Date.now()}`,
        phone: selectedPhone,
        pushName: 'Você',
        text: msgText,
        timestamp: Math.floor(Date.now() / 1000),
        fromMe: true,
      };
      setConversations(prev => prev.map(c =>
        c.phone === selectedPhone
          ? { ...c, messages: [...c.messages, newMsg], lastMessage: msgText, lastTimestamp: newMsg.timestamp }
          : c
      ));
    } catch {
      setReplyText(msgText);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const openNewConv = () => {
    const cleanPhone = newPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) return;
    const existing = conversations.find(c =>
      c.phone === cleanPhone || c.phone.slice(-11) === cleanPhone.slice(-11)
    );
    if (existing) {
      setSelectedPhone(existing.phone);
    } else {
      const newConv: Conversation = {
        phone: cleanPhone, name: cleanPhone, lastMessage: '', lastTimestamp: 0, messages: [],
      };
      setConversations(prev => [newConv, ...prev]);
      setSelectedPhone(cleanPhone);
    }
    setShowNewConv(false);
    setNewPhone('');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* ── Connection Panel ─────────────────────────────────────── */}
      <div className="bg-white border-2 border-slate-100 rounded-[28px] p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-sm font-black text-black uppercase tracking-widest">Conexão do Admin</h2>
            <p className="text-[10px] font-bold text-slate-400 mt-0.5">Instância WhatsApp exclusiva do SuperAdmin</p>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 ${connected ? 'bg-green-50 border-green-100 text-green-600' : 'bg-red-50 border-red-100 text-red-500'}`}>
            <div className={`w-2 h-2 rounded-full animate-pulse ${connected ? 'bg-green-500' : 'bg-red-400'}`} />
            <span className="text-[10px] font-black uppercase tracking-widest">{connected ? 'Conectado' : 'Desconectado'}</span>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-[220px] space-y-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Nome da Instância</label>
            <input
              value={instanceName}
              onChange={e => { setInstanceName(e.target.value); saveAdminInstance(e.target.value); }}
              placeholder="agz_superadmin"
              className="w-full px-4 py-2.5 bg-slate-50 border-2 border-transparent focus:border-orange-500 rounded-2xl text-xs font-mono outline-none transition-all"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleConnect}
              disabled={connectingQr || !instanceName.trim()}
              className="px-5 py-2.5 bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-40"
            >
              {connectingQr ? 'Gerando...' : connected ? '↺ Reconectar' : '📱 Conectar'}
            </button>
            <button
              onClick={checkStatus}
              disabled={checkingStatus}
              className="px-5 py-2.5 bg-slate-100 text-slate-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 transition-all disabled:opacity-40"
            >
              {checkingStatus ? '...' : '⟳ Status'}
            </button>
            {connected && (
              <button
                onClick={loadConversations}
                disabled={loading}
                className="px-5 py-2.5 bg-orange-50 text-orange-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-100 transition-all disabled:opacity-40"
              >
                {loading ? '...' : '↺ Mensagens'}
              </button>
            )}
          </div>
        </div>

        {qr && (
          <div className="flex flex-col items-center gap-4 pt-2 border-t border-slate-100">
            <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Escaneie o QR Code com seu WhatsApp</p>
            <div className="p-3 bg-white border-2 border-orange-200 rounded-2xl shadow-xl shadow-orange-100">
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="QR Code"
                className="w-56 h-56 object-contain"
              />
            </div>
            <button
              onClick={checkStatus}
              className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-orange-500 transition-all"
            >
              ✓ Já escaneei — verificar conexão
            </button>
          </div>
        )}
      </div>

      {/* ── Conversations ────────────────────────────────────────── */}
      {!connected && !connectingQr && (
        <div className="bg-red-50 border-2 border-red-100 rounded-[24px] p-8 text-center">
          <p className="text-sm font-black text-red-600 uppercase">WhatsApp desconectado</p>
          <p className="text-xs font-bold text-red-400 mt-1">Clique em "Conectar" acima para gerar o QR Code</p>
        </div>
      )}

      {connected && (
        <div
          className="bg-white border-2 border-slate-100 rounded-[30px] overflow-hidden shadow-xl shadow-slate-100/50"
          style={{ height: 'calc(100vh - 400px)', minHeight: '500px' }}
        >
          <div className="flex h-full">
            {/* Sidebar */}
            <div className="w-72 border-r-2 border-slate-100 flex flex-col flex-shrink-0">
              <div className="p-4 border-b border-slate-100 space-y-2">
                <input
                  placeholder="Buscar conversa..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
                />
                <button
                  onClick={() => setShowNewConv(true)}
                  className="w-full py-2.5 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-600 transition-all"
                >
                  + Nova Mensagem
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {loading && (
                  <div className="p-8 text-center text-slate-300 text-xs font-black uppercase animate-pulse">Carregando...</div>
                )}
                {!loading && filtered.length === 0 && (
                  <div className="p-8 text-center text-slate-300 text-xs font-black uppercase">Nenhuma conversa</div>
                )}
                {filtered.map(conv => (
                  <button
                    key={conv.phone}
                    onClick={() => setSelectedPhone(conv.phone)}
                    className={`w-full text-left px-4 py-3.5 border-b border-slate-50 hover:bg-slate-100 transition-all ${selectedPhone === conv.phone ? 'bg-orange-50 border-l-[3px] border-l-orange-500' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-base flex-shrink-0">👤</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-1">
                          <span className="text-[11px] font-black text-black truncate">{conv.name}</span>
                          <span className="text-[9px] font-bold text-slate-400 flex-shrink-0">{formatDateLabel(conv.lastTimestamp)}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{conv.lastMessage}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Message Panel */}
            <div className="flex-1 flex flex-col min-w-0">
              {!selectedConv ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center space-y-3">
                    <div className="text-6xl">💬</div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-300">Selecione uma conversa</p>
                    <p className="text-[10px] font-bold text-slate-200">ou clique em + Nova Mensagem</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-6 py-4 border-b-2 border-slate-100 flex items-center gap-4 flex-shrink-0">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-xl">👤</div>
                    <div>
                      <p className="text-sm font-black text-black">{selectedConv.name}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{selectedConv.phone}</p>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-2 bg-slate-50/30">
                    {selectedConv.messages.length === 0 && (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-xs font-black text-slate-200 uppercase">Nenhuma mensagem ainda. Envie a primeira!</p>
                      </div>
                    )}
                    {selectedConv.messages.map((msg, i) => {
                      const prevMsg = selectedConv.messages[i - 1];
                      const msgDate = new Date(msg.timestamp * 1000).toDateString();
                      const prevDate = prevMsg ? new Date(prevMsg.timestamp * 1000).toDateString() : null;
                      const showDateSep = msgDate !== prevDate;
                      return (
                        <React.Fragment key={msg.id || i}>
                          {showDateSep && msg.timestamp > 0 && (
                            <div className="flex items-center gap-3 py-2">
                              <div className="flex-1 h-px bg-slate-100" />
                              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest px-2">
                                {new Date(msg.timestamp * 1000).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
                              </span>
                              <div className="flex-1 h-px bg-slate-100" />
                            </div>
                          )}
                          <div className={`flex ${msg.fromMe ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[72%] px-4 py-2.5 rounded-2xl text-xs font-medium shadow-sm ${
                              msg.fromMe
                                ? 'bg-orange-500 text-white rounded-br-sm'
                                : 'bg-white text-black border border-slate-100 rounded-bl-sm'
                            }`}>
                              {msg.isAudio ? (
                                <div className="flex items-center gap-2 py-0.5">
                                  <span className="text-base">🎵</span>
                                  <span className={`text-[10px] font-black uppercase tracking-widest ${msg.fromMe ? 'text-orange-100' : 'text-slate-400'}`}>Áudio</span>
                                </div>
                              ) : (
                                <p className="whitespace-pre-wrap leading-relaxed break-words">{msg.text}</p>
                              )}
                              <p className={`text-[9px] mt-1 text-right font-bold ${msg.fromMe ? 'text-orange-200' : 'text-slate-400'}`}>
                                {formatTime(msg.timestamp)}
                              </p>
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="flex-shrink-0 px-4 py-3 border-t-2 border-slate-100 bg-white">
                    <div className="flex gap-2 items-end">
                      <textarea
                        ref={textareaRef}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); }
                        }}
                        placeholder="Digite sua mensagem... (Enter para enviar, Shift+Enter para nova linha)"
                        rows={2}
                        className="flex-1 px-4 py-3 bg-slate-50 rounded-2xl text-xs font-medium outline-none border-2 border-transparent focus:border-orange-500 transition-all resize-none"
                      />
                      <button
                        onClick={sendReply}
                        disabled={!replyText.trim() || sending}
                        className="px-5 py-3 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-600 transition-all disabled:opacity-40 flex-shrink-0 self-end"
                      >
                        {sending ? '...' : 'Enviar'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Conversation Modal */}
      {showNewConv && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-sm p-8 space-y-6 shadow-2xl">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black text-black uppercase">Nova Mensagem</h2>
              <button
                onClick={() => { setShowNewConv(false); setNewPhone(''); }}
                className="text-slate-300 hover:text-red-500 font-black text-xl"
              >✕</button>
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Número do WhatsApp</label>
              <input
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="5511999999999"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && openNewConv()}
                className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-sm font-mono outline-none border-2 border-transparent focus:border-orange-500 transition-all"
              />
            </div>
            <button
              onClick={openNewConv}
              disabled={newPhone.replace(/\D/g, '').length < 10}
              className="w-full py-3 bg-black text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-40"
            >
              Abrir Conversa
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminConversasPanel;
