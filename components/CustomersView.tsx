
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Customer, Plan, Service, FollowUpNamedMode } from '../types';

const CustomersView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [avisoModes, setAvisoModes] = useState<FollowUpNamedMode[]>([]);
  const [lembreteModes, setLembreteModes] = useState<FollowUpNamedMode[]>([]);
  const [reativacaoModes, setReativacaoModes] = useState<FollowUpNamedMode[]>([]);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: number; fail: number } | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [data, plansData, svcData, settings] = await Promise.all([
        db.getCustomers(tenantId),
        db.getPlans(tenantId),
        db.getServices(tenantId),
        db.getSettings(tenantId)
      ]);
      setCustomers(data);
      setPlans(plansData);
      setServices(svcData.filter(s => s.active));
      setAvisoModes(settings.avisoModes || []);
      setLembreteModes(settings.lembreteModes || []);
      setReativacaoModes(settings.reativacaoModes || []);
    } catch (err) {
      console.error("Erro ao carregar clientes", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  );

  const handleAdd = async () => {
    if (!newName || !newPhone) { alert("Nome e WhatsApp são obrigatórios!"); return; }
    setSaving(true);
    try {
      await db.addCustomer({ tenant_id: tenantId, name: newName, phone: newPhone, active: true });
      await load();
      setShowAddModal(false);
      setNewName(''); setNewPhone('');
    } catch (err: any) {
      alert("Erro ao salvar cliente: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingCustomer) return;
    setSaving(true);
    try {
      await db.updateCustomer(tenantId, editingCustomer.id, {
        name: editingCustomer.name,
        phone: editingCustomer.phone,
        avisoModeId: editingCustomer.avisoModeId,
        lembreteModeId: editingCustomer.lembreteModeId,
        reativacaoModeId: editingCustomer.reativacaoModeId,
        planId: editingCustomer.planId,
        planServiceId: editingCustomer.planServiceId
      });
      await load();
      setEditingCustomer(null);
    } catch (err: any) {
      alert("Erro ao salvar: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      // Detect separator: semicolon (BR Excel) or comma
      const sep = lines[0]?.includes(';') ? ';' : ',';
      let ok = 0, fail = 0;
      for (const line of lines) {
        const cols = line.split(sep).map(c => c.replace(/^"|"$/g, '').trim());
        const name = cols[0] || '';
        const phone = (cols[1] || '').replace(/\D/g, '');
        if (!name || phone.length < 10) { fail++; continue; }
        try {
          await db.addCustomer({ tenant_id: tenantId, name, phone, active: true });
          ok++;
        } catch { fail++; }
      }
      setImportResult({ ok, fail });
      await load();
    } catch (err: any) {
      alert('Erro ao importar: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const getPlanName = (planId: string | null | undefined) =>
    planId ? (plans.find(p => p.id === planId)?.name || null) : null;

  const hasAnyMode = (c: Customer) =>
    (c.avisoModeId && c.avisoModeId !== 'standard') ||
    (c.lembreteModeId && c.lembreteModeId !== 'standard') ||
    (c.reativacaoModeId && c.reativacaoModeId !== 'standard');

  const getModeName = (modeId: string | undefined, modes: FollowUpNamedMode[]) => {
    if (!modeId || modeId === 'standard') return null;
    return modes.find(m => m.id === modeId)?.name || null;
  };

  const hasModes = avisoModes.length > 0 || lembreteModes.length > 0 || reativacaoModes.length > 0;

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO CLIENTES...</div>;

  return (
    <div className="space-y-10 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Base de Clientes</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Histórico e preferências</p>
        </div>
        <div className="flex items-center gap-3">
          {importResult && (
            <span className="text-[9px] font-black uppercase tracking-widest text-green-600 bg-green-50 px-4 py-2 rounded-xl border border-green-100">
              ✅ {importResult.ok} importados {importResult.fail > 0 ? `/ ⚠️ ${importResult.fail} falhas` : ''}
            </span>
          )}
          <label className={`cursor-pointer bg-white border-2 border-slate-200 text-slate-600 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:border-orange-500 hover:text-orange-500 transition-all ${importing ? 'opacity-50 pointer-events-none' : ''}`}>
            {importing ? 'Importando...' : '↑ Importar CSV'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleImportCSV} disabled={importing} />
          </label>
          <button onClick={() => setShowAddModal(true)} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all">
            + Novo Cliente
          </button>
        </div>
      </div>

      <div className="bg-white p-6 border-2 border-slate-100 rounded-[30px] shadow-xl shadow-slate-100/50">
        <input
          placeholder="PESQUISAR POR NOME OU WHATSAPP..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full p-5 bg-slate-50 border-2 border-transparent outline-none text-xs font-black uppercase tracking-widest rounded-2xl focus:border-orange-500 transition-all"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredCustomers.map(c => {
          const planName = getPlanName(c.planId);
          const avisoName = getModeName(c.avisoModeId, avisoModes);
          const lembreteName = getModeName(c.lembreteModeId, lembreteModes);
          const reativacaoName = getModeName(c.reativacaoModeId, reativacaoModes);
          return (
            <div key={c.id} className="bg-white p-10 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 relative group hover:border-black transition-all">
              <div className="absolute top-10 right-10">
                <button onClick={() => setEditingCustomer({ ...c })} className="text-slate-300 hover:text-orange-500 transition-all font-black text-xs uppercase tracking-widest">EDITAR</button>
              </div>
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mb-6 group-hover:bg-orange-50 transition-all">👤</div>
              <h3 className="text-xl font-black text-black mb-1 pr-16 leading-tight uppercase tracking-tight">{c.name}</h3>
              <p className="text-xs font-black text-orange-500 mb-4">{c.phone}</p>
              <div className="flex flex-wrap gap-2">
                {planName && (
                  <span className="text-[8px] font-black px-3 py-1 rounded-full bg-blue-100 text-blue-700 uppercase tracking-widest">
                    📦 {planName}
                  </span>
                )}
                {avisoName && (
                  <span className="text-[8px] font-black px-3 py-1 rounded-full bg-yellow-100 text-yellow-700 uppercase tracking-widest">
                    📢 {avisoName}
                  </span>
                )}
                {lembreteName && (
                  <span className="text-[8px] font-black px-3 py-1 rounded-full bg-purple-100 text-purple-700 uppercase tracking-widest">
                    🕒 {lembreteName}
                  </span>
                )}
                {reativacaoName && (
                  <span className="text-[8px] font-black px-3 py-1 rounded-full bg-green-100 text-green-700 uppercase tracking-widest">
                    ♻️ {reativacaoName}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── Add Modal ──────────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight">Novo Cliente</h2>
            <div className="space-y-6">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome Completo" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
              <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="WhatsApp (55...)" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={() => setShowAddModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Voltar</button>
              <button onClick={handleAdd} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50">
                {saving ? 'Gravando...' : 'Salvar'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ─── Edit Modal ──────────────────────────── */}
      {editingCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
            <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight">Editar Cliente</h2>

            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome</label>
                <input value={editingCustomer.name} onChange={e => setEditingCustomer({ ...editingCustomer, name: e.target.value })} placeholder="Nome Completo" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">WhatsApp</label>
                <input value={editingCustomer.phone} onChange={e => setEditingCustomer({ ...editingCustomer, phone: e.target.value })} placeholder="55..." className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500" />
              </div>

              {/* ─── Plano ─── */}
              {plans.length > 0 && (
                <div className="bg-blue-50 rounded-2xl p-5 space-y-3">
                  <p className="text-[10px] font-black text-blue-500 uppercase tracking-widest">📦 Plano Ativo</p>
                  <select
                    value={editingCustomer.planId || ''}
                    onChange={e => setEditingCustomer({ ...editingCustomer, planId: e.target.value || null })}
                    className="w-full p-4 bg-white border-2 border-blue-100 rounded-2xl font-bold outline-none focus:border-blue-500"
                  >
                    <option value="">Sem plano</option>
                    {plans.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — R$ {p.price.toFixed(2)}/mês ({p.proceduresPerMonth > 0 ? `${p.proceduresPerMonth} proc.` : 'ilimitado'})
                      </option>
                    ))}
                  </select>

                  {/* Service selection for plan */}
                  {editingCustomer.planId && services.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest ml-1">Procedimento do Plano</label>
                      <select
                        value={editingCustomer.planServiceId || ''}
                        onChange={e => setEditingCustomer({ ...editingCustomer, planServiceId: e.target.value || null })}
                        className="w-full p-4 bg-white border-2 border-blue-100 rounded-2xl font-bold outline-none focus:border-blue-500"
                      >
                        <option value="">Qualquer serviço</option>
                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* ─── Modos de Follow-up ─── */}
              {hasModes && (
                <div className="bg-slate-50 rounded-2xl p-5 space-y-4">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">🎯 Modos de Lembrete</p>

                  {avisoModes.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-yellow-600 uppercase tracking-widest ml-1">📢 Check-in Diário</label>
                      <select
                        value={editingCustomer.avisoModeId || 'standard'}
                        onChange={e => setEditingCustomer({ ...editingCustomer, avisoModeId: e.target.value })}
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500"
                      >
                        <option value="standard">Padrão</option>
                        {avisoModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}

                  {lembreteModes.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-purple-600 uppercase tracking-widest ml-1">🕒 Lembrete Próximo</label>
                      <select
                        value={editingCustomer.lembreteModeId || 'standard'}
                        onChange={e => setEditingCustomer({ ...editingCustomer, lembreteModeId: e.target.value })}
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500"
                      >
                        <option value="standard">Padrão</option>
                        {lembreteModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}

                  {reativacaoModes.length > 0 && (
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-green-600 uppercase tracking-widest ml-1">♻️ Recuperação</label>
                      <select
                        value={editingCustomer.reativacaoModeId || 'standard'}
                        onChange={e => setEditingCustomer({ ...editingCustomer, reativacaoModeId: e.target.value })}
                        className="w-full p-4 bg-white border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500"
                      >
                        <option value="standard">Padrão</option>
                        {reativacaoModes.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                  )}

                  {!hasModes && (
                    <p className="text-[9px] font-bold text-slate-300 uppercase">Crie modos em Lembretes para atribuir aqui</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-4 pt-4">
              <button onClick={() => setEditingCustomer(null)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Voltar</button>
              <button onClick={handleSaveEdit} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50">
                {saving ? 'Gravando...' : 'Salvar'}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersView;
