
import { createClient } from '@supabase/supabase-js';

/**
 * AgendeZap - Configuração do Supabase
 * URL corrigida conforme credenciais fornecidas pelo usuário.
 */

const projectUrl = 'https://nmariiphjdjfgezrjoqs.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5tYXJpaXBoamRqZmdlenJqb3FzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1OTI1NzUsImV4cCI6MjA4NzE2ODU3NX0.3XIUYvS8oeV_tUbRiPjWDSDlH62MIkYw-NVpgUksXwQ';

// Flag para o sistema saber se deve usar Supabase Real ou Mock em Memória
export const isSupabaseConfigured = !!(
  projectUrl && 
  anonKey && 
  !projectUrl.includes('placeholder')
);

export const supabase = createClient(projectUrl, anonKey);
