/**
 * AgendeZap — Agente Conversacional v3
 *
 * Arquitetura: GPT-4o Mini (ou Gemini) conduz a conversa de forma natural.
 * A IA entende tudo que o cliente diz de uma vez, pula etapas automaticamente
 * e gera respostas humanas. O código só gerencia DB e reservas.
 */

import { supabase } from './supabase';
import { db } from './mockDb';
import { AppointmentStatus, BookingSource, BreakPeriod } from '../types';
import { sendProfessionalNotification } from './notificationService';
import { nichoConfigs, isBarbearia } from '../config/nichoConfigs';
import { logAIUsage, estimateTokens } from './usageTracker';

// =====================================================================
// TYPES
// =====================================================================

interface HistoryEntry {
  role: 'user' | 'bot';
  text: string;
}

interface SessionData {
  clientName?: string;
  serviceId?: string;
  serviceName?: string;
  serviceDuration?: number;
  servicePrice?: number;
  professionalId?: string;
  professionalName?: string;
  date?: string;        // YYYY-MM-DD
  time?: string;        // HH:MM
  availableSlots?: string[];
  pendingConfirm?: boolean;       // summary shown, waiting for yes/no
  pendingCancelReason?: boolean;  // asked for cancel reason, waiting for it
  // Follow-up context: set when system sends aviso/lembrete/reativacao to this phone
  pendingFollowUpType?: 'aviso' | 'lembrete' | 'reativacao';
  followUpApptTime?: string;     // HH:MM of the booked appointment (for reply context)
  followUpServiceName?: string;  // service name (for reply context)
  // Group booking (client + companion)
  groupBooking?: {
    active: boolean;
    companionDesc?: string;            // "minha esposa", "meu filho", etc.
    sameService?: boolean;             // both want same service?
    companionServiceId?: string;
    companionServiceName?: string;
    companionServiceDuration?: number;
    resolvedMode?: 'consecutive' | 'parallel'; // how the 2nd slot was resolved
    companion2ProfId?: string;         // 2nd professional (parallel mode)
    companion2ProfName?: string;
    companion2Time?: string;           // 2nd appointment time (consecutive mode)
  };
}

interface Session {
  tenantId: string;
  phone: string;
  data: SessionData;
  history: HistoryEntry[];
  updatedAt: number;
}

// =====================================================================
// SESSION STORE
// =====================================================================

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const sessions = new Map<string, Session>();

function sessionKey(tenantId: string, phone: string): string {
  return `${tenantId}::${phone}`;
}

function getSession(tenantId: string, phone: string): Session | null {
  const s = sessions.get(sessionKey(tenantId, phone));
  if (!s) return null;
  if (Date.now() - s.updatedAt > SESSION_TIMEOUT_MS) {
    sessions.delete(sessionKey(tenantId, phone));
    return null;
  }
  return s;
}

function saveSession(session: Session): void {
  session.updatedAt = Date.now();
  if (session.history.length > 20) session.history = session.history.slice(-20);
  sessions.set(sessionKey(session.tenantId, session.phone), session);
}

function clearSession(tenantId: string, phone: string): void {
  sessions.delete(sessionKey(tenantId, phone));
}

// ── Called by followUpService after each successful send ─────────────
// Registers context so the next client reply is handled in the right tone.
export function registerFollowUpContext(
  tenantId: string,
  phone: string,
  type: 'aviso' | 'lembrete' | 'reativacao',
  sentMessage: string,
  ctx?: { apptTime?: string; serviceName?: string; clientName?: string }
): void {
  const key = sessionKey(tenantId, phone);
  let sess = sessions.get(key);
  if (!sess) {
    sess = { tenantId, phone, data: {} as SessionData, history: [], updatedAt: Date.now() };
  }
  sess.data.pendingFollowUpType = type;
  if (ctx?.apptTime)     sess.data.followUpApptTime    = ctx.apptTime;
  if (ctx?.serviceName)  sess.data.followUpServiceName = ctx.serviceName;
  if (ctx?.clientName && !sess.data.clientName) sess.data.clientName = ctx.clientName;
  // Add the system message to history so the AI has full context if needed
  sess.history.push({ role: 'bot', text: sentMessage });
  if (sess.history.length > 20) sess.history = sess.history.slice(-20);
  sess.updatedAt = Date.now();
  sessions.set(key, sess);
  console.log(`[Agent] Follow-up context registered: ${type} → ${phone}`);
}

// =====================================================================
// FORMATTING HELPERS
// =====================================================================

function capitalizeName(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatSlots(slots: string[]): string {
  return slots.map(s => `• ${s}`).join('\n');
}

// Try to extract a time from free text against a list of available slots
function quickTime(text: string, slots: string[]): string | null {
  const t = text.trim();
  const matchColon = t.match(/(\d{1,2})[h:H](\d{2})?/);
  if (matchColon) {
    const label = `${matchColon[1].padStart(2, '0')}:${(matchColon[2] || '00').padStart(2, '0')}`;
    if (slots.includes(label)) return label;
    const nearest = slots.find(s => s >= label);
    if (nearest) return nearest;
  }
  const matchBare = t.match(/\b(1[0-9]|2[0-3]|[7-9])\b/);
  if (matchBare) {
    const label = `${String(parseInt(matchBare[1])).padStart(2, '0')}:00`;
    if (slots.includes(label)) return label;
    const nearest = slots.find(s => s >= label);
    if (nearest) return nearest;
  }
  return null;
}

// =====================================================================
// AVAILABILITY — respects operating hours and break periods
// =====================================================================

async function getAvailableSlots(
  tenantId: string,
  professionalId: string,
  date: string,
  durationMinutes: number,
  settings: any
): Promise<string[]> {
  const dateObj = new Date(date + 'T12:00:00');
  const dayIndex = dateObj.getDay();
  const dayConfig = settings.operatingHours?.[dayIndex];
  if (!dayConfig?.active) return [];

  const [startRange, endRange] = dayConfig.range.split('-');
  const [startH, startM] = startRange.split(':').map(Number);
  const [endH, endM] = endRange.split(':').map(Number);

  const { data: appointments } = await supabase
    .from('appointments')
    .select('inicio, fim')
    .eq('tenant_id', tenantId)
    .eq('professional_id', professionalId)
    .neq('status', AppointmentStatus.CANCELLED)
    .gte('inicio', `${date}T00:00:00`)
    .lte('inicio', `${date}T23:59:59`);

  const breaks: BreakPeriod[] = settings.breaks || [];
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const isToday = date === todayLocal;
  const INTERVAL_MIN = 30;
  const slots: string[] = [];

  let cursor = startH * 60 + startM;
  const endCursor = endH * 60 + endM;

  while (cursor + durationMinutes <= endCursor) {
    const h = Math.floor(cursor / 60);
    const m = cursor % 60;
    const label = `${pad(h)}:${pad(m)}`;
    const slotStart = new Date(`${date}T${label}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
    const slotEndLabel = `${pad(slotEnd.getHours())}:${pad(slotEnd.getMinutes())}`;

    if (isToday && slotStart <= now) { cursor += INTERVAL_MIN; continue; }

    const hasAppConflict = (appointments || []).some((a: any) => {
      const aStart = new Date(a.inicio);
      const aEnd = new Date(a.fim);
      return aStart < slotEnd && aEnd > slotStart;
    });
    if (hasAppConflict) { cursor += INTERVAL_MIN; continue; }

    const hasBreakConflict = breaks.some(brk => {
      if (brk.professionalId && brk.professionalId !== professionalId) return false;
      const matchDate = !brk.date || brk.date === date;
      const matchDay = brk.dayOfWeek == null || brk.dayOfWeek === dayIndex;
      if (!matchDate || !matchDay) return false;
      return label < brk.endTime && slotEndLabel > brk.startTime;
    });
    if (hasBreakConflict) { cursor += INTERVAL_MIN; continue; }

    slots.push(label);
    cursor += INTERVAL_MIN;
  }

  return slots;
}

// =====================================================================
// AI BRAIN — single call that handles the entire conversation
// =====================================================================

interface BrainOutput {
  reply: string;
  extracted: {
    clientName?: string | null;
    serviceId?: string | null;
    professionalId?: string | null;
    date?: string | null;
    time?: string | null;
    confirmed?: boolean | null;
    cancelled?: boolean | null;
    groupIntent?: boolean | null;       // client wants to book for 2+ people
    sameService?: boolean | null;       // both want the same service
    companionServiceId?: string | null; // companion's service if different
  };
}

async function callBrain(
  apiKey: string,
  tenantName: string,
  today: string,
  services: Array<{ id: string; name: string; durationMinutes: number; price: number }>,
  professionals: Array<{ id: string; name: string }>,
  history: HistoryEntry[],
  data: SessionData,
  availableSlots?: string[],
  customSystemPrompt?: string,
  shouldGreet?: boolean,
  brasiliaGreeting?: string,
  groupCtx?: string,
  nichoName?: string,
  tenantId?: string,
  phone?: string,
  isAudio?: boolean
): Promise<BrainOutput | null> {

  const svcList = services.map(s =>
    `• ${s.name} (${s.durationMinutes}min, R$${s.price.toFixed(2)}) — ID:"${s.id}"`
  ).join('\n');

  const profList = professionals.length > 0
    ? professionals.map(p => `• ${p.name} — ID:"${p.id}"`).join('\n')
    : '• (apenas um profissional disponível)';

  const known: string[] = [];
  if (data.clientName) known.push(`Nome: ${data.clientName}`);
  if (data.serviceName) known.push(`Serviço: ${data.serviceName}`);
  if (data.professionalName) known.push(`Profissional: ${data.professionalName}`);
  if (data.date) known.push(`Data: ${formatDate(data.date)}`);
  if (data.time) known.push(`Horário: ${data.time}`);

  const followUpCtx = data.pendingFollowUpType === 'reativacao'
    ? `\n📩 CONTEXTO ESPECIAL — RECUPERAÇÃO DE CLIENTE INATIVO:
• O cliente estava ausente e recebeu uma mensagem de reativação.
• Se a resposta for positiva/afirmativa → Mostre entusiasmo em recebê-lo de volta e IMEDIATAMENTE pergunte quando quer agendar (ex: "Que ótimo ter você de volta! 😊 Quando prefere vir? Temos horários disponíveis essa semana!").
• Se demonstrar interesse em serviço → inicie o fluxo de agendamento diretamente.
• Se negar ou não quiser → despeça-se com simpatia, deixe porta aberta.\n`
    : (data.pendingFollowUpType === 'aviso' || data.pendingFollowUpType === 'lembrete')
    ? `\n📩 CONTEXTO ESPECIAL — ${data.pendingFollowUpType === 'aviso' ? 'CHECK-IN DIÁRIO' : 'LEMBRETE DE AGENDAMENTO'}:
• Cliente tem agendamento${data.followUpApptTime ? ` às ${data.followUpApptTime}` : ''} e respondeu ao lembrete.
• Se confirmar presença → responda com entusiasmo confirmando o horário.
• Se quiser reagendar ou tiver dúvida → ajude imediatamente.
• NÃO inicie novo agendamento a menos que o cliente peça explicitamente.\n`
    : '';

  const slotsSection = availableSlots && availableSlots.length > 0
    ? `\nHORÁRIOS DISPONÍVEIS (use APENAS estes):\n${availableSlots.slice(0, 12).map(s => `• ${s}`).join('\n')}`
    : (data.professionalId && data.date
      ? `\n(Horários para esta data ainda não verificados — NÃO sugira horários específicos ainda)`
      : '');

  const histStr = history.slice(-10).map(h =>
    `${h.role === 'user' ? 'Cliente' : 'Agente'}: ${h.text}`
  ).join('\n');

  const isFirstMessage = history.filter(h => h.role === 'bot').length === 0;

  const greetSection = shouldGreet
    ? `\n🌅 SAUDAÇÃO DO DIA (OBRIGATÓRIA): Esta é a primeira interação com este cliente hoje. Inicie sua resposta com "${brasiliaGreeting}!" de forma natural e calorosa (ex: "${brasiliaGreeting}, tudo bem? 😊"). Faça isso UMA VEZ APENAS — nunca repita a saudação em outras respostas.\n`
    : '';

  const groupSection = groupCtx
    ? `\n👥 AGENDAMENTO EM GRUPO:\n${groupCtx}\n`
    : '';

  // ── Nicho-aware sections ─────────────────────────────────────────────
  const nicho = nichoName || 'Barbearia';
  const cfg = nichoConfigs[nicho as keyof typeof nichoConfigs] ?? nichoConfigs['Barbearia'];
  const isBrb = isBarbearia(nicho);

  // Intro line (after tenant name)
  const introLinha = cfg.introLinha;

  // Tom line inside FORMATO OBRIGATÓRIO
  const tomLine = cfg.tomFormatado;

  // Emojis hint
  const emojisHint = cfg.emojisHint;

  // Nicho-specific rules (appended to CASOS ESPECIAIS)
  const nichoRulesSection = (!isBrb && cfg.regrasEspecificas.length > 0)
    ? `\n🏷️ REGRAS DO NICHO (${nicho}):\n${cfg.regrasEspecificas.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n`
    : '';

  // Desistência / mudança de ideia — adapt farewell phrase for non-barbearia
  const farewellLine = isBrb
    ? '• "Fechou meu querido! Até a próxima 😊"'
    : '• Despeça-se com simpatia e deixe a porta aberta para um novo agendamento';

  const audioNote = isAudio
    ? `\n🎵 MENSAGEM POR ÁUDIO: A última mensagem do cliente foi enviada como áudio e transcrita automaticamente. Pode conter pequenas imprecisões de fala — interprete com flexibilidade. Responda normalmente, sem mencionar o áudio.\n`
    : '';

  const prompt = `Você é o ATENDENTE DE WHATSAPP de "${tenantName}". Hoje é ${today}.
${introLinha}
${customSystemPrompt ? `\n--- REGRAS DO ESTABELECIMENTO ---\n${customSystemPrompt}\n---\n` : ''}${followUpCtx}${audioNote}${greetSection}${groupSection}
SERVIÇOS: ${svcList}
PROFISSIONAIS: ${profList}${slotsSection}

CONTEXTO ATUAL: ${known.length > 0 ? known.join(' | ') : 'nenhuma informação coletada ainda'}
${data.pendingConfirm ? '\n⚠️ RESUMO JÁ MOSTRADO — se cliente afirmar ("sim","ok","pode","beleza","bora","fechou","isso","confirma") → "confirmed":true OBRIGATORIAMENTE.' : ''}

HISTÓRICO (mais recente no final):
${histStr}

════════════════════════════════
COMO RESPONDER — APRENDA COM HUMANOS:
════════════════════════════════

📏 FORMATO OBRIGATÓRIO:
• Máximo 2-3 linhas por mensagem
${tomLine}
• 1 emoji no máximo ${emojisHint}
• SEMPRE termine com pergunta curta ou confirmação

${isFirstMessage ? '📥 PRIMEIRA MENSAGEM: processe tudo que o cliente já informou (nome, serviço, etc.) sem perguntar de novo.\n' : ''}
📅 AO OFERECER HORÁRIO:
• ❌ ERRADO: "Temos disponível às 15:00"
• ✅ CERTO: "Com o Matheus às 15:00 pode ser? 😊"
• Sempre: PROFISSIONAL + HORÁRIO + "pode ser?" ou "serve?"

❌ QUANDO O HORÁRIO PEDIDO NÃO ESTÁ DISPONÍVEL:
1. Explique brevemente por quê: "Após as 18h não teria essa semana"
2. Ofereça o mais próximo: "Mas teria amanhã às 17:00"
3. Pergunte: "Serve??" — NUNCA assuma aceitação

✅ QUANDO CLIENTE CONFIRMA (sim/ok/pode/beleza/bora/isso):
• Defina "confirmed":true — o sistema gravará automaticamente
• Responda apenas: "Agendado! Te esperamos 😊" ou "Fechou! 👍"

🔄 QUANDO CLIENTE MUDA DE IDEIA OU DESISTE:
${farewellLine}
• Sem drama, aceite naturalmente

💡 CASOS ESPECIAIS:
• 2 serviços juntos → verifique se existe combo no cardápio, senão use o de maior duração
• 2 pessoas → siga as instruções do bloco 👥 AGENDAMENTO EM GRUPO acima
• 2 profissionais opcionais ("Matheus ou Felipe") → escolha o que tiver horário disponível
• Preço perguntado → informe direto: "O serviço está R$40,00"
• Agenda cheia → "Essa semana tá cheio, mas semana que vem teria. Vamos agendar?"
${nichoRulesSection}
════════════════════════════════
EXTRAÇÃO DE DADOS:
════════════════════════════════
• Horários em texto: "nove horas"→"09:00", "dez da manhã"→"10:00", "três da tarde"→"15:00", "meio dia"→"12:00"
• NUNCA repita perguntas sobre info já coletada no CONTEXTO ATUAL
• Use horários SOMENTE da lista disponível — nunca invente
• groupIntent: true se cliente mencionou agendar para mais de uma pessoa
• sameService: true/false se souber se as pessoas vão fazer o mesmo procedimento
• companionServiceId: ID do serviço do acompanhante (quando diferente do cliente)

RESPONDA APENAS COM JSON VÁLIDO (sem markdown, sem \`\`\`):
{"reply":"...","extracted":{"clientName":null,"serviceId":null,"professionalId":null,"date":null,"time":null,"confirmed":null,"cancelled":null,"groupIntent":null,"sameService":null,"companionServiceId":null}}`;

  try {
    if (apiKey.startsWith('sk-')) {
      // OpenAI GPT-4o Mini
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: 'Você responde APENAS com JSON válido conforme solicitado. Nenhum texto fora do JSON.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error('[callBrain] OpenAI error:', res.status, err.substring(0, 300));
        return null;
      }
      const d = await res.json();
      const result = JSON.parse(d.choices?.[0]?.message?.content || 'null') as BrainOutput;
      // ── Token tracking ──────────────────────────────────────────────
      if (tenantId) {
        logAIUsage({
          tenant_id: tenantId,
          phone_number: phone,
          input_tokens:  d.usage?.prompt_tokens     ?? estimateTokens(prompt),
          output_tokens: d.usage?.completion_tokens ?? estimateTokens(result?.reply ?? ''),
          model: 'gpt-4o-mini',
          success: !!result,
        }).catch(() => {});
      }
      return result;

    } else {
      // Gemini REST API
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        console.error('[callBrain] Gemini error:', res.status, err.substring(0, 300));
        return null;
      }
      const d = await res.json();
      const text = d.candidates?.[0]?.content?.parts?.[0]?.text || 'null';
      const result = JSON.parse(text) as BrainOutput;
      // ── Token tracking ──────────────────────────────────────────────
      if (tenantId) {
        const usage = d.usageMetadata;
        logAIUsage({
          tenant_id: tenantId,
          phone_number: phone,
          input_tokens:  usage?.promptTokenCount     ?? estimateTokens(prompt),
          output_tokens: usage?.candidatesTokenCount ?? estimateTokens(result?.reply ?? ''),
          model: 'gemini-2.0-flash',
          success: !!result,
        }).catch(() => {});
      }
      return result;
    }
  } catch (e: any) {
    console.error('[callBrain] Parse/network error:', e.message);
    return null;
  }
}

// =====================================================================
// BRASÍLIA GREETING — time-aware, once per day per phone
// =====================================================================

// Tracks which phones were greeted today (Brasília time). Lives for the browser session.
const _greetedToday = new Map<string, string>(); // "tenantId::phone" → "YYYY-MM-DD"

function getBrasiliaGreeting(): { greeting: string; dateStr: string } {
  // Brasília = UTC-3
  const b = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const h = b.getUTCHours();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    greeting: h < 12 ? 'bom dia' : h < 18 ? 'boa tarde' : 'boa noite',
    dateStr: `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`,
  };
}

// =====================================================================
// GROUP BOOKING HELPERS
// =====================================================================

/** Returns the group booking prompt context based on current session state. */
function buildGroupCtx(data: SessionData): string {
  const gb = data.groupBooking;
  if (!gb?.active) return '';

  const lines: string[] = [`Cliente quer agendar para si e para ${gb.companionDesc || 'um acompanhante'}.`];

  if (gb.sameService === undefined) {
    lines.push('PERGUNTA PENDENTE: "Os dois vão fazer o mesmo procedimento?"');
  } else if (!gb.companionServiceId) {
    lines.push('PERGUNTA PENDENTE: Qual serviço o acompanhante vai fazer? (liste os disponíveis)');
  } else if (gb.resolvedMode === 'consecutive' && gb.companion2Time) {
    lines.push(`SOLUÇÃO ENCONTRADA: mesmo profissional (${data.professionalName}) em horários consecutivos — pessoa 1 às ${data.time}, acompanhante às ${gb.companion2Time}. Apresente ao cliente e peça confirmação.`);
  } else if (gb.resolvedMode === 'parallel' && gb.companion2ProfName) {
    lines.push(`SOLUÇÃO ENCONTRADA: dois profissionais no mesmo horário — ${data.professionalName} às ${data.time} (cliente) e ${gb.companion2ProfName} às ${data.time} (acompanhante). Apresente ao cliente e peça confirmação.`);
  } else if (data.time && !gb.resolvedMode) {
    lines.push(`PROBLEMA: não há dois horários disponíveis neste horário/dia. Explique com simpatia e sugira outro horário ou outro dia. Ou, se tiver outro profissional disponível no mesmo horário, proponha a divisão ("Podemos marcar você com ${data.professionalName} e o(a) acompanhante com outro profissional às ${data.time}, pode ser?").`);
  } else {
    lines.push('Colete profissional + data + horário normalmente. O sistema resolverá o segundo horário automaticamente após você coletar esses dados.');
  }

  return lines.join(' ');
}

/** Tries to resolve the companion's slot (consecutive or parallel). */
async function resolveGroupBooking(
  tenantId: string,
  data: SessionData,
  allProfessionals: Array<{ id: string; name: string }>,
): Promise<NonNullable<SessionData['groupBooking']>> {
  const gb = data.groupBooking!;
  const duration1 = data.serviceDuration!;
  const duration2 = gb.companionServiceDuration || duration1;
  const date = data.date!;
  const time = data.time!;
  const profId = data.professionalId!;

  const pad = (n: number) => String(n).padStart(2, '0');
  const addMinutesToTime = (t: string, min: number): string => {
    const [h, m] = t.split(':').map(Number);
    const total = h * 60 + m + min;
    return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
  };

  const time2 = addMinutesToTime(time, duration1);

  // Try consecutive: same professional, slot right after person 1
  const { available: canConsec } = await db.isSlotAvailable(
    tenantId, profId, new Date(`${date}T${time2}:00`), duration2
  );
  if (canConsec) {
    console.log(`[Group] Consecutive resolved: ${time} + ${time2}`);
    return { ...gb, resolvedMode: 'consecutive', companion2Time: time2 };
  }

  // Try parallel: another professional free at the same time
  const others = allProfessionals.filter(p => p.id !== profId);
  for (const op of others) {
    const { available: canParallel } = await db.isSlotAvailable(
      tenantId, op.id, new Date(`${date}T${time}:00`), duration2
    );
    if (canParallel) {
      console.log(`[Group] Parallel resolved: ${data.professionalName} + ${op.name} at ${time}`);
      return { ...gb, resolvedMode: 'parallel', companion2ProfId: op.id, companion2ProfName: op.name };
    }
  }

  console.log(`[Group] No resolution found for ${date} ${time}`);
  return gb; // resolvedMode stays undefined → prompt will explain the issue
}

// =====================================================================
// DEDUPLICATION — two-layer system
// =====================================================================

const _recentHandled = new Map<string, number>();

function makeFingerprint(tenantId: string, phone: string, text: string): string {
  return `${tenantId}::${phone}::${text.trim().slice(0, 120)}`;
}

function isLocalDuplicate(fp: string): boolean {
  const now = Date.now();
  const last = _recentHandled.get(fp);
  if (last !== undefined && now - last < 60_000) return true;
  _recentHandled.set(fp, now);
  for (const [k, t] of _recentHandled) {
    if (now - t > 120_000) _recentHandled.delete(k);
  }
  return false;
}

// =====================================================================
// MAIN HANDLER
// =====================================================================

export async function handleMessage(
  tenant: any,
  phone: string,
  messageText: string,
  pushName?: string,
  options?: { isAudio?: boolean }
): Promise<string | null> {
  const tenantId: string = tenant.id;
  const tenantName: string = tenant.nome || tenant.name || 'Barbearia';
  const geminiKey: string = tenant.gemini_api_key || '';

  const text = messageText.trim();
  if (!text) return null;

  const lowerText = text.toLowerCase();
  const isCancellation = ['cancelar', 'cancela', 'cancele', 'cancelamento'].some(k => lowerText.includes(k));
  const isReset = ['sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer', 'restart', 'voltar ao início', 'voltar ao inicio'].some(k => lowerText.includes(k));

  // ─── Check if user is providing their cancel reason (2nd step) ─────
  const preSession = getSession(tenantId, phone);
  if (preSession?.data?.pendingCancelReason) {
    const fp0 = makeFingerprint(tenantId, phone, text);
    if (isLocalDuplicate(fp0)) return null;
    clearSession(tenantId, phone);
    try {
      const { data: customer } = await supabase
        .from('customers').select('id')
        .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
      if (customer) {
        const now0 = new Date();
        const p0 = (n: number) => String(n).padStart(2, '0');
        const nowLocal = `${now0.getFullYear()}-${p0(now0.getMonth()+1)}-${p0(now0.getDate())}T${p0(now0.getHours())}:${p0(now0.getMinutes())}:${p0(now0.getSeconds())}`;
        const { data: appts } = await supabase.from('appointments')
          .select('id, inicio').eq('tenant_id', tenantId).eq('customer_id', customer.id)
          .eq('status', AppointmentStatus.CONFIRMED).gte('inicio', nowLocal)
          .order('inicio', { ascending: true }).limit(1);
        if (appts && appts.length > 0) {
          await supabase.from('appointments').update({ status: AppointmentStatus.CANCELLED }).eq('id', appts[0].id);
          const dateFormatted = new Date((appts[0].inicio as string).substring(0,10) + 'T12:00:00')
            .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
          return `✅ Agendamento de *${dateFormatted}* cancelado com sucesso.\n\nMotivo registrado. Obrigado pelo feedback! Até a próxima. 😊`;
        }
      }
    } catch (e) { console.error('[Agent] Cancel-reason error:', e); }
    return `Cancelamento registrado! Obrigado por nos avisar. Quando precisar, estamos aqui. 😊`;
  }

  // ─── Reset — clears session immediately ────────────────────────────
  if (isReset) {
    clearSession(tenantId, phone);
    return `Tudo bem! Quando quiser agendar, é só me chamar. 😊`;
  }

  // ─── Cancellation — asks for reason first ──────────────────────────
  if (isCancellation) {
    const fp0 = makeFingerprint(tenantId, phone, text);
    if (isLocalDuplicate(fp0)) return null;
    const sess = preSession || { tenantId, phone, data: {} as SessionData, history: [], updatedAt: Date.now() };
    sess.data.pendingCancelReason = true;
    saveSession(sess as Session);
    return `Que pena que precisou cancelar! 😕\n\nPode nos contar o motivo? Isso nos ajuda a melhorar o atendimento. 🙏`;
  }

  // ─── Follow-up context reply ─────────────────────────────────────────
  // When the system (followUpService) sends aviso/lembrete/reativacao, it registers
  // context in the session. The next reply from that phone is handled here so the AI
  // doesn't treat it as a new booking attempt.
  if (preSession?.data?.pendingFollowUpType) {
    const fType = preSession.data.pendingFollowUpType;
    const norm  = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const wds   = norm.split(/\s+/);

    const AFFIRM = [
      'sim', 'ok', 'pode', 'certo', 'fechado', 'confirmado', 'confirmar', 'quero',
      'bora', 'beleza', 'combinado', 'claro', 'exato', 'correto', 'perfeito',
      'otimo', 'obrigado', 'obrigada', 'vlw', 'valeu', 'vou', 'estarei',
      'ta', 'tá', 'yes', 'vamos', 'sure', 'blz', 'ótimo', 'show', 'certo',
      'tenho', 'consigo', 'posso', 'afirmativo', 'certeza', 'com certeza',
      'até lá', 'ate la', 'estarei lá', 'estarei la', 'boa', 'tô lá', 'to la',
    ];
    const DENY = [
      'nao', 'não', 'nao posso', 'não posso', 'nope', 'negativo', 'impossivel',
      'impossível', 'nao vou', 'não vou', 'nao consigo', 'não consigo',
      'nao quero', 'não quero', 'cancela', 'cancelar',
    ];
    // Extra guard: don't intercept if client clearly wants to reschedule/book
    const hasBookingIntent = ['agendar', 'marcar', 'horario', 'horário', 'mudar', 'trocar', 'reagendar'].some(k => norm.includes(k));

    const isAffirm = !hasBookingIntent && AFFIRM.some(a => wds.includes(a) || norm === a);
    const isDeny   = DENY.some(d => wds.includes(d));

    // ── aviso / lembrete: short affirmative → just confirm presence ───
    if ((fType === 'aviso' || fType === 'lembrete') && isAffirm && wds.length <= 8) {
      const fp0 = makeFingerprint(tenantId, phone, text);
      if (isLocalDuplicate(fp0)) return null;
      const apptTime = preSession.data.followUpApptTime;
      const reply = apptTime
        ? `Perfeito! Aguardamos você às *${apptTime}*! 😊`
        : `Perfeito! Aguardamos você! 😊`;
      preSession.data.pendingFollowUpType = undefined;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: reply });
      saveSession(preSession);
      return reply;
    }

    // ── reativacao: short denial → polite dismissal ────────────────────
    if (fType === 'reativacao' && isDeny && wds.length <= 6) {
      const fp0 = makeFingerprint(tenantId, phone, text);
      if (isLocalDuplicate(fp0)) return null;
      const reply = `Tudo bem! Quando precisar, é só chamar. 😊`;
      preSession.data.pendingFollowUpType = undefined;
      preSession.history.push({ role: 'user', text }, { role: 'bot', text: reply });
      saveSession(preSession);
      return reply;
    }

    // ── Anything else (long msg, ambiguous, reativacao+positive):
    // Clear the flag and fall through — AI has full history context.
    preSession.data.pendingFollowUpType = undefined;
    saveSession(preSession);
  }

  // ─── Dedup ─────────────────────────────────────────────────────────
  const fp = makeFingerprint(tenantId, phone, text);
  if (isLocalDuplicate(fp)) return null;
  const claimed = await db.claimMessage(fp);
  if (!claimed) return null;

  // ─── Load data ─────────────────────────────────────────────────────
  const [professionals, services, settings] = await Promise.all([
    db.getProfessionals(tenantId),
    db.getServices(tenantId),
    db.getSettings(tenantId),
  ]);

  const activeProfessionals = professionals.filter((p: any) => p.active).map((p: any) => ({ ...p, name: (p.name || '').trim() }));
  const activeServices = services.filter((s: any) => s.active);
  const apiKey = (settings.openaiApiKey || '').trim() || geminiKey;

  if (!apiKey) {
    return `Erro: chave de API não configurada. Por favor, configure em Ajustes → Agente IA.`;
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayISO = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;

  const serviceOptions = activeServices.map((s: any) => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price }));
  const profOptions = activeProfessionals.map((p: any) => ({ id: p.id, name: p.name }));

  // ─── Build custom system prompt with variable substitution ──────────
  let customPrompt = (settings.systemPrompt || '').trim();
  if (customPrompt) {
    const profStr = profOptions.map(p => p.name).join(', ');
    const svcStr = activeServices.map((s: any) => `${s.name} (R$${(s.price || 0).toFixed(2)})`).join(', ');
    const hoje = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    customPrompt = customPrompt
      .replace(/\$\{tenant\.nome\}/g, tenantName)
      .replace(/\$\{hoje\}/g, hoje)
      .replace(/\$\{tenant\.nicho\}/g, tenant.nicho || 'estabelecimento')
      .replace(/\$\{profStr\}/g, profStr)
      .replace(/\$\{svcStr\}/g, svcStr);
  }

  // ─── New session — create, then let AI handle greeting + extraction ─
  let session = getSession(tenantId, phone);
  if (!session) {
    const { data: existing } = await supabase.from('customers').select('nome')
      .eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle();
    const knownName = existing?.nome || (pushName && pushName !== 'Cliente' ? pushName : null);

    session = {
      tenantId, phone,
      data: knownName ? { clientName: knownName } : {},
      history: [],
      updatedAt: Date.now(),
    };
    // No early return — fall through so callBrain processes first message naturally
  }

  // ─── Brasília greeting ──────────────────────────────────────────────
  const { greeting: brasiliaGreeting, dateStr: brasiliaDate } = getBrasiliaGreeting();
  const _greetKey = `${tenantId}::${phone}`;
  const shouldGreet = _greetedToday.get(_greetKey) !== brasiliaDate;

  // ─── Detect group booking intent from keywords ────────────────────────
  const groupKeywords = ['eu e ', 'pra mim e', 'para mim e', 'minha esposa', 'meu esposo',
    'minha namorada', 'meu namorado', 'meu filho', 'minha filha', 'meu pai', 'minha mae',
    'minha mãe', 'meu irmao', 'meu irmão', 'minha irma', 'minha irmã', 'meu amigo',
    'minha amiga', 'duas pessoas', 'dois cortes', 'nós dois', 'nos dois', 'pra dois',
    'para dois', 'pra nós', 'meu parceiro', 'minha parceira', 'meu marido', 'minha mulher'];
  const hasGroupIntent = groupKeywords.some(k => lowerText.includes(k));
  if (hasGroupIntent && !session.data.groupBooking?.active) {
    const companionMap: [string, string][] = [
      ['minha esposa', 'sua esposa'], ['meu esposo', 'seu esposo'],
      ['minha namorada', 'sua namorada'], ['meu namorado', 'seu namorado'],
      ['meu filho', 'seu filho'], ['minha filha', 'sua filha'],
      ['meu pai', 'seu pai'], ['minha mae', 'sua mãe'], ['minha mãe', 'sua mãe'],
      ['meu irmao', 'seu irmão'], ['meu irmão', 'seu irmão'],
      ['minha irma', 'sua irmã'], ['minha irmã', 'sua irmã'],
      ['meu amigo', 'seu amigo'], ['minha amiga', 'sua amiga'],
      ['meu marido', 'seu marido'], ['minha mulher', 'sua mulher'],
    ];
    const found = companionMap.find(([k]) => lowerText.includes(k));
    session.data.groupBooking = {
      active: true,
      companionDesc: found ? found[1] : 'acompanhante',
      sameService: undefined,
    };
    console.log('[Agent] Group booking detected:', session.data.groupBooking.companionDesc);
  }

  // ─── Add user message to history ───────────────────────────────────
  session.history.push({ role: 'user', text });

  // ─── Fetch available slots if we already know professional + date ──
  let prefetchedSlots: string[] | undefined;
  if (session.data.professionalId && session.data.date) {
    prefetchedSlots = await getAvailableSlots(
      tenantId, session.data.professionalId, session.data.date,
      session.data.serviceDuration || (activeServices[0]?.durationMinutes ?? 60), settings
    );
    session.data.availableSlots = prefetchedSlots;
  }

  // ─── First AI Brain call ────────────────────────────────────────────
  const tenantNicho: string = (tenant.nicho as string) || 'Barbearia';
  const groupBookingCtx = buildGroupCtx(session.data);
  let brain = await callBrain(
    apiKey, tenantName, todayISO,
    serviceOptions, profOptions,
    session.history, session.data, prefetchedSlots, customPrompt || undefined,
    shouldGreet, brasiliaGreeting, groupBookingCtx || undefined,
    tenantNicho, tenantId, phone, options?.isAudio
  );

  if (!brain) {
    const fallback = `Desculpe, tive um problema técnico. Pode repetir? 😅`;
    session.history.push({ role: 'bot', text: fallback });
    saveSession(session);
    return fallback;
  }

  // ─── Apply extractions ─────────────────────────────────────────────
  const ext = brain.extracted;

  if (ext.clientName && !session.data.clientName) {
    session.data.clientName = capitalizeName(ext.clientName.trim());
  }
  if (ext.serviceId && !session.data.serviceId) {
    const svc = activeServices.find((s: any) => s.id === ext.serviceId);
    if (svc) {
      session.data.serviceId = svc.id;
      session.data.serviceName = svc.name;
      session.data.serviceDuration = svc.durationMinutes;
      session.data.servicePrice = svc.price;
    }
  }
  if (ext.professionalId && !session.data.professionalId) {
    const prof = activeProfessionals.find((p: any) => p.id === ext.professionalId);
    if (prof) { session.data.professionalId = prof.id; session.data.professionalName = prof.name; }
  }
  // Only apply date/time if not already set
  if (ext.date && !session.data.date) session.data.date = ext.date;

  // Validate time against available slots
  const currentSlots = prefetchedSlots || [];
  if (ext.time && !session.data.time && currentSlots.length > 0) {
    const validTime = currentSlots.includes(ext.time) ? ext.time : quickTime(ext.time, currentSlots);
    if (validTime) session.data.time = validTime;
  }

  // ─── Group booking extractions ────────────────────────────────────────
  if (session.data.groupBooking?.active) {
    const gb = session.data.groupBooking;
    if (ext.sameService !== null && ext.sameService !== undefined && gb.sameService === undefined) {
      gb.sameService = ext.sameService;
      if (ext.sameService && session.data.serviceId && !gb.companionServiceId) {
        // companion uses same service as the client
        const svc = activeServices.find((s: any) => s.id === session.data.serviceId);
        if (svc) {
          gb.companionServiceId = svc.id;
          gb.companionServiceName = svc.name;
          gb.companionServiceDuration = svc.durationMinutes;
        }
      }
    }
    if (ext.companionServiceId && !gb.companionServiceId) {
      const svc = activeServices.find((s: any) => s.id === ext.companionServiceId);
      if (svc) {
        gb.companionServiceId = svc.id;
        gb.companionServiceName = svc.name;
        gb.companionServiceDuration = svc.durationMinutes;
      }
    }
  }

  // ─── If we JUST extracted professional + date, fetch slots and re-run ──
  const justGotProfAndDate = !prefetchedSlots && session.data.professionalId && session.data.date;
  if (justGotProfAndDate) {
    const newSlots = await getAvailableSlots(
      tenantId, session.data.professionalId!, session.data.date!,
      session.data.serviceDuration || (activeServices[0]?.durationMinutes ?? 60), settings
    );
    session.data.availableSlots = newSlots;

    if (newSlots.length === 0) {
      const noAvail = `Que pena! Não tem horário disponível em ${formatDate(session.data.date!)} com ${session.data.professionalName}. 😕\n\nPara qual outro dia você prefere?`;
      session.data.date = undefined;
      session.history.push({ role: 'bot', text: noAvail });
      saveSession(session);
      return noAvail;
    }

    // Try to extract time from current message against real slots (regex only, no extra AI call)
    if (!session.data.time) {
      const t = quickTime(text, newSlots);
      if (t) session.data.time = t;
    }

    // ─── Resolve companion slot if group booking data is now complete ────
    if (
      session.data.groupBooking?.active &&
      session.data.groupBooking.companionServiceId &&
      !session.data.groupBooking.resolvedMode &&
      session.data.professionalId && session.data.date && session.data.time
    ) {
      session.data.groupBooking = await resolveGroupBooking(tenantId, session.data, profOptions);
    }

    // Re-run brain with real slots so it can show a natural response with slot options
    const groupBookingCtx2 = buildGroupCtx(session.data);
    const brain2 = await callBrain(
      apiKey, tenantName, todayISO,
      serviceOptions, profOptions,
      session.history, session.data, newSlots, customPrompt || undefined,
      false, brasiliaGreeting, groupBookingCtx2 || undefined,
      tenantNicho, tenantId, phone, false
    );
    if (brain2) {
      // Apply any new extractions from second call
      if (brain2.extracted.time && !session.data.time) {
        const v2 = newSlots.includes(brain2.extracted.time) ? brain2.extracted.time : quickTime(brain2.extracted.time, newSlots);
        if (v2) session.data.time = v2;
      }
      brain = brain2;
    }
  }

  // ─── Resolve companion slot (Case B: prof+date already known, time just extracted by brain1) ─
  if (
    session.data.groupBooking?.active &&
    session.data.groupBooking.companionServiceId &&
    !session.data.groupBooking.resolvedMode &&
    !justGotProfAndDate &&
    session.data.professionalId && session.data.date && session.data.time
  ) {
    session.data.groupBooking = await resolveGroupBooking(tenantId, session.data, profOptions);
  }

  // ─── Fallback: force confirmed if pendingConfirm + affirmative message ─
  if (session.data.pendingConfirm && brain.extracted.confirmed === null) {
    const affirmWords = ['sim', 'ok', 'pode', 'confirmo', 'isso', 'exato', 'correto', 'com certeza', 'quero', 'bora', 'ta', 'tá', 'beleza', 'certo', 'fechado', 'feito', 'vamos', 'positivo', 'claro', 'confirmado', 'confirmar', 'yes', 'perfeito'];
    const normalized = lowerText.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.,!?]/g, '').trim();
    const words = normalized.split(/\s+/);
    if (affirmWords.some(a => words.includes(a) || normalized === a)) {
      console.log('[Agent] Affirmative fallback → forced confirmed=true');
      brain.extracted.confirmed = true;
    }
  }

  // ─── Handle confirmation ────────────────────────────────────────────
  if (brain.extracted.confirmed === true &&
      session.data.serviceId && session.data.professionalId &&
      session.data.date && session.data.time) {
    try {
      const startTimeStr = `${session.data.date}T${session.data.time}:00`;
      const { available } = await db.isSlotAvailable(
        tenantId, session.data.professionalId,
        new Date(startTimeStr), session.data.serviceDuration!
      );

      if (!available) {
        const freshSlots = await getAvailableSlots(
          tenantId, session.data.professionalId, session.data.date,
          session.data.serviceDuration!, settings
        );
        session.data.time = undefined;
        session.data.availableSlots = freshSlots;
        const takenMsg = freshSlots.length > 0
          ? `Ops! Esse horário foi ocupado agora. 😕 Ainda temos:\n\n${formatSlots(freshSlots.slice(0, 6))}\n\nQual você prefere?`
          : `Ops! Esse horário foi ocupado e não há mais vagas nesse dia. Para qual outro dia você prefere?`;
        if (freshSlots.length === 0) session.data.date = undefined;
        session.history.push({ role: 'bot', text: takenMsg });
        saveSession(session);
        return takenMsg;
      }

      // Check plan coverage
      const customer = await db.findOrCreateCustomer(tenantId, phone, session.data.clientName || pushName || 'Cliente');
      let isPlanAppointment = false;
      if (customer.planId) {
        const plans = await db.getPlans(tenantId);
        const activePlan = plans.find((p: any) => p.id === customer.planId);
        if (activePlan) {
          isPlanAppointment = activePlan.proceduresPerMonth === 0 ||
            (await db.getPlanUsageCount(tenantId, customer.id)) < activePlan.proceduresPerMonth;
        }
      }

      const appointment = await db.addAppointment({
        tenant_id: tenantId,
        customer_id: customer.id,
        professional_id: session.data.professionalId,
        service_id: session.data.serviceId,
        startTime: startTimeStr,
        durationMinutes: session.data.serviceDuration,
        status: AppointmentStatus.CONFIRMED,
        source: isPlanAppointment ? BookingSource.PLAN : BookingSource.AI,
        isPlan: isPlanAppointment,
      });

      if (isPlanAppointment) await db.incrementPlanUsage(tenantId, customer.id).catch(console.error);
      if (appointment) sendProfessionalNotification(appointment).catch(console.error);

      // ─── Group booking: create companion appointment ───────────────────
      let groupMsg = '';
      const gbConf = session.data.groupBooking;
      if (gbConf?.active && gbConf.resolvedMode && gbConf.companionServiceId) {
        const companionStartTime = gbConf.resolvedMode === 'consecutive'
          ? `${session.data.date}T${gbConf.companion2Time}:00`
          : `${session.data.date}T${session.data.time}:00`;
        const companionProfId = gbConf.resolvedMode === 'parallel'
          ? gbConf.companion2ProfId!
          : session.data.professionalId!;
        const companionProfName = gbConf.resolvedMode === 'parallel'
          ? gbConf.companion2ProfName!
          : session.data.professionalName!;
        try {
          const appt2 = await db.addAppointment({
            tenant_id: tenantId,
            customer_id: customer.id,
            professional_id: companionProfId,
            service_id: gbConf.companionServiceId,
            startTime: companionStartTime,
            durationMinutes: gbConf.companionServiceDuration || session.data.serviceDuration,
            status: AppointmentStatus.CONFIRMED,
            source: BookingSource.AI,
            isPlan: false,
          });
          if (appt2) sendProfessionalNotification(appt2).catch(console.error);
          const comp2Time = gbConf.resolvedMode === 'consecutive' ? gbConf.companion2Time! : session.data.time!;
          groupMsg = `\n\n👥 ${gbConf.companionDesc || 'Acompanhante'}: ${gbConf.companionServiceName} com ${companionProfName} às ${comp2Time}`;
        } catch (e: any) {
          console.error('[Agent] Group companion booking error:', e.message);
        }
      }

      clearSession(tenantId, phone);
      const planNote = isPlanAppointment ? '\n📦 _Coberto pelo seu plano._' : '';
      if (shouldGreet) _greetedToday.set(_greetKey, brasiliaDate);
      return (
        `Agendado! ✅\n\n` +
        `📅 ${formatDate(session.data.date)} às ${session.data.time}\n` +
        `✂️ ${session.data.serviceName} com ${session.data.professionalName}` +
        groupMsg +
        planNote +
        `\n\nTe esperamos! 😊`
      );
    } catch (e: any) {
      console.error('[Agent] Booking error:', e);
      return `Ocorreu um erro ao confirmar. Por favor, tente novamente.`;
    }
  }

  // ─── User rejected confirmation — keep name, reset booking data ────
  if (brain.extracted.confirmed === false) {
    const clientName = session.data.clientName;
    const h = session.history;
    clearSession(tenantId, phone);
    const newSession: Session = { tenantId, phone, data: { clientName }, history: h, updatedAt: Date.now() };
    saveSession(newSession);
    // Brain already generated a natural "no problem, let's try again" reply
  }

  // ─── Mark as pending confirm when summary was shown ────────────────
  if (brain.extracted.time || session.data.time) {
    const allKnown = session.data.serviceId && session.data.professionalId &&
      session.data.date && session.data.time;
    if (allKnown) session.data.pendingConfirm = true;
  }

  const finalReply = brain.reply;
  session.history.push({ role: 'bot', text: finalReply });
  saveSession(session);
  if (shouldGreet) _greetedToday.set(_greetKey, brasiliaDate);
  return finalReply;
}
