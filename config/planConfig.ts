/**
 * planConfig.ts
 * Definição dos planos de assinatura do AgendeZap.
 * START | PROFISSIONAL | ELITE
 */

export type PlanId = 'START' | 'PROFISSIONAL' | 'ELITE';

export type FeatureKey =
  | 'financeiro'        // Financeiro completo + Estoque
  | 'relatorios'        // Relatórios básicos
  | 'relatoriosAvancados' // Relatórios avançados de crescimento
  | 'reativacao'        // Reativação automática de clientes
  | 'disparo'           // Disparador massivo segmentado
  | 'assistenteAdmin';  // Assistente administrativo via WhatsApp (Elite)

export interface PlanConfig {
  id: PlanId;
  name: string;
  price: number;
  additionalProfessionalPrice?: number;
  maxProfessionals: number; // 9999 = ilimitado
  color: string;           // hex
  bgClass: string;         // tailwind bg
  textClass: string;       // tailwind text
  borderClass: string;     // tailwind border
  emoji: string;
  badge: string;
  features: string[];
  notIncluded: string[];
  permissions: Record<FeatureKey, boolean>;
}

export const PLAN_CONFIGS: Record<PlanId, PlanConfig> = {

  // ─── START ─────────────────────────────────────────────────────────
  START: {
    id: 'START',
    name: 'Start',
    price: 39.90,
    additionalProfessionalPrice: 29.90,
    maxProfessionals: 1,
    color: '#16a34a',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
    borderClass: 'border-green-200',
    emoji: '🟢',
    badge: '🟢 Start',
    features: [
      'IA de agendamento',
      'Confirmação automática',
      '1 profissional incluído',
      'Lembretes automáticos',
      'Agenda inteligente',
      '+R$29,90 por profissional adicional',
    ],
    notIncluded: [
      'Financeiro e Estoque',
      'Disparador de mensagens',
      'Reativação automática',
      'Assistente administrativo',
    ],
    permissions: {
      financeiro: false,
      relatorios: false,
      relatoriosAvancados: false,
      reativacao: false,
      disparo: false,
      assistenteAdmin: false,
    },
  },

  // ─── PROFISSIONAL ───────────────────────────────────────────────────
  PROFISSIONAL: {
    id: 'PROFISSIONAL',
    name: 'Profissional',
    price: 89.90,
    maxProfessionals: 3,
    color: '#2563eb',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-200',
    emoji: '🔵',
    badge: '🔵 Profissional',
    features: [
      'Tudo do Start',
      'Até 3 profissionais',
      'Financeiro completo',
      'Estoque',
      'Relatórios',
      'Reativação automática',
      'Disparador segmentado',
    ],
    notIncluded: [
      'Assistente administrativo via WhatsApp',
      'Relatórios avançados de crescimento',
    ],
    permissions: {
      financeiro: true,
      relatorios: true,
      relatoriosAvancados: false,
      reativacao: true,
      disparo: true,
      assistenteAdmin: false,
    },
  },

  // ─── ELITE ─────────────────────────────────────────────────────────
  ELITE: {
    id: 'ELITE',
    name: 'Elite',
    price: 149.90,
    maxProfessionals: 9999,
    color: '#7c3aed',
    bgClass: 'bg-purple-50',
    textClass: 'text-purple-700',
    borderClass: 'border-purple-200',
    emoji: '🟣',
    badge: '🟣 Elite',
    features: [
      'Tudo do Profissional',
      'Profissionais ilimitados',
      'Assistente administrativo via WhatsApp',
      'Relatórios avançados de crescimento',
      'Prioridade no suporte',
    ],
    notIncluded: [],
    permissions: {
      financeiro: true,
      relatorios: true,
      relatoriosAvancados: true,
      reativacao: true,
      disparo: true,
      assistenteAdmin: true,
    },
  },
};

/** Resolve plan config — unknown/legacy values fallback to START. */
export function getPlanConfig(planId?: string | null): PlanConfig {
  if (planId === 'PROFISSIONAL') return PLAN_CONFIGS.PROFISSIONAL;
  if (planId === 'ELITE') return PLAN_CONFIGS.ELITE;
  return PLAN_CONFIGS.START;
}

/** Check if a given plan has access to a feature. */
export function hasFeature(planId: string | null | undefined, feature: FeatureKey): boolean {
  return getPlanConfig(planId).permissions[feature];
}

/**
 * Returns the cheapest plan that includes the given feature.
 * Used in upgrade prompts.
 */
export function cheapestUpgradePlan(feature: FeatureKey): PlanConfig {
  const order: PlanId[] = ['START', 'PROFISSIONAL', 'ELITE'];
  for (const id of order) {
    if (PLAN_CONFIGS[id].permissions[feature]) return PLAN_CONFIGS[id];
  }
  return PLAN_CONFIGS.ELITE;
}
