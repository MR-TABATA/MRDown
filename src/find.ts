// Shared search core for the in-document find/replace bar. Pure and DOM-free
// so it can back both the source (editor) and preview (rendered) searches, and
// be unit-tested on its own. The UI wiring lives in main.ts.

export interface FindOpts {
  /** Treat the query as a JavaScript regular expression. */
  regex: boolean;
  /** Match case exactly (otherwise case-insensitive). */
  caseSensitive: boolean;
  /** Only match whole words (letter/number/underscore boundaries). */
  wholeWord: boolean;
}

export interface Match {
  start: number;
  end: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build a global RegExp for the query under the given options, or null when the
// query is empty or (in regex mode) an invalid pattern. Callers treat null as
// "no matches" — which also lets the UI flag an invalid regex.
export function buildMatcher(query: string, opts: FindOpts): RegExp | null {
  if (!query) return null;
  let source = opts.regex ? query : escapeRegExp(query);
  let flags = 'gm';
  if (!opts.caseSensitive) flags += 'i';
  if (opts.wholeWord) {
    // \p{L}\p{N} needs the unicode flag; the lookarounds keep matches from
    // starting/ending in the middle of a run of word characters.
    source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
    flags += 'u';
  }
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

// A run of haystack text backed by one source unit (e.g. a DOM text node),
// starting at offset `start` in the haystack and `len` characters long.
export interface Seg {
  start: number;
  len: number;
}

// A slice of a match that falls within a single segment: `[s, e)` are offsets
// local to that segment, `mid` is the index of the match it belongs to.
export interface SegSlice {
  seg: number;
  s: number;
  e: number;
  mid: number;
}

// Split each match into per-segment slices so a match spanning several segments
// (i.e. crossing tag boundaries in the rendered preview) can be highlighted
// piece by piece. Assumes both lists are sorted by position.
export function sliceMatches(segs: Seg[], matches: Match[]): SegSlice[] {
  const out: SegSlice[] = [];
  matches.forEach((mt, mid) => {
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const segEnd = seg.start + seg.len;
      if (segEnd <= mt.start) continue;
      if (seg.start >= mt.end) break;
      const s = Math.max(mt.start, seg.start) - seg.start;
      const e = Math.min(mt.end, segEnd) - seg.start;
      if (e > s) out.push({ seg: i, s, e, mid });
    }
  });
  return out;
}

// Collect every non-overlapping match of `matcher` in `hay`. Zero-length
// matches (e.g. `a*`) are recorded once and then stepped past so we never spin.
export function findMatches(hay: string, matcher: RegExp | null, limit = 20000): Match[] {
  if (!matcher) return [];
  const out: Match[] = [];
  matcher.lastIndex = 0;
  for (let m = matcher.exec(hay); m; m = matcher.exec(hay)) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (matcher.lastIndex === m.index) matcher.lastIndex++;
    if (out.length >= limit) break;
  }
  return out;
}
