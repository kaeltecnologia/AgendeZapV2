import React, { useEffect } from 'react';
import { evolutionService } from '../services/evolutionService';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { handleMessage } from '../services/agentService';
import { handleProfessionalMessage } from '../services/professionalAgentService';
import { runFollowUp } from '../services/followUpService';
import { fetchAudioBase64, transcribeAudio } from '../services/pollingService';

// ── Module-level singletons — survive component remounts ──────────────
// useRef resets every time the component unmounts/remounts (e.g. tab navigation).
// Module-level variables live for the entire browser session, so messages
// are never reprocessed even if the component re-renders.
const _processedIds = new Set<string>();
const _sessionStart = Math.floor(Date.now() / 1000);
let _isBusy = false;

// ── Persistent dedup via localStorage ────────────────────────────────
// IDs marked as processed are persisted for 30 min so page reloads and
// multiple-tab restarts never re-process the same message.
const _LS_KEY = 'agz_pid';
const _LS_TTL = 30 * 60 * 1000; // 30 minutes

function _loadPersistedIds(): void {
  try {
    const raw = localStorage.getItem(_LS_KEY);
    if (!raw) return;
    const items: Array<[string, number]> = JSON.parse(raw);
    const cutoff = Date.now() - _LS_TTL;
    for (const [id, ts] of items) {
      if (ts > cutoff) _processedIds.add(id);
    }
  } catch { /* ignore parse errors */ }
}

function _persistId(id: string): void {
  _processedIds.add(id);
  try {
    const raw = localStorage.getItem(_LS_KEY);
    const items: Array<[string, number]> = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - _LS_TTL;
    const fresh = items.filter(([, ts]) => ts > cutoff);
    fresh.push([id, Date.now()]);
    localStorage.setItem(_LS_KEY, JSON.stringify(fresh.slice(-500)));
  } catch { /* ignore storage errors */ }
}

// Populate _processedIds from localStorage on module load
_loadPersistedIds();

// ── Message buffer — accumulate messages per phone, only process
// after N seconds of silence from that number (configurable via settings)
const _lastMsgTime = new Map<string, number>();       // phone → timestamp of last seen msg
const _pendingMsgs  = new Map<string, any[]>();        // phone → accumulated text msgs (most-recent wins)
const _pendingAudio = new Map<string, any[]>();        // phone → audio msgs (bypass silence buffer)

// ── Cross-tab dedup via BroadcastChannel ─────────────────────────────
// When one tab marks a message as processed, all other tabs learn immediately
// so they never re-process the same message if the lock happens to rotate.
let _bc: BroadcastChannel | null = null;
try {
  _bc = new BroadcastChannel('agz_dedup');
  _bc.onmessage = (e: MessageEvent) => {
    if (e.data?.type === 'PROCESSED' && e.data.id) _processedIds.add(e.data.id);
    if (e.data?.type === 'PENDING_PHONE' && e.data.phone) {
      // Another tab is buffering messages from this phone — reset our timer
      // so we don't accidentally fire a duplicate response after 30s.
      _lastMsgTime.set(e.data.phone, e.data.ts ?? Date.now());
    }
  };
} catch { /* BroadcastChannel not available (e.g. some privacy modes) */ }

function broadcastProcessed(msgId: string) {
  try { _bc?.postMessage({ type: 'PROCESSED', id: msgId }); } catch {}
}

function broadcastPending(phone: string) {
  try { _bc?.postMessage({ type: 'PENDING_PHONE', phone, ts: Date.now() }); } catch {}
}

// ── Web Locks — only ONE browser tab polls at a time ─────────────────
// Prevents duplicate processing when the user has multiple tabs open.
async function pollLocked(tenantId: string) {
  const lockName = `agz_poll_${tenantId}`;
  if (typeof navigator !== 'undefined' && 'locks' in navigator) {
    // ifAvailable: true — if another tab holds the lock, skip this cycle
    await (navigator as any).locks.request(lockName, { ifAvailable: true }, async (lock: any) => {
      if (!lock) return; // another tab is already polling
      await poll(tenantId);
    });
  } else {
    // Fallback for browsers without Web Locks API
    await poll(tenantId);
  }
}

function extrairNumero(msg: any): string | null {
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
}

async function processarMensagem(tenant: any, msg: any, settings?: any) {
  let text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.body || msg.text || ''
  ).trim();

  // ── Audio transcription ──────────────────────────────────────────────
  let audioReceived = false;
  if (!text) {
    const msgType = msg.messageType || msg.type || '';
    const isAudio =
      ['audioMessage', 'pttMessage'].includes(msgType) ||
      !!msg.message?.audioMessage ||
      !!msg.message?.pttMessage;
    if (isAudio) {
      audioReceived = true;
      // Use the same key resolution as agentService: settings.openaiApiKey first, then tenant column
      const geminiKey: string = (settings?.openaiApiKey || '').trim() || tenant.gemini_api_key || '';
      console.log('[AiPolling] Áudio detectado. geminiKey presente:', !!geminiKey, '| msgType:', msgType);
      if (geminiKey) {
        const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
        console.log('[AiPolling] Buscando base64 do áudio — instância:', instanceName);
        const audio = await fetchAudioBase64(instanceName, msg);
        console.log('[AiPolling] fetchAudioBase64 retornou:', audio ? `mimeType=${audio.mimeType}, base64len=${audio.base64.length}` : 'null');
        if (audio) {
          const transcribed = await transcribeAudio(geminiKey, audio.base64, audio.mimeType);
          console.log('[AiPolling] Transcrição:', transcribed ?? 'null');
          if (transcribed) text = transcribed;
        }
      } else {
        console.warn('[AiPolling] Chave Gemini não configurada — áudio ignorado');
      }
    }
  }

  // If audio was received but transcription failed, send a friendly fallback
  if (!text && audioReceived) {
    const cleanPhone = extrairNumero(msg);
    if (cleanPhone) {
      const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
      await evolutionService.sendMessage(instanceName, cleanPhone, 'Recebi seu áudio! 🎵 Poderia digitar sua mensagem para eu entender melhor? 😊');
    }
    return;
  }

  if (!text) return;

  const cleanPhone = extrairNumero(msg);
  if (!cleanPhone) return;

  try {
    const profReply = await handleProfessionalMessage(tenant, cleanPhone, text);
    const reply = profReply !== null
      ? profReply
      : await handleMessage(tenant, cleanPhone, text, msg.pushName || 'Cliente');
    if (reply) {
      const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
      await evolutionService.sendMessage(instanceName, cleanPhone, reply);
    }
  } catch (e: any) {
    console.error('[AiPolling] Erro ao processar mensagem:', e.message);
  }
}

async function poll(tenantId: string) {
  if (_isBusy) return;
  _isBusy = true;
  try {
    const settings = await db.getSettings(tenantId);
    if (!settings.aiActive) return;

    const { data: tenants } = await supabase.from('tenants').select('*');
    const tenant = (tenants || []).find((t: any) => t.id === tenantId || t.slug === tenantId);
    if (!tenant) return;

    const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
    const connectionStatus = await evolutionService.checkStatus(instanceName);
    if (connectionStatus !== 'open') return;

    const messages = await evolutionService.fetchRecentMessages(instanceName, 10);
    if (!messages || !Array.isArray(messages)) return;

    const sorted = [...messages].sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

    const now = Date.now();

    // ── Phase 1: accumulate new messages into the per-phone buffer ──
    for (const msg of sorted) {
      const msgId = msg.key?.id;
      if (!msgId || _processedIds.has(msgId)) continue;

      // Mark processed immediately — persists to localStorage so page reloads
      // and other tabs never reprocess this message ID.
      _persistId(msgId);
      broadcastProcessed(msgId); // tell all other tabs right away

      const msgTimestamp = msg.messageTimestamp || msg.timestamp || 0;

      // Skip messages sent before this session started
      if (msgTimestamp > 0 && msgTimestamp < _sessionStart) continue;

      // Skip own messages
      if (msg.key?.fromMe) continue;

      // Skip group messages
      const remoteJid = msg.key?.remoteJid || '';
      const remoteJidAlt = msg.key?.remoteJidAlt || '';
      if (remoteJid.includes('@g.us') || remoteJidAlt.includes('@g.us')) continue;

      const phone = extrairNumero(msg);
      if (!phone) continue;

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content || msg.text || '';
      const msgType = msg.messageType || msg.type || '';
      const isAudio = ['audioMessage', 'pttMessage'].includes(msgType) || !!msg.message?.audioMessage || !!msg.message?.pttMessage;

      if (isAudio) {
        // Audio bypasses the silence buffer — processed on the very next poll cycle (≤ 4 s)
        console.log('[AiPolling] Phase1: áudio enfileirado para', phone, '| msgType:', msgType);
        if (!_pendingAudio.has(phone)) _pendingAudio.set(phone, []);
        _pendingAudio.get(phone)!.push(msg);
      } else if (text.trim()) {
        // Text message goes into the silence buffer
        if (!_pendingMsgs.has(phone)) _pendingMsgs.set(phone, []);
        _pendingMsgs.get(phone)!.push(msg);
        _lastMsgTime.set(phone, now);
        broadcastPending(phone); // tell other tabs this phone has pending msgs
      }
    }

    // ── Phase 2a: process audio messages immediately (no silence buffer) ──
    for (const [phone, audioMsgs] of Array.from(_pendingAudio.entries())) {
      _pendingAudio.delete(phone);
      // Process each audio in order (usually just one)
      for (const audioMsg of audioMsgs) {
        try {
          await processarMensagem(tenant, audioMsg, settings);
        } catch (e: any) {
          console.error('[AiPolling] Áudio:', e.message);
        }
      }
    }

    // ── Phase 2b: for each phone whose text buffer has been silent long enough,
    //             process the LAST (most recent) accumulated text message ──────
    const bufferMs = (settings.msgBufferSecs ?? 30) * 1_000;
    for (const [phone, msgs] of Array.from(_pendingMsgs.entries())) {
      const lastTime = _lastMsgTime.get(phone) ?? 0;
      if (now - lastTime < bufferMs) continue; // still within silence window

      // Drain the buffer
      _pendingMsgs.delete(phone);
      _lastMsgTime.delete(phone);

      // Only respond to the most-recent message (it carries the full intent)
      const lastMsg = msgs[msgs.length - 1];
      try {
        await processarMensagem(tenant, lastMsg, settings);
      } catch (e: any) {
        console.error('[AiPolling] Processamento:', e.message);
      }
    }
  } catch (e: any) {
    console.error('[AiPolling] Poll error:', e.message);
  } finally {
    _isBusy = false;
  }
}

const AiPollingManager: React.FC<{ tenantId: string }> = ({ tenantId }) => {

  // ── Activate Edge Function webhook for 24/7 operation ────────────────
  // Runs on mount and every 5 min to re-register if Evolution API resets it.
  useEffect(() => {
    if (!tenantId) return;

    const WEBHOOK_URL = 'https://cnnfnqrnjckntnxdgwae.supabase.co/functions/v1/whatsapp-webhook';

    const activateWebhook = async () => {
      try {
        const settings = await db.getSettings(tenantId);
        if (!settings.aiActive) return;
        const { data: tenants } = await supabase.from('tenants').select('*');
        const tenant = (tenants || []).find((t: any) => t.id === tenantId || t.slug === tenantId);
        if (!tenant) return;
        const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
        if (instanceName) await evolutionService.enableWebhook(instanceName, WEBHOOK_URL);
      } catch (e) { /* silent */ }
    };

    activateWebhook();
    const interval = setInterval(activateWebhook, 5 * 60 * 1000); // re-register every 5 min
    return () => clearInterval(interval);
  }, [tenantId]);

  // ── AI message polling (every 4 s) — uses Web Locks for single-tab enforcement ──
  useEffect(() => {
    if (!tenantId) return;
    const interval = setInterval(() => pollLocked(tenantId), 4000);
    return () => clearInterval(interval);
  }, [tenantId]);

  // ── Follow-up scheduler (every 60 s) ───────────────────────────────
  useEffect(() => {
    if (!tenantId) return;

    const tick = async () => {
      try {
        const { data: tenants } = await supabase.from('tenants').select('*');
        const tenant = (tenants || []).find((t: any) => t.id === tenantId);
        if (tenant) await runFollowUp(tenant);
      } catch (e: any) {
        console.error('[FollowUp] Erro no scheduler:', e.message);
      }
    };

    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [tenantId]);

  return null;
};

export default AiPollingManager;
