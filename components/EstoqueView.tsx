
import React, { useState, useEffect, useCallback } from 'react';
import { db } from '../services/mockDb';
import { InventoryItem } from '../types';

function genId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 11);
}

const UNITS = ['unidades', 'ml', 'L', 'g', 'kg', 'pares', 'caixas'];
const CATEGORIES = ['Higiene', 'Cabelo', 'Barba', 'Pele', 'Equipamento', 'Limpeza', 'Outros'];

const EstoqueView: React.FC<{ tenantId: string }> = ({ tenantId }) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // New item form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Higiene');
  const [newQty, setNewQty] = useState(0);
  const [newUnit, setNewUnit] = useState('unidades');
  const [newCost, setNewCost] = useState(0);
  const [newMinStock, setNewMinStock] = useState(0);

  // Stock entry modal (add quantity)
  const [entryItem, setEntryItem] = useState<InventoryItem | null>(null);
  const [entryQty, setEntryQty] = useState(1);
  const [entryCost, setEntryCost] = useState(0);

  // Edit modal
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editUnit, setEditUnit] = useState('');
  const [editMinStock, setEditMinStock] = useState(0);

  // Filter
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const inv = await db.getInventory(tenantId);
      setItems(inv);
    } catch (e) {
      console.error('Erro ao carregar estoque:', e);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const resetAddForm = () => {
    setNewName(''); setNewCategory('Higiene'); setNewQty(0);
    setNewUnit('unidades'); setNewCost(0); setNewMinStock(0);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await db.addInventoryItem(tenantId, {
        name: newName.trim(),
        category: newCategory,
        quantity: newQty,
        unit: newUnit,
        purchaseCost: newCost,
        minStock: newMinStock,
      });
      await load();
      setShowAddForm(false);
      resetAddForm();
    } finally { setSaving(false); }
  };

  const handleEntry = async () => {
    if (!entryItem || entryQty <= 0) return;
    setSaving(true);
    try {
      const cost = entryCost || entryItem.purchaseCost;
      await db.addStockEntry(tenantId, entryItem.id, entryQty, cost);
      await db.addExpense({
        tenant_id: tenantId,
        description: `Estoque: ${entryItem.name} (${entryQty} ${entryItem.unit})`,
        amount: entryQty * cost,
        category: 'Estoque',
        date: new Date().toISOString(),
      });
      await load();
      setEntryItem(null);
    } finally { setSaving(false); }
  };

  const handleEdit = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await db.updateInventoryItem(tenantId, editItem.id, {
        name: editName, category: editCategory, unit: editUnit, minStock: editMinStock,
      });
      await load();
      setEditItem(null);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este produto do estoque?')) return;
    await db.deleteInventoryItem(tenantId, id);
    await load();
  };

  const openEdit = (item: InventoryItem) => {
    setEditItem(item);
    setEditName(item.name);
    setEditCategory(item.category || 'Outros');
    setEditUnit(item.unit);
    setEditMinStock(item.minStock || 0);
  };

  const openEntry = (item: InventoryItem) => {
    setEntryItem(item);
    setEntryQty(1);
    setEntryCost(item.purchaseCost);
  };

  const filtered = items.filter(i => {
    if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCategory && i.category !== filterCategory) return false;
    return true;
  });

  const lowStock = items.filter(i => i.minStock && i.quantity <= i.minStock);
  const totalValue = items.reduce((s, i) => s + i.quantity * i.purchaseCost, 0);
  const totalItems = items.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center p-20">
        <div className="w-8 h-8 border-4 border-slate-100 border-t-black rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-black uppercase tracking-tight">Estoque</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Controle de produtos e insumos</p>
        </div>
        <button
          onClick={() => { setShowAddForm(v => !v); }}
          className="bg-orange-500 text-white px-8 py-3 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-100 hover:bg-black transition-all"
        >
          + Novo Produto
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-5">
        <SummaryCard label="Total de Produtos" value={String(totalItems)} icon="📦" />
        <SummaryCard label="Valor em Estoque" value={`R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} icon="💰" />
        <SummaryCard label="Alertas de Estoque" value={String(lowStock.length)} icon="⚠️" warn={lowStock.length > 0} />
      </div>

      {/* Low-stock alerts */}
      {lowStock.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-100 rounded-2xl p-5">
          <p className="text-xs font-black text-amber-700 uppercase tracking-widest mb-3">⚠️ Estoque Baixo</p>
          <div className="flex flex-wrap gap-2">
            {lowStock.map(i => (
              <span key={i.id} className="text-[10px] font-black bg-amber-100 text-amber-800 px-3 py-1 rounded-xl uppercase">
                {i.name} — {i.quantity} {i.unit}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Add form */}
      {showAddForm && (
        <div className="bg-white rounded-3xl border-2 border-orange-100 p-8 space-y-5 animate-fadeIn">
          <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest">Novo Produto</p>
          <div className="grid grid-cols-2 gap-4">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nome do produto"
              className="col-span-2 w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold focus:border-orange-500" />
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Categoria</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Unidade</label>
              <select value={newUnit} onChange={e => setNewUnit(e.target.value)}
                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Qtd. inicial</label>
              <input type="number" min={0} value={newQty} onChange={e => setNewQty(Number(e.target.value))}
                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Custo unitário (R$)</label>
              <input type="number" min={0} step={0.01} value={newCost} onChange={e => setNewCost(Number(e.target.value))}
                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-orange-500" />
            </div>
            <div>
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Alerta mínimo (qtd.)</label>
              <input type="number" min={0} value={newMinStock} onChange={e => setNewMinStock(Number(e.target.value))}
                className="w-full p-3 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-orange-500" />
            </div>
          </div>
          <div className="flex gap-4 pt-2">
            <button onClick={() => { setShowAddForm(false); resetAddForm(); }} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
            <button onClick={handleAdd} disabled={saving || !newName.trim()} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
              {saving ? 'Salvando...' : 'Adicionar Produto'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar produto..."
          className="flex-1 min-w-[180px] p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500" />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
          className="p-3 bg-white border border-slate-200 rounded-2xl text-sm font-semibold outline-none focus:border-orange-500">
          <option value="">Todas categorias</option>
          {CATEGORIES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              {['Produto', 'Categoria', 'Quantidade', 'Custo Unit.', 'Valor Total', 'Ações'].map(h => (
                <th key={h} className="px-5 py-4 text-left text-[9px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-slate-300 font-black uppercase text-xs">
                  Nenhum produto cadastrado
                </td>
              </tr>
            ) : filtered.map(item => {
              const isLow = !!(item.minStock && item.quantity <= item.minStock);
              return (
                <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${isLow ? 'bg-amber-50/40' : ''}`}>
                  <td className="px-5 py-4">
                    <p className="font-black text-sm text-black">{item.name}</p>
                    {isLow && <span className="text-[8px] font-black text-amber-600 uppercase">⚠️ Estoque baixo</span>}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded-lg uppercase">{item.category || '—'}</span>
                  </td>
                  <td className="px-5 py-4">
                    <span className={`font-black text-sm ${isLow ? 'text-amber-600' : 'text-black'}`}>
                      {item.quantity} {item.unit}
                    </span>
                    {item.minStock ? <p className="text-[9px] text-slate-400">min: {item.minStock}</p> : null}
                  </td>
                  <td className="px-5 py-4 font-bold text-sm text-slate-700">
                    R$ {item.purchaseCost.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-4 font-black text-sm text-black">
                    R$ {(item.quantity * item.purchaseCost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEntry(item)}
                        className="px-3 py-1.5 bg-green-50 text-green-700 rounded-xl font-black text-[9px] uppercase hover:bg-green-100 transition-all">
                        + Entrada
                      </button>
                      <button onClick={() => openEdit(item)}
                        className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-black text-[9px] uppercase hover:bg-slate-200 transition-all">
                        Editar
                      </button>
                      <button onClick={() => handleDelete(item.id)}
                        className="px-3 py-1.5 bg-red-50 text-red-500 rounded-xl font-black text-[9px] uppercase hover:bg-red-100 transition-all">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── STOCK ENTRY MODAL ──────────────────────────────────────── */}
      {entryItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-sm p-10 space-y-6 animate-scaleUp border-4 border-black">
            <div>
              <h2 className="text-xl font-black text-black uppercase">Entrada de Estoque</h2>
              <p className="text-xs font-black text-slate-400 mt-1">{entryItem.name}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Qtd. atual: {entryItem.quantity} {entryItem.unit}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Quantidade a adicionar</label>
                <input type="number" min={1} value={entryQty} onChange={e => setEntryQty(Number(e.target.value))}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center text-xl outline-none focus:border-green-400" />
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Custo unitário nesta entrada (R$)</label>
                <input type="number" min={0} step={0.01} value={entryCost} onChange={e => setEntryCost(Number(e.target.value))}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-green-400" />
              </div>
              <div className="bg-slate-50 rounded-2xl p-4">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Custo total desta entrada</p>
                <p className="text-2xl font-black text-black mt-1">R$ {(entryQty * entryCost).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setEntryItem(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
              <button onClick={handleEntry} disabled={saving || entryQty <= 0} className="flex-1 py-3 bg-green-500 text-white rounded-2xl font-black uppercase text-xs hover:bg-green-600 transition-all disabled:opacity-40">
                {saving ? 'Salvando...' : 'Confirmar Entrada'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ─────────────────────────────────────────────── */}
      {editItem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-sm p-10 space-y-6 animate-scaleUp border-4 border-black">
            <h2 className="text-xl font-black text-black uppercase">Editar Produto</h2>
            <div className="space-y-4">
              <input value={editName} onChange={e => setEditName(e.target.value)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500" />
              <select value={editCategory} onChange={e => setEditCategory(e.target.value)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <select value={editUnit} onChange={e => setEditUnit(e.target.value)}
                className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-bold outline-none focus:border-orange-500">
                {UNITS.map(u => <option key={u}>{u}</option>)}
              </select>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Qtd. mínima para alerta</label>
                <input type="number" min={0} value={editMinStock} onChange={e => setEditMinStock(Number(e.target.value))}
                  className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl font-black text-center outline-none focus:border-orange-500" />
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <button onClick={() => setEditItem(null)} className="flex-1 py-3 font-black text-slate-400 uppercase text-xs" disabled={saving}>Cancelar</button>
              <button onClick={handleEdit} disabled={saving || !editName.trim()} className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40">
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryCard = ({ label, value, icon, warn }: { label: string; value: string; icon: string; warn?: boolean }) => (
  <div className={`bg-white rounded-2xl border-2 p-6 ${warn ? 'border-amber-200 bg-amber-50' : 'border-slate-100'}`}>
    <div className="text-2xl mb-3">{icon}</div>
    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
    <p className={`text-2xl font-black ${warn ? 'text-amber-600' : 'text-black'}`}>{value}</p>
  </div>
);

export default EstoqueView;
