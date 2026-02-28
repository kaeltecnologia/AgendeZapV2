/**
 * usageTracker.ts
 *
 * Rastreia o consumo de tokens de IA por tenant.
 * Salva em `ai_usage_logs` no Supabase (tabela criada via SQL tab).
 * Falha silenciosa — nunca interrompe o fluxo principal.
 */

import { supabase } from './supabase';

// ─── Preços por modelo (por token) ───────────────────────────────────────────
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':      { input: 0.150 / 1_000_000, output: 0.600 / 1_000_000 },
  'gpt-4o':           { input: 2.50  / 1_000_000, output: 10.00 / 1_000_000 },
  'gemini-2.0-flash': { input: 0,                 output: 0 },
  'gemini-1.5-flash': { input: 0,                 output: 0 },
  'gemini-1.5-pro':   { input: 0,                 output: 0 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o-mini'];
  return inputTokens * p.input + outputTokens * p.output;
}

/** Estimativa de tokens quando a API não retorna contagem (≈4 chars/token em PT-BR). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface UsageLogEntry {
  tenant_id: string;
  phone_number?: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
  success?: boolean;
}

/**
 * Loga o uso de tokens de uma chamada de IA.
 * Erros são capturados silenciosamente — nunca propaga exceções.
 */
export async function logAIUsage(entry: UsageLogEntry): Promise<void> {
  try {
    const total = entry.input_tokens + entry.output_tokens;
    const cost  = calculateCost(entry.model, entry.input_tokens, entry.output_tokens);

    await supabase.from('ai_usage_logs').insert({
      tenant_id:         entry.tenant_id,
      phone_number:      entry.phone_number ?? null,
      input_tokens:      entry.input_tokens,
      output_tokens:     entry.output_tokens,
      total_tokens:      total,
      model:             entry.model,
      estimated_cost_usd: cost,
      success:           entry.success !== false,
    });
  } catch {
    // Tabela pode não existir ainda — falha silenciosa
  }
}

// ─── Leitura de estatísticas para o painel super admin ───────────────────────

export interface TenantUsageStat {
  tenant_id: string;
  tenant_name: string;
  nicho: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  calls: number;
  last_activity: string | null;
}

export interface UsageSummary {
  total_tokens: number;
  total_cost_usd: number;
  total_calls: number;
  by_tenant: TenantUsageStat[];
}

function startOfPeriod(period: 'today' | 'week' | 'month'): string {
  const d = new Date();
  if (period === 'today') { d.setHours(0, 0, 0, 0); }
  else if (period === 'week') { d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); }
  else { d.setMonth(d.getMonth() - 1); d.setHours(0, 0, 0, 0); }
  return d.toISOString();
}

export async function fetchUsageStats(period: 'today' | 'week' | 'month'): Promise<UsageSummary> {
  const empty: UsageSummary = { total_tokens: 0, total_cost_usd: 0, total_calls: 0, by_tenant: [] };
  try {
    const since = startOfPeriod(period);
    const { data: logs, error } = await supabase
      .from('ai_usage_logs')
      .select('tenant_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error || !logs) return empty;

    // Fetch tenant names
    const { data: tenants } = await supabase.from('tenants').select('id, nome, nicho');
    const tenantMap: Record<string, { name: string; nicho: string }> = {};
    (tenants || []).forEach((t: any) => {
      tenantMap[t.id] = { name: t.nome || t.name || '—', nicho: t.nicho || 'Barbearia' };
    });

    const byTenant: Record<string, TenantUsageStat> = {};
    let totalTokens = 0;
    let totalCost = 0;

    for (const log of logs) {
      const tid = log.tenant_id;
      if (!byTenant[tid]) {
        byTenant[tid] = {
          tenant_id: tid,
          tenant_name: tenantMap[tid]?.name ?? tid.slice(0, 8),
          nicho: tenantMap[tid]?.nicho ?? 'Barbearia',
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          estimated_cost_usd: 0,
          calls: 0,
          last_activity: null,
        };
      }
      const row = byTenant[tid];
      row.input_tokens      += log.input_tokens ?? 0;
      row.output_tokens     += log.output_tokens ?? 0;
      row.total_tokens      += log.total_tokens ?? 0;
      row.estimated_cost_usd += log.estimated_cost_usd ?? 0;
      row.calls             += 1;
      if (!row.last_activity || log.created_at > row.last_activity) {
        row.last_activity = log.created_at;
      }
      totalTokens += log.total_tokens ?? 0;
      totalCost   += log.estimated_cost_usd ?? 0;
    }

    const byTenantArr = Object.values(byTenant).sort((a, b) => b.total_tokens - a.total_tokens);

    return {
      total_tokens:   totalTokens,
      total_cost_usd: totalCost,
      total_calls:    logs.length,
      by_tenant:      byTenantArr,
    };
  } catch {
    return empty;
  }
}
