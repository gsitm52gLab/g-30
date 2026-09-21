import { CATEGORIES, REVIEW_SCHEMA, type Authority, type CorpusContent, type CorpusExcerpt, type CorpusRelease, type CorpusSelection, type CorpusTranslation, type CurrentSource, type SourceVersion } from './types';
import { array, contentHash, date, hash, id, integer, invalid, object, oneOf, sha256, text, unique } from './validate';

function source(value: unknown): SourceVersion {
  const v = object(value), authority = oneOf<Authority>(v.authority, ['statute', 'official_notification', 'industry_guidance']);
  const url = text(v.url, 2000); let parsed: URL;
  try { parsed = new URL(url); } catch { return invalid(); }
  // Publication is deployment-owned; a model cannot supply source authority or URLs.
  const host = authority === 'statute' ? 'laws.e-gov.go.jp' : authority === 'official_notification' ? 'www.mhlw.go.jp' : 'www.jcia.org';
  if (parsed.protocol !== 'https:' || parsed.hostname !== host || parsed.username || parsed.password || parsed.port) invalid();
  return { id: id(v.id), sourceId: id(v.sourceId), title: text(v.title), authority, bindingStatus: text(v.bindingStatus), revision: text(v.revision), effectiveDate: v.effectiveDate === null ? null : date(v.effectiveDate), url, originalHash: hash(v.originalHash), inspectedAsOf: date(v.inspectedAsOf), scope: text(v.scope, 3000), readScope: text(v.readScope, 3000) };
}
function pages(value: unknown): number[] | null {
  if (value === null) return null; const result = array(value, 20).map(p => integer(p, 1, 10_000));
  if (!result.length || new Set(result).size !== result.length) invalid(); return result;
}
function excerpt(value: unknown): CorpusExcerpt {
  const v = object(value), m = object(v.match), japanese = text(v.japanese, 500), japaneseHash = hash(v.japaneseHash);
  if (sha256(japanese) !== japaneseHash) invalid();
  const start = integer(m.start), end = integer(m.end), occurrence = integer(m.occurrence, 1), totalMatches = integer(m.totalMatches, 1);
  if (end - start !== [...japanese.replace(/\s/gu, '')].length || occurrence > totalMatches) invalid();
  const categories = array(v.categories, CATEGORIES.length).map(x => oneOf(x, CATEGORIES)); unique(categories);
  return { id: id(v.id), sourceVersionId: id(v.sourceVersionId), locator: text(v.locator), pdfPages: pages(v.pdfPages), printedPages: pages(v.printedPages), japanese, japaneseHash, contextNote: text(v.contextNote, 4000), categories,
    match: { containerHash: hash(m.containerHash), start, end, occurrence, totalMatches, offsets: oneOf(m.offsets, ['Unicode-code-points-with-layout-whitespace-removed']) } };
}
function translation(value: unknown): CorpusTranslation {
  const v = object(value), korean = text(v.korean, 2000), koreanHash = hash(v.koreanHash), status = oneOf(v.status, ['machine_unreviewed', 'human_reviewed']);
  if (sha256(korean) !== koreanHash || v.unofficial !== true) invalid();
  const reviewer = v.reviewer === null ? null : text(v.reviewer, 200), reviewedAt = v.reviewedAt === null ? null : text(v.reviewedAt, 40);
  if (status === 'machine_unreviewed' && (reviewer !== null || reviewedAt !== null) || status === 'human_reviewed' && (!reviewer || !reviewedAt || !/^\d{4}-\d{2}-\d{2}T/.test(reviewedAt) || Number.isNaN(Date.parse(reviewedAt)))) invalid();
  return { id: id(v.id), excerptId: id(v.excerptId), sourceVersionId: id(v.sourceVersionId), sourceHash: hash(v.sourceHash), japaneseHash: hash(v.japaneseHash), korean, koreanHash, version: text(v.version, 100), status, reviewer, reviewedAt, unofficial: true };
}
/** Explicit allowlist both validates deployment data and strips unknown stored extensions. */
export function createCorpusRelease(value: unknown): CorpusRelease {
  const v = object(value);
  if (v.schemaVersion !== REVIEW_SCHEMA) invalid();
  const sources = array(v.sources, 100).map(source).sort((a, b) => a.id.localeCompare(b.id));
  const excerpts = array(v.excerpts, 500).map(excerpt).sort((a, b) => a.id.localeCompare(b.id));
  const translations = array(v.translations, 500).map(translation).sort((a, b) => a.id.localeCompare(b.id));
  unique(sources.map(s => s.id)); unique(sources.map(s => s.sourceId)); unique(excerpts.map(e => e.id)); unique(translations.map(t => t.id)); unique(translations.map(t => t.excerptId));
  if (!sources.length || !excerpts.length) invalid();
  for (const e of excerpts) if (!sources.some(s => s.id === e.sourceVersionId)) invalid();
  for (const t of translations) {
    const e = excerpts.find(e => e.id === t.excerptId), s = sources.find(s => s.id === t.sourceVersionId);
    if (!e || !s || e.sourceVersionId !== s.id || t.sourceHash !== s.originalHash || t.japaneseHash !== e.japaneseHash) invalid();
  }
  const content: CorpusContent = { schemaVersion: REVIEW_SCHEMA, id: id(v.id), asOf: date(v.asOf), sources, excerpts, translations };
  return { ...content, manifestHash: contentHash(content) };
}
export function readCorpusRelease(value: unknown): CorpusRelease {
  const release = createCorpusRelease(value); if (hash(object(value).manifestHash) !== release.manifestHash) invalid(); return release;
}
/** Caller loads latest deployment source heads. A changed or unavailable head excludes old JP and KO. */
export function selectCurrentCorpus(value: unknown, heads: CurrentSource[]): CorpusSelection {
  const release = readCorpusRelease(value), current = array(heads, 100).map(x => { const v = object(x); return { sourceId: id(v.sourceId), id: id(v.id), originalHash: hash(v.originalHash) }; });
  unique(current.map(s => s.sourceId));
  const entries: CorpusSelection['entries'] = [], excludedStaleExcerptIds: string[] = [];
  for (const excerpt of release.excerpts) {
    const source = release.sources.find(s => s.id === excerpt.sourceVersionId)!;
    if (!current.some(s => s.sourceId === source.sourceId && s.id === source.id && s.originalHash === source.originalHash)) { excludedStaleExcerptIds.push(excerpt.id); continue; }
    entries.push({ source, excerpt, translation: release.translations.find(t => t.excerptId === excerpt.id) ?? null });
  }
  return { releaseId: release.id, manifestHash: release.manifestHash, entries, excludedStaleExcerptIds };
}
