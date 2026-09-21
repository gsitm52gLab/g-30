import type { PriorSubmissionData, RequestContent } from "./types";
/** Evidence port consumed by G05 later; no production submission writer in G04. */
export function evaluateRequirements(current: RequestContent, prior: PriorSubmissionData | null, previous: RequestContent | null) {
    function applicable(key: string, productId: string | null, seen = new Set<string>()): boolean {
        const q = current.requirements.find(r => r.key === key);
        if (!q || seen.has(key) || q.productIds.length && (!productId || !q.productIds.includes(productId))) return false;
        if (!q.condition) return true;
        const parent = current.requirements.find(r => r.key === q.condition!.key);
        if (!parent) return false;
        const parentProduct = parent.productIds.length ? productId : null;
        if (!applicable(parent.key, parentProduct, new Set(seen).add(key))) return false;
        const selected = prior?.answers.find(a => a.requirementKey === parent.key && a.productId === parentProduct)?.value;
        return selected === q.condition.equals || Array.isArray(selected) && selected.includes(q.condition.equals);
    }
    return current.requirements.flatMap(q => (q.productIds.length ? q.productIds : [null]).map(productId => {
        const answer = prior?.answers.find(a => a.requirementKey === q.key && a.productId === productId);
        const applies = applicable(q.key, productId);
        const old = previous?.requirements.find(r => r.key === q.key);
        const changed = !!answer && (!old || old.type !== q.type || JSON.stringify(old.productIds) !== JSON.stringify(q.productIds) || JSON.stringify(old.specifications) !== JSON.stringify(q.specifications) || JSON.stringify(old.options) !== JSON.stringify(q.options) || old.unit !== q.unit);
        const present = !!answer && (answer.fileVersionIds.length > 0 || answer.value !== null && answer.value !== undefined && String(answer.value).trim() !== "");
        return { requirementKey: q.key, productId, label: q.label, status: !applies ? "not_applicable" : changed ? "needs_reconfirmation" : present ? "prior_received" : q.required ? "missing" : "optional", humanReviewPending: applies && q.specifications.some(s => s.check === "human"), sourceRequestId: answer ? prior!.requestId : null };
    }));
}
