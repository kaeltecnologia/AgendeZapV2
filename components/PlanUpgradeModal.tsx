
import React, { useState } from 'react';
import { FeatureKey, getPlanConfig, cheapestUpgradePlan } from '../config/planConfig';
import { db } from '../services/mockDb';

interface Props {
  feature: FeatureKey;
  tenantPlan: string;
  tenantId: string;
  onClose: () => void;
}

const FEATURE_LABELS: Record<FeatureKey, string> = {
  financeiro: 'Financeiro e Estoque',
  relatorios: 'Relatórios básicos',
  relatoriosAvancados: 'Relatórios avançados',
  reativacao: 'Reativação automática',
  disparo: 'Disparador segmentado',
  assistenteAdmin: 'Assistente Admin via IA',
};

const ALL_FEATURES: FeatureKey[] = [
  'financeiro', 'relatorios', 'reativacao', 'disparo', 'relatoriosAvancados', 'assistenteAdmin'
];

const PlanUpgradeModal: React.FC<Props> = ({ feature, tenantPlan, tenantId, onClose }) => {
  const currentConfig = getPlanConfig(tenantPlan);
  const upgradeConfig = cheapestUpgradePlan(feature);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    setSending(true);
    try {
      await db.sendSupportRequest(tenantId, message, tenantPlan, feature);
      setSent(true);
    } catch {
      alert('Erro ao enviar solicitação. Tente novamente.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-[40px] w-full max-w-lg p-10 space-y-7 animate-scaleUp"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-slate-100 rounded-[20px] flex items-center justify-center text-3xl mx-auto">🔒</div>
          <p className="text-xl font-black text-black uppercase tracking-tight">Recurso Bloqueado</p>
          <p className="text-xs font-bold text-slate-500">
            <strong>{FEATURE_LABELS[feature]}</strong> está disponível a partir do{' '}
            <span style={{ color: upgradeConfig.color }} className="font-black">{upgradeConfig.badge}</span>
          </p>
        </div>

        {/* Plan comparison */}
        <div className="grid grid-cols-2 gap-4">

          {/* Current plan */}
          <div className={`rounded-2xl border-2 p-5 ${currentConfig.bgClass} ${currentConfig.borderClass}`}>
            <div className="mb-4">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Seu plano atual</p>
              <p className={`text-sm font-black uppercase ${currentConfig.textClass}`}>{currentConfig.emoji} {currentConfig.name}</p>
              <p className={`text-[10px] font-bold ${currentConfig.textClass}`}>
                R${currentConfig.price.toFixed(2).replace('.', ',')}/mês
              </p>
            </div>
            <div className="space-y-2">
              {ALL_FEATURES.map(f => (
                <div key={f} className="flex items-start gap-1.5">
                  <span className={`text-xs font-black shrink-0 mt-0.5 ${currentConfig.permissions[f] ? currentConfig.textClass : 'text-slate-200'}`}>
                    {currentConfig.permissions[f] ? '✓' : '✗'}
                  </span>
                  <span className={`text-[10px] font-bold leading-tight ${
                    currentConfig.permissions[f] ? 'text-slate-600' : 'text-slate-300'
                  } ${f === feature ? 'font-black' : ''}`}>
                    {FEATURE_LABELS[f]}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Upgrade plan */}
          <div className={`rounded-2xl border-2 p-5 relative ${upgradeConfig.bgClass} ${upgradeConfig.borderClass}`}>
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap">
              <span
                className="text-[8px] font-black px-3 py-1 rounded-full uppercase tracking-widest text-white"
                style={{ backgroundColor: upgradeConfig.color }}
              >
                Recomendado ↑
              </span>
            </div>
            <div className="mb-4">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Fazer upgrade para</p>
              <p className={`text-sm font-black uppercase ${upgradeConfig.textClass}`}>{upgradeConfig.emoji} {upgradeConfig.name}</p>
              <p className={`text-[10px] font-bold ${upgradeConfig.textClass}`}>
                R${upgradeConfig.price.toFixed(2).replace('.', ',')}/mês
              </p>
            </div>
            <div className="space-y-2">
              {ALL_FEATURES.map(f => (
                <div
                  key={f}
                  className={`flex items-start gap-1.5 rounded-lg transition-all ${
                    f === feature ? 'bg-white/70 px-1.5 py-0.5 -mx-1.5' : ''
                  }`}
                >
                  <span className={`text-xs font-black shrink-0 mt-0.5 ${upgradeConfig.permissions[f] ? upgradeConfig.textClass : 'text-slate-200'}`}>
                    {upgradeConfig.permissions[f] ? '✓' : '✗'}
                  </span>
                  <span className={`text-[10px] leading-tight ${
                    upgradeConfig.permissions[f] ? 'text-slate-700' : 'text-slate-300'
                  } ${f === feature ? 'font-black' : 'font-bold'}`}>
                    {FEATURE_LABELS[f]}
                    {f === feature && (
                      <span className={`ml-1 text-[8px] font-black px-1.5 py-0.5 rounded-full ${upgradeConfig.bgClass} ${upgradeConfig.textClass}`}>
                        NOVO
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Difference summary */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">O que você ganha ao fazer upgrade</p>
          <div className="flex flex-wrap gap-2">
            {ALL_FEATURES.filter(f => !currentConfig.permissions[f] && upgradeConfig.permissions[f]).map(f => (
              <span
                key={f}
                className={`text-[9px] font-black px-2.5 py-1 rounded-lg border uppercase ${upgradeConfig.bgClass} ${upgradeConfig.textClass} ${upgradeConfig.borderClass}`}
              >
                ✓ {FEATURE_LABELS[f]}
              </span>
            ))}
          </div>
        </div>

        {/* Support section */}
        {!sent ? (
          <div className="space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">
              Fale com o suporte para fazer o upgrade
            </p>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Deixe uma mensagem para o suporte (opcional)..."
              rows={2}
              className="w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-2xl outline-none font-bold text-sm focus:border-orange-500 resize-none"
            />
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 font-black text-slate-400 uppercase text-xs border-2 border-slate-100 rounded-2xl hover:border-slate-300 transition-all"
              >
                Fechar
              </button>
              <button
                onClick={handleSend}
                disabled={sending}
                className="flex-1 py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all disabled:opacity-40"
              >
                {sending ? 'Enviando...' : '💬 Falar com Suporte →'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center space-y-3 pt-2">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-2xl mx-auto">✓</div>
            <p className="font-black text-black uppercase text-sm">Solicitação Enviada!</p>
            <p className="text-xs font-bold text-slate-400">
              Nossa equipe entrará em contato em breve para realizar o upgrade do seu plano.
            </p>
            <button
              onClick={onClose}
              className="w-full py-3 bg-black text-white rounded-2xl font-black uppercase text-xs hover:bg-orange-500 transition-all"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanUpgradeModal;
