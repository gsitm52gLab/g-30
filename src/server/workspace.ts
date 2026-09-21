import "server-only";
import { redirect, notFound } from "next/navigation";
import { identity, currentToken } from "@/server/auth/runtime";
import { AuthError, hasScope, needScope } from "@/server/auth/service";
export function workspaceFailure(error: unknown): null { if (error instanceof AuthError) {
    if (error.status === 401)
        redirect("/login");
    if (error.status === 403 || error.status === 404)
        notFound();
} return null; }
export async function readWorkspace(contextId?: string) {
    const service = await identity();
    const token = await currentToken();
    return service.repo.transaction(s => {
        const p = service.principal(s, token);
        const contexts = s.list("context").filter(c => hasScope(s, p, c.id));
        if (contextId)
            needScope(s, p, contextId);
        const selected = contextId ? contexts.find(c => c.id === contextId) : contexts.find(c => c.id === "ctx-jp-a-luna") ?? contexts[0];
        const tasks = selected ? s.list("task", selected.id) : [];
        const products = selected ? s.list("product", selected.id) : [];
        const visibleIds = new Set(tasks.flatMap(t => [t.data.assigneeId, t.data.ownerId]));
        const users = s.list("user").filter(u => visibleIds.has(u.id)).map(u => ({ ...u, data: { name: u.data.name, email: "", role: u.data.role } }));
        return { mode: service.repo.mode, contexts, selected, tasks, products, users };
    });
}
export type Workspace = Awaited<ReturnType<typeof readWorkspace>>;
export type Search = Promise<Record<string, string | string[] | undefined>>;
export async function contextFromSearch(search: Search) { const value = (await search).context; return typeof value === "string" ? value : undefined; }
