
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Professional, AppointmentStatus, Appointment, Expense } from '../types';

const ProfessionalsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [pros, setPros] = useState<Professional[]>([]);
  const [allAppointments, setAllAppointments] = useState<Appointment[]>([]);
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  
  const [showModal, setShowModal] = useState(false);
  const [editingPro, setEditingPro] = useState<Professional | null>(null);
  const [selectedProForReport, setSelectedProForReport] = useState<Professional | null>(null);
  
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [presetPeriod, setPresetPeriod] = useState<string>('custom');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [role, setRole] = useState<'admin' | 'colab'>('colab');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, a, e] = await Promise.all([
        db.getProfessionals(tenantId),
        db.getAppointments(tenantId),
        db.getExpenses(tenantId)
      ]);
      setPros(p);
      setAllAppointments(a);
      setAllExpenses(e);
    } catch (err) {
      console.error("Erro ao carregar dados:", err);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!name || !phone) { alert("Nome e Telefone são obrigatórios!"); return; }
    setSaving(true);
    try {
      const newPro = await db.addProfessional({ tenant_id: tenantId, name, phone, specialty, active: true });
      // Save role to settings JSONB after creation
      await db.updateProfessional(tenantId, newPro.id, { role });
      await load();
      setShowModal(false);
      resetForm();
    } catch (err: any) {
      alert("Erro ao salvar no banco de dados: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editingPro || !name || !phone) return;
    setSaving(true);
    try {
      await db.updateProfessional(tenantId, editingPro.id, { name, phone, specialty, role });
      await load();
      setEditingPro(null);
      resetForm();
    } catch (err: any) {
      alert("Erro ao atualizar no banco de dados: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setName(''); setPhone(''); setSpecialty(''); setRole('colab');
  };

  const applyPreset = (period: string) => {
    setPresetPeriod(period);
    const now = new Date();
    let start = new Date();
    let end = new Date();
    switch(period) {
      case 'week': start.setDate(now.getDate() - now.getDay()); break;
      case '7d': start.setDate(now.getDate() - 7); break;
      case '14d': start.setDate(now.getDate() - 14); break;
      case 'month': start = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'last_month': start = new Date(now.getFullYear(), now.getMonth() - 1, 1); end = new Date(now.getFullYear(), now.getMonth(), 0); break;
    }
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const reportData = useMemo(() => {
    if (!selectedProForReport) return null;
    const filteredApps = allAppointments.filter(a => {
      if (a.professional_id !== selectedProForReport.id) return false;
      const d = new Date(a.startTime).toISOString().split('T')[0];
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
    const filteredExps = allExpenses.filter(e => {
      if (e.professional_id !== selectedProForReport.id) return false;
      const d = new Date(e.date).toISOString().split('T')[0];
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
      return true;
    });
    const finished = filteredApps.filter(a => a.status === AppointmentStatus.FINISHED);
    const revenue = finished.reduce((acc, curr) => acc + (curr.amountPaid || 0), 0);
    const totalExpenses = filteredExps.reduce((acc, curr) => acc + curr.amount, 0);
    return {
      total: filteredApps.length, revenue, expenses: totalExpenses, netResult: revenue - totalExpenses,
      appointments: filteredApps.sort((a,b) => b.startTime.localeCompare(a.startTime)),
      expensesList: filteredExps.sort((a,b) => b.date.localeCompare(a.date))
    };
  }, [selectedProForReport, startDate, endDate, allAppointments, allExpenses]);

  return (
    <div className="space-y-10 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Equipe de Barbeiros</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão de performance individual</p>
        </div>
        <button onClick={() => setShowModal(true)} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all">
          + Novo Barbeiro
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {pros.map((p) => (
          <div key={p.id} className="bg-white p-10 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 relative group hover:border-orange-500 transition-all cursor-pointer">
            <div className="flex items-center space-x-6 mb-8" onClick={() => setSelectedProForReport(p)}>
              <div className="w-20 h-20 bg-black text-white rounded-[28px] flex items-center justify-center text-3xl font-black group-hover:bg-orange-500 transition-all shadow-lg">{p.name[0]}</div>
              <div>
                <h3 className="text-xl font-black text-black leading-tight">{p.name}</h3>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">{p.specialty || 'Master Barbeiro'}</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-6 border-t-2 border-slate-50">
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">WhatsApp</span>
              <span className="text-sm font-black text-black">{p.phone}</span>
            </div>
            <div className="mt-3 flex justify-end">
              <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${p.role === 'admin' ? 'bg-black text-white' : 'bg-slate-100 text-slate-500'}`}>
                {p.role === 'admin' ? '👑 Admin' : '💈 Colab'}
              </span>
            </div>
            <div className="mt-6 flex justify-between items-center">
              <button onClick={(e) => { e.stopPropagation(); setEditingPro(p); setName(p.name); setPhone(p.phone); setSpecialty(p.specialty); setRole(p.role || 'colab'); }} className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:text-black transition-all">
                📝 Editar Cadastro
              </button>
              <button onClick={() => setSelectedProForReport(p)} className="text-[10px] font-black text-orange-500 uppercase tracking-[0.2em] group-hover:mr-2 transition-all">
                Ver Desempenho →
              </button>
            </div>
          </div>
        ))}
      </div>

      {selectedProForReport && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="bg-white rounded-[50px] w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-scaleUp border-4 border-black">
            <div className="p-12 border-b-2 border-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 shrink-0">
               <div className="flex items-center space-x-6">
                 <div className="w-20 h-20 bg-orange-500 text-white rounded-3xl flex items-center justify-center text-3xl font-black shadow-xl">{selectedProForReport.name[0]}</div>
                 <div>
                   <h2 className="text-3xl font-black text-black uppercase tracking-tight">{selectedProForReport.name}</h2>
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Relatório de Atividade</p>
                 </div>
               </div>
               <div className="flex flex-wrap items-center gap-3">
                  <div className="flex bg-slate-100 p-1 rounded-2xl">
                    <PresetBtn active={presetPeriod === 'week'} onClick={() => applyPreset('week')} label="Esta Semana" />
                    <PresetBtn active={presetPeriod === '7d'} onClick={() => applyPreset('7d')} label="7 Dias" />
                    <PresetBtn active={presetPeriod === 'month'} onClick={() => applyPreset('month')} label="Este Mês" />
                  </div>
                  <button onClick={() => setSelectedProForReport(null)} className="ml-4 w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center text-black hover:bg-red-500 hover:text-white transition-all font-black text-2xl">×</button>
               </div>
            </div>
            <div className="flex-1 overflow-y-auto p-12 space-y-10 bg-slate-50/30 custom-scrollbar">
               <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                  <StatCardSmall title="Atendimentos" value={reportData?.total} />
                  <StatCardSmall title="Faturamento Bruto" value={`R$ ${reportData?.revenue.toFixed(2)}`} color="text-orange-500" />
                  <StatCardSmall title="Despesas" value={`R$ ${reportData?.expenses.toFixed(2)}`} />
                  <StatCardSmall title="Lucro Líquido" value={`R$ ${reportData?.netResult.toFixed(2)}`} bg="bg-black text-white" />
               </div>
            </div>
          </div>
        </div>
      )}

      {(showModal || editingPro) && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-black">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight italic">
              {editingPro ? 'Editar Barbeiro' : 'Novo Barbeiro'}
            </h2>
            <div className="space-y-6">
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Nome Completo" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">WhatsApp Pessoal (para acesso via IA)</label>
                <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="5544999999999" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
              </div>
              <input value={specialty} onChange={e=>setSpecialty(e.target.value)} placeholder="Especialidade" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nível de Acesso via WhatsApp</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setRole('colab')}
                    className={`py-4 rounded-2xl font-black text-xs uppercase tracking-widest border-2 transition-all ${role === 'colab' ? 'bg-slate-800 text-white border-slate-800' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-400'}`}
                  >
                    💈 Colaborador
                  </button>
                  <button
                    type="button"
                    onClick={() => setRole('admin')}
                    className={`py-4 rounded-2xl font-black text-xs uppercase tracking-widest border-2 transition-all ${role === 'admin' ? 'bg-black text-white border-black' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-black'}`}
                  >
                    👑 Admin
                  </button>
                </div>
                <p className="text-[9px] font-bold text-slate-300 ml-4 mt-1">
                  {role === 'admin' ? 'Acesso total: agendamentos, stats e financeiro' : 'Acesso restrito: apenas seus próprios agendamentos'}
                </p>
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={()=>{setShowModal(false); setEditingPro(null); resetForm();}} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
              <button onClick={editingPro ? handleEdit : handleAdd} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs shadow-xl hover:bg-orange-500 transition-all disabled:opacity-50" disabled={saving}>
                {saving ? 'Gravando...' : editingPro ? 'Salvar Alterações' : 'Confirmar Cadastro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCardSmall = ({ title, value, color, bg }: any) => (
  <div className={`p-8 rounded-[30px] border-2 border-slate-100 shadow-sm ${bg || 'bg-white'}`}>
    <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${bg ? 'text-white/50' : 'text-slate-400'}`}>{title}</p>
    <p className={`text-2xl font-black tracking-tight ${color || ''}`}>{value}</p>
  </div>
);

const PresetBtn = ({ active, onClick, label }: any) => (
  <button onClick={onClick} className={`px-3 py-2 text-[8px] font-black uppercase tracking-tighter rounded-xl transition-all ${active ? 'bg-black text-white shadow-md' : 'text-slate-400 hover:text-black'}`}>{label}</button>
);

export default ProfessionalsView;
