'use client';
import { useSyncExternalStore } from 'react';
import type { NotificationList, NotificationSync } from '@/server/notifications/contracts';
import { request, currentActor, denied, deniedEvent, announceDenied, ScheduleError } from '@/features/scheduling/client';
type ReadIntent = {
    id: string;
    body: {
        read: boolean;
        expectedRevision: number;
        idempotencyKey: string;
    };
    committed: boolean;
    conflict: boolean;
};
type Snapshot = {
    status: 'loading' | 'ready' | 'error' | 'denied';
    data: NotificationList | null;
    busy: boolean;
    busyIds: string[];
    error: string;
    lastChecked: string | null;
    pending: ReadIntent | null;
    message: string;
};
const initial: Snapshot = { status: 'loading', data: null, busy: false, busyIds: [], error: '', lastChecked: null, pending: null, message: '' };
/** One live inbox per context. No protected browser persistence or cross-user cached snapshots. */
class Inbox {
    state: Snapshot = initial;
    listeners = new Set<() => void>();
    actor: string | null = null;
    generation = 0;
    alive = false;
    halted = false;
    running = false;
    reads = 0;
    timer: ReturnType<typeof setInterval> | null = null;
    continuation: ReturnType<typeof setTimeout> | null = null;
    constructor(readonly contextId: string) { }
    storageKey = () => this.actor ? `gs-hale:g13:inbox:${this.actor}:${this.contextId}` : null;
    update = (v: Partial<Snapshot>) => { this.state = { ...this.state, ...v }; if ('pending' in v) {
        const key = this.storageKey();
        if (key)
            try {
                if (v.pending)
                    sessionStorage.setItem(key, JSON.stringify(v.pending));
                else
                    sessionStorage.removeItem(key);
            }
            catch {
                this.state = { ...this.state, message: '브라우저 복구 기록을 저장하지 못했습니다. 화면을 닫기 전에 처리 결과를 확인해 주세요.' };
            }
    } this.listeners.forEach(f => f()); };
    active = (g: number) => this.alive && !this.halted && g === this.generation;
    snapshot = () => this.state;
    subscribe = (fn: () => void) => { this.listeners.add(fn); if (!this.alive) {
        this.alive = true;
        this.halted = false;
        this.generation++;
        this.state = initial;
        queueMicrotask(() => void this.sync());
        window.addEventListener('focus', this.focus);
        document.addEventListener('visibilitychange', this.focus);
        window.addEventListener(deniedEvent, this.revoked);
        this.timer = setInterval(this.focus, 30000);
    } return () => { this.listeners.delete(fn); if (!this.listeners.size) {
        this.alive = false;
        this.generation++;
        this.running = false;
        this.actor = null;
        this.state = initial;
        if (this.timer)
            clearInterval(this.timer);
        if (this.continuation)
            clearTimeout(this.continuation);
        window.removeEventListener('focus', this.focus);
        document.removeEventListener('visibilitychange', this.focus);
        window.removeEventListener(deniedEvent, this.revoked);
    } }; };
    revoked = (event: Event) => { if ((event as CustomEvent).detail === this.contextId)
        this.purge(); };
    purge = () => { this.halted = true; this.generation++; this.reads++; const key = this.storageKey(); if (key)
        try {
            sessionStorage.removeItem(key);
        }
        catch { } this.actor = null; this.running = false; this.update({ ...initial, status: 'denied', error: '현재 계정 또는 접근 권한이 변경되었습니다. 화면을 다시 열어 주세요.' }); };
    fail = (e: unknown, g: number) => { if (!this.active(g))
        return; if (denied(e)) {
        this.purge();
        announceDenied(this.contextId);
    }
    else
        this.update({ error: e instanceof Error ? e.message : '알림 연결을 확인해 주세요.', status: this.state.data ? 'ready' : 'error' }); };
    verify = async (g: number) => { const actor = await currentActor(this.contextId, this.actor ?? undefined); if (!this.active(g))
        return false; if (this.actor === null) {
        this.actor = actor;
        const key = this.storageKey();
        if (key)
            try {
                const raw = sessionStorage.getItem(key);
                if (raw) {
                    const p = JSON.parse(raw) as ReadIntent;
                    if (typeof p.id === 'string' && typeof p.body?.read === 'boolean' && typeof p.body.idempotencyKey === 'string' && Number.isInteger(p.body.expectedRevision))
                        this.update({ pending: p, message: '이 계정에서 결과 확인이 필요한 읽음 요청을 복구했습니다.' });
                    else
                        sessionStorage.removeItem(key);
                }
            }
            catch {
                this.update({ message: '알림 요청 복구 기록을 읽지 못했습니다. 현재 서버 상태를 확인해 주세요.' });
            }
    } return true; };
    // Focus probes remain independent of a held successful POST so revocation can clear it first.
    focus = () => { if (document.visibilityState === 'visible') {
        if (this.running)
            void this.probe();
        else
            void this.sync();
    } };
    probe = async () => { const g = this.generation; try {
        if (await this.verify(g))
            await this.load(g);
    }
    catch (e) {
        this.fail(e, g);
    } };
    load = async (g: number) => { const seq = ++this.reads, value = await request<NotificationList>(`/api/notifications?context=${encodeURIComponent(this.contextId)}`); if (this.active(g) && seq === this.reads) {
        this.update({ status: 'ready', data: value, error: '' });
        return value;
    } return null; };
    sync = async () => { if (this.running || !this.active(this.generation))
        return; const g = this.generation; this.running = true; this.update({ busy: true, error: '' }); try {
        if (!await this.verify(g))
            return;
        let more = false;
        for (let i = 0; i < 4; i++) {
            const seq = ++this.reads, value = await request<NotificationSync>('/api/notifications/sync', { contextId: this.contextId }, () => this.active(g));
            if (!this.active(g))
                return;
            if (seq === this.reads)
                this.update({ status: 'ready', data: value, lastChecked: new Date().toISOString(), error: '' });
            more = value.hasMore;
            if (!more || document.visibilityState !== 'visible')
                break;
        }
        if (more && this.active(g))
            this.continuation = setTimeout(() => { if (document.visibilityState === 'visible')
                void this.sync(); }, 1000);
    }
    catch (e) {
        this.fail(e, g);
    }
    finally {
        if (this.active(g)) {
            this.running = false;
            this.update({ busy: false });
        }
    } };
    read = async (id: string, read: boolean) => { if (this.running || !this.active(this.generation))
        return; const old = this.state.pending, row = this.state.data?.items.find(r => r.id === id); if (old && (old.id !== id || old.conflict))
        return; if (!row && !old)
        return; const intent = old ?? { id, body: { read, expectedRevision: row!.revision, idempotencyKey: crypto.randomUUID() }, committed: false, conflict: false }; const g = this.generation; this.running = true; this.reads++; this.update({ busyIds: [id], pending: intent, error: '', message: '' }); try {
        if (!await this.verify(g))
            return;
        if (!intent.committed) {
            await request(`/api/notifications/${encodeURIComponent(id)}/read`, intent.body, () => this.active(g));
            if (!this.active(g))
                return;
            this.update({ pending: { ...intent, committed: true }, message: '읽음 상태 저장 완료 · 최신 목록을 확인합니다.' });
        }
        const data = await this.load(g);
        if (data && this.active(g))
            this.update({ pending: null, message: '읽음 상태를 확인했습니다. 원 업무 확인·수락·제출 상태는 별도입니다.' });
    }
    catch (e) {
        if (this.active(g) && e instanceof ScheduleError && e.status === 409)
            this.update({ pending: { ...intent, conflict: true } });
        this.fail(e, g);
    }
    finally {
        if (this.active(g)) {
            this.running = false;
            this.update({ busyIds: [] });
        }
    } };
    rebase = async () => { const g = this.generation, p = this.state.pending; if (!p || this.running)
        return; try {
        if (!await this.verify(g))
            return;
        const data = await this.load(g), row = data?.items.find(r => r.id === p.id);
        if (!this.active(g))
            return;
        if (!row) {
            this.update({ pending: null, message: '현재 접근 가능한 알림 목록에서 해당 항목이 제외되었습니다.' });
            return;
        }
        this.update({ pending: { ...p, body: { ...p.body, expectedRevision: row.revision, idempotencyKey: crypto.randomUUID() }, conflict: false, committed: false }, message: '최신 기준을 선택했습니다. 같은 표시 의도를 다시 확인해 주세요.' });
    }
    catch (e) {
        this.fail(e, g);
    } };
    retry = async (id: string) => { if (this.running || !this.active(this.generation))
        return; const g = this.generation; this.running = true; this.reads++; this.update({ busyIds: [id], error: '', message: '' }); try {
        if (!await this.verify(g))
            return;
        const result = await request<{
            state: string;
            id: string | null;
        }>(`/api/notifications/attempts/${encodeURIComponent(id)}/retry`, {}, () => this.active(g));
        if (!this.active(g))
            return;
        this.update({ message: result.state === 'failed' ? '앱 알림 저장이 다시 실패했습니다. 실패 기록에서 재시도할 수 있습니다.' : result.state === 'suppressed' ? '현재 담당·진행 조건에서는 알림이 제외됩니다.' : '재시도 처리 결과를 확인했습니다.' });
        await this.load(g);
    }
    catch (e) {
        this.fail(e, g);
    }
    finally {
        if (this.active(g)) {
            this.running = false;
            this.update({ busyIds: [] });
        }
    } };
}
const stores = new Map<string, Inbox>();
function store(contextId: string) { let value = stores.get(contextId); if (!value) {
    value = new Inbox(contextId);
    stores.set(contextId, value);
} return value; }
export function useInbox(contextId: string) { const value = store(contextId), snapshot = useSyncExternalStore(value.subscribe, value.snapshot, () => initial); return { snapshot, sync: value.sync, read: value.read, rebase: value.rebase, retry: value.retry }; }
