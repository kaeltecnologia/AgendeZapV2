
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { PaymentMethod, AppointmentStatus, Professional, Expense, Appointment } from '../types';

const FinancialView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [period, setPeriod] = useState(30);
  const [selectedProfId, setSelectedProfId] = useState<string>('');
  const [showExpModal, setShowExpModal] = useState(false);

  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState(0);
  const [expCategory, setExpCategory] = useState<'COMPANY' | 'PROFESSIONAL'>('COMPANY');
  const [expProfId, setExpProfId] = useState('');
  const [expPaymentMethod, setExpPaymentMethod] = useState<PaymentMethod>(PaymentMethod.MONEY);

  const [professionals, setProfessionals] = useState<Professional[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [expensesList, setExpensesList] = useState<Expense[]>([]);
  const [revenuesList, setRevenuesList] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [pros, summ, exps, apps] = await Promise.all([
      db.getProfessionals(tenantId),
      db.getFinancialSummary(tenantId, period, selectedProfId),
      db.getExpenses(tenantId, period, selectedProfId),
      db.getAppointments(tenantId)
    ]);
    
    setProfessionals(pros);
    setSummary(summ);
    setExpensesList(exps);
    setRevenuesList(apps.filter(a => 
      a.status === AppointmentStatus.FINISHED && 
      (!selectedProfId || a.professional_id === selectedProfId)
    ));
    setLoading(false);
  }, [tenantId, period, selectedProfId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddExpense = async () => {
    if (!expDesc || expAmount <= 0) return;
    await db.addExpense({
      tenant_id: tenantId, description: expDesc, amount: expAmount,
      category: expCategory, professional_id: expCategory === 'PROFESSIONAL' ? expProfId : undefined,
      date: new Date().toISOString(), paymentMethod: expPaymentMethod
    });
    setExpDesc(''); setExpAmount(0); setExpCategory('COMPANY'); setExpProfId(''); setExpPaymentMethod(PaymentMethod.MONEY);
    setShowExpModal(false);
    loadData();
  };

  if (loading || !summary) return <div className="p-20 text-center font-black animate-pulse">CARREGANDO FINANCEIRO...</div>;

  return (
    <div className="space-y-10 animate-fadeIn">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Fluxo de Caixa</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Gestão de entradas e saídas</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <select 
            value={selectedProfId} 
            onChange={e => setSelectedProfId(e.target.value)}
            className="p-3 bg-white border-2 border-slate-100 rounded-xl text-[10px] font-black uppercase outline-none focus:border-black"
          >
            <option value="">Consolidado</option>
            {professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex bg-slate-100 p-1 rounded-xl">
            {[7, 30, 90].map(d => (
              <button key={d} onClick={() => setPeriod(d)} className={`px-4 py-2 text-[10px] font-black uppercase rounded-lg ${period === d ? 'bg-black text-white' : 'text-slate-400'}`}>{d}D</button>
            ))}
          </div>
          <button onClick={() => setShowExpModal(true)} className="bg-black text-white px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-xl hover:bg-orange-500 transition-all">
            - Registrar Despesa
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
        <FinCard title="Receita Bruta" val={`R$ ${summary.totalRevenue.toLocaleString()}`} icon="📈" color="text-orange-500" />
        <FinCard title="Custo Operacional" val={`R$ ${summary.totalExpenses.toLocaleString()}`} icon="📉" color="text-black" />
        <FinCard title="Lucro Líquido" val={`R$ ${(summary.totalRevenue - summary.totalExpenses).toLocaleString()}`} icon="💹" color="text-orange-500" highlight={true} />
        <FinCard title="Em Dinheiro" val={`R$ ${summary[PaymentMethod.MONEY].toLocaleString()}`} icon="💵" />
        <FinCard title="Via PIX" val={`R$ ${summary[PaymentMethod.PIX].toLocaleString()}`} icon="📱" />
        <FinCard title="Cartões" val={`R$ ${(summary[PaymentMethod.DEBIT] + summary[PaymentMethod.CREDIT]).toLocaleString()}`} icon="💳" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden h-[550px] flex flex-col">
          <div className="p-8 border-b-2 border-slate-50 flex justify-between items-center bg-white sticky top-0 z-10">
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Entradas (Vendas)</h3>
            <span className="text-[10px] font-black text-orange-500 bg-orange-50 px-3 py-1.5 rounded-full uppercase tracking-widest">Receitas</span>
          </div>
          <div className="flex-1 overflow-y-auto">
             <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                <tr><th className="px-8 py-4 text-left">DESCRIÇÃO</th><th className="px-8 py-4 text-right">VALOR</th></tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-50">
                {revenuesList.map(a => (
                  <tr key={a.id} className="hover:bg-slate-100 transition-colors">
                    <td className="px-8 py-6">
                      <p className="font-black text-black leading-tight">Atendimento {professionals.find(p=>p.id===a.professional_id)?.name}</p>
                      <p className="text-[9px] font-bold text-slate-400 tracking-widest uppercase mt-1">📅 {new Date(a.startTime).toLocaleDateString('pt-BR')} | {a.paymentMethod}</p>
                    </td>
                    <td className="px-8 py-6 text-right font-black text-orange-500 text-lg">R$ {a.amountPaid?.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-[40px] border-2 border-slate-100 shadow-xl shadow-slate-100/50 overflow-hidden h-[550px] flex flex-col">
           <div className="p-8 border-b-2 border-slate-50 flex justify-between items-center bg-white sticky top-0 z-10">
            <h3 className="font-black text-black uppercase tracking-widest text-sm">Saídas (Custos)</h3>
            <span className="text-[10px] font-black text-black bg-slate-100 px-3 py-1.5 rounded-full uppercase tracking-widest">Despesas</span>
          </div>
          <div className="flex-1 overflow-y-auto">
             <table className="w-full text-sm">
              <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                <tr><th className="px-8 py-4 text-left">DESCRIÇÃO</th><th className="px-8 py-4 text-right">VALOR</th></tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-50">
                {expensesList.map(e => (
                  <tr key={e.id} className="hover:bg-slate-100 transition-colors">
                    <td className="px-8 py-6">
                      <p className="font-black text-black leading-tight">{e.description}</p>
                      <p className="text-[9px] font-bold text-slate-400 tracking-widest uppercase mt-1">
                        {e.category === 'COMPANY' ? '🏢 Unidade' : `👤 Prof: ${professionals.find(p=>p.id===e.professional_id)?.name}`}
                        {e.paymentMethod && <span className="ml-2 text-slate-300">·</span>}
                        {e.paymentMethod && <span className="ml-2">{e.paymentMethod === 'DINHEIRO' ? '💵' : e.paymentMethod === 'PIX' ? '📱' : '💳'} {e.paymentMethod}</span>}
                      </p>
                    </td>
                    <td className="px-8 py-6 text-right font-black text-black text-lg">R$ {e.amount.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showExpModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-md p-12 space-y-8 animate-scaleUp">
            <h2 className="text-2xl font-black text-black uppercase">Registrar Saída</h2>
            <div className="space-y-6">
              <input value={expDesc} onChange={e=>setExpDesc(e.target.value)} placeholder="O que foi pago?" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold" />
              <input type="number" value={expAmount} onChange={e=>setExpAmount(Number(e.target.value))} placeholder="0,00" className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-black text-xl" />
              <div className="flex gap-4">
                <button onClick={()=>setExpCategory('COMPANY')} className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest ${expCategory === 'COMPANY' ? 'bg-black text-white' : 'bg-slate-50 text-slate-400'}`}>Unidade</button>
                <button onClick={()=>setExpCategory('PROFESSIONAL')} className={`flex-1 py-4 rounded-2xl font-black text-[10px] uppercase tracking-widest ${expCategory === 'PROFESSIONAL' ? 'bg-black text-white' : 'bg-slate-50 text-slate-400'}`}>Profissional</button>
              </div>
              {expCategory === 'PROFESSIONAL' && (
                <select value={expProfId} onChange={e=>setExpProfId(e.target.value)} className="w-full p-5 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold">
                  <option value="">Qual Profissional?</option>
                  {professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Método de Pagamento</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { val: PaymentMethod.MONEY, icon: '💵', label: 'Dinheiro' },
                    { val: PaymentMethod.PIX,   icon: '📱', label: 'PIX' },
                    { val: PaymentMethod.DEBIT, icon: '💳', label: 'Débito' },
                    { val: PaymentMethod.CREDIT,icon: '💳', label: 'Crédito' },
                  ] as const).map(({ val, icon, label }) => (
                    <button key={val} type="button" onClick={() => setExpPaymentMethod(val)}
                      className={`py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest border-2 transition-all ${expPaymentMethod === val ? 'bg-black text-white border-black' : 'bg-slate-50 text-slate-400 border-slate-100 hover:border-slate-400'}`}>
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={()=>setShowExpModal(false)} className="flex-1 py-4 font-black text-slate-400 uppercase text-xs tracking-widest">Fechar</button>
              <button onClick={handleAddExpense} className="flex-1 py-4 bg-orange-500 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-orange-100">Lançar Agora</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FinCard = ({ title, val, icon, color, highlight }: any) => (
  <div className={`bg-white p-6 rounded-[32px] border-2 shadow-lg transition-all ${highlight ? 'border-orange-500 scale-105 shadow-orange-100/50' : 'border-slate-100 shadow-slate-100/50 hover:border-black'}`}>
    <div className="text-2xl mb-4">{icon}</div>
    <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</h4>
    <p className={`text-xl font-black ${color || 'text-black'}`}>{val}</p>
  </div>
);

export default FinancialView;
