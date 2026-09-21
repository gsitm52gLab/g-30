import type { Location } from '../ai-input/types';

export const REVIEW_SCHEMA = 'gs-hale-ai-review/1' as const;
export const CATEGORIES = ['YK-01', 'YK-02', 'YK-03', 'YK-05', 'YK-06', 'YK-07', 'YK-09', 'YK-10', 'YK-11', 'YK-12', 'TR-01', 'EV-01'] as const;
export type Category = typeof CATEGORIES[number];
export type Authority = 'statute' | 'official_notification' | 'industry_guidance';
export type TranslationStatus = 'machine_unreviewed' | 'human_reviewed';
export type SourceVersion = {
  id: string; sourceId: string; title: string; authority: Authority; bindingStatus: string;
  revision: string; effectiveDate: string | null; url: string; originalHash: string;
  inspectedAsOf: string; scope: string; readScope: string;
};
export type CorpusExcerpt = {
  id: string; sourceVersionId: string; locator: string; pdfPages: number[] | null;
  printedPages: number[] | null; japanese: string; japaneseHash: string; contextNote: string;
  categories: Category[];
  match: { containerHash: string; start: number; end: number; occurrence: number; totalMatches: number; offsets: 'Unicode-code-points-with-layout-whitespace-removed' };
};
export type CorpusTranslation = {
  id: string; excerptId: string; sourceVersionId: string; sourceHash: string; japaneseHash: string;
  korean: string; koreanHash: string; version: string; status: TranslationStatus;
  reviewer: string | null; reviewedAt: string | null; unofficial: true;
};
export type CorpusContent = { schemaVersion: typeof REVIEW_SCHEMA; id: string; asOf: string; sources: SourceVersion[]; excerpts: CorpusExcerpt[]; translations: CorpusTranslation[] };
export type CorpusRelease = CorpusContent & { manifestHash: string };
export type CurrentSource = Pick<SourceVersion, 'sourceId' | 'id' | 'originalHash'>;
export type CorpusEntry = { source: SourceVersion; excerpt: CorpusExcerpt; translation: CorpusTranslation | null };
export type CorpusSelection = { releaseId: string; manifestHash: string; entries: CorpusEntry[]; excludedStaleExcerptIds: string[] };
export type Citation = CorpusEntry & { channel: 'legal_basis' | 'supporting_guidance' };
export type QuoteRequest = { segmentId: string; start: number; end: number; quote: string };
export type VerifiedQuote = QuoteRequest & { textStart: number; textEnd: number; location: Location; locationGranularity: 'text_range' | 'segment_box' | 'segment_page'; sourceHash: string; snapshotHash: string; coverage: string; segmentConfidence: number | null };
export type Risk = 'low' | 'medium' | 'high' | 'unknown';
export type Finding = {
  id: string; category: Category; original: VerifiedQuote; risk: Risk; confidence: number | null;
  reason: string; additionalInformation: string[]; suggestion: string | null;
  legalBasis: Citation[]; supportingGuidance: Citation[];
  evidenceStatus: 'confirmed_locator' | 'unconfirmed'; unconfirmedCitationCount: number;
  humanReviewRequired: true;
};
export type ResultIssue = 'QUOTE_UNCONFIRMED' | 'CATEGORY_UNSUPPORTED' | 'FINDING_MALFORMED';
export type ValidatedResult = {
  schemaVersion: typeof REVIEW_SCHEMA; status: 'candidates' | 'no_candidates' | 'unconfirmed' | 'out_of_scope' | 'unread';
  findings: Finding[]; quarantined: { index: number; issue: ResultIssue }[];
  rawHash: string; corpusReleaseId: string; corpusManifestHash: string; inputSnapshotHash: string;
  limitations: ('PARTIAL_EXTRACTION' | 'CORPUS_UNAVAILABLE' | 'UNREVIEWED_TRANSLATION')[];
  requiresHumanReview: true; legalApproval: false;
};
export type AnalysisIdentity = {
  inputId: string; inputVersionId: string; extractionRunId: string; extractionSnapshotId: string;
  snapshotHash: string; corpusReleaseId: string; corpusManifestHash: string;
  engine: 'synthetic_demo' | 'provider'; modelId: string; promptVersion: string;
};
export type HumanReviewCommand = { findingId: string; expectedRevision: number; decision: 'accept' | 'edit' | 'reject'; reason: string; editedSuggestion: string | null };
