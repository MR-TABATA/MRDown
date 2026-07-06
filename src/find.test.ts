import { describe, it, expect } from 'vitest';
import { buildMatcher, findMatches, sliceMatches, type FindOpts } from './find';

const opts = (o: Partial<FindOpts> = {}): FindOpts => ({
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  ...o,
});

// Convenience: run a query over `hay` and return the matched substrings.
function hits(hay: string, query: string, o: Partial<FindOpts> = {}): string[] {
  return findMatches(hay, buildMatcher(query, opts(o))).map((m) => hay.slice(m.start, m.end));
}

describe('buildMatcher', () => {
  it('returns null for an empty query', () => {
    expect(buildMatcher('', opts())).toBeNull();
  });
  it('returns null for an invalid regex', () => {
    expect(buildMatcher('(', opts({ regex: true }))).toBeNull();
  });
  it('treats a literal query literally, escaping regex metachars', () => {
    expect(hits('a.b axb', 'a.b')).toEqual(['a.b']);
  });
});

describe('findMatches', () => {
  it('finds all non-overlapping occurrences', () => {
    expect(hits('banana', 'an')).toEqual(['an', 'an']);
  });
  it('is case-insensitive by default and case-sensitive on request', () => {
    expect(hits('Cat cat CAT', 'cat')).toEqual(['Cat', 'cat', 'CAT']);
    expect(hits('Cat cat CAT', 'cat', { caseSensitive: true })).toEqual(['cat']);
  });
  it('matches whole words only when asked', () => {
    expect(hits('cat category scatter', 'cat')).toEqual(['cat', 'cat', 'cat']);
    expect(hits('cat category scatter', 'cat', { wholeWord: true })).toEqual(['cat']);
  });
  it('honors regex mode', () => {
    expect(hits('a1 b22 c333', '\\d+', { regex: true })).toEqual(['1', '22', '333']);
  });
  it('does not spin on zero-length matches', () => {
    expect(hits('aXbXc', 'X*', { regex: true }).length).toBeGreaterThan(0);
    expect(findMatches('aa', buildMatcher('a*', opts({ regex: true }))).length).toBeLessThan(10);
  });
});

describe('sliceMatches', () => {
  // Preview "bold text" split as <strong>bold</strong> + " text" → nodes
  // "bold" (0..4) and " text" (4..9). "d t" spans the tag boundary.
  const segs = [
    { start: 0, len: 4 },
    { start: 4, len: 5 },
  ];
  it('keeps a within-segment match in one slice', () => {
    expect(sliceMatches(segs, [{ start: 0, end: 4 }])).toEqual([{ seg: 0, s: 0, e: 4, mid: 0 }]);
  });
  it('splits a tag-spanning match across segments, sharing a match id', () => {
    expect(sliceMatches(segs, [{ start: 3, end: 6 }])).toEqual([
      { seg: 0, s: 3, e: 4, mid: 0 },
      { seg: 1, s: 0, e: 2, mid: 0 },
    ]);
  });
  it('tags slices with their originating match index', () => {
    const out = sliceMatches(segs, [
      { start: 0, end: 2 },
      { start: 5, end: 7 },
    ]);
    expect(out.map((o) => o.mid)).toEqual([0, 1]);
  });
});
