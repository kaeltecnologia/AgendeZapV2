
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { AppointmentStatus, Professional, Service, Customer } from '../types';
import { 
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell
} from 'recharts';

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
          db.getCustomers(tenantId)
        ]);
        setProfessionals(p);
        setAppointments(a);
        setServices(s);
        setCustomers(c);
      } catch (err) {
        console.error("Erro ao carregar dashboard:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [tenantId]);

  const stats = {
    totalRevenue: appointments
      .filter(a => a.status === AppointmentStatus.FINISHED && (!selectedProfId || a.professional_id === selectedProfId))
      .reduce((acc, curr) => acc + (curr.amountPaid || 0), 0),
    count: appointments.length
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO DASHBOARD...</div>;

  return (
    <div className="space-y-10 animate-fadeIn">
      {/* Top Header Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <select 
          value={selectedProfId}
          onChange={(e) => setSelectedProfId(e.target.value)}
          className="bg-white border-2 border-black px-6 py-2 rounded-xl text-xs font-black uppercase outline-none"
        >
          <option value="">Equipe Completa</option>
          {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <div className="flex bg-slate-100 p-1 rounded-xl">
          {[7, 30, 90].map(d => (
            <button key={d} onClick={() => setPeriod(d)} className={`px-4 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${period === d ? 'bg-black text-white' : 'text-slate-400'}`}>
              {d} dias
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <StatCard title="Faturamento" value={`R$ ${stats.totalRevenue.toLocaleString()}`} icon="💰" trend="+2.4%" />
        <StatCard title="Agendamentos" value={stats.count.toString()} icon="📅" trend="0%" />
        <StatCard title="Equipe" value={professionals.length.toString()} icon="✂️" sub="ativos" />
        <StatCard title="Serviços" value={services.length.toString()} icon="📋" sub="catálogo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Today's Schedule */}
        <div className="bg-white p-10 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50">
          <h3 className="text-xl font-black text-black mb-10 flex items-center justify-between">
            <span>Hoje</span>
            <span className="text-[10px] bg-orange-500 text-white px-3 py-1 rounded-full uppercase tracking-widest">Tempo Real</span>
          </h3>
          <div className="space-y-6">
            {appointments.length === 0 ? (
              <p className="text-center py-10 text-slate-300 font-black uppercase text-xs italic tracking-widest">Sem agendamentos hoje</p>
            ) : appointments.slice(0, 5).map(a => {
              const c = customers.find(cus => cus.id === a.customer_id);
              const s = services.find(svc => svc.id === a.service_id);
              return (
                <div key={a.id} className="flex items-center p-6 bg-slate-50 rounded-[28px] border-2 border-transparent hover:border-orange-500 transition-all cursor-default">
                  <div className="w-20 font-black text-xl text-black">{new Date(a.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</div>
                  <div className="flex-1 px-4">
                    <p className="font-black text-black text-sm">{c?.name || 'Cliente Externo'}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">{s?.name || 'Corte Social'}</p>
                  </div>
                  <div className={`text-[10px] font-black uppercase px-4 py-1.5 rounded-full ${a.status === AppointmentStatus.FINISHED ? 'bg-black text-white' : 'bg-white border-2 border-slate-100'}`}>
                    {a.status}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, trend, sub }: any) => (
  <div className="bg-white p-8 rounded-[35px] border-2 border-slate-100 shadow-lg shadow-slate-100/50 group hover:border-black transition-all">
    <div className="flex justify-between items-start mb-6">
      <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-xl group-hover:bg-orange-500 group-hover:text-white transition-all">{icon}</div>
      {trend && <span className="text-[10px] font-black text-orange-500 italic">{trend}</span>}
    </div>
    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-1">{title}</h4>
    <p className="text-3xl font-black text-black tracking-tighter">{value}</p>
    {sub && <p className="text-[10px] font-bold text-slate-300 uppercase mt-1">{sub}</p>}
  </div>
);

export default Dashboard;
