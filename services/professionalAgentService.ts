/**
 * AgendeZap — Agente Conversacional para Profissionais
 *
 * Quando um barbeiro envia mensagem para o número da barbearia, o sistema o
 * identifica pelo telefone cadastrado e entra neste modo (em vez do fluxo
 * de agendamento para clientes).
 *
 * Roles:
 *   admin  → acesso total: próprios dados + outros barbeiros + financeiro
 *   colab  → acesso restrito: apenas seus próprios agendamentos e estatísticas
 *
 * Comandos suportados:
 *   • "Quem atendo hoje/amanhã/sexta?"
 *   • "Quantos procedimentos fiz essa semana/mês passado?"
 *   • "Marca [cliente] [data] às [hora]" (e confirma horário alternativo)
 *   • "Faturamento desta semana/mês" (admin only)
 *   • "Quanto o [barbeiro] fez?" (admin only)
 */

import { supabase } from './supabase';
import { db } from './mockDb';
import { GoogleGenAI, Type } from '@google/genai';
import { AppointmentStatus, BookingSource } from '../types';

// =====================================================================
// HELPERS
// =====================================================================

const _pad = (n: number) => String(n).padStart(2, '0');

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function datePT(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit',
  });
}

// =====================================================================
// PROFESSIONAL SESSION (pending booking confirmation)
// =====================================================================

interface PendingBook {
  clientName: string;
  date: string;
  suggestedTime: string;
  serviceId: string;
  serviceName: string;
  serviceDuration: number;
  profId: string;
}

interface ProfSession {
  pendingBook: PendingBook | null;
  updatedAt: number;
}

const profSessions = new Map<string, ProfSession>();
const PROF_SESSION_TTL = 5 * 60 * 1000; // 5 minutes

function getProfSession(tenantId: string, phone: string): ProfSession {
  const key = `${tenantId}::${phone}`;
  const s = profSessions.get(key);
  if (!s || Date.now() - s.updatedAt > PROF_SESSION_TTL) return { pendingBook: null, updatedAt: 0 };
  return s;
}

function saveProfSession(tenantId: string, phone: string, session: ProfSession) {
  profSessions.set(`${tenantId}::${phone}`, { ...session, updatedAt: Date.now() });
}

function clearProfSession(tenantId: string, phone: string) {
  profSessions.delete(`${tenantId}::${phone}`);
}

// =====================================================================
// INTENT CLASSIFICATION
// =====================================================================

type ProfIntentType = 'LIST_APPOINTMENTS' | 'COUNT_PROCEDURES' | 'BOOK' | 'CONFIRM_BOOK' | 'FINANCIAL' | 'HELP';

interface ProfIntent {
  intent: ProfIntentType;
  /** 'today' | 'tomorrow' | 'this_week' | 'last_week' | 'this_month' | 'last_month' | 'YYYY-MM-DD' */
  dateRef: string;
  clientName: string;
  time: string;         // HH:mm
  serviceRef: string;   // service name hint (optional)
  targetProfName: string; // admin asking about a specific barber
}

/** Resolve dateRef from raw text — works with or without accents */
function resolveDateRefFromText(lower: string): string {
  if (lower.includes('amanhã') || lower.includes('amanha')) return 'tomorrow';
  if (lower.includes('semana pass') || lower.includes('semana anterior')) return 'last_week';
  if (lower.includes('essa semana') || lower.includes('esta semana') || lower.includes('semana atual')) return 'this_week';
  if (lower.includes('mes pass') || lower.includes('mês pass') || lower.includes('mes anterior') || lower.includes('mês anterior')) return 'last_month';
  if (lower.includes('esse mes') || lower.includes('este mes') || lower.includes('esse mês') || lower.includes('este mês') || lower.includes('mes atual') || lower.includes('mês atual')) return 'this_month';
  if (lower.includes('hoje')) return 'today';
  // Day of week
  const DAYS: [string, string][] = [['domingo','0'],['segunda','1'],['terca','2'],['terça','2'],['quarta','3'],['quinta','4'],['sexta','5'],['sabado','6'],['sábado','6']];
  for (const [name] of DAYS) if (lower.includes(name)) return name;
  return 'today';
}

async function classifyIntent(text: string, apiKey: string, today: string): Promise<ProfIntent> {
  const fallback: ProfIntent = { intent: 'HELP', dateRef: 'today', clientName: '', time: '', serviceRef: '', targetProfName: '' };
  const lower = text.toLowerCase().trim();

  // 1. Confirmation (always rule-based, must be exact)
  if (/^(sim|yes|confirma|confirmado|pode|ok|bora|s|yep)[\s!.]*$/.test(lower)) {
    return { ...fallback, intent: 'CONFIRM_BOOK' };
  }

  // 2. Numbered shortcuts: "1 amanhã", "2 essa semana", "3 gustavo sexta 17h", "4 este mês", "5 irineu"
  const shortcutMatch = lower.match(/^([1-5])\s*(.*)/s);
  if (shortcutMatch) {
    const num = shortcutMatch[1];
    const rest = shortcutMatch[2].trim();
    const shortDateRef = rest ? resolveDateRefFromText(rest) : 'today';
    if (num === '1') return { ...fallback, intent: 'LIST_APPOINTMENTS', dateRef: shortDateRef };
    if (num === '2') return { ...fallback, intent: 'COUNT_PROCEDURES', dateRef: shortDateRef };
    if (num === '4') return { ...fallback, intent: 'FINANCIAL', dateRef: shortDateRef };
    if (num === '5') {
      // "5 irineu" or "5 irineu amanhã"
      const profName = rest.split(/\s+(hoje|amanha|amanhã|essa|esta|semana|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)/i)[0].trim();
      return { ...fallback, intent: 'LIST_APPOINTMENTS', targetProfName: profName, dateRef: shortDateRef };
    }
    if (num === '3') {
      // "3 gustavo amanhã 17:00"
      const timeMatch = rest.match(/(\d{1,2})[h:](\d{2})?/);
      const parsedTime = timeMatch
        ? `${timeMatch[1].padStart(2, '0')}:${(timeMatch[2] || '00').padStart(2, '0')}`
        : '';
      const bookDateRef = resolveDateRefFromText(rest);
      const clientName = rest
        .replace(/(\d{1,2})[h:]\d{0,2}/g, '')
        .replace(/\b(amanha|amanhã|hoje|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo|essa semana|esta semana)\b/gi, '')
        .trim();
      return { ...fallback, intent: 'BOOK', clientName, time: parsedTime, dateRef: bookDateRef };
    }
  }

  const dateRef = resolveDateRefFromText(lower);

  // 3. Context continuations: "e o irineu?" / "e a maria?" / "e os outros barbeiros?"
  if (/^e\s+(o|a|os|as)\s+/.test(lower)) {
    const nameMatch = lower.match(/^e\s+(?:o|a|os|as)\s+([\w\s]+?)[\?\!\.\s]*$/);
    if (nameMatch) {
      const target = nameMatch[1].trim();
      if (/^outros(\s+barbeiros?)?$/.test(target) || target === 'outras') {
        return { ...fallback, intent: 'LIST_APPOINTMENTS', targetProfName: '__ALL__', dateRef };
      }
      return { ...fallback, intent: 'LIST_APPOINTMENTS', targetProfName: target, dateRef };
    }
  }

  // 4. Try Gemini for rich entity extraction (clientName, time, serviceRef, targetProfName)
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const resp = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents:
          `Hoje é ${today}. Um barbeiro enviou: "${text}"\n` +
          `Classifique a intenção. Exemplos:\n` +
          `- "quem atendo hoje?" → LIST_APPOINTMENTS\n` +
          `- "tenho horario amanhã?" → LIST_APPOINTMENTS\n` +
          `- "quantos procedimentos fiz?" → COUNT_PROCEDURES\n` +
          `- "quanto o irineu atendeu?" → COUNT_PROCEDURES, targetProfName: "irineu"\n` +
          `- "marca João sexta às 10h" → BOOK\n` +
          `- "faturamento do mês" → FINANCIAL\n` +
          `dateRef: 'today','tomorrow','this_week','last_week','this_month','last_month' ou YYYY-MM-DD.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              intent: { type: Type.STRING, enum: ['LIST_APPOINTMENTS', 'COUNT_PROCEDURES', 'BOOK', 'FINANCIAL', 'HELP'] },
              dateRef: { type: Type.STRING },
              clientName: { type: Type.STRING },
              time: { type: Type.STRING },
              serviceRef: { type: Type.STRING },
              targetProfName: { type: Type.STRING }
            },
            required: ['intent', 'dateRef', 'clientName', 'time', 'serviceRef', 'targetProfName']
          }
        }
      });
      const parsed = JSON.parse(resp.text || '{}');
      if (parsed.intent && parsed.intent !== 'HELP') {
        return { ...fallback, ...parsed };
      }
    } catch {
      // Gemini failed — fall through to rules
    }
  }

  // 5. Rule-based fallback — also tries to extract targetProfName
  // Pattern: "quanto o X fez/atendeu/realizou"
  const profNameMatch = lower.match(/(?:\bo\b|\ba\b)\s+([a-záéíóúàèìòùâêîôûãõçäëïöü]+)\s+(?:fez|atendeu|teve|realizou|tem|agendou)/);
  const extractedProfName = profNameMatch ? profNameMatch[1] : '';

  if (/atend|agenda|horari|horári|quem vou|minha agenda|tenho hora|meus clien|meu dia|quais agend|para hoje|pra hoje|para amanha|pra amanha/.test(lower)) {
    return { ...fallback, intent: 'LIST_APPOINTMENTS', dateRef, targetProfName: extractedProfName };
  }
  if (/quantos|quantas|\bfiz\b|\brealizei\b|procedimento|atendimento|quantid|total de|quanto\s+o|quanto\s+a/.test(lower)) {
    return { ...fallback, intent: 'COUNT_PROCEDURES', dateRef, targetProfName: extractedProfName };
  }
  if (/\bmarca\b|\bmarcar\b|\bagendar\b|reserv|\bcadastra\b|anota|registra/.test(lower)) {
    return { ...fallback, intent: 'BOOK', dateRef };
  }
  if (/faturamento|receita|financeiro|dinheiro|lucro|ganho|quanto fiz|quanto ganhei|quanto recebi/.test(lower)) {
    return { ...fallback, intent: 'FINANCIAL', dateRef };
  }

  return fallback;
}

// =====================================================================
// DATE RANGE RESOLVER
// =====================================================================

interface DateRange { start: string; end: string; label: string; }

function resolveDateRange(dateRef: string): DateRange {
  const now = new Date();
  const today = todayISO();

  switch (dateRef) {
    case 'today':
      return { start: today, end: today, label: 'hoje' };

    case 'tomorrow': {
      const t = isoOffset(1);
      return { start: t, end: t, label: 'amanhã' };
    }

    case 'this_week': {
      const dow = now.getDay();
      // Week starts on Monday
      const monday = isoOffset(-(dow === 0 ? 6 : dow - 1));
      const sunday = isoOffset(7 - (dow === 0 ? 7 : dow));
      return { start: monday, end: sunday, label: 'esta semana' };
    }

    case 'last_week': {
      const dow = now.getDay();
      const daysToLastMonday = (dow === 0 ? 6 : dow - 1) + 7;
      const lastMonday = isoOffset(-daysToLastMonday);
      const lastSunday = isoOffset(-daysToLastMonday + 6);
      return { start: lastMonday, end: lastSunday, label: 'semana passada' };
    }

    case 'this_month': {
      const start = `${now.getFullYear()}-${_pad(now.getMonth() + 1)}-01`;
      return { start, end: today, label: 'este mês' };
    }

    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        start: `${lm.getFullYear()}-${_pad(lm.getMonth() + 1)}-01`,
        end: `${lmEnd.getFullYear()}-${_pad(lmEnd.getMonth() + 1)}-${_pad(lmEnd.getDate())}`,
        label: 'mês passado'
      };
    }

    default: {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateRef))
        return { start: dateRef, end: dateRef, label: datePT(dateRef) };
      // Handle weekday name strings from resolveDateRefFromText
      const WEEKDAY_NAMES: Record<string, number> = {
        'domingo': 0, 'segunda': 1, 'terca': 2, 'terça': 2,
        'quarta': 3, 'quinta': 4, 'sexta': 5, 'sabado': 6, 'sábado': 6
      };
      if (WEEKDAY_NAMES[dateRef] !== undefined) {
        const target = WEEKDAY_NAMES[dateRef];
        const d = new Date();
        const diff = ((target - d.getDay() + 7) % 7) || 7;
        d.setDate(d.getDate() + diff);
        const iso = `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
        return { start: iso, end: iso, label: datePT(iso) };
      }
      return { start: today, end: today, label: 'hoje' };
    }
  }
}

// =====================================================================
// SLOT AVAILABILITY (mirrors agentService logic)
// =====================================================================

async function getAvailableSlots(
  tenantId: string, profId: string, date: string, durationMinutes: number, settings: any
): Promise<string[]> {
  const dateObj = new Date(date + 'T12:00:00');
  const dayIndex = dateObj.getDay();
  const dayConfig = settings.operatingHours?.[dayIndex];
  if (!dayConfig?.active) return [];

  const [startRange, endRange] = dayConfig.range.split('-');
  const [startH, startM] = startRange.split(':').map(Number);
  const [endH, endM] = endRange.split(':').map(Number);

  const { data: appts } = await supabase
    .from('appointments')
    .select('inicio, fim')
    .eq('tenant_id', tenantId)
    .eq('professional_id', profId)
    .neq('status', AppointmentStatus.CANCELLED)
    .gte('inicio', `${date}T00:00:00`)
    .lte('inicio', `${date}T23:59:59`);

  const now = new Date();
  const isToday = date === todayISO();
  const INTERVAL = 30;
  const slots: string[] = [];

  let cursor = startH * 60 + startM;
  const endCursor = endH * 60 + endM;

  while (cursor + durationMinutes <= endCursor) {
    const h = Math.floor(cursor / 60);
    const m = cursor % 60;
    const label = `${_pad(h)}:${_pad(m)}`;
    const slotStart = new Date(`${date}T${label}:00`);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);

    if (isToday && slotStart <= now) { cursor += INTERVAL; continue; }

    const conflict = (appts || []).some((a: any) => {
      return new Date(a.inicio) < slotEnd && new Date(a.fim) > slotStart;
    });
    if (!conflict) slots.push(label);
    cursor += INTERVAL;
  }

  return slots;
}

// =====================================================================
// HANDLERS
// =====================================================================

async function handleListAppointments(
  tenantId: string, profId: string | null, range: DateRange, customers: any[], services: any[], professionals?: any[]
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);

  const filtered = appointments
    .filter(a => {
      const d = a.startTime.split('T')[0];
      return (profId === null || a.professional_id === profId) &&
        d >= range.start && d <= range.end &&
        a.status !== AppointmentStatus.CANCELLED;
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  if (filtered.length === 0) return `📋 Nenhum agendamento ${range.label}. Aproveite! 🙌`;

  // Group by date if multi-day range
  const byDate = new Map<string, typeof filtered>();
  for (const a of filtered) {
    const d = a.startTime.split('T')[0];
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(a);
  }

  const lines: string[] = [];
  for (const [d, apps] of byDate) {
    if (byDate.size > 1) lines.push(`\n📅 *${datePT(d)}*`);
    for (const a of apps) {
      const time = a.startTime.split('T')[1]?.substring(0, 5) || '??:??';
      const customer = customers.find(c => c.id === a.customer_id);
      const service = services.find(s => s.id === a.service_id);
      const icon = a.status === AppointmentStatus.CONFIRMED ? '✅' : '🕐';
      const profName = profId === null && professionals
        ? (professionals.find(p => p.id === a.professional_id)?.name || 'Barbeiro')
        : null;
      const profTag = profName ? ` [${profName}]` : '';
      lines.push(`${icon} *${time}* — ${customer?.name || 'Cliente'} (${service?.name || 'Serviço'})${profTag}`);
    }
  }

  const header = byDate.size === 1 ? `📋 Agendamentos ${range.label}:` : `📋 Agendamentos — ${range.label}:`;
  return `${header}\n${lines.join('\n')}`;
}

async function handleCountProcedures(
  tenantId: string, profId: string | null, range: DateRange
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);
  const filtered = appointments.filter(a => {
    const d = a.startTime.split('T')[0];
    return (profId === null || a.professional_id === profId) &&
      d >= range.start && d <= range.end &&
      a.status === AppointmentStatus.FINISHED;
  });

  const total = filtered.length;
  const revenue = filtered.reduce((acc, a) => acc + (a.amountPaid || 0), 0);

  return (
    `📊 *${range.label.charAt(0).toUpperCase() + range.label.slice(1)}:*\n\n` +
    `✂️ *${total}* procedimento${total !== 1 ? 's' : ''} realizados\n` +
    `💰 Faturamento registrado: *R$ ${revenue.toFixed(2)}*`
  );
}

async function handleBook(
  tenantId: string, prof: any, intent: ProfIntent, settings: any, phone: string
): Promise<string> {
  const { clientName, time, serviceRef } = intent;

  if (!clientName.trim()) {
    return `Para marcar, informe o nome do cliente.\nEx: _"marca João quinta às 10h"_`;
  }

  // Parse time from intent
  let parsedTime = time?.trim() || '';
  if (!parsedTime || !parsedTime.includes(':')) {
    // Try extracting from raw time string e.g. "10h" → "10:00"
    const m = parsedTime.match(/^(\d{1,2})h?(\d{2})?$/);
    if (m) parsedTime = `${m[1].padStart(2, '0')}:${(m[2] || '00').padStart(2, '0')}`;
    else return `Não identifiquei o horário. Informe assim: _"marca João quinta às 10h"_`;
  }

  const range = resolveDateRange(intent.dateRef);
  const date = range.start;

  // Find service
  const services = await db.getServices(tenantId);
  let service = serviceRef
    ? services.find(s => s.active && s.name.toLowerCase().includes(serviceRef.toLowerCase()))
    : null;
  if (!service) service = services.find(s => s.active);
  if (!service) return `Nenhum serviço cadastrado. Configure um serviço no painel.`;

  const startTimeStr = `${date}T${parsedTime}:00`;
  const startTime = new Date(startTimeStr);

  const { available, reason } = await db.isSlotAvailable(tenantId, prof.id, startTime, service.durationMinutes);

  if (!available) {
    // Suggest nearest available slot
    const slots = await getAvailableSlots(tenantId, prof.id, date, service.durationMinutes, settings);
    const nearest = slots.find(s => s >= parsedTime) || slots[0];

    if (!nearest) {
      return (
        `❌ *${parsedTime}* indisponível em *${datePT(date)}*.\n` +
        `_Motivo: ${reason}_\n\n` +
        `Não há mais horários livres neste dia.`
      );
    }

    // Save pending confirmation
    saveProfSession(tenantId, phone, {
      pendingBook: {
        clientName: clientName.trim(),
        date,
        suggestedTime: nearest,
        serviceId: service.id,
        serviceName: service.name,
        serviceDuration: service.durationMinutes,
        profId: prof.id
      },
      updatedAt: Date.now()
    });

    return (
      `❌ *${parsedTime}* está ocupado em *${datePT(date)}*.\n\n` +
      `O próximo horário disponível é *${nearest}*.\n` +
      `Responda *"sim"* para confirmar *${clientName}* às *${nearest}*.`
    );
  }

  // Book it
  const customer = await db.findOrCreateCustomerByName(tenantId, clientName.trim());
  await db.addAppointment({
    tenant_id: tenantId,
    customer_id: customer.id,
    professional_id: prof.id,
    service_id: service.id,
    startTime: startTimeStr,
    durationMinutes: service.durationMinutes,
    status: AppointmentStatus.CONFIRMED,
    source: BookingSource.MANUAL
  });

  clearProfSession(tenantId, phone);
  return (
    `✅ *Agendamento confirmado!*\n\n` +
    `👤 *Cliente:* ${clientName}\n` +
    `📅 *Dia:* ${datePT(date)}\n` +
    `⏰ *Horário:* ${parsedTime}\n` +
    `✂️ *Serviço:* ${service.name}`
  );
}

async function handleConfirmBook(
  tenantId: string, phone: string
): Promise<string> {
  const session = getProfSession(tenantId, phone);
  if (!session.pendingBook) {
    return `Nada para confirmar no momento. Envie um comando como _"marca João sexta às 10h"_.`;
  }

  const { clientName, date, suggestedTime, serviceId, serviceName, serviceDuration, profId } = session.pendingBook;
  const startTimeStr = `${date}T${suggestedTime}:00`;

  // Double-check availability before booking
  const startTime = new Date(startTimeStr);
  const { available } = await db.isSlotAvailable(tenantId, profId, startTime, serviceDuration);

  if (!available) {
    clearProfSession(tenantId, phone);
    return `⚠️ O horário *${suggestedTime}* acabou de ser ocupado. Tente novamente com outro horário.`;
  }

  const customer = await db.findOrCreateCustomerByName(tenantId, clientName);
  await db.addAppointment({
    tenant_id: tenantId,
    customer_id: customer.id,
    professional_id: profId,
    service_id: serviceId,
    startTime: startTimeStr,
    durationMinutes: serviceDuration,
    status: AppointmentStatus.CONFIRMED,
    source: BookingSource.MANUAL
  });

  clearProfSession(tenantId, phone);
  return (
    `✅ *Confirmado!*\n\n` +
    `👤 *Cliente:* ${clientName}\n` +
    `📅 *Dia:* ${datePT(date)}\n` +
    `⏰ *Horário:* ${suggestedTime}\n` +
    `✂️ *Serviço:* ${serviceName}`
  );
}

async function handleFinancial(
  tenantId: string, range: DateRange, professionals: any[]
): Promise<string> {
  const appointments = await db.getAppointments(tenantId);

  const finished = appointments.filter(a => {
    const d = a.startTime.split('T')[0];
    return d >= range.start && d <= range.end &&
      a.status === AppointmentStatus.FINISHED && !a.isPlan;
  });

  const total = finished.length;
  const revenue = finished.reduce((acc, a) => acc + (a.amountPaid || 0), 0);

  // Per-professional breakdown
  const byPro: Record<string, { count: number; revenue: number }> = {};
  for (const a of finished) {
    if (!byPro[a.professional_id]) byPro[a.professional_id] = { count: 0, revenue: 0 };
    byPro[a.professional_id].count++;
    byPro[a.professional_id].revenue += (a.amountPaid || 0);
  }

  const proLines = professionals
    .filter(p => byPro[p.id])
    .sort((a, b) => (byPro[b.id]?.revenue || 0) - (byPro[a.id]?.revenue || 0))
    .map(p => `• *${p.name}:* ${byPro[p.id].count} atend. — R$ ${byPro[p.id].revenue.toFixed(2)}`);

  let msg =
    `💰 *Financeiro — ${range.label}:*\n\n` +
    `📊 *${total}* atendimento${total !== 1 ? 's' : ''} finalizados\n` +
    `💵 Faturamento total: *R$ ${revenue.toFixed(2)}*`;

  if (proLines.length > 0) msg += `\n\n*Por barbeiro:*\n${proLines.join('\n')}`;
  return msg;
}

// =====================================================================
// MAIN HANDLER — exported and called by AiPollingManager
// =====================================================================

/** Flexible phone comparison: handles country-code prefixes (e.g. 55 for Brazil). */
function phonesMatch(stored: string, incoming: string): boolean {
  const a = (stored || '').replace(/\D/g, '');
  const b = (incoming || '').replace(/\D/g, '');
  if (!a || !b) return false;
  if (a === b) return true;
  // Compare last 11 digits (DDD + 9-digit mobile, most common BR format)
  if (a.slice(-11) === b.slice(-11) && b.slice(-11).length >= 10) return true;
  // Compare last 10 digits (DDD + 8-digit, older format)
  if (a.slice(-10) === b.slice(-10) && b.slice(-10).length >= 10) return true;
  return false;
}

export async function handleProfessionalMessage(
  tenant: any,
  phone: string,
  messageText: string
): Promise<string | null> {
  const tenantId: string = tenant.id;
  const geminiKey: string = tenant.gemini_api_key || '';
  const text = messageText.trim();
  if (!text) return null;

  // Identify professional by phone (flexible matching)
  const professionals = await db.getProfessionals(tenantId);
  const prof = professionals.find(p => phonesMatch(p.phone, phone));
  if (!prof) return null; // not a professional → handle as customer

  const isAdmin = prof.role === 'admin';
  const today = todayISO();
  const todayFull = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  const intent = await classifyIntent(text, geminiKey, `${today} (${todayFull})`);

  // Access control
  if (intent.intent === 'FINANCIAL' && !isAdmin) {
    return (
      `⛔ Acesso negado.\n\n` +
      `Dados financeiros são visíveis apenas para *administradores*.\n` +
      `Fale com o proprietário para obter acesso de admin.`
    );
  }

  // Confirm pending booking
  if (intent.intent === 'CONFIRM_BOOK') {
    return handleConfirmBook(tenantId, phone);
  }

  const [settings, customers, services] = await Promise.all([
    db.getSettings(tenantId),
    db.getCustomers(tenantId),
    db.getServices(tenantId)
  ]);

  // Resolve which professional's data to query
  let targetProfId: string | null = prof.id;
  if (intent.targetProfName?.trim()) {
    if (!isAdmin) {
      return `⛔ Acesso negado.\nVocê só pode consultar seus próprios dados.`;
    }
    if (intent.targetProfName === '__ALL__') {
      targetProfId = null; // show all professionals
    } else {
      const targetProf = professionals.find(p =>
        p.name.toLowerCase().includes(intent.targetProfName.toLowerCase())
      );
      if (targetProf) {
        targetProfId = targetProf.id;
      } else {
        return `❓ Profissional *"${intent.targetProfName}"* não encontrado.\nProfissionais cadastrados: ${professionals.map(p => p.name).join(', ')}.`;
      }
    }
  }

  const range = resolveDateRange(intent.dateRef || 'today');

  switch (intent.intent) {
    case 'LIST_APPOINTMENTS':
      return handleListAppointments(tenantId, targetProfId, range, customers, services, professionals);

    case 'COUNT_PROCEDURES':
      return handleCountProcedures(tenantId, targetProfId, range);

    case 'BOOK':
      return handleBook(tenantId, prof, intent, settings, phone);

    case 'FINANCIAL':
      return handleFinancial(tenantId, range, professionals);

    default: {
      const adminExtra = isAdmin
        ? '\n*4 -* Faturamento: _esta semana / este mês_\n*5 -* Barbeiro: _[nome] [data]_'
        : '';
      return (
        `Eai, *${prof.name}*! O que manda? 💈\n\n` +
        `*1 -* Quem atendo: _hoje / amanhã / sexta_\n` +
        `*2 -* Procedimentos: _esta semana / mês passado_\n` +
        `*3 -* Marcar: _[cliente] [data] às [hora]_` +
        adminExtra
      );
    }
  }
}
