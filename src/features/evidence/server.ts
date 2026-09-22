import 'server-only';
import { identity, currentToken } from '@/server/auth/runtime';
import { EvidenceService } from '@/server/evidence/service';
import { ImportService } from '@/server/imports/service';
export async function materials(contextId: string, history = false) { const auth = await identity(), token = await currentToken(), service = new EvidenceService(auth); const [table, list, sources] = await Promise.all([service.table(token, contextId, history), service.list(token, contextId), service.sources(token, contextId)]); return { table, list, sources }; }
export async function evidenceDetail(id: string, contextId: string) { const auth = await identity(), token = await currentToken(), service = new EvidenceService(auth); const [detail, table, sources] = await Promise.all([service.detail(token, id), service.table(token, contextId), service.sources(token, contextId)]); if (detail.contextId !== contextId)
    throw new Error('자료 컨텍스트를 확인해 주세요.'); return { detail, table, sources }; }
export async function importPage(contextId: string, batchId?: string) { const auth = await identity(), token = await currentToken(), service = new ImportService(auth); const [configuration, me, batch] = await Promise.all([service.configuration(token, contextId), auth.me(token), batchId ? service.batch(token, batchId) : Promise.resolve(null)]); if (batch && batch.contextId !== contextId)
    throw new Error('가져오기 컨텍스트를 확인해 주세요.'); return { configuration, userId: me.user.id, batch }; }
