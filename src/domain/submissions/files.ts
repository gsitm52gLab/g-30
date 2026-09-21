import type { AnswerInput, DraftContent } from './types';
export function answerFiles(answers: AnswerInput[]): string[] {
    return answers.flatMap(a => a.type === 'file' ? a.input.fileVersionIds : a.type === 'physical_record' ? a.input.evidenceFileVersionIds : a.type === 'link' && a.input.fixedReference?.kind === 'file' ? [a.input.fixedReference.fileVersionId] : []);
}
export function contentFiles(d: DraftContent): string[] { return [...new Set([...answerFiles(d.answers), ...d.artifacts.map(a => a.fileVersionId), ...d.links.flatMap(l => l.fixedReference?.kind === 'file' ? [l.fixedReference.fileVersionId] : [])])]; }
