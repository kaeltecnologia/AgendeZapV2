/**
 * serperService.ts
 * Prospecção de contatos via Google Maps usando Serper.dev.
 */

export interface SerperPlace {
  id: string;
  name: string;
  address: string;
  phone: string;
  website?: string;
  rating?: number;
  reviewsCount?: number;
  category?: string;
}

export interface ProspectContact {
  id: string;
  name: string;
  phone: string;
  address: string;
}

export interface ProspectCampaign {
  id: string;
  name: string;
  keyword: string;
  city: string;
  contacts: ProspectContact[];
  createdAt: string;
}

const CAMPAIGNS_KEY = 'agz_prospect_campaigns';
const SERPER_KEY_STORAGE = 'agz_serper_key';
const ADMIN_INSTANCE_KEY = 'agz_admin_instance';

export function loadCampaigns(): ProspectCampaign[] {
  try { return JSON.parse(localStorage.getItem(CAMPAIGNS_KEY) || '[]'); } catch { return []; }
}

export function saveCampaigns(campaigns: ProspectCampaign[]) {
  localStorage.setItem(CAMPAIGNS_KEY, JSON.stringify(campaigns));
}

export function loadSerperKey(): string {
  return localStorage.getItem(SERPER_KEY_STORAGE) || '';
}

export function saveSerperKey(key: string) {
  localStorage.setItem(SERPER_KEY_STORAGE, key);
}

export function loadAdminInstance(): string {
  return localStorage.getItem(ADMIN_INSTANCE_KEY) || 'agz_superadmin';
}

export function saveAdminInstance(name: string) {
  localStorage.setItem(ADMIN_INSTANCE_KEY, name);
}

export async function searchGoogleMaps(
  keyword: string,
  city: string,
  apiKey: string,
): Promise<SerperPlace[]> {
  const q = `${keyword.trim()} em ${city.trim()}`;
  const res = await fetch('https://google.serper.dev/maps', {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'br', hl: 'pt', num: 20 }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new Error(err.message || `Serper API — erro ${res.status}`);
  }

  const data = await res.json();
  const places: any[] = data.places || [];

  return places
    .map((p, i) => ({
      id: p.placeId || `serper-${i}`,
      name: p.title || p.name || '',
      address: p.address || '',
      phone: (p.phoneNumber || p.phone || '').replace(/\D/g, ''),
      website: p.website || undefined,
      rating: typeof p.rating === 'number' ? p.rating : undefined,
      reviewsCount: p.ratingCount ?? p.reviews ?? undefined,
      category: p.type || p.category || undefined,
    }))
    .filter(p => p.name);
}
