/**
 * AgendeZap — Agente Conversacional de Agendamento v2
 *
 * Melhorias em relação à versão anterior:
 *  - Histórico de conversa por sessão (contexto completo para extração IA)
 *  - Detecção de intenção antes da máquina de estados (HELP, BACK, GREETING)
 *  - Leitura e respeito a intervalos/breaks do settings
 *  - Detecção de plano ativo do cliente → agendamento marcado como BookingSource.PLAN
 *  - Sempre saúda com o nome da barbearia vindo do tenant
 *  - Melhor tratamento de respostas ambíguas em cada etapa
 */

import { supabase } from './supabase';
import { db } from './mockDb';
import { GoogleGenAI, Type } from '@google/genai';
import { AppointmentStatus, BookingSource, BreakPeriod } from '../types';
import { sendProfessionalNotification } from './notificationService';

// =====================================================================
// TYPES
// =====================================================================

type ConversationStep =
  | 'WAITING_NAME'
  | 'WAITING_SERVICE'
  | 'WAITING_BARBER'
  | 'WAITING_DATE'
  | 'WAITING_PERIOD'
  | 'WAITING_TIME'
  | 'WAITING_CONFIRM';

type Period = 'MANHA' | 'TARDE' | 'NOITE';

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
  date?: string;
  period?: Period;
  time?: string;
  availableSlots?: string[];
  periodSlots?: string[];
}

interface Session {
  tenantId: string;
  phone: string;
  step: ConversationStep;
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
  // Keep last 20 messages only to avoid huge prompts
  if (session.history.length > 20) session.history = session.history.slice(-20);
  sessions.set(sessionKey(session.tenantId, session.phone), session);
}

function clearSession(tenantId: string, phone: string): void {
  sessions.delete(sessionKey(tenantId, phone));
}

// =====================================================================
// AI HELPERS
// =====================================================================

async function aiExtract<T>(
  apiKey: string,
  prompt: string,
  schema: object,
  history?: HistoryEntry[]
): Promise<T | null> {
  if (!apiKey) return null;
  try {
    const ai = new GoogleGenAI({ apiKey });

    // Prepend recent conversation context so Gemini has full picture
    const contextPrefix = history && history.length > 0
      ? `Histórico recente da conversa:\n${history.slice(-6).map(h => `${h.role === 'user' ? 'Cliente' : 'Agente'}: ${h.text}`).join('\n')}\n\n`
      : '';

    const response = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: contextPrefix + prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: schema as any,
      },
    });
    return JSON.parse(response.text || 'null') as T;
  } catch (e) {
    console.error('[Agent] Gemini extraction error:', e);
    return null;
  }
}

// ─── Intent detection ────────────────────────────────────────────────

type Intent = 'RESTART' | 'HELP' | 'BACK' | 'GREETING' | 'ANSWER';

function detectIntent(text: string, step: ConversationStep): Intent {
  const lower = text.toLowerCase().trim();

  // Restart / cancel already handled upstream, but kept here too
  const RESTART = ['cancelar', 'cancela', 'cancele', 'cancelamento', 'sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer', 'restart', 'voltar ao início', 'voltar ao inicio'];
  if (RESTART.some(k => lower.includes(k))) return 'RESTART';

  const BACK = ['voltar', 'volta', 'anterior', 'mudar escolha', 'alterar escolha', 'mudar de opção', 'quero mudar'];
  if (BACK.some(k => lower.includes(k)) && step !== 'WAITING_NAME' && step !== 'WAITING_SERVICE') return 'BACK';

  const HELP = ['ajuda', 'help', 'como funciona', 'o que você faz', 'não entendi', 'nao entendi', '??'];
  if (HELP.some(k => lower.includes(k))) return 'HELP';

  // Pure greeting (very short, common phrases) — only if session has already started
  const GREETINGS = ['oi', 'olá', 'ola', 'oii', 'hey', 'bom dia', 'boa tarde', 'boa noite', 'tudo bem', 'tudo bom'];
  const isGreeting = GREETINGS.some(g => lower === g || lower.startsWith(g + ' ') || lower.startsWith(g + '!') || lower.startsWith(g + ','));
  if (isGreeting && lower.length <= 20) return 'GREETING';

  return 'ANSWER';
}

function getStepReprompt(step: ConversationStep, session: Session, activeServices: any[]): string {
  switch (step) {
    case 'WAITING_NAME': return 'Como posso te chamar?';
    case 'WAITING_SERVICE': return `Qual procedimento gostaria de agendar?`;
    case 'WAITING_BARBER': return `Qual barbeiro você prefere?`;
    case 'WAITING_DATE': return `Para qual dia você quer agendar?`;
    case 'WAITING_PERIOD': return `Qual período você prefere?\n\n${buildPeriodOptions(session.data.availableSlots || [])}`;
    case 'WAITING_TIME': return `Qual horário? Opções: ${formatSlots(session.data.periodSlots || session.data.availableSlots || [])}`;
    case 'WAITING_CONFIRM': return `Confirma o agendamento? Responda "sim" ou "não".`;
    default: return 'Pode continuar!';
  }
}

function stepBack(session: Session): { step: ConversationStep; msg: string } {
  switch (session.step) {
    case 'WAITING_BARBER': return { step: 'WAITING_SERVICE', msg: 'Voltando à escolha do serviço.' };
    case 'WAITING_DATE':   return { step: 'WAITING_BARBER',  msg: 'Voltando à escolha do barbeiro.' };
    case 'WAITING_PERIOD': return { step: 'WAITING_DATE',    msg: 'Voltando à escolha da data.' };
    case 'WAITING_TIME':   return { step: 'WAITING_PERIOD',  msg: 'Voltando à escolha do período.' };
    case 'WAITING_CONFIRM':return { step: 'WAITING_TIME',    msg: 'Voltando à escolha do horário.' };
    default:               return { step: session.step,      msg: '' };
  }
}

// ─── Name extraction ─────────────────────────────────────────────────

function capitalizeName(s: string): string {
  return s.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

async function extractName(text: string, apiKey: string, history: HistoryEntry[]): Promise<string | null> {
  const result = await aiExtract<{ name: string }>(
    apiKey,
    `O usuário foi perguntado seu nome e respondeu: "${text}". Qual é o nome próprio que ele informou? Retorne somente o nome. Se não houver nome identificável, retorne string vazia.`,
    { type: Type.OBJECT, properties: { name: { type: Type.STRING } }, required: ['name'] },
    history
  );
  if (result?.name && result.name.trim().length > 1) return capitalizeName(result.name.trim());

  const words = text.trim().split(/\s+/);
  if (words.length >= 1 && words.length <= 4 && text.trim().length <= 50 &&
    words.every(w => /^[a-záéíóúâêîôûãõçàèìòùñ'-]+$/i.test(w))) {
    return capitalizeName(text.trim());
  }
  return null;
}

// ─── Service extraction ───────────────────────────────────────────────

interface ServiceOption { id: string; name: string; durationMinutes: number; price: number; }

async function extractService(text: string, services: ServiceOption[], apiKey: string, history: HistoryEntry[]): Promise<ServiceOption | null> {
  const lower = text.toLowerCase().trim();
  const userWords = lower.split(/\s+/).filter(w => w.length >= 3);

  const fullMatch = services.find(s => lower.includes(s.name.toLowerCase()));
  if (fullMatch) return fullMatch;

  const wordMatch = services.find(s => userWords.some(word => s.name.toLowerCase().includes(word)));
  if (wordMatch) return wordMatch;

  const reverseMatch = services.find(s => s.name.toLowerCase().includes(lower));
  if (reverseMatch) return reverseMatch;

  const names = services.map(s => s.name).join(', ');
  const result = await aiExtract<{ serviceName: string }>(
    apiKey,
    `Serviços disponíveis: ${names}. O cliente escreveu: "${text}". Qual serviço da lista ele quer? Retorne o nome exato. Se não identificado, retorne string vazia.`,
    { type: Type.OBJECT, properties: { serviceName: { type: Type.STRING } }, required: ['serviceName'] },
    history
  );
  if (result?.serviceName?.trim()) {
    const nm = result.serviceName.trim().toLowerCase();
    return services.find(s => s.name.toLowerCase() === nm) ||
      services.find(s => s.name.toLowerCase().includes(nm) || nm.includes(s.name.toLowerCase())) || null;
  }
  return null;
}

// ─── Professional extraction ──────────────────────────────────────────

interface ProfessionalOption { id: string; name: string; }

async function extractProfessional(text: string, professionals: ProfessionalOption[], apiKey: string, history: HistoryEntry[]): Promise<ProfessionalOption | 'NO_PREFERENCE'> {
  const lower = text.toLowerCase();
  const noPreferenceTerms = ['qualquer', 'tanto faz', 'sem preferência', 'sem preferencia', 'indiferente', 'qualquer um', 'pode ser qualquer', 'não tenho preferência', 'nao tenho preferencia', 'não importa', 'nao importa', 'pode ser'];
  if (noPreferenceTerms.some(t => lower.includes(t))) return 'NO_PREFERENCE';

  const directMatch = professionals.find(p => lower.includes(p.name.toLowerCase()));
  if (directMatch) return directMatch;

  // Try first-name match too
  const firstNameMatch = professionals.find(p => {
    const firstName = p.name.split(' ')[0].toLowerCase();
    return firstName.length >= 3 && lower.includes(firstName);
  });
  if (firstNameMatch) return firstNameMatch;

  const names = professionals.map(p => p.name).join(', ');
  const result = await aiExtract<{ professionalName: string; noPreference: string }>(
    apiKey,
    `Barbeiros: ${names}. Cliente disse: "${text}". Ele quer algum específico? Se sim, retorne o nome exato em professionalName. Se não tem preferência, retorne "SIM" em noPreference.`,
    { type: Type.OBJECT, properties: { professionalName: { type: Type.STRING }, noPreference: { type: Type.STRING } }, required: ['professionalName', 'noPreference'] },
    history
  );
  if (result?.noPreference === 'SIM') return 'NO_PREFERENCE';
  if (result?.professionalName?.trim()) {
    const nm = result.professionalName.trim().toLowerCase();
    const found = professionals.find(p => p.name.toLowerCase() === nm) ||
      professionals.find(p => p.name.toLowerCase().includes(nm) || nm.includes(p.name.toLowerCase()));
    if (found) return found;
  }
  return 'NO_PREFERENCE';
}

// ─── Date extraction ──────────────────────────────────────────────────

async function extractDate(text: string, apiKey: string, history: HistoryEntry[]): Promise<string | null> {
  const _now = new Date();
  const _pad = (n: number) => String(n).padStart(2, '0');
  const todayISO = `${_now.getFullYear()}-${_pad(_now.getMonth() + 1)}-${_pad(_now.getDate())}`;
  const todayStr = _now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });

  const result = await aiExtract<{ date: string }>(
    apiKey,
    `Hoje é ${todayStr} (${todayISO}). O usuário disse: "${text}". Qual data ele quer para o agendamento? Formato YYYY-MM-DD. Se não identificado, retorne string vazia.`,
    { type: Type.OBJECT, properties: { date: { type: Type.STRING } }, required: ['date'] },
    history
  );
  if (result?.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date)) return result.date;

  const lower = text.toLowerCase();
  const today = new Date();
  const todayMidnight = todayISO;
  if (lower.includes('hoje')) return todayMidnight;
  if (lower.includes('amanhã') || lower.includes('amanha')) {
    const tom = new Date(today); tom.setDate(today.getDate() + 1);
    return tom.toISOString().split('T')[0];
  }
  if (lower.includes('depois de amanhã') || lower.includes('depois de amanha')) {
    const dep = new Date(today); dep.setDate(today.getDate() + 2);
    return dep.toISOString().split('T')[0];
  }

  // Weekday matching (e.g., "sexta", "sábado")
  const WEEKDAYS: Record<string, number> = {
    'domingo': 0, 'segunda': 1, 'terça': 2, 'terca': 2,
    'quarta': 3, 'quinta': 4, 'sexta': 5, 'sábado': 6, 'sabado': 6
  };
  for (const [name, target] of Object.entries(WEEKDAYS)) {
    if (lower.includes(name)) {
      const d = new Date(today);
      const diff = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return d.toISOString().split('T')[0];
    }
  }

  const matchDMY = text.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (matchDMY) {
    const d = matchDMY[1].padStart(2, '0');
    const m = matchDMY[2].padStart(2, '0');
    const y = matchDMY[3] ? (matchDMY[3].length === 2 ? '20' + matchDMY[3] : matchDMY[3]) : String(today.getFullYear());
    return `${y}-${m}-${d}`;
  }
  return null;
}

// ─── Period detection ─────────────────────────────────────────────────

function detectPeriod(text: string): Period | null {
  const lower = text.toLowerCase();
  // Use word boundary to avoid matching "manhã" inside "amanhã"
  if (/\bmanhã\b|\bmanha\b|\bcedo\b/.test(lower)) return 'MANHA';
  if (lower.includes('tarde') || lower.includes('à tarde')) return 'TARDE';
  if (lower.includes('noite') || lower.includes('à noite') || lower.includes('noturno')) return 'NOITE';
  return null;
}

function filterByPeriod(slots: string[], period: Period): string[] {
  if (period === 'MANHA') return slots.filter(s => s < '12:00');
  if (period === 'TARDE') return slots.filter(s => s >= '12:00' && s < '18:00');
  return slots.filter(s => s >= '18:00');
}

function periodLabel(period: Period): string {
  if (period === 'MANHA') return 'de manhã';
  if (period === 'TARDE') return 'à tarde';
  return 'à noite';
}

function availablePeriods(slots: string[]): string {
  const periods: string[] = [];
  if (slots.some(s => s < '12:00')) periods.push('Manhã');
  if (slots.some(s => s >= '12:00' && s < '18:00')) periods.push('Tarde');
  if (slots.some(s => s >= '18:00')) periods.push('Noite');
  return periods.join(', ') || 'Nenhum período disponível';
}

// ─── Time extraction ──────────────────────────────────────────────────

async function extractTime(text: string, availableSlots: string[], apiKey: string, history: HistoryEntry[]): Promise<string | null> {
  const trimmed = text.trim();

  // Pattern 1: "17h", "17:30", "17h30"
  const matchFull = trimmed.match(/(\d{1,2})[h:H](\d{2})?/);
  if (matchFull) {
    const h = matchFull[1].padStart(2, '0');
    const m = (matchFull[2] || '00').padStart(2, '0');
    const label = `${h}:${m}`;
    if (availableSlots.includes(label)) return label;
    const nearest = availableSlots.find(s => s >= label);
    if (nearest) return nearest;
  }

  // Pattern 2: bare integer "17", "9"
  const matchBare = trimmed.match(/^(\d{1,2})$/);
  if (matchBare) {
    const h = parseInt(matchBare[1]);
    if (h >= 0 && h <= 23) {
      const label = `${String(h).padStart(2, '0')}:00`;
      if (availableSlots.includes(label)) return label;
      const nearest = availableSlots.find(s => s >= label);
      if (nearest) return nearest;
    }
  }

  // Pattern 3: hour in text "quero às 17", "às 9 da manhã"
  const matchInText = trimmed.match(/\b(1[0-9]|2[0-3]|[89])\b/);
  if (matchInText) {
    const h = parseInt(matchInText[1]);
    const label = `${String(h).padStart(2, '0')}:00`;
    if (availableSlots.includes(label)) return label;
    const nearest = availableSlots.find(s => s >= label);
    if (nearest) return nearest;
  }

  // Fallback: AI
  const slotsStr = availableSlots.join(', ');
  const result = await aiExtract<{ time: string }>(
    apiKey,
    `Horários disponíveis: ${slotsStr}. O usuário disse: "${text}". Qual horário exato (HH:mm da lista) ele prefere? Se não identificado, retorne string vazia.`,
    { type: Type.OBJECT, properties: { time: { type: Type.STRING } }, required: ['time'] },
    history
  );
  if (result?.time && availableSlots.includes(result.time)) return result.time;
  return null;
}

// ─── Confirmation check ───────────────────────────────────────────────

async function checkConfirmation(text: string, apiKey: string, history: HistoryEntry[]): Promise<boolean | null> {
  const lower = text.toLowerCase().trim();
  const YES = ['sim', 'yes', 'confirmo', 'confirmado', 'pode', 'perfeito', 'ótimo', 'otimo', 'ok', 'certo', 'isso', 'correto', 'bora', 'vamos', 'tá', 'ta', '👍', '✅', 'pode ser', 'isso mesmo', 'exato', 'fechado', 'blz', 'beleza', 'tudo certo', 'tudo bem', 'combinado', 'marcado', 'claro', 'com certeza'];
  const NO = ['não', 'nao', 'cancela', 'errado', 'mudei', 'não quero', 'nao quero', 'desistir', 'muda', 'alterar', 'diferente', 'errada', 'incorreto', 'quero mudar'];
  if (YES.some(t => lower.includes(t))) return true;
  if (NO.some(t => lower.includes(t))) return false;

  const result = await aiExtract<{ answer: string }>(
    apiKey,
    `Perguntei se o cliente confirma o agendamento. Ele disse: "${text}". Responda com "sim", "nao" ou "incerto".`,
    { type: Type.OBJECT, properties: { answer: { type: Type.STRING, enum: ['sim', 'nao', 'incerto'] } }, required: ['answer'] },
    history
  );
  if (result?.answer === 'sim') return true;
  if (result?.answer === 'nao') return false;
  return null;
}

// =====================================================================
// AVAILABILITY — respects break periods
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

  // Use local time strings — prevents UTC offset from shifting the day boundary
  const dayStart = `${date}T00:00:00`;
  const dayEnd = `${date}T23:59:59`;

  const { data: appointments } = await supabase
    .from('appointments')
    .select('inicio, fim')
    .eq('tenant_id', tenantId)
    .eq('professional_id', professionalId)
    .neq('status', AppointmentStatus.CANCELLED)
    .gte('inicio', dayStart)
    .lte('inicio', dayEnd);

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
    const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const slotStart = new Date(`${date}T${label}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
    const slotEndLabel = `${String(slotEnd.getHours()).padStart(2, '0')}:${String(slotEnd.getMinutes()).padStart(2, '0')}`;

    // Skip past slots
    if (isToday && slotStart <= now) { cursor += INTERVAL_MIN; continue; }

    // Check existing appointments
    const hasAppConflict = (appointments || []).some((a: any) => {
      const aStart = new Date(a.inicio);
      const aEnd = new Date(a.fim);
      return aStart < slotEnd && aEnd > slotStart;
    });
    if (hasAppConflict) { cursor += INTERVAL_MIN; continue; }

    // Check break periods
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
// FORMATTING
// =====================================================================

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatSlots(slots: string[]): string {
  return slots.map(s => `• ${s}`).join('\n');
}

function buildServiceList(services: Array<{ name: string; price: number; durationMinutes: number }>): string {
  return services.map(s => `• *${s.name}*`).join('\n');
}

// Returns a bullet list of only the periods that have available slots
function buildPeriodOptions(slots: string[]): string {
  const opts: string[] = [];
  if (slots.some(s => s < '12:00')) opts.push('• Manhã');
  if (slots.some(s => s >= '12:00' && s < '18:00')) opts.push('• Tarde');
  if (slots.some(s => s >= '18:00')) opts.push('• Noite');
  return opts.join('\n') || 'Nenhum período disponível';
}

// Tries to extract a time directly from text (for flexible flow — skip period step)
// Handles: "15h", "15:00", "15h30", "15.00", bare integer "15"
function quickTime(text: string, availableSlots: string[]): string | null {
  const t = text.trim();

  // Pattern: "15h", "15:00", "15h30" — colon or h separator
  const matchColon = t.match(/(\d{1,2})[h:H](\d{2})?/);
  if (matchColon) {
    const label = `${matchColon[1].padStart(2, '0')}:${(matchColon[2] || '00').padStart(2, '0')}`;
    if (availableSlots.includes(label)) return label;
    const nearest = availableSlots.find(s => s >= label);
    if (nearest) return nearest;
  }

  // Pattern: "15.00" — dot separator (common in Brazilian writing)
  const matchDot = t.match(/\b(\d{1,2})\.(\d{2})\b/);
  if (matchDot) {
    const label = `${matchDot[1].padStart(2, '0')}:${matchDot[2]}`;
    if (availableSlots.includes(label)) return label;
    const nearest = availableSlots.find(s => s >= label);
    if (nearest) return nearest;
  }

  // Pattern: bare integer "15" — hour only
  const matchBare = t.match(/\b(1[0-9]|2[0-3]|[7-9])\b/);
  if (matchBare) {
    const label = `${String(parseInt(matchBare[1])).padStart(2, '0')}:00`;
    if (availableSlots.includes(label)) return label;
    const nearest = availableSlots.find(s => s >= label);
    if (nearest) return nearest;
  }
  return null;
}

// =====================================================================
// DEDUPLICATION — two-layer system
//
//  Layer 1 (local):  in-process Map — instant, zero network cost.
//                    Catches duplicates within the same tab/process.
//
//  Layer 2 (global): Supabase msg_dedup table with PRIMARY KEY.
//                    Atomic across ALL browser tabs and external servers.
//                    Required SQL (run once in Supabase SQL Editor):
//                      CREATE TABLE IF NOT EXISTS msg_dedup (
//                        fp text PRIMARY KEY,
//                        ts timestamptz DEFAULT now()
//                      );
// =====================================================================

const _recentHandled = new Map<string, number>(); // fingerprint → timestamp ms

function makeFingerprint(tenantId: string, phone: string, text: string): string {
  return `${tenantId}::${phone}::${text.trim().slice(0, 120)}`;
}

// Returns true if this fingerprint was already seen in THIS process within 60s.
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

  // ─── Cancellation / Reset — checked BEFORE dedup so it always fires ─
  // (the external webhook might process duplicates; we still want this to work)
  const lowerText = text.toLowerCase();
  const CANCEL_KEYWORDS = ['cancelar', 'cancela', 'cancele', 'cancelamento'];
  const RESET_KEYWORDS  = ['sair', 'reiniciar', 'recomeçar', 'recomecar', 'esquece', 'esquecer', 'restart', 'voltar ao início', 'voltar ao inicio'];
  const isCancellation  = CANCEL_KEYWORDS.some(k => lowerText.includes(k));
  const isReset         = RESET_KEYWORDS.some(k => lowerText.includes(k));

  if (isCancellation || isReset) {
    clearSession(tenantId, phone);

    if (isCancellation) {
      // Try to find and cancel the customer's next upcoming confirmed appointment
      try {
        const { data: customer } = await supabase
          .from('customers')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('telefone', phone)
          .maybeSingle();

        if (customer) {
          // Use local time string (appointments store local time, not UTC)
          const now = new Date();
          const pad = (n: number) => String(n).padStart(2, '0');
          const nowLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

          const { data: appts } = await supabase
            .from('appointments')
            .select('id, inicio')
            .eq('tenant_id', tenantId)
            .eq('customer_id', customer.id)
            .eq('status', AppointmentStatus.CONFIRMED)
            .gte('inicio', nowLocal)
            .order('inicio', { ascending: true })
            .limit(1);

          if (appts && appts.length > 0) {
            await supabase
              .from('appointments')
              .update({ status: AppointmentStatus.CANCELLED })
              .eq('id', appts[0].id);

            const dateStr = (appts[0].inicio as string).substring(0, 10);
            const dateFormatted = new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
              weekday: 'long', day: '2-digit', month: '2-digit',
            });
            return `✅ Seu agendamento de *${dateFormatted}* foi cancelado com sucesso.\n\nSempre que precisar, estamos aqui! 😊`;
          }
        }
      } catch (e) {
        console.error('[Agent] Erro ao cancelar agendamento:', e);
      }
      return `Certo! Se tiver algum agendamento, entre em contato diretamente com a gente para cancelar. 😊`;
    }

    return `Tudo bem! Quando quiser agendar, é só me chamar. 😊\n\nDigite qualquer coisa para começar.`;
  }

  // ─── Dedup layer 1: local fast-path (same process/tab) ──────────
  const fp = makeFingerprint(tenantId, phone, text);
  if (isLocalDuplicate(fp)) return null;

  // ─── Dedup layer 2: cross-process atomic Supabase claim ──────────
  // Only one tab/server can INSERT the same fingerprint (PRIMARY KEY).
  // If this returns false, another process already owns this message.
  const claimed = await db.claimMessage(fp);
  if (!claimed) return null;

  const [professionals, services, settings] = await Promise.all([
    db.getProfessionals(tenantId),
    db.getServices(tenantId),
    db.getSettings(tenantId),
  ]);

  const activeProfessionals = professionals.filter(p => p.active).map(p => ({ ...p, name: p.name.trim() }));
  const activeServices = services.filter(s => s.active);

  let session = getSession(tenantId, phone);

  // ─── NEW SESSION ──────────────────────────────────────────────────
  if (!session) {
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('nome')
      .eq('tenant_id', tenantId)
      .eq('telefone', phone)
      .maybeSingle();

    const knownName =
      existingCustomer?.nome ||
      (pushName && pushName !== 'Cliente' ? pushName : null);

    // Greeting with store name
    const greeting = `✂️ *${tenantName}*`;

    if (knownName) {
      session = { tenantId, phone, step: 'WAITING_SERVICE', data: { clientName: knownName }, history: [], updatedAt: Date.now() };
      const reply = `${greeting}\n\nOlá ${knownName}, que bom ver sua mensagem! 😊\n\nQual procedimento gostaria de agendar?`;
      session.history.push({ role: 'bot', text: reply });
      saveSession(session);
      return reply;
    } else {
      session = { tenantId, phone, step: 'WAITING_NAME', data: {}, history: [], updatedAt: Date.now() };
      const reply = `${greeting}\n\nOlá! Seja bem-vindo(a) 😊\nComo posso te chamar?`;
      session.history.push({ role: 'bot', text: reply });
      saveSession(session);
      return reply;
    }
  }

  // ─── Record user message to history ──────────────────────────────
  session.history.push({ role: 'user', text });

  // ─── Intent detection (for active sessions) ───────────────────────
  const intent = detectIntent(text, session.step);

  if (intent === 'RESTART') {
    clearSession(tenantId, phone);
    return `Tudo bem! Quando quiser agendar, é só me chamar. 😊`;
  }

  if (intent === 'HELP') {
    const helpMsg = getStepReprompt(session.step, session, activeServices);
    const reply = `Claro! Estou aqui para te ajudar a agendar seu horário na *${tenantName}*. 😊\n\n${helpMsg}`;
    session.history.push({ role: 'bot', text: reply });
    saveSession(session);
    return reply;
  }

  if (intent === 'GREETING' && session.step !== 'WAITING_NAME') {
    const reply = `Olá! Continuamos por onde paramos 😊\n\n${getStepReprompt(session.step, session, activeServices)}`;
    session.history.push({ role: 'bot', text: reply });
    saveSession(session);
    return reply;
  }

  if (intent === 'BACK') {
    const { step: prevStep, msg } = stepBack(session);
    session.step = prevStep;
    const reprompt = getStepReprompt(prevStep, session, activeServices);
    const reply = `${msg}\n\n${reprompt}`;
    session.history.push({ role: 'bot', text: reply });
    saveSession(session);
    return reply;
  }

  // ─── State Machine ─────────────────────────────────────────────────
  const h = session.history;

  switch (session.step) {

    // ── ETAPA 1: Nome ────────────────────────────────────────────────
    case 'WAITING_NAME': {
      const name = await extractName(text, geminiKey, h);
      if (!name) {
        const reply = `Não identifiquei seu nome. Como posso te chamar?`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }
      session.data.clientName = name;
      session.step = 'WAITING_SERVICE';
      const reply = `Prazer, ${name}! 😊\n\nQual procedimento gostaria de agendar?`;
      session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
    }

    // ── ETAPA 2: Serviço ─────────────────────────────────────────────
    case 'WAITING_SERVICE': {
      if (activeServices.length === 0) return `No momento não há serviços cadastrados. Entre em contato diretamente.`;

      const serviceOptions = activeServices.map(s => ({ id: s.id, name: s.name, durationMinutes: s.durationMinutes, price: s.price }));
      const service = await extractService(text, serviceOptions, geminiKey, h);
      if (!service) {
        const reply = `Não identifiquei o procedimento. Qual desses você gostaria?\n\n${buildServiceList(activeServices)}`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      session.data.serviceId = service.id;
      session.data.serviceName = service.name;
      session.data.serviceDuration = service.durationMinutes;
      session.data.servicePrice = service.price;

      if (activeProfessionals.length === 0) return `No momento não há barbeiros disponíveis. Tente novamente mais tarde.`;

      // ─── Determine professional (single, named in message, or no-preference)
      let chosenProfSvc: typeof activeProfessionals[0] | null = null;

      if (activeProfessionals.length === 1) {
        chosenProfSvc = activeProfessionals[0];
      } else {
        const msgLower = text.toLowerCase();
        const NO_PREF = ['qualquer', 'tanto faz', 'sem preferência', 'sem preferencia', 'indiferente', 'não importa', 'nao importa'];
        const hasNoPref = NO_PREF.some(t => msgLower.includes(t));
        const namedProfSvc = activeProfessionals.find(p => {
          const fn = p.name.split(' ')[0].toLowerCase();
          return msgLower.includes(p.name.toLowerCase()) || (fn.length >= 3 && msgLower.includes(fn));
        });
        if (namedProfSvc || hasNoPref) chosenProfSvc = namedProfSvc || activeProfessionals[0];
      }

      if (!chosenProfSvc) {
        // Multiple professionals, none identified — try to carry date forward before asking
        const earlyDateSvc = await extractDate(text, geminiKey, h);
        if (earlyDateSvc) {
          const earlyObj = new Date(earlyDateSvc + 'T12:00:00');
          const todayMidnightE = new Date(); todayMidnightE.setHours(0, 0, 0, 0);
          if (earlyObj >= todayMidnightE) session.data.date = earlyDateSvc; // carry to WAITING_BARBER
        }
        session.step = 'WAITING_BARBER';
        const profList = activeProfessionals.map(p => `• ${p.name}`).join('\n');
        const reply = `Com qual barbeiro você prefere?\n\n${profList}\n\n_Ou diga "tanto faz" para escolhermos para você._`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      session.data.professionalId = chosenProfSvc.id;
      session.data.professionalName = chosenProfSvc.name;

      // ─── Flexible: try to extract date (and time) from same message
      const dateInSvcMsg = await extractDate(text, geminiKey, h);
      if (dateInSvcMsg) {
        const dateObjSvc = new Date(dateInSvcMsg + 'T12:00:00');
        const todayMidnightSvc = new Date(); todayMidnightSvc.setHours(0, 0, 0, 0);
        const dayCfgSvc = settings.operatingHours?.[dateObjSvc.getDay()];
        if (dateObjSvc >= todayMidnightSvc && dayCfgSvc?.active) {
          const slotsSvc = await getAvailableSlots(tenantId, chosenProfSvc.id, dateInSvcMsg, service.durationMinutes, settings);
          session.data.date = dateInSvcMsg;
          session.data.availableSlots = slotsSvc;
          if (slotsSvc.length === 0) {
            session.step = 'WAITING_DATE';
            const reply = `Com *${chosenProfSvc.name}*. Não há horários disponíveis em *${formatDate(dateInSvcMsg)}*. Escolha outro dia.`;
            session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
          }
          const timeInSvcMsg = quickTime(text, slotsSvc);
          if (timeInSvcMsg) {
            session.data.time = timeInSvcMsg;
            session.step = 'WAITING_CONFIRM';
            const reply = `Perfeito! Ficou assim:\n\n📅 *Dia:* ${formatDate(dateInSvcMsg)}\n⏰ *Horário:* ${timeInSvcMsg}\n✂️ *Procedimento:* ${service.name}\n💈 *Barbeiro:* ${chosenProfSvc.name}\n\nEstá tudo certo? *(sim / não)*`;
            session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
          }
          const periodInSvcMsg = detectPeriod(text);
          if (periodInSvcMsg) {
            const pfiltSvc = filterByPeriod(slotsSvc, periodInSvcMsg);
            if (pfiltSvc.length > 0) {
              session.data.period = periodInSvcMsg;
              session.data.periodSlots = pfiltSvc;
              session.step = 'WAITING_TIME';
              const reply = `*${formatDate(dateInSvcMsg)}* com *${chosenProfSvc.name}*.\n\nHorários disponíveis ${periodLabel(periodInSvcMsg)}:\n\n${formatSlots(pfiltSvc)}\n\nQual horário você prefere?`;
              session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
            }
          }
          session.step = 'WAITING_PERIOD';
          const reply = `*${formatDate(dateInSvcMsg)}* com *${chosenProfSvc.name}*.\n\nQual período você prefere?\n\n${buildPeriodOptions(slotsSvc)}`;
          session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
        }
      }

      // Prof known, no date in message — ask for date
      session.step = 'WAITING_DATE';
      const reply = `Com *${chosenProfSvc.name}*. Para qual dia você deseja agendar?`;
      session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
    }

    // ── ETAPA 3: Barbeiro ─────────────────────────────────────────────
    case 'WAITING_BARBER': {
      const profOptions = activeProfessionals.map(p => ({ id: p.id, name: p.name }));
      const profResult = await extractProfessional(text, profOptions, geminiKey, h);
      const chosen = profResult === 'NO_PREFERENCE' ? activeProfessionals[0] : profResult;
      session.data.professionalId = chosen.id;
      session.data.professionalName = chosen.name;

      const barberPrefix = profResult === 'NO_PREFERENCE' ? `Selecionamos *${chosen.name}*.` : `Com *${chosen.name}*.`;

      // ─── Priority 1: date was carried from a previous step (e.g. "corte amanhã" with multi-pro)
      const carriedDate = session.data.date || null;
      if (carriedDate) {
        const dateObjCarried = new Date(carriedDate + 'T12:00:00');
        const todayMidnightC = new Date(); todayMidnightC.setHours(0, 0, 0, 0);
        if (dateObjCarried >= todayMidnightC) {
          const slotsC = await getAvailableSlots(tenantId, chosen.id, carriedDate, session.data.serviceDuration || 60, settings);
          session.data.availableSlots = slotsC;
          if (slotsC.length === 0) {
            session.data.date = undefined;
            session.step = 'WAITING_DATE';
            const reply = `${barberPrefix} Infelizmente não há horários disponíveis em *${formatDate(carriedDate)}*. Para qual dia você prefere?`;
            session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
          }
          const timeCarried = quickTime(text, slotsC);
          if (timeCarried) {
            session.data.time = timeCarried;
            session.step = 'WAITING_CONFIRM';
            const reply = `Perfeito! Ficou assim:\n\n📅 *Dia:* ${formatDate(carriedDate)}\n⏰ *Horário:* ${timeCarried}\n✂️ *Procedimento:* ${session.data.serviceName}\n💈 *Barbeiro:* ${chosen.name}\n\nEstá tudo certo? *(sim / não)*`;
            session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
          }
          const periodInCarried = detectPeriod(text);
          if (periodInCarried) {
            const pfiltC = filterByPeriod(slotsC, periodInCarried);
            if (pfiltC.length > 0) {
              session.data.period = periodInCarried;
              session.data.periodSlots = pfiltC;
              session.step = 'WAITING_TIME';
              const reply = `${barberPrefix} *${formatDate(carriedDate)}*.\n\nHorários disponíveis ${periodLabel(periodInCarried)}:\n\n${formatSlots(pfiltC)}\n\nQual horário você prefere?`;
              session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
            }
          }
          session.step = 'WAITING_PERIOD';
          const reply = `${barberPrefix} *${formatDate(carriedDate)}*.\n\nQual período você prefere?\n\n${buildPeriodOptions(slotsC)}`;
          session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
        } else {
          session.data.date = undefined; // carried date is in the past — discard it
        }
      }

      // ─── Priority 2: try to extract date (and time) from this same message
      const dateInBarberMsg = await extractDate(text, geminiKey, h);
      if (dateInBarberMsg) {
        const dateObjB = new Date(dateInBarberMsg + 'T12:00:00');
        const todayMidnightB = new Date(); todayMidnightB.setHours(0, 0, 0, 0);
        const dayCfgB = settings.operatingHours?.[dateObjB.getDay()];
        if (dateObjB >= todayMidnightB && dayCfgB?.active) {
          const slotsB = await getAvailableSlots(tenantId, chosen.id, dateInBarberMsg, session.data.serviceDuration || 60, settings);
          session.data.date = dateInBarberMsg;
          session.data.availableSlots = slotsB;
          if (slotsB.length === 0) {
            session.step = 'WAITING_DATE';
            const reply = `${barberPrefix} Não há horários disponíveis em *${formatDate(dateInBarberMsg)}*. Escolha outro dia.`;
            session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
          }
          const timeInBarberMsg = quickTime(text, slotsB);
          if (timeInBarberMsg) {
            session.data.time = timeInBarberMsg;
            session.step = 'WAITING_CONFIRM';
            const reply = `Perfeito! Ficou assim:\n\n📅 *Dia:* ${formatDate(dateInBarberMsg)}\n⏰ *Horário:* ${timeInBarberMsg}\n✂️ *Procedimento:* ${session.data.serviceName}\n💈 *Barbeiro:* ${chosen.name}\n\nEstá tudo certo? *(sim / não)*`;
            session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
          }
          const periodInBarber = detectPeriod(text);
          if (periodInBarber) {
            const pfiltB = filterByPeriod(slotsB, periodInBarber);
            if (pfiltB.length > 0) {
              session.data.period = periodInBarber;
              session.data.periodSlots = pfiltB;
              session.step = 'WAITING_TIME';
              const reply = `${barberPrefix} *${formatDate(dateInBarberMsg)}*.\n\nHorários disponíveis ${periodLabel(periodInBarber)}:\n\n${formatSlots(pfiltB)}\n\nQual horário você prefere?`;
              session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
            }
          }
          session.step = 'WAITING_PERIOD';
          const reply = `${barberPrefix} *${formatDate(dateInBarberMsg)}*.\n\nQual período você prefere?\n\n${buildPeriodOptions(slotsB)}`;
          session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
        }
      }

      // ─── Priority 3: barber chosen but no date anywhere — ask for it
      session.step = 'WAITING_DATE';
      const prefix = profResult === 'NO_PREFERENCE' ? `Certo! Selecionamos *${chosen.name}*. 👍` : `Ótimo! Agendaremos com *${chosen.name}*. 💈`;
      const reply = `${prefix}\n\nPara qual dia você deseja agendar?`;
      session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
    }

    // ── ETAPA 4: Data ─────────────────────────────────────────────────
    case 'WAITING_DATE': {
      const dateStr = await extractDate(text, geminiKey, h);
      if (!dateStr) {
        const reply = `Não entendi a data. Pode informar o dia? Ex: "amanhã", "sexta", "15/03".`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      const dateObj = new Date(dateStr + 'T12:00:00');
      const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
      if (dateObj < todayMidnight) {
        const reply = `Essa data já passou. Escolha uma data futura.`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      const dayIndex = dateObj.getDay();
      const dayConfig = settings.operatingHours?.[dayIndex];
      if (!dayConfig?.active) {
        const DAY_NAMES_PT = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
        const reply = `Não atendemos ${DAY_NAMES_PT[dayIndex]}. Pode escolher outro dia?`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      const slots = await getAvailableSlots(tenantId, session.data.professionalId!, dateStr, session.data.serviceDuration!, settings);
      session.data.date = dateStr;
      session.data.availableSlots = slots;

      if (slots.length === 0) {
        const reply = `Infelizmente não há horários disponíveis em *${formatDate(dateStr)}* com *${session.data.professionalName}*. Pode escolher outro dia?`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      // Check if user also included a time in the same message (flexible flow)
      const timeInMsg = quickTime(text, slots);
      if (timeInMsg) {
        session.data.time = timeInMsg;
        session.step = 'WAITING_CONFIRM';
        const reply =
          `Perfeito! Ficou assim:\n\n` +
          `📅 *Dia:* ${formatDate(dateStr)}\n` +
          `⏰ *Horário:* ${timeInMsg}\n` +
          `✂️ *Procedimento:* ${session.data.serviceName}\n` +
          `💈 *Barbeiro:* ${session.data.professionalName}\n\n` +
          `Está tudo certo? *(sim / não)*`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      // Check if user also mentioned a period in the same message (e.g. "amanhã à tarde")
      const periodInDateMsg = detectPeriod(text);
      if (periodInDateMsg) {
        const pfiltDate = filterByPeriod(slots, periodInDateMsg);
        if (pfiltDate.length > 0) {
          session.data.period = periodInDateMsg;
          session.data.periodSlots = pfiltDate;
          session.step = 'WAITING_TIME';
          const reply = `*${formatDate(dateStr)}* com *${session.data.professionalName}*.\n\nHorários disponíveis ${periodLabel(periodInDateMsg)}:\n\n${formatSlots(pfiltDate)}\n\nQual horário você prefere?`;
          session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
        }
      }

      session.step = 'WAITING_PERIOD';
      const periodOpts = buildPeriodOptions(slots);
      const reply = `*${formatDate(dateStr)}* com *${session.data.professionalName}*.\n\nQual período você prefere?\n\n${periodOpts}`;
      session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
    }

    // ── ETAPA 5: Período ──────────────────────────────────────────────
    case 'WAITING_PERIOD': {
      const allSlots = session.data.availableSlots || [];

      // If user typed a specific time directly, skip period selection (flexible flow)
      const directTime = quickTime(text, allSlots);
      if (directTime) {
        session.data.time = directTime;
        session.step = 'WAITING_CONFIRM';
        const reply =
          `Perfeito! Ficou assim:\n\n` +
          `📅 *Dia:* ${formatDate(session.data.date!)}\n` +
          `⏰ *Horário:* ${directTime}\n` +
          `✂️ *Procedimento:* ${session.data.serviceName}\n` +
          `💈 *Barbeiro:* ${session.data.professionalName}\n\n` +
          `Está tudo certo? *(sim / não)*`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      const lower = text.toLowerCase();
      const anyPeriod = ['qualquer', 'tanto faz', 'indiferente', 'qualquer um', 'pode ser', 'qualquer horário', 'sem preferencia', 'sem preferência'];
      if (anyPeriod.some(t => lower.includes(t))) {
        session.data.periodSlots = allSlots;
        session.step = 'WAITING_TIME';
        const reply = `Horários disponíveis com *${session.data.professionalName}*:\n\n${formatSlots(allSlots)}\n\nQual horário você prefere?`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      const period = detectPeriod(text);
      if (!period) {
        const reply = `Qual período você prefere?\n\n${buildPeriodOptions(allSlots)}`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      const filtered = filterByPeriod(allSlots, period);
      if (filtered.length === 0) {
        const reply = `Não há horários disponíveis ${periodLabel(period)}. Qual período você prefere?\n\n${buildPeriodOptions(allSlots)}`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      session.data.period = period;
      session.data.periodSlots = filtered;
      session.step = 'WAITING_TIME';
      const reply = `Horários disponíveis ${periodLabel(period)} com *${session.data.professionalName}*:\n\n${formatSlots(filtered)}\n\nQual horário você prefere?`;
      session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
    }

    // ── ETAPA 6: Horário ──────────────────────────────────────────────
    case 'WAITING_TIME': {
      const slots = session.data.periodSlots || session.data.availableSlots || [];
      if (slots.length === 0) {
        session.step = 'WAITING_DATE';
        const reply = `Não há horários disponíveis. Para qual dia você gostaria de agendar?`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      const time = await extractTime(text, slots, geminiKey, h);
      if (!time) {
        const reply = `Não identifiquei o horário. Disponíveis:\n\n${formatSlots(slots)}\n\nQual você prefere?`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      if (!slots.includes(time)) {
        const nearby = slots.slice(0, 3);
        const reply = `O horário ${time} não está disponível. Os mais próximos são:\n\n${formatSlots(nearby)}\n\nQual você prefere?`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      session.data.time = time;
      session.step = 'WAITING_CONFIRM';
      const reply =
        `Perfeito! Então ficou assim:\n\n` +
        `📅 *Dia:* ${formatDate(session.data.date!)}\n` +
        `⏰ *Horário:* ${time}\n` +
        `✂️ *Procedimento:* ${session.data.serviceName}\n` +
        `💈 *Barbeiro:* ${session.data.professionalName}\n\n` +
        `Está tudo certo? *(sim / não)*`;
      session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
    }

    // ── ETAPA 7: Confirmação ──────────────────────────────────────────
    case 'WAITING_CONFIRM': {
      const confirmed = await checkConfirmation(text, geminiKey, h);
      if (confirmed === null) {
        const reply = `Por favor, confirme com "sim" ou "não". 😊`;
        session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
      }

      if (!confirmed) {
        const clientName = session.data.clientName;
        clearSession(tenantId, phone);
        const newSession: Session = { tenantId, phone, step: 'WAITING_SERVICE', data: { clientName }, history: h, updatedAt: Date.now() };
        saveSession(newSession);
        const reply = `Sem problema! Vamos recomeçar. Qual procedimento gostaria de agendar?`;
        newSession.history.push({ role: 'bot', text: reply }); saveSession(newSession); return reply;
      }

      try {
        const startTimeStr = `${session.data.date}T${session.data.time}:00`;
        const startTime = new Date(startTimeStr);

        const { available } = await db.isSlotAvailable(tenantId, session.data.professionalId!, startTime, session.data.serviceDuration!);
        if (!available) {
          // Don't clear session — recover context and offer remaining slots
          const conflictTime = session.data.time;
          session.data.time = undefined;
          session.data.period = undefined;
          const freshSlots = await getAvailableSlots(
            tenantId, session.data.professionalId!, session.data.date!,
            session.data.serviceDuration!, settings
          );
          session.data.availableSlots = freshSlots;
          if (freshSlots.length === 0) {
            session.data.date = undefined;
            session.step = 'WAITING_DATE';
            const reply = `Ops! O horário *${conflictTime}* acabou de ser ocupado e não há mais disponibilidade nesse dia com *${session.data.professionalName}*. 😕\n\nPara qual outro dia você prefere?`;
            session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
          }
          session.step = 'WAITING_PERIOD';
          const reply = `Ops! O horário *${conflictTime}* acabou de ser ocupado. 😕\n\nAinda temos estes horários em *${formatDate(session.data.date!)}* com *${session.data.professionalName}*:\n\n${buildPeriodOptions(freshSlots)}\n\nQual período você prefere?`;
          session.history.push({ role: 'bot', text: reply }); saveSession(session); return reply;
        }

        // Check if customer has an active plan with remaining procedures
        const customer = await db.findOrCreateCustomer(tenantId, phone, session.data.clientName || 'Cliente');
        let isPlanAppointment = false;

        if (customer.planId) {
          const plans = await db.getPlans(tenantId);
          const activePlan = plans.find(p => p.id === customer.planId);
          if (activePlan && activePlan.proceduresPerMonth > 0) {
            const usedCount = await db.getPlanUsageCount(tenantId, customer.id);
            if (usedCount < activePlan.proceduresPerMonth) {
              isPlanAppointment = true;
            }
          } else if (activePlan) {
            // Plan with no procedure limit — always covered
            isPlanAppointment = true;
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
          isPlan: isPlanAppointment
        });

        if (isPlanAppointment) {
          await db.incrementPlanUsage(tenantId, customer.id).catch(err =>
            console.error('[Agent] Erro ao registrar uso do plano:', err)
          );
        }

        if (appointment) {
          sendProfessionalNotification(appointment).catch(err =>
            console.error('[Agent] Erro ao notificar profissional:', err)
          );
        }

        clearSession(tenantId, phone);
        const planNote = isPlanAppointment ? '\n\n📦 _Este agendamento está coberto pelo seu plano._' : '';
        return (
          `✅ *Agendamento confirmado!*\n\n` +
          `📅 *Dia:* ${formatDate(session.data.date!)}\n` +
          `⏰ *Horário:* ${session.data.time}\n` +
          `✂️ *Procedimento:* ${session.data.serviceName}\n` +
          `💈 *Barbeiro:* ${session.data.professionalName}` +
          planNote +
          `\n\nTe esperamos! Qualquer dúvida é só chamar. 😊`
        );
      } catch (e: any) {
        console.error('[Agent] Erro ao criar agendamento:', e);
        return `Ocorreu um erro ao confirmar o agendamento. Por favor, tente novamente.`;
      }
    }
  }

  return null;
}
