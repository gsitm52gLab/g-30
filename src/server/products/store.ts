import { appendAudit, auditOperation } from '@/server/audit/writer';
import { createHash, randomUUID } from "node:crypto";
import type { Clock, StoredRecord, UnitOfWork } from "@/domain/records";
import type { Principal } from "@/server/auth/service";
import { revision } from "@/server/auth/service";
import { fail } from "@/server/auth/errors";
import { str } from "@/domain/tasks/validate";
import { normalizeProductCode, type ProductCommon, type ProductContextFields, type ProductFileBinding } from "@/domain/products/types";
export const newId = () => randomUUID();
export function fresh(row: {
    revision: number;
} | null, expected: unknown) {
    const expectedValue = expected === 0 ? 0 : revision(expected);
    if ((row?.revision ?? 0) !== expectedValue)
        fail("CONFLICT", 409, "자료가 변경되었거나 저장 조건이 맞지 않습니다. 입력을 유지한 채 최신 내용을 확인해 주세요.");
}
export async function uniqueCode(s: UnitOfWork, contextId: string, code: string, productId?: string) {
    if ((await s.list("contextProduct", contextId)).some(r => r.data.productId !== productId && r.data.normalizedCode === normalizeProductCode(code)))
        fail("CONFLICT", 409, "자료가 변경되었거나 저장 조건이 맞지 않습니다. 입력을 유지한 채 최신 내용을 확인해 주세요.");
}
export function provenance(p: Principal, clock: Clock, sequence = 1, previousId: string | null = null, source = "사용자 입력") { return { sequence, previousId, changedBy: p.user.id, changedAt: clock(), source }; }
export async function receipt(s: UnitOfWork, p: Principal, contextId: string, command: string, input: Record<string, unknown>, action: () => {
    ids: string[];
} | Promise<{
    ids: string[];
}>, fault?: () => void) {
    const key = createHash("sha256").update(`${p.user.id}:${contextId}:${command}:${str(input.idempotencyKey, 160, true)}`).digest("hex"), bodyHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const old = (await s.list("commandReceipt")).find(r => r.data.key === key);
    if (old) {
        if (old.data.bodyHash !== bodyHash)
            fail("CONFLICT", 409, "같은 재시도 키에 다른 내용을 사용할 수 없습니다.");
        return { ids: Array.isArray(old.data.result?.ids) ? old.data.result.ids.filter((value): value is string => typeof value === "string") : [] };
    }
    const receiptId = newId();
    const result = (await auditOperation(s, receiptId, action));
    fault?.();
    (await s.create("commandReceipt", { id: receiptId, contextId, data: { key, bodyHash, command, actorId: p.user.id, result } }));
    return result;
}
export async function audit(s: UnitOfWork, p: Principal, clock: Clock, contextId: string, action: string, targetId: string, before: Record<string, unknown>, after: Record<string, unknown>, detail?: Parameters<typeof appendAudit>[8]) {
    return (await appendAudit(s, p, clock, contextId, action, targetId, before, after, detail));
}
export async function commonVersion(s: UnitOfWork, p: Principal, clock: Clock, product: StoredRecord<"product">, common: ProductCommon, archived: boolean, source = "사용자 입력") {
    const old = product.data.currentVersionId ? (await s.get("productVersion", product.data.currentVersionId)) : null;
    const version = (await s.create("productVersion", { id: newId(), contextId: null, data: { productId: product.id, common, archived, ...provenance(p, clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null, source) } }));
    (await s.update("product", product.id, product.revision, { ...product.data, currentVersionId: version.id, name: common.name, code: common.code, category: common.category, size: common.capacity.raw || [common.capacity.amount, common.capacity.unit].filter(Boolean).join(" "), status: archived ? "archived" : "active", archivedAt: archived ? clock() : null }));
    return version;
}
export async function contextVersion(s: UnitOfWork, p: Principal, clock: Clock, cp: StoredRecord<"contextProduct">, fields: ProductContextFields, files: ProductFileBinding[], source = "사용자 입력") {
    const old = cp.data.currentVersionId ? (await s.get("contextProductVersion", cp.data.currentVersionId)) : null;
    const version = (await s.create("contextProductVersion", { id: newId(), contextId: cp.contextId, data: { contextProductId: cp.id, fields, files, ...provenance(p, clock, (old?.data.sequence ?? 0) + 1, old?.id ?? null, source) } }));
    (await s.update("contextProduct", cp.id, cp.revision, { ...cp.data, currentVersionId: version.id }));
    return version;
}
