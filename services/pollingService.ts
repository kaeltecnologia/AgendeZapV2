import { evolutionService, EVOLUTION_API_URL, EVOLUTION_API_KEY } from './evolutionService';
import { supabase } from './supabase';
import { handleMessage } from './agentService';

const processedIds = new Set<string>();
let SESSION_START_TIMESTAMP = Math.floor(Date.now() / 1000);
let pollingInterval: any = null;
let isRunning = false;

export type LogEntry = {
  time: string;
  level: 'INFO' | 'GEMINI' | 'ERROR' | 'POLLING' | 'ENVIADO';
  message: string;
};

let logCallback: ((log: LogEntry) => void) | null = null;

export function setLogCallback(cb: (log: LogEntry) => void) {
  logCallback = cb;
}

function log(level: LogEntry['level'], message: string) {
  const entry: LogEntry = {
    time: new Date().toLocaleTimeString('pt-BR'),
    level,
    message
  };
  console.log(`[${entry.time}][${level}] ${message}`);
  if (logCallback) logCallback(entry);
}

function extrairNumero(msg: any): string | null {
  const candidatos = [
    msg.key?.remoteJid,
    msg.participant,
    msg.key?.participant,
  ];
  for (const c of candidatos) {
    if (!c) continue;
    if (c.includes('@lid')) continue;
    const numero = c.replace(/@.*/, '').replace(/\D/g, '');
    if (numero.length >= 10 && numero.length <= 12) return numero;
  }
  const msgStr = JSON.stringify(msg);
  const matches = msgStr.match(/55\d{10,11}/g);
  if (matches && matches.length > 0) {
    const numero = matches[0];
    return numero.length > 12
      ? numero.slice(0, 4) + numero.slice(5)
      : numero;
  }
  return null;
}

export async function processarMensagem(tenant: any, msg: any) {
  const text = msg.message?.conversation
    || msg.message?.extendedTextMessage?.text
    || msg.body || msg.text || '';

  if (!text.trim()) return;

  const pushName = msg.pushName || 'Cliente';
  log('INFO', `Nova msg de ${pushName}: "${text.substring(0, 50)}"`);

  const numero = extrairNumero(msg);
  if (!numero) {
    log('ERROR', 'Não foi possível extrair número válido');
    return;
  }

  try {
    log('POLLING', 'Agente IA processando...');
    const reply = await handleMessage(tenant, numero, text, pushName);
    if (reply) {
      log('INFO', `Enviando para: ${numero}`);
      await evolutionService.sendMessage(tenant.evolution_instance, numero, reply);
      log('ENVIADO', `Resposta enviada para ${pushName}`);
    }
  } catch (e: any) {
    log('ERROR', `Erro no agente: ${e.message}`);
  }
}

async function pollingLoop() {
  if (isRunning) return;
  isRunning = true;

  try {
    // Buscar todos os tenants ativos
    const { data: tenants } = await supabase
      .from('tenants')
      .select('*')
      .eq('status', 'active');

    for (const tenant of tenants || []) {
      try {
        const res = await fetch(
          `${EVOLUTION_API_URL}/chat/findMessages/${tenant.evolution_instance}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': EVOLUTION_API_KEY
            },
            body: JSON.stringify({ count: 20 })
          }
        );

        if (!res.ok) continue;
        const data = await res.json();
        const records = data?.messages?.records || data?.records || data || [];
        const messages = Array.isArray(records) ? records : [];

        for (const msg of messages) {
          const msgId = msg.id || msg.key?.id;
          if (!msgId || processedIds.has(msgId)) continue;

          const msgTimestamp = msg.messageTimestamp || msg.timestamp || 0;
          if (msgTimestamp < SESSION_START_TIMESTAMP) {
            processedIds.add(msgId);
            continue;
          }

          if (msg.key?.fromMe === true) { processedIds.add(msgId); continue; }

          const remoteJid = msg.key?.remoteJid || '';
          if (remoteJid.includes('@g.us')) { processedIds.add(msgId); continue; }

          const msgType = msg.messageType || msg.type || '';
          if (['pollUpdateMessage', 'protocolMessage', 'reactionMessage'].includes(msgType)) {
            processedIds.add(msgId);
            continue;
          }

          processedIds.add(msgId);
          await processarMensagem(tenant, msg);
        }
      } catch (e: any) {
        log('ERROR', `Erro no tenant ${tenant.nome}: ${e.message}`);
      }
    }
  } catch (e: any) {
    log('ERROR', `Erro geral: ${e.message}`);
  }

  isRunning = false;
}

export function startPolling(instanceName?: string) {
  SESSION_START_TIMESTAMP = Math.floor(Date.now() / 1000);
  processedIds.clear();
  log('INFO', 'Polling iniciado — monitorando mensagens...');

  if (pollingInterval) clearInterval(pollingInterval);
  pollingInterval = setInterval(pollingLoop, 8000);
  pollingLoop();
}

export function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    log('INFO', 'Polling pausado.');
  }
}

export function isPollingActive() {
  return pollingInterval !== null;
}