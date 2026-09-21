import type { AnalysisIssue, AnalysisState } from './records';
export interface AiCompletionItem {
  runId: string; revision: number; inputId: string; inputVersionId: string; extractionRunId: string;
  resultId: string | null; state: AnalysisState | 'interrupted'; issue: AnalysisIssue | null;
  unreviewedFindings: number | null; staleCorpus: boolean;
}
export interface AiCompletionRemainder { items: AiCompletionItem[]; failed: number; pending: number; unreviewedFindings: number }
