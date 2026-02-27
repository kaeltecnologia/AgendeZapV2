import React, { useEffect } from 'react';
import { evolutionService } from '../services/evolutionService';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { handleMessage } from '../services/agentService';
import { handleProfessionalMessage } from '../services/professionalAgentService';
import { runFollowUp } from '../services/followUpService';

// ── Module-level singletons — survive component remounts ──────────────
// useRef resets every time the component unmounts/remounts (e.g. tab navigation).
// Module-level variables live for the entire browser session, so messages
// are never reprocessed even if the component re-renders.
const _processedIds = new Set<string>();
const _sessionStart = Math.floor(Date.now() / 1000);
let _isBusy = false;

// ── Message buffer — accumulate messages per phone, only process
// after N seconds of silence from that number (configurable via settings)
const _lastMsgTime = new Map<string, number>();       // phone → timestamp of last seen msg
const _pendingMsgs  = new Map<string, any[]>();        // phone → accumulated msgs (most-recent wins)

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

async function processarMensagem(tenant: any, msg: any) {
  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.body || msg.text || '';
  if (!text.trim()) return;

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

      // Mark processed immediately to prevent any concurrent re-processing
      _processedIds.add(msgId);
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
      if (!text || !text.trim()) continue;

      // Push into buffer and refresh silence timer
      if (!_pendingMsgs.has(phone)) _pendingMsgs.set(phone, []);
      _pendingMsgs.get(phone)!.push(msg);
      _lastMsgTime.set(phone, now);
      broadcastPending(phone); // tell other tabs this phone has pending msgs
    }

    // ── Phase 2: for each phone whose buffer has been silent long enough,
    //            process the LAST (most recent) accumulated message ──────
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
        await processarMensagem(tenant, lastMsg);
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

  // ── Disable external webhook (on mount + every 10 s to prevent re-activation) ─
  useEffect(() => {
    if (!tenantId) return;

    const disableWh = async () => {
      try {
        const settings = await db.getSettings(tenantId);
        if (!settings.aiActive) return;
        const { data: tenants } = await supabase.from('tenants').select('*');
        const tenant = (tenants || []).find((t: any) => t.id === tenantId || t.slug === tenantId);
        if (!tenant) return;
        const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);
        if (instanceName) await evolutionService.disableWebhook(instanceName);
      } catch (e) { /* silent */ }
    };

    disableWh();
    const interval = setInterval(disableWh, 10000); // retry every 10 s — must beat Evolution API webhook restore
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
