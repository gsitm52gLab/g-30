import type { PriorSubmissionData, RequestContent } from "./types";
/** Evidence port consumed by G05 later; no production submission writer in G04. */
export function evaluateRequirements(current: RequestContent, prior: PriorSubmissionData | null, previous: RequestContent | null) {
    return current.requirements.flatMap(q => (q.productIds.length ? q.productIds : [null]).map(productId => {
        const answer = prior?.answers.find(a => a.requirementKey === q.key && a.productId === productId);
        const condition = q.condition;
        const selected = condition ? prior?.answers.find(a => a.requirementKey === condition.key && (a.productId === productId || a.productId === null))?.value : null;
        const applicable = !condition || selected === condition.equals || Array.isArray(selected) && selected.includes(condition.equals);
        const old = previous?.requirements.find(r => r.key === q.key);
        const changed = !!answer && (!old || old.type !== q.type || JSON.stringify(old.productIds) !== JSON.stringify(q.productIds) || JSON.stringify(old.specifications) !== JSON.stringify(q.specifications) || JSON.stringify(old.options) !== JSON.stringify(q.options) || old.unit !== q.unit);
        const present = !!answer && (answer.fileVersionIds.length > 0 || answer.value !== null && answer.value !== undefined && String(answer.value).trim() !== "");
        return { requirementKey: q.key, productId, label: q.label, status: !applicable ? "not_applicable" : changed ? "needs_reconfirmation" : present ? "prior_received" : q.required ? "missing" : "optional", humanReviewPending: applicable && q.specifications.some(s => s.check === "human"), sourceRequestId: answer ? prior!.requestId : null };
    }));
}
