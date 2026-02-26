import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { evolutionService } from '../services/evolutionService';
import { supabase } from '../services/supabase';
import { Customer } from '../types';

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

// ─────────────────────────────────────────────────────────────────────

interface BroadcastProgress {
  sent: number;
  total: number;
  currentName: string;
  pausing: boolean;
  pauseSecondsLeft: number;
  nextDelay: number;
  done: boolean;
  stopped: boolean;
}

const BroadcastView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  // Data
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [instanceName, setInstanceName] = useState('');
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filter
  const [filterMode, setFilterMode] = useState<'all' | 'inactive'>('all');
  const [inactiveDays, setInactiveDays] = useState(30);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [listSearch, setListSearch] = useState('');

  // Messages (up to 5)
  const [messages, setMessages] = useState<string[]>(['']);

  // Timing
  const [delayMin, setDelayMin] = useState(30);   // seconds
  const [delayMax, setDelayMax] = useState(60);
  const [pauseEvery, setPauseEvery] = useState(20);
  const [pauseMin, setPauseMin] = useState(120);  // seconds
  const [pauseMax, setPauseMax] = useState(300);

  // State
  const [progress, setProgress] = useState<BroadcastProgress | null>(null);
  const abortRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data: tenants } = await supabase.from('tenants').select('*');
      const tenant = (tenants || []).find((t: any) => t.id === tenantId || t.slug === tenantId);
      if (tenant) {
        const inst = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
        setInstanceName(inst);
        const status = await evolutionService.checkStatus(inst);
        setConnected(status === 'open');
      }
      const [custs, appts] = await Promise.all([
        db.getCustomers(tenantId),
        db.getAppointments(tenantId),
      ]);
      setAllCustomers(custs);
      setAppointments(appts);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // ── Computed customer list based on filter ──────────────────────────
  const filteredCustomers = React.useMemo(() => {
    let list = allCustomers.filter(c => c.phone && c.active !== false);

    if (filterMode === 'inactive') {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - inactiveDays);
      list = list.filter(c => {
        const custAppts = appointments.filter(a => a.customer_id === c.id);
        if (custAppts.length === 0) return true;
        const last = custAppts.sort((a, b) => b.startTime.localeCompare(a.startTime))[0];
        return new Date(last.startTime) < cutoff;
      });
    }

    if (listSearch) {
      list = list.filter(c =>
        c.name.toLowerCase().includes(listSearch.toLowerCase()) ||
        c.phone.includes(listSearch)
      );
    }
    return list;
  }, [allCustomers, appointments, filterMode, inactiveDays, listSearch]);

  // Sync selectedIds when filter changes
  useEffect(() => {
    setSelectedIds(new Set(filteredCustomers.map(c => c.id)));
  }, [filteredCustomers]);

  // ── Message helpers ─────────────────────────────────────────────────
  const updateMsg = (i: number, val: string) => {
    setMessages(prev => { const n = [...prev]; n[i] = val; return n; });
  };
  const addMsg = () => {
    if (messages.length < 5) setMessages(prev => [...prev, '']);
  };
  const removeMsg = (i: number) => {
    setMessages(prev => prev.filter((_, idx) => idx !== i));
  };
  const activeMessages = messages.filter(m => m.trim());

  // ── Selection helpers ───────────────────────────────────────────────
  const toggleCustomer = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const selectAll = () => setSelectedIds(new Set(filteredCustomers.map(c => c.id)));
  const deselectAll = () => setSelectedIds(new Set());

  // ── Broadcast ────────────────────────────────────────────────────────
  const startBroadcast = async () => {
    if (!connected) { alert('WhatsApp não está conectado!'); return; }
    if (activeMessages.length === 0) { alert('Adicione pelo menos uma mensagem.'); return; }
    if (selectedIds.size === 0) { alert('Selecione pelo menos um cliente.'); return; }
    if (delayMin > delayMax) { alert('Delay mínimo deve ser ≤ delay máximo.'); return; }

    abortRef.current = false;
    const recipients = allCustomers.filter(c => selectedIds.has(c.id));
    let sentCount = 0;

    setProgress({ sent: 0, total: recipients.length, currentName: '', pausing: false, pauseSecondsLeft: 0, nextDelay: 0, done: false, stopped: false });

    for (let i = 0; i < recipients.length; i++) {
      if (abortRef.current) {
        setProgress(p => p ? { ...p, stopped: true } : null);
        break;
      }

      const customer = recipients[i];
      if (!customer.phone) continue;

      const msg = activeMessages[sentCount % activeMessages.length];
      setProgress(p => p ? { ...p, currentName: customer.name } : null);

      try {
        await evolutionService.sendMessage(instanceName, customer.phone, msg);
        sentCount++;
      } catch {
        // skip on error, still count
        sentCount++;
      }

      setProgress(p => p ? { ...p, sent: sentCount } : null);

      // Check if we should pause BEFORE the next message
      if (i < recipients.length - 1) {
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

  if (loading) return <div className="p-20 text-center font-black animate-pulse text-slate-400 uppercase tracking-widest text-xs">Carregando...</div>;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Disparador</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
            Mensagens em massa com rotação e delay inteligente
          </p>
        </div>
        {!connected && (
          <div className="bg-red-50 border-2 border-red-100 px-5 py-3 rounded-2xl">
            <p className="text-[10px] font-black text-red-600 uppercase">WhatsApp offline — conecte primeiro</p>
          </div>
        )}
        {connected && (
          <div className="bg-green-50 border-2 border-green-100 px-5 py-3 rounded-2xl">
            <p className="text-[10px] font-black text-green-600 uppercase">● WhatsApp conectado</p>
          </div>
        )}
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────── */}
      {progress && (
        <div className={`rounded-[28px] p-8 border-2 space-y-4 ${progress.done ? 'bg-green-50 border-green-100' : progress.stopped ? 'bg-red-50 border-red-100' : 'bg-orange-50 border-orange-100'}`}>
          <div className="flex justify-between items-center">
            <div>
              <p className={`text-lg font-black uppercase tracking-tight ${progress.done ? 'text-green-700' : progress.stopped ? 'text-red-700' : 'text-orange-700'}`}>
                {progress.done ? '✅ Disparo concluído!' : progress.stopped ? '⛔ Disparo interrompido' : '📤 Disparando...'}
              </p>
              {!progress.done && !progress.stopped && (
                <p className="text-xs font-bold text-orange-500 mt-1">
                  {progress.pausing
                    ? `⏸ Intervalo de proteção — retomando em ${formatSeconds(progress.pauseSecondsLeft)}`
                    : `Enviando para *${progress.currentName}* — próximo em ${formatSeconds(progress.nextDelay)}`}
                </p>
              )}
            </div>
            <p className={`text-3xl font-black ${progress.done ? 'text-green-700' : 'text-orange-700'}`}>
              {progress.sent}/{progress.total}
            </p>
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-white rounded-full overflow-hidden border border-slate-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${progress.done ? 'bg-green-500' : progress.stopped ? 'bg-red-400' : 'bg-orange-500'}`}
              style={{ width: `${progress.total > 0 ? (progress.sent / progress.total) * 100 : 0}%` }}
            />
          </div>

          <div className="flex gap-3">
            {isSending && (
              <button onClick={stopBroadcast} className="px-6 py-2.5 bg-red-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-600 transition-all">
                ⛔ Parar
              </button>
            )}
            {(progress.done || progress.stopped) && (
              <button onClick={resetBroadcast} className="px-6 py-2.5 bg-black text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-orange-500 transition-all">
                ↺ Novo Disparo
              </button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Left: Customer List ───────────────────────────────────── */}
        <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-6 shadow-xl shadow-slate-100/50">
          <h2 className="text-sm font-black text-black uppercase tracking-widest">1. Selecionar Clientes</h2>

          {/* Filter mode */}
          <div className="flex gap-3">
            <button
              onClick={() => setFilterMode('all')}
              className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${filterMode === 'all' ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:border-black'}`}
            >
              Todos os Clientes
            </button>
            <button
              onClick={() => setFilterMode('inactive')}
              className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${filterMode === 'inactive' ? 'bg-black text-white border-black' : 'bg-white text-slate-500 border-slate-200 hover:border-black'}`}
            >
              Inativos há +X dias
            </button>
          </div>

          {filterMode === 'inactive' && (
            <div className="flex items-center gap-3 bg-slate-50 rounded-2xl px-5 py-3">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest whitespace-nowrap">Sem visita há mais de</span>
              <input
                type="number"
                min={1}
                value={inactiveDays}
                onChange={e => setInactiveDays(Math.max(1, Number(e.target.value)))}
                className="w-16 text-center bg-white border-2 border-slate-200 rounded-xl py-1.5 font-black text-sm outline-none focus:border-orange-500"
              />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">dias</span>
            </div>
          )}

          {/* Search + bulk actions */}
          <div className="space-y-2">
            <input
              placeholder="Buscar cliente..."
              value={listSearch}
              onChange={e => setListSearch(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl text-xs font-bold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
            />
            <div className="flex gap-2 items-center">
              <button onClick={selectAll} className="text-[9px] font-black text-orange-500 uppercase tracking-widest hover:underline">Selecionar Todos</button>
              <span className="text-slate-200">|</span>
              <button onClick={deselectAll} className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:underline">Desmarcar Todos</button>
              <span className="text-[9px] font-black text-slate-400 ml-auto">
                {selectedIds.size} de {filteredCustomers.length} selecionados
              </span>
            </div>
          </div>

          {/* Customer list */}
          <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-1.5">
            {filteredCustomers.length === 0 && (
              <p className="text-center py-8 text-slate-300 text-xs font-black uppercase">
                {filterMode === 'inactive' ? `Nenhum cliente inativo há +${inactiveDays} dias` : 'Nenhum cliente encontrado'}
              </p>
            )}
            {filteredCustomers.map(c => (
              <label key={c.id} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl hover:bg-slate-50 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleCustomer(c.id)}
                  className="w-4 h-4 accent-orange-500 flex-shrink-0"
                  disabled={isSending}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-black truncate">{c.name}</p>
                  <p className="text-[9px] font-bold text-slate-400">{c.phone}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* ── Right: Messages + Timing ──────────────────────────────── */}
        <div className="space-y-6">
          {/* Messages */}
          <div className="bg-white border-2 border-slate-100 rounded-[28px] p-8 space-y-5 shadow-xl shadow-slate-100/50">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-black text-black uppercase tracking-widest">2. Mensagens (até 5)</h2>
              <span className="text-[9px] font-black text-slate-300 uppercase">Rotação automática</span>
            </div>
            <p className="text-[10px] font-bold text-slate-400">O sistema alterna as mensagens em sequência a cada envio.</p>

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

            {/* Delay between messages */}
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
              <p className="text-[9px] font-bold text-slate-300">Variação aleatória: evita detecção de padrão</p>
            </div>

            {/* Pause interval */}
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
              <p className="text-[9px] font-bold text-slate-300">Simula comportamento humano, reduz risco de bloqueio</p>
            </div>

            {/* Summary */}
            <div className="bg-orange-50 border border-orange-100 rounded-2xl p-4">
              <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-2">Resumo do Disparo</p>
              <p className="text-[10px] font-bold text-orange-500">
                📤 {selectedIds.size} destinatários · {activeMessages.length} mensagem{activeMessages.length !== 1 ? 's' : ''} em rotação
              </p>
              <p className="text-[10px] font-bold text-orange-500">
                ⏱ Delay {delayMin}–{delayMax}s · Pausa de {formatSeconds(pauseMin)}–{formatSeconds(pauseMax)} a cada {pauseEvery} msgs
              </p>
              {selectedIds.size > 0 && (
                <p className="text-[9px] font-bold text-orange-400 mt-1">
                  Tempo estimado mínimo: ~{formatSeconds(selectedIds.size * delayMin + Math.floor(selectedIds.size / pauseEvery) * pauseMin)}
                </p>
              )}
            </div>

            {/* Start button */}
            {!isSending && !progress && (
              <button
                onClick={startBroadcast}
                disabled={!connected || activeMessages.length === 0 || selectedIds.size === 0}
                className="w-full py-5 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-200 hover:bg-orange-600 hover:scale-[1.02] transition-all disabled:opacity-40 disabled:scale-100 disabled:shadow-none"
              >
                🚀 Iniciar Disparo — {selectedIds.size} Clientes
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

export default BroadcastView;
