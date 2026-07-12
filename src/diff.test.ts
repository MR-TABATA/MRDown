import { describe, it, expect } from 'vitest';
import { diff, sideBySide, inlineSegments, diffStats, foldUnchanged, type DiffRow, type Gap } from './diff';

/** Compact a row list into strings that are readable when a test fails. */
const shape = (rows: DiffRow[]) =>
  rows.map((r) => `${r.type} ${r.leftNo ?? '-'}|${r.rightNo ?? '-'} ${r.left ?? ''}>${r.right ?? ''}`);

describe('diff', () => {
  it('reports no ops but equality for identical input', () => {
    expect(diff(['a', 'b'], ['a', 'b'])).toEqual([
      { type: 'eq', value: 'a' },
      { type: 'eq', value: 'b' },
    ]);
  });

  it('handles an empty side', () => {
    expect(diff([], ['a'])).toEqual([{ type: 'ins', value: 'a' }]);
    expect(diff(['a'], [])).toEqual([{ type: 'del', value: 'a' }]);
    expect(diff([], [])).toEqual([]);
  });

  it('finds a minimal edit script', () => {
    // The classic Myers example: ABCABBA -> CBABAC in 5 edits.
    const ops = diff([...'ABCABBA'], [...'CBABAC']);
    const edits = ops.filter((o) => o.type !== 'eq').length;
    expect(edits).toBe(5);
  });

  it('reconstructs both sides from the ops', () => {
    const a = ['one', 'two', 'three', 'four'];
    const b = ['one', 'TWO', 'three', 'five', 'four'];
    const ops = diff(a, b);
    expect(ops.filter((o) => o.type !== 'ins').map((o) => o.value)).toEqual(a);
    expect(ops.filter((o) => o.type !== 'del').map((o) => o.value)).toEqual(b);
  });

  it('keeps an untouched head and tail out of the changed region', () => {
    const a = ['h', 'x', 't'];
    const b = ['h', 'y', 't'];
    expect(diff(a, b)).toEqual([
      { type: 'eq', value: 'h' },
      { type: 'del', value: 'x' },
      { type: 'ins', value: 'y' },
      { type: 'eq', value: 't' },
    ]);
  });

  it('still produces a usable diff past the edit cap', () => {
    // Two long, wholly unrelated texts: past MAX_EDITS the middle is reported as
    // replaced rather than the diff failing.
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    const ops = diff(a, b);
    expect(ops.filter((o) => o.type === 'del')).toHaveLength(3000);
    expect(ops.filter((o) => o.type === 'ins')).toHaveLength(3000);
    expect(ops.filter((o) => o.type === 'eq')).toHaveLength(0);
  });

  it('diffs a large file with a small edit quickly and minimally', () => {
    const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
    const b = [...a];
    b[10000] = 'changed';
    const started = Date.now();
    const ops = diff(a, b);
    // The prefix/suffix trim means Myers only ever sees the one changed line.
    expect(ops.filter((o) => o.type !== 'eq')).toEqual([
      { type: 'del', value: 'line 10000' },
      { type: 'ins', value: 'changed' },
    ]);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('sideBySide', () => {
  it('pairs a replaced line into one mod row', () => {
    expect(shape(sideBySide('a\nb\nc', 'a\nB\nc'))).toEqual([
      'eq 1|1 a>a',
      'mod 2|2 b>B',
      'eq 3|3 c>c',
    ]);
  });

  it('numbers each side independently around an insertion', () => {
    expect(shape(sideBySide('a\nc', 'a\nb\nc'))).toEqual(['eq 1|1 a>a', 'ins -|2 >b', 'eq 2|3 c>c']);
  });

  it('numbers each side independently around a deletion', () => {
    // The old side keeps counting through the deleted line, so `c` is old line 3
    // but new line 2 — that offset is the whole point of numbering both sides.
    expect(shape(sideBySide('a\nb\nc', 'a\nc'))).toEqual(['eq 1|1 a>a', 'del 2|- b>', 'eq 3|2 c>c']);
  });

  it('pairs what it can and leaves the surplus as pure add/remove', () => {
    // Two lines become three: two mod rows and one insert, not five loose rows.
    expect(shape(sideBySide('x\ny', 'X\nY\nZ'))).toEqual(['mod 1|1 x>X', 'mod 2|2 y>Y', 'ins -|3 >Z']);
  });

  it('does not invent a trailing empty line', () => {
    expect(sideBySide('a\n', 'a\n')).toHaveLength(1);
  });

  it('treats a blank line as a line', () => {
    expect(shape(sideBySide('a\n\nb', 'a\n\nb'))).toHaveLength(3);
  });

  it('reports an empty document against a new one as all insertions', () => {
    expect(shape(sideBySide('', 'a\nb'))).toEqual(['ins -|1 >a', 'ins -|2 >b']);
  });
});

describe('inlineSegments', () => {
  it('marks only the word that changed', () => {
    const { left, right } = inlineSegments('the quick fox', 'the slow fox');
    expect(left.filter((s) => s.changed).map((s) => s.text)).toEqual(['quick']);
    expect(right.filter((s) => s.changed).map((s) => s.text)).toEqual(['slow']);
    expect(left.map((s) => s.text).join('')).toBe('the quick fox');
    expect(right.map((s) => s.text).join('')).toBe('the slow fox');
  });

  it('compares CJK character by character, having no spaces to split on', () => {
    // One character differs (書/描) and the rest of the line must stay unmarked —
    // splitting Japanese on whitespace would light up the entire line.
    const { left, right } = inlineSegments('設計メモを書く', '設計メモを描く');
    expect(left.filter((s) => s.changed).map((s) => s.text)).toEqual(['書']);
    expect(right.filter((s) => s.changed).map((s) => s.text)).toEqual(['描']);
  });

  it('merges a run of changed characters into one segment', () => {
    // 書く → 読む: both characters differ, so it reads as one changed run.
    const { left, right } = inlineSegments('設計メモを書く', '設計メモを読む');
    expect(left.filter((s) => s.changed).map((s) => s.text)).toEqual(['書く']);
    expect(right.filter((s) => s.changed).map((s) => s.text)).toEqual(['読む']);
  });

  it('marks nothing when the lines are equal', () => {
    const { left, right } = inlineSegments('same', 'same');
    expect(left.some((s) => s.changed)).toBe(false);
    expect(right.some((s) => s.changed)).toBe(false);
  });

  it('merges neighbouring tokens so a line is a few spans, not one per character', () => {
    const { right } = inlineSegments('', 'あいうえお');
    expect(right).toEqual([{ text: 'あいうえお', changed: true }]);
  });

  it('always reconstructs both original lines', () => {
    const a = '- [ ] Developer ID で notarize する';
    const b = '- [x] Developer ID で notarize した';
    const { left, right } = inlineSegments(a, b);
    expect(left.map((s) => s.text).join('')).toBe(a);
    expect(right.map((s) => s.text).join('')).toBe(b);
  });
});

describe('foldUnchanged', () => {
  const doc = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

  it('folds a long unchanged run into a gap', () => {
    const a = doc(50);
    const b = a.replace('line 25', 'changed');
    const folded = foldUnchanged(sideBySide(a, b));
    const gaps = folded.filter((r): r is Gap => r.type === 'gap');
    expect(gaps).toHaveLength(2); // before and after the change
    // 25 lines precede the change; 3 stay as context.
    expect(gaps[0].count).toBe(22);
    // Everything kept is either the change or its context.
    expect(folded.filter((r) => r.type !== 'gap')).toHaveLength(7); // 3 + mod + 3
  });

  it('keeps the requested lines of context around each change', () => {
    const folded = foldUnchanged(sideBySide(doc(50), doc(50).replace('line 25', 'x')), 1);
    expect(folded.filter((r) => r.type !== 'gap')).toHaveLength(3); // 1 + mod + 1
  });

  it('never folds a single line — a gap would cost more than it saves', () => {
    // Two changes four lines apart: with 3 lines of context the two-line span
    // between them is fully covered anyway, leaving nothing to fold.
    const a = doc(20);
    const b = a.replace('line 5', 'x').replace('line 9', 'y');
    const folded = foldUnchanged(sideBySide(a, b));
    const between = folded.slice(
      folded.findIndex((r) => r.type === 'mod'),
      folded.length,
    );
    expect(between.some((r) => r.type === 'gap' && r.count === 1)).toBe(false);
  });

  it('leaves a document with no changes entirely folded', () => {
    const folded = foldUnchanged(sideBySide(doc(20), doc(20)));
    expect(folded).toEqual([{ type: 'gap', count: 20 }]);
  });

  it('folds nothing when everything changed', () => {
    const folded = foldUnchanged(sideBySide('a\nb', 'x\ny'));
    expect(folded.some((r) => r.type === 'gap')).toBe(false);
  });
});

describe('diffStats', () => {
  it('counts a rewritten line as both an add and a remove', () => {
    expect(diffStats(sideBySide('a\nb\nc', 'a\nB\nc\nd'))).toEqual({ added: 2, removed: 1 });
  });

  it('counts nothing for an unchanged document', () => {
    expect(diffStats(sideBySide('a\nb', 'a\nb'))).toEqual({ added: 0, removed: 0 });
  });
});
