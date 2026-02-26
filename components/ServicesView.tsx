
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { Service } from '../types';

const ServicesView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{show: boolean, data: Partial<Service> | null}>({show: false, data: null});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await db.getServices(tenantId);
      setServices(data || []);
    } catch (error) {
      console.error("Erro ao carregar serviços:", error);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!modal.data?.name || !modal.data?.price) return;
    
    try {
      if (modal.data.id) {
        await db.updateService(modal.data.id, modal.data);
      } else {
        await db.addService({
          tenant_id: tenantId,
          name: modal.data.name,
          price: modal.data.price,
          durationMinutes: modal.data.durationMinutes || 30,
          active: true
        });
      }
      await loadData();
      setModal({show: false, data: null});
    } catch (error) {
      alert("Erro ao salvar serviço.");
    }
  };

  if (loading) return (
    <div className="p-20 text-center">
      <div className="w-12 h-12 border-4 border-slate-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4"></div>
      <p className="font-black text-slate-400 uppercase tracking-widest text-[10px]">Sincronizando Catálogo...</p>
    </div>
  );

  return (
    <div className="space-y-10 animate-fadeIn">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Catálogo de Serviços</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Preços e tempos configurados</p>
        </div>
        <button onClick={() => setModal({show: true, data: { durationMinutes: 30, active: true }})} className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:scale-105 transition-all">
          + Novo Serviço
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {services.length === 0 ? (
          <div className="col-span-full py-24 text-center border-4 border-dashed border-slate-100 rounded-[50px] bg-slate-50/30">
             <span className="text-4xl mb-4 block opacity-20">✂️</span>
             <p className="text-slate-300 font-black uppercase tracking-[0.2em] italic text-xs">Nenhum serviço disponível no momento.</p>
          </div>
        ) : (
          services.map((svc) => (
            <div key={svc.id} className="bg-white p-8 rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 relative group hover:border-black transition-all">
              <div className="absolute top-8 right-8 flex space-x-2">
                <button onClick={() => setModal({show: true, data: svc})} className="bg-slate-50 text-black px-3 py-2 rounded-xl font-black hover:bg-orange-500 hover:text-white transition-all text-[9px] uppercase tracking-widest">EDITAR</button>
              </div>
              
              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-2xl mb-6 group-hover:bg-orange-50 transition-all shadow-sm">✂️</div>
              
              <h3 className="text-xl font-black text-black mb-1 pr-16 leading-tight uppercase tracking-tight">{svc.name}</h3>
              <span className={`text-[9px] font-black px-3 py-1 rounded-full uppercase tracking-[0.2em] inline-block mb-8 ${svc.active ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                {svc.active ? 'Ativo' : 'Pausado'}
              </span>

              <div className="flex items-end justify-between pt-6 border-t-2 border-slate-50">
                <div>
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Preço Final</p>
                  <p className="text-2xl font-black text-black tracking-tighter">R$ {Number(svc.price).toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-1">Duração</p>
                  <p className="text-sm font-black text-black">{svc.durationMinutes} MIN</p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {modal.show && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] overflow-y-auto">
          <div className="flex justify-center items-start min-h-full p-6 pt-10 pb-10">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp border-4 border-black">
            <h2 className="text-2xl font-black text-black uppercase tracking-tight italic">{modal.data?.id ? 'Editar Serviço' : 'Novo Serviço'}</h2>
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Nome do Procedimento</label>
                <input value={modal.data?.name || ''} onChange={e=>setModal({...modal, data: {...modal.data, name: e.target.value}})} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500" />
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Preço (R$)</label>
                  <input type="number" value={modal.data?.price || ''} onChange={e=>setModal({...modal, data: {...modal.data, price: Number(e.target.value)}})} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-lg text-orange-600" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-4">Tempo (Min)</label>
                  <input type="number" value={modal.data?.durationMinutes || ''} onChange={e=>setModal({...modal, data: {...modal.data, durationMinutes: Number(e.target.value)}})} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-lg" />
                </div>
              </div>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={()=>setModal({show: false, data: null})} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest">Voltar</button>
              <button onClick={handleSave} className="flex-1 py-4 bg-black text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-500 transition-all shadow-xl">Confirmar</button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServicesView;
