import type { ImportService } from './service';
export type { PreviewInput, ImportPreview, PreviewRow, Mapping, RowChoice, ImportError } from '@/domain/imports/types';
export type ImportConfiguration = Awaited<ReturnType<ImportService['configuration']>>;
export type WorkbookInspection = Awaited<ReturnType<ImportService['inspect']>>;
export type ImportBatch = Awaited<ReturnType<ImportService['batch']>>;
export interface ApplyImport {
    previewId: string;
    idempotencyKey: string;
}
