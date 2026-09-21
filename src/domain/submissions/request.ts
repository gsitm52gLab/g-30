import type { RequestContent } from '../tasks/types';
import { blankContent } from '../tasks/types';
import { content } from '../tasks/validate';
/** Strip only unknown extension keys. Never coerce/filter known authoritative rule values. */
export function requestRequirementsValid(request: RequestContent): boolean {
    const pick = (value: unknown, keys: string[]) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error('invalid rule');
        const source = value as Record<string, unknown>;
        return Object.fromEntries(keys.map(key => [key, source[key]]));
    };
    try {
        if (!Array.isArray(request.requirements) || !request.requirements.length)
            return false;
        const requirements = request.requirements.map(raw => {
            const q = pick(raw, ['key', 'label', 'type', 'required', 'help', 'unit', 'options', 'productIds', 'condition', 'specifications']);
            if (q.condition !== null)
                q.condition = pick(q.condition, ['key', 'equals']);
            if (!Array.isArray(q.specifications))
                return q;
            q.specifications = q.specifications.map(s => pick(s, ['text', 'source', 'version', 'severity', 'check']));
            return q;
        });
        const base = blankContent();
        content({ ...base, title: '요청 구조 확인', deadline: { ...base.deadline, responsibleUserId: 'validation' }, requirements });
        return true;
    }
    catch {
        return false;
    }
}
