import "server-only";
import { redirect, notFound } from "next/navigation";
import { identity, currentToken } from "@/server/auth/runtime";
import { AuthError, hasScope, needScope } from "@/server/auth/service";
import { projectContext, projectTask, projectProduct, projectUserLabel, taskScope } from "@/server/policy/projection";
import { decide } from "@/server/policy/policy";
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
        const contexts = s.list("context").filter(c => hasScope(s, p, c.id, service.clock)).map(projectContext);
        if (contextId)
            needScope(s, p, contextId, service.clock);
        const selected = contextId ? contexts.find(c => c.id === contextId) : contexts.find(c => c.id === "ctx-jp-a-luna") ?? contexts[0];
        const tasks = selected ? s.list("task", selected.id).filter(t => decide(s,p,"task.read",taskScope(t),service.clock).allowed).map(t => projectTask(s, p, t, service.clock)) : [];
        const products = selected ? s.list("product", selected.id).map(t => projectProduct(s, p, t, service.clock)) : [];
        const visibleIds = new Set(tasks.flatMap(t => [t.data.assigneeId, t.data.ownerId]));
        const users = s.list("user").filter(u => visibleIds.has(u.id)).map(projectUserLabel);
        return { mode: service.repo.mode, contexts, selected, tasks, products, users };
    });
}
export type Workspace = Awaited<ReturnType<typeof readWorkspace>>;
export type Search = Promise<Record<string, string | string[] | undefined>>;
export async function contextFromSearch(search: Search) { const value = (await search).context; return typeof value === "string" ? value : undefined; }
