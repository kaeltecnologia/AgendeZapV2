
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Appointment, AppointmentStatus, BookingSource, PaymentMethod, Professional, Service, Customer } from '../types';
import { sendProfessionalNotification } from '../services/notificationService';

const AppointmentsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState<{id: string, basePrice: number, extraValue?: number, extraNote?: string, method?: PaymentMethod, status?: AppointmentStatus} | null>(null);
  
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [presetPeriod, setPresetPeriod] = useState<string>('today');
  const [filteredAppointments, setFilteredAppointments] = useState<Appointment[]>([]);

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [profId, setProfId] = useState('');
  const [svcId, setSvcId] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [extraValue, setExtraValue] = useState<number>(0);
  const [extraNote, setExtraNote] = useState('');
  const [editStatus, setEditStatus] = useState<AppointmentStatus>(AppointmentStatus.FINISHED);

  const refreshData = useCallback(async () => {
    // Fix: await all database calls
    const [apps, svcs, pros, custs] = await Promise.all([
      db.getAppointments(tenantId),
      db.getServices(tenantId),
      db.getProfessionals(tenantId),
      db.getCustomers(tenantId)
    ]);
    
    setServices(svcs);
    setProfessionals(pros);
    setCustomers(custs);

    const data = apps.filter(a => {
      const appDate = new Date(a.startTime).toISOString().split('T')[0];
      if (presetPeriod === 'all') return true;
      return appDate >= startDate && appDate <= endDate;
    }).sort((a, b) => a.startTime.localeCompare(b.startTime));
    
    setFilteredAppointments(data);
  }, [tenantId, startDate, endDate, presetPeriod]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const applyPreset = (period: string) => {
    setPresetPeriod(period);
    const now = new Date();
    let start = new Date();
    let end = new Date();

    switch(period) {
      case 'today':
        start = new Date();
        end = new Date();
        break;
      case '7d':
        start = new Date();
        end = new Date();
        end.setDate(now.getDate() + 7);
        break;
      case '14d':
        start = new Date();
        end = new Date();
        end.setDate(now.getDate() + 14);
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'all':
        break;
      default:
        return;
    }

    if (period !== 'all') {
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(end.toISOString().split('T')[0]);
    }
  };

  const openBookingModal = () => {
    setErrorMsg('');
    setCustomerId('');
    setProfId('');
    setSvcId('');
    setManualDate(new Date().toISOString().split('T')[0]);
    setManualTime('');
    setShowBookingModal(true);
  };

  const handleCreateBooking = async () => {
    if (!customerId || !profId || !svcId || !manualDate || !manualTime) {
      setErrorMsg('Por favor, preencha todos os campos.'); 
      return;
    }
    
    const svc = services.find(s => s.id === svcId);
    if (!svc) return;

    const requestedDate = new Date(`${manualDate}T${manualTime}:00`);
    if (isNaN(requestedDate.getTime())) {
      setErrorMsg('Data ou hora inválida.');
      return;
    }

    const check = await db.isSlotAvailable(tenantId, profId, requestedDate, svc.durationMinutes);
    
    if (check.available) {
      const newApp = await db.addAppointment({ 
        tenant_id: tenantId, 
        customer_id: customerId, 
        professional_id: profId, 
        service_id: svcId, 
        startTime: requestedDate.toISOString(), 
        durationMinutes: svc.durationMinutes, 
        status: AppointmentStatus.CONFIRMED, 
        source: BookingSource.MANUAL 
      });
      
      sendProfessionalNotification(newApp);
      setShowBookingModal(false); 
      setErrorMsg('');
      refreshData();
    } else { 
      setErrorMsg(check.reason || 'Este horário não está disponível.'); 
    }
  };

  const handleFinish = async () => {
    if (!showFinishModal) return;
    await db.updateAppointmentStatus(showFinishModal.id, editStatus, {
      paymentMethod, amountPaid: showFinishModal.basePrice + extraValue, extraNote, extraValue
    });
    setShowFinishModal(null);
    refreshData();
  };

  return (
    <div className="space-y-8 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-black">AGENDA OPERACIONAL</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Gestão de horários e períodos</p>
        </div>
        <button onClick={openBookingModal} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 active:scale-95 transition-all">
          + Novo Horário
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-10">
        <div className="w-full lg:w-80 shrink-0 space-y-6">
          <div className="bg-white p-8 rounded-[35px] border-2 border-slate-100 shadow-lg">
            <h3 className="font-black text-black mb-6 text-xs uppercase tracking-widest">Filtros de Período</h3>
            
            <div className="grid grid-cols-2 gap-2 mb-6">
              <PresetBtn active={presetPeriod === 'today'} onClick={() => applyPreset('today')} label="Hoje" />
              <PresetBtn active={presetPeriod === '7d'} onClick={() => applyPreset('7d')} label="7 Dias" />
              <PresetBtn active={presetPeriod === '14d'} onClick={() => applyPreset('14d')} label="14 Dias" />
              <PresetBtn active={presetPeriod === 'month'} onClick={() => applyPreset('month')} label="Este Mês" />
              <PresetBtn active={presetPeriod === 'all'} onClick={() => applyPreset('all')} label="Tudo" />
            </div>

            <div className="space-y-4 pt-4 border-t border-slate-50">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Início</label>
                <input 
                  type="date" 
                  value={startDate} 
                  disabled={presetPeriod === 'all'}
                  onChange={(e) => {setStartDate(e.target.value); setPresetPeriod('custom');}} 
                  className={`w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none font-black text-xs focus:border-orange-500 transition-colors ${presetPeriod === 'all' ? 'opacity-30 cursor-not-allowed' : ''}`} 
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Fim</label>
                <input 
                  type="date" 
                  value={endDate} 
                  disabled={presetPeriod === 'all'}
                  onChange={(e) => {setEndDate(e.target.value); setPresetPeriod('custom');}} 
                  className={`w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none font-black text-xs focus:border-orange-500 transition-colors ${presetPeriod === 'all' ? 'opacity-30 cursor-not-allowed' : ''}`} 
                />
              </div>
            </div>
            
            <div className="mt-10 pt-6 border-t border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Período</span>
                 <span className="text-xl font-black text-black">{filteredAppointments.length}</span>
              </div>
              <div className="flex justify-between items-center">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concluídos</span>
                 <span className="text-xl font-black text-orange-500">{filteredAppointments.filter(a => a.status === AppointmentStatus.FINISHED).length}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b-2 border-slate-100">
                  <th className="px-8 py-6">DATA / HORA</th>
                  <th className="px-8 py-6">CLIENTE</th>
                  <th className="px-8 py-6">PROFISSIONAL</th>
                  <th className="px-8 py-6">STATUS</th>
                  <th className="px-8 py-6 text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-50">
                {filteredAppointments.length === 0 ? (
                  <tr><td colSpan={5} className="p-20 text-center text-slate-300 font-black uppercase tracking-widest italic">Nenhum agendamento encontrado para este intervalo.</td></tr>
                ) : (
                  filteredAppointments.map(a => {
                    const c = customers.find(cus => cus.id === a.customer_id);
                    const p = professionals.find(pro => pro.id === a.professional_id);
                    const appDate = new Date(a.startTime);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex flex-col">
                            <span className="text-xs font-black text-slate-400 uppercase">{appDate.toLocaleDateString('pt-BR')}</span>
                            <span className="text-lg font-black text-orange-500">{appDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-black uppercase tracking-tight text-sm">{c?.name}</span>
                        </td>
                        <td className="px-8 py-6 font-bold text-slate-500 uppercase text-xs tracking-wider">{p?.name}</td>
                        <td className="px-8 py-6">
                          <span className={`text-[10px] font-black px-4 py-1.5 rounded-full tracking-widest ${
                            a.status === AppointmentStatus.FINISHED ? 'bg-black text-white' : 
                            a.status === AppointmentStatus.CANCELLED ? 'bg-red-50 text-red-500' : 'bg-orange-100 text-orange-600'
                          }`}>
                            {a.status}
                          </span>
                        </td>
                        <td className="px-8 py-6 text-right space-x-4">
                          <button 
                            onClick={() => {
                              const svc = services.find(s => s.id === a.service_id);
                              setShowFinishModal({ id: a.id, basePrice: svc?.price || 0, ...a });
                              setEditStatus(a.status);
                            }} 
                            className="text-black font-black text-[10px] uppercase hover:text-orange-500 transition-colors"
                          >
                            GERENCIAR
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showBookingModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-black">
            <h2 className="text-3xl font-black text-black tracking-tight uppercase">Novo Horário</h2>
            
            {errorMsg && (
              <div className="bg-red-50 border-2 border-red-200 p-4 rounded-2xl text-red-600 text-xs font-black uppercase tracking-widest animate-pulse">
                ⚠️ {errorMsg}
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Cliente</label>
                <select value={customerId} onChange={e=>setCustomerId(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                  <option value="">Selecionar Cliente</option>
                  {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Profissional</label>
                <select value={profId} onChange={e=>setProfId(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                  <option value="">Selecionar Profissional</option>
                  {professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Serviço</label>
                <select value={svcId} onChange={e=>setSvcId(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                  <option value="">Selecionar Serviço</option>
                  {services.map(s=><option key={s.id} value={s.id}>{s.name} - R${s.price}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Data</label>
                  <input type="date" value={manualDate} onChange={e=>setManualDate(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs uppercase" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Hora</label>
                  <input type="time" value={manualTime} onChange={e=>setManualTime(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button onClick={()=>setShowBookingModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Voltar</button>
              <button onClick={handleCreateBooking} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs shadow-xl shadow-orange-100 hover:bg-black transition-all">Agendar</button>
            </div>
          </div>
        </div>
      )}

      {showFinishModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-orange-500">
            <h2 className="text-2xl font-black text-black uppercase">Gerenciar Agendamento</h2>
            <div className="space-y-5">
               <div className="space-y-1">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Status</label>
                 <select value={editStatus} onChange={e=>setEditStatus(e.target.value as AppointmentStatus)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                   <option value={AppointmentStatus.CONFIRMED}>CONFIRMADO</option>
                   <option value={AppointmentStatus.FINISHED}>FINALIZADO</option>
                   <option value={AppointmentStatus.CANCELLED}>CANCELADO</option>
                 </select>
               </div>
               
               <div className="space-y-1">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Forma de Pagamento</label>
                 <select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value as PaymentMethod)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                   {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
                 </select>
               </div>

               <div className="space-y-1">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Acréscimo (Opcional)</label>
                 <input type="number" value={extraValue} onChange={e=>setExtraValue(Number(e.target.value))} placeholder="Valor Extra" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black" />
               </div>

               <div className="bg-black p-8 rounded-[30px] text-center">
                 <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Total do Atendimento</p>
                 <p className="text-4xl font-black text-white">R$ {(showFinishModal.basePrice + (extraValue || 0)).toFixed(2)}</p>
               </div>
            </div>
            <div className="flex gap-4">
               <button onClick={()=>setShowFinishModal(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Sair</button>
               <button onClick={handleFinish} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs">Gravar Alterações</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PresetBtn = ({ active, onClick, label }: any) => (
  <button 
    onClick={onClick} 
    className={`px-3 py-2 text-[9px] font-black uppercase tracking-tighter rounded-xl transition-all ${active ? 'bg-orange-500 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:text-black'}`}
  >
    {label}
  </button>
);

export default AppointmentsView;
