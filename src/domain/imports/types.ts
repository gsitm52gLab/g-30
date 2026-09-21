export const IMPORT_SCHEMA = 'gs-hale-products-v1';
export const importLimits = { inputBytes: 10 * 1024 * 1024, entries: 512, sheets: 20, entryBytes: 32 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, cells: 300000, rows: 5000, columns: 100, text: 32767, pageSize: 100, timeoutMs: 10000, oldSpaceMiB: 256 } as const;
export type ImportAction = 'new' | 'update' | 'skip';
export interface Mapping {
    column: number;
    field: string;
}
export interface RowChoice {
    row: number;
    action: ImportAction;
    clearFields: string[];
}
export interface ImportError {
    code: string;
    message: string;
    column: number | null;
    field: string | null;
}
export interface ParsedCell {
    column: number;
    type: 'text' | 'number' | 'date' | 'boolean' | 'empty' | 'error';
    text: string;
    error: string | null;
    hidden: boolean;
}
export interface ParsedRow {
    row: number;
    hidden: boolean;
    cells: ParsedCell[];
}
export interface ParsedSheet {
    id: number;
    name: string;
    hidden: false;
    rows: ParsedRow[];
    mergedRanges: string[];
}
export interface ParsedWorkbook {
    sheets: ParsedSheet[];
    omittedHiddenSheets: number;
    date1904: boolean;
}
export interface ExpectedProduct {
    productId: string;
    contextProductId: string;
    commonRevision: number;
    contextRevision: number;
    retailRevision: number;
    internalRevision?: number;
}
export interface PreviewRow {
    row: number;
    action: ImportAction;
    raw: Record<string, string>;
    normalized: Record<string, string | null | boolean>;
    errors: ImportError[];
    target: ExpectedProduct | null;
    visibleContexts: {
        id: string;
        country: string;
        retailer: string;
        brand: string;
    }[];
}
export interface PreviewInput {
    sourceId: string;
    sheetId: number;
    headerRow: number;
    mapping: Mapping[];
    choices: RowChoice[];
}
export interface ImportPreview {
    id: string;
    contextId: string;
    sourceHash: string;
    schema: string;
    createdAt: string;
    expiresAt: string;
    sheetId: number;
    sheetName: string;
    headerRow: number;
    mapping: Mapping[];
    totalRows: number;
    errorRows: number;
    canApply: boolean;
    page: number;
    pageSize: number;
    rows: PreviewRow[];
    counts: {
        new: number;
        update: number;
        skip: number;
    };
    sharedCommonNotice: string;
    warnings: string[];
}
export interface ImportBatchData {
    actorId: string;
    appliedAt: string;
    sourceHash: string;
    sourceName: string;
    schema: string;
    previewId: string;
    sheetId: number;
    sheetName: string;
    headerRow: number;
    mapping: Mapping[];
    includesInternalPrice: boolean;
    rows: {
        row: number;
        action: ImportAction;
        productId: string | null;
        contextProductId: string | null;
        versionIds: string[];
        expected: ExpectedProduct | null;
    }[];
}
