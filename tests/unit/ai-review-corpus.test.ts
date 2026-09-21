import { describe, expect, it } from 'vitest';
import data from '@/domain/ai-review/curated.json';
import { curatedRelease } from '@/domain/ai-review/curated';
import { createCorpusRelease, readCorpusRelease, selectCurrentCorpus } from '@/domain/ai-review/corpus';
import { CATEGORIES } from '@/domain/ai-review/types';
import { sha256 } from '@/domain/ai-review/validate';

describe('G16 pure curated corpus, not publication or legal accuracy', () => {
  it('binds 6 inspected sources, 16 exact excerpts and 16 unofficial/unreviewed alignments', () => {
    const r = curatedRelease();
    expect(r.sources).toHaveLength(6); expect(r.excerpts).toHaveLength(16); expect(r.translations).toHaveLength(16);
    expect(r.sources.find(s => s.sourceId === 'egov66')).toMatchObject({ revision: '335AC0000000145_20260521_505AC0000000063', effectiveDate: '2026-05-21' });
    for (const t of r.translations) expect(t).toMatchObject({ status: 'machine_unreviewed', reviewer: null, reviewedAt: null, unofficial: true });
    expect(selectCurrentCorpus(r, r.sources).entries).toHaveLength(16);
    expect(CATEGORIES).not.toContain('YK-04'); expect(CATEGORIES).not.toContain('YK-08');
  });
  it('retains exact repeated-phrase occurrence, PDF and printed page distinctions', () => {
    const r = curatedRelease();
    expect(r.excerpts.find(e => e.id === 'std4-3-7')?.match.occurrence).toBe(3);
    expect(r.excerpts.find(e => e.id === 'std4-3-6')?.match.occurrence).toBe(2);
    expect(r.excerpts.find(e => e.id === 'jcia-F8-2')).toMatchObject({ pdfPages: [15], printedPages: [26] });
    expect(r.excerpts.find(e => e.id === 'jcia-E7-1')).toMatchObject({ pdfPages: [17], printedPages: [31] });
    expect(r.excerpts.filter(e => e.sourceVersionId.startsWith('jcia')).reduce((sum, e) => sum + [...e.japanese].length, 0)).toBe(32);
  });
  it('separates statutory, ministry and voluntary authority without inferred effective dates', () => {
    const r = curatedRelease();
    expect(r.sources.find(s => s.sourceId === 'jcia2026')).toMatchObject({ authority: 'industry_guidance', bindingStatus: 'industry_voluntary_guidance_not_statute', effectiveDate: null });
    expect(r.sources.find(s => s.sourceId === 'handling2011')?.readScope).toContain('appendix3–4');
    expect(r.excerpts.find(e => e.id === 'jcia-F8-2')?.contextNote).toContain('판매 No.1');
    expect(r.excerpts.find(e => e.id === 'ingredient-I-1-1')?.contextNote).toContain('1985');
  });
  it('excludes changed source versions and KO from current retrieval; historical release is byte-identical', () => {
    const r = curatedRelease(), before = JSON.stringify(r), heads = structuredClone(r.sources);
    const old = heads.find(s => s.sourceId === 'egov66')!; old.id += '-revised'; old.originalHash = sha256('synthetic revision');
    const selected = selectCurrentCorpus(r, heads);
    expect(selected.excludedStaleExcerptIds).toEqual(['law66-p1', 'law66-p2']);
    expect(selected.entries).toHaveLength(14); expect(selected.entries.some(e => e.source.sourceId === 'egov66')).toBe(false);
    expect(JSON.stringify(r)).toBe(before); expect(readCorpusRelease(r).translations.filter(t => t.excerptId.startsWith('law66'))).toHaveLength(2);
  });
  it('hash changes alone, missing heads and conflicting heads fail closed', () => {
    const r = curatedRelease(), heads = structuredClone(r.sources); heads[0].originalHash = sha256('changed bytes');
    expect(selectCurrentCorpus(r, heads).excludedStaleExcerptIds.length).toBeGreaterThan(0);
    expect(selectCurrentCorpus(r, []).entries).toEqual([]);
    expect(() => selectCurrentCorpus(r, [...r.sources, r.sources[0]])).toThrow('CORPUS_INVALID');
  });
  it('rejects falsely aligned source/excerpt/KO hashes and fake human review stamps', () => {
    for (const field of ['sourceHash', 'japaneseHash', 'koreanHash'] as const) {
      const changed = structuredClone(data); changed.translations[0][field] = sha256('wrong');
      expect(() => createCorpusRelease(changed)).toThrow('CORPUS_INVALID');
    }
    const changed = structuredClone(data); changed.translations[0].status = 'human_reviewed';
    expect(() => createCorpusRelease(changed)).toThrow('CORPUS_INVALID');
  });
  it('rejects nested known scalar corruption while projecting valid unknown stored extensions', () => {
    const r = curatedRelease(), bad = { ...r, sources: [{ ...r.sources[0], revision: { private: 'CANARY' } }, ...r.sources.slice(1)] };
    expect(() => readCorpusRelease(bad)).toThrow('CORPUS_INVALID');
    const extended = { ...r, private: { token: 'CANARY' }, excerpts: r.excerpts.map(e => ({ ...e, private: { price: 'CANARY' } })) };
    expect(readCorpusRelease(extended)).toEqual(r); expect(JSON.stringify(readCorpusRelease(extended))).not.toContain('CANARY');
    expect(extended.private.token).toBe('CANARY');
  });
  it('deterministically orders input arrays and detects stored manifest tampering', () => {
    const reordered = structuredClone(data); reordered.sources.reverse(); reordered.excerpts.reverse(); reordered.translations.reverse();
    expect(createCorpusRelease(reordered)).toEqual(curatedRelease());
    const changed = curatedRelease(); changed.excerpts[0].contextNote += ' altered';
    expect(() => readCorpusRelease(changed)).toThrow('CORPUS_INVALID');
  });
  it('does not admit retailer/fake-host sources as official legal authority', () => {
    for (const url of ['https://www.mhlw.go.jp.evil.test/notice', 'https://evil.test/', 'javascript:alert(1)', 'https://x:secret@laws.e-gov.go.jp/law/1']) {
      const changed = structuredClone(data); changed.sources[0].url = url;
      expect(() => createCorpusRelease(changed)).toThrow('CORPUS_INVALID');
    }
    const changed = structuredClone(data); changed.sources[0].authority = 'retailer_opinion';
    expect(() => createCorpusRelease(changed)).toThrow('CORPUS_INVALID');
  });
});
