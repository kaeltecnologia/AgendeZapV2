import { GoogleGenAI, Type } from '@google/genai';
import { evolutionService, EVOLUTION_API_URL, EVOLUTION_API_KEY } from './evolutionService';
import { supabase } from './supabase';
import { db } from './mockDb';

// ─── Dedup ────────────────────────────────────────────────────────────
const processedIds = new Set<string>();
let SESSION_START_TIMESTAMP = Math.floor(Date.now() / 1000);
let pollingInterval: any = null;
let isRunning = false;

// ─── Logs ─────────────────────────────────────────────────────────────
export type LogEntry = {
  time: string;
  level: 'INFO' | 'GEMINI' | 'ERROR' | 'POLLING' | 'ENVIADO' | 'CONTEXT';
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

// ─── Conversation History (multi-turn, per tenant+phone) ──────────────
// Each entry is a Gemini content turn: { role: 'user'|'model', parts: [{text}] }
const conversationHistory = new Map<string, any[]>();

function historyKey(tenantId: string, phone: string): string {
  return `${tenantId}::${phone}`;
}

function getHistory(tenantId: string, phone: string): any[] {
  return conversationHistory.get(historyKey(tenantId, phone)) || [];
}

function addToHistory(tenantId: string, phone: string, role: 'user' | 'model', text: string): void {
  const key = historyKey(tenantId, phone);
  const hist = conversationHistory.get(key) || [];
  hist.push({ role, parts: [{ text }] });
  // Keep last 20 entries (= 10 full turns) to avoid token overload
  if (hist.length > 20) hist.splice(0, hist.length - 20);
  conversationHistory.set(key, hist);
}

function clearHistory(tenantId: string, phone: string): void {
  conversationHistory.delete(historyKey(tenantId, phone));
}

// ─── Audio transcription ──────────────────────────────────────────────
export async function fetchAudioBase64(
  instanceName: string,
  msg: any
): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
        // Evolution API expects the FULL message record (key + message + messageType, etc.)
        body: JSON.stringify({ message: msg, convertToMp4: false }),
      }
    );
    if (!res.ok) {
      console.warn('[fetchAudioBase64] HTTP', res.status, res.statusText);
      return null;
    }
    const data = await res.json();
    const base64: string = data.base64 || data.data || '';
    const mimeType: string = (data.mimetype || data.mimeType || 'audio/ogg')
      .split(';')[0]
      .trim();
    if (!base64) {
      console.warn('[fetchAudioBase64] Resposta OK mas sem base64:', JSON.stringify(data).substring(0, 200));
      return null;
    }
    return { base64, mimeType };
  } catch (e: any) {
    console.error('[fetchAudioBase64] Erro:', e.message);
    return null;
  }
}

// ── Whisper transcription (OpenAI) ───────────────────────────────────
async function _transcribeWithWhisper(
  apiKey: string,
  base64: string,
  mimeType: string
): Promise<string | null> {
  try {
    // Convert base64 → Blob → FormData (Whisper requires multipart upload)
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('webm') ? 'webm' : 'ogg';
    const blob = new Blob([bytes], { type: mimeType });

    const form = new FormData();
    form.append('file', blob, `audio.${ext}`);
    form.append('model', 'whisper-1');
    form.append('language', 'pt');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[transcribeAudio] Whisper HTTP ${res.status}:`, errText.substring(0, 300));
      return null;
    }
    const data = await res.json();
    return data.text?.trim() || null;
  } catch (e: any) {
    console.error('[transcribeAudio] Whisper erro:', e.message);
    return null;
  }
}

// ── Gemini transcription ──────────────────────────────────────────────
async function _callGeminiTranscribe(
  apiKey: string,
  base64: string,
  normalizedMime: string,
  model: string
): Promise<{ ok: boolean; status: number; text: string | null; rateLimited: boolean }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: 'Transcreva exatamente o que foi dito neste áudio em português brasileiro. Retorne APENAS a transcrição, sem explicações ou formatação extra.' },
          { inline_data: { mime_type: normalizedMime, data: base64 } }
        ]
      }]
    })
  });
  if (res.status === 429) return { ok: false, status: 429, text: null, rateLimited: true };
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(`[transcribeAudio] HTTP ${res.status} (${model}):`, errText.substring(0, 300));
    return { ok: false, status: res.status, text: null, rateLimited: false };
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  return { ok: true, status: 200, text, rateLimited: false };
}

async function _transcribeWithGemini(
  apiKey: string,
  base64: string,
  mimeType: string
): Promise<string | null> {
  // WhatsApp sends audio/ogg (Opus codec) — Gemini needs the codec hint
  const normalizedMime = mimeType === 'audio/ogg' ? 'audio/ogg; codecs=opus' : mimeType;
  const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite'];

  for (const model of models) {
    let attempt = await _callGeminiTranscribe(apiKey, base64, normalizedMime, model);
    if (attempt.ok) return attempt.text;

    if (attempt.rateLimited) {
      console.warn(`[transcribeAudio] 429 em ${model} — aguardando 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      attempt = await _callGeminiTranscribe(apiKey, base64, normalizedMime, model);
      if (attempt.ok) return attempt.text;
      console.warn(`[transcribeAudio] Ainda 429 em ${model} — tentando próximo modelo...`);
      continue;
    }
    break; // non-recoverable error
  }
  return null;
}

export async function transcribeAudio(
  apiKey: string,
  base64: string,
  mimeType: string
): Promise<string | null> {
  try {
    // Route by key type: sk-... = OpenAI Whisper; AIza... = Gemini
    if (apiKey.startsWith('sk-')) {
      console.log('[transcribeAudio] Usando OpenAI Whisper');
      return await _transcribeWithWhisper(apiKey, base64, mimeType);
    } else {
      console.log('[transcribeAudio] Usando Gemini');
      return await _transcribeWithGemini(apiKey, base64, mimeType);
    }
  } catch (e: any) {
    console.error('[transcribeAudio] Erro:', e.message);
    return null;
  }
}

// ─── Phone extractor ──────────────────────────────────────────────────
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
  // Fallback: scan raw JSON for a Brazilian number
  const msgStr = JSON.stringify(msg);
  const matches = msgStr.match(/55\d{10,11}/g);
  if (matches && matches.length > 0) {
    const n = matches[0];
    return n.length > 12 ? n.slice(0, 4) + n.slice(5) : n;
  }
  return null;
}

// ─── Main message processor ───────────────────────────────────────────
export async function processarMensagem(tenant: any, msg: any) {
  let text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.body || msg.text || ''
  ).trim();

  // ── Audio transcription ───────────────────────────────────────────────
  const msgType = msg.messageType || msg.type || '';
  const isAudio =
    ['audioMessage', 'pttMessage'].includes(msgType) ||
    !!msg.message?.audioMessage ||
    !!msg.message?.pttMessage;

  if (!text && isAudio) {
    const geminiKey: string = tenant.gemini_api_key || '';
    if (geminiKey) {
      log('INFO', 'Áudio recebido — transcrevendo com Gemini...');
      const audio = await fetchAudioBase64(tenant.evolution_instance, msg);
      if (audio) {
        const transcribed = await transcribeAudio(geminiKey, audio.base64, audio.mimeType);
        if (transcribed) {
          text = transcribed;
          log('INFO', `Transcrição: "${transcribed.substring(0, 80)}"`);
        }
      }
    }
    if (!text) {
      const numeroFallback = extrairNumero(msg);
      if (numeroFallback) {
        await evolutionService.sendMessage(
          tenant.evolution_instance,
          numeroFallback,
          'Opa! Não consegui entender o áudio 🎧 Pode digitar sua mensagem?'
        );
        log('ERROR', 'Falha ao transcrever áudio — pedido para redigitar');
      }
      return;
    }
  }

  if (!text) return;

  const pushName = msg.pushName || 'Cliente';
  const numero = extrairNumero(msg);
  if (!numero) {
    log('ERROR', 'Não foi possível extrair número válido');
    return;
  }

  const tenantId: string = tenant.id;

  // ── Reset command ────────────────────────────────────────────────────
  const lower = text.toLowerCase();
  if (lower === 'reset' || lower === '#reset') {
    clearHistory(tenantId, numero);
    await evolutionService.sendMessage(
      tenant.evolution_instance,
      numero,
      'Histórico limpo! Vamos começar de novo 😊'
    );
    log('CONTEXT', `Histórico resetado para ${numero}`);
    return;
  }

  const hist = getHistory(tenantId, numero);
  log('CONTEXT', `Histórico: ${hist.length} mensagem(ns) salvas para ${numero}`);
  log('INFO', `Nova msg de ${pushName}: "${text.substring(0, 60)}"`);

  // ── Load tenant data for context ─────────────────────────────────────
  const [professionals, services] = await Promise.all([
    db.getProfessionals(tenantId),
    db.getServices(tenantId),
  ]);

  const activeProfs = professionals.filter(p => p.active);
  const activeSvcs  = services.filter(s => s.active);

  const profStr = activeProfs.map(p => `${p.name}${p.specialty ? ` (${p.specialty})` : ''}`).join(', ');
  const svcStr  = activeSvcs.map(s => `${s.name} — R$${s.price.toFixed(2)}`).join(', ');

  const hoje = new Date().toLocaleString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const shopName: string = tenant.nome || tenant.name || 'o estabelecimento';

  const systemPrompt = `Você é o assistente de agendamentos de "${shopName}". Responda SEMPRE em português brasileiro.

DADOS DO ESTABELECIMENTO:
- Data/hora atual: ${hoje}
- Profissionais: ${profStr || '(nenhum cadastrado)'}
- Serviços: ${svcStr || '(nenhum cadastrado)'}

=== INSTRUÇÃO OBRIGATÓRIA — LEIA ANTES DE CADA RESPOSTA ===

ANTES de escrever qualquer coisa, analise a mensagem do cliente e responda internamente:
1. O cliente mencionou um PROFISSIONAL? (ex: "com o matheus", "com matheus", "pelo matheus")
2. O cliente mencionou um DIA? (ex: "amanhã", "hoje", "sexta", "dia 15")
3. O cliente mencionou um PERÍODO ou HORÁRIO? (ex: "manhã", "tarde", "às 14h", "14:00")
4. O cliente mencionou um SERVIÇO? (ex: "corte", "barba", qualquer palavra dos serviços acima)

REGRA: Se o cliente já informou algo, CONFIRME e NÃO pergunte de novo.
REGRA: Só pergunte o que ainda está faltando.
REGRA: NUNCA liste todos os serviços disponíveis — pergunte apenas "Qual procedimento você quer?"

FORMATO DA RESPOSTA:
"[Confirme o que o cliente já disse em 1 frase] [Pergunte só o que falta]"

=== EXEMPLOS — SIGA EXATAMENTE ===

Situação: cliente disse "tem horário amanhã com o matheus?"
  CERTO: "Tem sim! Amanhã com Matheus 😊 Qual procedimento você quer fazer?"
  ERRADO: "Não identifiquei o procedimento. Qual desses você gostaria? Barba, Corte..."
  ERRADO: "Qual profissional você prefere?"

Situação: cliente disse "quero corte com matheus amanhã de manhã"
  CERTO: "Show! Corte com Matheus amanhã de manhã 💈 Horários: 08:00, 09:00, 10:00, 11:00. Qual prefere?"
  ERRADO: "Para qual dia você quer?"
  ERRADO: "Qual serviço deseja?"

Situação: cliente disse apenas "oi" ou "olá"
  CERTO: "Olá! Qual procedimento você gostaria de agendar? ✂️"

Situação: cliente disse "quero corte"
  CERTO: "Beleza! Corte anotado. Com qual profissional você prefere? Temos: ${profStr || 'nenhum'}"

Situação: cliente mudou de ideia ("na verdade quero com o felipe")
  CERTO: "Sem problema! Com Felipe então. Para qual dia?"

=== REGRAS DE TOM ===
- Curto: máximo 3 linhas por mensagem
- Amigável: use "Opa!", "Show!", "Beleza!", "Tem sim!", "Ótimo!"
- 1 a 2 emojis por mensagem
- Se assunto não for relacionado ao estabelecimento: retorne replyText vazio ""
- USE o histórico da conversa — nunca repita perguntas já respondidas`;


  // ── Gemini multi-turn chat ───────────────────────────────────────────
  const apiKey: string = tenant.gemini_api_key || '';
  if (!apiKey) {
    log('ERROR', 'Chave Gemini não configurada para este tenant');
    return;
  }

  try {
    log('POLLING', 'Gemini processando com histórico...');

    const ai = new GoogleGenAI({ apiKey });

    // Build contents array: previous turns + current user message
    const contents = [
      ...hist,
      { role: 'user', parts: [{ text }] },
    ];

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents,
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: {
              type: Type.STRING,
              description: 'Texto enviado ao cliente. Vazio se deve ignorar.'
            },
            intent: {
              type: Type.STRING,
              enum: ['BOOKING', 'INFO', 'CHAT', 'IGNORE'],
              description: 'Intenção detectada na mensagem do cliente'
            },
            extracted: {
              type: Type.OBJECT,
              description: 'Entidades extraídas da conversa (null se não encontrado)',
              properties: {
                professional: { type: Type.STRING, description: 'Nome do profissional mencionado ou null' },
                day:          { type: Type.STRING, description: 'Dia mencionado (ex: amanhã, sábado) ou null' },
                period:       { type: Type.STRING, description: 'Período mencionado (manhã/tarde/noite/horário) ou null' },
                service:      { type: Type.STRING, description: 'Serviço mencionado ou null' },
                time:         { type: Type.STRING, description: 'Horário específico (ex: 09:00) ou null' },
              },
            },
          },
          required: ['replyText', 'intent'],
        },
      },
    });

    let result: { replyText: string; intent: string; extracted?: { professional?: string | null; day?: string | null; period?: string | null; service?: string | null; time?: string | null } } = { replyText: '', intent: 'CHAT' };
    try {
      result = JSON.parse(response.text || '{}');
    } catch {
      log('ERROR', 'Falha ao parsear JSON do Gemini');
    }

    const ext = result.extracted;
    const extStr = ext
      ? `prof=${ext.professional ?? '-'} dia=${ext.day ?? '-'} período=${ext.period ?? '-'} svc=${ext.service ?? '-'}`
      : 'sem extração';
    log('GEMINI', `Intent: ${result.intent} | ${extStr}`);
    log('GEMINI', `Reply: "${(result.replyText || '').substring(0, 80)}"`);

    if (result.replyText && result.replyText.trim()) {
      // Save both turns to history ONLY after a successful reply
      addToHistory(tenantId, numero, 'user', text);
      addToHistory(tenantId, numero, 'model', result.replyText);
      log('CONTEXT', `Histórico atualizado → ${getHistory(tenantId, numero).length} entradas`);

      await evolutionService.sendMessage(tenant.evolution_instance, numero, result.replyText);
      log('ENVIADO', `Resposta para ${pushName} (${numero})`);
    } else {
      log('INFO', `Mensagem ignorada (intent: ${result.intent})`);
    }
  } catch (e: any) {
    log('ERROR', `Erro no Gemini: ${e.message}`);
  }
}

// ─── Polling loop ─────────────────────────────────────────────────────
async function pollingLoop() {
  if (isRunning) return;
  isRunning = true;

  try {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('*');

    for (const tenant of tenants || []) {
      if (!tenant.evolution_instance) continue;
      try {
        const res = await fetch(
          `${EVOLUTION_API_URL}/chat/findMessages/${tenant.evolution_instance}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': EVOLUTION_API_KEY
            },
            body: JSON.stringify({ where: {}, limit: 20 })
          }
        );

        if (!res.ok) continue;
        const data = await res.json();
        const records = data?.messages?.records || data?.records || data || [];
        const messages: any[] = Array.isArray(records) ? records : [];

        // Sort oldest→newest so we reply in order
        messages.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0));

        for (const msg of messages) {
          const msgId = msg.id || msg.key?.id;
          if (!msgId || processedIds.has(msgId)) continue;

          const msgTimestamp = msg.messageTimestamp || msg.timestamp || 0;

          // Skip old messages from before this session started
          if (msgTimestamp > 0 && msgTimestamp < SESSION_START_TIMESTAMP) {
            processedIds.add(msgId);
            continue;
          }

          // Skip own messages
          if (msg.key?.fromMe === true) { processedIds.add(msgId); continue; }

          // Skip group messages
          const remoteJid = msg.key?.remoteJid || '';
          if (remoteJid.includes('@g.us')) { processedIds.add(msgId); continue; }

          // Skip non-text message types
          const msgType = msg.messageType || msg.type || '';
          if (['pollUpdateMessage', 'protocolMessage', 'reactionMessage'].includes(msgType)) {
            processedIds.add(msgId); continue;
          }

          // Mark BEFORE processing to prevent any concurrent re-entry
          processedIds.add(msgId);
          await processarMensagem(tenant, msg);
        }
      } catch (e: any) {
        log('ERROR', `Tenant ${tenant.nome}: ${e.message}`);
      }
    }
  } catch (e: any) {
    log('ERROR', `Erro geral: ${e.message}`);
  }

  isRunning = false;
}

// ─── Public API ───────────────────────────────────────────────────────
export function startPolling(_instanceName?: string) {
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
