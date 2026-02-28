
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { TenantStatus, Tenant } from '../types';
import { evolutionService } from '../services/evolutionService';
import { fetchUsageStats, UsageSummary } from '../services/usageTracker';
import { NICHOS } from '../config/nichoConfigs';
import { PLAN_CONFIGS, getPlanConfig } from '../config/planConfig';
import { ProspectCampaign, loadCampaigns, saveCampaigns, loadAdminInstance } from '../services/serperService';
import AdminConversasPanel from './AdminConversasPanel';
import AdminProspeccaoPanel from './AdminProspeccaoPanel';
import AdminDisparoPanel from './AdminDisparoPanel';

// ── Types ──────────────────────────────────────────────────────────────────────

interface GlobalStats {
  totalTenants: number;
  activeTenants: number;
  mrr: number;
  globalVolume: number;
  totalAppts: number;
  newThisMonth: number;
  totalCustomers: number;
  byStatus: Record<string, number>;
}

interface BillingReminder {
  daysOffset: number; // 3=3 days before, 0=on due date
  label: string;
  message: string;
  enabled: boolean;
}

interface AdminLog {
  ts: string;
  action: string;
  detail: string;
}

type Tab = 'dashboard' | 'clients' | 'avisos' | 'cobranca' | 'logs' | 'sql' | 'ia' | 'conversas' | 'disparo' | 'prospeccao' | 'suporte';

const STATUS_COLORS: Record<string, string> = {
  [TenantStatus.ACTIVE]: '#22c55e',
  [TenantStatus.PAUSED]: '#f59e0b',
  [TenantStatus.CANCELLED]: '#ef4444',
  [TenantStatus.BLOCKED]: '#64748b',
  [TenantStatus.PENDING_PAYMENT]: '#f97316',
};

const STATUS_LABELS: Record<string, string> = {
  [TenantStatus.ACTIVE]: 'Ativa',
  [TenantStatus.PAUSED]: 'Pausada',
  [TenantStatus.CANCELLED]: 'Cancelada',
  [TenantStatus.BLOCKED]: 'Bloqueada',
  [TenantStatus.PENDING_PAYMENT]: 'Pag. Pendente',
};

const DEFAULT_BILLING_REMINDERS: BillingReminder[] = [
  { daysOffset: 3, label: 'Antepenúltimo dia', message: 'Olá {nome}! 👋 Sua mensalidade AgendeZap de R$ {valor} vence em *3 dias* (dia {dia}). Renove para manter seu acesso ativo! 🚀', enabled: false },
  { daysOffset: 2, label: 'Penúltimo dia', message: 'Olá {nome}! ⏰ Sua mensalidade AgendeZap de R$ {valor} vence em *2 dias* (dia {dia}). Não deixe seu sistema parar!', enabled: false },
  { daysOffset: 1, label: 'Último dia', message: 'Atenção {nome}! ⚠️ Amanhã é o último dia para pagar sua mensalidade AgendeZap (R$ {valor}). Renove agora e continue atendendo seus clientes!', enabled: false },
  { daysOffset: 0, label: 'Dia do vencimento', message: 'Olá {nome}! 🔴 Hoje vence sua mensalidade AgendeZap (R$ {valor}). Realize o pagamento para evitar a suspensão do serviço. Obrigado!', enabled: false },
];

function loadAdminLogs(): AdminLog[] {
  try { return JSON.parse(localStorage.getItem('agz_admin_logs') || '[]'); } catch { return []; }
}
function saveAdminLog(action: string, detail: string) {
  const logs = loadAdminLogs();
  logs.unshift({ ts: new Date().toISOString(), action, detail });
  localStorage.setItem('agz_admin_logs', JSON.stringify(logs.slice(0, 100)));
}
function loadBillingConfig(): BillingReminder[] {
  try {
    const saved = JSON.parse(localStorage.getItem('agz_billing_config') || 'null');
    return saved || DEFAULT_BILLING_REMINDERS;
  } catch { return DEFAULT_BILLING_REMINDERS; }
}
function saveBillingConfig(config: BillingReminder[]) {
  localStorage.setItem('agz_billing_config', JSON.stringify(config));
}
function loadBillingSent(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem('agz_billing_sent') || '{}'); } catch { return {}; }
}
function saveBillingSent(sent: Record<string, string>) {
  localStorage.setItem('agz_billing_sent', JSON.stringify(sent));
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface SuperAdminViewProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onImpersonate: (id: string, name: string, slug: string, plan?: string) => void;
}

const SuperAdminView: React.FC<SuperAdminViewProps> = ({ activeTab: tab, onTabChange: setTab, onImpersonate }) => {
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  // New tenant modal
  const [showNew, setShowNew] = useState(false);
  const [successData, setSuccessData] = useState<{ email: string; pass: string; slug: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newFee, setNewFee] = useState('0');
  const [newPhone, setNewPhone] = useState('');
  const [newDueDay, setNewDueDay] = useState('');
  const [newNicho, setNewNicho] = useState('Barbearia');
  const [newSubscriptionPlan, setNewSubscriptionPlan] = useState('START');

  // Edit modal
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Client list filters
  const [clientSearch, setClientSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState('');
  const [clientNichoFilter, setClientNichoFilter] = useState('');

  // Announcements
  const [announceTo, setAnnounceTo] = useState<'all' | 'active'>('active');
  const [announceMsg, setAnnounceMsg] = useState('');
  const [sendingAnnounce, setSendingAnnounce] = useState(false);
  const [announceResult, setAnnounceResult] = useState<{ ok: number; fail: number } | null>(null);

  // AI usage
  const [usagePeriod, setUsagePeriod] = useState<'today' | 'week' | 'month'>('week');
  const [usageStats, setUsageStats] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Billing
  const [billingReminders, setBillingReminders] = useState<BillingReminder[]>(loadBillingConfig);
  const [runningBilling, setRunningBilling] = useState(false);
  const [billingResult, setBillingResult] = useState<string | null>(null);

  // Logs
  const [logs, setLogs] = useState<AdminLog[]>(loadAdminLogs);

  // Admin WhatsApp + prospecção
  const [adminInstanceName, setAdminInstanceName] = useState(() => loadAdminInstance());
  const [adminConnected, setAdminConnected] = useState(false);
  const [prospectCampaigns, setProspectCampaigns] = useState<ProspectCampaign[]>(() => loadCampaigns());
  const [disparoCampaignId, setDisparoCampaignId] = useState<string | undefined>(undefined);

  // Support inbox
  type SupportRequest = { tenantId: string; tenantName: string; plan: string; request: { message: string; currentPlan: string; feature: string; ts: string; status: string } };
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([db.getGlobalStats(), db.getAllTenants()]);
      setStats(s as GlobalStats);
      setTenants([...t].reverse());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    const stats = await fetchUsageStats(usagePeriod);
    setUsageStats(stats);
    setUsageLoading(false);
  }, [usagePeriod]);

  useEffect(() => { if (tab === 'ia') loadUsage(); }, [tab, loadUsage]);

  const loadSupportRequests = useCallback(async () => {
    setSupportLoading(true);
    try {
      const reqs = await (db as any).getAllSupportRequests();
      setSupportRequests(reqs);
    } catch (e) { console.error(e); }
    finally { setSupportLoading(false); }
  }, []);

  useEffect(() => { if (tab === 'suporte') loadSupportRequests(); }, [tab, loadSupportRequests]);

  const handleDismissSupport = async (tenantId: string) => {
    await (db as any).dismissSupportRequest(tenantId);
    setSupportRequests(prev => prev.filter(r => r.tenantId !== tenantId));
  };

  const handleCampaignsChange = (updated: ProspectCampaign[]) => {
    setProspectCampaigns(updated);
    saveCampaigns(updated);
  };

  const handleGoToDisparo = (campaignId: string) => {
    setDisparoCampaignId(campaignId);
    setTab('disparo' as Tab);
  };

  // ── Create tenant ────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const slug = newName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^\w-]/g, '');
      const email = newEmail.trim() || `${slug}@agendezap.com`;
      const pass = newPass.trim() || `Zap@${Math.floor(1000 + Math.random() * 9000)}`;
      const fee = parseFloat(newFee) || 0;
      const dueDay = parseInt(newDueDay) || undefined;
      const phone = newPhone.trim() || undefined;

      const t = await db.addTenant({ name: newName, slug, email, password: pass, subscriptionPlan: newSubscriptionPlan, status: TenantStatus.ACTIVE, monthlyFee: fee, nicho: newNicho });
      if (phone || dueDay) await db.updateTenant(t.id, { phone, due_day: dueDay });

      try {
        await Promise.race([
          evolutionService.createAndFetchQr(slug),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
        ]);
      } catch { /* Evolution timeout is non-fatal */ }

      setSuccessData({ email, pass, slug });
      setNewName(''); setNewEmail(''); setNewPass(''); setNewFee('0'); setNewPhone(''); setNewDueDay(''); setNewNicho('Barbearia'); setNewSubscriptionPlan('START');
      saveAdminLog('TENANT_CREATED', `${newName} (${email})`);
      setLogs(loadAdminLogs());
      load();
    } catch (e: any) {
      alert('Erro ao criar unidade: ' + (e.message || 'Verifique o console'));
    } finally { setCreating(false); }
  };

  // ── Update tenant ────────────────────────────────────────────────────────────

  const handleUpdate = async () => {
    if (!editingTenant) return;
    setSaving(true);
    try {
      await db.updateTenant(editingTenant.id, {
        status: editingTenant.status,
        monthlyFee: editingTenant.monthlyFee,
        email: editingTenant.email,
        password: editingTenant.password,
        phone: editingTenant.phone,
        due_day: editingTenant.due_day,
        nicho: editingTenant.nicho,
        plan: editingTenant.plan,
      });
      saveAdminLog('TENANT_UPDATED', `${editingTenant.name}`);
      setLogs(loadAdminLogs());
      setEditingTenant(null);
      load();
    } catch (e) { alert('Erro ao atualizar'); }
    finally { setSaving(false); }
  };

  // ── Delete tenant ────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteId) return;
    const t = tenants.find(x => x.id === deleteId);
    try {
      await db.deleteTenant(deleteId);
      saveAdminLog('TENANT_DELETED', t?.name || deleteId);
      setLogs(loadAdminLogs());
      setDeleteId(null);
      load();
    } catch (e) { alert('Erro ao excluir'); }
  };

  // ── Announcements ────────────────────────────────────────────────────────────

  const handleAnnounce = async () => {
    if (!announceMsg.trim()) return;
    setSendingAnnounce(true);
    setAnnounceResult(null);
    let ok = 0, fail = 0;
    const targets = announceTo === 'active' ? tenants.filter(t => t.status === TenantStatus.ACTIVE) : tenants;
    for (const t of targets) {
      if (!t.phone || !t.evolution_instance) { fail++; continue; }
      try {
        await evolutionService.sendMessage(t.evolution_instance, t.phone, announceMsg);
        ok++;
      } catch { fail++; }
    }
    setAnnounceResult({ ok, fail });
    saveAdminLog('ANNOUNCEMENT_SENT', `${ok} enviados, ${fail} falhas`);
    setLogs(loadAdminLogs());
    setSendingAnnounce(false);
  };

  // ── Billing reminders ────────────────────────────────────────────────────────

  const handleRunBilling = async () => {
    setRunningBilling(true);
    setBillingResult(null);
    const sent = loadBillingSent();
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    let ok = 0, skip = 0;

    const enabledReminders = billingReminders.filter(r => r.enabled);
    if (!enabledReminders.length) {
      setBillingResult('Nenhum lembrete habilitado.');
      setRunningBilling(false);
      return;
    }

    for (const t of tenants) {
      if (!t.due_day || !t.phone || !t.evolution_instance) continue;
      if (t.status !== TenantStatus.ACTIVE && t.status !== TenantStatus.PENDING_PAYMENT) continue;

      const dueDate = new Date(now.getFullYear(), now.getMonth(), t.due_day);
      if (dueDate < now && dueDate.getMonth() === now.getMonth()) {
        // Due date already passed this month — skip
        continue;
      }
      const daysUntil = Math.round((dueDate.getTime() - now.setHours(0, 0, 0, 0)) / 86400000);

      for (const reminder of enabledReminders) {
        if (daysUntil !== reminder.daysOffset) continue;
        const key = `${t.id}::${month}::${reminder.daysOffset}`;
        if (sent[key]) { skip++; continue; }

        const msg = reminder.message
          .replace(/\{nome\}/gi, t.name)
          .replace(/\{valor\}/gi, `R$ ${t.monthlyFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
          .replace(/\{dia\}/gi, String(t.due_day));

        try {
          await evolutionService.sendMessage(t.evolution_instance, t.phone, msg);
          sent[key] = new Date().toISOString();
          ok++;
        } catch { skip++; }
      }
    }
    saveBillingSent(sent);
    saveAdminLog('BILLING_RUN', `${ok} enviados, ${skip} ignorados`);
    setLogs(loadAdminLogs());
    setBillingResult(`✅ ${ok} lembretes enviados · ${skip} ignorados (já enviados)`);
    setRunningBilling(false);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const filteredTenants = tenants.filter(t => {
    if (clientSearch && !t.name.toLowerCase().includes(clientSearch.toLowerCase()) && !t.email?.toLowerCase().includes(clientSearch.toLowerCase())) return false;
    if (clientStatusFilter && t.status !== clientStatusFilter) return false;
    if (clientNichoFilter && ((t as any).nicho || 'Barbearia') !== clientNichoFilter) return false;
    return true;
  });

  // ── Charts data ──────────────────────────────────────────────────────────────

  const statusPieData = stats
    ? Object.entries(stats.byStatus || {})
        .filter(([, v]) => (v as number) > 0)
        .map(([k, v]) => ({ name: STATUS_LABELS[k] || k, value: v as number, color: STATUS_COLORS[k] || '#94a3b8' }))
    : [];

  const topTenantsByFee = [...tenants]
    .sort((a, b) => b.monthlyFee - a.monthlyFee)
    .slice(0, 6)
    .map(t => ({ name: t.name.split(' ')[0], fee: t.monthlyFee }));

  // ── SQL script ───────────────────────────────────────────────────────────────

  const sqlScript = `-- SCRIPT DE REPARO AGENDEZAP --
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='email') THEN ALTER TABLE tenants ADD COLUMN email TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='password') THEN ALTER TABLE tenants ADD COLUMN password TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='plan') THEN ALTER TABLE tenants ADD COLUMN plan TEXT DEFAULT 'BASIC'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='status') THEN ALTER TABLE tenants ADD COLUMN status TEXT DEFAULT 'ATIVA'; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='mensalidade') THEN ALTER TABLE tenants ADD COLUMN mensalidade NUMERIC DEFAULT 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='nome') THEN ALTER TABLE tenants ADD COLUMN nome TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='phone') THEN ALTER TABLE tenants ADD COLUMN phone TEXT; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='due_day') THEN ALTER TABLE tenants ADD COLUMN due_day INTEGER; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='nicho') THEN ALTER TABLE tenants ADD COLUMN nicho TEXT DEFAULT 'Barbearia'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='evolution_instance') THEN ALTER TABLE tenants ALTER COLUMN evolution_instance DROP NOT NULL; END IF;
END $$;

CREATE TABLE IF NOT EXISTS professionals (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), nome TEXT, phone TEXT NOT NULL, especialidade TEXT, ativo BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS services (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), nome TEXT, preco NUMERIC, duracao_minutos INTEGER, ativo BOOLEAN DEFAULT true);
CREATE TABLE IF NOT EXISTS customers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), nome TEXT, telefone TEXT NOT NULL, ativo BOOLEAN DEFAULT true, plan_id UUID, follow_up_mode TEXT);
CREATE TABLE IF NOT EXISTS tenant_settings (tenant_id UUID PRIMARY KEY REFERENCES tenants(id), follow_up JSONB, operating_hours JSONB, ai_active BOOLEAN DEFAULT false, theme_color TEXT DEFAULT '#f97316');
CREATE TABLE IF NOT EXISTS appointments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), customer_id UUID REFERENCES customers(id), professional_id UUID REFERENCES professionals(id), service_id UUID REFERENCES services(id), inicio TIMESTAMPTZ, fim TIMESTAMPTZ, status TEXT DEFAULT 'PENDING', origem TEXT DEFAULT 'WEB', payment_method TEXT, amount_paid NUMERIC, extra_note TEXT, extra_value NUMERIC);
CREATE TABLE IF NOT EXISTS expenses (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID REFERENCES tenants(id), description TEXT, amount NUMERIC, category TEXT, professional_id UUID REFERENCES professionals(id), date TIMESTAMPTZ DEFAULT now());

-- ╔══════════════════════════════════════════════════════════════╗
-- ║  TRACKING DE TOKENS DE IA — execute para habilitar o painel ║
-- ╚══════════════════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  phone_number TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT NOT NULL DEFAULT 'gemini-2.0-flash',
  estimated_cost_usd DECIMAL(12,8) DEFAULT 0,
  success BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant ON ai_usage_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_date ON ai_usage_logs(created_at DESC);
-- Habilitar RLS e acesso service_role:
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_usage_logs' AND policyname='service_role_all') THEN
    CREATE POLICY "service_role_all" ON ai_usage_logs FOR ALL TO service_role USING (true);
  END IF;
END $$;`.trim();

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center p-20 gap-4">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Sincronizando Painel Mestre...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Visão global do AgendeZap SaaS</p>
        </div>
        {tab !== 'sql' && tab !== 'logs' && (
          <button
            onClick={() => { setShowNew(true); setSuccessData(null); }}
            className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:bg-black transition-all"
          >
            + Nova Unidade
          </button>
        )}
      </div>

      {/* ══════════════════════ DASHBOARD ══════════════════════ */}
      {tab === 'dashboard' && (
        <div className="space-y-8">
          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <StatCard label="Total de Clientes" value={String(stats.totalTenants)} icon="🏢" sub={`${stats.newThisMonth} novos este mês`} />
            <StatCard label="Clientes Ativos" value={String(stats.activeTenants)} icon="✅" color="text-green-600" />
            <StatCard label="MRR" value={`R$ ${stats.mrr.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon="💰" color="text-orange-500" highlight />
            <StatCard label="Faturamento Bruto" value={`R$ ${stats.globalVolume.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} icon="💹" sub="Soma de todos os agendamentos finalizados" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <StatCard label="Total de Agendamentos" value={stats.totalAppts.toLocaleString()} icon="📅" />
            <StatCard label="Total de Clientes Finais" value={stats.totalCustomers.toLocaleString()} icon="👥" />
            <StatCard label="Ticket Médio Mensalidade" value={stats.activeTenants > 0 ? `R$ ${(stats.mrr / stats.activeTenants).toFixed(0)}` : 'R$ 0'} icon="🎯" />
            <StatCard label="Inadimplentes / Pausados" value={String((stats.byStatus?.[TenantStatus.PENDING_PAYMENT] || 0) + (stats.byStatus?.[TenantStatus.PAUSED] || 0))} icon="⚠️" color="text-amber-500" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Status distribution pie */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Distribuição por Status</p>
              {statusPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={statusPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3}>
                      {statusPieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`${v} cliente(s)`, '']} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-slate-300 text-xs py-12">Sem dados</p>}
              <div className="flex flex-wrap gap-3 mt-4">
                {statusPieData.map(d => (
                  <div key={d.name} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-[9px] font-black text-slate-500 uppercase">{d.name} ({d.value})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top clients by fee bar chart */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Top Clientes por Mensalidade</p>
              {topTenantsByFee.length > 0 ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topTenantsByFee} barSize={24}>
                    <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 900, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v: any) => [`R$ ${Number(v).toFixed(2)}`, 'Mensalidade']} />
                    <Bar dataKey="fee" fill="#000" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-slate-300 text-xs py-12">Sem dados</p>}
            </div>
          </div>

          {/* Recent tenants list */}
          <div className="bg-white rounded-3xl border border-slate-100 p-8">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">Últimos Clientes Cadastrados</p>
            <div className="space-y-3">
              {tenants.slice(0, 5).map(t => (
                <div key={t.id} className="flex items-center justify-between py-3 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center font-black text-sm">{t.name[0]}</div>
                    <div>
                      <p className="font-black text-sm text-black uppercase">{t.name}</p>
                      <p className="text-[9px] text-slate-400 font-bold">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase`} style={{ backgroundColor: `${STATUS_COLORS[t.status]}20`, color: STATUS_COLORS[t.status] }}>
                      {STATUS_LABELS[t.status] || t.status}
                    </span>
                    <span className="font-black text-black text-sm">R$ {t.monthlyFee.toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ CLIENTS ══════════════════════ */}
      {tab === 'clients' && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <input
              value={clientSearch}
              onChange={e => setClientSearch(e.target.value)}
              placeholder="🔍 Buscar por nome ou email..."
              className="flex-1 min-w-[220px] p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500"
            />
            <select
              value={clientStatusFilter}
              onChange={e => setClientStatusFilter(e.target.value)}
              className="p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500"
            >
              <option value="">Todos os status</option>
              {Object.values(TenantStatus).map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
            </select>
            <select
              value={clientNichoFilter}
              onChange={e => setClientNichoFilter(e.target.value)}
              className="p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500"
            >
              <option value="">Todos os nichos</option>
              {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Table */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="overflow-y-auto max-h-[600px]">
              <table className="w-full">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {['Empresa', 'Nicho', 'Plano', 'Acesso', 'Telefone', 'Status', 'Mensalidade', 'Venc.', 'Ações'].map(h => (
                      <th key={h} className="px-5 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredTenants.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-12 text-slate-300 font-black uppercase text-xs">Nenhum cliente encontrado</td></tr>
                  ) : filteredTenants.map(t => (
                    <tr key={t.id} className="hover:bg-slate-100 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-black text-white rounded-xl flex items-center justify-center font-black text-sm shrink-0">{t.name[0]}</div>
                          <div>
                            <p className="font-black text-sm text-black">{t.name}</p>
                            <p className="text-[9px] text-slate-400">{t.createdAt ? new Date(t.createdAt).toLocaleDateString('pt-BR') : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-[9px] font-black px-2 py-1 bg-slate-100 text-slate-600 rounded-lg uppercase">{(t as any).nicho || 'Barbearia'}</span>
                      </td>
                      <td className="px-5 py-4">
                        {(() => { const p = getPlanConfig(t.plan); return (
                          <span className={`text-[9px] font-black px-2 py-1 rounded-lg uppercase border ${p.bgClass} ${p.textClass} ${p.borderClass}`}>
                            {p.emoji} {p.name}
                          </span>
                        ); })()}
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-[10px] font-black text-black">{t.email || '—'}</p>
                        <p className="text-[9px] text-slate-400 font-mono">{t.password || '—'}</p>
                      </td>
                      <td className="px-5 py-4 text-[10px] font-bold text-slate-600">{t.phone || '—'}</td>
                      <td className="px-5 py-4">
                        <span className="text-[9px] font-black px-3 py-1.5 rounded-full uppercase" style={{ backgroundColor: `${STATUS_COLORS[t.status]}20`, color: STATUS_COLORS[t.status] }}>
                          {STATUS_LABELS[t.status] || t.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 font-black text-black">R$ {t.monthlyFee.toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm font-black text-slate-600">{t.due_day ? `Dia ${t.due_day}` : '—'}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => onImpersonate(t.id, t.name, t.slug, t.plan)} className="px-3 py-1.5 bg-orange-50 text-orange-600 rounded-xl font-black text-[9px] uppercase hover:bg-orange-100 transition-all">
                            Acessar
                          </button>
                          <button onClick={() => setEditingTenant({ ...t })} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
                            Editar
                          </button>
                          <button onClick={() => setDeleteId(t.id)} className="px-3 py-1.5 bg-red-50 text-red-500 rounded-xl font-black text-[9px] uppercase hover:bg-red-100 transition-all">
                            ✕
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ AVISOS ══════════════════════ */}
      {tab === 'avisos' && (
        <div className="space-y-6 max-w-2xl">
          <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-6">
            <div>
              <h2 className="text-xl font-black text-black uppercase">Enviar Aviso</h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Mensagem enviada via WhatsApp de cada cliente para o telefone do proprietário</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Destinatários</label>
              <div className="flex gap-3">
                {(['active', 'all'] as const).map(v => (
                  <button key={v} onClick={() => setAnnounceTo(v)}
                    className={`flex-1 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${announceTo === v ? 'bg-black text-white border-black' : 'border-slate-200 text-slate-400 hover:border-black hover:text-black'}`}>
                    {v === 'active' ? `✅ Somente Ativos (${tenants.filter(t => t.status === TenantStatus.ACTIVE).length})` : `📢 Todos (${tenants.length})`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Mensagem</label>
              <textarea
                value={announceMsg}
                onChange={e => setAnnounceMsg(e.target.value)}
                rows={5}
                placeholder="Digite o aviso para os clientes..."
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-semibold text-sm outline-none focus:border-orange-500 resize-none"
              />
            </div>

            {announceResult && (
              <div className={`p-4 rounded-2xl ${announceResult.fail > 0 ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
                <p className="text-[10px] font-black uppercase tracking-widest">
                  ✅ {announceResult.ok} enviados · {announceResult.fail > 0 ? `⚠️ ${announceResult.fail} sem telefone/instância` : ''}
                </p>
              </div>
            )}

            <div className="flex gap-4">
              <button onClick={() => { setAnnounceMsg(''); setAnnounceResult(null); }} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={sendingAnnounce}>Limpar</button>
              <button onClick={handleAnnounce} disabled={sendingAnnounce || !announceMsg.trim()} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                {sendingAnnounce ? 'Enviando...' : 'Enviar Aviso →'}
              </button>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
            <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest">⚠️ Pré-requisito</p>
            <p className="text-xs text-amber-600 mt-1">Para enviar avisos, cada cliente precisa ter o campo <strong>Telefone do Proprietário</strong> preenchido e o WhatsApp conectado.</p>
          </div>
        </div>
      )}

      {/* ══════════════════════ COBRANÇA ══════════════════════ */}
      {tab === 'cobranca' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Reminder config */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-6">
              <div>
                <h2 className="text-xl font-black text-black uppercase">Lembretes de Cobrança</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Configure as mensagens enviadas antes do vencimento</p>
              </div>

              <div className="space-y-4">
                {billingReminders.map((r, i) => (
                  <div key={r.daysOffset} className={`rounded-2xl border-2 p-5 space-y-3 transition-all ${r.enabled ? 'border-orange-200 bg-orange-50' : 'border-slate-100 bg-slate-50'}`}>
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-black text-black uppercase tracking-widest">{r.label}</p>
                      <button
                        onClick={() => {
                          const next = [...billingReminders];
                          next[i] = { ...r, enabled: !r.enabled };
                          setBillingReminders(next);
                          saveBillingConfig(next);
                        }}
                        className={`w-12 h-6 rounded-full transition-all relative ${r.enabled ? 'bg-orange-500' : 'bg-slate-200'}`}
                      >
                        <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${r.enabled ? 'left-6' : 'left-0.5'}`} />
                      </button>
                    </div>
                    {r.enabled && (
                      <textarea
                        value={r.message}
                        onChange={e => {
                          const next = [...billingReminders];
                          next[i] = { ...r, message: e.target.value };
                          setBillingReminders(next);
                          saveBillingConfig(next);
                        }}
                        rows={3}
                        className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-orange-400 resize-none"
                      />
                    )}
                    {r.enabled && (
                      <p className="text-[9px] text-slate-400 font-bold">Variáveis: <span className="text-orange-500">{'{nome}'} {'{valor}'} {'{dia}'}</span></p>
                    )}
                  </div>
                ))}
              </div>

              {billingResult && (
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                  <p className="text-[10px] font-black text-green-700 uppercase tracking-widest">{billingResult}</p>
                </div>
              )}

              <button onClick={handleRunBilling} disabled={runningBilling} className="w-full py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                {runningBilling ? 'Verificando...' : '▶ Executar Verificação Agora'}
              </button>
            </div>

            {/* Per-tenant due day config */}
            <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-4">
              <div>
                <h2 className="text-xl font-black text-black uppercase">Vencimentos por Cliente</h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Dia do mês em que a mensalidade vence</p>
              </div>
              <div className="space-y-3 overflow-y-auto max-h-[420px] pr-1">
                {tenants.filter(t => t.status === TenantStatus.ACTIVE || t.status === TenantStatus.PENDING_PAYMENT).map(t => (
                  <div key={t.id} className="flex items-center gap-4 py-3 border-b border-slate-50 last:border-0">
                    <div className="w-8 h-8 bg-black text-white rounded-xl flex items-center justify-center font-black text-xs shrink-0">{t.name[0]}</div>
                    <p className="font-black text-xs text-black flex-1 uppercase truncate">{t.name}</p>
                    <p className="text-[9px] text-slate-400 truncate max-w-[100px]">{t.phone || 'sem tel.'}</p>
                    <input
                      type="number"
                      min={1} max={31}
                      value={t.due_day || ''}
                      placeholder="dia"
                      onChange={async e => {
                        const d = parseInt(e.target.value) || undefined;
                        await db.updateTenant(t.id, { due_day: d });
                        setTenants(prev => prev.map(x => x.id === t.id ? { ...x, due_day: d } : x));
                      }}
                      className="w-16 p-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-center text-xs outline-none focus:border-orange-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════ LOGS ══════════════════════ */}
      {tab === 'logs' && (
        <div className="bg-white rounded-3xl border border-slate-100 p-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-black text-black uppercase">Logs de Atividade</h2>
            <button onClick={() => { localStorage.removeItem('agz_admin_logs'); setLogs([]); }} className="text-[9px] font-black text-red-400 uppercase hover:text-red-600">Limpar</button>
          </div>
          {logs.length === 0 ? (
            <p className="text-center text-slate-300 font-black uppercase text-xs py-12">Nenhuma atividade registrada</p>
          ) : (
            <div className="space-y-2 overflow-y-auto max-h-[600px]">
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-4 py-3 border-b border-slate-50 last:border-0">
                  <div className="text-[9px] font-black text-slate-300 w-32 shrink-0">{new Date(log.ts).toLocaleString('pt-BR')}</div>
                  <span className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase shrink-0 ${
                    log.action.includes('CREATED') ? 'bg-green-100 text-green-600' :
                    log.action.includes('DELETED') ? 'bg-red-100 text-red-500' :
                    log.action.includes('BILLING') ? 'bg-orange-100 text-orange-600' :
                    'bg-slate-100 text-slate-500'
                  }`}>{log.action.replace(/_/g, ' ')}</span>
                  <p className="text-xs font-bold text-slate-600 flex-1">{log.detail}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════ SQL ══════════════════════ */}
      {tab === 'sql' && (
        <div className="bg-slate-900 p-10 rounded-3xl shadow-2xl space-y-6 animate-scaleUp">
          <div className="flex items-start gap-5">
            <div className="text-4xl">🚀</div>
            <div>
              <h3 className="text-xl font-black text-white uppercase">Configuração do Supabase</h3>
              <p className="text-slate-400 text-xs font-bold leading-relaxed mt-1 uppercase tracking-widest">Execute no SQL Editor do Supabase para criar/reparar as tabelas.</p>
            </div>
          </div>
          <div className="relative">
            <textarea readOnly value={sqlScript} className="w-full h-80 bg-black/50 border-2 border-slate-800 rounded-2xl p-6 font-mono text-[11px] text-orange-400 outline-none resize-none" />
            <button onClick={() => { navigator.clipboard.writeText(sqlScript); }} className="absolute top-4 right-4 bg-orange-500 text-white px-5 py-2 rounded-xl text-[10px] font-black uppercase hover:bg-white hover:text-orange-500 transition-all">
              Copiar
            </button>
          </div>
        </div>
      )}

      {/* ══════════════════════ IA / TOKENS ══════════════════════ */}
      {tab === 'ia' && (
        <div className="space-y-6">
          {/* Period selector + refresh */}
          <div className="flex items-center gap-4 flex-wrap">
            {(['today', 'week', 'month'] as const).map(p => (
              <button key={p} onClick={() => setUsagePeriod(p)}
                className={`px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${usagePeriod === p ? 'bg-black text-white border-black' : 'border-slate-200 text-slate-400 hover:border-black hover:text-black'}`}>
                {p === 'today' ? 'Hoje' : p === 'week' ? 'Última Semana' : 'Último Mês'}
              </button>
            ))}
            <button onClick={loadUsage} disabled={usageLoading}
              className="px-5 py-2.5 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 border-orange-300 text-orange-500 hover:bg-orange-50 transition-all disabled:opacity-40">
              {usageLoading ? 'Atualizando...' : '↺ Atualizar'}
            </button>
          </div>

          {/* Summary cards */}
          {usageStats && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <StatCard label="Total de Tokens" value={usageStats.total_tokens.toLocaleString()} icon="🧠" />
              <StatCard label="Custo Estimado" value={`$${usageStats.total_cost_usd.toFixed(4)}`} icon="💵" color="text-green-600" />
              <StatCard label="Chamadas IA" value={usageStats.total_calls.toLocaleString()} icon="📡" />
            </div>
          )}

          {/* Per-tenant table */}
          <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[560px]">
              <table className="w-full">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {['Tenant', 'Nicho', 'Tokens In', 'Tokens Out', 'Total', 'Custo (USD)', 'Chamadas', 'Última atividade'].map(h => (
                      <th key={h} className="px-5 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {usageLoading ? (
                    <tr><td colSpan={8} className="text-center py-12 text-slate-300 font-black uppercase text-xs">Carregando...</td></tr>
                  ) : !usageStats || usageStats.by_tenant.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-slate-300 font-black uppercase text-xs">
                      Nenhum dado de uso encontrado.<br/>
                      <span className="text-[9px] font-bold normal-case text-slate-300">Execute o script SQL para criar a tabela ai_usage_logs.</span>
                    </td></tr>
                  ) : usageStats.by_tenant.map(row => (
                    <tr key={row.tenant_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 font-black text-sm text-black">{row.tenant_name}</td>
                      <td className="px-5 py-4">
                        <span className="text-[9px] font-black px-2 py-1 bg-slate-100 text-slate-600 rounded-lg uppercase">{row.nicho}</span>
                      </td>
                      <td className="px-5 py-4 text-[11px] font-bold text-slate-600 text-right">{row.input_tokens.toLocaleString()}</td>
                      <td className="px-5 py-4 text-[11px] font-bold text-slate-600 text-right">{row.output_tokens.toLocaleString()}</td>
                      <td className="px-5 py-4 font-black text-sm text-black text-right">{row.total_tokens.toLocaleString()}</td>
                      <td className="px-5 py-4 font-black text-sm text-green-600 text-right">${row.estimated_cost_usd.toFixed(4)}</td>
                      <td className="px-5 py-4 text-[11px] font-bold text-slate-600 text-right">{row.calls.toLocaleString()}</td>
                      <td className="px-5 py-4 text-[10px] font-bold text-slate-400 whitespace-nowrap">
                        {row.last_activity ? new Date(row.last_activity).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
            <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">ℹ️ Preços de referência</p>
            <p className="text-xs text-blue-600 mt-1">GPT-4o Mini: $0,150/1M tokens entrada · $0,600/1M tokens saída &nbsp;|&nbsp; Gemini 2.0 Flash: gratuito (tier free)</p>
          </div>
        </div>
      )}

      {/* ══════════════════════ CONVERSAS ══════════════════════ */}
      {tab === 'conversas' && (
        <AdminConversasPanel
          instanceName={adminInstanceName}
          setInstanceName={setAdminInstanceName}
          connected={adminConnected}
          setConnected={setAdminConnected}
        />
      )}

      {/* ══════════════════════ PROSPECÇÃO ══════════════════════ */}
      {tab === 'prospeccao' && (
        <AdminProspeccaoPanel
          campaigns={prospectCampaigns}
          onCampaignsChange={handleCampaignsChange}
          onGoToDisparo={handleGoToDisparo}
        />
      )}

      {/* ══════════════════════ DISPARADOR ADMIN ══════════════════════ */}
      {tab === 'disparo' && (
        <AdminDisparoPanel
          adminInstanceName={adminInstanceName}
          adminConnected={adminConnected}
          campaigns={prospectCampaigns}
          initialCampaignId={disparoCampaignId}
          onGoToConexao={() => setTab('conversas' as Tab)}
        />
      )}

      {/* ══════════════════════ SUPORTE ══════════════════════ */}
      {tab === 'suporte' && (() => {
        const SUPPORT_FEATURE_LABELS: Record<string, string> = {
          financeiro: 'Financeiro e Estoque',
          relatorios: 'Relatórios básicos',
          relatoriosAvancados: 'Relatórios avançados',
          reativacao: 'Reativação automática',
          disparo: 'Disparador segmentado',
          assistenteAdmin: 'Assistente Admin via IA',
        };
        return (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Solicitações pendentes de upgrade de plano
              </p>
              <button
                onClick={loadSupportRequests}
                className="text-[10px] font-black text-orange-500 uppercase tracking-widest hover:underline"
              >
                ↻ Atualizar
              </button>
            </div>

            {supportLoading ? (
              <div className="flex items-center gap-4 p-12">
                <div className="w-6 h-6 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Carregando solicitações...</p>
              </div>
            ) : supportRequests.length === 0 ? (
              <div className="bg-white rounded-[32px] border-2 border-slate-100 p-16 text-center space-y-3">
                <p className="text-5xl">📭</p>
                <p className="font-black text-slate-400 text-sm uppercase tracking-wider">Nenhuma solicitação pendente</p>
                <p className="text-xs text-slate-300 font-bold">As solicitações de upgrade dos clientes aparecerão aqui.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {supportRequests.map(({ tenantId, tenantName, plan, request }) => {
                  const planCfg = getPlanConfig(plan);
                  return (
                    <div key={tenantId} className="bg-white rounded-[24px] border-2 border-slate-100 p-6 space-y-3 hover:border-orange-200 transition-all">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-black text-black text-sm">{tenantName}</p>
                            <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase ${planCfg.bgClass} ${planCfg.textClass}`}>
                              {planCfg.emoji} {planCfg.name}
                            </span>
                          </div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            Recurso solicitado:{' '}
                            <strong className="text-slate-600">
                              {SUPPORT_FEATURE_LABELS[request.feature] || request.feature}
                            </strong>
                          </p>
                          {request.message && request.message !== 'Solicitar upgrade de plano' && (
                            <p className="text-sm font-bold text-slate-600 bg-slate-50 rounded-xl p-3 border border-slate-100 italic">
                              "{request.message}"
                            </p>
                          )}
                          <p className="text-[9px] font-bold text-slate-300">
                            {new Date(request.ts).toLocaleString('pt-BR', {
                              day: '2-digit', month: '2-digit', year: 'numeric',
                              hour: '2-digit', minute: '2-digit'
                            })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDismissSupport(tenantId)}
                          className="shrink-0 px-4 py-2 bg-green-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-green-600 transition-all"
                        >
                          ✓ Resolver
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* ══════════════════════ MODALS ══════════════════════ */}

      {/* New tenant modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex items-center justify-center min-h-full p-4">
            <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-black">
              {!successData ? (
                <>
                  <h2 className="text-2xl font-black text-black uppercase tracking-tight">Nova Unidade</h2>
                  <div className="space-y-4">
                    {([
                      ['Nome da unidade *', newName, setNewName, 'text', 'Ex: Barber Centro'],
                      ['E-mail (auto se vazio)', newEmail, setNewEmail, 'email', 'email@exemplo.com'],
                      ['Senha (auto se vazio)', newPass, setNewPass, 'text', 'Senha123'],
                      ['Telefone do proprietário', newPhone, setNewPhone, 'text', '5511999999999'],
                    ] as [string, string, (v: string) => void, string, string][]).map(([label, val, fn, type, ph]) => (
                      <div key={label} className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">{label}</label>
                        <input type={type} value={val} onChange={e => fn(e.target.value)} placeholder={ph}
                          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Nicho / Segmento</label>
                      <select value={newNicho} onChange={e => setNewNicho(e.target.value)}
                        className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500">
                        {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    {/* Plan selector */}
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Plano de Assinatura</label>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.values(PLAN_CONFIGS).map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setNewSubscriptionPlan(p.id)}
                            className={`p-3 rounded-2xl border-2 text-center transition-all ${newSubscriptionPlan === p.id ? `${p.bgClass} ${p.borderClass}` : 'bg-white border-slate-100 hover:border-slate-300'}`}
                          >
                            <p className="text-lg">{p.emoji}</p>
                            <p className={`text-[10px] font-black uppercase ${newSubscriptionPlan === p.id ? p.textClass : 'text-slate-500'}`}>{p.name}</p>
                            <p className={`text-[9px] font-bold ${newSubscriptionPlan === p.id ? p.textClass : 'text-slate-400'}`}>R${p.price.toFixed(2).replace('.', ',')}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Mensalidade (R$)</label>
                        <input type="number" value={newFee} onChange={e => setNewFee(e.target.value)} placeholder="0.00"
                          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Dia de vencimento</label>
                        <input type="number" min={1} max={31} value={newDueDay} onChange={e => setNewDueDay(e.target.value)} placeholder="Ex: 10"
                          className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <button onClick={() => setShowNew(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={creating}>Cancelar</button>
                    <button onClick={handleCreate} disabled={creating || !newName.trim()} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-50">
                      {creating ? 'Criando...' : 'Ativar Acesso'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center space-y-8">
                  <div className="w-20 h-20 bg-green-100 text-green-500 rounded-full flex items-center justify-center text-4xl mx-auto">✓</div>
                  <h2 className="text-2xl font-black text-black uppercase">Licença Ativada!</h2>
                  <div className="bg-slate-50 p-6 rounded-2xl text-left border border-slate-100 space-y-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase">E-mail</p>
                    <p className="font-black text-black break-all">{successData.email}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase mt-3">Senha</p>
                    <p className="text-xl font-black text-orange-500 font-mono">{successData.pass}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase mt-3">Link de agendamento</p>
                    <p className="text-xs font-bold text-blue-500 break-all">{window.location.origin}{window.location.pathname}#/agendar/{successData.slug}</p>
                  </div>
                  <button onClick={() => { setShowNew(false); setSuccessData(null); }} className="w-full py-4 bg-black text-white rounded-2xl font-black uppercase text-xs">Fechar</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit tenant modal */}
      {editingTenant && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex items-center justify-center min-h-full p-4">
            <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-6 animate-scaleUp border-4 border-orange-500">
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">Editar — {editingTenant.name}</h2>
              <div className="space-y-4">
                {([
                  ['E-mail', editingTenant.email || '', (v: string) => setEditingTenant({ ...editingTenant, email: v }), 'email'],
                  ['Senha', editingTenant.password || '', (v: string) => setEditingTenant({ ...editingTenant, password: v }), 'text'],
                  ['Telefone do proprietário', editingTenant.phone || '', (v: string) => setEditingTenant({ ...editingTenant, phone: v }), 'text'],
                ] as [string, string, (v: string) => void, string][]).map(([label, val, fn, type]) => (
                  <div key={label} className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">{label}</label>
                    <input type={type} value={val} onChange={e => fn(e.target.value)}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Status</label>
                    <select value={editingTenant.status} onChange={e => setEditingTenant({ ...editingTenant, status: e.target.value as TenantStatus })}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500">
                      {Object.values(TenantStatus).map(s => <option key={s} value={s}>{STATUS_LABELS[s] || s}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Dia de vencimento</label>
                    <input type="number" min={1} max={31} value={editingTenant.due_day || ''} onChange={e => setEditingTenant({ ...editingTenant, due_day: parseInt(e.target.value) || undefined })}
                      className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-center focus:border-orange-500" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Mensalidade (R$)</label>
                  <input type="number" value={editingTenant.monthlyFee} onChange={e => setEditingTenant({ ...editingTenant, monthlyFee: parseFloat(e.target.value) || 0 })}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Nicho / Segmento</label>
                  <select value={(editingTenant as any).nicho || 'Barbearia'} onChange={e => setEditingTenant({ ...editingTenant, nicho: e.target.value } as Tenant)}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500">
                    {NICHOS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {/* Plan selector */}
                <div className="space-y-2">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-4">Plano de Assinatura</label>
                  <div className="grid grid-cols-3 gap-2">
                    {Object.values(PLAN_CONFIGS).map(p => {
                      const currentPlanId = getPlanConfig(editingTenant?.plan).id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setEditingTenant({ ...editingTenant!, plan: p.id })}
                          className={`p-3 rounded-2xl border-2 text-center transition-all ${currentPlanId === p.id ? `${p.bgClass} ${p.borderClass}` : 'bg-white border-slate-100 hover:border-slate-300'}`}
                        >
                          <p className="text-lg">{p.emoji}</p>
                          <p className={`text-[10px] font-black uppercase ${currentPlanId === p.id ? p.textClass : 'text-slate-500'}`}>{p.name}</p>
                          <p className={`text-[9px] font-bold ${currentPlanId === p.id ? p.textClass : 'text-slate-400'}`}>R${p.price.toFixed(2).replace('.', ',')}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex gap-4">
                <button onClick={() => setEditingTenant(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
                <button onClick={handleUpdate} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-50">
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-sm p-10 space-y-6 animate-scaleUp border-4 border-red-500 text-center">
            <div className="text-5xl">⚠️</div>
            <h2 className="text-2xl font-black text-black uppercase">Excluir Cliente?</h2>
            <p className="text-sm text-slate-500 font-bold">
              Esta ação irá excluir <strong>{tenants.find(t => t.id === deleteId)?.name}</strong> e todos os dados relacionados. <span className="text-red-500">Não pode ser desfeito.</span>
            </p>
            <div className="flex gap-4">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs border-2 border-slate-100 rounded-2xl hover:border-black transition-all">Cancelar</button>
              <button onClick={handleDelete} className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-black uppercase text-xs hover:bg-red-600 transition-all">Excluir</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const StatCard = ({ label, value, icon, sub, color, highlight }: {
  label: string; value: string; icon: string; sub?: string; color?: string; highlight?: boolean;
}) => (
  <div className={`bg-white rounded-2xl border-2 p-6 transition-all ${highlight ? 'border-orange-400 shadow-lg shadow-orange-100/50' : 'border-slate-100 hover:border-slate-200'}`}>
    <div className="text-2xl mb-3">{icon}</div>
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className={`text-2xl font-black ${color || 'text-black'}`}>{value}</p>
    {sub && <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest mt-1">{sub}</p>}
  </div>
);

export default SuperAdminView;
