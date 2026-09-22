import 'server-only';
import { SupabasePrivateStorage } from '@/server/storage/supabase';
/** Lazy construction: a remote configuration failure never selects a local backend. */
export function consumerStorage() {
  return new SupabasePrivateStorage({ projectUrl: process.env.SUPABASE_URL ?? '', secretKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '', bucket: process.env.SUPABASE_STORAGE_BUCKET || 'gs-hale-private', namespace: process.env.SUPABASE_STORAGE_NAMESPACE || 'gs-hale' });
}
