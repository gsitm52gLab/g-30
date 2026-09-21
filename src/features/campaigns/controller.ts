'use client';
import { useEffect, useRef, useState } from 'react';
import { CampaignError, denied, request } from './client';
import { freshRecovery, type Command, type Recovery, type State, type Workspace, type CampaignPreview } from './model';
const prefix = 'gs-hale:campaigns:';
function readRecovery(key: string): Recovery | null { try {
    const text = sessionStorage.getItem(key);
    if (!text || text.length > 900000)
        return null;
    const r = JSON.parse(text) as Recovery;
    return r && typeof r.at === 'number' && Date.now() - r.at < 8 * 3600000 && r.forms && typeof r.forms === 'object' ? r : null;
}
catch {
    return null;
} }
function writeRecovery(key: string, r: Recovery) { try {
    const text = JSON.stringify({ ...r, at: Date.now() });
    if (text.length < 900000)
        sessionStorage.setItem(key, text);
}
catch { /* Current in-memory intent remains. */ } }
function clearRecovery() { try {
    Object.keys(sessionStorage).filter(k => k.startsWith(prefix)).forEach(k => sessionStorage.removeItem(k));
}
catch { } }
export function useCampaign(initial: Workspace, selection: string | null, version: string | null) {
    const key = prefix + initial.catalog.userId + ':' + initial.task.task.contextId + ':' + initial.task.task.id;
    const [state, setState] = useState<State>({ data: initial, recovery: freshRecovery(), busy: false, ready: false, error: '', code: '', message: '', denied: false, preview: null });
    const current = useRef(state), live = useRef({ alive: false, halted: false, generation: 0, locked: false });
    const update = (patch: Partial<State>) => { const n = { ...current.current, ...patch }; current.current = n; setState(n); if (n.ready && !n.denied)
        writeRecovery(key, n.recovery); };
    const active = (g = live.current.generation) => live.current.alive && !live.current.halted && g === live.current.generation;
    function purge() { live.current.halted = true; live.current.generation++; clearRecovery(); update({ data: null, recovery: freshRecovery(), preview: null, denied: true, ready: false, busy: false, error: '현재 접근 권한을 확인할 수 없습니다. 보호된 작성 내용과 파일 선택을 지웠습니다.', code: 'DENIED' }); }
    function failure(e: unknown) { if (denied(e)) {
        purge();
        return;
    } if (active())
        update({ error: e instanceof Error ? e.message : '처리하지 못했습니다. 작성값은 유지됩니다.', code: e instanceof CampaignError ? e.code : 'NETWORK' }); }
    async function load(campaignId = selection) {
        const taskId = initial.task.task.id, context = initial.task.task.contextId!;
        const task = await request<Workspace['task']>(`/api/tasks/${taskId}?context=${context}`), catalog = await request<Workspace['catalog']>(`/api/tasks?context=${context}`), list = await request<Workspace['list']>(`/api/campaigns?context=${context}&taskId=${taskId}`);
        if (catalog.userId !== initial.catalog.userId)
            throw new CampaignError('로그인 사용자가 변경되었습니다.', 403, 'ACTOR_CHANGED');
        const detail = campaignId ? await request<NonNullable<Workspace['detail']>>(`/api/campaigns/${campaignId}${version ? '?versionId=' + encodeURIComponent(version) : ''}`) : null;
        if (detail && (detail.taskId !== taskId || detail.contextId !== context))
            throw new CampaignError('자료를 찾을 수 없습니다.', 404, 'NOT_FOUND');
        const catalogs = task.canManage ? await request<NonNullable<Workspace['catalogs']>>(`/api/campaigns/catalogs?context=${context}`) : null;
        const products = task.canManage ? await Promise.all(task.task.data.productIds.map(id => request<Workspace['products'][number]>(`/api/products/${id}?context=${context}`))) : [];
        return { task, catalog, list, detail, catalogs, products };
    }
    async function refresh() { const g = live.current.generation; try {
        const id = current.current.data?.detail?.id ?? selection;
        const data = await load(id);
        if (active(g))
            update({ data, message: '현재 저장본을 확인했습니다. 작성값과 기준 버전은 유지됩니다.' });
    }
    catch (e) {
        if (active(g))
            failure(e);
    } }
    useEffect(() => {
        const lifetime = live.current;
        live.current.alive = true;
        live.current.halted = false;
        const g = ++live.current.generation;
        void load().then(data => { if (active(g))
            update({ data, ready: true, recovery: readRecovery(key) ?? freshRecovery() }); }).catch(e => { if (active(g))
            failure(e); });
        const onFocus = () => { if (active())
            void refresh(); };
        const onLogout = (event: MouseEvent) => { const button = event.target instanceof Element ? event.target.closest('button') : null; if (button?.textContent?.trim() === '로그아웃')
            purge(); };
        document.addEventListener('click', onLogout, true);
        window.addEventListener('focus', onFocus);
        const timer = setInterval(onFocus, 20000);
        return () => { lifetime.alive = false; lifetime.generation++; document.removeEventListener('click', onLogout, true); window.removeEventListener('focus', onFocus); clearInterval(timer); };
        // The route key remounts this workspace for every task, actor, campaign and historical version.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    function form<T>(name: string, initialValue: T): T { return (state.recovery.forms[name] as T | undefined) ?? initialValue; }
    function setForm<T>(name: string, value: T) { if (!active() || current.current.recovery.pending)
        return; update({ recovery: { ...current.current.recovery, forms: { ...current.current.recovery.forms, [name]: value } }, preview: null }); }
    function clearForm(name: string) { const forms = { ...current.current.recovery.forms }; delete forms[name]; update({ recovery: { ...current.current.recovery, forms }, preview: null }); }
    async function finish() {
        const p = current.current.recovery.pending;
        if (!p?.ids)
            return;
        const g = live.current.generation;
        const id = p.command.command === 'save' ? p.ids[0] : current.current.data?.detail?.id ?? selection;
        const data = await load(id);
        if (!active(g))
            return;
        const forms = { ...current.current.recovery.forms };
        // Retain the acknowledged write's CAS basis, never silently adopt a concurrent writer's revision.
        if (p.command.command === 'save') {
            delete forms[p.formKey];
            forms['draft:' + p.ids[0]] = { campaignId: p.ids[0], revision: p.command.campaignId ? p.command.expectedRevision + 1 : 1, draft: p.command.draft };
            if (!p.command.campaignId)
                window.history.replaceState(null, '', `/tasks/${p.command.taskId}/campaigns?context=${p.command.contextId}&campaign=${p.ids[0]}`);
        }
        else if (p.command.command === 'save_catalog')
            forms[p.formKey] = { catalogId: p.ids[0], revision: p.command.catalogId ? p.command.expectedRevision + 1 : 2, draft: p.command.draft };
        else
            delete forms[p.formKey];
        update({ data, recovery: { ...current.current.recovery, forms, pending: null }, preview: null, error: '', code: '', message: '기록을 저장했습니다. 외부 신청·배송 실행이나 업무 완료를 자동 처리하지 않습니다.' });
    }
    async function execute(command?: Command, formKey = '') {
        if (live.current.locked || !active())
            return;
        live.current.locked = true;
        const g = live.current.generation;
        update({ busy: true, error: '', code: '' });
        try {
            let p = current.current.recovery.pending;
            if (!p) {
                if (!command)
                    return;
                p = { command, formKey, ids: null };
                update({ recovery: { ...current.current.recovery, pending: p } });
            }
            if (!p.ids) {
                const result = await request<{
                    ids: string[];
                }>('/api/campaigns', p.command, () => active(g));
                if (!active(g))
                    return;
                p = { ...p, ids: result.ids };
                update({ recovery: { ...current.current.recovery, pending: p }, preview: null });
            }
            await finish();
        }
        catch (e) {
            if (active(g)) {
                if (e instanceof CampaignError && [409, 422].includes(e.status))
                    update({ recovery: { ...current.current.recovery, pending: null }, preview: null });
                failure(e);
            }
        }
        finally {
            live.current.locked = false;
            if (active(g))
                update({ busy: false });
        }
    }
    async function preview() { const d = current.current.data?.detail; if (!d || live.current.locked)
        return; live.current.locked = true; const g = live.current.generation, stamp = JSON.stringify(current.current.recovery.forms), revision = d.revision; update({ busy: true, error: '' }); try {
        const value = await request<CampaignPreview>(`/api/campaigns/${d.id}/preview`);
        if (active(g) && stamp === JSON.stringify(current.current.recovery.forms) && current.current.data?.detail?.revision === revision)
            update({ preview: { revision, value } });
    }
    catch (e) {
        if (active(g))
            failure(e);
    }
    finally {
        live.current.locked = false;
        if (active(g))
            update({ busy: false });
    } }
    return { state, form, setForm, clearForm, execute, refresh, preview, failure, active, locked: state.busy || !state.ready || !!state.recovery.pending };
}
export type Controller = ReturnType<typeof useCampaign>;
