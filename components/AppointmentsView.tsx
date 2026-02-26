
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Appointment, AppointmentStatus, BookingSource, PaymentMethod, Professional, Service, Customer, BreakPeriod } from '../types';
import { sendProfessionalNotification } from '../services/notificationService';

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const AppointmentsView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState<{
    id: string; basePrice: number; extraValue?: number; extraNote?: string;
    method?: PaymentMethod; status?: AppointmentStatus;
    professional_id?: string; service_id?: string; customer_id?: string;
    startTime?: string; source?: BookingSource; isPlan?: boolean;
  } | null>(null);
  const [showBreakModal, setShowBreakModal] = useState(false);

  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [presetPeriod, setPresetPeriod] = useState<string>('today');
  const [filterProfId, setFilterProfId] = useState<string>('');

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [breaks, setBreaks] = useState<BreakPeriod[]>([]);

  // new booking form
  const [customerId, setCustomerId] = useState('');
  const [profId, setProfId] = useState('');
  const [svcId, setSvcId] = useState('');
  const [manualDate, setManualDate] = useState('');
  const [manualTime, setManualTime] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // finish modal
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(PaymentMethod.PIX);
  const [extraValue, setExtraValue] = useState<number>(0);
  const [extraNote, setExtraNote] = useState('');
  const [editStatus, setEditStatus] = useState<AppointmentStatus>(AppointmentStatus.FINISHED);

  // break modal form
  const [brkLabel, setBrkLabel] = useState('');
  const [brkProfId, setBrkProfId] = useState('');
  const [brkType, setBrkType] = useState<'specific' | 'recurring'>('recurring');
  const [brkDate, setBrkDate] = useState('');
  const [brkDayOfWeek, setBrkDayOfWeek] = useState<number>(1);
  const [brkStart, setBrkStart] = useState('12:00');
  const [brkEnd, setBrkEnd] = useState('13:00');

  const refreshData = useCallback(async () => {
    const [apps, svcs, pros, custs, loadedBreaks] = await Promise.all([
      db.getAppointments(tenantId),
      db.getServices(tenantId),
      db.getProfessionals(tenantId),
      db.getCustomers(tenantId),
      db.getBreaks(tenantId)
    ]);
    setServices(svcs);
    setProfessionals(pros);
    setCustomers(custs);
    setBreaks(loadedBreaks);

    let data = apps.filter(a => {
      const appDate = new Date(a.startTime).toISOString().split('T')[0];
      if (presetPeriod === 'all') return true;
      return appDate >= startDate && appDate <= endDate;
    });

    if (filterProfId) data = data.filter(a => a.professional_id === filterProfId);

    setAppointments(data.sort((a, b) => a.startTime.localeCompare(b.startTime)));
  }, [tenantId, startDate, endDate, presetPeriod, filterProfId]);

  useEffect(() => { refreshData(); }, [refreshData]);

  const applyPreset = (period: string) => {
    setPresetPeriod(period);
    const now = new Date();
    let start = new Date();
    let end = new Date();
    switch (period) {
      case 'today': start = new Date(); end = new Date(); break;
      case '7d': end = new Date(); end.setDate(now.getDate() + 7); break;
      case '14d': end = new Date(); end.setDate(now.getDate() + 14); break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'all': return;
    }
    if (period !== 'all') {
      setStartDate(start.toISOString().split('T')[0]);
      setEndDate(end.toISOString().split('T')[0]);
    }
  };

  const openBookingModal = () => {
    setErrorMsg(''); setCustomerId(''); setProfId(''); setSvcId('');
    setManualDate(new Date().toISOString().split('T')[0]); setManualTime('');
    setShowBookingModal(true);
  };

  const handleCreateBooking = async () => {
    if (!customerId || !profId || !svcId || !manualDate || !manualTime) {
      setErrorMsg('Por favor, preencha todos os campos.'); return;
    }
    const svc = services.find(s => s.id === svcId);
    if (!svc) return;
    const requestedDate = new Date(`${manualDate}T${manualTime}:00`);
    if (isNaN(requestedDate.getTime())) { setErrorMsg('Data ou hora inválida.'); return; }
    const check = await db.isSlotAvailable(tenantId, profId, requestedDate, svc.durationMinutes);
    if (check.available) {
      const newApp = await db.addAppointment({
        tenant_id: tenantId, customer_id: customerId, professional_id: profId,
        service_id: svcId, startTime: requestedDate.toISOString(),
        durationMinutes: svc.durationMinutes, status: AppointmentStatus.CONFIRMED,
        source: BookingSource.MANUAL
      });
      sendProfessionalNotification(newApp);
      setShowBookingModal(false); setErrorMsg(''); refreshData();
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

  const openBreakModal = () => {
    setBrkLabel(''); setBrkProfId(''); setBrkType('recurring');
    setBrkDate(''); setBrkDayOfWeek(1); setBrkStart('12:00'); setBrkEnd('13:00');
    setShowBreakModal(true);
  };

  const handleCreateBreak = async () => {
    if (!brkLabel || !brkStart || !brkEnd) return;
    const newBreak: BreakPeriod = {
      id: generateId(),
      label: brkLabel,
      professionalId: brkProfId || null,
      date: brkType === 'specific' ? (brkDate || null) : null,
      dayOfWeek: brkType === 'recurring' ? brkDayOfWeek : null,
      startTime: brkStart,
      endTime: brkEnd
    };
    const updated = [...breaks, newBreak];
    await db.saveBreaks(tenantId, updated);
    setBreaks(updated);
    setShowBreakModal(false);
  };

  const handleDeleteBreak = async (id: string) => {
    const updated = breaks.filter(b => b.id !== id);
    await db.saveBreaks(tenantId, updated);
    setBreaks(updated);
  };

  const breakLabel = (b: BreakPeriod) => {
    const profName = b.professionalId
      ? professionals.find(p => p.id === b.professionalId)?.name || '?'
      : 'Todos';
    const when = b.date
      ? new Date(b.date + 'T12:00:00').toLocaleDateString('pt-BR')
      : b.dayOfWeek != null
        ? DAY_NAMES[b.dayOfWeek]
        : 'Diário';
    return `${b.startTime}–${b.endTime} · ${when} · ${profName}`;
  };

  const filteredForDisplay = appointments;

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
        {/* ─── Sidebar ─────────────────────────────── */}
        <div className="w-full lg:w-80 shrink-0 space-y-6">

          {/* Barbeiro Filter */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg space-y-4">
            <h3 className="font-black text-black text-xs uppercase tracking-widest">Filtrar por Barbeiro</h3>
            <select
              value={filterProfId}
              onChange={e => setFilterProfId(e.target.value)}
              className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none font-bold text-xs focus:border-orange-500 transition-colors"
            >
              <option value="">Todos os barbeiros</option>
              {professionals.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {filterProfId && (
              <button onClick={() => setFilterProfId('')} className="text-[9px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors">
                ✕ Limpar filtro
              </button>
            )}
          </div>

          {/* Period Filter */}
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
                <input type="date" value={startDate} disabled={presetPeriod === 'all'}
                  onChange={e => { setStartDate(e.target.value); setPresetPeriod('custom'); }}
                  className={`w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none font-black text-xs focus:border-orange-500 transition-colors ${presetPeriod === 'all' ? 'opacity-30 cursor-not-allowed' : ''}`}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Fim</label>
                <input type="date" value={endDate} disabled={presetPeriod === 'all'}
                  onChange={e => { setEndDate(e.target.value); setPresetPeriod('custom'); }}
                  className={`w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-xl outline-none font-black text-xs focus:border-orange-500 transition-colors ${presetPeriod === 'all' ? 'opacity-30 cursor-not-allowed' : ''}`}
                />
              </div>
            </div>
            <div className="mt-10 pt-6 border-t border-slate-100 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Período</span>
                <span className="text-xl font-black text-black">{filteredForDisplay.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Concluídos</span>
                <span className="text-xl font-black text-orange-500">{filteredForDisplay.filter(a => a.status === AppointmentStatus.FINISHED).length}</span>
              </div>
            </div>
          </div>

          {/* Break Periods */}
          <div className="bg-white p-6 rounded-[30px] border-2 border-slate-100 shadow-lg space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-black text-xs uppercase tracking-widest">Intervalos</h3>
              <button
                onClick={openBreakModal}
                className="text-[9px] font-black uppercase px-3 py-1.5 rounded-xl border-2 border-orange-500 text-orange-500 hover:bg-orange-500 hover:text-white transition-all"
              >
                + Gerar
              </button>
            </div>
            {breaks.length === 0 ? (
              <p className="text-[9px] font-black text-slate-300 uppercase tracking-widest text-center py-4">Nenhum intervalo cadastrado</p>
            ) : (
              <div className="space-y-2">
                {breaks
                  .filter(b => !filterProfId || !b.professionalId || b.professionalId === filterProfId)
                  .map(b => (
                    <div key={b.id} className="flex items-start justify-between bg-slate-50 rounded-2xl p-3 gap-2">
                      <div>
                        <p className="text-[10px] font-black text-black uppercase">{b.label}</p>
                        <p className="text-[9px] font-bold text-slate-400 mt-0.5">{breakLabel(b)}</p>
                      </div>
                      <button onClick={() => handleDeleteBreak(b.id)} className="text-slate-300 hover:text-red-500 text-xs font-black transition-colors shrink-0">✕</button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* ─── Appointments Table ────────────────── */}
        <div className="flex-1 bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b-2 border-slate-100">
                  <th className="px-8 py-6">DATA / HORA</th>
                  <th className="px-8 py-6">CLIENTE</th>
                  <th className="px-8 py-6">SERVIÇO</th>
                  <th className="px-8 py-6">PROFISSIONAL</th>
                  <th className="px-8 py-6">STATUS</th>
                  <th className="px-8 py-6 text-right">AÇÕES</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-50">
                {filteredForDisplay.length === 0 ? (
                  <tr><td colSpan={6} className="p-20 text-center text-slate-300 font-black uppercase tracking-widest italic">Nenhum agendamento encontrado para este intervalo.</td></tr>
                ) : (
                  filteredForDisplay.map(a => {
                    const c = customers.find(cu => cu.id === a.customer_id);
                    const p = professionals.find(pr => pr.id === a.professional_id);
                    const svc = services.find(s => s.id === a.service_id);
                    const appDate = new Date(a.startTime);
                    const isAI = a.source === BookingSource.AI;
                    const isPlan = a.isPlan || a.source === BookingSource.PLAN;
                    return (
                      <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-8 py-6">
                          <div className="flex flex-col gap-1">
                            <span className="text-xs font-black text-slate-400 uppercase">{appDate.toLocaleDateString('pt-BR')}</span>
                            <span className="text-lg font-black text-orange-500">{appDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                            <span className={`text-[8px] font-black px-2 py-0.5 rounded-full w-fit uppercase tracking-widest ${isAI ? 'bg-orange-100 text-orange-600' : isPlan ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                              {isAI ? '⚡ Agente IA' : isPlan ? '📦 Plano' : '✏️ Manual'}
                            </span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-black uppercase tracking-tight text-sm">{c?.name || '—'}</span>
                        </td>
                        <td className="px-8 py-6">
                          <span className="font-black text-black text-sm">{svc?.name || '—'}</span>
                          {svc && !isPlan && <p className="text-[10px] text-slate-400 font-bold uppercase">R$ {svc.price.toFixed(2)} · {svc.durationMinutes}min</p>}
                          {svc && isPlan && <p className="text-[10px] text-blue-500 font-bold uppercase">Plano · {svc.durationMinutes}min</p>}
                        </td>
                        <td className="px-8 py-6 font-bold text-slate-500 uppercase text-xs tracking-wider">{p?.name || '—'}</td>
                        <td className="px-8 py-6">
                          <span className={`text-[10px] font-black px-4 py-1.5 rounded-full tracking-widest ${
                            a.status === AppointmentStatus.FINISHED ? 'bg-black text-white' :
                            a.status === AppointmentStatus.CANCELLED ? 'bg-red-50 text-red-500' : 'bg-orange-100 text-orange-600'
                          }`}>{a.status}</span>
                        </td>
                        <td className="px-8 py-6 text-right">
                          <button
                            onClick={() => {
                              setShowFinishModal({ id: a.id, basePrice: svc?.price || 0, ...a });
                              setEditStatus(a.status);
                              setPaymentMethod(a.paymentMethod || PaymentMethod.PIX);
                              setExtraValue(a.extraValue || 0);
                              setExtraNote(a.extraNote || '');
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

      {/* ─── New Booking Modal ─────────────────────── */}
      {showBookingModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-black">
            <h2 className="text-3xl font-black text-black tracking-tight uppercase">Novo Horário</h2>
            {errorMsg && (
              <div className="bg-red-50 border-2 border-red-200 p-4 rounded-2xl text-red-600 text-xs font-black uppercase tracking-widest animate-pulse">⚠️ {errorMsg}</div>
            )}
            <div className="space-y-4">
              <ModalSelect label="Cliente" value={customerId} onChange={setCustomerId} placeholder="Selecionar Cliente">
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </ModalSelect>
              <ModalSelect label="Profissional" value={profId} onChange={setProfId} placeholder="Selecionar Profissional">
                {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </ModalSelect>
              <ModalSelect label="Serviço" value={svcId} onChange={setSvcId} placeholder="Selecionar Serviço">
                {services.map(s => <option key={s.id} value={s.id}>{s.name} - R${s.price}</option>)}
              </ModalSelect>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Data</label>
                  <input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs uppercase" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Hora</label>
                  <input type="time" value={manualTime} onChange={e => setManualTime(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setShowBookingModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Voltar</button>
              <button onClick={handleCreateBooking} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs shadow-xl shadow-orange-100 hover:bg-black transition-all">Agendar</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Finish / Manage Modal ────────────────── */}
      {showFinishModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-orange-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-black text-black uppercase">Gerenciar Agendamento</h2>
              <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${
                showFinishModal.source === BookingSource.AI ? 'bg-orange-100 text-orange-600' :
                (showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) ? 'bg-blue-100 text-blue-600' :
                'bg-slate-100 text-slate-500'
              }`}>
                {showFinishModal.source === BookingSource.AI ? '⚡ Agente IA' :
                 (showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) ? '📦 Plano' :
                 '✏️ Manual'}
              </span>
            </div>

            <div className="bg-slate-50 rounded-3xl p-6 space-y-3">
              {showFinishModal.startTime && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data / Hora</span>
                  <span className="text-sm font-black text-orange-500">
                    {new Date(showFinishModal.startTime).toLocaleDateString('pt-BR')} às{' '}
                    {new Date(showFinishModal.startTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
              {showFinishModal.service_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Serviço</span>
                  <span className="text-sm font-black text-black">{services.find(s => s.id === showFinishModal.service_id)?.name || '—'}</span>
                </div>
              )}
              {showFinishModal.professional_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profissional</span>
                  <span className="text-sm font-black text-black">{professionals.find(p => p.id === showFinishModal.professional_id)?.name || '—'}</span>
                </div>
              )}
              {showFinishModal.customer_id && (
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cliente</span>
                  <span className="text-sm font-black text-black">{customers.find(c => c.id === showFinishModal.customer_id)?.name || '—'}</span>
                </div>
              )}
            </div>

            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Status</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value as AppointmentStatus)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                  <option value={AppointmentStatus.CONFIRMED}>CONFIRMADO</option>
                  <option value={AppointmentStatus.FINISHED}>FINALIZADO</option>
                  <option value={AppointmentStatus.CANCELLED}>CANCELADO</option>
                </select>
              </div>

              {!(showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) && (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Forma de Pagamento</label>
                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as PaymentMethod)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black">
                      {Object.values(PaymentMethod).map(pm => <option key={pm} value={pm}>{pm}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Acréscimo (Opcional)</label>
                    <input type="number" value={extraValue} onChange={e => setExtraValue(Number(e.target.value))} placeholder="Valor Extra" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black" />
                  </div>
                  <div className="bg-black p-8 rounded-[30px] text-center">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-2">Total do Atendimento</p>
                    <p className="text-4xl font-black text-white">R$ {(showFinishModal.basePrice + (extraValue || 0)).toFixed(2)}</p>
                  </div>
                </>
              )}

              {(showFinishModal.isPlan || showFinishModal.source === BookingSource.PLAN) && (
                <div className="bg-blue-50 border-2 border-blue-100 p-6 rounded-[24px] text-center">
                  <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-1">Cobertura do Plano</p>
                  <p className="text-lg font-black text-blue-600">Atendimento incluso no plano do cliente</p>
                  <p className="text-[9px] font-bold text-blue-400 mt-1 uppercase">Sem cobrança — não somado ao financeiro</p>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button onClick={() => setShowFinishModal(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Sair</button>
              <button onClick={handleFinish} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs">Gravar Alterações</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Break Period Modal ───────────────────── */}
      {showBreakModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-10 space-y-6 animate-scaleUp border-4 border-black">
            <h2 className="text-2xl font-black text-black uppercase tracking-tight">Gerar Intervalo</h2>

            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome do Intervalo</label>
                <input value={brkLabel} onChange={e => setBrkLabel(e.target.value)} placeholder="Ex: Almoço, Intervalo" className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Barbeiro (opcional)</label>
                <select value={brkProfId} onChange={e => setBrkProfId(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                  <option value="">Todos os profissionais</option>
                  {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Tipo</label>
                <div className="flex gap-3">
                  <button onClick={() => setBrkType('recurring')} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase transition-all ${brkType === 'recurring' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                    Semanal
                  </button>
                  <button onClick={() => setBrkType('specific')} className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase transition-all ${brkType === 'specific' ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                    Dia Específico
                  </button>
                </div>
              </div>

              {brkType === 'recurring' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Dia da Semana</label>
                  <select value={brkDayOfWeek} onChange={e => setBrkDayOfWeek(Number(e.target.value))} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                    {DAY_NAMES.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
              )}

              {brkType === 'specific' && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Data</label>
                  <input type="date" value={brkDate} onChange={e => setBrkDate(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Início</label>
                  <input type="time" value={brkStart} onChange={e => setBrkStart(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Fim</label>
                  <input type="time" value={brkEnd} onChange={e => setBrkEnd(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-xs" />
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowBreakModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs">Cancelar</button>
              <button onClick={handleCreateBreak} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all">Salvar Intervalo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const PresetBtn = ({ active, onClick, label }: any) => (
  <button onClick={onClick} className={`px-3 py-2 text-[9px] font-black uppercase tracking-tighter rounded-xl transition-all ${active ? 'bg-orange-500 text-white shadow-md' : 'bg-slate-50 text-slate-400 hover:text-black'}`}>
    {label}
  </button>
);

const ModalSelect = ({ label, value, onChange, placeholder, children }: any) => (
  <div className="space-y-1">
    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">{label}</label>
    <select value={value} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
      <option value="">{placeholder}</option>
      {children}
    </select>
  </div>
);

export default AppointmentsView;
