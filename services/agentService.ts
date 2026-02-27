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
  customSystemPrompt?: string
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

  const slotsSection = availableSlots && availableSlots.length > 0
    ? `\nHORÁRIOS DISPONÍVEIS (use APENAS estes):\n${availableSlots.slice(0, 12).map(s => `• ${s}`).join('\n')}`
    : (data.professionalId && data.date
      ? `\n(Horários para esta data ainda não verificados — NÃO sugira horários específicos ainda)`
      : '');

  const histStr = history.slice(-10).map(h =>
    `${h.role === 'user' ? 'Cliente' : 'Agente'}: ${h.text}`
  ).join('\n');

  const isFirstMessage = history.filter(h => h.role === 'bot').length === 0;

  const prompt = `Você é o assistente de agendamentos de "${tenantName}". Hoje é ${today}. Responda SEMPRE em português brasileiro informal e natural.
${customSystemPrompt ? `\n--- PERSONALIDADE E REGRAS DO ESTABELECIMENTO ---\n${customSystemPrompt}\n--- FIM ---\n` : ''}

SERVIÇOS DISPONÍVEIS:
${svcList}

PROFISSIONAIS DISPONÍVEIS:
${profList}
${slotsSection}

INFORMAÇÕES JÁ COLETADAS (NÃO pergunte novamente sobre estas):
${known.length > 0 ? known.join('\n') : '(nenhuma ainda)'}
${data.pendingConfirm ? '\n⚠️ ATENÇÃO: O resumo do agendamento JÁ foi mostrado. Se o cliente responder "sim", "ok", "pode", "confirmo", "isso", "beleza", "certo", "fechado", "tá", "ta", "bora", "quero" ou qualquer afirmação → defina "confirmed": true OBRIGATORIAMENTE e gere mensagem de aguardo. NÃO volte a pedir confirmação.' : ''}

HISTÓRICO DA CONVERSA (mais recente no final):
${histStr}

═══════════════════════════════════════
REGRAS DE EXTRAÇÃO — SIGA À RISCA:
═══════════════════════════════════════
${isFirstMessage ? '• Esta é a PRIMEIRA mensagem — cumprimente o cliente pelo nome (se conhecido) e processe a solicitação.\n' : ''}
• SEMPRE analise o histórico COMPLETO, não apenas a última mensagem
• Extraia horários em texto: "nove horas"→"09:00", "dez da manhã"→"10:00", "três da tarde"→"15:00", "duas"→"14:00"
• Se o cliente já deu serviço + profissional + data + horário em mensagens anteriores → VEJA "INFORMAÇÕES JÁ COLETADAS"
• NUNCA repita perguntas sobre info que já está em "INFORMAÇÕES JÁ COLETADAS"

LÓGICA DE RESPOSTA:
1. Se TODAS as infos estão coletadas (serviço + profissional + data + horário) → mostre o RESUMO e peça confirmação
2. Se falta apenas UMA info → peça só ela, confirmando o resto
3. Se falta MAIS de uma info mas o cliente deu tudo de uma vez → agradeça e mostre o resumo
4. Se o horário pedido não está na lista de disponíveis → ofereça os 2-3 mais próximos
5. NÃO invente horários — use APENAS os da lista de disponíveis
6. ✅ CONFIRMAÇÃO: Se resumo já foi apresentado E cliente responde afirmativamente ("sim","ok","pode","confirmo","isso","beleza","certo","bora","quero","claro","tá bom") → "confirmed": true. NÃO peça confirmação de novo.

TOM: Natural, humano, brasileiro. Máximo 3 linhas. 1-2 emojis.

RESPONDA APENAS COM JSON VÁLIDO (sem markdown, sem \`\`\`):
{
  "reply": "sua mensagem natural para o cliente",
  "extracted": {
    "clientName": null,
    "serviceId": null,
    "professionalId": null,
    "date": null,
    "time": null,
    "confirmed": null,
    "cancelled": null
  }
}`;

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
      return JSON.parse(d.choices?.[0]?.message?.content || 'null') as BrainOutput;

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
      return JSON.parse(text) as BrainOutput;
    }
  } catch (e: any) {
    console.error('[callBrain] Parse/network error:', e.message);
    return null;
  }
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
  pushName?: string
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
  let brain = await callBrain(
    apiKey, tenantName, todayISO,
    serviceOptions, profOptions,
    session.history, session.data, prefetchedSlots, customPrompt || undefined
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

    // Re-run brain with real slots so it can show a natural response with slot options
    const brain2 = await callBrain(
      apiKey, tenantName, todayISO,
      serviceOptions, profOptions,
      session.history, session.data, newSlots, customPrompt || undefined
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

      clearSession(tenantId, phone);
      const planNote = isPlanAppointment ? '\n\n📦 _Este agendamento está coberto pelo seu plano._' : '';
      return (
        `✅ *Agendamento confirmado!*\n\n` +
        `📅 *Dia:* ${formatDate(session.data.date)}\n` +
        `⏰ *Horário:* ${session.data.time}\n` +
        `✂️ *Procedimento:* ${session.data.serviceName}\n` +
        `💈 *Barbeiro:* ${session.data.professionalName}` +
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
  return finalReply;
}
