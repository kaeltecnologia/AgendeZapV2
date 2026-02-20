
import { supabase, isSupabaseConfigured } from './supabase';
import { 
  Tenant, Professional, Service, Appointment, 
  Customer, AppointmentStatus, PaymentMethod, TenantSettings, TenantStatus, BookingSource, Expense
} from '../types';

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

  // --- TENANTS ---
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
        evolution_instance: tenant.slug
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
      if (updates.name) payload.nome = updates.name;
      if (updates.status) payload.status = updates.status;
      if (updates.monthlyFee !== undefined) payload.mensalidade = updates.monthlyFee;
      if (updates.plan) payload.plan = updates.plan;
      if (updates.email) payload.email = updates.email;
      if (updates.password) payload.password = updates.password;

      const { error } = await supabase.from('tenants').update(payload).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Tenant Update Error:", e);
      throw e;
    }
  }

  // --- APPOINTMENTS ---
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
          amountPaid: Number(a.amount_paid || 0)
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
      
      const { data, error } = await supabase.from('appointments').insert({ 
        tenant_id: app.tenant_id, 
        customer_id: app.customer_id, 
        professional_id: app.professional_id, 
        service_id: app.service_id, 
        inicio: start.toISOString(), 
        fim: end.toISOString(), 
        status: app.status || AppointmentStatus.PENDING, 
        origem: app.source || BookingSource.WEB
      }).select().single();
      
      if (error) throw error;
      
      return { 
        ...data, 
        startTime: data.inicio, 
        durationMinutes: app.durationMinutes,
        source: data.origem
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

  // --- PROFESSIONALS ---
  async getProfessionals(tenantId: string): Promise<Professional[]> {
    try {
      const { data, error } = await supabase.from('professionals').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(p => ({
        id: p.id,
        tenant_id: p.tenant_id,
        name: p.nome || 'Sem Nome',
        phone: p.phone || '',
        specialty: p.especialidade || '',
        active: p.ativo ?? true
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
    } catch(e) {
      console.error("Supabase Professional Insert Error:", e);
      throw e;
    }
  }

  async updateProfessional(id: string, pro: Partial<Professional>) {
    try {
      const { error } = await supabase.from('professionals').update({
        nome: pro.name,
        phone: pro.phone,
        especialidade: pro.specialty,
        ativo: pro.active
      }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error("Supabase Professional Update Error:", e);
      throw e;
    }
  }

  // --- SERVICES ---
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
    } catch(e) {
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

  // --- CUSTOMERS ---
  async getCustomers(tenantId: string): Promise<Customer[]> {
    try {
      const { data, error } = await supabase.from('customers').select('*').eq('tenant_id', tenantId);
      if (error) throw error;
      return (data || []).map(c => ({ 
        id: c.id,
        tenant_id: c.tenant_id,
        name: c.nome || 'Sem Nome',
        phone: c.telefone || '',
        active: true,
        followUpPreferences: { aviso: true, lembrete: true, reativacao: true } 
      }));
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
      return { 
        id: data.id, 
        tenant_id: data.tenant_id,
        name: data.nome, 
        phone: data.telefone,
        active: true,
        followUpPreferences: { aviso: true, lembrete: true, reativacao: true }
      };
    } catch(e) {
      console.error("Supabase Customer Insert Error:", e);
      throw e;
    }
  }

  async findOrCreateCustomer(tenantId: string, phone: string, name: string) {
    try {
      const { data: existing, error: fetchError } = await supabase
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('telefone', phone)
        .maybeSingle();
      
      if (fetchError) throw fetchError;
      if (existing) return {
        id: existing.id,
        tenant_id: existing.tenant_id,
        name: existing.nome,
        phone: existing.telefone,
        active: true,
        followUpPreferences: { aviso: true, lembrete: true, reativacao: true }
      };

      return await this.addCustomer({ tenant_id: tenantId, name, phone });
    } catch (err) {
      console.error("Error findOrCreateCustomer:", err);
      throw err;
    }
  }

  async isSlotAvailable(tenantId: string, professionalId: string, startTime: Date, durationMinutes: number): Promise<{ available: boolean; reason?: string }> {
    try {
      const settings = await this.getSettings(tenantId);
      const dayIndex = startTime.getDay(); // 0 (Sun) to 6 (Sat)
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

  async getSettings(tenantId: string): Promise<TenantSettings> {
    const defaults: TenantSettings = {
      followUp: {
        aviso: { active: true, message: "Aviso", timing: 0, fixedTime: "08:00" },
        lembrete: { active: true, message: "Lembrete", timing: 60 },
        reativacao: { active: true, message: "Sumido", timing: 30 }
      },
      operatingHours: { 1: { active: true, range: "09:00-18:00" }, 2: { active: true, range: "09:00-18:00" }, 3: { active: true, range: "09:00-18:00" }, 4: { active: true, range: "09:00-18:00" }, 5: { active: true, range: "09:00-18:00" }, 6: { active: true, range: "09:00-18:00" }, 0: { active: false, range: "09:00-18:00" } },
      aiActive: false, themeColor: "#f97316"
    };
    try {
      const { data, error } = await supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
      if (error) throw error;
      if (data) return { 
        followUp: data.follow_up, 
        operatingHours: data.operating_hours, 
        aiActive: data.ai_active, 
        themeColor: data.theme_color
      };
    } catch (e) {
      console.error("Error fetching settings:", e);
    }
    return defaults;
  }

  async updateSettings(tenantId: string, updates: any) {
    try {
      const curr = await this.getSettings(tenantId);
      const newS = { ...curr, ...updates };
      
      const { error } = await supabase.from('tenant_settings').upsert({ 
        tenant_id: tenantId, 
        follow_up: newS.followUp, 
        operating_hours: newS.operatingHours, 
        ai_active: newS.aiActive, 
        theme_color: newS.themeColor 
      });
      if (error) throw error;
    } catch (e) {
      console.error("Error updating settings:", e);
      throw e;
    }
  }

  async getFinancialSummary(tenantId: string, period: number, professionalId?: string) {
    try {
      const apps = await this.getAppointments(tenantId);
      const startDate = new Date(); startDate.setDate(startDate.getDate() - period);
      const filtered = apps.filter(a => new Date(a.startTime) >= startDate && a.status === AppointmentStatus.FINISHED && (!professionalId || a.professional_id === professionalId));
      const res: any = { totalRevenue: 0, totalExpenses: 0, [PaymentMethod.MONEY]: 0, [PaymentMethod.PIX]: 0, [PaymentMethod.DEBIT]: 0, [PaymentMethod.CREDIT]: 0 };
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
        activeTenants: tenants.filter(t=>t.status===TenantStatus.ACTIVE).length, 
        mrr: tenants.reduce((acc,t)=>acc+(t.monthlyFee||0),0), 
        globalVolume: 0 
      };
    } catch (err) {
      console.error("Error getting global stats:", err);
      return { totalTenants: 0, activeTenants: 0, mrr: 0, globalVolume: 0 };
    }
  }

  async getExpenses(tenantId: string, period?: number, professionalId?: string): Promise<Expense[]> {
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

  async getCoverImage(tenantId: string): Promise<string> { return ''; }
  async setCoverImage(tenantId: string, url: string) {}
}

export const db = new DatabaseService();

