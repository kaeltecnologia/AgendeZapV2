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
  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.body || msg.text || ''
  ).trim();

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
      model: 'gemini-1.5-flash',
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
