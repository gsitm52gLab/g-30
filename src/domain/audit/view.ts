import type { SearchField, SearchQuery } from '../search/types';
export interface AuditItem {
    id: string;
    contextId: string | null;
    action: string;
    label: string;
    occurredAt: string;
    actor: {
        id: string | null;
        label: string;
    };
    target: {
        id: string;
        title: string;
        url: string | null;
    };
    operationId: string | null;
    receiptId: string | null;
    eventIds: string[];
    correlation: 'recorded' | 'legacy_unavailable';
    sourcePrecision: 'exact' | 'record_only' | 'legacy_unavailable';
    changes: {
        label: string;
        before: string;
        after: string;
    }[];
    versions: {
        label: string;
        kind: string;
        id: string;
        url: string;
        role: 'before' | 'after' | 'source';
    }[];
    fields: SearchField[];
    notice: string;
}
export interface AuditList {
    query: Omit<SearchQuery, 'mode'>;
    items: AuditItem[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
    filters: {
        actions: {
            value: string;
            label: string;
        }[];
        actors: {
            id: string;
            label: string;
        }[];
    };
    readOnly: true;
}
