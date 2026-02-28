
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../services/mockDb';
import { FollowUpNamedMode } from '../types';
import PlanGate from './PlanGate';

type MainTab = 'aviso' | 'lembrete' | 'reativacao';

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const TAB_CONFIG: Record<MainTab, { label: string; icon: string; tabKey: 'avisoModes' | 'lembreteModes' | 'reativacaoModes'; timingLabel: string; timingType: 'fixed' | 'minutes' | 'days' }> = {
  aviso: { label: 'Check-in Diário', icon: '📢', tabKey: 'avisoModes', timingLabel: 'Horário de envio', timingType: 'fixed' },
  lembrete: { label: 'Lembrete Próximo', icon: '🕒', tabKey: 'lembreteModes', timingLabel: 'Antecipar em (minutos)', timingType: 'minutes' },
  reativacao: { label: 'Recuperação', icon: '♻️', tabKey: 'reativacaoModes', timingLabel: 'Dias de ausência', timingType: 'days' }
};

const FollowUpView: React.FC<{ tenantId: string; tenantPlan?: string }> = ({ tenantId, tenantPlan }) => {
  const [activeTab, setActiveTab] = useState<MainTab>('aviso');

  const [avisoModes, setAvisoModes] = useState<FollowUpNamedMode[]>([]);
  const [lembreteModes, setLembreteModes] = useState<FollowUpNamedMode[]>([]);
  const [reativacaoModes, setReativacaoModes] = useState<FollowUpNamedMode[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add-mode form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMsg, setNewMsg] = useState('');
  const [newTiming, setNewTiming] = useState<number>(60);
  const [newFixedTime, setNewFixedTime] = useState('08:00');

  // Edit state for each mode (by id)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Partial<FollowUpNamedMode>>({});

  // Refs for variable insertion at cursor position
  const addMsgRef = useRef<HTMLTextAreaElement | null>(null);
  const editMsgRef = useRef<HTMLTextAreaElement | null>(null);

  function insertVar(
    variable: string,
    ref: React.RefObject<HTMLTextAreaElement | null>,
    currentValue: string,
    setter: (v: string) => void
  ) {
    const el = ref.current;
    if (!el) { setter(currentValue + variable); return; }
    const start = el.selectionStart ?? currentValue.length;
    const end = el.selectionEnd ?? currentValue.length;
    const newVal = currentValue.slice(0, start) + variable + currentValue.slice(end);
    setter(newVal);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + variable.length, start + variable.length);
    });
  }

  const load = useCallback(async () => {
    setLoading(true);
    const s = await db.getSettings(tenantId);
    setAvisoModes(s.avisoModes || []);
    setLembreteModes(s.lembreteModes || []);
    setReativacaoModes(s.reativacaoModes || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  // When switching tabs, close forms
  useEffect(() => { setShowAddForm(false); setEditingId(null); resetAddForm(); }, [activeTab]);

  function resetAddForm() {
    setNewName(''); setNewMsg(''); setNewTiming(60); setNewFixedTime('08:00');
  }

  const getModes = (tab: MainTab) => tab === 'aviso' ? avisoModes : tab === 'lembrete' ? lembreteModes : reativacaoModes;
  const setModes = (tab: MainTab, modes: FollowUpNamedMode[]) => {
    if (tab === 'aviso') setAvisoModes(modes);
    else if (tab === 'lembrete') setLembreteModes(modes);
    else setReativacaoModes(modes);
  };
  const getKey = (tab: MainTab) => TAB_CONFIG[tab].tabKey;

  const handleAddMode = async () => {
    const name = newName.trim();
    const msg = newMsg.trim();
    if (!name || !msg) return;
    setSaving(true);
    const cfg = TAB_CONFIG[activeTab];
    const mode: FollowUpNamedMode = {
      id: generateId(),
      name,
      active: true,
      message: msg,
      timing: cfg.timingType === 'fixed' ? 0 : newTiming,
      fixedTime: cfg.timingType === 'fixed' ? newFixedTime : undefined
    };
    const updated = [...getModes(activeTab), mode];
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
    setModes(activeTab, updated);
    resetAddForm();
    setShowAddForm(false);
    setSaving(false);
  };

  const handleToggleActive = async (mode: FollowUpNamedMode) => {
    const updated = getModes(activeTab).map(m => m.id === mode.id ? { ...m, active: !m.active } : m);
    setModes(activeTab, updated);
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
  };

  const handleStartEdit = (mode: FollowUpNamedMode) => {
    setEditingId(mode.id);
    setEditFields({ ...mode });
  };

  const handleSaveEdit = async (id: string) => {
    setSaving(true);
    const updated = getModes(activeTab).map(m => m.id === id ? { ...m, ...editFields } : m);
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
    setModes(activeTab, updated);
    setEditingId(null);
    setEditFields({});
    setSaving(false);
  };

  const handleDeleteMode = async (id: string) => {
    if (!confirm('Remover este modo?')) return;
    const updated = getModes(activeTab).filter(m => m.id !== id);
    await db.updateSettings(tenantId, { [getKey(activeTab)]: updated });
    setModes(activeTab, updated);
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO...</div>;

  const cfg = TAB_CONFIG[activeTab];
  const modes = getModes(activeTab);

  return (
    <div className="space-y-10 animate-fadeIn max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Lembretes Inteligentes</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Crie múltiplos modos e atribua individualmente a cada cliente</p>
      </div>

      {/* Tabs */}
      <div className="flex bg-slate-100 p-2 rounded-[30px] shadow-sm">
        {(Object.entries(TAB_CONFIG) as [MainTab, typeof TAB_CONFIG[MainTab]][]).map(([key, c]) => (
          <Tab key={key} active={activeTab === key} onClick={() => setActiveTab(key)} label={c.label} icon={c.icon} />
        ))}
      </div>

      {/* Tab content */}
      <PlanGate feature="reativacao" tenantPlan={activeTab === 'reativacao' ? (tenantPlan ?? null) : 'ELITE'}>
      <div className="bg-white p-12 rounded-[50px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 space-y-8">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-black text-white rounded-[28px] flex items-center justify-center text-4xl shadow-xl">
              {cfg.icon}
            </div>
            <div>
              <h3 className="text-2xl font-black text-black uppercase tracking-tight">{cfg.label}</h3>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">
                {modes.length} modo{modes.length !== 1 ? 's' : ''} criado{modes.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => { setShowAddForm(v => !v); setEditingId(null); }}
            className="px-8 py-4 bg-orange-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all shadow-xl shadow-orange-100"
          >
            + Adicionar Modo
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="bg-slate-50 rounded-[30px] p-8 space-y-5 border-2 border-orange-100">
            <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Novo Modo — {cfg.label}</p>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nome do modo (ex: VIP, Padrão Intenso)"
              className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500 transition-all"
            />
            <textarea
              ref={addMsgRef}
              rows={4}
              value={newMsg}
              onChange={e => setNewMsg(e.target.value)}
              placeholder="Mensagem que será enviada via WhatsApp... Use {nome}, {dia}, {hora}, {servico}"
              className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl outline-none font-bold resize-none focus:border-orange-500 transition-all text-sm leading-relaxed"
            />
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">inserir:</span>
              {['{nome}', '{dia}', '{hora}', '{servico}'].map(v => (
                <Tag key={v} label={v} onClick={() => insertVar(v, addMsgRef, newMsg, setNewMsg)} />
              ))}
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 ml-1">{cfg.timingLabel}</label>
              {cfg.timingType === 'fixed' && (
                <input type="time" value={newFixedTime} onChange={e => setNewFixedTime(e.target.value)}
                  className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-xl outline-none focus:border-orange-500" />
              )}
              {cfg.timingType === 'minutes' && (
                <select value={newTiming} onChange={e => setNewTiming(Number(e.target.value))}
                  className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-black uppercase text-xs">
                  <option value={30}>30 minutos antes</option>
                  <option value={60}>1 hora antes</option>
                  <option value={120}>2 horas antes</option>
                  <option value={240}>4 horas antes</option>
                </select>
              )}
              {cfg.timingType === 'days' && (
                <div className="flex items-center gap-3">
                  <input type="number" value={newTiming} onChange={e => setNewTiming(Number(e.target.value))}
                    className="w-24 p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-center text-xl outline-none focus:border-orange-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">dias de ausência</span>
                </div>
              )}
            </div>
            <div className="flex gap-4 pt-2">
              <button onClick={() => { setShowAddForm(false); resetAddForm(); }}
                className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>
                Cancelar
              </button>
              <button onClick={handleAddMode} disabled={saving || !newName.trim() || !newMsg.trim()}
                className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                {saving ? 'Salvando...' : 'Adicionar Modo'}
              </button>
            </div>
          </div>
        )}

        {/* Modes list */}
        {modes.length === 0 && !showAddForm && (
          <div className="text-center py-10">
            <p className="text-4xl mb-3">{cfg.icon}</p>
            <p className="text-slate-300 font-black uppercase tracking-widest text-sm">Nenhum modo criado ainda</p>
            <p className="text-slate-200 text-xs font-bold mt-1">Clique em "+ Adicionar Modo" para criar estratégias personalizadas</p>
          </div>
        )}

        <div className="space-y-4">
          {modes.map(mode => (
            <div key={mode.id} className={`rounded-[28px] border-2 transition-all ${mode.active ? 'bg-white border-slate-100' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
              {editingId === mode.id ? (
                /* Edit mode */
                <div className="p-8 space-y-4">
                  <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Editando modo</p>
                  <input
                    value={editFields.name || ''}
                    onChange={e => setEditFields(f => ({ ...f, name: e.target.value }))}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500"
                  />
                  <textarea
                    ref={editMsgRef}
                    rows={4}
                    value={editFields.message || ''}
                    onChange={e => setEditFields(f => ({ ...f, message: e.target.value }))}
                    className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold resize-none focus:border-orange-500 text-sm leading-relaxed"
                  />
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">inserir:</span>
                    {['{nome}', '{dia}', '{hora}', '{servico}'].map(v => (
                      <Tag key={v} label={v} onClick={() => insertVar(v, editMsgRef, editFields.message || '', (val) => setEditFields(f => ({ ...f, message: val })))} />
                    ))}
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 ml-1">{cfg.timingLabel}</label>
                    {cfg.timingType === 'fixed' && (
                      <input type="time" value={editFields.fixedTime || '08:00'}
                        onChange={e => setEditFields(f => ({ ...f, fixedTime: e.target.value }))}
                        className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-xl outline-none focus:border-orange-500" />
                    )}
                    {cfg.timingType === 'minutes' && (
                      <select value={editFields.timing}
                        onChange={e => setEditFields(f => ({ ...f, timing: Number(e.target.value) }))}
                        className="p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none uppercase text-xs">
                        <option value={30}>30 minutos antes</option>
                        <option value={60}>1 hora antes</option>
                        <option value={120}>2 horas antes</option>
                        <option value={240}>4 horas antes</option>
                      </select>
                    )}
                    {cfg.timingType === 'days' && (
                      <div className="flex items-center gap-3">
                        <input type="number" value={editFields.timing}
                          onChange={e => setEditFields(f => ({ ...f, timing: Number(e.target.value) }))}
                          className="w-24 p-4 bg-white border-2 border-slate-100 rounded-2xl font-black text-center text-xl outline-none focus:border-orange-500" />
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">dias de ausência</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setEditingId(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
                    <button onClick={() => handleSaveEdit(mode.id)} disabled={saving}
                      className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                      {saving ? 'Salvando...' : 'Salvar'}
                    </button>
                  </div>
                </div>
              ) : (
                /* Read mode */
                <div className="p-8">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl flex-shrink-0 ${mode.active ? 'bg-orange-50' : 'bg-slate-100'}`}>
                        {cfg.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <p className="font-black text-black uppercase tracking-wide text-sm">{mode.name}</p>
                          <span className={`text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest ${mode.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                            {mode.active ? 'Ativo' : 'Inativo'}
                          </span>
                          {cfg.timingType === 'fixed' && (
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">⏰ {mode.fixedTime}</span>
                          )}
                          {cfg.timingType === 'minutes' && (
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">⏰ {mode.timing}min antes</span>
                          )}
                          {cfg.timingType === 'days' && (
                            <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">📆 {mode.timing} dias ausência</span>
                          )}
                        </div>
                        <p className="text-xs font-bold text-slate-400 mt-1 truncate">{mode.message.substring(0, 80)}{mode.message.length > 80 ? '...' : ''}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => handleToggleActive(mode)}
                        className={`px-4 py-2 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all ${mode.active ? 'bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}>
                        {mode.active ? 'Pausar' : 'Ativar'}
                      </button>
                      <button onClick={() => handleStartEdit(mode)}
                        className="px-4 py-2 bg-slate-100 hover:bg-black hover:text-white text-slate-500 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all">
                        Editar
                      </button>
                      <button onClick={() => handleDeleteMode(mode.id)}
                        className="px-4 py-2 bg-slate-100 hover:bg-red-500 hover:text-white text-slate-400 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      </PlanGate>
    </div>
  );
};

const Tab = ({ active, onClick, label, icon }: any) => (
  <button onClick={onClick} className={`flex-1 py-4 px-4 rounded-[24px] flex items-center justify-center space-x-2 transition-all ${active ? 'bg-white text-black shadow-xl font-black scale-105 z-10' : 'text-slate-400 font-bold hover:text-black'}`}>
    <span className="text-lg">{icon}</span>
    <span className="text-[9px] uppercase tracking-widest hidden sm:block">{label}</span>
  </button>
);

const Tag = ({ label, onClick }: { label: string; onClick?: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="bg-white border-2 border-slate-100 px-3 py-1.5 rounded-xl text-[10px] font-black text-slate-600 tracking-widest hover:border-orange-400 hover:bg-orange-50 hover:text-orange-600 active:scale-95 transition-all uppercase cursor-pointer"
  >
    {label}
  </button>
);

export default FollowUpView;
