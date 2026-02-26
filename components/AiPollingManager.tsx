import React, { useEffect, useRef } from 'react';
import { evolutionService } from '../services/evolutionService';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { handleMessage } from '../services/agentService';
import { handleProfessionalMessage } from '../services/professionalAgentService';
import { runFollowUp } from '../services/followUpService';

const AiPollingManager: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const processedIds = useRef<Set<string>>(new Set());
  const sessionStart = useRef(Math.floor(Date.now() / 1000));
  const isBusy = useRef(false);

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

  const processarMensagem = async (tenant: any, msg: any) => {
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
  };

  const poll = async () => {
    if (isBusy.current) return;
    isBusy.current = true;
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

      for (const msg of sorted) {
        const msgId = msg.key?.id;
        const msgTimestamp = msg.messageTimestamp || msg.timestamp;
        if (!msgId || processedIds.current.has(msgId)) continue;

        if (msg.key?.fromMe || (msgTimestamp && msgTimestamp < sessionStart.current)) {
          processedIds.current.add(msgId);
          continue;
        }

        const remoteJid = msg.key?.remoteJid || '';
        const remoteJidAlt = msg.key?.remoteJidAlt || '';
        if (remoteJid.includes('@g.us') || remoteJidAlt.includes('@g.us')) {
          processedIds.current.add(msgId);
          continue;
        }

        if (!extrairNumero(msg)) {
          processedIds.current.add(msgId);
          continue;
        }

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.content || msg.text || '';
        if (text && text.trim().length > 0) {
          processedIds.current.add(msgId);
          try {
            await processarMensagem(tenant, msg);
          } catch (e: any) {
            console.error('[AiPolling] Processamento:', e.message);
          }
        }
      }
    } catch (e: any) {
      console.error('[AiPolling] Poll error:', e.message);
    } finally {
      isBusy.current = false;
    }
  };

  // ── AI message polling (every 4 s) ─────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    const interval = setInterval(poll, 4000);
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

    // Run once immediately on mount, then every 60 s
    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [tenantId]);

  return null;
};

export default AiPollingManager;
