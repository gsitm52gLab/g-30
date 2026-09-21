import type { RecordRepository, UnitOfWork } from "@/domain/records";
import { IdentityService } from "@/server/auth/service";
import { digestToken } from "@/server/auth/crypto";
import { seed } from "@/server/db/seed";

export const NOW = "2026-09-21T12:00:00.000Z";
export const CONTEXT = "ctx-jp-a-luna";
export const actors = ["user-admin", "user-selected-admin", "user-gsg", "user-price", "user-luna", "user-wave", "user-co", "user-team", "user-none", "user-suspended", "user-invited"];
export const contexts = [CONTEXT, "ctx-jp-b-luna", "ctx-jp-a-wave", "ctx-sg-a-luna", "ctx-event-luna", "ctx-empty"];
export const marker = "G02_PRIVATE_CANARY";
export const tokenFor = (id: string) => `synthetic-policy-token-${id}`;
export async function policyFixture(repo: RecordRepository) {
    await seed(repo);
    await repo.transaction(s => {
        for (const userId of actors) {
            s.create("session", { id: `policy-session-${userId}`, contextId: null, data: {
                userId, tokenHash: digestToken(tokenFor(userId)), csrfToken: "synthetic-csrf",
                authVersion: 1, expiresAt: "2026-09-22T12:00:00.000Z", revokedAt: null,
            } });
        }
        const task = s.get("task", "task-onboarding")!;
        s.update("task", task.id, task.revision, { ...task.data, internalOriginal: marker, internalMemo: marker,
            privateNested: { secret: marker }, unknownField: marker } as typeof task.data);
        const product = s.get("product", "product-serum")!;
        s.update("product", product.id, product.revision, { ...product.data,
            internalSupplyPrice: "1700", internalSupplyRate: "0.4", privateNested: { secret: marker } } as typeof product.data);
    });
    return new IdentityService(repo, () => NOW);
}
export function principal(service: IdentityService, store: UnitOfWork, userId: string) {
    return service.principal(store, tokenFor(userId));
}
