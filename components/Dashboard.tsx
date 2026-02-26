
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { AppointmentStatus, Professional, Service, Customer } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts';

const fmtBRL = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DONUT_COLORS = ['#0f172a', '#475569', '#94a3b8', '#cbd5e1', '#e2e8f0'];

const Dashboard: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [loading, setLoading] = useState(true);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedProfId, setSelectedProfId] = useState<string>('');
  const [period, setPeriod] = useState(30);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [p, a, s, c] = await Promise.all([
          db.getProfessionals(tenantId),
          db.getAppointments(tenantId),
          db.getServices(tenantId),
          db.getCustomers(tenantId),
        ]);
        setProfessionals(p);
        setAppointments(a);
        setServices(s);
        setCustomers(c);
      } catch (err) {
        console.error('Erro ao carregar dashboard:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId]);

  const now = new Date();
  const periodStart = new Date(now);
  periodStart.setDate(periodStart.getDate() - period);
  const prevStart = new Date(periodStart);
  prevStart.setDate(prevStart.getDate() - period);

  const inRange = (a: any, s: Date, e: Date) => {
    const d = new Date(a.startTime);
    return d >= s && d <= e;
  };
  const byProf = (a: any) => !selectedProfId || a.professional_id === selectedProfId;

  const curAppts = appointments.filter(a => inRange(a, periodStart, now) && byProf(a));
  const prevAppts = appointments.filter(a => inRange(a, prevStart, periodStart) && byProf(a));

  const curRevenue = curAppts
    .filter(a => a.status === AppointmentStatus.FINISHED)
    .reduce((s, a) => s + (a.amountPaid || 0), 0);
  const prevRevenue = prevAppts
    .filter(a => a.status === AppointmentStatus.FINISHED)
    .reduce((s, a) => s + (a.amountPaid || 0), 0);

  const revTrend = prevRevenue > 0
    ? ((curRevenue - prevRevenue) / prevRevenue * 100)
    : 0;
  const apptTrend = prevAppts.length > 0
    ? ((curAppts.length - prevAppts.length) / prevAppts.length * 100)
    : 0;

  // Today
  const todayStr = now.toISOString().split('T')[0];
  const todayAppts = appointments
    .filter(a => a.startTime?.startsWith(todayStr))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const pendingCount = todayAppts.filter(a => a.status === AppointmentStatus.PENDING).length;

  // Bar chart — last 7 days
  const DAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const barData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    const str = d.toISOString().split('T')[0];
    const rev = appointments
      .filter(a => a.startTime?.startsWith(str) && a.status === AppointmentStatus.FINISHED && byProf(a))
      .reduce((s, a) => s + (a.amountPaid || 0), 0);
    return { name: DAY_PT[d.getDay()], value: rev };
  });
  const barTotal = barData.reduce((s, d) => s + d.value, 0);

  // Donut — service distribution
  const svcMap: Record<string, number> = {};
  curAppts.forEach(a => {
    const svc = services.find(s => s.id === a.service_id);
    const name = svc?.name || 'Outros';
    svcMap[name] = (svcMap[name] || 0) + 1;
  });
  const totalSvc = Object.values(svcMap).reduce((s, v) => s + v, 0);
  const donutData = Object.entries(svcMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      value: count,
      pct: totalSvc > 0 ? Math.round((count / totalSvc) * 100) : 0,
    }));

  // Weekly trend — last 4 weeks
  const weeklyData = Array.from({ length: 4 }, (_, i) => {
    const wEnd = new Date(now);
    wEnd.setDate(wEnd.getDate() - i * 7);
    const wStart = new Date(wEnd);
    wStart.setDate(wStart.getDate() - 7);
    const wAppts = appointments.filter(a => inRange(a, wStart, wEnd) && byProf(a));
    const wRev = wAppts
      .filter(a => a.status === AppointmentStatus.FINISHED)
      .reduce((s, a) => s + (a.amountPaid || 0), 0);
    return { name: `Sem ${4 - i}`, receita: wRev, agendamentos: wAppts.length };
  }).reverse();

  // Top professionals
  const topProfs = professionals
    .map(p => {
      const pa = curAppts.filter(a => a.professional_id === p.id);
      const rev = pa
        .filter(a => a.status === AppointmentStatus.FINISHED)
        .reduce((s, a) => s + (a.amountPaid || 0), 0);
      return { ...p, count: pa.length, revenue: rev };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3);
  const maxRev = topProfs[0]?.revenue || 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header + filters */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-black">Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5">Visualize e gerencie todos os agendamentos da sua agenda.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedProfId}
            onChange={e => setSelectedProfId(e.target.value)}
            className="border border-slate-200 rounded-xl px-4 py-2 text-xs font-semibold bg-white text-slate-600 outline-none cursor-pointer"
          >
            <option value="">Todos Profissionais</option>
            {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex bg-slate-100 rounded-xl p-1 gap-0.5">
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setPeriod(d)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${period === d ? 'bg-black text-white shadow-sm' : 'text-slate-500 hover:text-black'}`}
              >
                {d} dias
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={<IcoTrend />}
          title="Faturamento"
          value={`R$ ${fmtBRL(curRevenue)}`}
          trend={revTrend}
          sub="vs. período anterior"
        />
        <StatCard
          icon={<IcoCalendar />}
          title="Agendamentos"
          value={String(curAppts.length)}
          trend={apptTrend}
          sub="este período"
        />
        <StatCard
          icon={<IcoUsers />}
          title="Profissionais"
          value={String(professionals.length)}
          trendLabel={`+${professionals.length}`}
          trendPos
          sub="ativos"
        />
        <StatCard
          icon={<IcoScissors />}
          title="Serviços"
          value={String(services.length)}
          trendLabel={String(services.length)}
          sub="catálogo"
        />
      </div>

      {/* Bar + Donut */}
      <div className="grid grid-cols-5 gap-4">
        <div className="col-span-3 bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="font-black text-sm text-black">Fluxo de Receitas</h3>
              <p className="text-xs text-slate-400">Faturamento dos últimos 7 dias</p>
            </div>
            <span className="text-xs font-bold text-slate-500">↗ R$ {fmtBRL(barTotal)}</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} barSize={30} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} />
              <YAxis hide />
              <Tooltip
                formatter={(v: any) => [`R$ ${fmtBRL(v)}`, 'Receita']}
                contentStyle={{ borderRadius: 10, border: '1px solid #f1f5f9', fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
                cursor={{ fill: '#f8fafc' }}
              />
              <Bar dataKey="value" fill="#0f172a" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="col-span-2 bg-white rounded-2xl border border-slate-100 p-6">
          <div className="mb-4">
            <h3 className="font-black text-sm text-black">Serviços Populares</h3>
            <p className="text-xs text-slate-400">Distribuição por categoria</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <PieChart width={110} height={110}>
                <Pie
                  data={donutData.length ? donutData : [{ name: '', value: 1, pct: 0 }]}
                  cx={50} cy={50}
                  innerRadius={34} outerRadius={52}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {(donutData.length ? donutData : [{ name: '', value: 1, pct: 0 }]).map((_, i) => (
                    <Cell key={i} fill={donutData.length ? DONUT_COLORS[i % DONUT_COLORS.length] : '#f1f5f9'} />
                  ))}
                </Pie>
              </PieChart>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-base font-black text-black leading-none">{donutData[0]?.pct || 0}%</span>
                <span className="text-[7px] font-black text-slate-400 uppercase tracking-widest mt-0.5">crescimento</span>
              </div>
            </div>
            <div className="flex-1 space-y-2.5 min-w-0">
              {(donutData.length ? donutData : []).slice(0, 3).map((d, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: DONUT_COLORS[i] }} />
                    <span className="text-[11px] text-slate-600 font-medium truncate">{d.name}</span>
                  </div>
                  <span className="text-[11px] font-bold text-slate-700 shrink-0">{d.pct}%</span>
                </div>
              ))}
              {donutData.length === 0 && (
                <p className="text-[11px] text-slate-400">Sem dados</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Weekly trend */}
      <div className="bg-white rounded-2xl border border-slate-100 p-6">
        <div className="mb-4">
          <h3 className="font-black text-sm text-black">Tendência Semanal</h3>
          <p className="text-xs text-slate-400">Comparativo receita x agendamentos</p>
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={weeklyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 600 }} />
            <YAxis yAxisId="l" hide />
            <YAxis yAxisId="r" orientation="right" hide />
            <Tooltip
              contentStyle={{ borderRadius: 10, border: '1px solid #f1f5f9', fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
            />
            <Legend
              iconType="circle"
              iconSize={7}
              wrapperStyle={{ fontSize: 11, paddingTop: 10 }}
            />
            <Line
              yAxisId="l"
              type="monotone"
              dataKey="receita"
              name="Receita"
              stroke="#0f172a"
              strokeWidth={2.5}
              dot={{ r: 4, fill: '#0f172a', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
            <Line
              yAxisId="r"
              type="monotone"
              dataKey="agendamentos"
              name="Agendamentos"
              stroke="#94a3b8"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 3, fill: '#94a3b8', strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Top profs + Today */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top professionals */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="font-black text-sm text-black">Top Profissionais</h3>
              <p className="text-xs text-slate-400">Ranking por faturamento</p>
            </div>
            <span className="text-slate-300 text-lg leading-none">•••</span>
          </div>
          <div className="space-y-5">
            {topProfs.map(p => (
              <div key={p.id} className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center text-xs font-black shrink-0">
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-sm font-bold text-black truncate">{p.name}</p>
                    <p className="text-sm font-black text-black ml-2 shrink-0">R$ {p.revenue.toLocaleString()}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-900 rounded-full transition-all"
                        style={{ width: `${Math.max(4, (p.revenue / maxRev) * 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium shrink-0">{p.count} atend.</span>
                  </div>
                </div>
              </div>
            ))}
            {topProfs.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">Sem dados no período</p>
            )}
          </div>
        </div>

        {/* Today's appointments */}
        <div className="bg-white rounded-2xl border border-slate-100 p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h3 className="font-black text-sm text-black">Agendamentos de Hoje</h3>
              <p className="text-xs text-slate-400">Próximos atendimentos</p>
            </div>
            {pendingCount > 0 && (
              <span className="text-[10px] font-bold bg-orange-50 text-orange-500 border border-orange-100 px-3 py-1 rounded-full shrink-0">
                {pendingCount} pendentes
              </span>
            )}
          </div>
          <div className="space-y-1 overflow-y-auto max-h-[260px] custom-scrollbar">
            {todayAppts.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">Nenhum agendamento hoje</p>
            ) : todayAppts.map(a => {
              const cust = customers.find(c => c.id === a.customer_id);
              const svc = services.find(s => s.id === a.service_id);
              const prof = professionals.find(p => p.id === a.professional_id);
              const done = a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.FINISHED;
              return (
                <div key={a.id} className="flex items-center gap-3 py-2.5 border-b border-slate-50 last:border-0">
                  <span className="text-sm font-black text-black w-12 shrink-0 tabular-nums">
                    {new Date(a.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-black truncate">{cust?.name || 'Cliente'}</p>
                    <p className="text-[10px] text-slate-400 uppercase font-medium truncate">
                      {svc?.name || 'Serviço'}{prof ? ` · PROF. ${prof.name.toUpperCase()}` : ''}
                    </p>
                  </div>
                  <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full shrink-0 ${done ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-500'}`}>
                    {done ? 'CONFIRMADO' : 'PENDENTE'}
                  </span>
                  <span className="text-xs font-bold text-slate-600 shrink-0 tabular-nums">
                    R$ {(a.amountPaid || 0).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

const StatCard = ({ icon, title, value, trend, trendLabel, trendPos, sub }: {
  icon: React.ReactNode;
  title: string;
  value: string;
  trend?: number;
  trendLabel?: string;
  trendPos?: boolean;
  sub?: string;
}) => {
  const showTrend = trend !== undefined;
  const isPos = showTrend ? trend >= 0 : !!trendPos;
  const label = trendLabel ?? `${isPos ? '+' : ''}${trend?.toFixed(1)}%`;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 hover:border-slate-200 transition-all">
      <div className="flex items-start justify-between mb-4">
        <div className="w-9 h-9 bg-slate-50 rounded-xl flex items-center justify-center text-slate-500">
          {icon}
        </div>
        <span className={`text-[10px] font-bold ${isPos ? 'text-green-500' : 'text-red-400'}`}>
          {isPos ? '↑' : '↓'} {label}
        </span>
      </div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">{title}</p>
      <p className="text-2xl font-black text-black leading-none">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-1">{sub}</p>}
    </div>
  );
};

// ── Icons ─────────────────────────────────────────────────────────────────────

const IcoTrend = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </svg>
);
const IcoCalendar = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);
const IcoUsers = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const IcoScissors = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </svg>
);

export default Dashboard;
