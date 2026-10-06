// Search normalization: NFKC + lowercase, applied to BOTH the text and the query, so full-width and
// half-width forms (`ＡＢＣ` / `ABC`), half-width kana (`ｶﾞ` / `ガ`), a voiced mark
// typed as its own character (`か゛` / `が`) and upper/lower case all match one another.
//
// NFKC can change the length (`ｶﾞ` is two UTF-16 units, `ガ` one; `㈱` becomes `(株)`),
// and a hit has to be highlighted and jumped to in the ORIGINAL text. So alongside the
// normalized string we keep, for every normalized unit, where it came from.
// Pure and DOM-free so it can be unit-tested on its own.

import { findMatches, type Match } from './find';

export interface Normalized {
  /** NFKC + lowercase of the source. */
  text: string;
  /** For normalized unit `i`: offset in the source where its cluster starts. `null` = identity (nothing changed length). */
  from: Int32Array | null;
  /** For normalized unit `i`: offset in the source where its cluster ends. */
  to: Int32Array | null;
}

/** NFKC + lowercase. Apply it to the query exactly as it is applied to the text. */
export function normalizeForSearch(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

// Pure ASCII needs no clusters: lowercase keeps the length, so offsets are the same.
const ASCII = /^[\x00-\x7f]*$/;

let segmenter: Intl.Segmenter | null = null;
function graphemes(s: string): Iterable<{ segment: string; index: number }> {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return segmenter.segment(s);
}

/**
 * Normalize `source`, remembering where each normalized unit came from. Text is cut into
 * grapheme clusters first, because that is the unit NFKC composes within (a base kana and
 * its half-width voiced mark, a letter and a combining accent), so each cluster can be
 * normalized on its own and mapped back as a whole.
 */
export function normalizeWithMap(source: string): Normalized {
  if (ASCII.test(source)) return { text: source.toLowerCase(), from: null, to: null };

  const parts: string[] = [];
  const from: number[] = [];
  const to: number[] = [];
  for (const { segment, index } of graphemes(source)) {
    const n = normalizeForSearch(segment);
    parts.push(n);
    const end = index + segment.length;
    for (let i = 0; i < n.length; i++) {
      from.push(index);
      to.push(end);
    }
  }
  const text = parts.join('');
  // Nothing changed shape: identity mapping, so skip the arrays.
  if (text.length === source.length && from.every((f, i) => f === i)) return { text, from: null, to: null };
  return { text, from: Int32Array.from(from), to: Int32Array.from(to) };
}

/** Map a match found in the normalized text back to the source text. A match that covers
 *  only part of a cluster is widened to the whole cluster (the highlight can't split it). */
export function toSourceMatch(n: Normalized, m: Match): Match {
  if (!n.from || !n.to) return m;
  return { start: n.from[m.start], end: n.to[m.end - 1] };
}

/** Every match of `matcher` (built from a NORMALIZED query) in `n`, as ranges of the source. */
export function findInNormalized(n: Normalized, matcher: RegExp | null, limit = 20000): Match[] {
  return findMatches(n.text, matcher, limit).map((m) => toSourceMatch(n, m));
}
