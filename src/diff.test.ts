import { describe, it, expect } from 'vitest';
import {
  diff,
  sideBySide,
  inlineSegments,
  diffStats,
  foldUnchanged,
  foldThreeWay,
  threeWay,
  threeWayStats,
  isGap,
  type DiffRow,
  type Gap,
} from './diff';

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

describe('threeWay', () => {
  // The situation MRDown exists for: you were editing, an agent rewrote the file.
  const BASE = '# メモ\n\n共通の行\n最後の行';

  it('attributes a change to the side that made it', () => {
    const theirs = '# メモ\n\nAI が直した行\n最後の行';
    const ours = '# メモ\n\n共通の行\n最後の行';
    const rows = threeWay(BASE, theirs, ours);
    const changed = rows.filter((r) => r.theirsChanged || r.oursChanged);
    expect(changed).toHaveLength(1);
    expect(changed[0].theirsChanged).toBe(true);
    expect(changed[0].oursChanged).toBe(false);
    expect(changed[0].conflict).toBe(false);
  });

  it('lets both sides change different lines without conflicting', () => {
    const theirs = '# メモ\n\nAI が直した行\n最後の行';
    const ours = '# メモ\n\n共通の行\n私が直した行';
    const rows = threeWay(BASE, theirs, ours);
    expect(threeWayStats(rows)).toEqual({ theirs: 1, ours: 1, conflicts: 0 });
  });

  it('flags the same line rewritten differently as a conflict', () => {
    const theirs = '# メモ\n\nAI の言い分\n最後の行';
    const ours = '# メモ\n\n私の言い分\n最後の行';
    const rows = threeWay(BASE, theirs, ours);
    const stats = threeWayStats(rows);
    expect(stats.conflicts).toBe(1);
    const row = rows.find((r) => r.conflict)!;
    expect(row.base).toBe('共通の行');
    expect(row.theirs).toBe('AI の言い分');
    expect(row.ours).toBe('私の言い分');
  });

  it('does not call it a conflict when both sides made the same edit', () => {
    const same = '# メモ\n\n同じ直し\n最後の行';
    const rows = threeWay(BASE, same, same);
    expect(threeWayStats(rows).conflicts).toBe(0);
  });

  it('shows a line one side deleted as null on that side only', () => {
    const theirs = '# メモ\n\n最後の行'; // AI dropped the shared line
    const rows = threeWay(BASE, theirs, BASE);
    const row = rows.find((r) => r.base === '共通の行')!;
    expect(row.theirs).toBeNull();
    expect(row.theirsChanged).toBe(true);
    expect(row.ours).toBe('共通の行');
    expect(row.oursChanged).toBe(false);
  });

  it('pairs insertions the two sides made at the same place', () => {
    const theirs = '# メモ\n\n共通の行\nAI の追記\n最後の行';
    const ours = '# メモ\n\n共通の行\n私の追記\n最後の行';
    const rows = threeWay(BASE, theirs, ours);
    const ins = rows.filter((r) => r.base === null);
    expect(ins).toHaveLength(1); // one row, not two stacked
    expect(ins[0].theirs).toBe('AI の追記');
    expect(ins[0].ours).toBe('私の追記');
    expect(ins[0].conflict).toBe(true);
  });

  it('keeps each side numbered in its own coordinates', () => {
    const theirs = '# メモ\n\n差し込み\n共通の行\n最後の行'; // shifts theirs down by one
    const rows = threeWay(BASE, theirs, BASE);
    const last = rows[rows.length - 1];
    expect(last.base).toBe('最後の行');
    expect(last.baseNo).toBe(4);
    expect(last.theirsNo).toBe(5); // one line lower on their side
    expect(last.oursNo).toBe(4);
  });

  it('reports nothing changed when all three agree', () => {
    expect(threeWayStats(threeWay(BASE, BASE, BASE))).toEqual({
      theirs: 0,
      ours: 0,
      conflicts: 0,
    });
  });
});

describe('foldThreeWay', () => {
  it('folds the untouched middle of a three-way comparison', () => {
    const base = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const theirs = base.replace('line 20', 'AI');
    const rows = threeWay(base, theirs, base);
    const folded = foldThreeWay(rows);
    expect(folded.filter(isGap)).toHaveLength(2);
    expect(folded.filter((r) => !isGap(r))).toHaveLength(7); // 3 + change + 3
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
