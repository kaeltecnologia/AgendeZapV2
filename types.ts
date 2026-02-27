
export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  FINISHED = 'FINISHED'
}

export enum BookingSource {
  AI = 'AI',
  MANUAL = 'MANUAL',
  WEB = 'WEB',
  PLAN = 'PLAN'   // Appointment under an active plan — not charged financially
}

export enum PaymentMethod {
  MONEY = 'DINHEIRO',
  PIX = 'PIX',
  DEBIT = 'DÉBITO',
  CREDIT = 'CRÉDITO'
}

export enum TenantStatus {
  ACTIVE = 'ATIVA',
  PAUSED = 'PAUSADA',
  CANCELLED = 'CANCELADA',
  BLOCKED = 'BLOQUEADA',
  PENDING_PAYMENT = 'PAGAMENTO PENDENTE'
}

export interface WorkingDay {
  active: boolean;
  range: string; // "09:00-18:00"
}

export interface FollowUpConfig {
  active: boolean;
  message: string;
  timing: number; // minutes or days
  fixedTime?: string; // For "Aviso do Dia" (HH:mm)
}

// Break / interval period — blocks agent from booking during this window
export interface BreakPeriod {
  id: string;
  label: string;
  type?: 'break' | 'lunch' | 'vacation'; // default 'break'
  professionalId?: string | null; // null or absent = applies to all professionals
  date?: string | null;           // YYYY-MM-DD, one-time; null = recurring
  vacationEndDate?: string | null; // for type='vacation': last day of vacation
  dayOfWeek?: number | null;      // 0-6 for weekly-recurring; null = every day
  startTime: string;              // HH:mm
  endTime: string;                // HH:mm
}

// Stock / inventory item
export interface InventoryItem {
  id: string;
  name: string;
  category?: string;
  quantity: number;
  unit: string;         // "unidades", "ml", "g", "kg", "L"
  purchaseCost: number; // cost per unit at last purchase
  minStock?: number;    // low-stock alert threshold
  lastUpdated: string;  // ISO datetime
}

// Monthly / recurring service plan (package)
export interface Plan {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  price: number;             // monthly fee
  proceduresPerMonth: number;// how many procedures are covered per month
  serviceId?: string;        // specific service covered (optional)
  features: string[];        // list of included services / notes
  active: boolean;
}

// Custom follow-up mode (created by admin, assigned per customer)
export interface FollowUpMode {
  id: string;
  name: string;
  description: string;
}

// Named follow-up strategy template per type (aviso / lembrete / reativacao)
export interface FollowUpNamedMode {
  id: string;
  name: string;
  active: boolean;
  message: string;
  timing: number;        // minutes (lembrete), days (reativacao), irrelevant for aviso
  fixedTime?: string;   // HH:mm — used by aviso type
}

export interface TenantSettings {
  followUp: {
    aviso: FollowUpConfig;
    lembrete: FollowUpConfig;
    reativacao: FollowUpConfig;
  };
  operatingHours: {
    [key: number]: WorkingDay; // 0-6 (Sunday-Saturday)
  };
  aiActive: boolean;
  themeColor: string;
  whatsapp?: string;                   // official WhatsApp number
  breaks?: BreakPeriod[];              // break / interval blocks
  customModes?: FollowUpMode[];        // legacy custom follow-up modes
  avisoModes?: FollowUpNamedMode[];    // named check-in strategies
  lembreteModes?: FollowUpNamedMode[]; // named reminder strategies
  reativacaoModes?: FollowUpNamedMode[];// named reactivation strategies
  plans?: Plan[];                       // monthly plans (stored in JSONB)
  planUsage?: Record<string, number>;   // { "customerId::YYYY-MM": count }
  professionalMeta?: Record<string, {   // per-professional role (stored in JSONB)
    role: 'admin' | 'colab';
  }>;
  customerData?: Record<string, {       // per-customer plan/mode data (stored in JSONB)
    planId?: string | null;
    planServiceId?: string | null;
    avisoModeId?: string;
    lembreteModeId?: string;
    reativacaoModeId?: string;
  }>;
  followUpSent?: Record<string, string>; // tracks sent messages e.g. "aviso::apptId" → "YYYY-MM-DD"
  inventory?: InventoryItem[];           // product stock list
  aiLeadActive?: boolean;               // IA para Leads toggle
  aiProfessionalActive?: boolean;       // Assessor do Profissional toggle
  systemPrompt?: string;                // AI agent system prompt
  agentName?: string;                   // AI agent personality name
}

export interface Appointment {
  id: string;
  tenant_id: string;
  customer_id: string;
  professional_id: string;
  service_id: string;
  startTime: string;
  durationMinutes: number;
  status: AppointmentStatus;
  source: BookingSource;
  paymentMethod?: PaymentMethod;
  amountPaid?: number;
  extraNote?: string;
  extraValue?: number;
  isPlan?: boolean; // if true, appointment is covered by a plan → excluded from financial totals
}

export interface Expense {
  id: string;
  tenant_id: string;
  description: string;
  amount: number;
  category: 'COMPANY' | 'PROFESSIONAL';
  professional_id?: string;
  date: string;
  paymentMethod?: PaymentMethod;
}

export enum SessionStatus {
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING'
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  email?: string;
  password?: string;
  phone?: string;           // owner phone for billing/announcement reminders
  due_day?: number;         // payment due day of month (1-31)
  evolution_instance?: string;
  plan: 'BASIC' | 'PRO' | 'ENTERPRISE';
  status: TenantStatus;
  monthlyFee: number;
  createdAt: string;
}

export interface Professional {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  specialty: string;
  active: boolean;
  role?: 'admin' | 'colab'; // 'admin' = proprietário (acesso total), 'colab' = funcionário (próprios dados)
}

export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  price: number;
  durationMinutes: number;
  active: boolean;
}

export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  birthDate?: string;
  active: boolean;
  followUpPreferences: {
    aviso: boolean;
    lembrete: boolean;
    reativacao: boolean;
  };
  avisoModeId?: string;       // named aviso mode id (or 'standard')
  lembreteModeId?: string;    // named lembrete mode id (or 'standard')
  reativacaoModeId?: string;  // named reativacao mode id (or 'standard')
  planId?: string | null;     // active plan id
  planServiceId?: string | null; // specific service covered by plan
}
