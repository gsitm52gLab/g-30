import 'server-only';
import { identity, currentToken } from '@/server/auth/runtime';
import { SchedulingService } from '@/server/scheduling/service';
export async function scheduleData(contextId: string, id?: string) {
    const s = await identity(), token = await currentToken(), me = await s.me(token);
    const service = new SchedulingService(s), list = await service.list(token, contextId), detail = id ? await service.detail(token, id) : null;
    if (detail && detail.contextId !== contextId)
        throw new Error('컨텍스트가 다릅니다.');
    return { actorId: me.user.id, list, detail };
}
