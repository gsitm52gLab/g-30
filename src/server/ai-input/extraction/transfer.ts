import type { CurrentTransferDecision, ExtractionSnapshot, SourceIdentity } from "../../../domain/ai-input/types";
import { snapshotHash } from "./index";
/** This callback must load current server grants, source provenance and a persisted server-owned extraction hash; a client attestation is not a resolver. */
export type CurrentAuthorization = (source: Readonly<SourceIdentity>, extractionHash: string) => Promise<CurrentTransferDecision>;
export type TransferResult = {
    allowed: false;
    reason: "SNAPSHOT_INVALID" | "NO_READABLE_INPUT" | "CURRENT_ACCESS_DENIED" | "EXTERNAL_USE_DENIED" | "TOKEN_LIMIT";
} | {
    allowed: true;
    payload: {
        extractionHash: string;
        text: string;
        segments: ExtractionSnapshot["segments"];
        unread: ExtractionSnapshot["units"];
        requiresHumanReview: true;
    };
    technicalEstimate: {
        utf8Bytes: number;
        modelTokenizer: null;
        modelValidationRequired: true;
    };
    providerCalled: false;
};
/** Use only a server-owned persisted snapshot. Re-run immediately before a provider call; this is not a reusable grant. */
export async function prepareExternalTransfer(snapshot: ExtractionSnapshot, authorizeCurrent: CurrentAuthorization): Promise<TransferResult> {
    const { snapshotHash: expected, ...body } = snapshot;
    if (snapshotHash(body) !== expected)
        return { allowed: false, reason: "SNAPSHOT_INVALID" };
    if (!["read", "partial"].includes(snapshot.status) || !snapshot.text || !snapshot.segments.length)
        return { allowed: false, reason: "NO_READABLE_INPUT" };
    for (const source of snapshot.sources) {
        let grant: CurrentTransferDecision;
        try {
            grant = await authorizeCurrent(source, expected);
        }
        catch {
            return { allowed: false, reason: "CURRENT_ACCESS_DENIED" };
        }
        if (!grant || grant.verifiedSnapshotHash !== expected || !grant.currentReadAllowed || !Number.isFinite(Date.parse(grant.checkedAt)) || Object.keys(source).some(key => source[key as keyof SourceIdentity] !== grant[key as keyof SourceIdentity]))
            return { allowed: false, reason: "CURRENT_ACCESS_DENIED" };
        if (!grant.externalUseAllowed || !["synthetic", "licensed_public"].includes(grant.provenance))
            return { allowed: false, reason: "EXTERNAL_USE_DENIED" };
    }
    const payload = { extractionHash: expected, text: snapshot.text, segments: snapshot.segments, unread: snapshot.units.filter(u => u.status === "partial" || u.status === "unread"), requiresHumanReview: true as const };
    const utf8Bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (utf8Bytes > snapshot.tokenEstimate.limit)
        return { allowed: false, reason: "TOKEN_LIMIT" };
    return { allowed: true, payload, technicalEstimate: { utf8Bytes, modelTokenizer: null, modelValidationRequired: true }, providerCalled: false };
}
