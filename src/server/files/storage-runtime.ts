import 'server-only';
import { SupabasePrivateStorage } from '@/server/storage/supabase';
import type { StorageTransport } from '@/server/storage/contracts';
/** SQL-only authentication never validates or initializes Storage. No local fallback exists. */
export function createPrivateStorageFactory(environment: () => Record<string, string | undefined> = () => process.env): () => StorageTransport {
  let storage: StorageTransport | undefined;
  return () => {
    if (!storage) {
      const env = environment();
      storage = new SupabasePrivateStorage({ projectUrl: env.SUPABASE_URL ?? '', secretKey: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || '', bucket: env.SUPABASE_STORAGE_BUCKET || 'gs-hale-private', namespace: env.SUPABASE_STORAGE_NAMESPACE || 'gs-hale' });
    }
    return storage;
  };
}
export const privateStorage = createPrivateStorageFactory();
