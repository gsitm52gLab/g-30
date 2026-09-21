import type { InquiryCommand, InquiryCommandResult, InquiryFileDTO } from '@/server/inquiries/contracts';
export type FileItem = {
    clientItemId: string;
    name: string;
    type: string;
    bytes: number;
    sha256: string;
    state: 'pending' | 'ready' | 'failed';
    file?: InquiryFileDTO;
    error?: string;
};
export type ComposerMode = 'question' | 'comment' | 'acknowledgement' | 'answer' | 'supplement' | 'internal_note';
export interface Recovery {
    at: number;
    title: string;
    body: string;
    mode: ComposerMode;
    questionId: string;
    files: FileItem[];
    intent: InquiryCommand | null;
    committed: InquiryCommandResult | null;
    pendingTaskId: string;
    linkIntent: InquiryCommand | null;
}
const prefix = 'gs-hale:inquiry:v1:';
export function keyFor(actor: string, context: string, id: string) { return prefix + [actor, context, id].map(encodeURIComponent).join(':'); }
export function blank(): Recovery { return { at: Date.now(), title: '', body: '', mode: 'comment', questionId: '', files: [], intent: null, committed: null, pendingTaskId: '', linkIntent: null }; }
export function storeLocal(key: string, value: unknown) { try {
    const text = JSON.stringify(value);
    if (text.length > 180000)
        return;
    const keys = Object.keys(sessionStorage).filter(k => k.startsWith(prefix));
    for (const k of keys.slice(0, Math.max(0, keys.length - 7)))
        if (k !== key)
            sessionStorage.removeItem(k);
    sessionStorage.setItem(key, text);
}
catch { } }
export function save(key: string, value: Recovery) { storeLocal(key, { ...value, at: Date.now() }); }
export function read(key: string): Recovery | null { try {
    const text = sessionStorage.getItem(key);
    if (!text || text.length > 180000)
        return null;
    const r = JSON.parse(text) as Recovery;
    if (!r || Date.now() - r.at > 86400000 || typeof r.title !== 'string' || typeof r.body !== 'string' || typeof r.questionId !== 'string' || typeof r.pendingTaskId !== 'string' || !Array.isArray(r.files) || r.files.length > 10 || !['question', 'comment', 'acknowledgement', 'answer', 'supplement', 'internal_note'].includes(r.mode)) {
        sessionStorage.removeItem(key);
        return null;
    }
    return r;
}
catch {
    return null;
} }
export function clearAll() { try {
    for (const k of Object.keys(sessionStorage))
        if (k.startsWith(prefix))
            sessionStorage.removeItem(k);
}
catch { } }
export function freshIntentKey(actor: string, context: string, task: string | null) { return keyFor(actor, context, 'new-' + (task ?? 'independent')); }
