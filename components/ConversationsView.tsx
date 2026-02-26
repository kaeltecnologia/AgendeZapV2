import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { evolutionService } from '../services/evolutionService';
import { supabase } from '../services/supabase';
import { Customer } from '../types';

interface ConvMessage {
  id: string;
  phone: string;
  pushName: string;
  text: string;
  timestamp: number;
  fromMe: boolean;
}

interface Conversation {
  phone: string;
  name: string;
  lastMessage: string;
  lastTimestamp: number;
  isProfessional: boolean;
  professionalName?: string;
  messages: ConvMessage[];
}

const ConversationsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [instanceName, setInstanceName] = useState('');
  const [connected, setConnected] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Reply
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);

  // New conversation modal
  const [showNewConv, setShowNewConv] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [contactSearch, setContactSearch] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const extrairNumero = (msg: any): string | null => {
    const candidatos = [
      msg.key?.remoteJidAlt,
      msg.key?.participantAlt,
      msg.key?.remoteJid,
      msg.participant,
      msg.key?.participant,
    ];
    for (const c of candidatos) {
      if (!c) continue;
      if (c.includes('@lid') || c.includes('@g.us')) continue;
      const numero = c.replace(/@.*/, '').replace(/\D/g, '');
      if (numero.length >= 10 && numero.length <= 13) return numero;
    }
    return null;
  };

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data: tenants } = await supabase.from('tenants').select('*');
      const tenant = (tenants || []).find((t: any) => t.id === tenantId || t.slug === tenantId);
      if (!tenant) return;

      const inst = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
      setInstanceName(inst);

      const status = await evolutionService.checkStatus(inst);
      setConnected(status === 'open');
      if (status !== 'open') return;

      const [rawMessages, professionals, custs] = await Promise.all([
        evolutionService.fetchRecentMessages(inst, 60),
        db.getProfessionals(tenantId),
        db.getCustomers(tenantId),
      ]);
      setCustomers(custs);

      if (!rawMessages || !Array.isArray(rawMessages)) return;

      const phonesMatch = (stored: string, incoming: string) => {
        const a = stored.replace(/\D/g, '');
        const b = incoming.replace(/\D/g, '');
        if (!a || !b) return false;
        if (a === b) return true;
        if (a.slice(-11) === b.slice(-11) && b.slice(-11).length >= 10) return true;
        if (a.slice(-10) === b.slice(-10) && b.slice(-10).length >= 10) return true;
        return false;
      };

      const convMap = new Map<string, Conversation>();
      const sorted = [...rawMessages].sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

      for (const msg of sorted) {
        const remoteJid = msg.key?.remoteJid || '';
        if (remoteJid.includes('@g.us')) continue;

        const phone = extrairNumero(msg);
        if (!phone) continue;

        const text =
          msg.message?.conversation ||
          msg.message?.extendedTextMessage?.text ||
          msg.body || msg.text || '';
        if (!text.trim()) continue;

        const ts = msg.messageTimestamp || 0;
        const fromMe = !!msg.key?.fromMe;
        const pushName = msg.pushName || phone;

        const matchedProf = professionals.find((p: any) => phonesMatch(p.phone || '', phone));
        const matchedCust = custs.find(c => phonesMatch(c.phone, phone));

        const newMsg: ConvMessage = {
          id: msg.key?.id || `${phone}-${ts}`,
          phone, pushName, text, timestamp: ts, fromMe,
        };

        const existing = convMap.get(phone);
        if (existing) {
          existing.messages.push(newMsg);
          existing.lastMessage = text;
          existing.lastTimestamp = ts;
          if (!fromMe) existing.name = pushName || existing.name;
        } else {
          convMap.set(phone, {
            phone,
            name: matchedCust?.name || matchedProf?.name || pushName || phone,
            lastMessage: text,
            lastTimestamp: ts,
            isProfessional: !!matchedProf,
            professionalName: matchedProf?.name,
            messages: [newMsg],
          });
        }
      }

      setConversations(prev => {
        const next = Array.from(convMap.values()).sort((a, b) => b.lastTimestamp - a.lastTimestamp);
        // Preserve any locally-sent messages in the existing conversations
        return next.map(conv => {
          const old = prev.find(c => c.phone === conv.phone);
          if (!old) return conv;
          // Merge: keep messages from API + any locally added ones not in the API set
          const apiIds = new Set(conv.messages.map(m => m.id));
          const localOnly = old.messages.filter(m => !apiIds.has(m.id));
          return { ...conv, messages: [...conv.messages, ...localOnly].sort((a, b) => a.timestamp - b.timestamp) };
        });
      });
    } catch (e) {
      console.error('ConversationsView error:', e);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedPhone, conversations]);

  const selectedConv = conversations.find(c => c.phone === selectedPhone);

  const filtered = conversations.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

  const filteredContacts = customers.filter(c =>
    c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.phone.includes(contactSearch)
  );

  const formatTime = (ts: number) => {
    if (!ts) return '';
    return new Date(ts * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

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
    if (!replyText.trim() || !selectedPhone || !instanceName || sending) return;
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
    } catch (e) {
      console.error('Send error:', e);
      setReplyText(msgText); // restore on error
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  const openContact = (phone: string, name: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    const existing = conversations.find(c => c.phone === cleanPhone || c.phone.slice(-11) === cleanPhone.slice(-11));
    if (existing) {
      setSelectedPhone(existing.phone);
    } else {
      // Create a virtual conversation
      const newConv: Conversation = {
        phone: cleanPhone,
        name,
        lastMessage: '',
        lastTimestamp: 0,
        isProfessional: false,
        messages: [],
      };
      setConversations(prev => [newConv, ...prev]);
      setSelectedPhone(cleanPhone);
    }
    setShowNewConv(false);
    setContactSearch('');
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Conversas</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            {instanceName || '...'}
            {connected
              ? <span className="text-green-500 ml-2">● Online</span>
              : <span className="text-red-500 ml-2">● Offline</span>}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="bg-black text-white px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50"
        >
          {loading ? 'Carregando...' : '↺ Atualizar'}
        </button>
      </div>

      {!connected && !loading && (
        <div className="bg-red-50 border-2 border-red-100 rounded-[24px] p-8 text-center">
          <p className="text-sm font-black text-red-600 uppercase">WhatsApp desconectado</p>
          <p className="text-xs font-bold text-red-400 mt-1">Conecte em Integrações → WhatsApp</p>
        </div>
      )}

      {connected && (
        <div
          className="bg-white border-2 border-slate-100 rounded-[30px] overflow-hidden shadow-xl shadow-slate-100/50"
          style={{ height: 'calc(100vh - 240px)', minHeight: '500px' }}
        >
          <div className="flex h-full">
            {/* ── Sidebar ──────────────────────── */}
            <div className="w-80 border-r-2 border-slate-100 flex flex-col flex-shrink-0">
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
                    className={`w-full text-left px-4 py-3.5 border-b border-slate-50 hover:bg-slate-50 transition-all ${selectedPhone === conv.phone ? 'bg-orange-50 border-l-[3px] border-l-orange-500' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0 ${conv.isProfessional ? 'bg-orange-100' : 'bg-slate-100'}`}>
                        {conv.isProfessional ? '💈' : '👤'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline gap-1">
                          <span className="text-[11px] font-black text-black truncate">
                            {conv.professionalName || conv.name}
                          </span>
                          <span className="text-[9px] font-bold text-slate-400 flex-shrink-0">{formatDateLabel(conv.lastTimestamp)}</span>
                        </div>
                        {conv.isProfessional && (
                          <span className="text-[8px] font-black text-orange-500 uppercase tracking-widest">Barbeiro</span>
                        )}
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{conv.lastMessage}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Message Panel ────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
              {!selectedConv ? (
                <div className="flex-1 flex items-center justify-center text-slate-200">
                  <div className="text-center space-y-3">
                    <div className="text-6xl">💬</div>
                    <p className="text-xs font-black uppercase tracking-widest text-slate-300">Selecione uma conversa</p>
                    <p className="text-[10px] font-bold text-slate-200">ou clique em + Nova Mensagem</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Contact header */}
                  <div className="px-6 py-4 border-b-2 border-slate-100 flex items-center gap-4 flex-shrink-0">
                    <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-xl ${selectedConv.isProfessional ? 'bg-orange-100' : 'bg-slate-100'}`}>
                      {selectedConv.isProfessional ? '💈' : '👤'}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-black text-black">{selectedConv.professionalName || selectedConv.name}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{selectedConv.phone}</p>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-2 bg-slate-50/30">
                    {selectedConv.messages.length === 0 && (
                      <div className="h-full flex items-center justify-center">
                        <p className="text-xs font-black text-slate-200 uppercase">Nenhuma mensagem ainda. Envie a primeira!</p>
                      </div>
                    )}
                    {selectedConv.messages.map((msg, i) => {
                      // Group date separator
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
                              <p className="whitespace-pre-wrap leading-relaxed break-words">{msg.text}</p>
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

                  {/* Reply box */}
                  <div className="flex-shrink-0 px-4 py-3 border-t-2 border-slate-100 bg-white">
                    <div className="flex gap-2 items-end">
                      <textarea
                        ref={textareaRef}
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendReply();
                          }
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

      {/* ── New Conversation Modal ─────────────── */}
      {showNewConv && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-md p-8 space-y-6 animate-scaleUp shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">Nova Mensagem</h2>
              <button onClick={() => { setShowNewConv(false); setContactSearch(''); }} className="text-slate-300 hover:text-red-500 font-black text-xl">✕</button>
            </div>

            <input
              placeholder="Buscar por nome ou telefone..."
              value={contactSearch}
              onChange={e => setContactSearch(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
            />

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 min-h-0">
              {filteredContacts.length === 0 && (
                <p className="text-center text-slate-300 text-xs font-black uppercase py-8">Nenhum cliente encontrado</p>
              )}
              {filteredContacts.slice(0, 30).map(c => (
                <button
                  key={c.id}
                  onClick={() => openContact(c.phone, c.name)}
                  className="w-full text-left flex items-center gap-4 px-4 py-3 rounded-2xl hover:bg-orange-50 hover:border-orange-200 border-2 border-transparent transition-all"
                >
                  <div className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center text-base flex-shrink-0">👤</div>
                  <div>
                    <p className="text-xs font-black text-black">{c.name}</p>
                    <p className="text-[10px] font-bold text-slate-400">{c.phone}</p>
                  </div>
                </button>
              ))}

              {/* Manual phone entry */}
              {contactSearch.replace(/\D/g, '').length >= 10 && (
                <button
                  onClick={() => openContact(contactSearch.replace(/\D/g, ''), contactSearch)}
                  className="w-full text-left flex items-center gap-4 px-4 py-3 rounded-2xl border-2 border-dashed border-orange-200 hover:bg-orange-50 transition-all"
                >
                  <div className="w-9 h-9 bg-orange-100 rounded-xl flex items-center justify-center text-base flex-shrink-0">📱</div>
                  <div>
                    <p className="text-xs font-black text-black">Enviar para número avulso</p>
                    <p className="text-[10px] font-bold text-orange-500">{contactSearch}</p>
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ConversationsView;
