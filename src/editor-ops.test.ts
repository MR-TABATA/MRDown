import { describe, it, expect } from 'vitest';
import {
  toggleWrap,
  toggleLinePrefix,
  insertLink,
  insertImage,
  insertFence,
  insertTable,
  insertHr,
  listContinue,
  listIndent,
  autoPair,
  linkFromPaste,
  slashContext,
  clearSlash,
  listToTable,
  tableToGantt,
  taskListToWbs,
  addTableColumn,
  deleteTableColumn,
  cycleTableAlign,
  insertWbs,
  WBS_DEFAULTS,
  cycleCase,
  sortLines,
  joinLines,
  splitLines,
  wrapLines,
  dedentLines,
  decodeText,
  type Sel,
} from './editor-ops';

const sel = (text: string, start: number, end: number): Sel => ({ text, start, end });
// Build a Sel from a string with a `|` caret marker (two `|` = a selection).
const at = (marked: string): Sel => {
  const start = marked.indexOf('|');
  const rest = marked.slice(0, start) + marked.slice(start + 1);
  const end = rest.indexOf('|');
  if (end === -1) return { text: rest, start, end: start };
  return { text: rest.slice(0, end) + rest.slice(end + 1), start, end };
};

describe('toggleWrap', () => {
  it('wraps the selection and keeps it selected', () => {
    const r = toggleWrap(sel('a bold c', 2, 6), '**');
    expect(r.text).toBe('a **bold** c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('unwraps when markers sit just outside the selection', () => {
    const r = toggleWrap(sel('a **bold** c', 4, 8), '**');
    expect(r.text).toBe('a bold c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('unwraps when markers are inside the selection', () => {
    const r = toggleWrap(sel('a **bold** c', 2, 10), '**');
    expect(r.text).toBe('a bold c');
    expect(r.text.slice(r.start, r.end)).toBe('bold');
  });
  it('inserts empty markers with the caret between them', () => {
    const r = toggleWrap(sel('ab', 1, 1), '*');
    expect(r.text).toBe('a**b');
    expect(r.start).toBe(2);
    expect(r.end).toBe(2);
  });
});

describe('toggleLinePrefix', () => {
  it('adds a heading prefix to the current line', () => {
    const r = toggleLinePrefix(sel('hello', 0, 0), '# ', /^#{1,6} /);
    expect(r.text).toBe('# hello');
  });
  it('removes the prefix when every line already has one', () => {
    const r = toggleLinePrefix(sel('- a\n- b', 0, 7), '- ', /^[-*+] /);
    expect(r.text).toBe('a\nb');
  });
  it('strips any heading level', () => {
    const r = toggleLinePrefix(sel('### deep', 0, 0), '# ', /^#{1,6} /);
    expect(r.text).toBe('deep');
  });
  it('prefixes a multi-line block, skipping blank lines', () => {
    const r = toggleLinePrefix(sel('a\n\nb', 0, 4), '> ', /^> /);
    expect(r.text).toBe('> a\n\n> b');
    expect(r.text.slice(r.start, r.end)).toBe('> a\n\n> b');
  });
  it('prefixes the caret line when the block is a single blank line', () => {
    // Where `/todo` and the checklist button land on an empty line: skipping
    // blank lines is right inside a block, but here there is nothing else.
    const r = toggleLinePrefix(at('a\n|'), '- [ ] ', /^[-*+] \[[ xX]\] /);
    expect(r.text).toBe('a\n- [ ] ');
  });
});

describe('insertLink', () => {
  it('wraps the selection and selects the url placeholder', () => {
    const r = insertLink(sel('see here now', 4, 8));
    expect(r.text).toBe('see [here](url) now');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });
});

describe('insertImage', () => {
  it('uses the selection as alt text and selects the url', () => {
    const r = insertImage(sel('logo', 0, 4));
    expect(r.text).toBe('![logo](url)');
    expect(r.text.slice(r.start, r.end)).toBe('url');
  });
});

describe('block inserts', () => {
  it('pads a horizontal rule onto its own line', () => {
    const r = insertHr(sel('a', 1, 1));
    expect(r.text).toBe('a\n---');
    expect(r.start).toBe(5);
  });
  it('does not double blank lines that already exist', () => {
    const r = insertHr(sel('a\n', 2, 2));
    expect(r.text).toBe('a\n---');
  });
  it('wraps a selection in a fenced code block with caret in the lang slot', () => {
    const r = insertFence(sel('x()', 0, 3));
    expect(r.text).toBe('```\nx()\n```');
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
  });
  it('inserts a table skeleton with the first header selected', () => {
    const r = insertTable(sel('', 0, 0));
    expect(r.text).toBe('| 見出し | 見出し |\n| --- | --- |\n| セル | セル |');
    expect(r.text.slice(r.start, r.end)).toBe('見出し');
  });
});

describe('listContinue', () => {
  it('continues an unordered list, preserving indent', () => {
    const r = listContinue(at('  - item|'));
    expect(r?.text).toBe('  - item\n  - ');
    expect(r?.start).toBe(r?.text.length);
  });
  it('increments an ordered list', () => {
    const r = listContinue(at('1. first|'));
    expect(r?.text).toBe('1. first\n2. ');
  });
  it('starts the next task item unchecked', () => {
    const r = listContinue(at('- [x] done|'));
    expect(r?.text).toBe('- [x] done\n- [ ] ');
  });
  it('exits the list when the item is empty', () => {
    const r = listContinue(at('- |'));
    expect(r?.text).toBe('');
    expect(r?.start).toBe(0);
  });
  it('carries the tail after the caret onto the new line', () => {
    const r = listContinue(at('- ab|cd'));
    expect(r?.text).toBe('- ab\n- cd');
  });
  it('returns null outside a list', () => {
    expect(listContinue(at('plain text|'))).toBeNull();
  });
  it('returns null when a range is selected', () => {
    expect(listContinue(at('- a|bc|d'))).toBeNull();
  });
});

describe('listIndent', () => {
  it('indents a list line by two spaces', () => {
    const r = listIndent(at('- item|'), false);
    expect(r?.text).toBe('  - item');
  });
  it('outdents a list line', () => {
    const r = listIndent(at('  - item|'), true);
    expect(r?.text).toBe('- item');
  });
  it('indents every line of a multi-line selection', () => {
    const r = listIndent(at('- a|\n- b|'), false);
    expect(r?.text).toBe('  - a\n  - b');
  });
  it('returns null when the block is not a list', () => {
    expect(listIndent(at('plain|'), false)).toBeNull();
  });
});

describe('autoPair', () => {
  it('inserts the matching close at a collapsed caret', () => {
    const r = autoPair(at('a|b'), '[');
    expect(r?.text).toBe('a[]b');
    expect(r?.start).toBe(2);
  });
  it('wraps a selection', () => {
    const r = autoPair(at('a|bc|d'), '`');
    expect(r?.text).toBe('a`bc`d');
    expect(r?.text.slice(r!.start, r!.end)).toBe('bc');
  });
  it('wraps a selection with asterisks', () => {
    expect(autoPair(at('|word|'), '*')?.text).toBe('*word*');
  });
  it('types over an existing close', () => {
    const r = autoPair(at('a[|]b'), ']');
    expect(r?.text).toBe('a[]b');
    expect(r?.start).toBe(3);
  });
  it('returns null for a plain character', () => {
    expect(autoPair(at('a|b'), 'x')).toBeNull();
  });
});

describe('linkFromPaste', () => {
  it('wraps the selection as a link when a URL is pasted', () => {
    const r = linkFromPaste(at('see |docs| here'), 'https://example.com/x');
    expect(r?.text).toBe('see [docs](https://example.com/x) here');
    expect(r?.start).toBe(r?.end);
  });
  it('trims surrounding whitespace on the pasted URL', () => {
    expect(linkFromPaste(at('|a|'), '  https://e.com  ')?.text).toBe('[a](https://e.com)');
  });
  it('returns null without a selection', () => {
    expect(linkFromPaste(at('x|y'), 'https://e.com')).toBeNull();
  });
  it('returns null when the paste is not a single URL', () => {
    expect(linkFromPaste(at('|a|'), 'not a url')).toBeNull();
    expect(linkFromPaste(at('|a|'), 'https://e.com and more')).toBeNull();
  });
});

describe('slashContext', () => {
  it('fires on a `/` at the start of an empty line', () => {
    expect(slashContext(at('a\n/|'))).toEqual({ from: 2, query: '' });
  });
  it('carries what has been typed after it as the filter', () => {
    expect(slashContext(at('/gan|'))).toEqual({ from: 0, query: 'gan' });
  });
  it('leaves a `/` inside a line alone — that is a path', () => {
    expect(slashContext(at('see src/|'))).toBe(null);
    expect(slashContext(at('- /usr/|'))).toBe(null);
  });
  it('does not fire with text after the caret', () => {
    expect(slashContext(at('/|tail'))).toBe(null);
  });
  it('does not fire with a selection', () => {
    expect(slashContext(at('/|ga|'))).toBe(null);
  });
  it('clearSlash removes the typed query and leaves the caret there', () => {
    const r = clearSlash(at('x\n/gan|'), 2);
    expect(r.text).toBe('x\n');
    expect(r.start).toBe(2);
  });
});

describe('listToTable', () => {
  it('splits `name — description` into two columns', () => {
    const r = listToTable(at('- **A** — first\n- **B**| — second'))!;
    expect(r.text).toBe(
      '| 項目 | 内容 |\n| --- | --- |\n| **A** | first |\n| **B** | second |'
    );
  });
  it('splits on a colon too', () => {
    const r = listToTable(at('|- 開始: 9時\n- 場所: 会議室|'))!;
    expect(r.text.split('\n')[2]).toBe('| 開始 | 9時 |');
  });
  it('gives a task list a 状態 column', () => {
    const r = listToTable(at('- [x] 済んだ|\n- [ ] まだ'))!;
    expect(r.text).toBe(
      '| 状態 | 項目 |\n| --- | --- |\n| 済 | 済んだ |\n|  | まだ |'
    );
  });
  it('pads rows that have fewer cells than the widest', () => {
    const r = listToTable(at('- A — 1 — x\n- B|'))!;
    expect(r.text.split('\n')[3]).toBe('| B |  |  |');
  });
  it('escapes a pipe inside an item', () => {
    // `at()` would read the pipes as caret markers, so build the Sel directly.
    const r = listToTable(sel('- a|b', 5, 5))!;
    expect(r.text.split('\n')[2]).toBe('| a\\|b |');
  });
  it('takes the list around the caret without a selection', () => {
    const r = listToTable(at('見出し\n\n- A — 1\n- B| — 2\n\n後ろ'))!;
    expect(r.text).toBe('見出し\n\n| 項目 | 内容 |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n\n後ろ');
  });
  it('takes the list above when run from the blank line under it', () => {
    // Where `/` leaves the caret, and where you stand after Enter on a list.
    const r = listToTable(at('- A — 1\n- B — 2\n\n|'))!;
    expect(r.text).toBe('| 項目 | 内容 |\n| --- | --- |\n| A | 1 |\n| B | 2 |\n\n');
  });
  it('leaves a block that is not a list alone', () => {
    expect(listToTable(at('ただの段落|'))).toBe(null);
    expect(listToTable(at('- a\nただの行|'))).toBe(null);
  });
});

const TABLE = [
  '| タスク | 開始 | 期間 | 状態 |',
  '| --- | --- | --- | --- |',
  '| 設計 | 2026-08-01 | 3日 | 完了 |',
  '| 実装 | 2026/8/4 | 2週 | 進行中 |',
].join('\n');

describe('tableToGantt', () => {
  it('reads the columns by their headers', () => {
    const r = tableToGantt(sel(TABLE, 0, 0))!;
    expect(r.text.slice(r.start, r.end)).toBe(
      [
        '```mermaid',
        'gantt',
        '    dateFormat YYYY-MM-DD',
        '    設計 :done, 2026-08-01, 3d',
        '    実装 :active, 2026-08-04, 2w',
        '```',
      ].join('\n')
    );
  });
  it('keeps the table and writes the chart after it', () => {
    const r = tableToGantt(sel(TABLE, 0, 0))!;
    expect(r.text.startsWith(TABLE + '\n\n```mermaid')).toBe(true);
  });
  it('re-running replaces the chart instead of stacking another', () => {
    const once = tableToGantt(sel(TABLE, 0, 0))!;
    const twice = tableToGantt({ text: once.text, start: 0, end: 0 })!;
    expect(twice.text).toBe(once.text);
    expect(twice.text.match(/```mermaid/g)!.length).toBe(1);
  });
  it('takes an end date over a duration', () => {
    const t = '| タスク | 開始 | 期限 |\n| --- | --- | --- |\n| A | 2026-08-01 | 2026-08-09 |';
    expect(tableToGantt(sel(t, 0, 0))!.text).toContain('    A :2026-08-01, 2026-08-09');
  });
  it('defaults to a day when there is neither', () => {
    const t = '| タスク | 開始 |\n| --- | --- |\n| A | 2026-08-01 |';
    expect(tableToGantt(sel(t, 0, 0))!.text).toContain('    A :2026-08-01, 1d');
  });
  it('groups rows under a section column', () => {
    const t = [
      '| フェーズ | タスク | 開始 |',
      '| --- | --- | --- |',
      '| 準備 | A | 2026-08-01 |',
      '| 準備 | B | 2026-08-02 |',
      '| 本番 | C | 2026-08-03 |',
    ].join('\n');
    const lines = tableToGantt(sel(t, 0, 0))!.text.split('\n');
    expect(lines.filter((l) => l.trim().startsWith('section'))).toEqual([
      '    section 準備',
      '    section 本番',
    ]);
  });
  it('finds the dates even when no header says 開始', () => {
    const t = '| やること | いつ |\n| --- | --- |\n| A | 2026-08-01 |';
    expect(tableToGantt(sel(t, 0, 0))!.text).toContain('    A :2026-08-01, 1d');
  });
  it('escapes a colon in a task name — it would end the name', () => {
    const t = '| タスク | 開始 |\n| --- | --- |\n| a:b | 2026-08-01 |';
    expect(tableToGantt(sel(t, 0, 0))!.text).toContain('    a：b :2026-08-01');
  });
  it('takes the table above when run from the blank line under it', () => {
    const r = tableToGantt(sel(`${TABLE}\n\n`, TABLE.length + 2, TABLE.length + 2))!;
    expect(r.text.startsWith(TABLE + '\n\n```mermaid')).toBe(true);
  });
  it('leaves a table with no dates alone', () => {
    const t = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    expect(tableToGantt(sel(t, 0, 0))).toBe(null);
  });
  it('returns null outside a table', () => {
    expect(tableToGantt(at('ただの段落|'))).toBe(null);
  });
});

describe('taskListToWbs', () => {
  it('numbers a flat list 1, 2, 3', () => {
    const r = taskListToWbs(at('- [ ] 設計|\n- [ ] 実装\n- [ ] 検証'))!;
    expect(r.text).toBe('- [ ] 1 設計\n- [ ] 2 実装\n- [ ] 3 検証');
  });
  it('keeps the hierarchy, unlike listToTable', () => {
    const r = taskListToWbs(at('- 設計|\n  - 調査\n  - 方式\n- 実装'))!;
    expect(r.text).toBe('- 1 設計\n  - 1.1 調査\n  - 1.2 方式\n- 2 実装');
  });
  it('carries the checkbox through unchanged', () => {
    const r = taskListToWbs(at('- [x] 済み|\n  - [ ] 子'))!;
    expect(r.text).toBe('- [x] 1 済み\n  - [ ] 1.1 子');
  });
  it('renumbers instead of stacking when run again', () => {
    const once = taskListToWbs(at('- a|\n  - b\n- c'))!;
    const twice = taskListToWbs({ ...once, start: 0, end: 0 })!;
    expect(twice.text).toBe(once.text);
  });
  it('closes the gap after an item is deleted', () => {
    const r = taskListToWbs(at('- 1 a|\n- 3 c'))!;
    expect(r.text).toBe('- 1 a\n- 2 c');
  });
  it('outdents back to the level it belongs to', () => {
    const r = taskListToWbs(at('- a|\n  - b\n    - c\n  - d\n- e'))!;
    expect(r.text).toBe('- 1 a\n  - 1.1 b\n    - 1.1.1 c\n  - 1.2 d\n- 2 e');
  });
  it('normalises the bullet so the numbers do not compete', () => {
    const r = taskListToWbs(at('* a|\n* b'))!;
    expect(r.text).toBe('- 1 a\n- 2 b');
  });
  it('leaves a block that is not a list alone', () => {
    expect(taskListToWbs(at('ただの段落|'))).toBeNull();
  });
});

// `at()` marks the caret with `|`, which a table is made of — so these place the
// caret by offset instead, with `on()` pointing at the first cell holding `find`.
const T = '| A | B |\n| --- | --- |\n| 1 | 2 |';
const on = (text: string, find: string): Sel => {
  const i = text.indexOf(find);
  return { text, start: i, end: i };
};
/** The whole string selected — what the text transforms are normally handed. */
const whole = (text: string): Sel => ({ text, start: 0, end: text.length });

describe('table columns', () => {
  it('adds an empty column to the right of the caret', () => {
    expect(addTableColumn(on(T, 'A'))!.text).toBe('| A |  | B |\n| --- | --- | --- |\n| 1 |  | 2 |');
  });
  it('adds at the far right when the caret is in the last column', () => {
    expect(addTableColumn(on(T, 'B'))!.text).toBe('| A | B |  |\n| --- | --- | --- |\n| 1 | 2 |  |');
  });
  it('deletes the caret column', () => {
    expect(deleteTableColumn(on(T, 'A'))!.text).toBe('| B |\n| --- |\n| 2 |');
  });
  it('refuses to delete the only column', () => {
    expect(deleteTableColumn(on('| A |\n| --- |\n| 1 |', 'A'))).toBeNull();
  });
  it('works from a body row too', () => {
    expect(deleteTableColumn(on(T, '2'))!.text).toBe('| A |\n| --- |\n| 1 |');
  });
  it('cycles alignment left, centre, right, none', () => {
    let cur: Sel = on(T, 'A');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      cur = cycleTableAlign(cur)!;
      seen.push(cur.text.split('\n')[1]);
    }
    expect(seen).toEqual(['| :--- | --- |', '| :---: | --- |', '| ---: | --- |', '| --- | --- |']);
  });
  it('answers on the delimiter row, where there is no cell to be inside of', () => {
    const pos = T.indexOf('---', T.indexOf('---') + 1);
    expect(cycleTableAlign({ text: T, start: pos, end: pos })!.text.split('\n')[1])
      .toBe('| --- | :--- |');
  });
  it('leaves the caret in the same column, so it can be pressed again', () => {
    const once = cycleTableAlign(on(T, 'B'))!;
    expect(cycleTableAlign(once)!.text.split('\n')[1]).toBe('| --- | :---: |');
  });
  it('returns null outside a table', () => {
    expect(addTableColumn(at('just a paragraph|'))).toBeNull();
    expect(deleteTableColumn(at('just a paragraph|'))).toBeNull();
    expect(cycleTableAlign(at('just a paragraph|'))).toBeNull();
  });
  it('pads rows that are missing cells', () => {
    const ragged = '| A | B |\n| --- | --- |\n| 1 |';
    expect(addTableColumn(on(ragged, 'A'))!.text)
      .toBe('| A |  | B |\n| --- | --- | --- |\n| 1 |  |  |');
  });
});

describe('insertWbs', () => {
  it('makes a two-deep skeleton with ids by default', () => {
    expect(insertWbs(whole(''), WBS_DEFAULTS).text)
      .toBe('- [ ] 1 \n  - [ ] 1.1 \n  - [ ] 1.2 \n- [ ] 2 \n  - [ ] 2.1 \n  - [ ] 2.2 ');
  });
  it('leaves the caret at the end of the first item, ready to type', () => {
    const r = insertWbs(whole(''), WBS_DEFAULTS);
    expect(r.text.slice(0, r.start)).toBe('- [ ] 1 ');
    expect(r.start).toBe(r.end);
  });
  it('drops the numbers when ids are off', () => {
    expect(insertWbs(whole(''), { ...WBS_DEFAULTS, depth: 1, ids: false }).text)
      .toBe('- [ ] \n- [ ] ');
  });
  it('adds a table whose columns tableToGantt can read', () => {
    const r = insertWbs(whole(''), { ...WBS_DEFAULTS, depth: 1, start: '2026-09-06', table: true });
    expect(r.text).toContain('| ID | タスク | 担当 | 開始 | 終了 |');
    expect(r.text).toContain('2026-09-06');
  });
  it('clamps the depth to 1..3', () => {
    const deep = insertWbs(whole(''), { ...WBS_DEFAULTS, depth: 9 }).text.split('\n');
    expect(Math.max(...deep.map((l) => l.split('.').length))).toBe(3);
  });
});

describe('cycleCase', () => {
  it('walks camel, snake, kebab, constant, title and back', () => {
    let cur: Sel = whole('fooBarBaz');
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) { cur = cycleCase(cur)!; seen.push(cur.text); }
    expect(seen).toEqual(['foo_bar_baz', 'foo-bar-baz', 'FOO_BAR_BAZ', 'Foo Bar Baz', 'fooBarBaz']);
  });
  it('starts at camelCase for a shape it does not recognise', () => {
    expect(cycleCase(whole('foo bar'))!.text).toBe('fooBar');
  });
  it('returns null across lines, where there is no single name to convert', () => {
    expect(cycleCase(whole('a\nb'))).toBeNull();
  });
});

describe('sortLines', () => {
  it('sorts alphabetically, ignoring the list marker', () => {
    expect(sortLines(whole('- banana\n- apple\n- cherry'), 'text')!.text)
      .toBe('- apple\n- banana\n- cherry');
  });
  it('sorts by value, not by the digits as text', () => {
    expect(sortLines(whole('- 10 件\n- 2 件\n- 33 件'), 'number')!.text)
      .toBe('- 2 件\n- 10 件\n- 33 件');
  });
  it('puts lines with no number last', () => {
    expect(sortLines(whole('- z\n- 5'), 'number')!.text).toBe('- 5\n- z');
  });
  it('sorts by length', () => {
    expect(sortLines(whole('- ccc\n- a\n- bb'), 'length')!.text).toBe('- a\n- bb\n- ccc');
  });
  it('returns null with nothing to reorder', () => {
    expect(sortLines(whole('only one'), 'text')).toBeNull();
  });
});

describe('joinLines / splitLines', () => {
  it('joins list items into one line', () => {
    expect(joinLines(whole('- りんご\n- みかん\n- ぶどう'))!.text).toBe('りんご、みかん、ぶどう');
  });
  it('splits back on the comma', () => {
    expect(splitLines(whole('りんご、みかん、ぶどう'))!.text).toBe('- りんご\n- みかん\n- ぶどう');
  });
  it('falls back to whitespace when there is no comma', () => {
    expect(splitLines(whole('a b c'))!.text).toBe('- a\n- b\n- c');
  });
  it('returns null when there is nothing to join or split', () => {
    expect(joinLines(whole('- one'))).toBeNull();
    expect(splitLines(whole('single'))).toBeNull();
  });
});

describe('wrapLines / dedentLines', () => {
  it('wraps at the width, keeping the indent', () => {
    expect(wrapLines(whole('  the quick brown fox jumps'), 20)!.text)
      .toBe('  the quick brown\n  fox jumps');
  });
  it('leaves a line that already fits', () => {
    expect(wrapLines(whole('short'), 20)!.text).toBe('short');
  });
  it('strips the shared indent and keeps the relative depth', () => {
    expect(dedentLines(whole('    a\n      b\n    c'))!.text).toBe('a\n  b\nc');
  });
  it('returns null when nothing is indented', () => {
    expect(dedentLines(whole('a\nb'))).toBeNull();
  });
});

describe('decodeText', () => {
  it('turns named entities back', () => {
    expect(decodeText(whole('a &amp; b &lt;c&gt;'))!.text).toBe('a & b <c>');
  });
  it('turns numeric references back, including astral ones', () => {
    expect(decodeText(whole('&#x1F600; &#65;'))!.text).toBe('😀 A');
  });
  it('percent-decodes a run at a time', () => {
    expect(decodeText(whole('%E6%97%A5%E6%9C%AC end'))!.text).toBe('日本 end');
  });
  it('leaves a broken percent sequence alone rather than losing the rest', () => {
    expect(decodeText(whole('100%25 %ZZ'))!.text).toBe('100% %ZZ');
  });
  it('returns null when there is nothing encoded', () => {
    expect(decodeText(whole('plain text'))).toBeNull();
  });
});
