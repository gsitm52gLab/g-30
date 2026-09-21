import "server-only";
import { getRepository } from "@/server/repositories";
export async function readWorkspace(contextId?: string) {
  const repository = await getRepository();
  const contexts = await repository.list("context");
  const selected = contextId ? contexts.find(c => c.id === contextId) : contexts[0];
  const [tasks, products, users] = selected ? await Promise.all([repository.list("task", selected.id), repository.list("product", selected.id), repository.list("user")]) : [[], [], []];
  return { mode: repository.mode, contexts, selected, tasks, products, users };
}
export type Workspace = Awaited<ReturnType<typeof readWorkspace>>;
export type Search = Promise<Record<string, string | string[] | undefined>>;
export async function contextFromSearch(search: Search) {
  const value = (await search).context;
  return typeof value === "string" ? value : undefined;
}
