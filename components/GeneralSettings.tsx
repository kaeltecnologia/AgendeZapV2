
import React, { useState, useEffect } from 'react';
import { db } from '../services/mockDb';
import { WorkingDay } from '../types';

const GeneralSettings: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [operatingHours, setOperatingHours] = useState<{ [key: number]: WorkingDay }>({});
  const [storeName, setStoreName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  useEffect(() => {
    const load = async () => {
      const [settings, tenant] = await Promise.all([
        db.getSettings(tenantId),
        db.getTenant(tenantId)
      ]);
      setOperatingHours(settings.operatingHours);
      setWhatsapp(settings.whatsapp || '');
      setStoreName(tenant?.name || '');
      setLoading(false);
    };
    load();
  }, [tenantId]);

  // Split "HH:mm-HH:mm" into { start, end }
  const parseRange = (range: string) => {
    const parts = (range || '09:00-18:00').split('-');
    return { start: parts[0] || '09:00', end: parts[1] || '18:00' };
  };

  const handleToggleDay = (dayIndex: number) => {
    setOperatingHours(prev => ({
      ...prev,
      [dayIndex]: { ...prev[dayIndex], active: !prev[dayIndex].active }
    }));
  };

  const handleTimeChange = (dayIndex: number, field: 'start' | 'end', value: string) => {
    const { start, end } = parseRange(operatingHours[dayIndex]?.range || '09:00-18:00');
    const newRange = field === 'start' ? `${value}-${end}` : `${start}-${value}`;
    setOperatingHours(prev => ({
      ...prev,
      [dayIndex]: { ...prev[dayIndex], range: newRange }
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all([
        db.updateTenant(tenantId, { name: storeName }),
        db.updateSettings(tenantId, { operatingHours, whatsapp })
      ]);
      alert('Configurações salvas com sucesso!');
    } catch (e: any) {
      alert('Erro ao salvar: ' + (e.message || 'Tente novamente.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO CONFIGURAÇÕES...</div>;

  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fadeIn">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Ajustes do Estabelecimento</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão operacional e horários</p>
      </div>

      <div className="bg-white p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-16">

        {/* Dados Corporativos */}
        <div className="space-y-8">
          <div className="flex items-center space-x-4 border-b-2 border-slate-50 pb-4">
            <div className="w-10 h-10 bg-black text-white rounded-xl flex items-center justify-center">🏢</div>
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Dados Corporativos</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome da Barbearia</label>
              <input
                value={storeName}
                onChange={e => setStoreName(e.target.value)}
                placeholder="Ex: Barbearia Dom Barão"
                className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-sm uppercase focus:border-orange-500 transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">WhatsApp Oficial</label>
              <input
                value={whatsapp}
                onChange={e => setWhatsapp(e.target.value)}
                placeholder="5544998169251"
                className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-[24px] outline-none font-black text-sm focus:border-orange-500 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Horário de Atendimento */}
        <div className="space-y-8">
          <div className="flex items-center space-x-4 border-b-2 border-slate-50 pb-4">
            <div className="w-10 h-10 bg-orange-500 text-white rounded-xl flex items-center justify-center">📅</div>
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Horário de Atendimento</h3>
          </div>

          <div className="space-y-2 divide-y-2 divide-slate-50">
            {[1, 2, 3, 4, 5, 6, 0].map(dayIndex => {
              const day = operatingHours[dayIndex];
              if (!day) return null;
              const { start, end } = parseRange(day.range);
              return (
                <div key={dayIndex} className="py-5 flex items-center justify-between gap-4">
                  <div className="flex items-center space-x-4">
                    <button
                      onClick={() => handleToggleDay(dayIndex)}
                      className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ${day.active ? 'bg-orange-500' : 'bg-slate-200'}`}
                    >
                      <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${day.active ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                    <span className={`font-black uppercase text-sm tracking-tight transition-colors w-36 ${day.active ? 'text-black' : 'text-slate-300'}`}>
                      {dayNames[dayIndex]}
                    </span>
                  </div>

                  {day.active ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={start}
                          onChange={e => handleTimeChange(dayIndex, 'start', e.target.value)}
                          className="bg-slate-50 border-2 border-slate-100 px-4 py-2.5 rounded-2xl text-[11px] font-black text-center focus:border-orange-500 outline-none transition-all w-32"
                        />
                        <span className="text-slate-300 font-black text-xs">até</span>
                        <input
                          type="time"
                          value={end}
                          onChange={e => handleTimeChange(dayIndex, 'end', e.target.value)}
                          className="bg-slate-50 border-2 border-slate-100 px-4 py-2.5 rounded-2xl text-[11px] font-black text-center focus:border-orange-500 outline-none transition-all w-32"
                        />
                      </div>
                      <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-3 py-2 rounded-xl uppercase">Aberto</span>
                    </div>
                  ) : (
                    <span className="bg-slate-100 text-slate-400 text-[9px] font-black px-6 py-2.5 rounded-full uppercase tracking-widest italic">Unidade Fechada</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-black text-white py-6 rounded-[30px] font-black text-sm uppercase tracking-[0.3em] shadow-2xl hover:bg-orange-500 transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? 'Salvando...' : 'Atualizar Configurações'}
        </button>
      </div>
    </div>
  );
};

export default GeneralSettings;
