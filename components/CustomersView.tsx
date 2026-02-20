
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Customer } from '../types';

const CustomersView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await db.getCustomers(tenantId);
      setCustomers(data);
    } catch (err) {
      console.error("Erro ao carregar clientes", err);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.phone.includes(searchTerm)
  );

  const handleAdd = async () => {
    if (!newName || !newPhone) { alert("Nome e WhatsApp são obrigatórios!"); return; }
    setSaving(true);
    try {
      await db.addCustomer({ 
        tenant_id: tenantId, name: newName, phone: newPhone, active: true,
        followUpPreferences: { aviso: true, lembrete: true, reativacao: true }
      });
      await load();
      setShowAddModal(false);
      setNewName('');
      setNewPhone('');
    } catch (err: any) {
      alert("Erro ao salvar cliente: " + (err.message || "Erro desconhecido"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO CLIENTES...</div>;

  return (
    <div className="space-y-10 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Base de Clientes</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Histórico e preferências</p>
        </div>
        <button onClick={() => setShowAddModal(true)} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all">
          + Novo Cliente
        </button>
      </div>

      <div className="bg-white p-6 border-2 border-slate-100 rounded-[30px] shadow-xl shadow-slate-100/50">
        <input 
          placeholder="PESQUISAR POR NOME OU WHATSAPP..." 
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full p-5 bg-slate-50 border-2 border-transparent outline-none text-xs font-black uppercase tracking-widest rounded-2xl focus:border-orange-500 transition-all" 
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {filteredCustomers.map((c) => (
          <div key={c.id} className="bg-white p-10 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 relative group hover:border-black transition-all">
             <div className="absolute top-10 right-10">
              <button onClick={() => setEditingCustomer(c)} className="text-slate-300 hover:text-orange-500 transition-all font-black text-xs uppercase tracking-widest">EDITAR</button>
            </div>
            <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-3xl mb-8 group-hover:bg-orange-50 transition-all">👤</div>
            <h3 className="text-xl font-black text-black mb-1 pr-16 leading-tight uppercase tracking-tight">{c.name}</h3>
            <p className="text-xs font-black text-orange-500 mb-8">{c.phone}</p>
          </div>
        ))}
      </div>

      {(showAddModal || editingCustomer) && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp">
            <h2 className="text-3xl font-black text-black uppercase tracking-tight">{editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}</h2>
            <div className="space-y-6">
              <input value={editingCustomer?.name || newName} onChange={e=>editingCustomer ? setEditingCustomer({...editingCustomer, name: e.target.value}) : setNewName(e.target.value)} placeholder="Nome Completo" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
              <input value={editingCustomer?.phone || newPhone} onChange={e=>editingCustomer ? setEditingCustomer({...editingCustomer, phone: e.target.value}) : setNewPhone(e.target.value)} placeholder="WhatsApp (55...)" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={()=>{setShowAddModal(false); setEditingCustomer(null);}} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs" disabled={saving}>Voltar</button>
              <button onClick={handleAdd} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all disabled:opacity-50" disabled={saving}>
                {saving ? 'Gravando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomersView;
