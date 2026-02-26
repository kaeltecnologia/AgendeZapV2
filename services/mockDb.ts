
/**
 * =====================================================================
 *  Supabase DB Service — AgendeZap
 * =====================================================================
 *
 *  Required SQL migrations (run once in Supabase SQL Editor):
 *
 *  -- Appointment plan flag (only required addition)
 *  ALTER TABLE appointments ADD COLUMN IF NOT EXISTS is_plan BOOLEAN DEFAULT FALSE;
 *
 *  NOTE: Plans, customer modes and customer plan data are all stored inside
 *        tenant_settings.follow_up JSONB (_plans, _customerData keys).
 *        No additional table or column changes are required.
 *
 * =====================================================================
 */

import { supabase, isSupabaseConfigured } from './supabase';
import {
  Tenant, Professional, Service, Appointment,
  Customer, AppointmentStatus, PaymentMethod, TenantSettings,
  TenantStatus, BookingSource, Expense, BreakPeriod, Plan,
  FollowUpNamedMode
} from '../types';

// ─── Helpers ────────────────────────────────────────────────────────

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

/** Format a Date as a local-time ISO string (no UTC conversion). */
function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}


class DatabaseService {
  private connectionStatus: 'online' | 'offline' | 'checking' = 'checking';

  constructor() {
    this.checkConnection();
  }

  async checkConnection() {
    if (!isSupabaseConfigured) {
      this.connectionStatus = 'offline';
      return false;
    }
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );
      const query = supabase.from('tenants').select('id').limit(1);
      await Promise.race([query, timeout]);
      this.connectionStatus = 'online';
      return true;
    } catch (err) {
      console.warn("Supabase Connection Failed:", err);
      this.connectionStatus = 'offline';
      return false;
    }
  }

  isOnline() {
    return this.connectionStatus === 'online';
  }

  // ─── TENANTS ────────────────────────────────────────────────────────

  async getAllTenants(): Promise<Tenant[]> {
    try {
      const { data, error } = await supabase.from('tenants').select('*');
      if (error) throw error;
      return (data || []).map(t => ({
        id: t.id,
        name: t.nome || 'Sem Nome',
        slug: t.slug,
        email: t.email,
        password: t.password,
        plan: t.plan || 'BASIC',
        status: t.status as TenantStatus,
        monthlyFee: Number(t.mensalidade || 0),
        createdAt: t.created_at
      }));
    } catch (err) {
      console.error("Error fetching tenants:", err);
      return [];
    }
  }

  async getTenant(id: string): Promise<Tenant | null> {
    try {
      const { data, error } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        name: data.nome || 'Sem Nome',
        slug: data.slug,
        email: data.email,
        password: data.password,
        plan: data.plan || 'BASIC',
        status: data.status as TenantStatus,
        monthlyFee: Number(data.mensalidade || 0),
        createdAt: data.created_at
      };
    } catch (err) {
      console.error("Error fetching tenant:", err);
      return null;
    }
  }

  async addTenant(tenant: { name: string; slug: string; email?: string; password?: string; plan?: string; status?: TenantStatus; monthlyFee?: number }) {
    try {
      const payload = {
        nome: tenant.name,
        slug: tenant.slug,
        email: tenant.email,
        password: tenant.password,
        plan: tenant.plan || 'BASIC',
        status: tenant.status || TenantStatus.ACTIVE,
        mensalidade: tenant.monthlyFee || 0,
        evolution_instance: `agz_${tenant.slug.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '').trim()}`
      };
      const { data, error } = await supabase.from('tenants').insert(payload).select().single();
      if (error) throw error;
      return {
        id: data.id,
        name: data.nome,
        slug: data.slug,
        email: data.email,
        password: data.password,
        plan: data.plan,
        status: data.status,
        monthlyFee: data.mensalidade,
        createdAt: data.created_at
      } as Tenant;
    } catch (e) {
      console.error("Supabase Tenant Insert Error:", e);
      throw e;
    }
  }

  async updateTenant(id: string, updates: Partial<Tenant>) {
    try {
      const payload: any = {};
      if (updates.name !== undefined) payload.nome = updates.name;
      if (updates.status) payload.status = updates.status;
      if (updates.monthlyFee !== undefined) payload.mensalidade = updates.monthlyFee;
      if (updates.plan) payload.plan = updates.plan;
      if (updates.email !== undefined) payload.email = updates.email;
      if (updates.password !== undefined) payload.password = updates.password;
      const { error } = await supabase.from('tenants').update(payload).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Tenant Update Error:", e);
      throw e;
    }
  }

  // ─── APPOINTMENTS ───────────────────────────────────────────────────

  async getAppointments(tenantId: string): Promise<Appointment[]> {
    try {
      const { data, error } = await supabase.from('appointments').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(a => {
        const start = new Date(a.inicio);
        const end = new Date(a.fim);
        const duration = Math.round((end.getTime() - start.getTime()) / 60000);
        return {
          id: a.id,
          tenant_id: a.tenant_id,
          customer_id: a.customer_id,
          professional_id: a.professional_id,
          service_id: a.service_id,
          startTime: a.inicio,
          durationMinutes: duration,
          status: a.status as AppointmentStatus,
          source: a.origem as BookingSource,
          paymentMethod: a.payment_method as PaymentMethod,
          amountPaid: Number(a.amount_paid || 0),
          isPlan: a.is_plan ?? false
        };
      });
    } catch (err) {
      console.error("Error fetching appointments:", err);
      return [];
    }
  }

  async addAppointment(app: any) {
    try {
      const start = new Date(app.startTime);
      const end = new Date(start.getTime() + (app.durationMinutes || 30) * 60000);
      // Use local time strings — avoids UTC offset storing the wrong time
      const inicio = toLocalISO(start);
      const fim = toLocalISO(end);
      const payload: any = {
        tenant_id: app.tenant_id,
        customer_id: app.customer_id,
        professional_id: app.professional_id,
        service_id: app.service_id,
        inicio,
        fim,
        status: app.status || AppointmentStatus.PENDING,
        origem: app.source || BookingSource.WEB,
        is_plan: app.isPlan ?? false
      };
      let { data, error } = await supabase.from('appointments').insert(payload).select().single();
      // Fallback: if is_plan column not yet migrated, retry without it
      if (error && (error.message?.includes('is_plan') || (error as any).code === '42703')) {
        console.warn('[DB] is_plan column missing — run migration. Retrying without it.');
        const { is_plan, ...payloadWithout } = payload;
        const r2 = await supabase.from('appointments').insert(payloadWithout).select().single();
        data = r2.data; error = r2.error;
      }
      if (error) throw error;
      return {
        ...data,
        startTime: data.inicio,
        durationMinutes: app.durationMinutes,
        source: data.origem,
        isPlan: data.is_plan ?? false
      };
    } catch (e) {
      console.error("Supabase Appointment Insert Error:", e);
      throw e;
    }
  }

  async updateAppointmentStatus(id: string, status: AppointmentStatus, updates: Partial<Appointment>) {
    try {
      const { error } = await supabase.from('appointments').update({
        status,
        payment_method: updates.paymentMethod,
        amount_paid: updates.amountPaid,
        extra_note: updates.extraNote,
        extra_value: updates.extraValue
      }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Appointment Update Error:", e);
      throw e;
    }
  }

  // ─── PROFESSIONALS ──────────────────────────────────────────────────

  async getProfessionals(tenantId: string): Promise<Professional[]> {
    try {
      const [{ data, error }, settings] = await Promise.all([
        supabase.from('professionals').select('*').eq('tenant_id', tenantId),
        this.getSettings(tenantId)
      ]);
      if (error) throw error;
      const profMeta = settings.professionalMeta || {};
      return (data || []).map(p => ({
        id: p.id,
        tenant_id: p.tenant_id,
        name: p.nome || 'Sem Nome',
        phone: p.phone || '',
        specialty: p.especialidade || '',
        active: p.ativo ?? true,
        role: profMeta[p.id]?.role || 'colab'
      }));
    } catch (err) {
      console.error("Error fetching professionals:", err);
      return [];
    }
  }

  async addProfessional(pro: any) {
    try {
      const { data, error } = await supabase.from('professionals').insert({
        tenant_id: pro.tenant_id,
        nome: pro.name,
        phone: pro.phone || '',
        especialidade: pro.specialty || '',
        ativo: pro.active ?? true
      }).select().single();
      if (error) throw error;
      return { ...data, name: data.nome, specialty: data.especialidade, active: data.ativo };
    } catch (e) {
      console.error("Supabase Professional Insert Error:", e);
      throw e;
    }
  }

  async updateProfessional(tenantId: string, id: string, pro: Partial<Professional>) {
    try {
      const payload: any = {};
      if (pro.name !== undefined) payload.nome = pro.name;
      if (pro.phone !== undefined) payload.phone = pro.phone;
      if (pro.specialty !== undefined) payload.especialidade = pro.specialty;
      if (pro.active !== undefined) payload.ativo = pro.active;
      if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('professionals').update(payload).eq('id', id);
        if (error) throw error;
      }
      // Role is stored in settings JSONB (no schema change needed)
      if (pro.role !== undefined) {
        const s = await this.getSettings(tenantId);
        const meta = { ...(s.professionalMeta || {}) };
        meta[id] = { ...(meta[id] || {}), role: pro.role };
        await this.updateSettings(tenantId, { professionalMeta: meta });
      }
    } catch (e) {
      console.error("Supabase Professional Update Error:", e);
      throw e;
    }
  }

  // ─── SERVICES ───────────────────────────────────────────────────────

  async getServices(tenantId: string): Promise<Service[]> {
    try {
      const { data, error } = await supabase.from('services').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(s => ({
        id: s.id,
        tenant_id: s.tenant_id,
        name: s.nome || 'Sem Nome',
        price: Number(s.preco || 0),
        durationMinutes: s.duracao_minutos || 30,
        active: s.ativo ?? true
      }));
    } catch (err) {
      console.error("Error fetching services:", err);
      return [];
    }
  }

  async addService(svc: any) {
    try {
      const payload = {
        tenant_id: svc.tenant_id,
        nome: svc.name,
        preco: svc.price,
        duracao_minutos: svc.durationMinutes,
        ativo: svc.ativo ?? true
      };
      const { data, error } = await supabase.from('services').insert(payload).select().single();
      if (error) throw error;
      return {
        id: data.id,
        tenant_id: data.tenant_id,
        name: data.nome,
        price: Number(data.preco),
        durationMinutes: data.duracao_minutos,
        active: data.ativo
      };
    } catch (e) {
      console.error("Supabase Service Insert Error:", e);
      throw e;
    }
  }

  async updateService(id: string, svc: Partial<Service>) {
    try {
      const { error } = await supabase.from('services').update({
        nome: svc.name,
        preco: svc.price,
        duracao_minutos: svc.durationMinutes,
        ativo: svc.active
      }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Service Update Error:", e);
      throw e;
    }
  }

  // ─── CUSTOMERS ──────────────────────────────────────────────────────
  //
  // Plan assignments and follow-up mode IDs are stored in
  // tenant_settings.follow_up._customerData (JSONB) — no schema changes needed.

  private buildCustomer(c: any, cData: any = {}): Customer {
    return {
      id: c.id,
      tenant_id: c.tenant_id,
      name: c.nome || 'Sem Nome',
      phone: c.telefone || '',
      active: true,
      followUpPreferences: { aviso: true, lembrete: true, reativacao: true },
      avisoModeId: cData.avisoModeId || 'standard',
      lembreteModeId: cData.lembreteModeId || 'standard',
      reativacaoModeId: cData.reativacaoModeId || 'standard',
      planId: cData.planId || null,
      planServiceId: cData.planServiceId || null
    };
  }

  async getCustomers(tenantId: string): Promise<Customer[]> {
    try {
      const [{ data, error }, settings] = await Promise.all([
        supabase.from('customers').select('*').eq('tenant_id', tenantId),
        this.getSettings(tenantId)
      ]);
      if (error) throw error;
      const customerData = settings.customerData || {};
      return (data || []).map(c => this.buildCustomer(c, customerData[c.id] || {}));
    } catch (err) {
      console.error("Error fetching customers:", err);
      return [];
    }
  }

  async addCustomer(customer: any) {
    try {
      const { data, error } = await supabase.from('customers').insert({
        tenant_id: customer.tenant_id,
        nome: customer.name,
        telefone: customer.phone
      }).select().single();
      if (error) throw error;
      // New customer starts with no plan/mode data
      return this.buildCustomer(data, {});
    } catch (e) {
      console.error("Supabase Customer Insert Error:", e);
      throw e;
    }
  }

  /** tenantId is required so we can write plan/mode data to settings JSONB. */
  async updateCustomer(tenantId: string, id: string, updates: Partial<Customer>) {
    try {
      // Update only name/phone in the customers table
      const payload: any = {};
      if (updates.name !== undefined) payload.nome = updates.name;
      if (updates.phone !== undefined) payload.telefone = updates.phone;
      if (Object.keys(payload).length > 0) {
        const { error } = await supabase.from('customers').update(payload).eq('id', id);
        if (error) throw error;
      }

      // Write plan/mode assignments to settings JSONB (_customerData)
      const hasCData =
        'planId' in updates ||
        'planServiceId' in updates ||
        updates.avisoModeId !== undefined ||
        updates.lembreteModeId !== undefined ||
        updates.reativacaoModeId !== undefined;

      if (hasCData) {
        const s = await this.getSettings(tenantId);
        const allCData = { ...(s.customerData || {}) };
        const prev = allCData[id] || {};
        allCData[id] = {
          ...prev,
          planId: 'planId' in updates ? (updates.planId ?? null) : prev.planId,
          planServiceId: 'planServiceId' in updates ? (updates.planServiceId ?? null) : prev.planServiceId,
          avisoModeId: updates.avisoModeId !== undefined ? updates.avisoModeId : prev.avisoModeId,
          lembreteModeId: updates.lembreteModeId !== undefined ? updates.lembreteModeId : prev.lembreteModeId,
          reativacaoModeId: updates.reativacaoModeId !== undefined ? updates.reativacaoModeId : prev.reativacaoModeId
        };
        await this.updateSettings(tenantId, { customerData: allCData });
      }
    } catch (e) {
      console.error("Supabase Customer Update Error:", e);
      throw e;
    }
  }

  async findOrCreateCustomer(tenantId: string, phone: string, name: string) {
    try {
      const [{ data: existing, error: fetchError }, settings] = await Promise.all([
        supabase.from('customers').select('*').eq('tenant_id', tenantId).eq('telefone', phone).maybeSingle(),
        this.getSettings(tenantId)
      ]);
      if (fetchError) throw fetchError;
      const customerData = settings.customerData || {};
      if (existing) return this.buildCustomer(existing, customerData[existing.id] || {});
      return await this.addCustomer({ tenant_id: tenantId, name, phone });
    } catch (err) {
      console.error("Error findOrCreateCustomer:", err);
      throw err;
    }
  }

  /** Search a customer by (partial) name — used when barber books via WhatsApp. */
  async findOrCreateCustomerByName(tenantId: string, name: string): Promise<Customer> {
    try {
      const { data } = await supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('nome', `%${name}%`)
        .limit(1)
        .maybeSingle();
      if (data) {
        const s = await this.getSettings(tenantId);
        return this.buildCustomer(data, (s.customerData || {})[data.id] || {});
      }
      return await this.addCustomer({ tenant_id: tenantId, name, phone: '' });
    } catch (err) {
      console.error("Error findOrCreateCustomerByName:", err);
      throw err;
    }
  }

  async isSlotAvailable(tenantId: string, professionalId: string, startTime: Date, durationMinutes: number): Promise<{ available: boolean; reason?: string }> {
    try {
      const settings = await this.getSettings(tenantId);
      const dayIndex = startTime.getDay();
      const dayConfig = settings.operatingHours[dayIndex];
      if (!dayConfig || !dayConfig.active) {
        return { available: false, reason: "Barbearia fechada neste dia." };
      }

      const [startRange, endRange] = dayConfig.range.split('-');
      const [startH, startM] = startRange.split(':').map(Number);
      const [endH, endM] = endRange.split(':').map(Number);

      const rangeStart = new Date(startTime);
      rangeStart.setHours(startH, startM, 0, 0);
      const rangeEnd = new Date(startTime);
      rangeEnd.setHours(endH, endM, 0, 0);
      const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

      if (startTime < rangeStart || endTime > rangeEnd) {
        return { available: false, reason: `Fora do horário de funcionamento (${dayConfig.range}).` };
      }

      // Check break periods
      const slotLabel = `${String(startTime.getHours()).padStart(2,'0')}:${String(startTime.getMinutes()).padStart(2,'0')}`;
      const endLabel = `${String(endTime.getHours()).padStart(2,'0')}:${String(endTime.getMinutes()).padStart(2,'0')}`;
      const dateStr = `${startTime.getFullYear()}-${String(startTime.getMonth()+1).padStart(2,'0')}-${String(startTime.getDate()).padStart(2,'0')}`;
      for (const brk of (settings.breaks || [])) {
        if (brk.professionalId && brk.professionalId !== professionalId) continue;
        const matchDate = !brk.date || brk.date === dateStr;
        const matchDay = brk.dayOfWeek == null || brk.dayOfWeek === dayIndex;
        if (matchDate && matchDay) {
          if (slotLabel < brk.endTime && endLabel > brk.startTime) {
            return { available: false, reason: `Período de intervalo: ${brk.label} (${brk.startTime}–${brk.endTime}).` };
          }
        }
      }

      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('professional_id', professionalId)
        .neq('status', AppointmentStatus.CANCELLED);
      if (error) throw error;

      const conflicts = (data || []).filter(a => {
        const aStart = new Date(a.inicio);
        const aEnd = new Date(a.fim);
        return aStart < endTime && aEnd > startTime;
      });
      return conflicts.length > 0 ? { available: false, reason: "Horário ocupado." } : { available: true };
    } catch (err) {
      console.error("Error checking slot availability:", err);
      return { available: false, reason: "Erro ao verificar disponibilidade." };
    }
  }

  // ─── SETTINGS ───────────────────────────────────────────────────────
  //
  // Extra fields (whatsapp, breaks, plans, modes, etc.) are stored inside
  // the existing `follow_up` JSONB column under _-prefixed keys so no
  // schema changes are required.

  async getSettings(tenantId: string): Promise<TenantSettings> {
    const defaults: TenantSettings = {
      followUp: {
        aviso: { active: true, message: "Aviso", timing: 0, fixedTime: "08:00" },
        lembrete: { active: true, message: "Lembrete", timing: 60 },
        reativacao: { active: true, message: "Sumido", timing: 30 }
      },
      operatingHours: {
        1: { active: true, range: "09:00-18:00" },
        2: { active: true, range: "09:00-18:00" },
        3: { active: true, range: "09:00-18:00" },
        4: { active: true, range: "09:00-18:00" },
        5: { active: true, range: "09:00-18:00" },
        6: { active: true, range: "09:00-18:00" },
        0: { active: false, range: "09:00-18:00" }
      },
      aiActive: false,
      themeColor: "#f97316",
      whatsapp: '',
      breaks: [],
      customModes: [],
      avisoModes: [],
      lembreteModes: [],
      reativacaoModes: [],
      plans: [],
      planUsage: {},
      professionalMeta: {},
      customerData: {}
    };
    try {
      const { data, error } = await supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (error) throw error;
      if (data) {
        const fu = data.follow_up || {};
        return {
          followUp: {
            aviso: fu.aviso || defaults.followUp.aviso,
            lembrete: fu.lembrete || defaults.followUp.lembrete,
            reativacao: fu.reativacao || defaults.followUp.reativacao,
          },
          operatingHours: data.operating_hours || defaults.operatingHours,
          aiActive: data.ai_active ?? false,
          themeColor: data.theme_color || '#f97316',
          whatsapp: fu._whatsapp || '',
          breaks: fu._breaks || [],
          customModes: fu._customModes || [],
          avisoModes: fu._avisoModes || [],
          lembreteModes: fu._lembreteModes || [],
          reativacaoModes: fu._reativacaoModes || [],
          plans: fu._plans || [],
          planUsage: fu._planUsage || {},
          professionalMeta: fu._professionalMeta || {},
          customerData: fu._customerData || {}
        };
      }
    } catch (e) {
      console.error("Error fetching settings:", e);
    }
    return defaults;
  }

  async updateSettings(tenantId: string, updates: any) {
    try {
      const curr = await this.getSettings(tenantId);
      const newS = { ...curr, ...updates };

      // Merge ALL metadata back into follow_up JSONB so nothing is lost
      const followUpWithMeta = {
        ...newS.followUp,
        _whatsapp: newS.whatsapp ?? curr.whatsapp ?? '',
        _breaks: newS.breaks ?? curr.breaks ?? [],
        _customModes: newS.customModes ?? curr.customModes ?? [],
        _avisoModes: newS.avisoModes ?? curr.avisoModes ?? [],
        _lembreteModes: newS.lembreteModes ?? curr.lembreteModes ?? [],
        _reativacaoModes: newS.reativacaoModes ?? curr.reativacaoModes ?? [],
        _plans: newS.plans ?? curr.plans ?? [],
        _planUsage: newS.planUsage ?? curr.planUsage ?? {},
        _professionalMeta: newS.professionalMeta ?? curr.professionalMeta ?? {},
        _customerData: newS.customerData ?? curr.customerData ?? {}
      };

      const { error } = await supabase.from('tenant_settings').upsert(
        {
          tenant_id: tenantId,
          follow_up: followUpWithMeta,
          operating_hours: newS.operatingHours,
          ai_active: newS.aiActive,
          theme_color: newS.themeColor
        },
        { onConflict: 'tenant_id' }  // required to avoid duplicate key error
      );
      if (error) throw error;
    } catch (e) {
      console.error("Error updating settings:", e);
      throw e;
    }
  }

  // ─── BREAK PERIODS (convenience wrappers over settings) ─────────────

  async getBreaks(tenantId: string): Promise<BreakPeriod[]> {
    const s = await this.getSettings(tenantId);
    return s.breaks || [];
  }

  async saveBreaks(tenantId: string, breaks: BreakPeriod[]): Promise<void> {
    await this.updateSettings(tenantId, { breaks });
  }

  // ─── PLANS (stored inside settings JSONB — no separate table needed) ─

  async getPlans(tenantId: string): Promise<Plan[]> {
    const s = await this.getSettings(tenantId);
    return (s.plans || []).filter(p => p.active);
  }

  async addPlan(plan: Omit<Plan, 'id'>): Promise<Plan> {
    const s = await this.getSettings(plan.tenant_id);
    const newPlan: Plan = { ...plan, id: generateId() };
    await this.updateSettings(plan.tenant_id, { plans: [...(s.plans || []), newPlan] });
    return newPlan;
  }

  async updatePlan(tenantId: string, id: string, updates: Partial<Plan>): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.plans || []).map(p => p.id === id ? { ...p, ...updates } : p);
    await this.updateSettings(tenantId, { plans: updated });
  }

  async deletePlan(tenantId: string, id: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    const updated = (s.plans || []).map(p => p.id === id ? { ...p, active: false } : p);
    await this.updateSettings(tenantId, { plans: updated });
  }

  // ─── PLAN USAGE TRACKING ────────────────────────────────────────────

  async getPlanUsageCount(tenantId: string, customerId: string): Promise<number> {
    const s = await this.getSettings(tenantId);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const key = `${customerId}::${month}`;
    return (s.planUsage || {})[key] || 0;
  }

  async incrementPlanUsage(tenantId: string, customerId: string): Promise<void> {
    const s = await this.getSettings(tenantId);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const key = `${customerId}::${month}`;
    const usage = { ...(s.planUsage || {}) };
    usage[key] = (usage[key] || 0) + 1;
    await this.updateSettings(tenantId, { planUsage: usage });
  }

  // ─── FOLLOW-UP NAMED MODES (convenience wrappers) ───────────────────

  async getNamedModes(tenantId: string): Promise<{ aviso: FollowUpNamedMode[]; lembrete: FollowUpNamedMode[]; reativacao: FollowUpNamedMode[] }> {
    const s = await this.getSettings(tenantId);
    return {
      aviso: s.avisoModes || [],
      lembrete: s.lembreteModes || [],
      reativacao: s.reativacaoModes || []
    };
  }

  // ─── FINANCIAL ──────────────────────────────────────────────────────

  async getFinancialSummary(tenantId: string, period: number, professionalId?: string) {
    try {
      const apps = await this.getAppointments(tenantId);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - period);
      const filtered = apps.filter(a =>
        new Date(a.startTime) >= startDate &&
        a.status === AppointmentStatus.FINISHED &&
        !a.isPlan &&                              // exclude plan appointments
        a.source !== BookingSource.PLAN &&        // exclude plan source too
        (!professionalId || a.professional_id === professionalId)
      );
      const res: any = {
        totalRevenue: 0, totalExpenses: 0,
        [PaymentMethod.MONEY]: 0, [PaymentMethod.PIX]: 0,
        [PaymentMethod.DEBIT]: 0, [PaymentMethod.CREDIT]: 0
      };
      filtered.forEach(a => {
        res.totalRevenue += (a.amountPaid || 0);
        if (a.paymentMethod) res[a.paymentMethod] = (res[a.paymentMethod] || 0) + (a.amountPaid || 0);
      });
      return res;
    } catch (err) {
      console.error("Error getting financial summary:", err);
      return { totalRevenue: 0, totalExpenses: 0 };
    }
  }

  async getGlobalStats() {
    try {
      const tenants = await this.getAllTenants();
      return {
        totalTenants: tenants.length,
        activeTenants: tenants.filter(t => t.status === TenantStatus.ACTIVE).length,
        mrr: tenants.reduce((acc, t) => acc + (t.monthlyFee || 0), 0),
        globalVolume: 0
      };
    } catch (err) {
      console.error("Error getting global stats:", err);
      return { totalTenants: 0, activeTenants: 0, mrr: 0, globalVolume: 0 };
    }
  }

  async getExpenses(tenantId: string, _period?: number, _professionalId?: string): Promise<Expense[]> {
    try {
      const { data, error } = await supabase.from('expenses').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(e => ({
        id: e.id,
        tenant_id: e.tenant_id,
        description: e.description,
        amount: Number(e.amount),
        category: e.category,
        professional_id: e.professional_id,
        date: e.date
      }));
    } catch (err) {
      console.error("Error fetching expenses:", err);
      return [];
    }
  }

  async addExpense(exp: any) {
    try {
      const { error } = await supabase.from('expenses').insert({
        tenant_id: exp.tenant_id,
        description: exp.description,
        amount: exp.amount,
        category: exp.category,
        professional_id: exp.professional_id,
        date: exp.date || new Date().toISOString()
      });
      if (error) throw error;
    } catch (e) {
      console.error("Error adding expense:", e);
      throw e;
    }
  }

  async getCoverImage(_tenantId: string): Promise<string> { return ''; }
  async setCoverImage(_tenantId: string, _url: string) {}
}

export const db = new DatabaseService();
