import 'server-only';
import { identity, currentToken } from '@/server/auth/runtime';
import { AuthError, fail } from '@/server/auth/errors';
import { SearchService } from '@/server/search/service';
import { AuditService } from '@/server/audit/service';
import type { Initial, View } from './model';
export async function loadPage(view: View, raw: Record<string, string | string[] | undefined>, id = ''): Promise<Initial> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(raw)) {
        if (Array.isArray(v))
            for (const s of v)
                q.append(k, s);
        else if (v !== undefined)
            q.append(k, v);
    }
    const result: Initial = { view, id, query: q.toString(), context: q.get('context') ?? '', scope: null, data: null, error: null };
    try {
        const identityService = await identity(), token = await currentToken(), search = new SearchService(identityService), audit = new AuditService(identityService);
        result.scope = await search.contexts(token);
        if (!q.has('context')) {
            const selected = result.scope.contexts.find(c => c.id === 'ctx-jp-a-luna') ?? result.scope.contexts[0];
            if (selected)
                q.set('context', selected.id);
        }
        result.context = q.get('context') ?? '';
        result.query = q.toString();
        if (!result.context && !result.scope.contexts.length)
            return result;
        if (view === 'history' || view === 'audit-detail') {
            const allowed = view === 'history' ? ['context', 'kind', 'id'] : ['context'];
            if ([...q.keys()].some(k => !allowed.includes(k) || q.getAll(k).length !== 1))
                fail('VALIDATION', 422, '정확한 기록과 컨텍스트를 하나 선택해 주세요.');
        }
        if (view === 'search')
            result.data = { type: view, value: await search.list(token, q) };
        if (view === 'history') {
            const value = await search.detail(token, result.context, q.get('kind') ?? '', q.get('id') ?? ''), options = await search.list(token, new URLSearchParams({ context: result.context }));
            result.data = { type: view, value, canAudit: options.capabilities.audit };
        }
        if (view === 'audit') {
            const value = await audit.list(token, q), options = await search.list(token, new URLSearchParams({ context: result.context }));
            result.data = { type: view, value, options: options.filters };
        }
        if (view === 'audit-detail')
            result.data = { type: view, value: await audit.detail(token, result.context, id) };
    }
    catch (e) {
        result.error = e instanceof AuthError ? { status: e.status, message: e.message } : { status: 503, message: '자료를 불러오지 못했습니다. 잠시 후 같은 조건으로 다시 조회해 주세요.' };
        result.data = null;
        if ([401, 403, 404].includes(result.error.status))
            result.scope = null;
    }
    return result;
}
