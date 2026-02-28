import React, { useState } from 'react';
import {
  searchGoogleMaps,
  SerperPlace,
  ProspectCampaign,
  saveCampaigns,
  loadSerperKey,
  saveSerperKey,
} from '../services/serperService';

interface Props {
  campaigns: ProspectCampaign[];
  onCampaignsChange: (c: ProspectCampaign[]) => void;
  onGoToDisparo: (campaignId: string) => void;
}

const AdminProspeccaoPanel: React.FC<Props> = ({ campaigns, onCampaignsChange, onGoToDisparo }) => {
  const [serperKey, setSerperKey] = useState(() => loadSerperKey());
  const [showKey, setShowKey] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [city, setCity] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<SerperPlace[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [campaignName, setCampaignName] = useState('');
  const [showResults, setShowResults] = useState(false);

  const handleSearch = async () => {
    if (!serperKey.trim()) { setSearchError('Informe a chave da API Serper.dev'); return; }
    if (!keyword.trim()) { setSearchError('Informe a palavra-chave'); return; }
    if (!city.trim()) { setSearchError('Informe a cidade'); return; }

    setSearching(true);
    setSearchError('');
    setResults([]);
    setSelectedIds(new Set());
    setShowResults(false);

    try {
      const places = await searchGoogleMaps(keyword, city, serperKey);
      setResults(places);
      setShowResults(true);
      // Auto-select todos com telefone
      setSelectedIds(new Set(places.filter(p => p.phone).map(p => p.id)));
    } catch (e: any) {
      setSearchError(e.message || 'Erro na busca. Verifique a chave da API.');
    } finally {
      setSearching(false);
    }
  };

  const togglePlace = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const withPhone = results.filter(p => p.phone);

  const createCampaign = () => {
    const name = campaignName.trim() || `${keyword} — ${city}`;
    const selected = results.filter(p => selectedIds.has(p.id) && p.phone);
    if (selected.length === 0) { alert('Selecione pelo menos um contato com telefone.'); return; }

    const campaign: ProspectCampaign = {
      id: `camp-${Date.now()}`,
      name,
      keyword,
      city,
      contacts: selected.map(p => ({ id: p.id, name: p.name, phone: p.phone, address: p.address })),
      createdAt: new Date().toISOString(),
    };

    const updated = [campaign, ...campaigns];
    onCampaignsChange(updated);
    saveCampaigns(updated);

    // Reset search
    setShowResults(false);
    setResults([]);
    setCampaignName('');
    setSelectedIds(new Set());

    onGoToDisparo(campaign.id);
  };

  const deleteCampaign = (id: string) => {
    if (!confirm('Excluir esta campanha?')) return;
    const updated = campaigns.filter(c => c.id !== id);
    onCampaignsChange(updated);
    saveCampaigns(updated);
  };

  const selectedWithPhone = [...selectedIds].filter(id => results.find(p => p.id === id)?.phone).length;

  return (
    <div className="space-y-8 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-black uppercase tracking-tight">Prospecção</h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
          Extraia contatos do Google Maps e crie campanhas de disparo
        </p>
      </div>

      {/* API Key */}
      <div className="bg-white border-2 border-slate-100 rounded-[28px] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-black uppercase tracking-widest">🔑 Chave API Serper.dev</h2>
          <a
            href="https://serper.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-black text-orange-500 uppercase tracking-widest hover:underline"
          >
            Obter chave gratuita ↗
          </a>
        </div>
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={serperKey}
              onChange={e => { setSerperKey(e.target.value); saveSerperKey(e.target.value); }}
              placeholder="Cole sua chave da API aqui..."
              className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl text-xs font-mono outline-none border-2 border-transparent focus:border-orange-500 transition-all pr-12"
            />
            <button
              onClick={() => setShowKey(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-orange-500 text-[10px] font-black uppercase transition-all"
            >
              {showKey ? 'Ocultar' : 'Ver'}
            </button>
          </div>
          {serperKey && (
            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Chave salva" />
          )}
        </div>
        <p className="text-[9px] font-bold text-slate-300">
          A chave é salva localmente no navegador. Serper.dev oferece 2.500 buscas gratuitas/mês.
        </p>
      </div>

      {/* Search */}
      <div className="bg-white border-2 border-slate-100 rounded-[28px] p-6 space-y-5">
        <h2 className="text-sm font-black text-black uppercase tracking-widest">🗺️ Buscar no Google Maps</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Palavra-chave / Segmento</label>
            <input
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="ex: Barbearia, Salão de Beleza, Clínica..."
              className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-sm font-semibold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cidade</label>
            <input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="ex: São Paulo, Curitiba, Rio de Janeiro..."
              className="w-full px-4 py-3 bg-slate-50 rounded-2xl text-sm font-semibold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
          </div>
        </div>

        {searchError && (
          <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
            <p className="text-[10px] font-black text-red-500 uppercase">{searchError}</p>
          </div>
        )}

        <button
          onClick={handleSearch}
          disabled={searching || !keyword.trim() || !city.trim() || !serperKey.trim()}
          className="w-full py-4 bg-black text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-orange-500 transition-all disabled:opacity-40"
        >
          {searching ? '🔍 Buscando no Google Maps...' : '🔍 Buscar Contatos'}
        </button>
      </div>

      {/* Results */}
      {searching && (
        <div className="bg-slate-50 rounded-[28px] p-12 text-center">
          <p className="text-sm font-black text-slate-400 uppercase animate-pulse">Buscando estabelecimentos...</p>
          <p className="text-[10px] font-bold text-slate-300 mt-1">Consultando Google Maps via Serper.dev</p>
        </div>
      )}

      {showResults && !searching && results.length === 0 && (
        <div className="bg-slate-50 rounded-[28px] p-12 text-center">
          <p className="text-sm font-black text-slate-300 uppercase">Nenhum resultado encontrado</p>
          <p className="text-[10px] font-bold text-slate-300 mt-1">Tente outra palavra-chave ou cidade</p>
        </div>
      )}

      {showResults && results.length > 0 && (
        <div className="bg-white border-2 border-slate-100 rounded-[28px] p-6 space-y-5">
          {/* Results header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-sm font-black text-black uppercase tracking-widest">📋 Resultados</h2>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                {results.length} estabelecimentos ·{' '}
                <span className="text-green-600">{withPhone.length} com telefone</span> ·{' '}
                <span className="text-slate-300">{results.length - withPhone.length} sem telefone</span>
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setSelectedIds(new Set(withPhone.map(p => p.id)))}
                className="text-[9px] font-black text-orange-500 uppercase tracking-widest hover:underline"
              >
                Selec. todos com tel.
              </button>
              <span className="text-slate-200">|</span>
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-[9px] font-black text-slate-400 uppercase tracking-widest hover:underline"
              >
                Desmarcar
              </button>
              <span className="text-[9px] font-black text-slate-400">
                {selectedWithPhone} selecionados
              </span>
            </div>
          </div>

          {/* Place list */}
          <div className="max-h-[420px] overflow-y-auto custom-scrollbar space-y-1.5">
            {results.map(place => (
              <label
                key={place.id}
                className={`flex items-start gap-3 px-4 py-3 rounded-2xl transition-all ${
                  !place.phone
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-slate-50 cursor-pointer'
                } ${selectedIds.has(place.id) ? 'bg-orange-50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(place.id)}
                  onChange={() => place.phone && togglePlace(place.id)}
                  disabled={!place.phone}
                  className="mt-1 w-4 h-4 accent-orange-500 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-black text-black leading-tight">{place.name}</p>
                    {place.rating !== undefined && (
                      <span className="text-[9px] font-bold text-amber-500 shrink-0 flex items-center gap-0.5">
                        ⭐ {place.rating}
                        {place.reviewsCount ? <span className="text-slate-300"> ({place.reviewsCount})</span> : null}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 truncate mt-0.5">{place.address}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {place.phone ? (
                      <span className="text-[10px] font-black text-green-600">📱 {place.phone}</span>
                    ) : (
                      <span className="text-[10px] font-black text-slate-300">Sem telefone</span>
                    )}
                    {place.category && (
                      <span className="text-[9px] font-bold text-slate-300 uppercase">{place.category}</span>
                    )}
                    {place.website && (
                      <a
                        href={place.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[9px] font-bold text-blue-400 hover:underline"
                      >
                        🔗 Site
                      </a>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* Create campaign */}
          <div className="border-t border-slate-100 pt-5 space-y-3">
            <div className="space-y-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Nome da Campanha</label>
              <input
                value={campaignName}
                onChange={e => setCampaignName(e.target.value)}
                placeholder={`${keyword} — ${city}`}
                className="w-full px-4 py-2.5 bg-slate-50 rounded-2xl text-sm font-semibold outline-none border-2 border-transparent focus:border-orange-500 transition-all"
              />
            </div>
            <button
              onClick={createCampaign}
              disabled={selectedWithPhone === 0}
              className="w-full py-4 bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-orange-200 hover:bg-orange-600 hover:scale-[1.02] transition-all disabled:opacity-40 disabled:scale-100 disabled:shadow-none"
            >
              🚀 Criar Campanha com {selectedWithPhone} Contato{selectedWithPhone !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Saved Campaigns */}
      {campaigns.length > 0 && (
        <div className="bg-white border-2 border-slate-100 rounded-[28px] p-6 space-y-4">
          <h2 className="text-sm font-black text-black uppercase tracking-widest">
            📁 Campanhas Salvas
            <span className="ml-2 text-[10px] font-bold text-slate-300">({campaigns.length})</span>
          </h2>
          <div className="space-y-3">
            {campaigns.map(camp => (
              <div
                key={camp.id}
                className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all"
              >
                <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center text-lg flex-shrink-0">
                  📋
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-black">{camp.name}</p>
                  <p className="text-[10px] font-bold text-slate-400">
                    {camp.contacts.length} contatos · {camp.keyword} em {camp.city} · {new Date(camp.createdAt).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    onClick={() => onGoToDisparo(camp.id)}
                    className="px-4 py-2 bg-orange-500 text-white rounded-xl font-black text-[9px] uppercase tracking-widest hover:bg-orange-600 transition-all"
                  >
                    🚀 Disparar
                  </button>
                  <button
                    onClick={() => deleteCampaign(camp.id)}
                    className="px-3 py-2 bg-red-50 text-red-500 rounded-xl font-black text-[9px] hover:bg-red-100 transition-all"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {campaigns.length === 0 && !showResults && (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[28px] p-12 text-center">
          <div className="text-5xl mb-4">🗺️</div>
          <p className="text-sm font-black text-slate-300 uppercase">Nenhuma campanha criada</p>
          <p className="text-[10px] font-bold text-slate-300 mt-1">Busque estabelecimentos acima e crie sua primeira campanha</p>
        </div>
      )}
    </div>
  );
};

export default AdminProspeccaoPanel;
