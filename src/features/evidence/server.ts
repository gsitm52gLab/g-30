import 'server-only';
import { identity, currentToken } from '@/server/auth/runtime';
import { EvidenceService } from '@/server/evidence/service';
import { ImportService } from '@/server/imports/service';
export async function materials(contextId: string, history = false) { const auth = await identity(), token = await currentToken(), service = new EvidenceService(auth); const [table, list, sources] = await Promise.all([(await service.table(token, contextId, history)), (await service.list(token, contextId)), (await service.sources(token, contextId))]); return { table, list, sources }; }
export async function evidenceDetail(id: string, contextId: string) { const auth = await identity(), token = await currentToken(), service = new EvidenceService(auth); const [detail, table, sources] = await Promise.all([(await service.detail(token, id)), (await service.table(token, contextId)), (await service.sources(token, contextId))]); if (detail.contextId !== contextId)
    throw new Error('자료 컨텍스트를 확인해 주세요.'); return { detail, table, sources }; }
export async function importPage(contextId: string, batchId?: string) { const auth = await identity(), token = await currentToken(), service = new ImportService(auth); const [configuration, me, batch] = await Promise.all([(await service.configuration(token, contextId)), (await auth.me(token)), batchId ? (await service.batch(token, batchId)) : Promise.resolve(null)]); if (batch && batch.contextId !== contextId)
    throw new Error('가져오기 컨텍스트를 확인해 주세요.'); return { configuration, userId: me.user.id, batch }; }
