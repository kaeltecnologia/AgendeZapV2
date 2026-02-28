/**
 * followUpService.ts
 *
 * Scheduler for the 3 follow-up types:
 *
 * 1. Check-in Diário (aviso)
 *    → Sent once at the fixedTime programmed, on the day of the appointment.
 *
 * 2. Lembrete Próximo (lembrete)
 *    → Sent when the appointment is within mode.timing minutes away (30 min – 2 h).
 *
 * 3. Recuperação (reativacao)
 *    → Sent when mode.timing days have elapsed since the last FINISHED appointment
 *      and the customer has NOT made any new booking since then.
 */

import { db } from './mockDb';
import { evolutionService } from './evolutionService';
import { AppointmentStatus } from '../types';
import { registerFollowUpContext } from './agentService';

// Prevent concurrent runs for the same tenant
const runningTenants = new Set<string>();

function interpolate(template: string, vars: Record<string, string>): string {
  return template
    .replace(/\{nome\}/gi, vars.nome || '')
    .replace(/\{dia\}/gi, vars.dia || '')
    .replace(/\{hora\}/gi, vars.hora || '')
    .replace(/\{servico\}/gi, vars.servico || '');
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localHHMM(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function runFollowUp(tenant: any): Promise<void> {
  const tenantId: string = tenant.id;
  const instance: string = tenant.evolution_instance;

  if (!instance) return;
  if (runningTenants.has(tenantId)) return;
  runningTenants.add(tenantId);

  try {
    const [settings, allAppts, customers, services] = await Promise.all([
      db.getSettings(tenantId),
      db.getAppointments(tenantId),
      db.getCustomers(tenantId),
      db.getServices(tenantId),
    ]);

    const avisoModes     = settings.avisoModes     || [];
    const lembreteModes  = settings.lembreteModes  || [];
    const reativacaoModes = settings.reativacaoModes || [];

    // No modes configured at all → skip
    if (!avisoModes.length && !lembreteModes.length && !reativacaoModes.length) return;

    const now    = new Date();
    const nowMs  = now.getTime();
    const nowDate = localDateStr(now);  // "YYYY-MM-DD"
    const nowHHMM = localHHMM(now);     // "HH:MM"

    const newSent: Record<string, string> = { ...(settings.followUpSent || {}) };
    let anySent = false;

    const findCust = (id: string) => customers.find(c => c.id === id);
    const findSvc  = (id: string) => services.find(s => s.id === id);

    // ─────────────────────────────────────────────────────────────────────
    // 1. CHECK-IN DIÁRIO
    //    Trigger: appointment is today (PENDING or CONFIRMED) AND
    //             current wall-clock time >= mode.fixedTime AND
    //             not yet sent today.
    // ─────────────────────────────────────────────────────────────────────
    for (const appt of allAppts) {
      if (
        appt.status !== AppointmentStatus.PENDING &&
        appt.status !== AppointmentStatus.CONFIRMED
      ) continue;

      // Appointment must be today
      const apptDate = appt.startTime.slice(0, 10);
      if (apptDate !== nowDate) continue;

      const cust = findCust(appt.customer_id);
      if (!cust?.phone) continue;

      const mode = avisoModes.find(m => m.id === cust.avisoModeId && m.active);
      if (!mode) continue;

      const sentKey = `aviso::${appt.id}`;
      if (newSent[sentKey]) continue; // already sent

      const fixedHHMM = mode.fixedTime || '08:00';
      if (nowHHMM < fixedHHMM) continue; // not the right time yet

      const svc = findSvc(appt.service_id);
      const apptTime = new Date(appt.startTime);

      const msg = interpolate(mode.message, {
        nome:    cust.name,
        dia:     'hoje',
        hora:    apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        servico: svc?.name || '',
      });

      try {
        await evolutionService.sendMessage(instance, cust.phone, msg);
        newSent[sentKey] = nowDate;
        anySent = true;
        console.log(`[FollowUp] Aviso enviado → ${cust.name} (${cust.phone})`);
        registerFollowUpContext(tenantId, cust.phone, 'aviso', msg, {
          apptTime: apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          serviceName: svc?.name || '',
          clientName: cust.name,
        });
      } catch (e: any) {
        console.error(`[FollowUp] Erro ao enviar aviso para ${cust.phone}:`, e.message);
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 2. LEMBRETE PRÓXIMO
    //    Trigger: appointment is upcoming (PENDING or CONFIRMED) AND
    //             within mode.timing minutes from now AND not yet sent.
    // ─────────────────────────────────────────────────────────────────────
    for (const appt of allAppts) {
      if (
        appt.status !== AppointmentStatus.PENDING &&
        appt.status !== AppointmentStatus.CONFIRMED
      ) continue;

      const apptMs = new Date(appt.startTime).getTime();
      const minutesUntil = (apptMs - nowMs) / 60000;

      // Only look at appointments in the next 4 hours
      if (minutesUntil <= 0 || minutesUntil > 240) continue;

      const cust = findCust(appt.customer_id);
      if (!cust?.phone) continue;

      const mode = lembreteModes.find(m => m.id === cust.lembreteModeId && m.active);
      if (!mode) continue;

      const sentKey = `lembrete::${appt.id}`;
      if (newSent[sentKey]) continue;

      // Send when the appointment is within mode.timing minutes
      if (minutesUntil > mode.timing) continue;

      const svc = findSvc(appt.service_id);
      const apptTime = new Date(appt.startTime);

      const msg = interpolate(mode.message, {
        nome:    cust.name,
        dia:     'hoje',
        hora:    apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        servico: svc?.name || '',
      });

      try {
        await evolutionService.sendMessage(instance, cust.phone, msg);
        newSent[sentKey] = now.toISOString();
        anySent = true;
        console.log(`[FollowUp] Lembrete enviado → ${cust.name} (appt ${appt.id})`);
        registerFollowUpContext(tenantId, cust.phone, 'lembrete', msg, {
          apptTime: apptTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
          serviceName: svc?.name || '',
          clientName: cust.name,
        });
      } catch (e: any) {
        console.error(`[FollowUp] Erro ao enviar lembrete para ${cust.phone}:`, e.message);
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // 3. RECUPERAÇÃO
    //    Trigger: customer's last FINISHED appointment is >= mode.timing days ago
    //             AND the customer has no new booking (PENDING/CONFIRMED/FINISHED)
    //             after that appointment AND message hasn't been sent yet.
    // ─────────────────────────────────────────────────────────────────────

    // Build map: customerId → most recent FINISHED appointment
    const custLastFinished: Record<string, { appt: any; date: Date }> = {};
    for (const appt of allAppts) {
      if (appt.status !== AppointmentStatus.FINISHED) continue;
      const d = new Date(appt.startTime);
      const prev = custLastFinished[appt.customer_id];
      if (!prev || d > prev.date) {
        custLastFinished[appt.customer_id] = { appt, date: d };
      }
    }

    for (const [custId, { appt: lastAppt, date: lastDate }] of Object.entries(custLastFinished)) {
      const cust = findCust(custId);
      if (!cust?.phone) continue;

      const mode = reativacaoModes.find(m => m.id === cust.reativacaoModeId && m.active);
      if (!mode) continue;

      const sentKey = `reativacao::${custId}::${lastAppt.id}`;
      if (newSent[sentKey]) continue;

      // Check enough days have elapsed
      const daysSince = (nowMs - lastDate.getTime()) / 86400000;
      if (daysSince < mode.timing) continue;

      // Check no new booking was made since the last finished appointment
      const hasNewBooking = allAppts.some(a =>
        a.customer_id === custId &&
        a.id !== lastAppt.id &&
        new Date(a.startTime) > lastDate &&
        (
          a.status === AppointmentStatus.PENDING ||
          a.status === AppointmentStatus.CONFIRMED ||
          a.status === AppointmentStatus.FINISHED
        )
      );
      if (hasNewBooking) continue;

      const svc = findSvc(lastAppt.service_id);

      const msg = interpolate(mode.message, {
        nome:    cust.name,
        dia:     lastDate.toLocaleDateString('pt-BR'),
        hora:    lastDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        servico: svc?.name || '',
      });

      try {
        await evolutionService.sendMessage(instance, cust.phone, msg);
        newSent[sentKey] = nowDate;
        anySent = true;
        console.log(`[FollowUp] Recuperação enviada → ${cust.name} (${daysSince.toFixed(1)} dias)`);
        registerFollowUpContext(tenantId, cust.phone, 'reativacao', msg, {
          serviceName: svc?.name || '',
          clientName: cust.name,
        });
      } catch (e: any) {
        console.error(`[FollowUp] Erro ao enviar recuperação para ${cust.phone}:`, e.message);
      }
    }

    // Persist updated sent records only when something changed
    if (anySent) {
      await db.updateSettings(tenantId, { followUpSent: newSent });
    }
  } finally {
    runningTenants.delete(tenantId);
  }
}
