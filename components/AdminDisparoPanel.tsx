import React, { useState, useRef, useEffect } from 'react';
import { evolutionService } from '../services/evolutionService';
import { ProspectCampaign } from '../services/serperService';

// ── Helpers ──────────────────────────────────────────────────────────
const randRange = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const formatSeconds = (s: number) => {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

interface BroadcastProgress {
  sent: number;
  total: number;
  currentName: string;
  pausing: boolean;
  pauseSecondsLeft: number;
  nextDelay: number;
  done: boolean;
  stopped: boolean;
  errors: number;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
}

interface Props {
  adminInstanceName: string;
  adminConnected: boolean;
  campaigns: ProspectCampaign[];
  initialCampaignId?: string;
  onGoToConexao: () => void;
}

const AdminDisparoPanel: React.FC<Props> = ({
  adminInstanceName,
  adminConnected,
  campaigns,
  initialCampaignId,
  onGoToConexao,
}) => {
  // Source
  const [source, setSource] = useState<'campaign' | 'custom'>('campaign');
  const [selectedCampaignId, setSelectedCampaignId] = useState(initialCampaignId || '');
  const [customText, setCustomText] = useState('');

  // Messages
  const [messages, setMessages] = useState<string[]>(['']);

  // Timing
  const [delayMin, setDelayMin] = useState(30);
  const [delayMax, setDelayMax] = useState(60);
  const [pauseEvery, setPauseEvery] = useState(20);
  const [pauseMin, setPauseMin] = useState(120);
  const [pauseMax, setPauseMax] = useState(300);

  // Progress
  const [progress, setProgress] = useState<BroadcastProgress | null>(null);
  const abortRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When initialCampaignId changes (navigate from prospecção), update selection
  useEffect(() => {
    if (initialCampaignId) {
      setSelectedCampaignId(initialCampaignId);
      setSource('campaign');
    }
  }, [initialCampaignId]);

  // ── Derived contacts ────────────────────────────────────────────────
  const contacts: Contact[] = React.useMemo(() => {
    if (source === 'campaign') {
      const camp = campaigns.find(c => c.id === selectedCampaignId);
      return camp ? camp.contacts.filter(c => c.phone) : [];
    }
    // Custom: one per line, format "Nome: 55111234" or just "55111234"
    return customText
      .split('\n')
      .map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx > 0) {
          const name = trimmed.slice(0, colonIdx).trim();
          const phone = trimmed.slice(colonIdx + 1).replace(/\D/g, '');
          if (phone.length >= 10) return { id: `custom-${i}`, name, phone };
        }
        const phone = trimmed.replace(/\D/g, '');
        if (phone.length >= 10) return { id: `custom-${i}`, name: phone, phone };
        return null;
      })
      .filter(Boolean) as Contact[];
  }, [source, selectedCampaignId, campaigns, customText]);

  // ── Message helpers ─────────────────────────────────────────────────
  const updateMsg = (i: number, val: string) =>
    setMessages(prev => { const n = [...prev]; n[i] = val; return n; });
  const addMsg = () => { if (messages.length < 5) setMessages(prev => [...prev, '']); };
  const removeMsg = (i: number) => setMessages(prev => prev.filter((_, idx) => idx !== i));
  const activeMessages = messages.filter(m => m.trim());

  // ── Broadcast ────────────────────────────────────────────────────────
  const startBroadcast = async () => {
    if (!adminConnected) { alert('WhatsApp do admin não está conectado!\nVá em Conversas para conectar.'); return; }
    if (activeMessages.length === 0) { alert('Adicione pelo menos uma mensagem.'); return; }
    if (contacts.length === 0) { alert('Nenhum contato selecionado.'); return; }
    if (delayMin > delayMax) { alert('Delay mínimo deve ser ≤ delay máximo.'); return; }

    abortRef.current = false;
    let sentCount = 0;
    let errorCount = 0;

    setProgress({
      sent: 0, total: contacts.length, currentName: '', pausing: false,
      pauseSecondsLeft: 0, nextDelay: 0, done: false, stopped: false, errors: 0,
    });

    for (let i = 0; i < contacts.length; i++) {
      if (abortRef.current) {
        setProgress(p => p ? { ...p, stopped: true } : null);
        break;
      }

      const contact = contacts[i];
      const msg = activeMessages[sentCount % activeMessages.length];
      setProgress(p => p ? { ...p, currentName: contact.name } : null);

      try {
        await evolutionService.sendMessage(adminInstanceName, contact.phone, msg);
        sentCount++;
      } catch {
        errorCount++;
        sentCount++;
      }

      setProgress(p => p ? { ...p, sent: sentCount, errors: errorCount } : null);

      if (i < contacts.length - 1) {
        const shouldPause = pauseEvery > 0 && sentCount % pauseEvery === 0;

        if (shouldPause) {
          const pauseSecs = randRange(pauseMin, pauseMax);
          let remaining = pauseSecs;
          setProgress(p => p ? { ...p, pausing: true, pauseSecondsLeft: remaining } : null);

          await new Promise<void>(resolve => {
            const tick = setInterval(() => {
              if (abortRef.current) { clearInterval(tick); resolve(); return; }
              remaining--;
              setProgress(p => p ? { ...p, pauseSecondsLeft: remaining } : null);
              if (remaining <= 0) { clearInterval(tick); resolve(); }
            }, 1000);
            pauseTimerRef.current = tick;
          });

          setProgress(p => p ? { ...p, pausing: false, pauseSecondsLeft: 0 } : null);
        } else {
          const delaySecs = randRange(delayMin, delayMax);
          setProgress(p => p ? { ...p, nextDelay: delaySecs } : null);

          let remaining = delaySecs;
          await new Promise<void>(resolve => {
            const tick = setInterval(() => {
              if (abortRef.current) { clearInterval(tick); resolve(); return; }
              remaining--;
              setProgress(p => p ? { ...p, nextDelay: remaining } : null);
              if (remaining <= 0) { clearInterval(tick); resolve(); }
            }, 1000);
          });
        }
      }
    }

    if (!abortRef.current) {
      setProgress(p => p ? { ...p, done: true, pausing: false, nextDelay: 0 } : null);
    }
  };

  const stopBroadcast = () => {
    abortRef.current = true;
    if (pauseTimerRef.current) clearInterval(pauseTimerRef.current);
  };

  const resetBroadcast = () => {
    abortRef.current = false;
    setProgress(null);
  };

  const isSending = progress !== null && !progress.done && !progress.stopped;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Disparador Admin</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Envio em massa para contatos prospectados ou personalizados
          </p>
        </div>
        {adminConnected ? (
          <div className="bg-green-50 border-2 border-green-100 px-5 py-3 rounded-2xl">
            <p className="text-[10px] font-black text-green-600 uppercase">● WhatsApp Admin Conectado</p>
          </div>
        ) : (
          <button
            onClick={onGoToConexao}
            className="bg-red-50 border-2 border-red-100 px-5 py-3 rounded-2xl hover:bg-red-100 transition-all"
          >
            <p className="text-[10px] font-black text-red-600 uppercase">⚠ WhatsApp desconectado — conectar</p>
          </button>
        )}
      </div>

      {/* Progress */}
      {progress && (
        <div className={`rounded-[28px] p-8 border-2 space-y-4 ${
          progress.done ? 'bg-green-50 border-green-100' :
          progress.stopped ? 'bg-red-50 border-red-100' :
          'bg-orange-50 border-orange-100'
        }`}>
          <div className="flex justify-between items-start">
            <div>
              <p className={`text-lg font-black uppercase tracking-tight ${
                progress.done ? 'text-green-700' : progress.stopped ? 'text-red-700' : 'text-orange-700'
              }`}>
                {progress.done ? '✅ Disparo concluído!' : progress.stopped ? '⛔ Disparo interrompido' : '📤 Disparando...'}
              </p>
              {!progress.done && !progress.stopped && (
                <p className="text-xs font-bold text-orange-500 mt-1">
                  {progress.pausing
                    ? `⏸ Intervalo de proteção — retomando em ${formatSeconds(progress.pauseSecondsLeft)}`
                    : `Enviando para *${progress.currentName}* — próximo em ${formatSeconds(progress.nextDelay)}`}
                </p>
              )}
              {progress.errors > 0 && (
                <p className="text-[10px] font-bold text-red-400 mt-1">{progress.errors} erro(s) de envio</p>
              )}
            </div>
            <p className={`text-3xl font-black ${progress.done ? 'text-green-700' : 'text-orange-700'}`}>
              {progress.sent}/{progress.total}
            </p>
          </div>

          <div className="h-3 bg-white rounded-full overflow-hidden border border-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                progress.done ? 'bg-green-500' : progress.stopped ? 'bg-red-400' : 'bg-orange-500'
              }`}
              style={{ width: `${progress.total > 0 ? (progress.sent / progress.total) * 100 : 0}%` }}
            />
          </div>

          <div className="flex gap-3">
            {isSending && (
              <button
                onClick={stopBroadcast}
                className="px-6 py-2.5 bg-red-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-600 transition-all"
              >
                ⛔ Parar
              </button>
            )}
            {(progress.done || progress.stopped) && (
              <button
                onClick={resetBroadcast}
                className="px-6 py-2.5 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all"
              >
                ↺ Novo Disparo
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Contact Source */}
        <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-6 shadow-xl shadow-slate-100/50">
          <h2 className="text-sm font-black text-black uppercase tracking-widest">1. Selecionar Contatos</h2>

          {/* Source toggle */}
          <div className="flex gap-3">
            <button
              onClick={() => setSource('campaign')}
              className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                source === 'campaign' ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:border-black'
              }`}
            >
              📋 Campanha
            </button>
            <button
              onClick={() => setSource('custom')}
              className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${
                source === 'custom' ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:border-black'
              }`}
            >
              ✏️ Personalizado
            </button>
          </div>

          {source === 'campaign' && (
            <div className="space-y-3">
              {campaigns.length === 0 ? (
                <div className="bg-slate-50 rounded-2xl p-6 text-center">
                  <p className="text-xs font-black text-slate-300 uppercase">Nenhuma campanha</p>
                  <p className="text-[10px] font-bold text-slate-300 mt-1">Crie uma campanha na aba Prospecção</p>
                </div>
              ) : (
                <>
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Campanha</label>
                  <select
                    value={selectedCampaignId}
                    onChange={e => setSelectedCampaignId(e.target.value)}
                    disabled={isSending}
                    className="w-full p-3 bg-slate-50 border-2 border-transparent focus:border-orange-500 rounded-2xl text-sm font-semibold outline-none transition-all"
                  >
                    <option value="">— Selecione uma campanha —</option>
                    {campaigns.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.contacts.length} contatos)
                      </option>
                    ))}
                  </select>
                </>
              )}

              {/* Contact preview */}
              {contacts.length > 0 && (
                <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1">
                  {contacts.slice(0, 50).map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-slate-50">
                      <div className="w-7 h-7 bg-orange-100 rounded-xl flex items-center justify-center text-xs flex-shrink-0">
                        {c.name[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black text-black truncate">{c.name}</p>
                        <p className="text-[9px] font-bold text-slate-400">{c.phone}</p>
                      </div>
                    </div>
                  ))}
                  {contacts.length > 50 && (
                    <p className="text-center text-[9px] font-black text-slate-300 uppercase py-2">
                      + {contacts.length - 50} contatos...
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {source === 'custom' && (
            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                Um contato por linha
              </label>
              <p className="text-[9px] font-bold text-slate-300">
                Formato: <span className="font-mono">55119999999</span> ou <span className="font-mono">Nome: 55119999999</span>
              </p>
              <textarea
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                disabled={isSending}
                placeholder={"5511999990001\nJoão: 5511999990002\n5511999990003"}
                rows={10}
                className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-xs font-mono outline-none border-2 border-transparent focus:border-orange-500 transition-all resize-none"
              />
              {contacts.length > 0 && (
                <p className="text-[10px] font-black text-green-600">
                  ✓ {contacts.length} número{contacts.length !== 1 ? 's' : ''} válido{contacts.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: Messages + Timing */}
        <div className="space-y-6">
          {/* Messages */}
          <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-5 shadow-xl shadow-slate-100/50">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-black text-black uppercase tracking-widest">2. Mensagens (até 5)</h2>
              <span className="text-[9px] font-black text-slate-300 uppercase">Rotação automática</span>
            </div>

            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div key={i} className="relative">
                  <div className="absolute top-3 left-3 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-white text-[9px] font-black">{i + 1}</span>
                  </div>
                  <textarea
                    value={msg}
                    onChange={e => updateMsg(i, e.target.value)}
                    placeholder={`Mensagem ${i + 1}...`}
                    rows={3}
                    disabled={isSending}
                    className="w-full pl-10 pr-10 py-3 bg-slate-50 rounded-2xl text-xs font-medium outline-none border-2 border-transparent focus:border-orange-500 transition-all resize-none"
                  />
                  {messages.length > 1 && (
                    <button
                      onClick={() => removeMsg(i)}
                      disabled={isSending}
                      className="absolute top-3 right-3 text-slate-300 hover:text-red-500 font-black text-base leading-none transition-all"
                    >✕</button>
                  )}
                </div>
              ))}
            </div>

            {messages.length < 5 && (
              <button
                onClick={addMsg}
                disabled={isSending}
                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl font-black text-[10px] uppercase tracking-widest text-slate-400 hover:border-orange-400 hover:text-orange-500 transition-all disabled:opacity-50"
              >
                + Adicionar Mensagem
              </button>
            )}
          </div>

          {/* Timing */}
          <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-6 shadow-xl shadow-slate-100/50">
            <h2 className="text-sm font-black text-black uppercase tracking-widest">3. Timing de Envio</h2>

            {/* Delay */}
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Delay entre mensagens</p>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-slate-50 rounded-2xl px-4 py-3 flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase">de</span>
                  <input
                    type="number" min={5} max={3600}
                    value={delayMin}
                    onChange={e => setDelayMin(Math.max(5, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-16 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-400">s</span>
                </div>
                <span className="text-slate-300 font-black">—</span>
                <div className="flex-1 bg-slate-50 rounded-2xl px-4 py-3 flex items-center gap-2">
                  <span className="text-[10px] font-black text-slate-400 uppercase">até</span>
                  <input
                    type="number" min={5} max={3600}
                    value={delayMax}
                    onChange={e => setDelayMax(Math.max(delayMin, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-16 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-400">s</span>
                </div>
              </div>
            </div>

            {/* Pause */}
            <div className="space-y-3">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Intervalo de proteção</p>
              <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-500 uppercase whitespace-nowrap">Pausar após</span>
                  <input
                    type="number" min={1} max={200}
                    value={pauseEvery}
                    onChange={e => setPauseEvery(Math.max(1, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-14 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-500 uppercase">mensagens</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-500 uppercase whitespace-nowrap">Pausar por</span>
                  <input
                    type="number" min={30}
                    value={pauseMin}
                    onChange={e => setPauseMin(Math.max(30, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-14 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-400">—</span>
                  <input
                    type="number" min={pauseMin}
                    value={pauseMax}
                    onChange={e => setPauseMax(Math.max(pauseMin, Number(e.target.value)))}
                    disabled={isSending}
                    className="w-14 text-center bg-white border-2 border-slate-200 rounded-xl py-1 font-black text-sm outline-none focus:border-orange-500"
                  />
                  <span className="text-[10px] font-black text-slate-500 uppercase">s</span>
                </div>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-2">Resumo do Disparo</p>
              <p className="text-[10px] font-bold text-orange-500">
                📤 {contacts.length} destinatários · {activeMessages.length} mensagem{activeMessages.length !== 1 ? 's' : ''} em rotação
              </p>
              <p className="text-[10px] font-bold text-orange-500">
                ⏱ Delay {delayMin}–{delayMax}s · Pausa de {formatSeconds(pauseMin)}–{formatSeconds(pauseMax)} a cada {pauseEvery} msgs
              </p>
              {contacts.length > 0 && (
                <p className="text-[9px] font-bold text-orange-400 mt-1">
                  Tempo estimado mínimo: ~{formatSeconds(contacts.length * delayMin + Math.floor(contacts.length / pauseEvery) * pauseMin)}
                </p>
              )}
            </div>

            {/* Start */}
            {!isSending && !progress && (
              <button
                onClick={startBroadcast}
                disabled={!adminConnected || activeMessages.length === 0 || contacts.length === 0}
                className="w-full py-5 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-200 hover:bg-orange-600 hover:scale-[1.02] transition-all disabled:opacity-40 disabled:scale-100 disabled:shadow-none"
              >
                🚀 Iniciar Disparo — {contacts.length} Contato{contacts.length !== 1 ? 's' : ''}
              </button>
            )}

            {(progress?.done || progress?.stopped) && (
              <button
                onClick={resetBroadcast}
                className="w-full py-5 bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all"
              >
                ↺ Novo Disparo
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDisparoPanel;
