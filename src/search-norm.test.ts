import { describe, expect, it } from 'vitest';
import { buildMatcher } from './find';
import { findInNormalized, normalizeForSearch, normalizeWithMap } from './search-norm';

const opts = { regex: false, caseSensitive: false, wholeWord: false };
/** Matches of `query` in `source`, as the source text they cover. */
function hits(source: string, query: string): string[] {
  const n = normalizeWithMap(source);
  const matcher = buildMatcher(normalizeForSearch(query), opts);
  return findInNormalized(n, matcher).map((m) => source.slice(m.start, m.end));
}

describe('normalizeForSearch (NFKC + lowercase)', () => {
  it('folds width, half-width kana and case', () => {
    expect(normalizeForSearch('ＡＢＣ')).toBe('abc');
    expect(normalizeForSearch('ｶﾞｷﾞ')).toBe('ガギ');
    expect(normalizeForSearch('Hello')).toBe('hello');
  });
  it('composes a voiced mark typed as its own character', () => {
    expect(normalizeForSearch('が')).toBe('が');
  });
});

describe('search across forms', () => {
  it('full-width text is found by a half-width query, and the other way round', () => {
    expect(hits('Ｒｕｓｔ の本', 'rust')).toEqual(['Ｒｕｓｔ']);
    expect(hits('rust の本', 'ＲＵＳＴ')).toEqual(['rust']);
  });
  it('half-width kana and kana match each other, highlighting the original characters', () => {
    expect(hits('ｶﾞｲﾄﾞ を読む', 'ガイド')).toEqual(['ｶﾞｲﾄﾞ']);
    expect(hits('ガイド を読む', 'ｶﾞｲﾄﾞ')).toEqual(['ガイド']);
  });
  it('a decomposed voiced kana matches the composed one', () => {
    expect(hits('がく', 'がく')).toEqual(['がく']);
  });
  it('plain substring search still works, including in the middle of Japanese', () => {
    expect(hits('日本語の全文検索エンジン', '索エン')).toEqual(['索エン']);
  });
  it('a length-changing character maps back to the single source character', () => {
    // ㈱ normalizes to (株) — three units — but is one character in the document.
    expect(hits('㈱MrShip', '(株)')).toEqual(['㈱']);
    const n = normalizeWithMap('㈱MrShip');
    expect(n.text).toBe('(株)mrship');
  });
  it('offsets stay correct after a length-changing character', () => {
    const src = 'ｶﾞ→target';
    const n = normalizeWithMap(src);
    const [m] = findInNormalized(n, buildMatcher('target', opts));
    expect(src.slice(m.start, m.end)).toBe('target');
  });
  it('a hit covering part of a cluster is widened to the whole cluster', () => {
    // 株 sits in the middle of the normalized (株); in the document it is inside the single ㈱
    expect(hits('x㈱y', '株')).toEqual(['㈱']);
  });
  it('voiced and unvoiced kana stay different (NFKC does not fold them)', () => {
    expect(hits('ｶﾞ', 'ｶ')).toEqual([]);
    expect(hits('カ', 'ガ')).toEqual([]);
  });
  it('ASCII needs no mapping and keeps offsets', () => {
    const n = normalizeWithMap('Hello World');
    expect(n.from).toBeNull();
    expect(hits('Hello World', 'WORLD')).toEqual(['World']);
  });
});
