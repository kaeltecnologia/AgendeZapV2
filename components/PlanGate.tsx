import React from 'react';
import { FeatureKey, getPlanConfig, cheapestUpgradePlan, PLAN_CONFIGS } from '../config/planConfig';

interface PlanGateProps {
  feature: FeatureKey;
  tenantPlan: string | null | undefined;
  children: React.ReactNode;
}

/**
 * PlanGate — wraps any view/section with a lock overlay when the tenant's
 * plan does not include the requested feature.
 *
 * The underlying content is always rendered (blurred) so the user can see
 * what they're missing. Only interaction is blocked via the overlay.
 */
const PlanGate: React.FC<PlanGateProps> = ({ feature, tenantPlan, children }) => {
  const config = getPlanConfig(tenantPlan);
  const hasAccess = config.permissions[feature];

  // ── Unlocked: render children normally ─────────────────────────────
  if (hasAccess) return <>{children}</>;

  // ── Locked: show blurred preview + upgrade card ─────────────────────
  const current = config;
  const upgrade = cheapestUpgradePlan(feature);

  return (
    <div className="relative min-h-[60vh]">
      {/* Blurred, pointer-events-none background */}
      <div
        className="pointer-events-none select-none"
        style={{ filter: 'blur(4px)', opacity: 0.35 }}
        aria-hidden="true"
      >
        {children}
      </div>

      {/* Lock overlay */}
      <div className="absolute inset-0 flex items-center justify-center z-20 px-4">
        <div className="bg-white rounded-[36px] border-2 border-slate-100 shadow-2xl shadow-slate-200/60 p-10 max-w-md w-full text-center space-y-7 animate-scaleUp">

          {/* Lock icon */}
          <div className="w-20 h-20 rounded-[24px] bg-slate-100 flex items-center justify-center text-4xl mx-auto">
            🔒
          </div>

          {/* Title */}
          <div className="space-y-1">
            <p className="text-xl font-black text-black uppercase tracking-tight">
              Recurso Bloqueado
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Seu plano atual: {current.badge}
            </p>
          </div>

          {/* Upgrade plan card */}
          <div
            className={`rounded-2xl border-2 p-6 text-left space-y-4 ${upgrade.bgClass} ${upgrade.borderClass}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className={`text-base font-black uppercase tracking-tight ${upgrade.textClass}`}>
                {upgrade.emoji} Plano {upgrade.name}
              </p>
              <p className="text-xl font-black text-black shrink-0">
                R${upgrade.price.toFixed(2).replace('.', ',')}
                <span className="text-xs font-bold text-slate-400">/mês</span>
              </p>
            </div>

            <ul className="space-y-1.5">
              {upgrade.features.map(f => (
                <li key={f} className="flex items-center gap-2">
                  <span className={`text-xs font-black ${upgrade.textClass}`}>✓</span>
                  <span className="text-[11px] font-bold text-slate-600">{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* CTA */}
          <div className="space-y-2">
            <p className="text-sm font-black text-black">
              Para ter acesso, assine o{' '}
              <span style={{ color: upgrade.color }} className="font-black">
                {upgrade.badge}
              </span>
            </p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
              Entre em contato com seu administrador para fazer o upgrade
            </p>
          </div>

          {/* Plans comparison chips */}
          <div className="flex items-center justify-center gap-2 pt-1">
            {Object.values(PLAN_CONFIGS).map(p => (
              <div
                key={p.id}
                className={`px-3 py-1.5 rounded-xl border-2 transition-all ${
                  p.id === current.id
                    ? `${p.bgClass} ${p.borderClass}`
                    : 'bg-white border-slate-100'
                }`}
              >
                <p
                  className={`text-[9px] font-black uppercase tracking-widest ${
                    p.id === current.id ? p.textClass : 'text-slate-300'
                  }`}
                >
                  {p.emoji} {p.name}
                </p>
                <p
                  className={`text-[9px] font-bold ${
                    p.id === current.id ? p.textClass : 'text-slate-300'
                  }`}
                >
                  R${p.price.toFixed(2).replace('.', ',')}
                </p>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
};

export default PlanGate;
