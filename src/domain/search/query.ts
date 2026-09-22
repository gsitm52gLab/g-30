import { fail } from '@/server/auth/errors';
import { searchKinds, type SearchKind, type SearchQuery } from './types';
const keys = ['context', 'q', 'kind', 'mode', 'product', 'sku', 'jan', 'task', 'status', 'actor', 'assignee', 'from', 'to', 'page', 'pageSize'];
export function searchQuery(params: URLSearchParams): SearchQuery {
    for (const key of params.keys())
        if (!keys.includes(key) || params.getAll(key).length !== 1)
            fail('VALIDATION', 422, '검색 조건을 확인해 주세요.');
    const text = (key: string, max = 200) => {
        const v = params.get(key) ?? '';
        if (v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))
            fail('VALIDATION', 422, '검색 조건을 확인해 주세요.');
        return v.trim();
    };
    const id = (key: string) => {
        const v = text(key, 160);
        if (v && !/^[a-zA-Z0-9_-]+$/.test(v))
            fail('VALIDATION', 422, '검색 대상을 확인해 주세요.');
        return v;
    };
    const num = (key: string, def: number, max: number) => {
        const v = text(key) || String(def);
        if (!/^[1-9][0-9]*$/.test(v) || !Number.isSafeInteger(Number(v)) || Number(v) > max)
            fail('VALIDATION', 422, '페이지 범위를 확인해 주세요.');
        return Number(v);
    };
    const context = id('context'), kind = text('kind'), mode = text('mode') || 'current', from = text('from'), to = text('to');
    if (!context || kind && !searchKinds.includes(kind as SearchKind) || !['current', 'history'].includes(mode))
        fail('VALIDATION', 422, '검색 종류와 컨텍스트를 확인해 주세요.');
    for (const v of [from, to])
        if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v))
            fail('VALIDATION', 422, '날짜를 확인해 주세요.');
    if (from && to && from > to)
        fail('VALIDATION', 422, '날짜 범위를 확인해 주세요.');
    return { context, q: text('q'), kind: kind as SearchKind | '', mode: mode as 'current' | 'history', product: id('product'), sku: text('sku', 160), jan: text('jan', 160), task: id('task'), status: text('status', 100), actor: id('actor'), assignee: id('assignee'), from, to, page: num('page', 1, 1000000), pageSize: num('pageSize', 20, 50) };
}
