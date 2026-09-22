export const searchKinds = ['task', 'project', 'template', 'product', 'submission', 'notice', 'inquiry', 'evidence', 'import', 'correction', 'campaign', 'completion', 'schedule', 'notification', 'analysis', 'corpus'] as const;
export type SearchKind = typeof searchKinds[number];
export interface SearchQuery {
    context: string;
    q: string;
    kind: SearchKind | '';
    mode: 'current' | 'history';
    product: string;
    sku: string;
    jan: string;
    task: string;
    status: string;
    actor: string;
    assignee: string;
    from: string;
    to: string;
    page: number;
    pageSize: number;
}
export interface SearchField {
    label: string;
    value: string;
}
export interface SearchFile {
    id: string;
    name: string;
    downloadUrl: string;
    previewUrl: string | null;
}
export interface CurrentAssignee {
    id: string;
    label: string;
    role: 'primary_brand' | 'co_brand' | 'gsg_owner';
    scope: 'current_related_task';
}
export interface SearchHit {
    assignees: CurrentAssignee[];
    key: string;
    kind: SearchKind;
    sourceKind: string;
    sourceId: string;
    rootId: string;
    contextId: string;
    title: string;
    snippet: string;
    status: string;
    statusPrecision: 'current' | 'historical' | 'unavailable';
    actor: {
        id: string | null;
        label: string;
    };
    occurredAt: string | null;
    isCurrent: boolean;
    versionLabel: string | null;
    sourcePrecision: 'exact_version' | 'current_record' | 'legacy_unavailable';
    historyUrl: string;
    sourceUrl: string;
    sourceUrlPrecision: 'exact_version' | 'related_current';
}
export interface SearchDocument extends SearchHit {
    fields: SearchField[];
    files: SearchFile[];
    productIds: string[];
    taskId: string | null;
    sku: string[];
    jan: string[];
}
export interface SearchList {
    query: SearchQuery;
    items: SearchHit[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
    filters: {
        kinds: SearchKind[];
        statuses: string[];
        assignees: {
            id: string;
            label: string;
        }[];
        actors: {
            id: string;
            label: string;
        }[];
    };
    capabilities: {
        audit: boolean;
    };
    notice: string;
}
export interface SearchDetail {
    item: SearchHit;
    fields: SearchField[];
    files: SearchFile[];
    notice: string;
}
