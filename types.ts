
export enum AppointmentStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  FINISHED = 'FINISHED'
}

export enum BookingSource {
  AI = 'AI',
  MANUAL = 'MANUAL',
  WEB = 'WEB'
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
}

export interface Expense {
  id: string;
  tenant_id: string;
  description: string;
  amount: number;
  category: 'COMPANY' | 'PROFESSIONAL';
  professional_id?: string;
  date: string;
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
}
