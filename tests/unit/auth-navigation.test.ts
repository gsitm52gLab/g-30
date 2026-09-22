import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FormEvent, ReactElement } from 'react';
const harness = vi.hoisted(() => ({ api: vi.fn(), clear: vi.fn(), replace: vi.fn(), setters: [] as ReturnType<typeof vi.fn>[], signedIn: false }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useEffect: vi.fn(), useState: (initial: unknown) => { const set = vi.fn(); harness.setters.push(set); return [initial === null && harness.signedIn ? { name: 'synthetic admin' } : initial, set]; } }));
vi.mock('next/navigation', () => ({ usePathname: () => '/login' }));
vi.mock('@/features/auth/client', () => ({ api: harness.api }));
vi.mock('@/features/submissions/recovery', () => ({ clearSubmissionRecovery: harness.clear }));
import { AccountMenu, LoginForm } from '@/features/auth/forms';

beforeEach(() => { vi.clearAllMocks(); harness.setters.length = 0; harness.signedIn = false; vi.stubGlobal('window', { location: { replace: harness.replace } }); vi.stubGlobal('FormData', class { get(key: string) { return key === 'email' ? 'admin@example.test' : 'synthetic-password'; } }); });
afterEach(() => vi.unstubAllGlobals());
const event = () => ({ preventDefault: vi.fn(), currentTarget: {} }) as unknown as FormEvent<HTMLFormElement>;
function loginSubmit() { return (LoginForm() as ReactElement<{ onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }>).props.onSubmit; }
function logoutClick(node: unknown): (() => Promise<void>) | undefined {
    if (!node || typeof node !== 'object') return undefined;
    const e = node as ReactElement<{ children?: unknown; onClick?: () => Promise<void> }>;
    if (e.type === 'button' && e.props.children === '로그아웃') return e.props.onClick;
    for (const child of Array.isArray(e.props?.children) ? e.props.children : [e.props?.children]) { const found = logoutClick(child); if (found) return found; }
    return undefined;
}
describe('auth boundary fresh document navigation', () => {
    it('waits for successful login and recovery purge before replacing the document', async () => {
        let finish!: () => void; harness.api.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
        const pending = loginSubmit()(event());
        expect(harness.replace).not.toHaveBeenCalled(); expect(harness.clear).not.toHaveBeenCalled();
        finish(); await pending;
        expect(harness.api).toHaveBeenCalledExactlyOnceWith('/api/auth/login', 'POST', { email: 'admin@example.test', password: 'synthetic-password' });
        expect(harness.replace).toHaveBeenCalledExactlyOnceWith('/');
        expect(harness.clear.mock.invocationCallOrder[0]).toBeLessThan(harness.replace.mock.invocationCallOrder[0]);
    });
    it('failed login keeps the form and error without navigating or clearing recovery', async () => {
        harness.api.mockRejectedValue(new Error('로그인 실패')); await loginSubmit()(event());
        expect(harness.replace).not.toHaveBeenCalled(); expect(harness.clear).not.toHaveBeenCalled();
        expect(harness.setters[0]).toHaveBeenLastCalledWith('로그인 실패'); expect(harness.setters[1]).toHaveBeenLastCalledWith(false);
    });
    it('successful logout clears recovery and replaces the authenticated document', async () => {
        harness.signedIn = true; harness.api.mockResolvedValue({}); const click = logoutClick(AccountMenu()); expect(click).toBeDefined(); await click!();
        expect(harness.api).toHaveBeenCalledExactlyOnceWith('/api/auth/logout', 'POST');
        expect(harness.replace).toHaveBeenCalledExactlyOnceWith('/login'); expect(harness.setters[0]).toHaveBeenLastCalledWith(null);
        expect(harness.clear.mock.invocationCallOrder[0]).toBeLessThan(harness.replace.mock.invocationCallOrder[0]);
    });
    it('failed logout keeps the session screen and exposes the failure', async () => {
        harness.signedIn = true; harness.api.mockRejectedValue(new Error('로그아웃 실패')); await logoutClick(AccountMenu())!();
        expect(harness.replace).not.toHaveBeenCalled(); expect(harness.clear).not.toHaveBeenCalled(); expect(harness.setters[1]).toHaveBeenLastCalledWith('로그아웃 실패');
    });
});
