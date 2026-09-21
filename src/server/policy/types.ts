/** Server-derived metadata, never a request body or client capability. */
export interface ResourceScope {
    id: string;
    contextId: string | null;
    kind: "notice" | "context" | "membership" | "task" | "product" | "inquiry" | "file" | "search" | "export" | "notification" | "audit" | "ai_input" | "ai_result" | "account";
    visibility: "public" | "internal" | "draft";
    /** Private inquiry drafts are restricted even for GSG administrators. */
    privateOwnerId?: string;
    assigneeUserId?: string;
    coAssigneeUserIds?: readonly string[];
    recipientUserId?: string;
    /** Server-derived notice audience; undefined means all current members. */
    audienceUserIds?: readonly string[];
    requiresInternalPrice?: boolean;
    sourceScopes?: readonly ResourceScope[];
    /** Both scopes are mandatory for file access. Values come from stored references. */
    originalScope?: ResourceScope;
    referenceScope?: ResourceScope;
}

export const actionKinds = {
    "notice.read": "notice", "notice.manage": "notice",
    "context.read": "context", "context.create": "context",
    "membership.manage": "membership", "account.manage": "account",
    "task.read": "task", "task.manage": "task", "submission.write": "task", "task.complete": "task",
    "product.read": "product", "product.edit": "product", "price.read": "product",
    "inquiry.create": "inquiry", "inquiry.read": "inquiry", "inquiry.write": "inquiry", "inquiry.manage": "inquiry",
    "file.original": "file", "file.preview": "file", "file.download": "file",
    "search.read": "search", "export.read": "export", "notification.read": "notification",
    "audit.read": "audit", "ai.input.read": "ai_input", "ai.result.read": "ai_result",
} as const;
export type Action = keyof typeof actionKinds;
export type Decision = { allowed: true; internalFields: boolean; internalPrice: boolean } |
    { allowed: false; status: 401 | 403 | 404 };

export function contextResource(contextId: string): ResourceScope {
    return { id: contextId, contextId, kind: "context", visibility: "public" };
}
