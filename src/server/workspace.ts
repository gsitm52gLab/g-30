import { asyncFilter, asyncFlatMap, asyncMap } from "@/domain/async-collections";
import { visibleProductRelations } from "@/server/products/access";
import "server-only";
import { redirect, notFound } from "next/navigation";
import { identity, currentToken } from "@/server/auth/runtime";
import { AuthError, hasScope, needScope } from "@/server/auth/service";
import { projectContext, projectTask, projectProduct, projectUserLabel, taskScope } from "@/server/policy/projection";
import { decide } from "@/server/policy/policy";
export function workspaceFailure(error: unknown): null {
    if (error instanceof AuthError) {
        if (error.status === 401)
            redirect("/login");
        if (error.status === 403 || error.status === 404)
            notFound();
    }
    return null;
}
export async function readWorkspace(contextId?: string) {
    const service = await identity();
    const token = await currentToken();
    return service.repo.transaction(async (s) => {
        const p = (await service.principal(s, token));
        const contexts = (await asyncFilter((await s.list("context")), async (c) => (await hasScope(s, p, c.id, service.clock)))).map(projectContext);
        if (contextId)
            (await needScope(s, p, contextId, service.clock));
        const selected = contextId ? contexts.find(c => c.id === contextId) : contexts.find(c => c.id === "ctx-jp-a-luna") ?? contexts[0];
        const tasks = selected ? (await asyncMap((await asyncFilter((await s.list("task", selected.id)), async (t) => (await decide(s, p, "task.read", taskScope(t), service.clock)).allowed)), async (t) => (await projectTask(s, p, t, service.clock)))) : [];
        const products = selected ? (await asyncFlatMap((await visibleProductRelations(s, p, service.clock, selected.id)), async (cp) => { const product = (await s.get("product", cp.data.productId)); return product ? [(await projectProduct(s, p, product, service.clock, selected.id))] : []; })) : [];
        const visibleIds = new Set(tasks.flatMap(t => [t.data.assigneeId, t.data.ownerId]));
        const users = (await s.list("user")).filter(u => visibleIds.has(u.id)).map(projectUserLabel);
        return { mode: service.repo.mode, contexts, selected, tasks, products, users };
    });
}
export type Workspace = Awaited<ReturnType<typeof readWorkspace>>;
export type Search = Promise<Record<string, string | string[] | undefined>>;
export async function contextFromSearch(search: Search) { const value = (await search).context; return typeof value === "string" ? value : undefined; }
