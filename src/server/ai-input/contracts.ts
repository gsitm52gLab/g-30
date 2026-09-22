export type { AiContent, AiVisibility, AssetReference, SubmissionReference, ProductReference, RunState } from '@/domain/ai-input/records';
export type { ExtractionSnapshot, Scope, IssueCode } from '@/domain/ai-input/types';
export type { AiInputDetail } from './read';
export type AiSourcePicker = Awaited<ReturnType<typeof import('./sources').sourcePicker>>;
export type AiAsset = ReturnType<typeof import('./assets').assetDTO>;
export type AiInputList = Awaited<ReturnType<import('./service').AiInputService['list']>>;
