
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Plan, Customer, Service } from '../types';

const PlansView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formProcedures, setFormProcedures] = useState('4');
  const [formServiceId, setFormServiceId] = useState('');
  const [formFeature, setFormFeature] = useState('');
  const [formFeatures, setFormFeatures] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, c, s] = await Promise.all([
      db.getPlans(tenantId),
      db.getCustomers(tenantId),
      db.getServices(tenantId)
    ]);
    setPlans(p);
    setCustomers(c);
    setServices(s.filter(sv => sv.active));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingPlan(null);
    setFormName(''); setFormDesc(''); setFormPrice(''); setFormProcedures('4');
    setFormServiceId(''); setFormFeatures([]);
    setShowModal(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setFormName(plan.name);
    setFormDesc(plan.description);
    setFormPrice(String(plan.price));
    setFormProcedures(String(plan.proceduresPerMonth ?? 4));
    setFormServiceId(plan.serviceId || '');
    setFormFeatures([...plan.features]);
    setShowModal(true);
  };

  const addFeature = () => {
    const f = formFeature.trim();
    if (f && !formFeatures.includes(f)) {
      setFormFeatures(prev => [...prev, f]);
      setFormFeature('');
    }
  };

  const removeFeature = (idx: number) => {
    setFormFeatures(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!formName.trim()) { alert('Informe o nome do plano.'); return; }
    setSaving(true);
    try {
      const planData = {
        name: formName.trim(),
        description: formDesc.trim(),
        price: parseFloat(formPrice) || 0,
        proceduresPerMonth: parseInt(formProcedures) || 0,
        serviceId: formServiceId || undefined,
        features: formFeatures
      };
      if (editingPlan) {
        await db.updatePlan(tenantId, editingPlan.id, planData);
      } else {
        await db.addPlan({
          tenant_id: tenantId,
          ...planData,
          active: true
        });
      }
      await load();
      setShowModal(false);
    } catch (err: any) {
      alert('Erro ao salvar plano: ' + (err.message || 'Tente novamente.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este plano?')) return;
    await db.deletePlan(tenantId, id);
    await load();
  };

  const subscriberCount = (planId: string) =>
    customers.filter(c => c.planId === planId).length;

  const getServiceName = (serviceId?: string) =>
    serviceId ? (services.find(s => s.id === serviceId)?.name || null) : null;

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO PLANOS...</div>;

  return (
    <div className="space-y-10 animate-fadeIn max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Planos & Pacotes</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Assinaturas mensais com cobertura de serviços</p>
        </div>
        <button onClick={openCreate} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all">
          + Novo Plano
        </button>
      </div>

      {/* Info card */}
      <div className="bg-blue-50 border-2 border-blue-100 rounded-[30px] p-8 flex items-start gap-6">
        <span className="text-3xl">📦</span>
        <div>
          <p className="font-black text-blue-700 text-sm uppercase tracking-wider mb-1">Como funcionam os planos?</p>
          <p className="text-xs font-bold text-blue-500 leading-relaxed">
            Crie pacotes mensais (ex.: R$ 150/mês = 4 cortes). Defina a <strong>quantidade de procedimentos</strong> cobertos.
            O sistema conta os atendimentos do mês e, ao atingir o limite, os próximos são cobrados normalmente.
            Atribua o plano ao cliente no cadastro — agendamentos cobertos são marcados como <strong>"Plano"</strong> e
            <strong> não geram cobrança</strong> no financeiro.
          </p>
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="bg-white rounded-[40px] border-2 border-dashed border-slate-200 p-20 text-center">
          <p className="text-4xl mb-4">📦</p>
          <p className="font-black text-slate-300 uppercase tracking-widest text-sm">Nenhum plano criado ainda</p>
          <button onClick={openCreate} className="mt-6 bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all">
            Criar primeiro plano
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {plans.map(plan => {
            const subs = subscriberCount(plan.id);
            const svcName = getServiceName(plan.serviceId);
            return (
              <div key={plan.id} className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 p-10 space-y-6 hover:border-black transition-all group">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-black text-black uppercase tracking-tight">{plan.name}</h3>
                    {plan.description && <p className="text-xs font-bold text-slate-400 mt-1">{plan.description}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-black text-orange-500">R$ {plan.price.toFixed(2)}</p>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">/mês</p>
                  </div>
                </div>

                {/* Procedure quota */}
                <div className="bg-orange-50 rounded-2xl px-6 py-3 flex items-center gap-4">
                  <span className="text-2xl">✂️</span>
                  <div>
                    <p className="font-black text-orange-600 text-sm">
                      {plan.proceduresPerMonth > 0 ? `${plan.proceduresPerMonth} procedimento${plan.proceduresPerMonth !== 1 ? 's' : ''}/mês` : 'Ilimitado'}
                    </p>
                    {svcName && <p className="text-[10px] font-black text-orange-400 uppercase tracking-widest">{svcName}</p>}
                  </div>
                </div>

                {plan.features.length > 0 && (
                  <ul className="space-y-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs font-bold text-slate-600">
                        <span className="text-orange-500">✓</span> {f}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center justify-between pt-4 border-t-2 border-slate-50">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-black">{subs}</span>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                      {subs === 1 ? 'cliente ativo' : 'clientes ativos'}
                    </span>
                  </div>
                  <div className="flex gap-3 opacity-0 group-hover:opacity-100 transition-all">
                    <button onClick={() => openEdit(plan)} className="text-[9px] font-black uppercase text-slate-400 hover:text-black transition-colors">Editar</button>
                    <button onClick={() => handleDelete(plan.id)} className="text-[9px] font-black uppercase text-red-400 hover:text-red-600 transition-colors">Remover</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Create / Edit Modal ─────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-lg p-12 space-y-8 animate-scaleUp max-h-[90vh] overflow-y-auto">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight">
              {editingPlan ? 'Editar Plano' : 'Novo Plano'}
            </h2>

            <div className="space-y-5">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome do Plano</label>
                <input value={formName} onChange={e => setFormName(e.target.value)} placeholder="Ex: Plano Mensal Premium" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500" />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Descrição</label>
                <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} placeholder="Descreva o que está incluso no plano..." className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold resize-none focus:border-orange-500" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Valor Mensal (R$)</label>
                  <input type="number" value={formPrice} onChange={e => setFormPrice(e.target.value)} placeholder="150.00" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-xl focus:border-orange-500" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Procedimentos/mês</label>
                  <input type="number" min="0" value={formProcedures} onChange={e => setFormProcedures(e.target.value)} placeholder="4" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-xl focus:border-orange-500" />
                  <p className="text-[9px] font-bold text-slate-300 ml-4">0 = ilimitado</p>
                </div>
              </div>

              {services.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Serviço Coberto (opcional)</label>
                  <select value={formServiceId} onChange={e => setFormServiceId(e.target.value)} className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                    <option value="">Qualquer serviço</option>
                    {services.map(s => <option key={s.id} value={s.id}>{s.name} — R$ {s.price.toFixed(2)}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Benefícios do Plano</label>
                <div className="flex gap-2">
                  <input
                    value={formFeature}
                    onChange={e => setFormFeature(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                    placeholder="Ex: Cortes ilimitados"
                    className="flex-1 p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500"
                  />
                  <button onClick={addFeature} className="px-5 py-4 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase hover:bg-black transition-all">
                    +
                  </button>
                </div>
                {formFeatures.length > 0 && (
                  <div className="space-y-2">
                    {formFeatures.map((f, i) => (
                      <div key={i} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2">
                        <span className="text-xs font-bold text-slate-600"><span className="text-orange-500 mr-2">✓</span>{f}</span>
                        <button onClick={() => removeFeature(i)} className="text-slate-300 hover:text-red-500 font-black text-xs transition-colors">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4 pt-2">
              <button onClick={() => setShowModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar Plano'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlansView;
