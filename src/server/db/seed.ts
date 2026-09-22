import { migrateLegacyProducts } from "@/data/products/migrate";
import { fixtures } from "@/data/fixtures";
import { builtins } from "@/domain/tasks/templates";
import { bootstrapCorpus } from '@/server/ai-review/corpus';
import type { RecordRepository } from "@/domain/records";
/** Insert missing IDs only. Never replace user edits or delete records. */
export async function seed(repository: RecordRepository) {
    return repository.transaction(async (store) => {
        let inserted = 0;
        let preserved = 0;
        for (const fixture of fixtures) {
            const existing = (await store.get(fixture.kind, fixture.input.id));
            if (existing) {
                // Upgrade ONLY known G00 fixture IDs. Preserve edited fields; never infer admin access.
                if (fixture.kind === "context" && existing.kind === "context" && !(existing.data as {
                    type?: string;
                }).type)
                    (await store.update("context", existing.id, existing.revision, { ...fixture.input.data, ...existing.data } as import("@/domain/records").ContextData));
                if (fixture.kind === "user" && existing.kind === "user" && ["user-gsg", "user-luna", "user-wave"].includes(existing.id) && !(existing.data as {
                    status?: string;
                }).status) {
                    const old = existing.data as import("@/domain/records").UserData;
                    (await store.update("user", existing.id, existing.revision, { ...old, normalizedEmail: old.email.trim().toLowerCase(), status: "active", authVersion: 1, adminGrant: null }));
                }
                if (fixture.kind === "task" && existing.kind === "task" && !(existing.data as {
                    authorId?: string;
                }).authorId) {
                    const old = existing.data as import("@/domain/records").TaskData;
                    (await store.update("task", existing.id, existing.revision, { ...old, authorId: old.assigneeId, contributorIds: [], assignmentNeedsAttention: false }));
                }
                preserved++;
                continue;
            }
            (await store.create(fixture.kind, fixture.input));
            inserted++;
        }
        for (const input of builtins) {
            if (!(await store.get("templateVersion", input.id))) {
                (await store.create("templateVersion", input));
                inserted++;
            }
            else
                preserved++;
        }
        const products = (await migrateLegacyProducts(store));
        const corpus = (await bootstrapCorpus(store));
        return { inserted, preserved, products, corpus };
    });
}
