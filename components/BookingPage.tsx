import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { supabase } from '../services/supabase';
import { evolutionService } from '../services/evolutionService';
import { AppointmentStatus, BookingSource } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────
const _pad = (n: number) => String(n).padStart(2, '0');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function isoOffset(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
}

function formatDatePT(iso: string) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  });
}

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length >= 10) return `55${digits}`;
  return digits;
}

function maskPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.length <= 2) return d;
  if (d.length <= 4) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 9) return `(${d.slice(0, 2)}) ${d.slice(2, 5)}-${d.slice(5)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
}

const PERIODS = [
  { id: 'manha', label: 'Manhã', emoji: '🌅', start: 6, end: 12 },
  { id: 'tarde', label: 'Tarde', emoji: '☀️', start: 12, end: 18 },
  { id: 'noite', label: 'Noite', emoji: '🌙', start: 18, end: 24 },
];

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAY_NAMES = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

type Step = 'SERVICE' | 'DATE' | 'BARBER' | 'PERIOD' | 'TIME' | 'INFO' | 'SUCCESS';

// ── Mini Calendar ─────────────────────────────────────────────────────
const MiniCalendar: React.FC<{
  value: string;
  onChange: (d: string) => void;
  activeDays: Set<number>; // 0–6 days that have operating hours
}> = ({ value, onChange, activeDays }) => {
  const today = todayISO();
  const maxDate = isoOffset(60);
  const [view, setView] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const prevMonth = () => setView(v => {
    const d = new Date(v.year, v.month - 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const nextMonth = () => setView(v => {
    const d = new Date(v.year, v.month + 1, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const firstDow = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();

  const cells: (string | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${view.year}-${_pad(view.month + 1)}-${_pad(d)}`);
  }

  const canGoPrev = view.year > new Date().getFullYear() || view.month > new Date().getMonth();

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} disabled={!canGoPrev} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 disabled:opacity-30 transition-all font-black">‹</button>
        <span className="font-black text-sm text-black uppercase tracking-wide">{MONTH_NAMES[view.month]} {view.year}</span>
        <button onClick={nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-all font-black">›</button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {DAY_NAMES.map(d => (
          <div key={d} className="text-center text-[9px] font-black text-slate-400 uppercase py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} />;
          const dow = new Date(iso + 'T12:00:00').getDay();
          const isPast = iso < today;
          const isTooFar = iso > maxDate;
          const isClosed = !activeDays.has(dow);
          const isDisabled = isPast || isTooFar || isClosed;
          const isSelected = iso === value;
          const isToday = iso === today;

          return (
            <button
              key={iso}
              onClick={() => !isDisabled && onChange(iso)}
              disabled={isDisabled}
              className={`h-9 w-full rounded-xl text-xs font-black transition-all ${
                isSelected
                  ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
                  : isToday && !isDisabled
                  ? 'bg-orange-50 text-orange-500 border border-orange-200'
                  : isDisabled
                  ? 'text-slate-200 cursor-not-allowed'
                  : 'text-black hover:bg-orange-50 hover:text-orange-500'
              }`}
            >
              {parseInt(iso.split('-')[2])}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ── Main Component ────────────────────────────────────────────────────
const BookingPage: React.FC<{ slug: string }> = ({ slug }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tenant, setTenant] = useState<any>(null);
  const [services, setServices] = useState<any[]>([]);
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({});

  // Booking state
  const [step, setStep] = useState<Step>('SERVICE');
  const [selectedService, setSelectedService] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedBarber, setSelectedBarber] = useState<any>(null);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [rawPhone, setRawPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const topRef = useRef<HTMLDivElement>(null);

  // Load tenant data
  useEffect(() => {
    (async () => {
      try {
        const tenants = await db.getAllTenants();
        const t = tenants.find((x: any) => x.slug === slug);
        if (!t) { setError('Barbearia não encontrada.'); setLoading(false); return; }
        setTenant(t);
        const [svcs, profs, sett] = await Promise.all([
          db.getServices(t.id),
          db.getProfessionals(t.id),
          db.getSettings(t.id),
        ]);
        setServices(svcs.filter((s: any) => s.active));
        setProfessionals(profs.filter((p: any) => p.active !== false));
        setSettings(sett);
      } catch {
        setError('Erro ao carregar dados da barbearia.');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  // Load slots when date + barber + service are all set
  useEffect(() => {
    if (!selectedDate || !selectedBarber || !selectedService || !tenant) return;
    (async () => {
      setLoadingSlots(true);
      setSlots([]);
      try {
        const dateObj = new Date(selectedDate + 'T12:00:00');
        const dayIndex = dateObj.getDay();
        const dayConfig = settings.operatingHours?.[dayIndex];
        if (!dayConfig?.active) { setSlots([]); return; }

        const [startRange, endRange] = dayConfig.range.split('-');
        const [startH, startM] = startRange.split(':').map(Number);
        const [endH, endM] = endRange.split(':').map(Number);

        const { data: appts } = await supabase
          .from('appointments')
          .select('inicio, fim')
          .eq('tenant_id', tenant.id)
          .eq('professional_id', selectedBarber.id)
          .neq('status', 'cancelled')
          .gte('inicio', `${selectedDate}T00:00:00`)
          .lte('inicio', `${selectedDate}T23:59:59`);

        const now = new Date();
        const isToday = selectedDate === todayISO();
        const duration = selectedService.durationMinutes;
        const result: string[] = [];
        let cursor = startH * 60 + startM;
        const endCursor = endH * 60 + endM;

        while (cursor + duration <= endCursor) {
          const h = Math.floor(cursor / 60);
          const m = cursor % 60;
          const label = `${_pad(h)}:${_pad(m)}`;
          const slotStart = new Date(`${selectedDate}T${label}:00`);
          const slotEnd = new Date(slotStart.getTime() + duration * 60000);

          if (isToday && slotStart <= now) { cursor += 30; continue; }

          const conflict = (appts || []).some((a: any) =>
            new Date(a.inicio) < slotEnd && new Date(a.fim) > slotStart
          );
          if (!conflict) result.push(label);
          cursor += 30;
        }
        setSlots(result);
      } finally {
        setLoadingSlots(false);
      }
    })();
  }, [selectedDate, selectedBarber, selectedService, tenant, settings]);

  const activeDays = React.useMemo(() => {
    const s = new Set<number>();
    if (settings.operatingHours) {
      Object.entries(settings.operatingHours).forEach(([k, v]: any) => {
        if (v?.active) s.add(Number(k));
      });
    }
    return s;
  }, [settings]);

  const filteredSlots = slots.filter(t => {
    if (!selectedPeriod) return true;
    const h = parseInt(t.split(':')[0]);
    const p = PERIODS.find(x => x.id === selectedPeriod);
    return p ? h >= p.start && h < p.end : true;
  });

  const slotsInPeriod = (pid: string) => {
    const p = PERIODS.find(x => x.id === pid);
    return p ? slots.filter(t => { const h = parseInt(t.split(':')[0]); return h >= p.start && h < p.end; }).length : 0;
  };

  const scrollTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth' });

  const goTo = (s: Step) => { setStep(s); setTimeout(scrollTop, 50); };

  const handleSubmit = async () => {
    if (!customerName.trim() || !rawPhone.trim()) {
      alert('Preencha seu nome e WhatsApp.');
      return;
    }
    const phone = formatPhone(rawPhone);
    if (phone.length < 12) {
      alert('Número de WhatsApp inválido.\nUse: (DDD) + número. Ex: (44) 99999-9999');
      return;
    }

    setSubmitting(true);
    try {
      const startTimeStr = `${selectedDate}T${selectedTime}:00`;
      const customer = await db.findOrCreateCustomer(tenant.id, phone, customerName.trim());

      await db.addAppointment({
        tenant_id: tenant.id,
        customer_id: customer.id,
        professional_id: selectedBarber.id,
        service_id: selectedService.id,
        startTime: startTimeStr,
        durationMinutes: selectedService.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WEB,
      });

      const dateLabel = formatDatePT(selectedDate);
      const instanceName = tenant.evolution_instance || evolutionService.getInstanceName(tenant.slug);

      // Confirmation to customer
      await evolutionService.sendMessage(instanceName, phone,
        `✅ *Agendamento Confirmado!*\n\n` +
        `💈 *${tenant.name}*\n\n` +
        `📅 *Dia:* ${dateLabel}\n` +
        `⏰ *Horário:* ${selectedTime}\n` +
        `✂️ *Serviço:* ${selectedService.name}\n` +
        `👤 *Profissional:* ${selectedBarber.name}\n\n` +
        `_Em caso de imprevisto entre em contato. Aguardamos você! ✂️_`
      );

      // Notification to professional
      if (selectedBarber.phone) {
        await evolutionService.sendMessage(instanceName, selectedBarber.phone,
          `📋 *Novo Agendamento Online!*\n\n` +
          `👤 *Cliente:* ${customerName.trim()}\n` +
          `📱 *WhatsApp:* +${phone}\n` +
          `📅 *Dia:* ${dateLabel}\n` +
          `⏰ *Horário:* ${selectedTime}\n` +
          `✂️ *Serviço:* ${selectedService.name}`
        );
      }

      goTo('SUCCESS');
    } catch (e: any) {
      alert('Erro ao confirmar agendamento. Tente novamente.\n' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading / Error screens ───────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto"></div>
          <p className="text-xs font-black uppercase tracking-widest text-slate-400">Carregando...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <div className="text-5xl">💈</div>
          <p className="text-xl font-black text-black uppercase">{error}</p>
          <p className="text-xs font-bold text-slate-400">Verifique o link e tente novamente.</p>
        </div>
      </div>
    );
  }

  // Step labels for breadcrumb
  const stepOrder: Step[] = ['SERVICE', 'DATE', 'BARBER', 'PERIOD', 'TIME', 'INFO'];
  const stepIdx = stepOrder.indexOf(step);

  return (
    <div className="min-h-screen bg-slate-50" ref={topRef}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="bg-black text-white sticky top-0 z-50">
        <div className="max-w-lg mx-auto px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-orange-500">Agendamento Online</p>
            <h1 className="text-xl font-black uppercase tracking-tight">{tenant?.name || 'Barbearia'}</h1>
          </div>
          <div className="text-3xl">💈</div>
        </div>

        {/* Progress bar */}
        {step !== 'SUCCESS' && (
          <div className="h-1 bg-slate-800">
            <div
              className="h-full bg-orange-500 transition-all duration-500"
              style={{ width: `${((stepIdx + 1) / stepOrder.length) * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">

        {/* ── SUCCESS ─────────────────────────────────────────────── */}
        {step === 'SUCCESS' && (
          <div className="text-center space-y-8 py-8 animate-fadeIn">
            <div className="text-7xl">✅</div>
            <div>
              <h2 className="text-2xl font-black text-black uppercase tracking-tight">Agendado!</h2>
              <p className="text-sm font-bold text-slate-400 mt-2">Enviamos a confirmação para o seu WhatsApp.</p>
            </div>
            <div className="bg-white rounded-[28px] p-8 border-2 border-slate-100 text-left space-y-4 shadow-xl shadow-slate-100/50">
              <SummaryRow icon="✂️" label="Serviço" value={selectedService?.name} />
              <SummaryRow icon="📅" label="Dia" value={formatDatePT(selectedDate)} />
              <SummaryRow icon="⏰" label="Horário" value={selectedTime} />
              <SummaryRow icon="💈" label="Profissional" value={selectedBarber?.name} />
            </div>
            <button
              onClick={() => {
                setStep('SERVICE');
                setSelectedService(null); setSelectedDate(''); setSelectedBarber(null);
                setSelectedPeriod(''); setSelectedTime(''); setCustomerName(''); setRawPhone('');
              }}
              className="w-full py-4 border-2 border-black text-black rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black hover:text-white transition-all"
            >
              Novo Agendamento
            </button>
          </div>
        )}

        {/* ── SERVICE ─────────────────────────────────────────────── */}
        {step === 'SERVICE' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={1} total={6} title="Escolha o Serviço" />
            <div className="space-y-3">
              {services.length === 0 && (
                <p className="text-center py-10 text-slate-400 text-sm font-bold">Nenhum serviço disponível.</p>
              )}
              {services.map(svc => (
                <button
                  key={svc.id}
                  onClick={() => { setSelectedService(svc); goTo('DATE'); }}
                  className="w-full bg-white rounded-[24px] p-6 border-2 border-slate-100 hover:border-orange-500 hover:shadow-xl hover:shadow-orange-100/50 transition-all text-left group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-black text-black text-lg group-hover:text-orange-500 transition-all">{svc.name}</p>
                      <p className="text-xs font-bold text-slate-400 mt-1">⏱ {svc.durationMinutes} min</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-orange-500">R$ {svc.price.toFixed(2)}</p>
                      <p className="text-[9px] font-black text-orange-300 uppercase">→</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── DATE ────────────────────────────────────────────────── */}
        {step === 'DATE' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={2} total={6} title="Escolha o Dia" onBack={() => goTo('SERVICE')} />
            <div className="bg-white rounded-[28px] p-8 border-2 border-slate-100 shadow-xl shadow-slate-100/50">
              <MiniCalendar value={selectedDate} onChange={d => { setSelectedDate(d); goTo('BARBER'); }} activeDays={activeDays} />
            </div>
            {activeDays.size === 0 && (
              <p className="text-center text-xs font-bold text-slate-400">Horários de funcionamento não configurados.</p>
            )}
          </div>
        )}

        {/* ── BARBER ──────────────────────────────────────────────── */}
        {step === 'BARBER' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={3} total={6} title="Escolha o Profissional" onBack={() => goTo('DATE')} />
            <p className="text-xs font-bold text-slate-400 text-center">{formatDatePT(selectedDate)}</p>
            <div className="space-y-3">
              {professionals.map(prof => (
                <button
                  key={prof.id}
                  onClick={() => { setSelectedBarber(prof); goTo('PERIOD'); }}
                  className="w-full bg-white rounded-[24px] p-6 border-2 border-slate-100 hover:border-orange-500 hover:shadow-xl hover:shadow-orange-100/50 transition-all flex items-center gap-5 group"
                >
                  <div className="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-3xl group-hover:bg-orange-50 transition-all flex-shrink-0">💈</div>
                  <div className="text-left">
                    <p className="font-black text-black text-lg group-hover:text-orange-500 transition-all">{prof.name}</p>
                    {prof.specialty && <p className="text-xs font-bold text-slate-400">{prof.specialty}</p>}
                  </div>
                  <div className="ml-auto text-orange-500 font-black text-xl">›</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── PERIOD ──────────────────────────────────────────────── */}
        {step === 'PERIOD' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={4} total={6} title="Escolha o Período" onBack={() => goTo('BARBER')} />
            <p className="text-xs font-bold text-slate-400 text-center">
              {formatDatePT(selectedDate)} · {selectedBarber?.name}
            </p>

            {loadingSlots && (
              <div className="text-center py-8">
                <div className="w-8 h-8 border-4 border-slate-100 border-t-orange-500 rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-bold text-slate-400 mt-3 uppercase">Verificando horários...</p>
              </div>
            )}

            {!loadingSlots && slots.length === 0 && (
              <div className="bg-white rounded-[28px] p-8 text-center border-2 border-slate-100">
                <p className="text-3xl mb-3">😕</p>
                <p className="font-black text-black">Sem horários disponíveis</p>
                <p className="text-xs font-bold text-slate-400 mt-1">Escolha outro dia ou profissional.</p>
                <button onClick={() => goTo('DATE')} className="mt-5 px-6 py-3 bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all">
                  Trocar Dia
                </button>
              </div>
            )}

            {!loadingSlots && slots.length > 0 && (
              <div className="space-y-3">
                {PERIODS.map(p => {
                  const count = slotsInPeriod(p.id);
                  return (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPeriod(p.id); goTo('TIME'); }}
                      disabled={count === 0}
                      className={`w-full bg-white rounded-[24px] p-6 border-2 transition-all text-left ${
                        count > 0
                          ? 'border-slate-100 hover:border-orange-500 hover:shadow-xl hover:shadow-orange-100/50'
                          : 'border-slate-50 opacity-40 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <span className="text-3xl">{p.emoji}</span>
                          <div>
                            <p className="font-black text-black text-lg">{p.label}</p>
                            <p className="text-xs font-bold text-slate-400">{count > 0 ? `${count} horário${count !== 1 ? 's' : ''} disponível` : 'Sem horários'}</p>
                          </div>
                        </div>
                        {count > 0 && <div className="text-orange-500 font-black text-xl">›</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── TIME ────────────────────────────────────────────────── */}
        {step === 'TIME' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={5} total={6} title="Escolha o Horário" onBack={() => goTo('PERIOD')} />
            <p className="text-xs font-bold text-slate-400 text-center">
              {formatDatePT(selectedDate)} · {selectedBarber?.name} · {PERIODS.find(p => p.id === selectedPeriod)?.label}
            </p>

            <div className="grid grid-cols-3 gap-3">
              {filteredSlots.map(time => (
                <button
                  key={time}
                  onClick={() => { setSelectedTime(time); goTo('INFO'); }}
                  className="bg-white border-2 border-slate-100 rounded-2xl py-4 font-black text-sm text-black hover:border-orange-500 hover:bg-orange-50 hover:text-orange-500 hover:shadow-lg hover:shadow-orange-100/50 transition-all"
                >
                  {time}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── INFO ────────────────────────────────────────────────── */}
        {step === 'INFO' && (
          <div className="space-y-6 animate-fadeIn">
            <StepHeader step={6} total={6} title="Seus Dados" onBack={() => goTo('TIME')} />

            {/* Summary card */}
            <div className="bg-orange-50 rounded-[24px] p-6 border-2 border-orange-100 space-y-2">
              <SummaryRow icon="✂️" label="Serviço" value={selectedService?.name} small />
              <SummaryRow icon="📅" label="Dia" value={formatDatePT(selectedDate)} small />
              <SummaryRow icon="⏰" label="Horário" value={selectedTime} small />
              <SummaryRow icon="💈" label="Profissional" value={selectedBarber?.name} small />
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-2">Seu Nome</label>
                <input
                  type="text"
                  placeholder="Nome completo"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  className="w-full px-5 py-4 bg-white border-2 border-slate-100 rounded-2xl font-bold text-black outline-none focus:border-orange-500 transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-2">WhatsApp</label>
                <input
                  type="tel"
                  placeholder="(DDD) 99999-9999"
                  value={maskPhone(rawPhone)}
                  onChange={e => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
                    setRawPhone(digits);
                  }}
                  className="w-full px-5 py-4 bg-white border-2 border-slate-100 rounded-2xl font-bold text-black outline-none focus:border-orange-500 transition-all"
                />
                <p className="text-[9px] font-bold text-slate-400 ml-2">A confirmação será enviada neste número.</p>
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting || !customerName.trim() || rawPhone.replace(/\D/g,'').length < 10}
              className="w-full py-5 bg-orange-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-orange-200 hover:bg-orange-600 hover:scale-[1.02] transition-all disabled:opacity-40 disabled:scale-100 disabled:shadow-none"
            >
              {submitting ? 'Confirmando...' : '✅ Confirmar Agendamento'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Helper sub-components ─────────────────────────────────────────────
const StepHeader: React.FC<{ step: number; total: number; title: string; onBack?: () => void }> = ({ step, total, title, onBack }) => (
  <div className="flex items-center gap-4">
    {onBack && (
      <button onClick={onBack} className="w-10 h-10 rounded-2xl border-2 border-slate-200 flex items-center justify-center text-slate-500 hover:border-orange-500 hover:text-orange-500 transition-all font-black text-lg flex-shrink-0">
        ‹
      </button>
    )}
    <div className="flex-1">
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Passo {step} de {total}</p>
      <h2 className="text-2xl font-black text-black uppercase tracking-tight leading-tight">{title}</h2>
    </div>
  </div>
);

const SummaryRow: React.FC<{ icon: string; label: string; value: string; small?: boolean }> = ({ icon, label, value, small }) => (
  <div className="flex items-center gap-3">
    <span className={small ? 'text-base' : 'text-xl'}>{icon}</span>
    <div className="flex-1 min-w-0">
      <span className={`font-black text-slate-500 uppercase tracking-widest ${small ? 'text-[9px]' : 'text-[10px]'}`}>{label}: </span>
      <span className={`font-black text-black ${small ? 'text-xs' : 'text-sm'}`}>{value}</span>
    </div>
  </div>
);

export default BookingPage;
